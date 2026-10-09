'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateAgnosticWalkingOrder}=require('../server/planner/agnostic-route-walking-validation');
const {routeWalkingPath}=require('../server/walking-router');
const stops=[{lat:51.51,lng:-0.14},{lat:51.52,lng:-0.13},{lat:51.53,lng:-0.12}];
const router=(total,distances)=>async points=>({source:'osrm',estimatedKm:total,legs:distances.map(distance_km=>({distance_km,estimated_walk_minutes:30})),pathPoints:points,fallbackUsed:false});
test('walking integrity rejects a claimed 1km total with 12km legs',async()=>{
 const out=await validateAgnosticWalkingOrder({stops,targetKm:4,walkingRouter:router(1,[6,6])});
 assert.equal(out.valid,false);assert.equal(out.result,null);
});
test('walking integrity rejects contradictory native OSRM transport',async()=>{
 const original=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({routes:[{distance:1000,legs:[{distance:6000,duration:3600},{distance:6000,duration:3600}],geometry:{coordinates:stops.map(p=>[p.lng,p.lat])}}]})});
 try{const out=await validateAgnosticWalkingOrder({stops,targetKm:4,walkingRouter:routeWalkingPath,walkingConfig:{defaultProvider:'osrm'}});assert.equal(out.valid,false);assert.equal(out.result,null);}finally{global.fetch=original;}
});
test('walking integrity permits independent tenth-kilometre rounding',async()=>{
 const out=await validateAgnosticWalkingOrder({stops,walkingRouter:router(1.1,[0.5,0.5])});assert.equal(out.valid,true);assert.equal(out.result.estimatedKm,1.1);
});
test('walking budget uses the larger attested sum at rounding boundary',async()=>{
 const out=await validateAgnosticWalkingOrder({stops,budget:{totalKm:5.4},walkingRouter:router(5.4,[2.7,2.8])});assert.equal(out.valid,false);assert.deepEqual(out.blockers,['walking_budget_exceeded']);
});
const withPath=path=>async points=>({...await router(1,[0.5,0.5])(points),pathPoints:path});
for(const [name,path] of [
 ['unrelated path',stops.map(()=>({lat:0,lng:0}))],
 ['reversed endpoints',[...stops].reverse()],
 ['missing middle stop',[stops[0],stops[0],stops[2]]],
 ['remote start',[{lat:51.6,lng:-0.14},stops[1],stops[2]]],
 ['coercible null latitude',[{lat:null,lng:-0.14},stops[1],stops[2]]],
])test('walking path integrity rejects '+name,async()=>{
 const out=await validateAgnosticWalkingOrder({stops,walkingRouter:withPath(path)});assert.equal(out.valid,false);assert.deepEqual(out.blockers,['invalid_walking_path_points']);
});
test('walking path permits small real-world endpoint snapping',async()=>{
 const path=stops.map(p=>({...p,lat:p.lat+0.0001}));const out=await validateAgnosticWalkingOrder({stops,walkingRouter:withPath(path)});assert.equal(out.valid,true);
});
test('walking path supports returning to exact user start after stops',async()=>{
 const loop=[...stops,stops[0]];const out=await validateAgnosticWalkingOrder({stops:loop,walkingRouter:async points=>({...await router(1.5,[0.5,0.5,0.5])(points),pathPoints:points})});assert.equal(out.valid,true);
});
