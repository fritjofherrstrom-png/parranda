const {createRequire}=require('node:module');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const waitForHydration=process.argv.includes('--wait-for-hydration');
const {once}=require('node:events');
const requireRepo=createRequire(require('node:path').resolve(process.env.PARRANDA_REPO || process.cwd(), 'package.json'));
const {chromium}=requireRepo('playwright-core');
const {buildApp}=requireRepo('./server/app');
(async()=>{
 let release; const gate=new Promise(r=>release=r);
 const server=buildApp({openDataLoader:null,eventSupply:null,sourceCatalog:null,reviewedPlaceSource:null,placeSuggestions:null,placeResolver:null,weatherProvider:async()=>null}).listen(0,'127.0.0.1');
 await once(server,'listening');
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  const context=await browser.newContext(); const page=await context.newPage(); const events=[];
  let held=0;
  await context.route(url=>url.origin!==origin,route=>route.abort());
  await context.route('**/_astro/LandingHero.*.js',async route=>{held++; await gate; await route.continue();});
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())events.push({navigation:frame.url()});});
  page.on('pageerror',e=>events.push({error:e.message}));
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))events.push({api:new URL(r.url()).pathname});});
  await page.goto(origin+'/?lang=en');
  const state=async()=>page.evaluate(()=>({url:location.href,ready:document.readyState,ssr:document.querySelector('[role=combobox]')?.closest('astro-island')?.hasAttribute('ssr'),value:document.querySelector('[role=combobox]')?.value}));
  const before=await state();
  assert.equal(before.ssr,true,'the controlled landing module is still withheld');
  if(waitForHydration){
   release();
   await page.waitForFunction(()=>document.querySelector('[role=combobox]')?.closest('astro-island')?.hasAttribute('ssr')===false);
  }
  await page.getByRole('combobox').fill('Fixture Area');
  const filled=await state();
  await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Build my day',exact:true}).click()]);
  const after=await state();
  const receipt={controlled:'Only the landing JavaScript module is held. Product API responses are not intercepted.',waitForHydration,before,filled,after,held,events};
  console.log(JSON.stringify(receipt,null,2));
  assert.equal(new URL(after.url).pathname,'/anywhere','a single free-text submit must reach the planner');
  assert.equal(new URL(after.url).searchParams.get('place'),'Fixture Area');
 }finally{release();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
