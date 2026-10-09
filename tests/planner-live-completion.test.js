"use strict";
const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { buildApp } = require('../server/app');
const { resolveDefaultEventSupply, HELSINKI_LINKED_EVENTS_FEED } = require('../server/place-candidates/agnostic-event-supply');
const { LIVE_COLLECTION_READ, createLiveCompletionStore } = require('../server/planner/live-completion');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { externalRecord } = require('./helpers/planner-reservoir-compare');
const NOW = '2026-06-28T12:00:00Z';
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function post(server, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname:'127.0.0.1', port:server.address().port, path, method:'POST', headers:{'Content-Type':'application/json'} }, res => {
      let text=''; res.on('data', c => text+=c); res.on('end', () => resolve({ status:res.statusCode, headers:res.headers, body:JSON.parse(text) }));
    }); req.on('error', reject); req.end(JSON.stringify(body));
  });
}
const legacyRoutePath = '/api/route-recommendations?experimental_agnostic_route_output=1&include_external_candidates=1';
const routePath = legacyRoutePath+'&include_live_completion=1';
const routeBody = { day_rhythm:'balanced', lat:60.17, lng:24.94, dates:['2026-06-28'], preferences:['culture'], include_external_candidates:1 };
function collection(status='healthy', result='empty', events=[]) {
  return { coverage:'covered', selected_date:'2026-06-28', feed:{id:'fixture'}, feeds:[{id:'fixture',status:status==='healthy'?'ok':'failed'}], tonight:events, this_week:[], acquisition:{ source_health:{status,result,responding_source_count:status==='healthy'?1:0}, radius_m:3000 } };
}
async function setup(t, records=[]) {
  const work=deferred(); let calls=0; let input; let loaderCalls=0;
  const supply=resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS:'enabled', PARRANDA_EVENT_FEEDS:JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]) }, {
    collectEvents:async value => { calls++; input=value; return work.promise; },
  });
  const server=buildApp({ eventSupply:supply, openDataLoader:async () => { loaderCalls++; return records; }, weatherProvider:async () => null, placeResolver:null, reviewedPlaceSource:null, sourceCatalog:null, clock:{now:()=>NOW} }).listen(0);
  t.after(async () => { work.resolve(collection()); await new Promise(r=>server.close(r)); });
  return { server, work, calls:()=>calls, input:()=>input, loaderCalls:()=>loaderCalls };
}
test('planner completion reads its existing pending collection without another supply or route execution', async t => {
  const h=await setup(t);
  const initial=await post(h.server,routePath,routeBody);
  assert.equal(initial.status,200);
  assert.equal(initial.body.live_events.pending,true);
  assert.equal(h.calls(),1);
  const initialLoaderCalls=h.loaderCalls();
  assert.ok(initialLoaderCalls>0,'initial planner actually executes the trusted composition supply path');
  assert.equal(initial.body.live_completion?.version,1,'planner issues exact collection capability');
  const {token}=initial.body.live_completion;
  const pending=await post(h.server,'/api/planner-live-completion',{token});
  assert.equal(pending.status,202);
  assert.equal(pending.body.live_events.pending,true);
  assert.equal(pending.body.days,undefined,'completion cannot publish a day');
  h.work.resolve(collection()); await new Promise(r=>setImmediate(r));
  const ready=await post(h.server,'/api/planner-live-completion',{token});
  assert.equal(ready.status,200);
  assert.equal(ready.headers['cache-control'],'no-store');
  assert.equal(ready.body.live_events.acquisition.source_health.status,'healthy');
  assert.equal(ready.body.live_events.acquisition.source_health.result,'empty');
  assert.equal(ready.body.live_events.selected_date,'2026-06-28');
  assert.equal(ready.body.live_completion.route_upgrade,'not_supported');
  assert.equal(ready.body.days,undefined);
  assert.equal(h.calls(),1,'reads cannot start another collection');
  assert.equal(h.loaderCalls(),initialLoaderCalls,'reads cannot replay composition supply');
  assert.equal(h.input().selectedDate,'2026-06-28');
  assert.deepEqual((await post(h.server,'/api/planner-live-completion',{token})).body,ready.body,'terminal read is idempotent');
});

test('an invalid finished collection fails terminally rather than remaining pending', async t => {
  const h=await setup(t);
  const initial=await post(h.server,routePath,routeBody);
  h.work.resolve(null); await new Promise(r=>setImmediate(r));
  const result=await post(h.server,'/api/planner-live-completion',{token:initial.body.live_completion.token});
  assert.equal(result.status,503);
  assert.equal(result.body.error,'live_completion_unavailable');
  assert.equal(result.body.live_events,undefined,'invalid evidence cannot claim a healthy empty calendar');
  assert.equal(h.calls(),1);
});

test('a thrown producer retains the original failed source health, never reacquires on reads', async t => {
  const h=await setup(t);
  const initial=await post(h.server,routePath,routeBody);
  h.work.reject(new Error('fixture transport failure')); await new Promise(r=>setImmediate(r));
  const result=await post(h.server,'/api/planner-live-completion',{token:initial.body.live_completion.token});
  assert.equal(result.status,200,'finished collection failure is a terminal sidecar answer');
  assert.equal(result.body.live_events.pending,undefined);
  assert.equal(result.body.live_events.acquisition.source_health.status,'unavailable');
  assert.equal(result.body.live_events.acquisition.source_health.failed_source_count,1);
  assert.ok(result.body.live_events.acquisition.source_health.reasons.includes('source_failures_present'));
  assert.notEqual(result.body.live_events.acquisition.source_health.result,'empty');
  assert.equal(result.body.live_completion.route_upgrade,'not_supported');
  assert.deepEqual((await post(h.server,'/api/planner-live-completion',{token:initial.body.live_completion.token})).body,result.body);
  assert.equal(h.calls(),1);
});

test('completion rejects public geography, dates, references, events and upgrade attempts without acquisition', async t => {
  const h=await setup(t);
  const initial=await post(h.server,routePath,routeBody);
  const token=initial.body.live_completion.token;
  for (const extra of [{lat:0,lng:0},{selected_date:'2026-06-29'},{place_ref:'osm:relation:1'},{live_events:{tonight:[{route_eligible:true}]}},{upgrade:true}]) {
    const result=await post(h.server,'/api/planner-live-completion',{token,...extra});
    assert.equal(result.status,400);
    assert.equal(result.body.error,'invalid_live_completion_request');
    assert.equal(result.body.live_events,undefined);
  }
  for (const unknown of ['fake',token.slice(0,-1)+'x','a'.repeat(48)]) {
    assert.equal((await post(h.server,'/api/planner-live-completion',{token:unknown})).status,410);
  }
  assert.equal(h.calls(),1);
});

test('opaque references expire and are app-local, bounded, and cannot be minted from JSON', () => {
  let now=0;
  const store=createLiveCompletionStore({now:()=>now});
  const pending=collection(); pending.pending=true;
  assert.equal(store.issue(pending),null);
  Object.defineProperty(pending,LIVE_COLLECTION_READ,{value:()=>pending});
  assert.equal(store.issue(JSON.parse(JSON.stringify(pending))),null);
  const first=store.issue(pending);
  assert.equal(first.expires_in_ms,120000);
  assert.equal(createLiveCompletionStore().read(first.token).status,410);
  for (let i=1;i<128;i++) assert.ok(store.issue(pending));
  assert.equal(store.issue(pending),null,'full store does not evict a still-valid planner capability');
  now=120000;
  assert.equal(store.read(first.token).status,410);
  assert.ok(store.issue(pending));
});

test('same producer coalesces, distinct date/radius/source plans isolate, and same-key refresh cannot replace the old generation', async () => {
  const cache=createSourceCache({ttlMs:120000});
  const jobs=[]; let catalogIds=['one']; let catalogReads=0;
  const sourceCatalog={listApprovedEventFeedsForAnchor:async () => { catalogReads++; return catalogIds.map(id=>({...HELSINKI_LINKED_EVENTS_FEED,id})); }};
  const supply=resolveDefaultEventSupply({PARRANDA_AGNOSTIC_EVENTS:'enabled'}, {
    eventCache:cache, sourceCatalog,
    collectEvents:async input => { const job={input,...deferred()}; jobs.push(job); return job.promise; },
  });
  const input={anchor:{lat:60.17,lng:24.94},now:NOW,selectedDate:'2026-06-28'};
  const first=await supply(input), same=await supply(input);
  assert.equal(jobs.length,1);
  const tomorrow=await supply({...input,selectedDate:'2026-06-29'});
  const wider=await supply({...input,radiusM:7000});
  catalogIds=['two']; const otherSource=await supply(input);
  assert.equal(jobs.length,4,'collection identity retains date, radius and selected sources');
  for (const [index,job] of jobs.entries()) job.resolve({...collection(),selected_date:job.input.selectedDate,feed:{id:`generation-${index}`}});
  await new Promise(r=>setImmediate(r));
  const readsBefore=catalogReads;
  assert.equal(first[LIVE_COLLECTION_READ]().feed.id,'generation-0');
  assert.equal(same[LIVE_COLLECTION_READ]().feed.id,'generation-0');
  assert.equal(tomorrow[LIVE_COLLECTION_READ]().selected_date,'2026-06-29');
  assert.equal(wider[LIVE_COLLECTION_READ]().feed.id,'generation-2');
  assert.equal(otherSource[LIVE_COLLECTION_READ]().feed.id,'generation-3');
  assert.equal(catalogReads,readsBefore,'completion does not rerun source selection');
  cache.clear(); catalogIds=['one'];
  const refreshed=await supply(input);
  assert.equal(jobs.length,5);
  jobs[4].resolve({...collection(),feed:{id:'refreshed'}}); await new Promise(r=>setImmediate(r));
  assert.equal(refreshed[LIVE_COLLECTION_READ]().feed.id,'refreshed');
  assert.equal(first[LIVE_COLLECTION_READ]().feed.id,'generation-0','old capability never reads a newer same-key cache result');
  assert.equal(JSON.stringify(first).includes('liveCollectionRead'),false,'source capability is not serialized');
});

test('terminal partial, uncovered and future/non-route event sidecars cannot authorize any route upgrade', async t => {
  for (const value of [collection('partial','unknown'), {...collection(),coverage:'uncovered'}, collection('healthy','events_found',[
    {id:'future',title:'Future context',starts_at:'2026-07-01T19:00:00Z',ends_at:'2026-07-01T21:00:00Z',lat:60.17,lng:24.94,route_eligible:false},
  ])]) {
    const h=await setup(t);
    const initial=await post(h.server,routePath,routeBody);
    const loaderCalls=h.loaderCalls();
    h.work.resolve(value); await new Promise(r=>setImmediate(r));
    const result=await post(h.server,'/api/planner-live-completion',{token:initial.body.live_completion.token});
    assert.equal(result.status,200);
    assert.equal(result.body.live_events.coverage,value.coverage);
    assert.equal(result.body.live_events.acquisition.source_health.status,value.acquisition.source_health.status);
    assert.equal(result.body.days,undefined);
    assert.equal(result.body.live_completion.route_upgrade,'not_supported');
    assert.equal(h.loaderCalls(),loaderCalls);
    assert.equal(h.calls(),1);
  }
});

test('actual provider normalization/fusion lifecycle completes through HTTP with fixture transport, not a replacement collector', async t => {
  const originalFetch=global.fetch;
  const transport=deferred(); let providerCalls=0;
  global.fetch=async (url,options) => {
    const target=new URL(String(url));
    if (target.origin==='https://api.hel.fi' && target.pathname==='/linkedevents/v1/event/') {
      providerCalls++; return transport.promise;
    }
    return originalFetch(url,options); // retain the no-network guard everywhere else
  };
  const supply=resolveDefaultEventSupply({PARRANDA_AGNOSTIC_EVENTS:'enabled',PARRANDA_EVENT_FEEDS:JSON.stringify([HELSINKI_LINKED_EVENTS_FEED])});
  const server=buildApp({eventSupply:supply,openDataLoader:null,placeResolver:null,reviewedPlaceSource:null,sourceCatalog:null,clock:{now:()=>NOW}}).listen(0);
  t.after(async () => { global.fetch=originalFetch; transport.resolve({ok:true,json:async()=>({data:[]})}); await new Promise(r=>server.close(r)); });
  const initial=await post(server,routePath,routeBody);
  assert.equal(initial.body.live_events.pending,true);
  assert.equal(providerCalls,1);
  transport.resolve({ok:true,json:async()=>({data:[{
    id:'fixture-gig',name:{en:'Source-backed concert'},start_time:'2026-06-28T18:00:00Z',end_time:'2026-06-28T20:00:00Z',
    location:{position:{coordinates:[24.94,60.17]},name:{en:'Venue'}},info_url:{en:'https://example.org/gig'},data_source:'fixture',keywords:[{name:{en:'music'}}],
  }]})});
  let result;
  for (let i=0;i<20;i++) {
    await new Promise(r=>setImmediate(r));
    result=await post(server,'/api/planner-live-completion',{token:initial.body.live_completion.token});
    if (result.status!==202) break;
  }
  assert.equal(result.status,200);
  assert.equal(result.body.live_events.tonight.length,1);
  assert.equal(result.body.live_events.tonight[0].title,'Source-backed concert');
  assert.equal(result.body.live_events.acquisition.source_health.status,'healthy');
  assert.equal(result.body.live_events.acquisition.source_health.result,'events_found');
  assert.equal(result.body.live_completion.route_upgrade,'not_supported');
  assert.equal(result.body.days,undefined);
  assert.equal(providerCalls,1);
});

test('unmodified clients never receive a completion bearer capability to persist in their whole-response snapshot', async t => {
  const h=await setup(t);
  const result=await post(h.server,legacyRoutePath,routeBody);
  assert.equal(result.body.live_events.pending,true);
  assert.ok(result.body.live_completion===undefined,'unmodified clients must not receive a bearer capability');
  assert.equal(h.calls(),1);
});

test('a genuinely composed day has no second composition while its initial Live collection finishes', async t => {
  const records=['restaurant','viewpoint'].flatMap((type,group)=>Array.from({length:6},(_,i)=>
    externalRecord(`completion-${type}-${i}`,`Fixture ${type} ${i}`,type,60.17+group*.002+i*.0003,24.94+i*.0003,[type==='restaurant'?'mat':'utsikt'])));
  const h=await setup(t,records);
  const initial=await post(h.server,routePath,{...routeBody,preferences:['food','views'],agnostic_engine_compose:true});
  assert.ok(initial.body.days?.[0]?.primary_route?.main_stops?.length>=2,'the precondition is a published composed day, not a blocked planner');
  const loaderCalls=h.loaderCalls();
  const savedDay=JSON.stringify(initial.body.days);
  const token=initial.body.live_completion.token;
  assert.equal((await post(h.server,'/api/planner-live-completion',{token})).status,202);
  h.work.resolve(collection()); await new Promise(r=>setImmediate(r));
  const result=await post(h.server,'/api/planner-live-completion',{token});
  assert.equal(result.status,200);
  assert.equal(result.body.days,undefined);
  assert.equal(JSON.stringify(initial.body.days),savedDay);
  assert.equal(h.loaderCalls(),loaderCalls);
  assert.equal(h.calls(),1);
});
