const assert = require('node:assert/strict');
const test = require('node:test');
const {composeAgnosticRouteOutput} = require('../server/planner/agnostic-route-output');
const recorded = require('./fixtures/london-large-area-recorded.json');
const {classifyPromotionReadiness} = require('../server/planner/agnostic-promotion-gate');

function replay(overrides = {}) {
  return composeAgnosticRouteOutput({
    coords: {lat:51.5074456,lng:-0.1277653}, baselineResult:{days:[]},
    externalRequested:true, openDataLoader:async()=>structuredClone(recorded.records),
    preferences:['food','culture','views'], date:'2026-10-09', todayIsoDate:'2026-10-09',
    timezone:'Europe/London',
    clock:()=>new Date('2026-10-09T15:17:00Z'),
    weatherProvider:async()=>({condition:'rain',precipitationProbabilityMax:80,
      timezone_resolution:{timezone:'Europe/London',timezone_source:'weather_provider_auto',utc_offset_seconds:3600}}),
    dayRhythm:'balanced', distanceMode:'no_limit', anchorMode:'place',
    spatialScope:{kind:'settlement',collection_mode:'regional_bounded',
      bounds:{south:51.287,north:51.692,west:-0.510,east:0.334}},
    synthesizeVia:'engine', ...overrides,
  });
}

test('recorded London supply reaches the engine and walking validation instead of a fixed pairwise veto', async () => {
  const {result,experiment} = await replay();
  const pipeline = experiment.eligibility.checks.candidate_pipeline;
  for (const key of ['coordinate_ready_real_place_count','identity_resolved_candidate_count',
    'eligible_pool_candidate_count','rejected_candidate_count','availability_evaluated_candidate_count',
    'availability_excluded_candidate_count','availability_unresolved_candidate_count',
    'role_relevant_candidate_count','role_surface_candidate_count','engine_reservoir_geocoded_stop_count']) {
    assert.equal(pipeline[key],recorded.provenance.expected_pipeline[key],key);
  }
  const route = result.days?.[0]?.primary_route;
  assert.ok(route,'the same 35 records / 31 admitted / four reservoir places support an actual walk');
  assert.equal(experiment.eligibility.checks.geometry_coherence,'weak','do not relabel the 3.037 km diagnostic');
  assert.equal(experiment.walking_validation.valid,true);
  assert.ok(experiment.walking_validation.checks.total_walk_km > 0);
  const ids = new Set(recorded.records.map(record=>record.id));
  assert.ok(route.main_stops.every(stop=>ids.has(stop.id)));
  const coverage = new Set(route.main_stops.flatMap(stop=>stop.covered_preferences || []));
  assert.deepEqual([...coverage].sort(),['food','museums','scenic']);
  assert.ok(route.main_stops.every(stop=>stop.provisional && stop.trust.human_verified === false));
  const promotion = classifyPromotionReadiness({
    calibration:experiment.readiness_calibration, strongAnchor:true,
    requestedIntents:['food','museums','scenic'], primaryStops:route.main_stops,
    preferenceCoverage:experiment.constraint_negotiation.preference_coverage,
  });
  assert.equal(promotion.promote,true);
  assert.equal(promotion.readiness,'promotable_limited','do not promote external heuristic supply to full trust');
  assert.ok(experiment.readiness_calibration.caps.includes('capped_by_derived_timezone'));
});

// Synthetic controls test the general policy, not named-city exceptions. All
// source facts come from explicit fixtures; these are not provider acceptance.
const {externalRecord} = require('./helpers/planner-reservoir-compare');
const {routeWalkingPath} = require('../server/walking-router');
function geometryReplay(records, overrides = {}) {
  return replay({coords:{lat:50,lng:10},
    openDataLoader:async()=>structuredClone(records),
    date:'2026-10-10', preferences:['food','views'],
    spatialScope:{kind:'municipality',bounds:{south:49.99,north:50.09,west:9.99,east:10.01}}, weatherProvider:async()=>null,
    ...overrides});
}
function pair(delta) {
  return [externalRecord('v','Source viewpoint','viewpoint',50,10),
    externalRecord('f','Source restaurant','restaurant',50+delta,10)];
}

test('legacy synthesis still fails closed on the recorded weak seed', async () => {
  const out = await replay({synthesizeVia:'legacy'});
  assert.deepEqual(out.result.days,[]);
  assert.ok(out.experiment.eligibility.blockers.includes('weak_geometry'));
});

test('a metropolitan-scale coherent walk is judged by its ordered legs, not seed diameter', async () => {
  const out = await geometryReplay(pair(0.029));
  assert.ok(out.result.days[0]?.primary_route);
  assert.equal(out.experiment.eligibility.checks.geometry_coherence,'weak');
  assert.equal(out.experiment.eligibility.checks.geometry_validation,'engine_walk_validated');
  assert.ok(out.experiment.walking_validation.checks.total_walk_km < 6);
});

test('a sparse regional pair beyond the unchanged per-leg budget stays unpublished even without a limit', async () => {
  const out = await geometryReplay(pair(0.08));
  assert.deepEqual(out.result.days,[]);
  assert.ok(out.experiment.eligibility.blockers.includes('walking_leg_budget_exceeded'));
  assert.equal(out.experiment.walking_validation.checks.max_leg_budget_km,6);
});

test('a weak seed cannot publish when walking validation is unavailable', async () => {
  const out = await replay({walkingRouter:async()=>{throw new Error('unavailable fixture');}});
  assert.deepEqual(out.result.days,[]);
  assert.ok(out.experiment.eligibility.blockers.includes('walking_route_unavailable'));
});

test('an invalid routed path cannot become a published day', async () => {
  const out = await replay({walkingRouter:async(points,opts)=>({
    ...await routeWalkingPath(points,opts),pathPoints:[],
  })});
  assert.deepEqual(out.result.days,[]);
  assert.ok(out.experiment.eligibility.blockers.includes('invalid_walking_path_points'));
});

test('an ordered path with an enormous detour cannot publish a day', async () => {
  const out = await replay({walkingRouter:async(points,opts)=>({
    ...await routeWalkingPath(points,opts),
    pathPoints:[points[0],{lat:60,lng:0},...points.slice(1)],
  })});
  assert.deepEqual(out.result.days,[]);
  assert.equal(out.experiment.walking_validation.valid,false);
  assert.ok(out.experiment.eligibility.blockers.includes('walking_validation_failed'));
});

test('identical preferences and rhythm retain the requested distance budget', async () => {
  const out = await replay({distanceMode:'soft_target',walkingKmTarget:1});
  assert.deepEqual(out.result.days,[]);
  assert.ok(out.experiment.eligibility.blockers.includes('walking_budget_exceeded'));
  assert.equal(out.experiment.walking_validation.checks.target_walk_km,1);
});

test('ordinary compact town geometry preserves the existing engine path', async () => {
  const out = await geometryReplay(pair(0.003));
  assert.ok(out.result.days[0]?.primary_route);
  assert.equal(out.experiment.eligibility.checks.geometry_coherence,'strong');
  assert.equal(out.experiment.eligibility.checks.geometry_validation,undefined);
});

test('two dense clusters still require a safe walk between them', async () => {
  const records = [...pair(0.08),
    externalRecord('v2','Other viewpoint','viewpoint',50.001,10),
    externalRecord('f2','Other restaurant','restaurant',50.081,10)];
  const out = await geometryReplay(records);
  assert.deepEqual(out.result.days,[]);
  assert.ok(out.experiment.eligibility.blockers.includes('walking_leg_budget_exceeded'));
});

test('recorded supply keeps source-backed pinned identities across the engine path', async () => {
  const pinnedStopIds = ['osm-node-472152158'];
  const out = await replay({pinnedStopIds});
  assert.ok(out.result.days[0]?.primary_route.main_stops.some(stop=>stop.id===pinnedStopIds[0]));
});

test('exact-coordinate validation keeps the user-owned start and end anchors', async () => {
  let validatedPoints;
  const records = [externalRecord('v','Viewpoint','viewpoint',49.986,10),
    externalRecord('f','Restaurant','restaurant',50.014,10)];
  const out = await geometryReplay(records,{anchorMode:'coordinates',
    walkingRouter:async(points,opts)=>{validatedPoints=points;return routeWalkingPath(points,opts);}});
  const route = out.result.days[0]?.primary_route;
  assert.ok(route);
  assert.deepEqual(validatedPoints.map(({lat,lng})=>({lat,lng})),
    route.map_route_points.map(({lat,lng})=>({lat,lng})),
    'validate the public anchor loop, not only its stops');
});

test('the validated final walking result is the geometry and distance actually published', async () => {
  const out = await replay({walkingRouter:async(points,opts)=>{
    const result = await routeWalkingPath(points,opts);
    return {...result,estimatedKm:7,
      legs:result.legs.map(leg=>({...leg,distance_km:leg.distance_km+1}))};
  }});
  const route = out.result.days[0]?.primary_route;
  assert.ok(route);
  assert.equal(out.experiment.walking_validation.checks.total_walk_km,7);
  assert.equal(route.estimated_km,7,'publish the distance validated, not the old heuristic distance');
  assert.ok(route.legs.every(leg=>leg.distance_km>=1));
});

test('published walking-time aggregates use the validated router minutes', async () => {
  const out = await geometryReplay(pair(0.029),{walkingRouter:async(points,opts)=>{
    const routed=await routeWalkingPath(points,opts);
    return {...routed,source:'osrm',legs:routed.legs.map(leg=>({...leg,estimated_walk_minutes:120}))};
  }});
  const route=out.result.days[0]?.primary_route;
  assert.ok(route);
  assert.equal(route.legs[0].estimated_walk_minutes,120);
  assert.equal(route.longest_leg_minutes,120);
  assert.equal(route.average_leg_minutes,120);
});

test('rhythm variants on identical recorded preferences remain source-backed and walking-validated', async () => {
  for (const dayRhythm of ['calm','balanced','full','free']) {
    const out = await replay({dayRhythm});
    const route = out.result.days[0]?.primary_route;
    assert.ok(route,dayRhythm);
    assert.equal(out.experiment.walking_validation.valid,true,dayRhythm);
    assert.ok(route.main_stops.every(stop=>recorded.records.some(record=>record.id===stop.id)),dayRhythm);
    const coverage = new Set(route.main_stops.flatMap(stop=>stop.covered_preferences || []));
    assert.deepEqual([...coverage].sort(),['food','museums','scenic'],dayRhythm);
  }
});
