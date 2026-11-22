'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPlaceSuggestions}=require('../server/place-candidates/place-suggestions');
const {createPlaceSelectionStore}=require('../server/place-candidates/place-selection');
const {buildApp}=require('../server/app');
const {requestJson}=require('./helpers/planner-reservoir-compare');
const {captures}=require('./fixtures/photon-exonyms-20261101.json');
const expected={Kyoto:['京都市','relation/357794'],Athens:['Αθήνα','node/441183'],Copenhagen:['København','node/13707878'],Munich:['München','relation/62428']};
function replay(query,alter=page=>page) {
 const urls=[];
 const suggestions=createPlaceSuggestions({minIntervalMs:0,fetcher:async url=>{
  const parsed=new URL(url);urls.push(parsed);
  const language=parsed.searchParams.get('lang')||'default';
  return {ok:true,json:async()=>alter(structuredClone(captures[query][language]),language)};
 }});
 return {suggestions,urls};
}
for(const [query,[title,ref]] of Object.entries(expected))test(`${query} finds its source-backed city without translating its display name`,async()=>{
 for(const language of ['en','sv']) {
  const {suggestions,urls}=replay(query);
  const result=await suggestions(query,{language});
  assert.equal(result.status,'ready');
  assert.equal(result.choices[0].candidate.osm_ref,ref);
  assert.equal(result.choices[0].title,title);
  assert.equal(result.choices.length,5);
  assert.ok(result.choices.some(c=>c.candidate.admin_context.country_code!==result.choices[0].candidate.admin_context.country_code),'same-name alternatives remain selectable');
  assert.deepEqual(urls.map(u=>u.searchParams.get('lang')),[null,'en']);
  await suggestions(query,{language});assert.equal(urls.length,2,'the complete result is cached');
 }
});
test('alternate names never join across another OSM identity, class, kind or geographic point',async()=>{
 for(const change of [p=>{p.properties.osm_id=999;},p=>{p.geometry.coordinates=[0,0];},p=>{p.properties.osm_key='boundary';},p=>{p.properties.type='county';}]) {
  const {suggestions}=replay('Kyoto',(page,lang)=>{if(lang==='en')change(page.features.find(f=>f.properties.osm_id===357794));return page;});
  const result=await suggestions('Kyoto');
  assert.equal(result.choices[0].candidate.osm_ref,'way/1268003379');
 }
});
test('alternate page failure keeps canonical choices and does not cache degraded ranking',async()=>{
 let english=0;
 const suggestions=createPlaceSuggestions({minIntervalMs:0,fetcher:async url=>{
  const lang=new URL(url).searchParams.get('lang');
  if(lang&&++english===1)return {ok:false,status:503};
  return {ok:true,json:async()=>captures.Kyoto[lang||'default']};
 }});
 const first=await suggestions('Kyoto');assert.equal(first.status,'ready');assert.equal(first.choices[0].title,'Kyoto');
 const recovered=await suggestions('Kyoto');assert.equal(recovered.choices[0].title,'京都市');
 assert.equal(english,2);
});
test('the ranked native identity stays bound to its qualified receipt at the HTTP boundary',async()=>{
 const {suggestions}=replay('Athens');const store=createPlaceSelectionStore();
 const server=buildApp({placeSuggestions:suggestions,placeSelectionStore:store,openDataLoader:null,eventSupply:null}).listen(0);
 try {
  const {body}=await requestJson(server,{path:'/api/place-suggestions?lang=en',body:{query:'Athens',aliases:['forged'],lat:0,lng:0}});
  const city=body.choices[0];assert.equal(city.place_ref,'n441183');assert.equal(city.title,'Αθήνα');
  assert.equal(store.read(city.selection_id,city.query).osm_ref,'node/441183');
  assert.equal(store.read(city.selection_id,'Athens'),null);
  assert.equal('aliases' in city,false);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('cancellation during the alternate page retains the native serial slot until transport settles',async()=>{
 let release,entered;const blocked=new Promise(resolve=>{release=resolve;});const secondStarted=new Promise(resolve=>{entered=resolve;});
 const urls=[];let alternateSignal;
 const suggestions=createPlaceSuggestions({minIntervalMs:0,timeoutMs:80,fetcher:async(url,{signal})=>{
  const language=new URL(url).searchParams.get('lang');urls.push(url);
  if(language){alternateSignal=signal;entered();await blocked;}
  return {ok:true,json:async()=>captures.Kyoto[language||'default']};
 }});
 const controller=new AbortController();const first=suggestions('Kyoto',{signal:controller.signal});
 await secondStarted;
 try {
  const queued=suggestions('newest');controller.abort();
  assert.equal((await first).status,'unavailable');assert.equal(alternateSignal.aborted,true);
  assert.equal((await queued).status,'unavailable');
  assert.equal(urls.length,2,'a second native query must not overlap the unsettled alternate request');
 }finally{release();}
 assert.equal((await suggestions('newest')).status,'ready','settled cancellation releases the native slot for subsequent work');
 assert.equal(urls.length,4,'the fresh query can complete both bounded pages after the expired queued owner');
});
