'use strict';
// Real built browser -> real HTTP/handlers/composition; controlled external
// provider seams and clock. No product API response is replaced by a route.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');
const DATE = '2026-10-27', NOW = '2026-10-27T01:20:00Z', LAST = 'parranda:anywhere:last';
const current = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), LAST);
const ids = entry => entry.safeResponse.days[0].primary_route.main_stops.map(s => s.id);
async function waitStops(page, count) {
  await page.waitForFunction(({key,count}) => JSON.parse(localStorage.getItem(key)||'null')?.safeResponse?.days?.[0]?.primary_route?.main_stops?.length === count, {key:LAST,count});
  await page.locator('ol[aria-label="The stops, in order"] > li > button').nth(count-1).waitFor();
}
test('built HTTP catalog day supports Remove/Replace/Undo, exact reload and explicit Save/Restore', {timeout:90000}, async t => {
  const { assertExactNavigation } = await import('../frontend/tests/helpers/exact-navigation-observation.mjs');
  const resolver = createNominatimPlaceResolver({fetcher:async()=>({ok:true,status:200,json:async()=>[{
    display_name:'Rome, Italy',name:'Rome',lat:'41.8933203',lon:'12.4829321',importance:0.55,
    osm_type:'relation',osm_id:41485,place_rank:16,class:'place',type:'city',address:{city:'Rome',country:'Italy'},
  }]})});
  const app = buildApp({openDataLoader:async()=>[],sourceCatalog:null,reviewedPlaceSource:null,placeResolver:resolver,
    eventSupply:null,placeSuggestions:null,
    weatherProvider:async()=>({condition:'sun',maxTemp:18,timezone_resolution:{timezone:'Europe/Rome',timezone_source:'weather_provider_auto',utc_offset_seconds:3600}}),
    clock:Object.assign(()=>new Date(NOW),{now:()=>NOW})});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const browser=await chromium.launch({headless:true,...(process.env.PARRANDA_TEST_CHROMIUM?{executablePath:process.env.PARRANDA_TEST_CHROMIUM}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'en-GB',timezoneId:'Europe/Rome'});
  const origin=`http://127.0.0.1:${server.address().port}`;
  await context.route(url=>url.origin!==origin,route=>route.abort());
  await context.addInitScript(epoch=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[epoch]));}static now(){return epoch;}}},Date.parse(NOW));
  const page=await context.newPage(),requests=[],errors=[];
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/route-recommendations')requests.push(r.postDataJSON());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/anywhere?place=Roma&prefs=culture&lang=en`);
  await waitStops(page,5);const original=await current(page),originalIds=ids(original);
  const list=page.locator('ol[aria-label="The stops, in order"]');
  await list.locator(':scope > li > button').first().click();
  await page.getByRole('button',{name:'Remove',exact:true}).click();
  await waitStops(page,4);assert.deepEqual(ids(await current(page)),originalIds.slice(1));
  let before=requests.length;await page.getByRole('button',{name:'Undo this change',exact:true}).click();
  await waitStops(page,5);assert.deepEqual(await current(page),original);assert.equal(requests.length,before);
  await list.locator(':scope > li > button').first().click();
  await page.getByRole('button',{name:'Replace',exact:true}).click();
  await page.waitForFunction(({key,removed})=>{const e=JSON.parse(localStorage.getItem(key)||'null');const s=e?.safeResponse?.days?.[0]?.primary_route?.main_stops;return s?.length===5&&!s.some(x=>x.id===removed);},{key:LAST,removed:originalIds[0]});
  assert.deepEqual(ids(await current(page)).filter(id=>originalIds.includes(id)),originalIds.slice(1));
  before=requests.length;await page.getByRole('button',{name:'Undo this change',exact:true}).click();
  await waitStops(page,5);assert.deepEqual(await current(page),original);assert.equal(requests.length,before);
  await list.locator(':scope > li > button').first().click();
  await page.getByRole('button',{name:'Remove',exact:true}).click();await waitStops(page,4);
  const removed=await current(page);await page.getByRole('button',{name:'Save this day',exact:true}).click();
  await assertExactNavigation({page,navigate:()=>page.reload(),expectedEntry:removed,readComposeCount:()=>requests.length});
  await page.getByRole('button',{name:'Adjust',exact:true}).click();
  await page.getByRole('button',{name:'Tomorrow',exact:true}).click();
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.dateIso==='2026-10-28',LAST);
  const savedSection=page.locator('section').filter({has:page.getByText('Saved days',{exact:true})});
  before=requests.length;await savedSection.getByRole('button').first().click();
  await page.waitForFunction(() => {
    const record=JSON.parse(sessionStorage.getItem('parranda:anywhere:navigation:v1')||'null')?.records
      ?.find(r=>r.reference===history.state?.parrandaDayView?.reference);
    return record?.entry?.dateIso==='2026-10-27' && record.entry.safeResponse?.days?.[0]?.primary_route?.main_stops?.length===4 &&
      document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button').length===4;
  });
  const restored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('parranda:anywhere:navigation:v1')).records
    .find(r=>r.reference===history.state.parrandaDayView.reference).entry);
  assert.equal(restored.dateIso,DATE);
  const expected=structuredClone(removed.safeResponse);
  for(const key of ['live_completion','live_route_upgrade','planner_lifecycle'])delete expected[key];
  assert.deepEqual(restored.safeResponse,expected);
  assert.deepEqual(restored.inputs.dayEdit,removed.inputs.dayEdit);assert.equal(requests.length,before,'explicit restore must not compose');
  assert.deepEqual(errors,[]);
});
