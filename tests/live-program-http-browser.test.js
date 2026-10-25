'use strict';
// Built UI -> actual HTTP -> actual bounded providers/collector/normalizer.
// Only source transport, place rows/resolver, weather and clock are controlled.
// This is not external-provider or deployed-runtime acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {once}=require('node:events');
const {chromium}=require('playwright-core');
const {buildApp}=require('../server/app');
const {collectAnchorEvents,resolveDefaultEventSupply,HELSINKI_LINKED_EVENTS_FEED}=require('../server/place-candidates/agnostic-event-supply');
const {rows}=require('./helpers/day-composition-fixtures');
const DATE='2026-10-22',NOW='2026-10-21T08:00:00Z',ANCHOR={lat:60.17,lng:24.94};
function booking(id,title,start,end,url){return {id,name:title,url,dates:{start:{dateTime:start},end:{dateTime:end},timezone:'Europe/Helsinki',status:{code:'onsale'}},classifications:[{segment:{name:'Arts & Theatre'}}],_embedded:{venues:[{name:'Published venue',location:{latitude:'60.171',longitude:'24.941'}}]}};}

test('built Live groups forty bookings, preserves local supply and reaches later-page future events without composing again',{timeout:45000},async t=>{
 const sourceCalls=[],composePosts=[],errors=[],liveResponses=[];let release;const gate=new Promise(resolve=>release=resolve);
 const slots=Array.from({length:40},(_,i)=>{const start=Date.parse(DATE+'T08:00:00Z')+i*3*60000;return booking('slot-'+i,'Published exhibition programme',new Date(start).toISOString(),new Date(start+3*60000).toISOString(),'https://tickets.example/programme/exhibition');});
 const later=[booking('next-a','Next-day concert','2026-10-23T18:00:00Z','2026-10-23T20:00:00Z','https://tickets.example/programme/a'),booking('next-b','Another future concert','2026-10-24T18:00:00Z','2026-10-24T20:00:00Z','https://tickets.example/programme/b')];
 const local={id:'local-concert',name:{en:'Municipal concert'},start_time:DATE+'T18:00:00Z',end_time:DATE+'T20:00:00Z',location:{name:{en:'Local stage'},position:{coordinates:[24.942,60.172]}},info_url:{en:'https://municipality.example/concert'},keywords:[{name:{en:'Music'}}]};
 const supply=resolveDefaultEventSupply({PARRANDA_AGNOSTIC_EVENTS:'enabled',PARRANDA_EVENT_FEEDS:JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]),PARRANDA_TICKETMASTER_KEY:'fixture-only',PARRANDA_REQUEST_TIME_EVENT_DISCOVERY:'disabled',PARRANDA_EVENT_READER:'disabled'},{requestTimeDiscovery:null,eventReader:null,collectEvents:opts=>collectAnchorEvents({...opts,fetcher:async input=>{
  const url=new URL(String(input));await gate;
  sourceCalls.push({host:url.hostname,page:url.searchParams.get('page')});
  if(url.hostname==='api.hel.fi')return {ok:true,json:async()=>({data:[local]})};
  assert.equal(url.hostname,'app.ticketmaster.com');const n=Number(url.searchParams.get('page'));
  assert.ok(n===0||n===1,'only the two advertised pages are requested');
  return {ok:true,json:async()=>({_embedded:{events:n===0?slots:later},page:{number:n,size:40,totalElements:42,totalPages:2}})};
 }})});
 const records=rows('culture','museum',7).map(row=>({...row,lat:row.lat+4.57,lng:row.lng+11.94}));
 const server=buildApp({eventSupply:supply,placeSuggestions:null,openDataLoader:async()=>records,sourceCatalog:null,reviewedPlaceSource:null,
  placeResolver:async()=>[{...ANCHOR,label:'Fixture area',confidence:'high',provenance:{provider:'controlled-resolver'}}],clock:{now:()=>NOW},
  weatherProvider:async()=>({condition:'sun',timezone_resolution:{timezone:'Europe/Helsinki',timezone_source:'weather_provider_auto'}}),
 }).listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{release();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.PARRANDA_TEST_CHROMIUM?{executablePath:process.env.PARRANDA_TEST_CHROMIUM}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1100,height:900},timezoneId:'Europe/Helsinki'});
 await context.route(url=>url.origin!==origin,route=>route.abort());
 await context.addInitScript(epoch=>{const NativeDate=window.Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[epoch]));}static now(){return epoch;}}},Date.parse(NOW));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname==='/api/route-recommendations')composePosts.push(r.postDataJSON());});
 page.on('response',async r=>{if(!['/api/live-events','/api/planner-live-completion'].includes(new URL(r.url()).pathname))return;try{const b=await r.json();if(b.live_events?.pending!==true&&b.live_events)liveResponses.push(b.live_events);}catch{}});
 await page.goto(origin+'/anywhere?place=Fixture%20area&prefs=culture&day=1&rhythm=full&lang=en');
 await page.getByRole('button',{name:'Explore live',exact:true}).waitFor();await page.getByRole('button',{name:'Explore live',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'Live events',exact:true});assert.equal(await sheet.count(),1,'Live opens before source completion');
 // The day's own Live answer can land after the sheet's first rows: a terminal
 // completion, then the route upgrade it authorizes. An applied upgrade is a
 // new day, so the open sheet refreshes and hides its rows meanwhile (CI read
 // no programme there). Assert once that answer and the refresh are complete.
 const pathOf=r=>new URL(r.url()).pathname;let upgradeAnswered=false;
 page.on('response',r=>{if(pathOf(r)==='/api/planner-live-route-upgrade')upgradeAnswered=true;});
 const refresh=new Promise(resolve=>page.on('request',q=>{if(upgradeAnswered&&pathOf(q)==='/api/live-events')resolve(q);}));
 const terminal=page.waitForResponse(r=>pathOf(r)==='/api/planner-live-completion'&&r.status()===200,{timeout:15000});
 const upgrade=page.waitForResponse(r=>pathOf(r)==='/api/planner-live-route-upgrade',{timeout:15000});upgrade.catch(()=>{});
 release();
 if((await(await terminal).json()).live_completion?.route_upgrade==='explicit_request'&&
  (await(await upgrade).json()).live_route_upgrade?.state==='applied')await(await refresh).response();
 await sheet.locator('[aria-busy="true"]').first().waitFor({state:'detached'});
 await sheet.getByText('Published exhibition programme',{exact:true}).waitFor({timeout:15000});
 assert.equal(await sheet.getByText('Published exhibition programme',{exact:true}).count(),1);
 const program=sheet.locator('li').filter({has:page.getByText('Published exhibition programme',{exact:true})}).first();
 assert.match(await program.locator('summary').innerText(),/^40 occurrences$/);await program.locator('summary').click();
 assert.equal(await program.locator('details li').count(),40);assert.equal(await program.getByRole('button',{name:'Plan with this event',exact:true}).count(),0,'morning bookings do not gain evening eligibility by grouping');
 const accepted=liveResponses.find(x=>x.tonight?.some(e=>e.display_group_kind==='source_program'));
 assert.ok(accepted);const group=accepted.tonight.find(x=>x.title==='Published exhibition programme');
 assert.equal(group.occurrences.length,40);assert.deepEqual(group.occurrences.map(x=>x.source_occurrence_id),slots.map(x=>x.id));
 assert.ok(accepted.tonight.some(x=>x.source_label==='Helsinki Region Linked Events'),'the answering local source remains published beside the global programme');
 const before=composePosts.length;await sheet.getByRole('button',{name:'By time',exact:true}).click();
 assert.equal(await sheet.getByText('Published exhibition programme',{exact:true}).count(),1);
 const evidenceDir=process.env.PARRANDA_LIVE_PROGRAM_EVIDENCE_DIR;
 if(evidenceDir){fs.mkdirSync(evidenceDir,{recursive:true});await page.screenshot({path:path.join(evidenceDir,'program-dates-desktop.png'),fullPage:true});}
 const weekReady=page.waitForResponse(async r=>{if(new URL(r.url()).pathname!=='/api/live-events')return false;try{const b=await r.json();return b.query?.time==='this_week'&&b.live_events?.pending!==true;}catch{return false;}},{timeout:15000});
 await sheet.getByRole('button',{name:'Next 7 days',exact:true}).click();const week=(await(await weekReady).json()).live_events;
 await sheet.getByText('Next-day concert',{exact:true}).waitFor();assert.equal(week.this_week.some(x=>x.id==='tm-next-a'),true);
 assert.equal(await sheet.getByText('Another future concert',{exact:true}).count(),1);
 assert.equal(composePosts.length,before,'Live period/sort browsing cannot create another day request');
 if(evidenceDir){await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(evidenceDir,'future-programs-mobile.png')});const hit=await page.evaluate(()=>{const dialog=document.querySelector('[role=dialog]'),r=dialog.getBoundingClientRect();return [...document.querySelectorAll('.maplibregl-marker')].map(marker=>{const m=marker.getBoundingClientRect(),x=m.x+m.width/2,y=m.y+m.height/2;return {inside:x>r.x&&x<r.right&&y>r.y&&y<r.bottom&&x>0&&y>0&&x<innerWidth&&y<innerHeight,covered:!!document.elementFromPoint(x,y)?.closest('[role=dialog]')};}).filter(x=>x.inside);});assert.ok(hit.every(x=>x.covered),'the Live sheet remains above map markers');fs.writeFileSync(path.join(evidenceDir,'receipt.json'),JSON.stringify({boundary:'built UI -> real HTTP -> real provider/collector/normalizer; controlled external source responses/place/resolver/weather/clock; isolated in-memory cache',node:process.version,platform:process.platform,arch:process.arch,sourceCalls,bookings:group.occurrences.map(x=>({id:x.id,source_occurrence_id:x.source_occurrence_id,start:x.starts_at})),local_source_present:true,week:week.this_week.map(x=>({id:x.id,title:x.title})),compose_posts:composePosts.length,errors},null,2));}
 assert.deepEqual(errors,[]);t.diagnostic(JSON.stringify({real_http:true,booking_slots:40,program_cards:1,local_source:true,future_page:true,source_calls:sourceCalls.length,compose_posts:composePosts.length}));
});
