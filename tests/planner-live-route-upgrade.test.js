"use strict";
const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { buildApp } = require('../server/app');
const { resolveDefaultEventSupply, HELSINKI_LINKED_EVENTS_FEED } = require('../server/place-candidates/agnostic-event-supply');
const { LIVE_COLLECTION_READ, createLiveCompletionStore } = require('../server/planner/live-completion');
const { createRouteUpgrade } = require('../server/planner/live-route-upgrade');
const { externalRecord } = require('./helpers/planner-reservoir-compare');
const NOW = '2026-06-28T12:00:00Z';
const routePath = '/api/route-recommendations?experimental_agnostic_route_output=1&include_external_candidates=1&include_live_completion=1&include_live_route_upgrade=1';
const readPath = '/api/planner-live-completion';
const upgradePath = '/api/planner-live-route-upgrade';
const routeBody = {day_rhythm:'balanced',lat:60.17,lng:24.94,dates:['2026-06-28'],preferences:[],agnostic_engine_compose:true};
function deferred() { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
function post(server,path,body) {
  return new Promise((resolve,reject)=> {
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method:'POST',headers:{'Content-Type':'application/json'}},res=>{
      let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)}));
    });req.on('error',reject);req.end(JSON.stringify(body));
  });
}
const event = {id:'original-generation-concert',title:'Concert',starts_at:'2026-06-28T18:00:00Z',ends_at:'2026-06-28T20:00:00Z',timezone:'Europe/Helsinki',lat:60.173,lng:24.943,route_eligible:true,cultural_tier:'cultural',source_label:'Verified fixture transport',source_url:'https://example.org/concert'};
function collection(events=[event],overrides={}) { return {coverage:'covered',selected_date:'2026-06-28',tonight:events,this_week:[],acquisition:{radius_m:3000,source_health:{status:'healthy',result:events.length?'events_found':'empty',responding_source_count:1}},...overrides}; }
async function setup(t,options={},supplyOptions={}) {
  const work=deferred();let calls=0,loaderCalls=0,weatherCalls=0;
  const records=['restaurant','viewpoint'].flatMap((type,g)=>Array.from({length:6},(_,i)=>externalRecord(`upgrade-${type}-${i}`,`Fixture ${type} ${i}`,type,60.17+g*.002+i*.0003,24.94+i*.0003,[type==='restaurant'?'mat':'utsikt'])));
  const supply=resolveDefaultEventSupply({PARRANDA_AGNOSTIC_EVENTS:'enabled',PARRANDA_EVENT_FEEDS:JSON.stringify([HELSINKI_LINKED_EVENTS_FEED])},{collectEvents:async()=>{calls++;return work.promise;},...supplyOptions});
  const server=buildApp({eventSupply:supply,openDataLoader:async()=>{loaderCalls++;return records;},weatherProvider:async()=>{weatherCalls++;return null;},placeResolver:null,reviewedPlaceSource:null,sourceCatalog:null,clock:{now:()=>NOW},...options}).listen(0);
  t.after(async()=>{work.resolve(collection([]));await new Promise(r=>server.close(r));});
  return {server,work,records,calls:()=>calls,loaderCalls:()=>loaderCalls,weatherCalls:()=>weatherCalls};
}
test('explicit upgrade replays the original engine finalization with a new verified occurrence and no acquisition',async t=>{
  const h=await setup(t);
  const initial=await post(h.server,routePath,routeBody);
  assert.equal(initial.status,200);
  assert.ok(initial.body.days[0].primary_route.main_stops.length>=2,'real published fixture engine day');
  assert.equal(initial.body.agnostic_route_output_experiment.promotion.promote,true);
  const original=JSON.stringify(initial.body.days);
  const loaderCalls=h.loaderCalls(),weatherCalls=h.weatherCalls();
  const token=initial.body.live_completion.token;
  h.work.resolve(collection());await new Promise(r=>setImmediate(r));
  const read=await post(h.server,readPath,{token});
  assert.equal(read.body.days,undefined,'events reads remain read-only');
  assert.equal(read.body.live_completion.route_upgrade,'explicit_request','read reports authorization but never performs it');
  const upgraded=await post(h.server,upgradePath,{token});
  assert.equal(upgraded.status,200,'separate authorized upgrade endpoint');
  assert.equal(upgraded.body.live_route_upgrade.state,'applied');
  assert.equal(upgraded.body.result.days[0].primary_route.main_stops.at(-1).event_id,event.id);
  assert.equal(upgraded.body.result.place_structure.district_day.evening_event.woven_into_route,true);
  assert.equal(upgraded.body.result.agnostic_route_output_experiment.promotion.promote,true);
  assert.equal(upgraded.body.result.days[0].date,routeBody.dates[0]);
  assert.equal(JSON.stringify(initial.body.days),original,'the originally published snapshot is immutable');
  assert.equal(h.loaderCalls(),loaderCalls);assert.equal(h.weatherCalls(),weatherCalls);assert.equal(h.calls(),1);
  assert.deepEqual((await post(h.server,upgradePath,{token})).body,upgraded.body);
});

test('a reserved upgrade expires on the original capability deadline even when finalization never resolves',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let now=0,attempts=0,settled;
  const store=createLiveCompletionStore({now:()=>now});
  const pending={...collection(),pending:true};
  Object.defineProperty(pending,LIVE_COLLECTION_READ,{value:()=>collection()});
  const {token}=store.issue(pending);
  const blocked=deferred();
  store.bindUpgrade(token,async()=>{attempts++;return blocked.promise;});
  const first=store.upgrade(token).then(value=>{settled=value;return value;});
  const duplicate=store.upgrade(token);
  await new Promise(r=>setImmediate(r));
  assert.equal(attempts,1,'reservation occurs before finalization await');
  now=120000;t.mock.timers.tick(120000);
  await new Promise(r=>setImmediate(r));
  assert.equal(settled?.status,410,'expiry must win over a stuck finalization');
  assert.deepEqual(await duplicate,await first);
  blocked.resolve({live_route_upgrade:{state:'applied'},result:{days:[]}});
  await new Promise(r=>setImmediate(r));
  assert.equal((await store.upgrade(token)).status,410,'late composition cannot restore authority');
});

test('retention bounds include original intent, publication and private candidate metadata, not just candidate rows',()=>{
  const published={agnostic_route_output_experiment:{promotion:{promote:true}},days:[]};
  const structure={district_day:{areas:[]}};
  const options={args:{date:'2026-06-28',preferences:[]},retained:{records:[],context:null},structure,initialLive:collection([]),published,publish:async()=>published};
  assert.equal(createRouteUpgrade({...options,args:{...options.args,baselineResult:{large:'x'.repeat(2*1024*1024)}}}),null);
  const records=[];Object.defineProperty(records,Symbol('private-metadata'),{value:'x'.repeat(2*1024*1024)});
  assert.equal(createRouteUpgrade({...options,retained:{records,context:null}}),null);
});

const negatives = [
  ['healthy-empty',collection([])],
  ['failed',collection([event],{acquisition:{source_health:{status:'failed',result:'unavailable',failed_source_count:1}}})],
  ['partial',collection([event],{acquisition:{source_health:{status:'partial',result:'unknown',responding_source_count:1,failed_source_count:1}}})],
  ['uncovered',collection([event],{coverage:'uncovered'})],
  ['future-only',collection([{...event,starts_at:'2026-07-01T18:00:00Z',ends_at:'2026-07-01T20:00:00Z'}])],
  ['noneligible',collection([{...event,route_eligible:false}])],
  ['missing-route-attestation',collection([{...event,route_eligible:undefined}])],
  ['administrative',collection([{...event,cultural_tier:'administrative'}])],
  ['unknown-venue-clock',collection([{...event,timezone:null}])],
  ['invalid-geometry',collection([{...event,lat:null}])],
  ['different-selected-date',collection([event],{selected_date:'2026-06-29'})],
  ['outside-original-preferences',collection([event]),{preferences:['food']}],
];
for (const [name,value,body] of negatives) test(`${name} completion cannot request engine upgrade`,async t=>{
  let walks=0;
  const h=await setup(t,{walkingRouter:async()=>{walks++;throw Error('ineligible completion must not request walking');}});
  const initial=await post(h.server,routePath,{...routeBody,...body});
  assert.equal(initial.body.agnostic_route_output_experiment.promotion.promote,true,'negative still starts from published engine day');
  const loaderCalls=h.loaderCalls(),weatherCalls=h.weatherCalls(),saved=JSON.stringify(initial.body.days);
  h.work.resolve(value);await new Promise(r=>setImmediate(r));
  const token=initial.body.live_completion.token;
  const read=await post(h.server,readPath,{token});assert.equal(read.status,200);assert.equal(read.body.days,undefined);
  const upgrade=await post(h.server,upgradePath,{token});
  assert.equal(upgrade.status,200);assert.equal(upgrade.body.live_route_upgrade.state,'not_eligible');
  assert.equal(upgrade.body.result,undefined);assert.equal(walks,0);
  assert.equal(h.loaderCalls(),loaderCalls);assert.equal(h.weatherCalls(),weatherCalls);assert.equal(h.calls(),1);
  assert.equal(JSON.stringify(initial.body.days),saved);
  assert.deepEqual((await post(h.server,upgradePath,{token})).body,upgrade.body);
});

test('pending polls and non-opted-in completion tokens cannot cause route upgrade',async t=>{
  const h=await setup(t);
  const initial=await post(h.server,routePath,routeBody),token=initial.body.live_completion.token;
  const loaders=h.loaderCalls();
  for(let i=0;i<3;i++)assert.equal((await post(h.server,upgradePath,{token})).status,202);
  const readonly=await post(h.server,routePath.replace('&include_live_route_upgrade=1',''),routeBody);
  assert.equal((await post(h.server,upgradePath,{token:readonly.body.live_completion.token})).status,409);
  assert.equal(h.loaderCalls(),loaders+2,'only the separately requested original day invokes its two loaders');
  h.work.resolve(collection());await new Promise(r=>setImmediate(r));
  assert.equal((await post(h.server,upgradePath,{token})).body.live_route_upgrade.state,'applied');
  assert.equal(h.calls(),1);
});

test('upgrade endpoint rejects public intent, geography, events, stale and cross-app capabilities',async t=>{
  const h=await setup(t),other=await setup(t);
  const initial=await post(h.server,routePath,routeBody),token=initial.body.live_completion.token;
  for(const extra of [{lat:0,lng:0},{dates:['2026-06-29']},{place_ref:'r12345'},{preferences:[]},{live_events:collection()},{upgrade:true}]) {
    const result=await post(h.server,upgradePath,{token,...extra});
    assert.equal(result.status,400);assert.equal(result.body.error,'invalid_live_route_upgrade_request');
  }
  assert.equal((await post(other.server,upgradePath,{token})).status,410);
  for(const invalid of ['fake','a'.repeat(48),null])assert.equal((await post(h.server,upgradePath,{token:invalid})).status,410);
  const realNow=Date.now,issued=realNow();
  try { Date.now=()=>issued+120001;assert.equal((await post(h.server,upgradePath,{token})).status,410); }
  finally {Date.now=realNow;}
  assert.equal(h.calls(),1);assert.equal(other.calls(),0);
});

test('concurrent explicit HTTP upgrades share one reserved finalization and one immutable result',async t=>{
  const {routeWalkingPath}=require('../server/walking-router');
  let walks=0;const started=deferred(),release=deferred();
  const h=await setup(t,{walkingRouter:async points=>{walks++;started.resolve();await release.promise;return routeWalkingPath(points);}});
  t.after(()=>release.resolve());
  const initial=await post(h.server,routePath,routeBody),token=initial.body.live_completion.token;
  h.work.resolve(collection());await new Promise(r=>setImmediate(r));
  const a=post(h.server,upgradePath,{token});await started.promise;
  const b=post(h.server,upgradePath,{token});
  const read=await post(h.server,readPath,{token});assert.equal(read.body.days,undefined);assert.equal(walks,1);
  release.resolve();const results=await Promise.all([a,b]);
  assert.equal(results[0].body.live_route_upgrade.state,'applied');assert.deepEqual(results[1],results[0]);
  assert.deepEqual((await post(h.server,upgradePath,{token})).body,results[0].body);assert.equal(walks,1);
});

test('failed final walking gate is not retried by concurrent or later HTTP requests',async t=>{
  let walks=0;
  const h=await setup(t,{walkingRouter:async()=>{walks++;throw Error('fixture walking failure');}});
  const initial=await post(h.server,routePath,routeBody),token=initial.body.live_completion.token;
  h.work.resolve(collection());await new Promise(r=>setImmediate(r));
  const results=await Promise.all([post(h.server,upgradePath,{token}),post(h.server,upgradePath,{token})]);
  assert.equal(results[0].body.live_route_upgrade.state,'rejected');assert.equal(results[0].body.result,undefined);
  assert.deepEqual(results[1].body,results[0].body);const after=walks;
  assert.ok(after>0,'real final walking gate was reached');
  assert.deepEqual((await post(h.server,upgradePath,{token})).body,results[0].body);assert.equal(walks,after);
  assert.equal(h.calls(),1);
});

test('a thrown reserved attempt returns one stable failure and never retries',async()=>{
  const store=createLiveCompletionStore();let calls=0;
  const pending={...collection(),pending:true};Object.defineProperty(pending,LIVE_COLLECTION_READ,{value:()=>collection()});
  const {token}=store.issue(pending);store.bindUpgrade(token,async()=>{calls++;throw Error('fixture failure');});
  const results=await Promise.all([store.upgrade(token),store.upgrade(token)]);
  assert.equal(results[0].status,503);assert.equal(results[0].body.live_route_upgrade.state,'failed');
  assert.deepEqual(results[1],results[0]);assert.deepEqual(await store.upgrade(token),results[0]);assert.equal(calls,1);
});

test('previously considered selected-day occurrence never requests another finalization',async t=>{
  let walks=0;
  const pending={...collection(),pending:true};Object.defineProperty(pending,LIVE_COLLECTION_READ,{value:()=>collection()});
  const {routeWalkingPath}=require('../server/walking-router');
  const h=await setup(t,{eventSupply:async()=>pending,walkingRouter:async points=>{walks++;return routeWalkingPath(points);}});
  const initial=await post(h.server,routePath,routeBody),token=initial.body.live_completion.token;
  assert.equal(initial.body.days[0].primary_route.main_stops.at(-1).event_id,event.id);
  const before=walks,result=await post(h.server,upgradePath,{token});
  assert.equal(result.body.live_route_upgrade.state,'not_eligible');assert.equal(walks,before);assert.equal(result.body.result,undefined);
});

test('an updated end time on an already considered occurrence is not a new event',async t=>{
  let walks=0;
  const pending={...collection(),pending:true};
  Object.defineProperty(pending,LIVE_COLLECTION_READ,{value:()=>collection([{...event,ends_at:'2026-06-28T21:00:00Z'}])});
  const {routeWalkingPath}=require('../server/walking-router');
  const h=await setup(t,{eventSupply:async()=>pending,walkingRouter:async points=>{walks++;return routeWalkingPath(points);}});
  const initial=await post(h.server,routePath,routeBody),token=initial.body.live_completion.token,before=walks;
  const result=await post(h.server,upgradePath,{token});
  assert.equal(result.body.live_route_upgrade.state,'not_eligible','changed metadata is not a new occurrence');
  assert.equal(walks,before);
});

test('original pins, exclusions, signed reference and trusted time survive source mutations without new lookups',async t=>{
  const {createPlaceSelectionStore}=require('../server/place-candidates/place-selection');
  const selectionStore=createPlaceSelectionStore();let searches=0,lookups=0,time=NOW;
  const candidate={label:'Fixture Harbour',lat:60.17,lng:24.94,confidence:'medium',osm_ref:'relation/12345',osm_class:'place',timezone:'Europe/Helsinki'};
  const receipt=selectionStore.issue(candidate,candidate.label);
  const resolver=async()=>{searches++;return [candidate];};resolver.lookupRef=async()=>{lookups++;return {status:'resolved',candidate};};
  const h=await setup(t,{placeResolver:resolver,placeSelectionStore:selectionStore,clock:{now:()=>time}});
  const {lat,lng,...body}=routeBody;
  const request={...body,day_rhythm:'full',place_ref:'r12345',place_selection:receipt,pinned_candidate_ids:['upgrade-restaurant-0'],excluded_candidate_ids:['upgrade-viewpoint-5']};
  const initial=await post(h.server,routePath,request),token=initial.body.live_completion.token;
  assert.equal(initial.body.agnostic_route_output_experiment.promotion.promote,true);
  assert.equal(initial.body.agnostic_route_output_experiment.pinned_candidates.honored_count,1,'pin was actually published');
  assert.equal(initial.body.agnostic_route_output_experiment.intake.resolved.place_ref,'r12345');
  const before={lookups,searches,loader:h.loaderCalls(),weather:h.weatherCalls()};
  h.records.splice(0);candidate.lat=0;candidate.lng=0;time='2030-01-01T23:00:00Z';
  h.work.resolve(collection());await new Promise(r=>setImmediate(r));
  const upgraded=await post(h.server,upgradePath,{token});
  assert.equal(upgraded.body.live_route_upgrade.state,'applied');
  const result=upgraded.body.result,experiment=result.agnostic_route_output_experiment;
  const ids=result.days[0].primary_route.main_stops.map(stop=>stop.id);
  assert.ok(ids.includes('upgrade-restaurant-0'));assert.ok(!ids.includes('upgrade-viewpoint-5'));
  assert.equal(experiment.pinned_candidates.honored_count,1);
  assert.deepEqual(experiment.intake,initial.body.agnostic_route_output_experiment.intake,'same server-owned signed authority');
  assert.deepEqual(experiment.context,initial.body.agnostic_route_output_experiment.context,'original trusted clock/weather, not current time');
  assert.equal(result.days[0].date,request.dates[0]);
  assert.deepEqual({lookups,searches,loader:h.loaderCalls(),weather:h.weatherCalls()},before);
  assert.equal(h.calls(),1);
});

test('later same-key source refresh cannot replace an original upgrade generation',async t=>{
  const {createSourceCache}=require('../server/place-candidates/source-cache');
  const cache=createSourceCache(),jobs=[];
  const h=await setup(t,{}, {eventCache:cache,collectEvents:async()=>{const work=deferred();jobs.push(work);return work.promise;}});
  t.after(()=>{for(const job of jobs)job.resolve(collection([]));});
  const first=await post(h.server,routePath,routeBody);
  jobs[0].resolve(collection());await new Promise(r=>setImmediate(r));cache.clear();
  const second=await post(h.server,routePath,routeBody);
  jobs[1].resolve(collection([{...event,id:'later-generation'}]));await new Promise(r=>setImmediate(r));
  assert.equal(jobs.length,2);
  const old=await post(h.server,upgradePath,{token:first.body.live_completion.token});
  const fresh=await post(h.server,upgradePath,{token:second.body.live_completion.token});
  assert.equal(old.body.live_route_upgrade.state,'applied');assert.equal(fresh.body.live_route_upgrade.state,'applied');
  assert.equal(old.body.result.days[0].primary_route.main_stops.at(-1).event_id,event.id);
  assert.equal(fresh.body.result.days[0].primary_route.main_stops.at(-1).event_id,'later-generation');
});

test('real source normalization with fixture transport authorizes only the selected-day verified local occurrence',async t=>{
  const originalFetch=global.fetch,transport=deferred();let providerCalls=0;
  global.fetch=async(url,options)=>{
    const target=new URL(String(url));
    if(target.origin==='https://api.hel.fi'&&target.pathname==='/linkedevents/v1/event/'){providerCalls++;return transport.promise;}
    return originalFetch(url,options);
  };
  const supply=resolveDefaultEventSupply({PARRANDA_AGNOSTIC_EVENTS:'enabled',PARRANDA_EVENT_FEEDS:JSON.stringify([HELSINKI_LINKED_EVENTS_FEED])});
  const h=await setup(t,{eventSupply:supply});
  t.after(()=>{global.fetch=originalFetch;transport.resolve({ok:true,json:async()=>({data:[]})});});
  const initial=await post(h.server,routePath,routeBody),token=initial.body.live_completion.token;
  const sourceRow=(id,start,coordinates)=>({id,name:{en:'Source-backed concert'},start_time:start,end_time:start.replace('18:00','20:00'),location:{position:{coordinates},name:{en:'Venue'}},info_url:{en:'https://example.org/gig'},data_source:'fixture',keywords:[{name:{en:'music'}}]});
  transport.resolve({ok:true,json:async()=>({data:[sourceRow('verified-selected-day','2026-06-28T18:00:00Z',[24.943,60.173]),sourceRow('far-event','2026-06-28T18:00:00Z',[25.9,61.1]),sourceRow('future-event','2026-07-01T18:00:00Z',[24.943,60.173])]})});
  let read;
  for(let i=0;i<20;i++){await new Promise(r=>setImmediate(r));read=await post(h.server,readPath,{token});if(read.status!==202)break;}
  assert.equal(read.status,200);assert.equal(read.body.live_events.tonight.length,1);
  assert.equal(read.body.live_events.tonight[0].route_eligible,true,'real provider normalizer attests route eligibility');
  const upgrade=await post(h.server,upgradePath,{token});
  assert.equal(upgrade.body.live_route_upgrade.state,'applied');
  assert.equal(upgrade.body.result.days[0].primary_route.main_stops.at(-1).event_id,'verified-selected-day');
  assert.equal(providerCalls,1,'upgrade reuses collection, not transport');
});

test('an otherwise genuine event beyond the final evening-hop gate cannot publish an upgraded day',async t=>{
  const h=await setup(t);
  const initial=await post(h.server,routePath,routeBody),token=initial.body.live_completion.token;
  h.work.resolve(collection([{...event,lng:25.003}]));await new Promise(r=>setImmediate(r));
  const result=await post(h.server,upgradePath,{token});
  assert.equal(result.body.live_route_upgrade.state,'rejected');assert.equal(result.body.result,undefined);
  assert.equal(h.calls(),1);
});

test('previous eligible events remain in the completion ranking, so a new losing occurrence cannot replace the day',async t=>{
  let walks=0;
  const next={...event,id:'new-lower-ranked',title:'Second concert'};
  const pending={...collection(),pending:true};
  Object.defineProperty(pending,LIVE_COLLECTION_READ,{value:()=>collection([event,next])});
  const {routeWalkingPath}=require('../server/walking-router');
  const h=await setup(t,{eventSupply:async()=>pending,walkingRouter:async points=>{walks++;return routeWalkingPath(points);}});
  const initial=await post(h.server,routePath,routeBody),token=initial.body.live_completion.token,before=walks;
  const result=await post(h.server,upgradePath,{token});
  assert.equal(result.body.live_route_upgrade.state,'not_eligible','the winning occurrence is unchanged');
  assert.equal(walks,before,'no engine attempt when the original eligible anchor still wins');
});

test('an omitted request date binds upgrade to the original actually published normalized day',async t=>{
  const h=await setup(t);
  const initial=await post(h.server,routePath,{...routeBody,dates:[]}),token=initial.body.live_completion.token;
  const date=initial.body.days[0].date;
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(date),'precondition: an actual normalized published date');
  h.work.resolve(collection([{...event,starts_at:`${date}T18:00:00Z`,ends_at:`${date}T20:00:00Z`}],{selected_date:date}));
  await new Promise(r=>setImmediate(r));
  const result=await post(h.server,upgradePath,{token});
  assert.equal(result.body.live_route_upgrade.state,'applied');
  assert.equal(result.body.result.days[0].date,date);
});

test('a withheld original engine day never grants route-upgrade authorization',async t=>{
  const h=await setup(t,{openDataLoader:null});
  const initial=await post(h.server,routePath,routeBody),token=initial.body.live_completion.token;
  assert.equal(initial.body.agnostic_route_output_experiment.promotion.promote,false);
  assert.equal(initial.body.days.length,0);
  h.work.resolve(collection());await new Promise(r=>setImmediate(r));
  const read=await post(h.server,readPath,{token});assert.equal(read.status,200);
  assert.equal(read.body.live_completion.route_upgrade,'not_supported');
  const upgrade=await post(h.server,upgradePath,{token});
  assert.equal(upgrade.status,409);assert.equal(upgrade.body.error,'live_route_upgrade_not_authorized');
  assert.equal(h.calls(),1);
});
