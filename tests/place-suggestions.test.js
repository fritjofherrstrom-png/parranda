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
// Shapes recorded from live Photon reads on 2026-10-08 (no network here).
const place=(name,osm_value,type,id,country='Country',osm_key='place')=>({type:'Feature',geometry:{type:'Point',coordinates:[13+id%100/100,55+id%100/100]},properties:{name,state:`State ${id}`,country,countrycode:'XX',type,osm_key,osm_value,osm_type:'R',osm_id:id}});
test('a major city survives same-name hamlets that the provider ranks first',async()=>{
 const urls=[];
 const page=[place('Malmo','village','city',1),place('Malmo','village','city',2),place('Malmo','hamlet','district',3),place('Malmoe','administrative','district',4,'Country','boundary'),
  place('Malmö','city','city',5,'Sverige'),place('Malmo Plains','quarter','locality',6),place('Malmok','hamlet','district',7),place('Malmø','suburb','district',8)];
 const out=await provider(page,urls)('Malmo');
 assert.equal(urls[0].searchParams.get('limit'),'20');
 assert.deepEqual(out.choices.map(choice=>choice.title),['Malmö','Malmo','Malmo','Malmo','Malmoe']);
});
test('a major city beyond the visible five is lifted instead of cut off',async()=>{
 const page=[place('Gotem','village','city',1),place('Gotein','administrative','locality',2,'Country','boundary'),place('Gotești','village','district',3),
  place('Gotelp','village','city',4),place('Gotebo','town','city',5),place('Göteborg','city','city',6,'Sverige'),place('Göteborgs Stad','municipality','city',7,'Sverige')];
 const out=await provider(page)('Gote');
 assert.equal(out.choices[0].title,'Göteborg');assert.equal(out.choices.length,5);
});
test('an exonym query keeps the major city that only matched another language name',async()=>{
 const towns=Array.from({length:10},(_,i)=>place('Lisbon',i%2?'village':'town','city',i+1,'United States'));
 const out=await provider([...towns,place('Lisboa','city','city',11,'Portugal'),place('Lisboa','administrative','county',12,'Portugal','boundary')])('Lisbon');
 assert.equal(out.choices[0].title,'Lisboa');assert.equal(out.choices[0].kind,'settlement');
});
test('without a major place the provider order is kept, so neighbourhood searches are not reshuffled',async()=>{
 const page=[place('Montmartre','suburb','locality',1,'France'),place('Montmartre','village','city',2,'Canada'),place('Montmartre No. 126','administrative','county',3,'Canada','boundary'),place('Montmartre','hamlet','district',4,'France')];
 const out=await provider(page)('Montmartre');
 assert.deepEqual(out.choices.map(choice=>choice.context.split(' · ').pop()),['France','Canada','Canada','France']);
});
test('a same-name region and city stay separate identities and the public row says which is which',async()=>{
 const region=place('Lisbon','administrative','county',2897141,'Portugal','boundary');
 const city=place('Lisbon','city','city',5400890,'Portugal');
 const app=buildApp({placeSuggestions:provider([region,city])});const server=app.listen(0);
 try{
  const out=await requestJson(server,{path:'/api/place-suggestions?lang=en',body:{query:'Lisbon'}});
  assert.deepEqual(out.body.choices.map(choice=>[choice.title,choice.kind,choice.place_ref]),[['Lisbon','settlement','r5400890'],['Lisbon','region','r2897141']]);
  assert.equal(out.body.choices.some(choice=>'major' in choice),false);
 }finally{await new Promise(r=>server.close(r));}
});
test('a trusted city node can use its registry pack without inventing missing area bounds',async()=>{
 const city=feature('Rome',null,41.9,30);city.geometry.coordinates=[12.5,41.9];city.properties.type='city';city.properties.osm_value='city';delete city.properties.extent;
 const app=buildApp({placeSuggestions:provider([city])});const server=app.listen(0);
 try{const out=await requestJson(server,{path:'/api/place-suggestions?lang=en',body:{query:'rom'}});assert.equal(out.body.choices[0].city_key,'rome');}
 finally{await new Promise(r=>server.close(r));}
});
