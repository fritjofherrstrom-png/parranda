'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPlaceSuggestions} = require('../server/place-candidates/place-suggestions');
const deferred = () => { let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve}; };
const ready = () => ({ok:true,json:async()=>({features:[]})});

test('last autocomplete consumer cancellation aborts its active producer and never caches the abandoned answer',async()=>{
  const entered=deferred(),release=deferred();
  let calls=0,providerSignal;
  const suggestions=createPlaceSuggestions({minIntervalMs:0,timeoutMs:1000,fetcher:async(_url,{signal})=>{
    calls++;providerSignal=signal;entered.resolve();await release.promise;return ready();
  }});
  const consumer=new AbortController();
  const first=suggestions('harbour',{signal:consumer.signal});
  await entered.promise;
  try{
    consumer.abort();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(providerSignal.aborted,true,'abandoned browser work must abort the producer');
  }finally{release.resolve();}
  assert.equal((await first).status,'unavailable');
  assert.equal((await suggestions('harbour')).status,'ready');
  assert.equal(calls,2,'a late abandoned result must not populate ready cache');
});

test('cancelled queued prefixes never reach Photon',async()=>{
  const entered=deferred(),release=deferred();const urls=[];
  const suggestions=createPlaceSuggestions({minIntervalMs:0,timeoutMs:1000,fetcher:async url=>{
    urls.push(new URL(url).searchParams.get('q'));entered.resolve();await release.promise;return ready();
  }});
  const first=suggestions('first');await entered.promise;
  const controller=new AbortController();
  const queued=suggestions('obsolete',{signal:controller.signal});controller.abort();
  assert.equal((await queued).status,'unavailable');release.resolve();
  assert.equal((await first).status,'ready');
  assert.equal((await suggestions('newest')).status,'ready');
  assert.deepEqual(urls,['first','newest']);
});

test('one cancelled owner cannot abort another owner of the same normalized query',async()=>{
  const entered=deferred(),release=deferred();let calls=0,providerSignal;
  const suggestions=createPlaceSuggestions({minIntervalMs:0,timeoutMs:1000,fetcher:async(_url,{signal})=>{
    calls++;providerSignal=signal;entered.resolve();await release.promise;return ready();
  }});
  const controller=new AbortController();
  const first=suggestions(' Harbour ',{language:'en',signal:controller.signal});
  const second=suggestions('harbour',{language:'en'});await entered.promise;
  controller.abort();assert.equal((await first).status,'unavailable');
  assert.equal(providerSignal.aborted,false);release.resolve();
  assert.equal((await second).status,'ready');assert.equal(calls,1);
  assert.equal((await suggestions('harbour',{language:'en'})).status,'ready');assert.equal(calls,1);
});

test('autocomplete total deadline includes queue time and does not release an unsettled native transport',async()=>{
  const entered=deferred(),release=deferred();let calls=0;
  const suggestions=createPlaceSuggestions({minIntervalMs:0,timeoutMs:40,fetcher:async()=>{
    calls++;entered.resolve();await release.promise;return ready();
  }});
  const first=suggestions('first');await entered.promise;
  const queued=[suggestions('second'),suggestions('third'),suggestions('fourth')];
  try{
    const results=await Promise.all([first,...queued]);
    assert.ok(results.every(row=>row.status==='unavailable'));
    assert.equal(calls,1,'expired queued work must not get a new full timeout or start native fetch');
  }finally{release.resolve();}
});

test('HTTP disconnect cancels the last autocomplete owner at the real app endpoint',async()=>{
  const http=require('node:http');
  const {buildApp}=require('../server/app');
  const entered=deferred(),release=deferred(),aborted=deferred();
  const suggestions=createPlaceSuggestions({minIntervalMs:0,timeoutMs:3000,fetcher:async(_url,{signal})=>{
    signal.addEventListener('abort',()=>aborted.resolve(true),{once:true});entered.resolve();await release.promise;return ready();
  }});
  const app=buildApp({placeSuggestions:suggestions,openDataLoader:null,eventSupply:null,sourceCatalog:null,reviewedPlaceSource:null});
  const server=app.listen(0);let request,timer;
  try{
    request=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/place-suggestions?lang=en',method:'POST',headers:{'Content-Type':'application/json'}});
    request.on('error',()=>{});request.end(JSON.stringify({query:'harbour'}));
    await entered.promise;request.destroy();
    const didAbort=await Promise.race([aborted.promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]);
    assert.equal(didAbort,true,'response close must reach the shared producer ownership layer');
  }finally{
    clearTimeout(timer);request?.destroy();release.resolve();await new Promise(resolve=>server.close(resolve));
  }
});
