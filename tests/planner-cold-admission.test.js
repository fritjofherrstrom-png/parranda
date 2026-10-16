"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createBackgroundSource } = require('../server/place-candidates/background-source');
const { composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');
const { createOperatorVisitEnricher } = require('../server/place-candidates/operator-visit-evidence');

// Controlled source replay, not the uncaptured historic provider/cache frame.
// The observed boundary is matching, geocoded knowledge-only rows while the
// original independent-place job is still outstanding. Use a fresh cache.
const anchor = {lat:48.5,lng:8.5};
const rows = (family, count) => Array.from({length:count},(_,i)=>({
  id:`${family}-${i}`,name:`${family} museum ${i}`,type:'museum',
  lat:anchor.lat+i*.0009,lng:anchor.lng+(i%2)*.001,
  sources:[{provider:family,family,tier:'inferred',url:`https://source.example/${family}/${i}`}],
}));
const input = {place:'Controlled place',dates:['2026-10-17'],preferences:['culture'],day_rhythm:'balanced',
  distance_mode:'no_limit',experimental_agnostic_route_output:1,agnostic_engine_compose:1,include_external_candidates:1};

for (const boundary of ['knowledge_only', 'closed_remaining_day', 'operator_closed']) test(`real HTTP keeps the same cold job pending for ${boundary} matching coordinates`, {timeout:20000}, async t=>{
  const cache=createSourceCache(); let release;let acquisitions=0,primaryCalls=0;
  const work=new Promise(resolve=>{release=resolve;});
  const source=createBackgroundSource({cache,keyFor:()=> 'owned-cold-generation',load:()=>{acquisitions++;return work;}});
  assert.equal(cache.peek('owned-cold-generation'),null,'known empty private cache, not HTTP-based cache inference');
  const supplied=boundary==='knowledge_only' ? rows('open_knowledge',18)
    : boundary==='closed_remaining_day' ? rows('map',18).map(row=>({...row,opening_hours:'Fr 09:00-10:00'}))
    : rows('map',3).map((row,i)=>({...row,name:`Closed Reuse ${i}`,type:'vintage-shop',website:`https://closed-${i}.example/`,source_address:{street:'Oak Street',house_number:'14'}}));
  const loader=composeOpenDataLoaders(async()=>{primaryCalls++;return Object.assign([],{
    loader_status:'error_failed_closed',loader_error:'provider_unavailable',
  });},()=>supplied,source);
  let operatorCalls=0;
  if(boundary==='operator_closed') loader.enrich=createOperatorVisitEnricher({cache:createSourceCache(),
    resolveHost:async()=>[{address:'93.184.216.34',family:4}],fetcher:async url=>{
      operatorCalls++;const row=supplied.find(row=>row.website===url);
      return new Response(`<script type="application/ld+json">{"@type":"WebSite","name":"${row.name}"}</script><main><section><p>Monday, 10:00-18:00 Tuesday, 10:00-18:00 Wednesday, 10:00-18:00 Thursday, 10:00-18:00 Friday, 10:00-18:00 Saturday, Closed Sunday, Closed</p><a href="https://maps.google.com?daddr=Oak%20Street%2014">Directions</a></section></main>`,{headers:{'Content-Type':'text/html'}});
    }});
  const server=buildApp({openDataLoader:loader,eventSupply:null,reviewedPlaceSource:null,
    clock:()=>new Date('2026-10-16T14:00:00Z'),
    weatherProvider:async()=>({timezone_resolution:{timezone:'Europe/Berlin',timezone_source:'weather_provider_auto'}}),
    placeResolver:async()=>[{...anchor,label:'Controlled place',confidence:'high',provenance:'controlled_resolver'}],
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{release([]);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const post=async(path,body)=>{
    const res=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',
      headers:{'content-type':'application/json','Prefer':'respond-async'},body:JSON.stringify(body)});
    return {status:res.status,body:await res.json()};
  };
  const first=await post('/api/route-recommendations?lang=en',{...input,
    preferences:[boundary==='operator_closed'?'second_hand':'culture'],
    dates:[boundary==='closed_remaining_day'?'2026-10-16':'2026-10-17']});
  assert.equal(first.status,202);
  const token=first.body.planner_lifecycle.token;
  // Cross the existing 8s partial-snapshot boundary without changing its value.
  await new Promise(resolve=>setTimeout(resolve,8250));
  const stillPending=await post('/api/planner-status',{token});
  assert.equal(stillPending.status,202,'matching coordinates do not establish admission for the requested day; wait for the same actual producer');
  assert.equal(acquisitions,1);assert.equal(primaryCalls,1);
  release(rows('open_directory',8).map(row=>boundary==='operator_closed'?{...row,type:'vintage-shop'}:row));
  let final;
  for(let i=0;i<20;i++) {
    final=await post('/api/planner-status',{token});
    if(final.status!==202)break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(final.status,200);
  const route=final.body.days?.[0]?.primary_route;
  assert.equal(route?.main_stops?.length,5,'the same balanced request publishes the actual admitted day');
  assert.ok(route.main_stops.every(stop=>stop.id.startsWith('open_directory-')));
  assert.equal(final.body.agnostic_route_output_experiment.source_status.collection.source_completion.status,'complete');
  assert.equal(final.body.agnostic_route_output_experiment.source_status.error,'provider_unavailable','primary source failure remains visible');
  assert.equal(acquisitions,1);assert.equal(primaryCalls,1,'no reacquisition or hidden retry');
  if(boundary==='operator_closed')assert.equal(operatorCalls,3,'the same operator evidence is acquired once and reused');
});
