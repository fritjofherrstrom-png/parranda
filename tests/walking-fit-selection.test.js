const test = require('node:test');
const assert = require('node:assert/strict');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');

const origin = {lat: 46, lng: 8};
function record(id, type, north, east = 0) {
  return {id, name: id, type, lat: origin.lat+north, lng: origin.lng+east,
    tags: type === 'restaurant' ? ['mat'] : ['kultur','museum'],
    sources:[{provider:'directory',family:'open_directory',tier:'inferred',url:'https://example.test/places/'+id}],
    chain:false, operational_status:'unknown'};
}
function fixture() {
  const records = [];
  for(let i=0;i<8;i++) {
    records.push(record('Kitchen-'+i,'restaurant',.001+i*.0008,.001));
    records.push(record('Collection-'+i,'museum',.001+i*.0008,-.001));
  }
  records.push(record('Riverside-Kitchen','restaurant',.022,.001));
  return records;
}
async function compose(records, extra={}) {
  return composeAgnosticRouteOutput({coords:origin,baselineResult:{days:[]},externalRequested:true,
    openDataLoader:async()=>records,preferences:['food','culture'],date:'2026-09-10',
    todayIsoDate:()=> '2026-09-09',weatherProvider:async()=>null,
    walkingKmTarget:6,anchorMode:'coordinates',distanceMode:'soft_target',synthesizeVia:'engine',...extra});
}
test('a same-admission requested-role replacement uses a feasible walk without adding provisional depth', async(t)=>{
  const result=await compose(fixture());
  const route=result.result.days[0]?.primary_route;
  assert.ok(route,JSON.stringify(result.experiment.eligibility));
  assert.ok(route.estimated_km>=3.6 && route.estimated_km<=7.1,`short selection left useful supply unused: ${route.estimated_km}`);
  assert.equal(route.main_stops.length,2,'replace a role; do not pad provisional stops');
  assert.ok(route.main_stops.some(s=>s.id==='Riverside-Kitchen'));
  assert.deepEqual(result.experiment.constraint_negotiation.preference_coverage.missing_preferences,[]);
  t.diagnostic(`before: 0.6 km / 2 stops; after: ${route.estimated_km} km / ${route.main_stops.length} stops`);
});

test('untrusted, unavailable, out-of-reach and wrong-intent tails cannot buy walking fit', async()=>{
  for(const mutation of [
    row=>({...row,sources:[]}),
    row=>({...row,operational_status:'inactive'}),
    row=>({...row,lat:origin.lat+.06}),
    row=>({...row,type:'bar',tags:['nattliv']}),
    row=>({...row,sources:[{provider:'official',family:'official',tier:'official',url:'https://example.test/official'}]}),
  ]) {
    const rows=fixture();rows[rows.length-1]=mutation(rows.at(-1));
    const result=await compose(rows);
    assert.ok(!result.result.days[0].primary_route.main_stops.some(s=>s.id==='Riverside-Kitchen'));
  }
});

test('known closed tail cannot be rescued across the selected-day availability gate', async()=>{
  const rows=fixture();rows.at(-1).opening_hours='Th off';
  const result=await compose(rows,{trustedTimezone:'Europe/Zurich',clock:()=>new Date('2026-09-09T12:00:00Z')});
  assert.ok(!result.result.days[0].primary_route.main_stops.some(s=>s.id==='Riverside-Kitchen'));
});

test('an existing in-band day, explicit pins, no-limit and event days keep their original lifecycle', async()=>{
  for(const extra of [
    {walkingKmTarget:1}, {pinnedStopIds:['Kitchen-0']}, {distanceMode:'no_limit'},
    {eveningEventStructure:{district_day:{evening_event:{id:'unroutable-event'}}}},
  ]) {
    const result=await compose(fixture(),extra);
    assert.ok(!result.result.days[0].primary_route.main_stops.some(s=>s.id==='Riverside-Kitchen'));
  }
});

test('source and weather acquisition stay once per composition and ordering is deterministic', async()=>{
  let loads=0,weather=0;
  const rows=fixture();
  const first=await compose(rows,{openDataLoader:async()=>{loads++;return rows;},weatherProvider:async()=>{weather++;return null;}});
  const second=await compose([...rows].reverse());
  assert.equal(loads,1);assert.equal(weather,1);
  assert.deepEqual(first.result.days[0].primary_route.main_stops.map(s=>s.id),second.result.days[0].primary_route.main_stops.map(s=>s.id));
});

test('comparable replacements preserve exact intent, partial intent, admission and safety tiers', ()=>{
  const {comparableRoleReplacement:ok}=require('../server/planner/walking-fit-selection');
  const base={planner_usable:true,candidate_status:'partial',confidence:'medium',origin:'external_open',
    experimental_admission:{allowed:true},local_feel_rank:0,operational_viability:{rank:1},
    covered_preferences:['food'],partial_preferences:['scenic']};
  assert.equal(ok(base,{...base}),true);
  for(const change of [
    {planner_usable:false},{candidate_status:'fallback'},{confidence:'low'},
    {experimental_admission:{allowed:false}},{local_feel_rank:2},{operational_viability:{rank:2}},
    {covered_preferences:['scenic'],partial_preferences:['food']},{partial_preferences:[]},
    {availability:{eligible:false}},
    {weather_reasons:['rain_favors_indoor']},{time_reasons:['time_mismatch:morning']},
    {lens_reasons:['local_lens:neighbourhood']},
  ]) assert.equal(ok(base,{...base,...change}),false,JSON.stringify(change));
  assert.equal(ok({...base,origin:'curated_catalog'},base),false);
});

test('selection uses the same generic mechanism at another latitude', async()=>{
  const offset={lat:12,lng:9};
  const rows=fixture().map(row=>({...row,lat:row.lat+offset.lat,lng:row.lng+offset.lng}));
  const result=await compose(rows,{coords:{lat:origin.lat+offset.lat,lng:origin.lng+offset.lng}});
  assert.ok(result.result.days[0].primary_route.estimated_km>=3.6);
  assert.equal(result.result.days[0].primary_route.main_stops.length,2);
});

test('bounded substitutions do not reopen provisional trust when an independently corroborated role exists', async()=>{
  const rows=fixture();
  rows[0].sources.push({provider:'second',family:'map',tier:'inferred',url:'https://example.test/map/kitchen'});
  const result=await compose(rows);
  assert.ok(!result.result.days[0].primary_route.main_stops.some(s=>s.id==='Riverside-Kitchen'),
    'the far single-family restaurant cannot replace a gate-passing restaurant');
});

test('added independent corroboration preserves walking fit when the relevant in-band choices remain equally trusted', async()=>{
  const rows=[...fixture().slice(0,4),fixture().at(-1)];
  const before=await compose(rows);
  const corroborated=rows.map(row=>({...row,sources:[...row.sources,
    {provider:'independent-map',family:'map',tier:'inferred',url:'https://example.test/map/'+row.id}]}));
  const after=await compose(corroborated);
  for(const result of [before,after]) {
    const route=result.result.days[0].primary_route;
    assert.ok(route.estimated_km>=3.6 && route.estimated_km<=7.1);
    assert.deepEqual(result.experiment.constraint_negotiation.preference_coverage.missing_preferences,[]);
  }
});

test('final geometry and safety verdict, not proposal radius, decide whether repair can replace the day', ()=>{
  const {shouldUseCapacityRepair}=require('../server/planner/agnostic-route-output');
  const base={estimated_km:.6,main_stops:[{id:'a'},{id:'b'}],route_quality_warnings:[]};
  const decide=route=>shouldUseCapacityRepair({baseRoute:base,repairedRoute:route,walkingKmTarget:6,preferences:[]});
  assert.equal(decide({...base,estimated_km:4.5}),true);
  assert.equal(decide({...base,estimated_km:8}),false,'a barrier/long detour over the ceiling is refused');
  assert.equal(decide({...base,estimated_km:NaN}),false,'unknown geometry is not walking-fit proof');
  assert.equal(decide({...base,estimated_km:4.5,route_quality_warnings:['long_leg']}),false);
});

test('variant proposals have a fixed trial/reservoir ceiling and replace exactly one identity', ()=>{
  const {buildWalkingFitReservoirs}=require('../server/planner/agnostic-engine-compose');
  const rich={candidate_id:'a',role:'food_anchor',label:'a',planner_usable:true,candidate_status:'partial',
    confidence:'low',origin:'external_open',experimental_admission:{allowed:true},coordinates:origin,
    covered_preferences:['food'],partial_preferences:[]};
  const sourceCandidates=[{id:'a',role:'food_anchor',city:'test',reservoir_selected:true},
    {id:'b',role:'culture_stop',city:'test',reservoir_selected:true}];
  const plannerRoles={requested_preferences:['food'],roles:[{role:'food_anchor',candidates:[rich]}],
    walking_fit_candidates:Array.from({length:10},(_,i)=>({...rich,candidate_id:'alt'+i,
      coordinates:{lat:origin.lat+.02+i*.0001,lng:origin.lng}}))};
  const variants=buildWalkingFitReservoirs({sourceCandidates,plannerRoles,origin,walkingKmTarget:6});
  assert.equal(variants.length,3);
  for(const variant of variants){assert.equal(variant.length,2);assert.equal(variant[1].id,'b');assert.notEqual(variant[0].id,'a');}
  assert.deepEqual(buildWalkingFitReservoirs({sourceCandidates:[...sourceCandidates,...Array.from({length:5},(_,i)=>({id:'extra'+i}))],plannerRoles,origin,walkingKmTarget:6}),[]);
});

test('engine re-selection cannot sacrifice another published place during a comparable substitution', ()=>{
  const {replacementKeepsOtherStops:keeps}=require('../server/planner/walking-fit-selection');
  const route=ids=>({main_stops:ids.map(id=>({id}))});
  const base=route(['food','culture','views']);
  assert.equal(keeps(base,route(['culture','new-food','views']),'food','new-food'),true);
  assert.equal(keeps(base,route(['new-food','other-culture','views']),'food','new-food'),false);
  assert.equal(keeps(base,route(['food','culture','views']),'food','new-food'),false);
  assert.equal(keeps(base,route(['food','culture','views','new-food']),'unpublished','new-food'),false);
});

test('the public Planner path publishes the replacement, respects exclusion and exposes no private option reservoir', async()=>{
  const {buildApp}=require('../server/app');
  const {requestJson,mockStableWeatherFetch}=require('./helpers/planner-reservoir-compare');
  const originalFetch=global.fetch;
  global.fetch=mockStableWeatherFetch();
  const server=buildApp({openDataLoader:async()=>fixture()}).listen(0);
  try {
    const body={...origin,dates:['2026-09-10'],preferences:['food','culture'],walking_km_target:6,
      include_external_candidates:1,experimental_agnostic_route_output:1,agnostic_engine_compose:1};
    const first=await requestJson(server,{path:'/api/route-recommendations?lang=en',method:'POST',body});
    assert.ok(first.body.days[0].primary_route.main_stops.some(s=>s.id==='Riverside-Kitchen'));
    assert.ok(first.body.days[0].primary_route.estimated_km>=3.6);
    assert.equal(JSON.stringify(first.body).includes('walking_fit_candidates'),false);
    const excluded=await requestJson(server,{path:'/api/route-recommendations?lang=en',
      method:'POST',body:{...body,excluded_candidate_ids:['Riverside-Kitchen']}});
    assert.ok(!excluded.body.days[0].primary_route.main_stops.some(s=>s.id==='Riverside-Kitchen'));
  } finally {
    await new Promise(resolve=>server.close(resolve));
    global.fetch=originalFetch;
  }
});
