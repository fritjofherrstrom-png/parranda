'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createNominatimPlaceResolver}=require('../server/place-candidates/place-resolver');
const captured=require('./fixtures/place-native-admin.json');
function resolverWith(native=captured.native){
 const requests=[];
 const resolver=createNominatimPlaceResolver({minIntervalMs:0,sleep:async()=>{},fetcher:async(url)=>{
  const u=new URL(url);requests.push(u);
  return {ok:true,json:async()=>u.searchParams.has('accept-language')?captured.english:native};
 }});
 return {resolver,requests};
}
test('mixed-language qualified square uses same-identity source-owned native administrative names',async()=>{
 const {resolver,requests}=resolverWith();
 const out=await resolver('Drottningtorget, Göteborg, Sweden',{language:'en'});
 assert.equal(out.length,1);
 assert.equal(out[0].confidence,'medium');
 assert.equal(out[0].osm_ref,'relation/7858199');
 assert.equal(out[0].lat,57.707926);
 assert.equal(requests.length,2);
 assert.ok(requests.every(u=>u.searchParams.get('q')==='Drottningtorget, Göteborg, Sweden'));
 await resolver('Drottningtorget, Göteborg, Sweden',{language:'en'});
 assert.equal(requests.length,2,'answered qualified identity is cached');
});
for (const [name,change] of [
 ['different OSM identity',row=>({...row,osm_id:row.osm_id+999999})],
 ['distant geometry',row=>({...row,lat:String(Number(row.lat)+1)})],
 ['different source country',row=>({...row,address:{...row.address,country_code:'de'}})],
]) test(`native aliases from ${name} cannot qualify the original point`,async()=>{
 const {resolver}=resolverWith(captured.native.map(change));
 const out=await resolver('Drottningtorget, Göteborg, Sweden',{language:'en'});
 assert.ok(out.every(c=>c.confidence==='low'));
});
test('wrong qualifier stays weak even after the same-identity language read',async()=>{
 const {resolver,requests}=resolverWith();
 const out=await resolver('Drottningtorget, Göteborg, Germany',{language:'en'});
 assert.ok(out.every(c=>c.confidence==='low'));
 assert.equal(requests.length,2);
});
test('already corroborated qualified query adds no provider read',async()=>{
 const {resolver,requests}=resolverWith();
 const out=await resolver('Drottningtorget, Gothenburg, Sweden',{language:'en'});
 assert.equal(out[0].confidence,'medium');assert.equal(requests.length,1);
});
test('expired shared budget does not start a native language read',async()=>{
 let clock=0,calls=0;
 const resolver=createNominatimPlaceResolver({timeoutMs:100,minIntervalMs:0,now:()=>clock,
  fetcher:async()=>{calls++;clock=150;return {ok:true,json:async()=>captured.english};}});
 const out=await resolver('Drottningtorget, Göteborg, Sweden',{language:'en'});
 assert.equal(calls,1);assert.ok(out.every(c=>c.confidence==='low'));
});
test('pre-alias cached weak verdict cannot answer the new semantics',async()=>{
 const keys=[];
 const resolver=createNominatimPlaceResolver({minIntervalMs:0,sourceCache:{get:async(key,producer)=>{
  keys.push(key);return key.startsWith('v4:')?{ok:true,candidates:[{confidence:'low'}]}:producer();}},
  fetcher:async url=>({ok:true,json:async()=>new URL(url).searchParams.has('accept-language')?captured.english:captured.native})});
 const out=await resolver('Drottningtorget, Göteborg, Sweden',{language:'en'});
 assert.equal(out[0].confidence,'medium');assert.ok(keys[0].startsWith('v5:'));
});
