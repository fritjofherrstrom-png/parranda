'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPlaceSuggestions}=require('../server/place-candidates/place-suggestions');
const {createPlaceSelectionStore}=require('../server/place-candidates/place-selection');
const {buildApp}=require('../server/app');
const {requestJson}=require('./helpers/planner-reservoir-compare');
const feature=(name,city,lat,id=1)=>({type:'Feature',geometry:{type:'Point',coordinates:[2.32,lat]},properties:{name,city,country:'Country',countrycode:'XX',type:'district',osm_key:'place',osm_value:'suburb',osm_type:'R',osm_id:id,extent:[2.31,lat+.01,2.33,lat-.01]}});
const rows=[feature('Harbour Quarter','First City',48.85),feature('Harbour Quarter','Second City',51.5,2)];
function provider(features=rows,urls=[]) {return createPlaceSuggestions({minIntervalMs:0,fetcher:async url=>{urls.push(new URL(url));return {ok:true,json:async()=>({features})};}});}
test('prefix suggestions have short source-backed context and district bounds',async()=>{
 const result=await provider()('har',{language:'en'});
 assert.equal(result.status,'ready');assert.equal(result.choices[0].title,'Harbour Quarter');assert.equal(result.choices[0].context,'First City · Country');
 assert.equal(result.choices[0].candidate.spatial_scope.source,'photon_bounds');assert.equal(result.choices[0].candidate.spatial_scope.kind,'district');
});
test('short prefixes do not fetch; repeated queries coalesce and cache; consented context biases without restricting country',async()=>{
 const urls=[];const p=provider(rows,urls);
 assert.deepEqual((await p('ha')).choices,[]);
 await Promise.all([p('har',{language:'sv',near:{lat:51.5,lng:2.32}}),p('har',{language:'sv',near:{lat:51.5,lng:2.32}})]);
 assert.equal(urls.length,1);assert.equal(urls[0].searchParams.get('lang'),null);assert.equal(urls[0].searchParams.get('lat'),'51.5');assert.equal(urls[0].searchParams.get('countrycode'),null);
 await p('har',{language:'en'});assert.equal(urls.length,2);
});
test('stations, malformed geometry and duplicate identities cannot become place choices',async()=>{
 const station=feature('Harbour Station','First City',48.85,3);station.properties.type='other';station.properties.osm_key='railway';station.properties.osm_value='station';
 const bad=feature('Broken','First City',400,4);
 const out=await provider([station,bad,rows[0],rows[0]])('har');assert.equal(out.choices.length,1);
});
test('API issues a query-bound receipt and selected prefix result anchors Blitz without another geocode',async()=>{
 const store=createPlaceSelectionStore();let searches=0;
 const app=buildApp({placeSuggestions:provider(),placeSelectionStore:store,placeResolver:async()=>{searches++;return[];},openDataLoader:null,eventSupply:null,weatherProvider:async()=>null});
 const server=app.listen(0);
 try {
  const out=await requestJson(server,{path:'/api/place-suggestions?lang=en',body:{query:'har',lat:99,candidates:[{}]}});assert.equal(out.status,200);
  const choice=out.body.choices[1];assert.equal(choice.title,'Harbour Quarter');assert.ok(store.read(choice.selection_id,choice.query));
  const day=await requestJson(server,{path:'/api/blitz?anywhere_blitz=1',body:{place:choice.query,place_selection:choice.selection_id}});
  assert.equal(day.body.intake.resolved.label,choice.query);assert.equal(searches,0);
 } finally {await new Promise(r=>server.close(r));}
});
test('provider failure is unavailable rather than an empty search',async()=>{
 const p=createPlaceSuggestions({minIntervalMs:0,fetcher:async()=>{throw Error('offline');}});
 const out=await p('har');assert.equal(out.status,'unavailable');assert.deepEqual(out.choices,[]);
});
test('only verified context biases a lookup, never caller coordinates or a forged receipt',async()=>{
 const store=createPlaceSelectionStore();const contexts=[];
 const app=buildApp({placeSelectionStore:store,placeSuggestions:async(q,context)=>{contexts.push(context);return {status:'ready',choices:[]};}});
 const server=app.listen(0);try{
  await requestJson(server,{path:'/api/place-suggestions',body:{query:'har',context_selection:'forged',lat:51.5,lng:2.32}});
  assert.equal(contexts[0].near,undefined);
  const token=store.issue({label:'Previous place',lat:51.5,lng:2.32,confidence:'medium'},'Previous place');
  await requestJson(server,{path:'/api/place-suggestions',body:{query:'new',context_selection:token}});
  assert.deepEqual(contexts[1].near,{lat:51.5,lng:2.32});
 }finally{await new Promise(r=>server.close(r));}
});
test('registered city identity requires a nearby geographic settlement, not just its name',async()=>{
 const city=feature('Rome','Rome',41.9,3);city.geometry.coordinates=[12.5,41.9];city.properties.type='city';city.properties.extent=[12.4,42,12.6,41.8];
 const remote=structuredClone(city);remote.geometry.coordinates=[2.32,51.5];remote.properties.osm_id=4;
 const app=buildApp({placeSuggestions:provider([city,remote])});const server=app.listen(0);
 try{const out=await requestJson(server,{path:'/api/place-suggestions?lang=en',body:{query:'rom'}});assert.equal(out.body.choices[0].city_key,'rome');assert.equal(out.body.choices[1].city_key,undefined);}
 finally{await new Promise(r=>server.close(r));}
});
test('hung response bodies time out and release the provider queue',async()=>{
 let count=0;
 const p=createPlaceSuggestions({minIntervalMs:0,timeoutMs:10,fetcher:async()=>{count++;return {ok:true,json:()=>count===1?new Promise(()=>{}):Promise.resolve({features:rows})};}});
 assert.equal((await p('har')).status,'unavailable');assert.equal((await p('new')).status,'ready');
});
test('same-name localities in same-name counties retain their distinct states in labels and context',async()=>{
 const a=feature('Washington',null,48.85,10);Object.assign(a.properties,{county:'Washington County',state:'First State',country:'United States'});
 const b=structuredClone(a);Object.assign(b.properties,{osm_id:11,state:'Second State'});
 const out=await provider([a,b])('wash');assert.notEqual(out.choices[0].query,out.choices[1].query);assert.match(out.choices[0].context,/First State/);assert.match(out.choices[1].context,/Second State/);
});
test('prefix cache stays in bounded memory even when the deployment has a persistent cache directory',async()=>{
 const fs=require('node:fs');const path=require('node:path');const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'suggestion-cache-'));
 try{const p=createPlaceSuggestions({cacheDir:dir,minIntervalMs:0,fetcher:async()=>({ok:true,json:async()=>({features:rows})})});await p('har');assert.deepEqual(fs.readdirSync(dir),[]);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('a trusted city node can use its registry pack without inventing missing area bounds',async()=>{
 const city=feature('Rome',null,41.9,30);city.geometry.coordinates=[12.5,41.9];city.properties.type='city';city.properties.osm_value='city';delete city.properties.extent;
 const app=buildApp({placeSuggestions:provider([city])});const server=app.listen(0);
 try{const out=await requestJson(server,{path:'/api/place-suggestions?lang=en',body:{query:'rom'}});assert.equal(out.body.choices[0].city_key,'rome');}
 finally{await new Promise(r=>server.close(r));}
});
