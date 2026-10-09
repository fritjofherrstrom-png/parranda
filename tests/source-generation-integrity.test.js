'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
const {createBackgroundSource, SOURCE_COMPLETION, SOURCE_SNAPSHOT} = require(root+'/server/place-candidates/background-source');
const {createSourceCache} = require(root+'/server/place-candidates/source-cache');
const {composeOpenDataLoaders} = require(root+'/server/place-candidates/open-data-loader');
const {lifecycleLoader} = require(root+'/server/planner/cold-lifecycle');
const deferred = () => {let resolve; const promise = new Promise(r=>resolve=r); return {resolve,promise};};
const tick = () => new Promise(r=>setImmediate(r));
const anchor = {lat:51.5117,lng:-0.124};
const healthy = () => Object.assign([{id:'osm-1',type:'museum',...anchor}],{loader_status:'loaded:1'});
const empty = () => Object.assign([],{loader_status:'loaded:0'});
const failed = () => Object.assign([],{loader_status:'error_failed_closed',loader_error:'http_non_200'});

test('independent: symbols cannot survive JSON, spreading, or public lookalike keys', async()=>{
 const work=deferred(); const source=createBackgroundSource({cache:createSourceCache(),keyFor:()=> 'one',eager:false,waitForCompletion:false,load:()=>work.promise});
 const initial=await composeOpenDataLoaders(failed,source)(anchor);
 assert.ok(initial[SOURCE_COMPLETION]); assert.equal(Object.getOwnPropertyDescriptor(initial,SOURCE_COMPLETION).enumerable,false);
 assert.equal(JSON.stringify(initial),'[]'); assert.equal([...initial][SOURCE_COMPLETION],undefined); assert.equal({...initial}[SOURCE_COMPLETION],undefined);
 const publicRows=Object.assign([],{trustedSourceCompletion:Promise.resolve([{id:'fake'}])});
 const clean=await composeOpenDataLoaders(()=>publicRows)(anchor); assert.equal(clean[SOURCE_COMPLETION],undefined);
 work.resolve([]); await initial[SOURCE_COMPLETION];
});

test('independent: eager optional healthy-primary must stay nonblocking', async()=>{
 const work=deferred(); let calls=0;
 const source=createBackgroundSource({cache:createSourceCache(),keyFor:()=> 'one',eager:true,waitForCompletion:false,load:()=>{calls++;return work.promise;}});
 const initial=await composeOpenDataLoaders(healthy,source)(anchor);
 work.resolve([{id:'wiki-1',type:'park',...anchor}]);
 if(initial[SOURCE_COMPLETION]) await initial[SOURCE_COMPLETION];
 assert.equal(calls,1); assert.equal(initial[SOURCE_COMPLETION],undefined,'healthy primary must not install a blocking optional completion');
});

test('independent: original failed producer must not be replaced by later successful same-key cache', async()=>{
 const primary=deferred(), old=deferred(); let calls=0;
 const source=createBackgroundSource({cache:createSourceCache(),keyFor:()=> 'one',eager:true,load:()=>++calls===1?old.promise:Promise.resolve([{id:'new-generation',type:'park',...anchor}])});
 const pending=composeOpenDataLoaders(()=>primary.promise,null,source)(anchor);
 await tick(); old.resolve(Object.defineProperty([],'source_error',{value:'fetch_error'})); await tick();
 const next=source.load(anchor,{}); await next[SOURCE_COMPLETION];
 primary.resolve(empty()); const result=await pending;
 const final=result[SOURCE_COMPLETION]?await result[SOURCE_COMPLETION]:result;
 assert.equal(calls,2); assert.equal(final.length,0,'the original generation may only publish its own failed producer, not the later cache');
 assert.equal(final.loader_status,'error_failed_closed'); assert.equal(final.loader_error,'fetch_error');
});

test('independent: shared consumer abort does not kill remaining consumer; last abort forbids late cache publish', async()=>{
 const work=deferred(); let calls=0,producerSignal;
 const cache=createSourceCache(); const source=createBackgroundSource({cache,keyFor:()=> 'one',eager:false,waitForCompletion:false,load:(a,r)=>{calls++;producerSignal=r.signal;return work.promise;}});
 const a=new AbortController(),b=new AbortController();
 const one=source.load(anchor,{signal:a.signal}),two=source.load(anchor,{signal:b.signal});
 assert.equal(one[SOURCE_COMPLETION],two[SOURCE_COMPLETION]); a.abort(); assert.equal(producerSignal.aborted,false); b.abort();assert.equal(producerSignal.aborted,true);
 work.resolve([{id:'late'}]); await one[SOURCE_COMPLETION]; assert.equal(cache.peek('one'),null); assert.equal(calls,1);
});

test('independent: abandoned old completion cannot erase or populate newer operation',async()=>{
 const old=deferred(),newer=deferred(); let calls=0;
 const cache=createSourceCache();const source=createBackgroundSource({cache,keyFor:()=> 'one',load:()=>++calls===1?old.promise:newer.promise});
 const controller=new AbortController();const one=source.load(anchor,{signal:controller.signal});controller.abort();
 const two=source.load(anchor,{});old.resolve([{id:'abandoned'}]);await one[SOURCE_COMPLETION];
 const third=source.load(anchor,{});assert.equal(third[SOURCE_COMPLETION],two[SOURCE_COMPLETION]);assert.equal(cache.peek('one'),null);
 newer.resolve([{id:'current'}]);await two[SOURCE_COMPLETION];assert.equal(cache.peek('one')[0].id,'current');assert.equal(calls,2);
});

test('independent: fulfilled invalid result releases producer bookkeeping for next acquisition',async()=>{
 let calls=0;const source=createBackgroundSource({cache:createSourceCache(),keyFor:()=> 'one',load:()=>++calls===1?null:[{id:'valid'}]});
 const one=source.load(anchor,{});assert.equal(await one[SOURCE_COMPLETION],null);
 const two=source.load(anchor,{});assert.equal((await two[SOURCE_COMPLETION])[0].id,'valid');assert.equal(calls,2);
});

test('independent: non-enumerable failed-empty completion stays failure and rejects secret text',async()=>{
 const source=createBackgroundSource({cache:createSourceCache(),keyFor:()=> 'one',eager:false,waitForCompletion:false,load:()=>Promise.reject(new Error('private credential detail'))});
 const initial=await composeOpenDataLoaders(empty,source)(anchor);const final=await initial[SOURCE_COMPLETION];
 assert.equal(final.loader_status,'error_failed_closed');assert.equal(final.loader_error,'fetch_error');assert.equal(final.loader_metadata.source_completion.failed,1);
 assert.ok(!JSON.stringify(final.loader_metadata).includes('credential'));
});

test('independent: lifecycle budget ends original optional work; no late publication or hidden retry',async()=>{
 const work=deferred();let calls=0;const cache=createSourceCache();
 const source=createBackgroundSource({cache,keyFor:()=> 'one',eager:false,waitForCompletion:false,load:()=>{calls++;return work.promise;}});
 const controller=new AbortController();const deadline=Date.now()+25;
 const load=lifecycleLoader(composeOpenDataLoaders(failed,source),{signal:controller.signal,deadline,warming(){}},{partialWaitMs:5,reserveMs:0});
 const result=await load(anchor);assert.equal(result.length,0);assert.equal(result.loader_error,'http_non_200');assert.equal(result[SOURCE_COMPLETION],undefined);
 controller.abort();work.resolve([{id:'too-late',...anchor}]);await tick();assert.equal(cache.peek('one'),null);assert.equal(calls,1);
});

test('independent: same completion reused by two sources deduplicates rows and progress stays private',async()=>{
 const work=deferred();const source=createBackgroundSource({cache:createSourceCache(),keyFor:()=> 'one',eager:false,load:()=>work.promise});
 const initial=await composeOpenDataLoaders(failed,source,source)(anchor);work.resolve([{id:'shared',type:'park',...anchor}]);const final=await initial[SOURCE_COMPLETION];
 assert.equal(final.length,1);assert.equal(initial[SOURCE_SNAPSHOT]().length,1);assert.equal(final.loader_metadata.source_completion.pending,0);assert.equal(JSON.stringify(final).includes('source_completion'),false);
});

test('nested completion keeps a failed source visible alongside usable primary rows',async()=>{
 const work=deferred();let calls=0;
 const source=createBackgroundSource({cache:createSourceCache(),keyFor:()=> 'nested',eager:false,
  load:()=>{calls++;return work.promise;}});
 const inner=composeOpenDataLoaders(healthy,source);
 const outer=composeOpenDataLoaders(inner,()=>[]);
 const initial=await outer(anchor);
 assert.ok(initial[SOURCE_COMPLETION]);
 work.resolve(Object.defineProperty([],'source_error',{value:'fetch_error'}));
 const final=await initial[SOURCE_COMPLETION];
 assert.equal(final.length,1);
 assert.equal(final.loader_status,'loaded:1');
 assert.equal(final.loader_error,'fetch_error');
 assert.equal(final.loader_metadata.source_completion.failed,1);
 assert.equal(initial[SOURCE_SNAPSHOT]().loader_error,'fetch_error');
 assert.equal(calls,1);
});

test('independent characterization: shared rows and result snapshots are mutable references, not isolated copies',async()=>{
 const work=deferred();const source=createBackgroundSource({cache:createSourceCache(),keyFor:()=> 'one',load:()=>work.promise});
 const initial=await composeOpenDataLoaders(failed,null,source)(anchor);work.resolve([{id:'shared',type:'park',...anchor}]);const final=await initial[SOURCE_COMPLETION];
 final[0].name='consumer mutation';assert.equal(source.readCached(anchor,{})[0].name,'consumer mutation');assert.equal(initial[SOURCE_SNAPSHOT]()[0].name,'consumer mutation');
 assert.equal(Object.getOwnPropertyDescriptor(final,'loader_error').configurable,true);
});
