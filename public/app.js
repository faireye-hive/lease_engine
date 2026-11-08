const APP_ID = 'lease.engine';
const $ = selector => document.querySelector(selector);
const state = {account:localStorage.getItem('lease-engine-account') || '',tokens:[],
  requests:[], tokenError:false, selectedRequest:null, refreshing:false};
const ACCOUNT = /^[a-z][a-z0-9.-]{2,15}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?$/;
let toastTimeout;

function el(tag,className='',value) {
  const item=document.createElement(tag);
  if (className) item.className=className;
  if (value !== undefined) item.textContent=String(value);
  return item;
}
function setText(selector,value) {$(selector).textContent=String(value);}
function toast(message) {
  const node=$('#toast'); node.textContent=message; node.classList.add('visible');
  clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>node.classList.remove('visible'),5000);
}
function showAlert(message) {const node=$('#alert');node.textContent=message;node.hidden=!message;}
function validAccount(value) {return ACCOUNT.test(value)&&!value.includes('..')&&!value.endsWith('.');}
function validAmount(value) {return DECIMAL.test(value)&&Number(value)>0;}
function quantity(value,precision=8) {
  const trimmed=String(value||'').trim();
  if(!validAmount(trimmed)||trimmed.split('.')[1]?.length>precision) throw Error('Enter a positive amount with no more than '+precision+' decimals.');
  return trimmed;
}
function requireAccount() {
  if (state.account) return true;
  $('#account-dialog').showModal(); $('#account-name').focus();
  toast('Select a Hive account first.');
  return false;
}
function keychain(payload,label) {
  return new Promise((resolve,reject)=>{
    const extension=window.hive_keychain;
    if (!extension?.requestCustomJson) return reject(Error('Hive Keychain was not detected. Install or enable the browser extension.'));
    extension.requestCustomJson(state.account,APP_ID,'Posting',JSON.stringify(payload),label,
      response=>{
        if(response?.success) resolve(response);
        else reject(Error(response?.message || response?.error || 'Hive Keychain transaction was rejected.'));
      });
  });
}
function dateShort(value) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'Unknown':date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function compactNumber(value) {
  const n=Number(value);
  if(!Number.isFinite(n))return String(value);
  return new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(n);
}
function disableSubmit(button,disabled,label) {
  button.disabled=disabled;
  button.textContent=disabled?'Waiting for Hive Keychain…':label;
}
function safeHref(txId) {
  return /^[0-9a-f]{40}$/i.test(txId)?'https://hiveblocks.com/tx/'+txId:null;
}

async function fetchJSON(url) {
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok) throw Error('Server returned HTTP '+response.status);
  return response.json();
}
async function loadTokens() {
  try {
    const data=await fetchJSON('/api/tokens');
    state.tokens=Array.isArray(data.tokens)?data.tokens:[];
    state.tokenError=false;
    setText('#stat-tokens',state.tokens.length);
    for(const selector of ['#token-filter','#request-token']) {
      const node=$(selector);const original=node.value;node.replaceChildren();
      const defaultOption=el('option','',selector==='#token-filter'?'All delegable tokens':'Select token');
      defaultOption.value='';node.append(defaultOption);
      state.tokens.forEach(item=>{
        const option=el('option','',item.symbol);
        option.value=item.symbol;node.append(option);
      });
      node.value=original;
    }
    $('#request-token').disabled=state.tokens.length===0;
    $('#request-submit').disabled=state.tokens.length===0;
    updateCooldown();
  } catch(e) {
    state.tokenError=true;
    setText('#stat-tokens','—');
    const select=$('#request-token');
    select.replaceChildren(el('option','','Unavailable — retry later'));
    select.disabled=true;$('#request-submit').disabled=true;
    toast('Hive Engine token registry is unavailable. Creating requests is paused.');
  }
}
async function loadRequests() {
  if(state.refreshing) return;
  state.refreshing=true; $('#refresh').disabled=true;
  try {
    const data=await fetchJSON('/api/requests');
    state.requests=Array.isArray(data.requests)?data.requests:[];
    setText('#stat-total',data.total??state.requests.length);
    setText('#stat-open',data.open??0);
    setText('#count-badge',data.open??0);
    const lag=data.blocksBehind;
    setText('#stat-sync',lag===null?'Starting index…':lag>10?'Syncing · '+lag+' blocks':'Up to date');
    if (data.warning) showAlert(data.warning);
    else if(lag===null || lag>200) showAlert('The Hive indexer is catching up. Recent requests may appear after confirmation.');
    else showAlert('');
    renderRequests();
  } catch(e) {
    showAlert('Could not load requests from the indexer. '+e.message);
    setText('#stat-sync','Unavailable');
    $('#cards').replaceChildren(emptyCard('Could not load listings','Please check the indexer and refresh.'));
  } finally {state.refreshing=false;$('#refresh').disabled=false;}
}
function emptyCard(title,description) {
  const box=el('div','empty');
  box.append(el('span','','◌'),el('h3','',title),el('p','',description));
  return box;
}
function metric(label,value,unit='') {
  const box=el('div','card-metric');
  box.append(el('small','',label));
  const strong=el('strong','',value);
  if(unit) strong.append(el('span','',' '+unit));
  box.append(strong);return box;
}
function authorNode(r) {
  const node=el('div','author');
  node.append(el('div','avatar',r.author.slice(0,1).toUpperCase()));
  const meta=el('div','author-meta');
  meta.append(el('span','', '@'+r.author),el('small','',dateShort(r.createdAt)));
  node.append(meta);return node;
}
function actionButton(text,cls,callback) {
  const b=el('button','card-action '+cls,text);b.type='button';b.addEventListener('click',callback);return b;
}
function renderCard(r,index) {
  const card=el('article','lease-card');
  const top=el('div','card-top');const heading=el('div','token-heading');
  const icon=el('div','token-avatar alt'+index%4,r.symbol.slice(0,4));
  const name=el('div');
  name.append(el('h3','',r.symbol+' Power'),el('small','','Delegation request'));
  heading.append(icon,name);
  const status=el('div','status-pill '+(r.status==='open'?'':r.status),r.status==='open'?'● Open':r.status==='cancelled'?'Cancelled':'Expired');
  top.append(heading,status);card.append(top);
  const content=el('div','card-content');
  content.append(metric('POWER REQUESTED',compactNumber(r.quantity),r.symbol),
    metric('LEASE DURATION',r.days,'days'),metric('TOTAL OFFERED',compactNumber(r.price),r.paySymbol));
  card.append(content);
  if(r.note) card.append(el('div','card-note',r.note));
  const bottom=el('div','card-bottom');bottom.append(authorNode(r));
  const actions=el('div','card-actions');
  const interestCount=Array.isArray(r.interests)?r.interests.length:0;
  if (interestCount) {
    const number=el('span','',interestCount+' interested');
    number.style.fontSize='10px';number.style.color='#8b9ba6';number.style.alignSelf='center';
    actions.append(number);
  }
  if (r.status==='open' && r.author===state.account) {
    actions.append(actionButton('Cancel request','secondary',()=>cancelRequest(r)));
  } else if (r.status==='open') {
    const hasInterest=Array.isArray(r.interests)&&r.interests.some(i=>i.author===state.account);
    const b=actionButton(hasInterest?'Interest sent ✓':'I can delegate →','',()=>openInterest(r));
    b.disabled=hasInterest;actions.append(b);
  }
  const href=safeHref(r.txId);
  if (href) {
    const link=el('a','card-action secondary','Hive ↗');
    link.href=href;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
  }
  bottom.append(actions);card.append(bottom);
  if(interestCount && r.author===state.account) {
    const details=el('details','interest-details');
    details.style.marginTop='14px';
    const summary=el('summary','','View '+interestCount+' interested account'+(interestCount>1?'s':''));
    summary.style.cursor='pointer';summary.style.color='#158877';summary.style.fontSize='12px';
    details.append(summary);
    r.interests.forEach(i=>{
      const row=el('div','card-note');
      row.style.margin='9px 0 0'; row.textContent='@'+i.author+': '+i.note;
      details.append(row);
    });
    card.append(details);
  }
  return card;
}
function renderRequests() {
  const token=$('#token-filter').value, status=$('#status-filter').value;
  const mine=$('#my-filter').checked, sort=$('#sort-filter').value;
  const filtered=state.requests.filter(item=>(!token||item.symbol===token)&&
    (!status||item.status===status)&&(!mine||item.author===state.account));
  if(sort==='oldest') filtered.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  else if(sort==='amount') filtered.sort((a,b)=>Number(b.quantity)-Number(a.quantity));
  else filtered.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  setText('#result-label',filtered.length+' result'+(filtered.length===1?'':'s'));
  const cards=$('#cards');cards.replaceChildren();
  if(!filtered.length) {
    const empty=emptyCard(state.requests.length?'No matching requests':'No lease requests yet',
      state.requests.length?'Try clearing some filters to see more listings.':'Be the first to post a signed lease request on Hive.');
    if(!state.requests.length) {
      const button=el('button','button button-primary','＋ Post the first request');
      button.addEventListener('click',openRequest);empty.append(button);
    }
    cards.append(empty);return;
  }
  filtered.forEach((item,index)=>cards.append(renderCard(item,index)));
}

function openRequest() {
  if(!requireAccount())return;
  $('#request-dialog').showModal();
  $('#request-token').focus();
}
function openInterest(item) {
  if(!requireAccount())return;
  state.selectedRequest=item;
  setText('#interest-summary','Offer to delegate '+compactNumber(item.quantity)+' '+item.symbol+
    ' for '+item.days+' days to @'+item.author+'. Total proposed payment: '+item.price+' '+item.paySymbol+'.');
  $('#interest-note').value='';
  $('#interest-dialog').showModal();
}
async function cancelRequest(r) {
  if(!requireAccount() || r.author!==state.account)return;
  if(!confirm('Publish a cancellation for this request? This cannot remove the original blockchain event.'))return;
  const payload={v:1,type:'cancel',id:crypto.randomUUID(),requestId:r.id};
  try {await keychain(payload,'Cancel Lease Engine request');
    toast('Cancellation broadcast. The indexer will update after confirmation.');
    setTimeout(loadRequests,9000);
  }catch(e){toast(e.message);}
}
function updateCooldown() {
  const token=state.tokens.find(t=>t.symbol===$('#request-token').value);
  const cooldown=token?.cooldown;
  setText('#request-cooldown',token
    ? (cooldown==null ? token.symbol+' supports delegation. Verify its undelegation rules before any deal.'
      : token.symbol+' undelegation cooldown: '+cooldown+' day(s). This is separate from lease duration.')
    : 'Only tokens with delegation enabled can be requested.');
}

$('#account-button').addEventListener('click',()=>{
  $('#account-name').value=state.account;
  $('#account-dialog').showModal();
});
$('#account-form').addEventListener('submit',event=>{
  event.preventDefault();
  const account=$('#account-name').value.trim().replace(/^@/,'').toLowerCase();
  if(!validAccount(account)){toast('Enter a valid Hive username.');return;}
  state.account=account;localStorage.setItem('lease-engine-account',account);
  setText('#account-button','◎ @'+account);
  $('#account-dialog').close();
  renderRequests();toast('Account selected. Hive Keychain will request authorization when needed.');
});
$('#hero-create').addEventListener('click',openRequest);
$('#section-create').addEventListener('click',openRequest);
$('#request-token').addEventListener('change',updateCooldown);
$('#request-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!requireAccount())return;
  if(!state.tokens.length){toast('Token registry is unavailable.');return;}
  const symbol=$('#request-token').value, token=state.tokens.find(t=>t.symbol===symbol);
  if(!token){toast('Choose a token with delegation enabled.');return;}
  let amount,price;
  try {amount=quantity($('#request-amount').value,Number.isInteger(token.precision)?token.precision:8);
       price=quantity($('#request-price').value,8);}
  catch(e){toast(e.message);return;}
  const payload={v:1,type:'request',id:crypto.randomUUID(),symbol,
    quantity:amount,days:Number($('#request-days').value),price,
    paySymbol:$('#request-pay').value,note:$('#request-note').value.trim(),
    expiresAt:new Date(Date.now()+14*86400_000).toISOString()};
  const button=$('#request-submit');
  disableSubmit(button,true,'Sign & publish request ↗');
  try {
    await keychain(payload,'Publish Lease Engine request');
    $('#request-dialog').close();$('#request-form').reset();updateCooldown();
    toast('Request broadcast! It will appear after irreversible Hive confirmation and indexing.');
    setTimeout(loadRequests,8000);setTimeout(loadRequests,25000);
  }catch(e){toast(e.message);}
  finally{disableSubmit(button,false,'Sign & publish request ↗');}
});
$('#interest-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!requireAccount())return;
  const r=state.selectedRequest;if(!r||r.status!=='open')return;
  if(r.author===state.account){toast('You cannot offer power to your own request.');return;}
  const note=$('#interest-note').value.trim();
  if(!note||note.length>240){toast('Please provide a short message.');return;}
  const button=$('#interest-submit');disableSubmit(button,true,'Sign & publish interest ↗');
  try {
    await keychain({v:1,type:'interest',id:crypto.randomUUID(),requestId:r.id,note},
      'Respond to Lease Engine request');
    $('#interest-dialog').close();
    toast('Interest broadcast. Your message will appear after confirmation.');
    setTimeout(loadRequests,9000);setTimeout(loadRequests,25000);
  }catch(e){toast(e.message);}
  finally{disableSubmit(button,false,'Sign & publish interest ↗');}
});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{
  if(event.target===dialog)dialog.close();
}));
['#token-filter','#status-filter','#sort-filter','#my-filter'].forEach(selector=>
  $(selector).addEventListener('change',renderRequests));
$('#clear-filters').addEventListener('click',()=>{
  $('#token-filter').value='';$('#status-filter').value='open';
  $('#sort-filter').value='newest';$('#my-filter').checked=false;renderRequests();
});
$('#refresh').addEventListener('click',()=>{loadRequests();if(state.tokenError)loadTokens();});
if(state.account) setText('#account-button','◎ @'+state.account);
loadTokens();loadRequests();
setInterval(loadRequests,30_000);
