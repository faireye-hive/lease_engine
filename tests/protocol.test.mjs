import test from 'node:test';
import assert from 'node:assert/strict';
import {APP_ID, parseEvent, reduceEvents, validAccount, validQuantity} from '../server/protocol.mjs';
const time = '2026-11-07T12:00:00Z';
const expiry = '2026-11-20T12:00:00Z';
const id = '11111111-1111-4111-8111-111111111111';
const req = {v:1,type:'request',id,symbol:'LEO',quantity:'1000.000',days:30,price:'4.500',
  paySymbol:'SWAP.HIVE',expiresAt:expiry,note:'Looking for LEO power'};
test('application id and quantity validation',()=>{
  assert.equal(APP_ID,'lease.engine');
  assert.ok(validAccount('sm-silva'));
  assert.ok(!validAccount('bad name'));
  assert.ok(validQuantity('5.000')); assert.ok(!validQuantity('1e5')); assert.ok(!validQuantity('-3'));
});
test('rejects malformed or expired requests',()=>{
  assert.equal(parseEvent({...req,quantity:'100<script>'},'tester',time),null);
  assert.equal(parseEvent({...req,expiresAt:'2001-01-01'},'tester',time),null);
  assert.equal(parseEvent(req,'evil user',time),null);
});
test('only originator can cancel and other account can offer once',()=>{
  const parsed = parseEvent(req,'alice',time);
  assert.ok(parsed);
  const cancel = parseEvent({v:1,type:'cancel',id:'22222222-2222-4222-8222-222222222222',requestId:id},'bob',time);
  const offer = parseEvent({v:1,type:'interest',id:'33333333-3333-4333-8333-333333333333',requestId:id,note:'I can delegate'},'bob',time);
  const mk=(actor,payload,n)=>({actor,payload,blockNum:n,eventOrder:0,txId:'abc',time});
  const result=reduceEvents([mk('alice',parsed,1),mk('bob',cancel,2),mk('bob',offer,3),mk('bob',offer,4)],Date.parse(time));
  assert.equal(result[0].status,'open');
  assert.equal(result[0].interests.length,1);
  assert.equal(reduceEvents([...result.length&&[mk('alice',parsed,1),mk('alice',cancel,2)]],Date.parse(time))[0].status,'cancelled');
});
