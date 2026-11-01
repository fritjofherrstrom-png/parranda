'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { routeWalkingPath } = require('../server/walking-router');
const { validateAgnosticWalkingOrder } = require('../server/planner/agnostic-route-walking-validation');
const { requestJson, mockStableWeatherFetch } = require('./helpers/planner-reservoir-compare');
const DATE = '2026-11-04';
const attribution = { label: 'FOSSGIS routing', url: 'https://routing.openstreetmap.de/about.html', fixMapUrl: 'https://www.openstreetmap.org/fixthemap' };

function supply() {
  return Array.from({ length: 6 }, (_, i) => mapOsmElement({ type: 'node', id: 9700 + i,
    lat: 55.6 + i * .003, lon: 13 + (i % 2) * .002,
    tags: { name: `Fixture Reuse ${i}`, shop: 'second_hand', opening_hours: 'Mo-Su 10:00-18:00' } }));
}

// Controlled sampled geometry exercises exact path transport and final-chain
// admission. It is not evidence of a real provider or pedestrian graph.
async function pedestrianResult(points) {
  const heuristic = await routeWalkingPath(points);
  return { ...heuristic, source: 'osrm', mode: 'walking', attribution,
    pathPoints: points.flatMap((point, i) => i ? [
      { lat: (points[i - 1].lat + point.lat) / 2, lng: (points[i - 1].lng + point.lng) / 2 },
      { lat: point.lat, lng: point.lng },
    ] : [{ lat: point.lat, lng: point.lng }]) };
}

async function fixture(t, walkingRouter, extraOptions = {}, fetchOverride = null) {
  const originalFetch = global.fetch;
  global.fetch = fetchOverride || mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: async () => supply(), placeResolver: null,
    eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null,
    walkingRouter,
    ...(typeof walkingRouter === 'function' ? {walkingConfig:{defaultProvider:'osrm',transportMode:'foot'}} : {}),
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 18,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto' } }),
    clock: () => new Date('2026-11-01T08:00:00Z'), ...extraOptions }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); global.fetch = originalFetch; });
  return extra => requestJson(server, { path: '/api/route-recommendations?lang=en', body: {
    lat: 55.6, lng: 13, dates: [DATE], preferences: ['second_hand'], day_rhythm: 'balanced',
    distance_mode: 'no_limit', experimental_agnostic_route_output: 1,
    include_external_candidates: 1, agnostic_engine_compose: true, ...extra,
  } });
}

test('modern day routes its final selected chain and publishes explicit pedestrian geometry', async t => {
  const calls = [];
  const request = await fixture(t, async points => { calls.push(structuredClone(points)); return pedestrianResult(points); });
  const response = await request({});
  assert.equal(response.status, 200);
  const route = response.body.days[0]?.primary_route;
  assert.ok(route, 'controlled source supply produces a day');
  assert.equal(calls.length, 1, 'route the final chain once, not the reservoir or every candidate trial');
  assert.deepEqual(calls[0].map(({lat,lng})=>({lat,lng})), route.map_route_points.map(({lat,lng})=>({lat,lng})));
  assert.equal(route.geometry_source, 'osrm');
  assert.equal(route.geometry_mode, 'walking');
  assert.deepEqual(route.geometry_attribution, attribution);
  assert.ok(route.map_path_points.length > route.map_route_points.length);
  assert.equal(response.body.agnostic_route_output_experiment.walking_validation.checks.walking_source, 'osrm');
});

test('modern day falls back to pins-only estimates without fabricated pedestrian metadata', async t => {
  const request = await fixture(t, async points => ({ ...await routeWalkingPath(points), fallbackUsed: true }));
  const response = await request({});
  const route = response.body.days[0]?.primary_route;
  assert.ok(route);
  assert.equal(route.geometry_source, 'heuristic');
  assert.notEqual(route.geometry_mode, 'walking');
  assert.equal(route.geometry_attribution == null, true);
  assert.ok(route.caveats.includes('heuristic_walking_estimate'));
});

test('an unreasonable real final walking chain cannot bypass the day safety budget', async t => {
  const request = await fixture(t, async points => ({ ...await pedestrianResult(points),
    estimatedKm: 40, legs: points.slice(1).map(() => ({ distance_km: 40 / (points.length - 1), estimated_walk_minutes: 120 })) }));
  const response = await request({});
  assert.equal(response.body.agnostic_route_output_experiment.route_mutation, false);
  assert.ok(response.body.agnostic_route_output_experiment.walking_validation.blockers.includes('walking_budget_exceeded'));
  assert.equal(response.body.days[0]?.primary_route == null, true);
});

test('public input cannot assert pedestrian geometry or configure the provider', async t => {
  const request = await fixture(t, null);
  const response = await request({ geometry_source: 'osrm', geometry_mode: 'walking',
    walkingConfig: { defaultProvider: 'osrm', osrmBaseUrl: 'https://injected.invalid' },
    geometry_attribution: attribution, map_path_points: [{lat:0,lng:0},{lat:1,lng:1}] });
  const route = response.body.days[0]?.primary_route;
  assert.ok(route);
  assert.equal(route.geometry_source, 'heuristic');
  assert.notEqual(route.geometry_mode, 'walking');
  assert.equal(route.geometry_attribution == null, true);
});

test('removed stops are not sent to the final pedestrian router', async t => {
  const calls = [];
  const request = await fixture(t, async points => { calls.push(structuredClone(points)); return pedestrianResult(points); });
  const original = await request({});
  const ids = original.body.days[0].primary_route.main_stops.map(stop => stop.id);
  calls.length = 0;
  const response = await request({ excluded_candidate_ids: [ids[0]], day_edit: {
    version:1, action:'remove', candidate_id:ids[0], retained_candidate_ids:ids.slice(1),
    target_stop_count:ids.length-1, slot_index:0, replacement_preference:null, removed_candidate_ids:[ids[0]],
  } });
  const route = response.body.days[0]?.primary_route;
  assert.ok(route);
  assert.equal(calls.length, 1);
  assert.deepEqual(route.main_stops.map(stop=>stop.id), ids.slice(1));
  assert.deepEqual(calls[0].map(({lat,lng})=>({lat,lng})), route.map_route_points.map(({lat,lng})=>({lat,lng})));
  assert.equal(route.geometry_mode, 'walking');
});

test('final validation preserves pedestrian provenance and rejects null leg metrics', async () => {
  const stops = [{lat:55.6,lng:13},{lat:55.603,lng:13.002}];
  const valid = await validateAgnosticWalkingOrder({stops,walkingRouter:pedestrianResult});
  assert.equal(valid.valid,true);
  assert.equal(valid.result.mode,'walking');
  assert.deepEqual(valid.result.attribution,attribution);
  const invalid = await validateAgnosticWalkingOrder({stops,walkingRouter:async points=>({
    ...await pedestrianResult(points),estimatedKm:0,legs:[{distance_km:null,estimated_walk_minutes:null}],
  })});
  assert.equal(invalid.valid,false);
  assert.ok(invalid.blockers.includes('walking_validation_failed'));
});

test('server-owned pedestrian configuration reaches the ordinary modern API', async t => {
  const names = ['PARRANDA_WALKING_PROVIDER','PARRANDA_OSRM_URL','PARRANDA_OSRM_TRANSPORT_MODE'];
  const saved = Object.fromEntries(names.map(name=>[name,process.env[name]]));
  t.after(()=>{for(const name of names) {if(saved[name]===undefined) delete process.env[name]; else process.env[name]=saved[name];}});
  process.env.PARRANDA_WALKING_PROVIDER='osrm';
  process.env.PARRANDA_OSRM_URL='https://routing.openstreetmap.de/routed-foot/';
  const originalFetch=global.fetch;
  let calls=0;
  // This seam exists before app construction, just like the native fetch in a
  // deployed process. Never contact the live provider from this test.
  const stableWeather=mockStableWeatherFetch();
  global.fetch=async (url,options)=>{
    const parsed=new URL(String(url));
    if(parsed.hostname!=='routing.openstreetmap.de') return stableWeather(url,options);
    calls++;
    const points=parsed.pathname.split('/').at(-1).split(';').map(pair=>{const [lng,lat]=pair.split(',').map(Number);return {lat,lng};});
    const result=await pedestrianResult(points);
    return new Response(JSON.stringify({code:'Ok',waypoints:points.map(p=>({location:[p.lng,p.lat],distance:0})),routes:[{
      distance:result.estimatedKm*1000,duration:result.legs.reduce((sum,l)=>sum+l.estimated_walk_minutes*60,0),
      legs:result.legs.map(l=>({distance:l.distance_km*1000,duration:l.estimated_walk_minutes*60})),
      geometry:{type:'LineString',coordinates:result.pathPoints.map(p=>[p.lng,p.lat])},
    }]}));
  };
  t.after(()=>{global.fetch=originalFetch;});
  const controlledFetch=global.fetch;
  const request=await fixture(t,undefined,{},controlledFetch);
  const response=await request({});
  assert.equal(calls,1);
  assert.equal(response.body.days[0]?.primary_route?.geometry_mode,'walking');
});
