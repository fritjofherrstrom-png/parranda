'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildOvertureQuery,createOvertureSource}=require('../server/place-candidates/overture-source');
const release='2026-09-23.1';
const asset=id=>`s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/part-${id}-aaaa-c000.zstd.parquet`;
test('SQL reads every explicitly selected release asset and never the wildcard',()=>{
 const sql=buildOvertureQuery({release,lat:51.5117,lng:-0.124,parquetPaths:[asset('00007'),asset('00008')]});
 assert.ok(!sql.includes('type=place/*'),sql);assert.ok(sql.includes(asset('00007')));assert.ok(sql.includes(asset('00008')));assert.match(sql,/LIMIT 600/);assert.match(sql,/confidence >= 0.950/);
});
test('source acquisition resolves the entire window before its one native query',async()=>{
 let calls=0,sql=null,selection=null;
 const source=createOvertureSource({releaseResolver:async()=>release,assetResolver:async r=>{calls++;selection=r;return [asset('00007')];},queryRows:async q=>{sql=q;return [];}});
 await source.acquire({lat:51.5117,lng:-0.124});
 assert.equal(calls,1);assert.equal(selection.radiusKm,5);assert.equal(selection.release,release);assert.ok(sql.includes(asset('00007')));assert.ok(!sql.includes('type=place/*'));
});
function fixtureFetcher(boxes,{failId=null,change=null}={}){
 const calls=[];const fetcher=async url=>{calls.push(url);const m=url.match(/\/(\d{5})\/\1\.json$/);
  if(m){const id=m[1];if(id===failId)return new Response('{}',{status:503});const item={id,bbox:boxes[Number(id)],assets:{aws:{alternate:{s3:{href:asset(id)}}}}};if(change)change(item);return Response.json(item);}
  return Response.json({id:'place',links:boxes.map((_,i)=>{const id=String(i).padStart(5,'0');return {rel:'item',href:`https://stac.overturemaps.org/${release}/places/place/${id}/${id}.json`};})});};return {fetcher,calls};
}
test('default window selection includes the adjacent file even when it does not contain the anchor',async()=>{
 const {fetcher,calls}=fixtureFetcher([[-1,50,0,52],[0,50,1,52],[10,10,11,11]]);let sql;
 const source=createOvertureSource({releaseResolver:async()=>release,assetFetcher:fetcher,queryRows:async q=>{sql=q;return [];}});
 await source.acquire({lat:51,lng:-0.01});assert.equal(calls.length,4);assert.ok(sql.includes(asset('00000')));assert.ok(sql.includes(asset('00001')));assert.ok(!sql.includes(asset('00002')));assert.ok(!sql.includes('type=place/*'));
});
test('missing asset evidence is failed rather than silently restoring the wildcard',async()=>{
 let queries=0;const source=createOvertureSource({releaseResolver:async()=>release,assetResolver:async()=>null,queryRows:async()=>{queries++;return [];}});
 const rows=await source.acquire({lat:51,lng:0});assert.equal(rows.source_error,'fetch_error');assert.equal(queries,0);
});
const {createOvertureAssetResolver}=require('../server/place-candidates/overture-stac-assets');
test('all dateline window parts select both east and west files',async()=>{
 const {fetcher}=fixtureFetcher([[179,-1,180,1],[-180,-1,-179,1],[0,-1,1,1]]);const resolve=createOvertureAssetResolver({fetcher});
 assert.deepEqual(await resolve({release,lat:0,lng:179.99,radiusKm:5}),[asset('00000'),asset('00001')]);
 assert.deepEqual(await resolve({release,lat:0,lng:-179.99,radiusKm:5}),[asset('00000'),asset('00001')]);
});
test('immutable release cache is reused but file choice is recomputed for each anchor',async()=>{
 const {fetcher,calls}=fixtureFetcher([[-1,50,0,52],[0,50,1,52]]);const resolve=createOvertureAssetResolver({fetcher});
 assert.deepEqual(await resolve({release,lat:51,lng:-0.5,radiusKm:5}),[asset('00000')]);
 assert.deepEqual(await resolve({release,lat:51,lng:0.5,radiusKm:5}),[asset('00001')]);assert.equal(calls.length,3);
});
for(const [name,change]of [['coercible bbox',item=>{item.bbox[0]=null;}],['external asset',item=>{item.assets.aws.alternate.s3.href='s3://evil/part-x.zstd.parquet';}],['other release',item=>{item.assets.aws.alternate.s3.href=asset(item.id).replace(release,'2026-08-19.0');}],['mismatched identity',item=>{item.id='99999';}]])test(name+' cannot cause native acquisition',async()=>{
 const {fetcher}=fixtureFetcher([[-1,50,1,52]],{change});let queries=0;
 const source=createOvertureSource({releaseResolver:async()=>release,assetFetcher:fetcher,queryRows:async()=>{queries++;return [];}});
 const records=await source.acquire({lat:51,lng:0});assert.equal(records.source_error,'fetch_error');assert.equal(queries,0);
});
test('one unread item makes the complete manifest unavailable, even if another item overlaps',async()=>{
 const {fetcher}=fixtureFetcher([[-1,50,1,52],[20,20,21,21]],{failId:'00001'});let queries=0;
 const source=createOvertureSource({releaseResolver:async()=>release,assetFetcher:fetcher,queryRows:async()=>{queries++;return [];}});
 const records=await source.acquire({lat:51,lng:0});assert.equal(records.source_error,'fetch_error');assert.equal(queries,0);
});
test('complete manifest with no overlapping file is healthy empty without a query',async()=>{
 const {fetcher}=fixtureFetcher([[20,20,21,21]]);let queries=0;
 const source=createOvertureSource({releaseResolver:async()=>release,assetFetcher:fetcher,queryRows:async()=>{queries++;return [];}});
 const records=await source.acquire({lat:51,lng:0});assert.equal(records.length,0);assert.equal(records.source_error,undefined);assert.equal(queries,0);
});
test('metadata deadline aborts outstanding transport and does not cache failure',async()=>{
 let calls=0,aborts=0;const resolve=createOvertureAssetResolver({timeoutMs:10,fetcher:async(_u,{signal})=>{calls++;return new Promise((_r,reject)=>signal.addEventListener('abort',()=>{aborts++;reject(new Error('aborted'));},{once:true}));}});
 await assert.rejects(resolve({release,lat:51,lng:0,radiusKm:5}));await assert.rejects(resolve({release,lat:51,lng:0,radiusKm:5}));assert.equal(calls,2);assert.equal(aborts,2);
});
test('an already cancelled window performs no metadata or native work',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 const source=createOvertureSource({releaseResolver:async()=>release,assetFetcher:async()=>{calls++;return Response.json({});},queryRows:async()=>{calls++;return [];}});
 assert.equal((await source.acquire({lat:51,lng:0,signal:controller.signal})).source_error,'fetch_error');assert.equal(calls,0);
});
for(const bad of ['s3://evil/part-x.zstd.parquet',asset('00000')+"' OR true --",asset('00000').replace(release,'2026-08-19.0')])test('SQL refuses untrusted explicit asset '+bad,()=>{assert.equal(buildOvertureQuery({release,lat:51,lng:0,parquetPaths:[bad]}),null);});
