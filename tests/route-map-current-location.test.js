'use strict';
// Real MapLibre, controlled GPS and fixture APIs. No external hosts/providers.
const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');
const {buildApp}=require('../server/app');
const STOPS=[{id:'a',label:'Museum',lat:55.6,lng:12.99},{id:'b',label:'Park',lat:55.603,lng:13},{id:'c',label:'Cafe',lat:55.606,lng:13.01}];
function day(date){return {days:[{date,experimental_agnostic_route_applied:true,primary_route:{id:'__agnostic_compose__',title:'Fixture day',estimated_km:2,
 main_stops:STOPS,legs:[],map_path_points:[]},alternatives:[]}],live_events:{coverage:'covered',selected_date:date,tonight:[],this_week:[]},
 agnostic_route_output_experiment:{promotion:{promote:true}}};}
let runtime;
async function start(t){
 runtime??=(async()=>{
  const {chromium}=require('playwright-core');let browser;
  for(const options of [process.env.PARRANDA_TEST_CHROMIUM&&{executablePath:process.env.PARRANDA_TEST_CHROMIUM},{},{channel:'chrome'}].filter(Boolean)){
   try{browser=await chromium.launch(options);break;}catch{}
  }
  if(!browser)return null;
  const server=buildApp().listen(0,'127.0.0.1');await once(server,'listening');
  return {browser,server,origin:`http://127.0.0.1:${server.address().port}`};
 })();
 const r=await runtime;if(!r){assert.ok(!process.env.CI,'Chromium required in CI');t.skip('Chromium unavailable');return null;}return r;
}
test.after(async()=>{const r=await runtime;await r?.browser.close();if(r){r.server.closeAllConnections();await new Promise(ok=>r.server.close(ok));}});
async function open(t,width=390){
 const r=await start(t);if(!r)return null;
 const context=await r.browser.newContext({viewport:{width,height:844}});t.after(()=>context.close());
 let composes=0,otherApi=0;
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.origin!==r.origin)return route.abort();
  if(url.pathname==='/api/route-recommendations'){composes++;return route.fulfill({json:day(route.request().postDataJSON().dates[0])});}
  if(url.pathname.startsWith('/api/')){otherApi++;return route.fulfill({status:503,json:{error:'not part of fixture'}});}
  return route.continue();
 });
 await context.addInitScript(()=>{
  const calls=[],clears=[];
  window.__gps={calls,clears,fix(lat,lng,accuracy=10,index=calls.length-1){calls[index].ok({coords:{latitude:lat,longitude:lng,accuracy},timestamp:Date.now()});}};
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(ok,error){calls.push({ok,error});return calls.length;},clearWatch(id){clears.push(id);}}});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
 await page.goto(r.origin+'/anywhere?place=Testville&lang=en');
 await page.locator('.route-map-marker-shell').first().waitFor();
 return {page,counts:()=>({composes,otherApi}),errors};
}
const markers=page=>page.locator('.route-map-target').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y};}));
const point=page=>page.locator('[data-current-position]');
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
for(const width of [320,390])test(`current map position shares one opt-in session and camera moves only on explicit centre (${width}px)`,async t=>{
 const h=await open(t,width);if(!h)return;const {page}=h;
 assert.equal(await page.evaluate(()=>window.__gps.calls.length),0);
 const locate=page.getByRole('button',{name:'Show my location',exact:true});
 assert.equal(await locate.count(),1,'the map offers an explicit location action');
 const saved=await page.evaluate(()=>localStorage.getItem('parranda:anywhere:last'));
 assert.ok(saved,'an actual accepted day was stored');
 const links=await page.locator('a[href*="google.com/maps/dir"]').evaluateAll(es=>es.map(e=>e.href));
 if(width===390)await page.getByRole('button',{name:'Follow the day',exact:true}).click();
 else await locate.click();
 await page.evaluate(()=>window.__gps.fix(55.599,12.987));
 await point(page).waitFor();await settle(page);
 assert.equal(await page.evaluate(()=>window.__gps.calls.length),1);
 if(width===320){
  assert.equal(await page.getByRole('button',{name:'Stop following',exact:true}).count(),0,'map orientation must not enable progress');
  await page.getByRole('button',{name:'Follow the day',exact:true}).click();
 }else await page.getByRole('button',{name:'Center on my location',exact:true}).click();
 await page.getByRole('button',{name:'Stop following',exact:true}).waitFor();
 await page.getByRole('button',{name:'Stop following',exact:true}).click();
 await page.getByRole('button',{name:'Follow the day',exact:true}).waitFor();
 assert.equal(await point(page).count(),1,'stopping progress preserves explicitly requested map location');
 assert.equal(await page.evaluate(()=>window.__gps.calls.length),1,'Follow shares the map watch');
 const before=await markers(page);
 await page.evaluate(()=>window.__gps.fix(55.6002,12.988));
 // Marker propagation/layout uses one animation frame; wait for its accessible value.
 await settle(page);
 const after=await markers(page);
 before.forEach((p,i)=>{assert.ok(Math.abs(p.x-after[i].x)<1,'GPS must not move camera');assert.ok(Math.abs(p.y-after[i].y)<1);});
 const accuracyBefore=await page.locator('.route-map-position-accuracy').evaluate(e=>parseFloat(e.style.width));
 await page.evaluate(()=>window.__gps.fix(55.6002,12.988,50));await settle(page);
 const accuracyAfter=await page.locator('.route-map-position-accuracy').evaluate(e=>parseFloat(e.style.width));
 assert.ok(accuracyAfter/accuracyBefore>4.9&&accuracyAfter/accuracyBefore<5.1,'the radius represents reported accuracy');
 await page.getByRole('button',{name:'Center on my location',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__gps.calls.length),1,'recentering must not create a second watch');
 await page.getByRole('button',{name:'Show route',exact:true}).click();
 await settle(page);
 const frame=await page.locator('[data-route-map]').boundingBox();
 const boxes=await page.locator('.route-map-marker-shell').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};}));
 for(const b of boxes){assert.ok(b.x>frame.x&&b.x<frame.x+frame.width);assert.ok(b.y>frame.y&&b.y<frame.y+frame.height);}
 await page.getByRole('button',{name:'Stop location',exact:true}).click();
 await point(page).waitFor({state:'detached'});assert.deepEqual(await page.evaluate(()=>window.__gps.clears),[1]);
 assert.equal(await page.evaluate(()=>localStorage.getItem('parranda:anywhere:last')),saved);
 assert.deepEqual(await page.locator('a[href*="google.com/maps/dir"]').evaluateAll(es=>es.map(e=>e.href)),links);
 assert.deepEqual(h.counts(),{composes:1,otherApi:0});assert.deepEqual(h.errors,[]);
});

test('future-day map orientation does not claim today progress or restart on a date change',async t=>{
 const h=await open(t);if(!h)return;const {page}=h;
 const locate=page.getByRole('button',{name:'Show my location',exact:true});assert.equal(await locate.count(),1);
 await page.getByRole('button',{name:'Adjust',exact:true}).click();await page.getByRole('button',{name:'Tomorrow',exact:true}).click();
 await page.getByText('Tomorrow',{exact:true}).first().waitFor();
 await locate.click();await page.evaluate(()=>window.__gps.fix(55.6,12.99));await point(page).waitFor();
 assert.equal(await page.getByRole('button',{name:'Follow the day',exact:true}).count(),0);
 assert.equal(await page.getByText("You're at Museum",{exact:true}).count(),0);
 await page.getByRole('button',{name:'Today',exact:true}).click();await point(page).waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>window.__gps.calls.length),1);assert.deepEqual(await page.evaluate(()=>window.__gps.clears),[1]);
});

test('a GPS point at a stop remains visible without hiding its number',async t=>{
 const h=await open(t);if(!h)return;const {page}=h;
 await page.getByRole('button',{name:'Show my location',exact:true}).click();
 await page.evaluate(()=>window.__gps.fix(55.6,12.99));await point(page).waitFor();await settle(page);
 const dot=await point(page).boundingBox();
 const pins=await page.locator('.route-map-marker-shell').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();const disc=e.querySelector('.route-map-marker');
  return {x:b.x+b.width/2,y:b.y+b.height/2,width:parseFloat(getComputedStyle(disc,'::before').width),z:Number(getComputedStyle(e).zIndex)};}));
 const dotZ=await point(page).evaluate(e=>Number(getComputedStyle(e).zIndex));
 for(const pin of pins){
  const distance=Math.hypot(pin.x-dot.x-dot.width/2,pin.y-dot.y-dot.height/2);
  assert.ok(distance+dot.width/2>pin.width/2+1,'the position indicator must extend outside a coincident stop');
  assert.ok(dotZ<pin.z,'stop numbers must remain legible above the position indicator');
 }
 await page.locator('.route-map-marker-shell .route-map-marker').first().click();
 await page.locator('section[aria-label="The route"] button[aria-expanded="true"]').waitFor();
});
