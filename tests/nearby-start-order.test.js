'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { optimizeStopOrder } = require('../server/route-engine');
const { buildApp } = require('../server/app');
const { record, anchor } = require('./helpers/day-composition-fixtures');

const start = { lat: 55.6, lng: 13 };
const farther = { id: 'farther', name: 'Farther', lat: 55.601, lng: 13 };
const here = { id: 'already-here', name: 'Already here', lat: 55.60002, lng: 13 };
const ids = out => out.orderedStops.map(stop => stop.id);
const optimize = (stops, options, shape = 'loop', end = start) => optimizeStopOrder(
  stops, shape, start, end, null, null, null, 'no_limit', 'balanced', 'en', options,
);

test('equivalent loop geometry prefers the selected stop already at the planning anchor', () => {
  const enabled = optimize([farther, here], { preferNearbyStart: true });
  const old = optimize([farther, here]);
  assert.equal(enabled.geometry.objective, old.geometry.objective, 'no geometry cost is bought for proximity');
  assert.deepEqual(ids(enabled), ['already-here', 'farther']);
  assert.deepEqual(new Set(ids(enabled)), new Set(['already-here', 'farther']));
});

test('legacy/default and explicit opt-out retain their established order', () => {
  for (const options of [undefined, {}, { preferNearbyStart: false }, { preferNearbyStart: 'true' }]) {
    assert.deepEqual(ids(optimize([farther, here], options)), ['farther', 'already-here']);
  }
});

test('the private loop option cannot alter an arc with an explicit destination', () => {
  const end = { lat: 55.61, lng: 13.02 };
  assert.deepEqual(optimize([farther, here], { preferNearbyStart: true }, 'arc', end),
    optimize([farther, here], undefined, 'arc', end));
});

test('the geometry objective still wins over a shorter first leg', () => {
  // The nearest place is 3. Starting with 0 gives a better whole-loop
  // objective; proximity cannot override that existing decision.
  const stops = [
    { id:'0', name:'0', lat:55.59268265720457, lng:12.989426153106615 },
    { id:'1', name:'1', lat:55.61694250715897, lng:12.996171494917943 },
    { id:'2', name:'2', lat:55.607021009773014, lng:13.015735148331151 },
    { id:'3', name:'3', lat:55.59721862705425, lng:12.984640184873715 },
    { id:'4', name:'4', lat:55.61316963944584, lng:13.003541307924316 },
  ];
  const old = optimize(stops);
  const enabled = optimize(stops, { preferNearbyStart:true });
  assert.equal(enabled.geometry.objective, old.geometry.objective);
  assert.equal(enabled.orderedStops[0].id,'0');
  assert.deepEqual(new Set(ids(enabled)), new Set(stops.map(stop=>stop.id)));
});

test('larger sets keep every identity and bounded deterministic refinement', () => {
  const stops = Array.from({length:12},(_,i)=>({ id:`large-${i}`,name:`Large ${i}`,
    lat:55.6+(i%4)*.001,lng:13+Math.floor(i/4)*.001 }));
  const a=optimize(stops,{preferNearbyStart:true}), b=optimize(stops,{preferNearbyStart:true});
  assert.deepEqual(ids(a),ids(b));
  assert.deepEqual(new Set(ids(a)),new Set(stops.map(stop=>stop.id)));
  assert.ok(Number.isFinite(a.geometry.objective));
});

test('real HTTP publishes the nearby bar first without changing source facts or stop identities', async t => {
  // Frozen field geometry translated to an unrelated fixture anchor. No city
  // names, new provider behavior or product-API response replacement.
  const offsets = [
    ['west', -.001107461865234, -.00038383022461],
    ['north-west', .00014375883789, -.001066661035156],
    ['north', .0010974331543, -.001197314416504],
    ['north-east', .00409959990234, .004322552526855],
    ['east', -.000138528759766, .008341336096191],
    ['z-current', -.00001264375, -.000039553796387],
  ];
  const rows = offsets.map(([id,lat,lng])=>record(id,'bar',0,{
    lat:anchor.lat+lat,lng:anchor.lng+lng,
    ...(id==='z-current'?{}:{operational_status:'source_indicated_active',
      operational_reasons:['overture_operating_status_active']}),
  }));
  const app=buildApp({openDataLoader:async()=>structuredClone(rows),placeResolver:null,
    placeSuggestions:null,eventSupply:null,sourceCatalog:null,reviewedPlaceSource:null,
    clock:()=>new Date('2026-11-06T13:00:00Z'),
    weatherProvider:async()=>({condition:'sun',source:'controlled',stale:false,
      timezone_resolution:{timezone:'Europe/Copenhagen',timezone_source:'weather_provider_auto',utc_offset_seconds:3600}}),
  });
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const {buildAnywherePayload}=await import('../frontend/src/lib/anywhere-payload.mjs');
  const payload=buildAnywherePayload({coords:anchor,dates:['2026-11-06'],preferences:['nightlife'],dayRhythm:'full'});
  const response=await fetch(origin+'/api/route-recommendations?lang=en',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(response.status,200);
  const body=await response.json();
  const route=body.days?.[0]?.primary_route;
  assert.ok(route,'source-backed day is actually published');
  assert.equal(body.agnostic_route_output_experiment.walking_validation.valid,true);
  assert.deepEqual(new Set(route.main_stops.map(stop=>stop.id)),new Set(offsets.map(([id])=>id)));
  assert.equal(route.main_stops[0].id,'z-current');
  assert.ok(route.main_stops.every(stop=>stop.open_now===undefined));

  // Removing an unrelated former stop while explicitly retaining an order
  // must not reinterpret a manual day as a fresh automatic route.
  const retained=['north-west','north','north-east','east','west','z-current'];
  const edited=buildAnywherePayload({coords:anchor,dates:['2026-11-06'],preferences:['nightlife'],dayRhythm:'full',
    excludedCandidateIds:['previously-removed'],dayEdit:{version:1,action:'remove',candidate_id:'previously-removed',
      removed_candidate_ids:['previously-removed'],retained_candidate_ids:retained,target_stop_count:6,
      slot_index:0,replacement_preference:null}});
  const editedResponse=await fetch(origin+'/api/route-recommendations?lang=en',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(edited)});
  assert.equal(editedResponse.status,200);
  const manual=await editedResponse.json();
  assert.equal(manual.agnostic_route_output_experiment.day_edit?.status,'applied');
  assert.deepEqual(manual.days[0].primary_route.main_stops.map(stop=>stop.id),retained);
});
