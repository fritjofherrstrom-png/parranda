const test=require('node:test');
const assert=require('node:assert/strict');
const {buildApp}=require('../server/app');
const {createPlaceSelectionStore}=require('../server/place-candidates/place-selection');
const {requestJson}=require('./helpers/planner-reservoir-compare');
const {executeLiveEventQuery}=require('../server/place-candidates/live-event-query');
const choices=[{label:'Harbour, First City',lat:48.85,lng:2.32},{label:'Harbour, Second City',lat:51.5,lng:2.32}].map(x=>({...x,confidence:'medium',provenance:'fixture',spatial_scope:{kind:'district',bounds:{south:x.lat-.01,north:x.lat+.01,west:2.31,east:2.33}}}));
const payload={place:'Harbour',dates:['2026-10-07'],day_rhythm:'balanced',experimental_agnostic_route_output:1};

test('Planner choice is reused by Planner and Blitz even when provider order changes',async()=>{
 let searches=0;const app=buildApp({placeResolver:async()=>{searches++;return choices;},openDataLoader:null,eventSupply:null,weatherProvider:async()=>null});
 const server=app.listen(0);
 try {
   const initial=await requestJson(server,{path:'/api/route-recommendations',body:payload});
   const token=initial.body.agnostic_route_output_experiment.intake.candidates[1].selection_id;
   assert.ok(token);
   const selected=await requestJson(server,{path:'/api/route-recommendations',body:{...payload,place_selection:token}});
   assert.equal(selected.body.agnostic_route_output_experiment.intake.resolved.label,'Harbour, Second City');
   const blitz=await requestJson(server,{path:'/api/blitz?anywhere_blitz=1',body:{place:'Harbour',place_selection:token}});
   assert.equal(blitz.body.intake.resolved.label,'Harbour, Second City');
   assert.equal(searches,1);
 } finally { await new Promise(r=>server.close(r)); }
});
test('Live attests selected area instead of re-resolving an ambiguous name',async()=>{
 const store=createPlaceSelectionStore();const selection=store.issue(choices[1],'Harbour');let called=0;
 const eventSupply=async()=>{called++;return {events:[],source_status:[]};};
 const out=await executeLiveEventQuery({payload:{scope:'in_place',time:'this_week',anchor:{lat:51.5,lng:2.32},place_query:'Harbour',place_selection:selection},eventSupply,now:'2026-10-07T12:00:00Z',placeSelectionStore:store,placeResolver:()=>{throw Error('must not search');}});
 assert.equal(out.status,200);assert.equal(out.body.query.discovery_scope,'resolved_area');assert.equal(called,1);
 const bad=await executeLiveEventQuery({payload:{scope:'around_place',anchor:{lat:51.5,lng:2.32},place_query:'Harbour',place_selection:selection+'x'},eventSupply,placeSelectionStore:store,now:'2026-10-07T12:00:00Z'});
 assert.equal(bad.status,400);assert.equal(called,1);
});
test('Live retains a valid selected point without inventing an administrative scope',async()=>{
 const store=createPlaceSelectionStore();const point={label:'Theatre Hall',lat:51.5,lng:2.32,confidence:'medium',provenance:'fixture'};
 const selection=store.issue(point,'Theatre Hall');let called=0;
 const eventSupply=async()=>{called++;return {events:[],source_status:[]};};
 const payload={scope:'around_place',anchor:{lat:51.5,lng:2.32},place_query:'Theatre Hall',place_selection:selection};
 const out=await executeLiveEventQuery({payload,eventSupply,placeSelectionStore:store,now:'2026-10-07T12:00:00Z'});
 assert.equal(out.status,200);assert.equal(out.body.query.discovery_scope,'local');assert.equal(called,1);
 const area=await executeLiveEventQuery({payload:{...payload,scope:'in_place'},eventSupply,placeSelectionStore:store,now:'2026-10-07T12:00:00Z'});
 assert.equal(area.status,400);assert.equal(area.body.error,'place_scope_unavailable');assert.equal(called,1);
 const drift=await executeLiveEventQuery({payload:{...payload,anchor:{lat:10,lng:20}},eventSupply,placeSelectionStore:store,now:'2026-10-07T12:00:00Z'});
 assert.equal(drift.status,400);assert.equal(called,1);
});
test('Live rejects empty or non-string choice fields before collecting events',async()=>{
 let called=0;
 for(const selection of ['',false,0,null]) {
  const out=await executeLiveEventQuery({payload:{scope:'around_place',anchor:{lat:51.5,lng:2.32},place_query:'Harbour',place_selection:selection},eventSupply:async()=>{called++;return {events:[]};}});
  assert.equal(out.status,400);
 }
 assert.equal(called,0);
});
