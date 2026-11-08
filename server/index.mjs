import express from 'express';
import pg from 'pg';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {APP_ID, parseEvent, reduceEvents} from './protocol.mjs';

const PORT = Number(process.env.PORT || 3000);
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const ENGINE_RPC = process.env.ENGINE_RPC || 'https://api.hive-engine.com/rpc/contracts';
const BACKFILL = Math.max(0, Math.min(100_000, Number(process.env.START_BACKFILL_BLOCKS || 1200)));
const pool = process.env.DATABASE_URL
  ? new pg.Pool({connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? {rejectUnauthorized: false} : undefined,
      max: 4}) : null;

const app = express();
app.disable('x-powered-by');
app.use((req,res,next) => {
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','strict-origin-when-cross-origin');
  next();
});
const events = [];
const eventKeys = new Set();
let cursor = null;
let chainHead = 0;
let busy = false;
let lastError = null;
let lastSyncedAt = null;
let tokenCache = {data:null, expires:0};

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0',method,params,id:1}),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error('RPC HTTP ' + response.status);
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'RPC error');
  return json.result;
}

async function setup() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS lease_events (
    event_key TEXT PRIMARY KEY,
    block_num BIGINT NOT NULL,
    event_order INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    payload JSONB NOT NULL,
    tx_id TEXT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS lease_sync (
    name TEXT PRIMARY KEY,
    block_num BIGINT NOT NULL
  )`);
  const stored = await pool.query('SELECT * FROM lease_events ORDER BY block_num, event_order');
  for (const row of stored.rows) {
    const entry = {key:row.event_key,blockNum:Number(row.block_num),eventOrder:row.event_order,
      actor:row.actor,payload:row.payload,txId:row.tx_id,time:new Date(row.block_time).toISOString()};
    events.push(entry);
    eventKeys.add(entry.key);
  }
  const state = await pool.query("SELECT block_num FROM lease_sync WHERE name='main'");
  if (state.rows.length) cursor = Number(state.rows[0].block_num);
}

function customJson(op) {
  if (Array.isArray(op)) return op[0] === 'custom_json' ? op[1] : null;
  if (op?.type === 'custom_json_operation' || op?.type === 'custom_json') return op.value || op;
  return null;
}
function readBlocks(blocks, startingNumber) {
  const found = [];
  blocks.forEach((wrapper,i) => {
    const block = wrapper?.block || wrapper;
    if (!block || !Array.isArray(block.transactions)) return;
    const blockNum = startingNumber + i;
    const time = String(block.timestamp || '') + (String(block.timestamp).endsWith('Z') ? '' : 'Z');
    block.transactions.forEach((tx,txIndex) => {
      if (!Array.isArray(tx.operations)) return;
      tx.operations.forEach((raw,opIndex) => {
        const operation = customJson(raw);
        if (!operation || operation.id !== APP_ID) return;
        const authorized = operation.required_posting_auths;
        if (!Array.isArray(authorized) || authorized.length !== 1 ||
          (operation.required_auths && operation.required_auths.length)) return;
        let json;
        try {json = typeof operation.json === 'string' ? JSON.parse(operation.json) : operation.json;}
        catch {return;}
        const payload = parseEvent(json, authorized[0], time);
        if (!payload) return;
        const key = `${blockNum}:${txIndex}:${opIndex}`;
        if (eventKeys.has(key)) return;
        found.push({key,blockNum,eventOrder:txIndex*1000+opIndex,actor:authorized[0],
          payload,txId:block.transaction_ids?.[txIndex] || '',time});
      });
    });
  });
  return found;
}

async function saveBatch(batch, nextCursor) {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const ev of batch) {
        await client.query(`INSERT INTO lease_events
          (event_key,block_num,event_order,actor,action,payload,tx_id,block_time)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [ev.key,ev.blockNum,ev.eventOrder,ev.actor,ev.payload.type,JSON.stringify(ev.payload),ev.txId,ev.time]);
      }
      await client.query(`INSERT INTO lease_sync(name,block_num) VALUES('main',$1)
        ON CONFLICT(name) DO UPDATE SET block_num=EXCLUDED.block_num`,[nextCursor]);
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {client.release();}
  }
  for (const ev of batch) {
    if (!eventKeys.has(ev.key)) {events.push(ev);eventKeys.add(ev.key);}
  }
  cursor = nextCursor;
}

async function syncOnce() {
  if (busy) return;
  busy = true;
  try {
    const props = await rpc(HIVE_RPC,'condenser_api.get_dynamic_global_properties',[]);
    chainHead = Number(props.last_irreversible_block_num || props.head_block_number);
    if (!Number.isSafeInteger(chainHead) || chainHead < 1) throw new Error('Invalid Hive chain head');
    if (cursor === null) {
      cursor = Math.max(0,chainHead-BACKFILL);
      if (pool) {
        await pool.query(`INSERT INTO lease_sync(name,block_num) VALUES('main',$1)
          ON CONFLICT(name) DO NOTHING`,[cursor]);
      }
    }
    if (cursor < chainHead) {
      const count = Math.min(40,chainHead-cursor);
      const result = await rpc(HIVE_RPC,'block_api.get_block_range',
        {starting_block_num:cursor+1,count});
      const blocks = result?.blocks;
      if (!Array.isArray(blocks) || blocks.length === 0) throw new Error('Hive returned no blocks');
      const items = readBlocks(blocks,cursor+1);
      await saveBatch(items,cursor+blocks.length);
    }
    lastError = null;
    lastSyncedAt = new Date().toISOString();
  } catch(e) {
    lastError = String(e.message || e).slice(0,240);
    console.error('Indexing failed:',lastError);
  } finally {busy = false;}
}

app.get('/api/health',(req,res) => res.json({
  ok: !lastError && cursor !== null, storage:pool?'postgres':'memory (development only)',
  indexedBlock:cursor, chainHead, blocksBehind:cursor === null ? null : Math.max(0,chainHead-cursor),
  lastSyncedAt,error:lastError,network:'hive-mainnet'
}));
app.get('/api/requests',(req,res) => {
  res.set('Cache-Control','no-store');
  const items = reduceEvents(events);
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : '';
  const account = typeof req.query.account === 'string' ? req.query.account.toLowerCase() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  res.json({
    requests: items.filter(r => (!symbol || r.symbol === symbol) &&
      (!account || r.author === account) && (!status || r.status === status)).slice(0,300),
    total:items.length, open:items.filter(r=>r.status==='open').length,
    indexedBlock:cursor, blocksBehind:cursor === null ? null : Math.max(0,chainHead-cursor),
    warning:pool?null:'No persistent database configured. Index data may be lost on restart.'
  });
});
app.get('/api/tokens', async(req,res) => {
  try {
    if (!tokenCache.data || Date.now() > tokenCache.expires) {
      const found=[];
      for (let offset=0;offset<5000;offset+=1000) {
        const page=await rpc(ENGINE_RPC,'find',{contract:'tokens',table:'tokens',
          query:{delegationEnabled:true},limit:1000,offset});
        if (!Array.isArray(page)) throw new Error('Invalid Hive Engine token response');
        for(const token of page) {
          if (typeof token.symbol === 'string' && token.delegationEnabled === true)
            found.push({symbol:token.symbol,precision:token.precision,
              cooldown:token.undelegationCooldown ?? null});
        }
        if(page.length<1000) break;
      }
      if (!found.length) throw new Error('No delegable tokens returned by RPC');
      tokenCache={data:found.sort((a,b)=>a.symbol.localeCompare(b.symbol)),expires:Date.now()+300_000};
    }
    res.json({tokens:tokenCache.data, updatedAt:new Date().toISOString()});
  } catch(e) {
    console.error('Token API:',e.message);
    res.status(503).json({error:'Hive Engine token information is temporarily unavailable.'});
  }
});
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)),'..','public'), {
  extensions:['html'],maxAge:0
}));

await setup();
app.listen(PORT,()=>console.log(`Lease Engine listening on :${PORT} (${pool?'PostgreSQL':'temporary in-memory indexing'})`));
syncOnce();
setInterval(syncOnce,3_000);
