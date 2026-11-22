'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPlaceSuggestions}=require('../server/place-candidates/place-suggestions');
const {captures}=require('./fixtures/photon-exonyms-20261101.json');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

for(const stalledAt of ['fetch','body'])test(`optional matching-name ${stalledAt} deadline keeps canonical choices and allows a later complete ranking`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const entered=deferred(),release=deferred();let calls=0,english=0,signal;
 const suggestions=createPlaceSuggestions({minIntervalMs:0,timeoutMs:5000,fetcher:async(url,options)=>{
  calls++;const lang=new URL(url).searchParams.get('lang');
  if(lang&&++english===1){
   signal=options.signal;
   if(stalledAt==='fetch'){entered.resolve();await release.promise;}
   else return {ok:true,json:async()=>{entered.resolve();await release.promise;return captures.Copenhagen.en;}};
  }
  return {ok:true,json:async()=>captures.Copenhagen[lang||'default']};
 }});
 const first=suggestions('Copenhagen',{language:'en'});await entered.promise;
 try{
  t.mock.timers.tick(5000);
  const result=await first;
  assert.equal(result.status,'ready','a completed canonical page survives optional enrichment timeout');
  assert.equal(signal.aborted,true,'the same deadline still aborts outstanding provider work');
  assert.deepEqual(result.choices.slice(0,2).map(c=>[c.title,c.candidate.osm_ref]),[
   ['Copenhagen','relation/175928'],['København','node/13707878'],
  ],'incomplete name matching retains source order and the native-name city remains visible');
  assert.equal(result.choices.length,5);
  assert.equal(calls,2,'no retry or extra provider request was added');
 }finally{release.resolve();}
 const recovered=await suggestions('Copenhagen',{language:'en'});
 assert.equal(recovered.status,'ready');
 assert.equal(recovered.choices[0].candidate.osm_ref,'node/13707878','complete matching restores the source-bound city ranking');
 assert.equal(calls,4,'the degraded answer was not frozen into the ready cache');
 await suggestions('Copenhagen',{language:'en'});assert.equal(calls,4,'the complete ranking remains cacheable');
});

test('one cancelled autocomplete owner stays unavailable while the surviving owner keeps the deadline fallback',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const entered=deferred(),release=deferred();let signal;
 const suggestions=createPlaceSuggestions({minIntervalMs:0,timeoutMs:5000,fetcher:async(url,options)=>{
  const lang=new URL(url).searchParams.get('lang');
  if(lang){signal=options.signal;entered.resolve();await release.promise;}
  return {ok:true,json:async()=>captures.Kyoto[lang||'default']};
 }});
 const owner=new AbortController();
 const cancelled=suggestions('Kyoto',{signal:owner.signal});const retained=suggestions('Kyoto');
 await entered.promise;
 try{
  owner.abort();assert.equal((await cancelled).status,'unavailable');
  assert.equal(signal.aborted,false,'one owner cannot abort the other owner');
  t.mock.timers.tick(5000);
  const result=await retained;
  assert.equal(result.status,'ready');
  assert.equal(result.choices[1].candidate.osm_ref,'relation/357794');
 }finally{release.resolve();}
});

test('deadline without a completed canonical page cannot fabricate available suggestions',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const entered=deferred(),release=deferred();
 const suggestions=createPlaceSuggestions({minIntervalMs:0,timeoutMs:5000,fetcher:async()=>{
  entered.resolve();await release.promise;return {ok:true,json:async()=>captures.Copenhagen.default};
 }});
 const pending=suggestions('Copenhagen');await entered.promise;
 try{t.mock.timers.tick(5000);assert.deepEqual(await pending,{status:'unavailable',choices:[]});}
 finally{release.resolve();}
});

test('deadline fallback does not open another provider slot while its aborted fetch is still unsettled',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const entered=deferred(),release=deferred();let calls=0;
 const suggestions=createPlaceSuggestions({minIntervalMs:0,timeoutMs:5000,fetcher:async url=>{
  const parsed=new URL(url),lang=parsed.searchParams.get('lang'),query=parsed.searchParams.get('q');
  if(++calls===2){entered.resolve();await release.promise;}
  return {ok:true,json:async()=>captures[query][lang||'default']};
 }});
 const first=suggestions('Copenhagen');await entered.promise;
 try{
  t.mock.timers.tick(5000);assert.equal((await first).status,'ready');
  const queued=suggestions('Kyoto');t.mock.timers.tick(5000);
  assert.deepEqual(await queued,{status:'unavailable',choices:[]});
  assert.equal(calls,2,'the expired queued query cannot overlap an unsettled native fetch');
 }finally{release.resolve();}
 const resumed=await suggestions('Kyoto');
 assert.equal(resumed.choices[0].candidate.osm_ref,'relation/357794');
 assert.equal(calls,4,'fresh work resumes only after the old transport settles');
});
