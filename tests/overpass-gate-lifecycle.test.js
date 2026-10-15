'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createOpenDataLoader}=require('../server/place-candidates/open-data-loader');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const rich=()=>({ok:true,status:200,json:async()=>({elements:Array.from({length:15},(_,i)=>({
  type:'node',id:i+1,lat:41.9+i*.001,lon:12.5,tags:{name:`Place ${i}`,...[{amenity:'cafe'},{amenity:'bar'},{tourism:'museum'},{leisure:'park'}][i%4]},
}))})});

test('Overpass queue wait consumes the same elapsed budget as its transport',async()=>{
  const entered=deferred(),release=deferred();let elapsed=0,calls=0;
  const loader=createOpenDataLoader({timeoutMs:100,elapsedNow:()=>elapsed,fetcher:async()=>{
    calls++;if(calls===1){entered.resolve();await release.promise;}return rich();
  }});
  const first=loader({lat:41.9,lng:12.5});await entered.promise;
  const queued=loader({lat:48.86,lng:2.35});
  elapsed=101;release.resolve();await first;
  const result=await queued;
  assert.equal(calls,1,'queue expiry must not grant a fresh transport budget');
  assert.equal(result.loader_status,'error_failed_closed');
});

test('a timed-out native Overpass fetch settles the caller but retains its slot until actual settlement',async()=>{
  const entered=deferred(),release=deferred();let calls=0,timer,clock=1_000_000;
  const loader=createOpenDataLoader({timeoutMs:50,now:()=>clock,fetcher:async()=>{
    calls++;if(calls===1){entered.resolve();await release.promise;}return rich();
  }});
  const first=loader({lat:41.9,lng:12.5});await entered.promise;
  try{
    const result=await Promise.race([first,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),200);})]);
    assert.ok(result,'an abort-ignoring transport must not keep the caller pending beyond its budget');
    assert.equal(result.loader_status,'error_failed_closed');
    clock+=60_001; // Expire only cooldown, never the real native slot/budget.
    const blocked=await loader({lat:48.86,lng:2.35});
    assert.equal(blocked.loader_error,'provider_slot_busy');
    assert.equal(calls,1,'do not free a native slot merely because the caller timed out');
  }finally{clearTimeout(timer);release.resolve();await first;}
  await new Promise(resolve=>setImmediate(resolve));
  const recovered=await loader({lat:52.5,lng:13.4});
  assert.match(recovered.loader_status,/^loaded:/);assert.equal(calls,2);
});

test('an abort-ignoring response body retains the native slot and cannot cache a late positive answer',async()=>{
  const entered=deferred(),release=deferred();let calls=0,clock=1_000_000;
  const loader=createOpenDataLoader({timeoutMs:50,now:()=>clock,fetcher:async()=>{
    calls++;
    const response=rich();
    if(calls===1){const json=response.json;response.json=async()=>{entered.resolve();await release.promise;return json();};}
    return response;
  }});
  const first=loader({lat:41.9,lng:12.5});await entered.promise;
  try{
    assert.equal((await first).loader_error,'timeout_or_abort');
    clock+=60_001;
    assert.equal((await loader({lat:48.86,lng:2.35})).loader_error,'provider_slot_busy');
    assert.equal(calls,1,'headers alone do not settle an outstanding response body');
  }finally{release.resolve();await first;}
  await new Promise(resolve=>setImmediate(resolve));
  assert.match((await loader({lat:41.9,lng:12.5})).loader_status,/^loaded:/);
  assert.equal(calls,2,'the expired first body must not populate a positive cache');
});

for(const status of [500,502]){
  test(`a transient HTTP ${status} pauses fresh endpoint queries for sixty seconds`,async()=>{
    let clock=1_000_000,calls=0;
    const loader=createOpenDataLoader({now:()=>clock,fetcher:async()=>{
      calls++;return calls===1?{ok:false,status,headers:{get:()=>null}}:rich();
    }});
    assert.equal((await loader({lat:41.9,lng:12.5})).loader_error,'http_non_200');
    assert.equal((await loader({lat:48.86,lng:2.35})).loader_error,'provider_unavailable');
    assert.equal(calls,1,'do not reacquire a server that just failed');
    clock+=60_001;
    assert.match((await loader({lat:52.5,lng:13.4})).loader_status,/^loaded:/);assert.equal(calls,2);
  });
}

for(const form of ['seconds','http-date']){
  test(`an explicit ${form} Retry-After overrides the local 30-minute exponential cap`,async()=>{
    let clock=1_000_000,calls=0;
    const header=form==='seconds'?'7200':new Date(clock+2*60*60*1000).toUTCString();
    const loader=createOpenDataLoader({now:()=>clock,fetcher:async()=>{
      calls++;return {ok:false,status:429,headers:{get:name=>name==='retry-after'?header:null}};
    }});
    await loader({lat:41.9,lng:12.5});
    clock+=31*60*1000;
    assert.equal((await loader({lat:48.86,lng:2.35})).loader_error,'provider_rate_limited');
    assert.equal(calls,1,'do not retry before the server-requested two hours');
    clock=1_000_000+2*60*60*1000+1;
    await loader({lat:48.86,lng:2.35});assert.equal(calls,2,'the requested pause is finite');
  });
}

test('unreasonably long Retry-After values remain bounded by the six-hour endpoint safety cap',async()=>{
  let clock=1_000_000,calls=0;
  const loader=createOpenDataLoader({now:()=>clock,fetcher:async()=>{
    calls++;return {ok:false,status:429,headers:{get:()=>String(72*60*60)}};
  }});
  await loader({lat:41.9,lng:12.5});clock+=6*60*60*1000-1;
  await loader({lat:48.86,lng:2.35});assert.equal(calls,1);
  clock+=2;await loader({lat:48.86,lng:2.35});assert.equal(calls,2);
});

test('a completed Overpass query timeout briefly pauses fresh acquisition instead of repeating its full wait',async()=>{
  let clock=1_000_000,calls=0;
  const loader=createOpenDataLoader({timeoutMs:50,now:()=>clock,fetcher:async(_url,{signal})=>{
    calls++;
    if(calls!==1)return rich();
    return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('deadline'),{name:'AbortError'})),{once:true}));
  }});
  assert.equal((await loader({lat:41.9,lng:12.5})).loader_error,'timeout_or_abort');
  assert.equal((await loader({lat:48.86,lng:2.35})).loader_error,'provider_timed_out');
  assert.equal(calls,1,'a known timed-out provider must not be reacquired immediately');
  clock+=60_001;
  assert.match((await loader({lat:52.5,lng:13.4})).loader_status,/^loaded:/);assert.equal(calls,2);
});

for(const [status,reason]of [[429,'provider_rate_limited'],[406,'provider_rejected_client']]){
  test(`a late ${status} response applies cooldown before handing its native slot to a waiting query`,async()=>{
    const entered=deferred(),release=deferred();let calls=0,clock=1_000_000;
    const loader=createOpenDataLoader({timeoutMs:50,now:()=>clock,fetcher:async()=>{
      calls++;
      if(calls===1){entered.resolve();await release.promise;return {ok:false,status,headers:{get:()=>status===429?'7200':null}};}
      return rich();
    }});
    const first=loader({lat:41.9,lng:12.5});await entered.promise;
    try{
      const timedOut=await first;
      assert.equal(timedOut.loader_error,'timeout_or_abort');
      clock+=60_001; // A late explicit provider pause must also survive the short local hold.
      const queued=loader({lat:48.86,lng:2.35});
      release.resolve();
      assert.equal((await queued).loader_error,reason,'negative provider health survives an expired caller');
      assert.equal(calls,1,'do not retry a provider that sent a late slow-down/rejection');
      assert.equal((await loader({lat:52.5,lng:13.4})).loader_error,reason);
      assert.equal(calls,1);
    }finally{release.resolve();await first;}
  });
}
