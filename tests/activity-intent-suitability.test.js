'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const repo=require('node:path').resolve(__dirname,'..');
const {matchCandidateToIntent}=require(repo+'/server/candidates/intent-vocabulary');
const {composeAgnosticRouteOutput}=require(repo+'/server/planner/agnostic-route-output');
const {externalRecord}=require(repo+'/tests/helpers/planner-reservoir-compare');
const {mapPlannerReservoirToSourceCandidates}=require(repo+'/server/planner/agnostic-engine-compose');

test('bathing geography alone cannot stand in for Views; explicit scenic evidence and Swimming remain valid',()=>{
 for(const type of ['beach','bathing-spot','swimming-area']){
  assert.equal(matchCandidateToIntent({type,tags:['coast']},'scenic').level,'none');
  assert.equal(matchCandidateToIntent({type,tags:['coast']},'swimming').level,'strong');
  assert.equal(matchCandidateToIntent({type,tags:['coast','panorama']},'scenic').level,'strong');
 }
 assert.equal(matchCandidateToIntent({type:'promenade',tags:['coast']},'scenic').level,'weak');
});

test('source-backed engine selection serves requested activities without using bathing-only sites as scenic depth',async()=>{
 const anchor={lat:45,lng:9};
 const rows=[externalRecord('b1','Bathing one','beach',45.003,9.005,['coast']),externalRecord('b2','Bathing two','beach',45.005,9.006,['coast']),
 externalRecord('food','Lunch','restaurant',45.001,9.001,['mat']),externalRecord('m1','Museum one','museum',45.002,9.002,['museum']),
 externalRecord('m2','Museum two','museum',45.004,9.002,['museum']),externalRecord('view','Lookout','viewpoint',45.008,9.008,['utsikt'])];
 rows.at(-1).sources=rows.at(-1).sources.slice(0,1); // original defect: stronger activity fact, weaker corroboration.
 for(const date of ['2026-02-10','2026-07-10']){
  const {result}=await composeAgnosticRouteOutput({coords:anchor,baselineResult:{city:'agnostic',days:[{date,primary_route:null,alternatives:[]}]},externalRequested:true,
   openDataLoader:async()=>rows,preferences:['food','culture','views'],date,todayIsoDate:date,synthesizeVia:'engine',dayRhythm:'balanced',distanceMode:'no_limit',
   trustedTimezone:'Europe/Rome',clock:()=>new Date(`${date}T10:00:00Z`),weatherProvider:async()=>({condition:'rain',source:'controlled',stale:false})});
  const stops=result.days[0].primary_route.main_stops;
  assert.equal(stops.filter(s=>s.type==='beach').length,0);
  assert.ok(stops.some(s=>s.id==='view'));
  assert.ok(stops.some(s=>s.type==='restaurant'));
  assert.ok(stops.some(s=>s.type==='museum'));
  assert.ok(stops.every(s=>s.provisional===true),'activity fit does not upgrade trust');
 }
});

test('explicit Swimming and a pinned bathing site remain supported by the real engine', async () => {
  const date = '2026-07-10';
  const rows = [
    externalRecord('b1', 'Bathing one', 'beach', 45.003, 9.005, ['coast']),
    externalRecord('b2', 'Bathing two', 'beach', 45.005, 9.006, ['coast']),
    externalRecord('food', 'Lunch', 'restaurant', 45.001, 9.001, ['mat']),
    externalRecord('museum', 'Museum', 'museum', 45.002, 9.002, ['museum']),
    externalRecord('view', 'Lookout', 'viewpoint', 45.008, 9.008, ['utsikt']),
  ];
  const base = {
    coords: { lat: 45, lng: 9 },
    baselineResult: { city: 'agnostic', days: [{ date, primary_route: null, alternatives: [] }] },
    externalRequested: true,
    openDataLoader: async () => rows,
    date, todayIsoDate: date, synthesizeVia: 'engine', dayRhythm: 'balanced', distanceMode: 'no_limit',
    trustedTimezone: 'Europe/Rome',
    clock: () => new Date(`${date}T10:00:00Z`),
    weatherProvider: async () => ({ condition: 'rain', source: 'controlled', stale: false }),
  };
  const swimming = await composeAgnosticRouteOutput({ ...base, preferences: ['swimming'] });
  assert.deepEqual(swimming.result.days[0].primary_route.main_stops.map(stop => stop.type), ['beach', 'beach']);
  const pinned = await composeAgnosticRouteOutput({ ...base, preferences: ['food', 'culture', 'views'], pinnedStopIds: ['b1'] });
  const stop = pinned.result.days[0].primary_route.main_stops.find(stop => stop.id === 'b1');
  assert.ok(stop, 'an explicit pinned visit is independent of automatic scenic fit');
  assert.deepEqual(stop.covered_preferences, [], 'the pin must not invent Views coverage');
  assert.deepEqual(stop.partial_preferences, []);
});

function rich(id,type){return{candidate_id:id,label:id,type,coordinates:{lat:45.001,lng:9.001},candidate_status:'filled',planner_usable:true,
 covered_preferences:['scenic'],partial_preferences:[],local_feel_rank:0,provenance:{source_tier:'inferred',human_verified:false,attribution:[{label:'Source',url:'https://source.example/'+id}]}};}
function selection(id){return{role:'scenic_anchor',candidate_id:id,coordinates:{lat:45.001,lng:9.001}};}

test('automatic multi-interest depth prefers a different activity type within the same eligible role tier',()=>{
 const roles={requested_preferences:['food','scenic'],roles:[{role:'scenic_anchor',slot:'anchor',candidates:[rich('v1','viewpoint'),rich('v2','viewpoint'),rich('coast-walk','promenade')]}]};
 const result=mapPlannerReservoirToSourceCandidates({selected:[selection('v1')],plannerRoles:roles,perRole:2,includeCapacityFrontier:false});
 assert.deepEqual(result.map(c=>c.id),['v1','coast-walk']);
});

test('focused interests and explicit pins retain legitimate repeated activity choices',()=>{
 const roles={requested_preferences:['scenic'],roles:[{role:'scenic_anchor',slot:'anchor',candidates:[rich('v1','viewpoint'),rich('v2','viewpoint'),rich('coast-walk','promenade')]}]};
 const focused=mapPlannerReservoirToSourceCandidates({selected:[selection('v1')],plannerRoles:roles,perRole:2,includeCapacityFrontier:false});
 assert.deepEqual(focused.map(c=>c.id),['v1','v2']);
 const pinned=mapPlannerReservoirToSourceCandidates({selected:[selection('v1')],plannerRoles:{...roles,requested_preferences:['food','scenic']},pinnedIds:['v2'],perRole:2,includeCapacityFrontier:false});
 assert.ok(pinned.some(c=>c.id==='v2'));
});

test('activity variation cannot restore a closed place or multiply an experimental admission', () => {
  const roles = {
    requested_preferences: ['food', 'scenic'],
    roles: [{ role: 'scenic_anchor', slot: 'anchor', candidates: [
      rich('v1', 'viewpoint'), rich('v2', 'viewpoint'),
      { ...rich('closed-walk', 'promenade'), availability: { eligible: false } },
      { ...rich('admitted-garden', 'garden'), experimental_admission: { allowed: true } },
    ] }],
  };
  const result = mapPlannerReservoirToSourceCandidates({ selected: [selection('v1')], plannerRoles: roles, perRole: 2, includeCapacityFrontier: false });
  assert.deepEqual(result.map(candidate => candidate.id), ['v1', 'v2']);
});

test('real source evidence keeps filled/high depth ahead of a different partial/medium activity', () => {
  const { selectPlannerRoleCandidates } = require('../server/planner/role-selector');
  const { plannerUsableOptionsForRole } = require('../server/planner/candidate-combination');
  const city = {
    key: 'inspect', label: 'Inspect', timezone: 'UTC', center: { lat: 45, lng: 9 },
    catalog: { allItems: [], routeTemplates: [] }, routing: { areaDefinitions: {} },
    todayIsoDate: () => '2026-10-13',
  };
  const row = (id, type, lat, count) => ({
    id, name: id, type, lat, lng: 9, tags: [],
    sources: ['map', 'open_knowledge', 'open_directory'].slice(0, count).map(family => ({
      provider: family, family, tier: 'inferred', url: 'https://source.example/' + id,
    })),
  });
  const roles = selectPlannerRoleCandidates(city, {
    date: '2026-10-13', preferences: ['views', 'food'], include_external_candidates: 1,
  }, {
    experimentalAdmitCandidate: () => null,
    external_provider: { dataset: [row('v1', 'viewpoint', 45.001, 3), row('v2', 'viewpoint', 45.003, 3), row('look', 'lookout', 45.004, 2)] },
  });
  const usable = plannerUsableOptionsForRole(roles.roles.find(role => role.role === 'scenic_anchor'));
  assert.deepEqual(usable.map(candidate => [candidate.candidate_status, candidate.confidence]), [
    ['filled', 'high'], ['filled', 'high'], ['partial', 'medium'],
  ]);
  const result = mapPlannerReservoirToSourceCandidates({
    selected: [{ role: 'scenic_anchor', candidate_id: 'v1', coordinates: { lat: 45.001, lng: 9 } }],
    plannerRoles: roles, perRole: 2, includeCapacityFrontier: false,
  });
  assert.deepEqual(result.map(candidate => candidate.id), ['v1', 'v2']);
});

test('equal coverage sets allow variation independently of metadata order', () => {
  const first = { ...rich('v1', 'viewpoint'), covered_preferences: ['scenic', 'food'] };
  const repeated = { ...rich('v2', 'viewpoint'), covered_preferences: ['scenic', 'food'] };
  const varied = { ...rich('walk', 'promenade'), covered_preferences: ['food', 'scenic'] };
  const roles = { requested_preferences: ['scenic', 'food'], roles: [{ role: 'scenic_anchor', slot: 'anchor', candidates: [first, repeated, varied] }] };
  const result = mapPlannerReservoirToSourceCandidates({ selected: [selection('v1')], plannerRoles: roles, perRole: 2, includeCapacityFrontier: false });
  assert.deepEqual(result.map(candidate => candidate.id), ['v1', 'walk']);
});
