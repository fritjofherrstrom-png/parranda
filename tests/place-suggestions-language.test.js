'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPlaceSuggestions}=require('../server/place-candidates/place-suggestions');
const {createPlaceSelectionStore}=require('../server/place-candidates/place-selection');
const {buildApp}=require('../server/app');
const {requestJson}=require('./helpers/planner-reservoir-compare');
const {captures}=require('./fixtures/photon-suggestion-language-20261017.json');

test('UI language never forces translated source names in geographic suggestions',async()=>{
 for(const language of ['en','de','fr','sv']) {
  const urls=[];
  const suggestions=createPlaceSuggestions({minIntervalMs:0,fetcher:async url=>{
   urls.push(new URL(url));return {ok:true,json:async()=>captures.default.response};
  }});
  const result=await suggestions('Göteborg',{language,near:{lat:57.707,lng:11.967}});
  assert.equal(result.status,'ready');
  assert.equal(result.choices[0].candidate.osm_ref,'node/25930131');
  assert.equal(urls.length,1,'one request per query, without a language fallback');
  assert.equal(urls[0].searchParams.get('lang'),null,`${language} UI must retain source-owned local names`);
  assert.equal(urls[0].searchParams.get('q'),'Göteborg');
  assert.equal(urls[0].searchParams.get('limit'),'20');
  assert.deepEqual(urls[0].searchParams.getAll('layer'),['city','district','locality','county','state','country']);
  assert.equal(urls[0].searchParams.get('lat'),'57.71');
  assert.equal(urls[0].searchParams.get('lon'),'11.97');
  assert.equal(urls[0].searchParams.get('zoom'),'12');
 }
});

test('English UI with a native query preserves the actual city and its receipt through the suggestions endpoint',async()=>{
 let calls=0;
 const suggestions=createPlaceSuggestions({minIntervalMs:0,fetcher:async url=>{
  calls++;
  // Replay the recorded provider boundary: English requests return Gothenburg;
  // the default response owns the visible name Göteborg. No alias is invented.
  const capture=new URL(url).searchParams.get('lang')==='en'?captures.en:captures.default;
  return {ok:true,json:async()=>capture.response};
 }});
 const store=createPlaceSelectionStore();
 const app=buildApp({placeSuggestions:suggestions,placeSelectionStore:store,openDataLoader:null,eventSupply:null});
 const server=app.listen(0);
 try {
  const out=await requestJson(server,{path:'/api/place-suggestions?lang=en',body:{query:'Göteborg'}});
  assert.equal(out.status,200);assert.equal(out.body.status,'ready');
  assert.deepEqual(out.body.choices.map(choice=>choice.place_ref),['n25930131','n7449085107','n1966563820','n7457150514','r935611']);
  const city=out.body.choices[0];
  assert.equal(city.title,'Göteborg');assert.equal(city.kind,'settlement');
  assert.equal(city.query,'Göteborg, Västra Götalands län, Sverige');
  const selected=store.read(city.selection_id,city.query);
  assert.equal(selected.osm_ref,'node/25930131');assert.equal(selected.osm_class,'place');
  assert.equal(selected.lat,57.7072326);assert.equal(selected.lng,11.9670171);
  assert.equal(store.read(city.selection_id,'Göteborgs Stad'),null,'receipt stays bound to its actual query');
  assert.equal(calls,1,'the corrected choice does not require another provider lookup');
 } finally {await new Promise(resolve=>server.close(resolve));}
});
