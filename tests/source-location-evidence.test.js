"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { selectPlannerRoleCandidates } = require('../server/planner/role-selector');

const origin={lat:55.4295,lng:13.8201};
const date='2026-09-30';
function shop(id,lat,lng,tags={}) {
  return mapOsmElement({type:'node',id,lat,lon:lng,tags:{name:'Reuse House',shop:'second_hand',...tags}});
}
function roles(records) {
  const city={key:'source-location-test',label:'Source location test',timezone:'Europe/Stockholm',
    center:origin,catalog:{allItems:[],routeTemplates:[]},routing:{areaDefinitions:{}},todayIsoDate:()=>date};
  return selectPlannerRoleCandidates(city,{date,preferences:['second_hand'],origin,
    include_external_candidates:1,limitPerRole:3},{external_provider:{dataset:()=>records},
    experimentalAdmitCandidate:()=>({allowed:true,policy:'test_admission'})})
    .roles.find(role=>role.role==='vintage_second_hand_option');
}

test('OSM source-owned street and number survive candidate ingestion without becoming operator verification',()=>{
  const row=shop(2,55.4377,13.8334,{'addr:street':'Herrestadsgatan','addr:housenumber':'21',
    website:'https://example.test/shop',opening_hours:'Mo-Fr 11:00-18:00'});
  assert.deepEqual(row.source_address,{street:'Herrestadsgatan',house_number:'21'});
  assert.equal(row.operator_reviewed_source,undefined);
});

test('a free-rhythm composed day has no kilometer-fit verdict and keeps its measured walk',async()=>{
  const {composeAgnosticRouteOutput}=require('../server/planner/agnostic-route-output');
  const rows=[shop(1,55.4298,13.8214,{'addr:street':'Main','addr:housenumber':'1',website:'https://example.test/one',opening_hours:'Mo-Fr 11:00-18:00'}),
    ...[10,11,12].map((id,index)=>mapOsmElement({type:'node',id,lat:55.43+index*.002,lon:13.82+index*.003,tags:{name:`Place ${id}`,wikidata:`Q10${id}`,tourism:index===0?'museum':undefined,amenity:index===1?'restaurant':'cafe'}}))];
  const output=await composeAgnosticRouteOutput({coords:origin,baselineResult:{days:[]},externalRequested:true,
    openDataLoader:async()=>rows,preferences:['second_hand'],date,todayIsoDate:()=> '2026-09-29',
    weatherProvider:async()=>null,walkingKmTarget:null,dayRhythm:'free',distanceMode:'no_limit',
    anchorMode:'coordinates',synthesizeVia:'engine'});
  const route=output.result.days[0]?.primary_route;
  assert.ok(route?.main_stops?.length>=2);
  assert.ok(Number.isFinite(route.estimated_km));
  assert.equal(output.experiment.constraint_negotiation.walking.status,'not_requested');
  assert.equal(route.day_profile,'peak');
});

test('calm rhythm shapes day density without a kilometer target',async()=>{
  const {composeAgnosticRouteOutput}=require('../server/planner/agnostic-route-output');
  const rows=[shop(1,55.4298,13.8214,{'addr:street':'Main','addr:housenumber':'1',website:'https://example.test/one',opening_hours:'Mo-Fr 11:00-18:00'}),
    ...[10,11,12].map((id,index)=>mapOsmElement({type:'node',id,lat:55.43+index*.002,lon:13.82+index*.003,tags:{name:`Place ${id}`,wikidata:`Q10${id}`,tourism:index===0?'museum':undefined,amenity:index===1?'restaurant':'cafe'}}))];
  const output=await composeAgnosticRouteOutput({coords:origin,baselineResult:{days:[]},externalRequested:true,
    openDataLoader:async()=>rows,preferences:['second_hand'],date,todayIsoDate:()=> '2026-09-29',
    weatherProvider:async()=>null,walkingKmTarget:null,dayRhythm:'calm',distanceMode:'no_limit',
    anchorMode:'coordinates',synthesizeVia:'engine'});
  assert.equal(output.result.days[0]?.primary_route?.day_profile,'light');
  assert.equal(output.experiment.constraint_negotiation.walking.status,'not_requested');
});

test('two independently addressed namesake branches stay distinct',()=>{
  const a=shop(1,55.4298,13.8214,{'addr:street':'Main Street','addr:housenumber':'1',
    website:'https://example.test/branch-a',opening_hours:'Mo-Fr 11:00-18:00'});
  const b=shop(2,55.4377,13.8334,{'addr:street':'Side Street','addr:housenumber':'2',
    website:'https://example.test/branch-b',opening_hours:'Mo-Fr 11:00-18:00'});
  assert.deepEqual(new Set(roles([a,b]).candidates.map(candidate=>candidate.candidate_id)),
    new Set(['osm-node-1','osm-node-2']));
});

test('the published day does not route to an addressless namesake when a stronger mapped address exists',async()=>{
  const {composeAgnosticRouteOutput}=require('../server/planner/agnostic-route-output');
  const old=shop(1,55.4298,13.8214,{opening_hours:'Mo 12:00-17:00; We 12:00-17:00'});
  const addressed=shop(2,55.4377,13.8334,{'addr:street':'Herrestadsgatan','addr:housenumber':'21',
    website:'https://example.test/shop',opening_hours:'Mo-Fr 11:00-18:00'});
  const support=[
    {id:10,lat:55.43,lon:13.819,tags:{name:'Museum',tourism:'museum',wikidata:'Q10010'}},
    {id:11,lat:55.434,lon:13.83,tags:{name:'Park',leisure:'park',wikidata:'Q10011'}},
    {id:12,lat:55.431,lon:13.82,tags:{name:'Bistro',amenity:'restaurant',wikidata:'Q10012'}},
    {id:13,lat:55.431,lon:13.822,tags:{name:'Cafe',amenity:'cafe',wikidata:'Q10013'}},
  ].map(element=>mapOsmElement({type:'node',...element}));
  const result=await composeAgnosticRouteOutput({coords:origin,baselineResult:{days:[]},externalRequested:true,
    openDataLoader:async()=>[old,addressed,...support],preferences:['second_hand'],date,
    todayIsoDate:()=> '2026-09-29',weatherProvider:async()=>null,walkingKmTarget:6,
    anchorMode:'coordinates',distanceMode:'soft_target',synthesizeVia:'engine'});
  const stops=result.result.days[0]?.primary_route?.main_stops || [];
  assert.ok(stops.some(stop=>stop.id==='osm-node-2'),JSON.stringify(stops.map(stop=>stop.id)));
  assert.ok(!stops.some(stop=>stop.id==='osm-node-1'));
});

test('a same-name shop with source address and website is not cut solely for being farther from the anchor',()=>{
  const old=shop(1,55.4298,13.8214,{opening_hours:'Mo 12:00-17:00'});
  const corroborated=shop(2,55.4377,13.8334,{'addr:street':'Herrestadsgatan','addr:housenumber':'21',
    website:'https://example.test/shop',opening_hours:'Mo-Fr 11:00-18:00'});
  const fillers=[3,4,5].map((id,i)=>shop(id,55.430+i*.001,13.821+i*.001,{name:`Distinct Shop ${id}`,opening_hours:'Mo-Fr 11:00-18:00'}));
  const selected=roles([old,...fillers,corroborated]).candidates.map(candidate=>candidate.candidate_id);
  assert.ok(selected.includes('osm-node-2'),`addressed sibling was cut: ${selected}`);
  assert.deepEqual(roles([old,corroborated]).candidates.map(candidate=>candidate.candidate_id),['osm-node-2'],
    'an addressless namesake with conflicting coordinates must not route ahead of the stronger mapped location');
});
