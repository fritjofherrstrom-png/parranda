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
test('cultural Live upgrade respects standard culture preferences through real engine publication',async t=>{
  const h=await setup(t);
  const initial=await post(h.server,routePath,{...routeBody,preferences:["food","culture","views"]});
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


test('cultural classification supplies only culture fit and never overrides explicit spine verdicts',()=>{
 const {matchesPreferenceFocus}=require('../server/planner/preference-focus');
 const cultural={cultural_tier:'cultural',title:'Concert'};
 assert.equal(matchesPreferenceFocus(cultural,['culture']),true);
 for(const preferences of [['food'],['views'],['second_hand']])assert.equal(matchesPreferenceFocus(cultural,preferences),false);
 assert.equal(matchesPreferenceFocus({...cultural,coveredPreferences:[],partialPreferences:[]},['culture']),false);
 assert.equal(matchesPreferenceFocus({...cultural,cultural_tier:'administrative'},['culture']),false);
 assert.equal(matchesPreferenceFocus({title:'Concert'},['culture']),false);
});
