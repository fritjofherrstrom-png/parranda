const test=require('node:test');const assert=require('node:assert/strict');
const {lifecycleLoader}=require('../server/planner/cold-lifecycle');
const {SOURCE_COMPLETION,SOURCE_SNAPSHOT}=require('../server/place-candidates/background-source');
const {composeOpenDataLoaders}=require('../server/place-candidates/open-data-loader');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
const flush=()=>new Promise(r=>setImmediate(r));

test('a real partial map snapshot reaches composition while the directory remains pending, and is memoized',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const slow=deferred();
 const source=[{id:'osm-shop',sources:[{provider:'osm'}]}];Object.defineProperty(source,SOURCE_COMPLETION,{value:slow.promise});
 let reads=0,enrich=0;const loader=async()=>{reads++;return source};loader.enrich=async rows=>{enrich++;return rows};
 const load=lifecycleLoader(loader,{signal:new AbortController().signal,warming(){}},{partialWaitMs:100,reserveMs:0});
 const pending=load({lat:1,lng:2});await flush();t.mock.timers.tick(100);const rows=await pending;
 assert.equal(rows[0],source[0]);assert.equal(rows.loader_metadata.source_completion.status,'partial');assert.equal(enrich,1);
 slow.resolve([{id:'directory-shop'}]);await flush();assert.equal(rows.length,1);
 assert.equal(await load({lat:1,lng:2}),rows);assert.equal(reads,1);
});
test('completion within the bound retains both source families, while late completion cannot mutate publication',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const slow=deferred();const rows=[{id:'map'}];Object.defineProperty(rows,SOURCE_COMPLETION,{value:slow.promise});
 const load=lifecycleLoader(async()=>rows,{signal:new AbortController().signal,warming(){}},{partialWaitMs:100});
 const pending=load({});await flush();slow.resolve([{id:'map'},{id:'directory'}]);const full=await pending;
 assert.equal(full.length,2);t.mock.timers.tick(200);assert.equal(full.length,2);
});
test('snapshot includes an independently completed source without waiting for another stalled source',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const a=deferred(),b=deferred();
 const composed=composeOpenDataLoaders(async()=>[{id:'map'}],null,{eager:true,load:()=>{const rows=[];Object.defineProperty(rows,SOURCE_COMPLETION,{value:a.promise});return rows}}, {eager:true,load:()=>{const rows=[];Object.defineProperty(rows,SOURCE_COMPLETION,{value:b.promise});return rows}});
 const load=lifecycleLoader(composed,{signal:new AbortController().signal,warming(){}},{partialWaitMs:100});
 const pending=load({lat:1,lng:2});await flush();a.resolve([{id:'independent'}]);await flush();t.mock.timers.tick(100);
 const rows=await pending;assert.deepEqual(rows.map(r=>r.id),['map','independent']);assert.equal(rows.loader_metadata.source_completion.pending,1);
 b.resolve([]);
});
test('source status strings and serialized fake snapshot fields cannot inject records',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const rows=[];rows.SOURCE_SNAPSHOT=()=>[{id:'fake'}];rows.source_completion={rows:[{id:'fake'}]};
 const load=lifecycleLoader(async()=>rows,{signal:new AbortController().signal,warming(){}},{partialWaitMs:100});
 assert.equal((await load({})).length,0);
});
test('nested reviewed composition retains independently finished primary source rows',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const a=deferred(),b=deferred();
 const source=work=>({eager:true,load:()=>{const rows=[];Object.defineProperty(rows,SOURCE_COMPLETION,{value:work.promise});return rows}});
 const primary=composeOpenDataLoaders(async()=>[{id:'map'}],source(a),source(b));
 const reviewed=composeOpenDataLoaders(primary,async()=>[{id:'reviewed'}]);
 const load=lifecycleLoader(reviewed,{signal:new AbortController().signal,warming(){}},{partialWaitMs:100});
 const pending=load({lat:1,lng:2});await flush();a.resolve([{id:'finished-primary-source'}]);await flush();t.mock.timers.tick(100);
 const rows=await pending;assert.deepEqual(rows.map(r=>r.id).sort(),['finished-primary-source','map','reviewed']);
 assert.equal(rows.loader_metadata.source_completion.status,'partial');b.resolve([]);
});
test('reviewed-source composition preserves the primary operator check on the whole frozen snapshot',async()=>{
 let checks=0;
 const primary=async()=>[{id:'map'}];primary.enrich=async rows=>{checks++;return rows.map(r=>({...r,checked:true}))};
 const composed=composeOpenDataLoaders(primary,async()=>[{id:'reviewed'}]);
 const load=lifecycleLoader(composed,{signal:new AbortController().signal,warming(){}});
 const rows=await load({lat:1,lng:2});assert.equal(checks,1);
 assert.deepEqual(rows.map(r=>r.id),['map','reviewed']);assert.ok(rows.every(r=>r.checked));
});
test('consumer cancellation is terminal even when partial supply exists',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const work=deferred(),controller=new AbortController();const rows=[{id:'map'}];Object.defineProperty(rows,SOURCE_COMPLETION,{value:work.promise});
 const load=lifecycleLoader(async()=>rows,{signal:controller.signal,warming(){}},{partialWaitMs:100});
 const pending=load({});await flush();controller.abort();await assert.rejects(pending,/planner_cancelled/);work.resolve([]);
});
