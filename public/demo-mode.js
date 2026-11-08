/* GitHub Pages visual-only preview: never send or sign a transaction. */
(() => {
  if (location.hostname !== 'faireye-hive.github.io' ||
      !location.pathname.startsWith('/lease_engine')) return;

  window.LEASE_ENGINE_DEMO = true;
  const now=Date.now();
  const days=(count)=>new Date(now+count*86400000).toISOString();
  const demo=(id,symbol,quantity,leaseDays,price,paySymbol,author,note,ago,status='open',interests=[])=>({
    id,symbol,quantity,days:leaseDays,price,paySymbol,note,author,
    createdAt:days(-ago),expiresAt:days(14-ago),status,interests,txId:''
  });
  const requests=[
    demo('00000000-0000-4000-8000-000000000001','LEO','15000.000',30,'28.000','SWAP.HIVE',
      'demo-aurora','Seeking LEO Power for a month-long publishing project.',1,'open',
      [{author:'demo-solar',note:'Interested in discussing terms.',createdAt:days(-0.5),txId:''}]),
    demo('00000000-0000-4000-8000-000000000002','POB','8000.000',14,'12.500','SWAP.HIVE',
      'demo-atlas','Looking for additional delegation for my content curation account.',2),
    demo('00000000-0000-4000-8000-000000000003','VYB','50000.000',60,'10.000','BEE',
      'demo-orbit','Flexible terms. Please reach out if you have available power.',3),
    demo('00000000-0000-4000-8000-000000000004','LEO','2500.000',7,'3.000','SWAP.HIVE',
      'demo-pulsar','Previously requested power. This listing is now closed.',19,'expired'),
    demo('00000000-0000-4000-8000-000000000005','POB','20000.000',30,'22.000','SWAP.HIVE',
      'demo-cloud','Cancelled example request.',5,'cancelled')
  ];
  const tokens=[
    {symbol:'LEO',precision:8,cooldown:null},
    {symbol:'POB',precision:8,cooldown:null},
    {symbol:'VYB',precision:8,cooldown:null}
  ];
  const nativeFetch=window.fetch.bind(window);
  window.fetch=(input,init)=>{
    const url=typeof input==='string'?input:input?.url;
    const path=typeof url==='string' ? new URL(url,location.href).pathname : '';
    let payload;
    if(path==='/api/tokens') payload={tokens,updatedAt:new Date().toISOString()};
    if(path==='/api/requests') payload={requests,total:requests.length,
      open:requests.filter(r=>r.status==='open').length,indexedBlock:null,blocksBehind:null,
      warning:'VISUAL DEMO: all listings, users and token availability shown here are fictional. No real blockchain operations or payments occur on this page.'};
    if(payload) return Promise.resolve(new Response(JSON.stringify(payload),{
      status:200,headers:{'Content-Type':'application/json'}}));
    return nativeFetch(input,init);
  };
  addEventListener('DOMContentLoaded',()=>{
    const banner=document.createElement('div');
    banner.setAttribute('role','note');
    banner.style.cssText='padding:10px 16px;text-align:center;background:#173e43;color:white;font-size:12px;line-height:1.6;font-weight:600';
    banner.textContent='✦ VISUAL PREVIEW — Fictional listings and tokens. Publishing, delegation and payment are disabled.';
    document.querySelector('.topbar')?.after(banner);
  });
})();
