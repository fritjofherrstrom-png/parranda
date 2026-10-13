"use strict";
const assert=require("node:assert/strict"),test=require("node:test");
const {createRequestTimeEventDiscovery}=require("../server/pulse-sources/request-time-event-discovery");
const {createSearxngSourceSearch}=require("../server/pulse-sources/source-search-provider");
const {resolveDefaultEventSupply}=require("../server/place-candidates/agnostic-event-supply");
const {createLiveCompletionStore}=require("../server/planner/live-completion");
const {memoryCache,response}=require("./helpers/request-time-review-fixtures");
const tick=()=>new Promise(r=>setImmediate(r));

test("slow real search/scout acquisition is cancelled within the Live receipt lifetime and becomes a held failure",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  let clock=0,queries=0,sourceReads=0,aborted=0;
  const search=createSearxngSourceSearch({endpoint:"https://search.example/search",cache:memoryCache(),maxQueries:2,hardQueryLimit:2,
    queryAttempts:1,retryBudget:0,queryPaceMs:0,fetcher:async url=>{
      const start=queries++*3;
      return response(url,JSON.stringify({results:Array.from({length:3},(_,i)=>({url:`https://source${start+i}.example/agenda`,title:"Fixture Region calendar"}))}),200,"application/json");
    }});
  const discover=createRequestTimeEventDiscovery({sourceSearch:search,cache:memoryCache(),now:()=>clock,
    fetcher:async(url,options)=>{
      sourceReads++;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>resolve(response(url,url.endsWith("/robots.txt")?"User-agent: *\nAllow: /":"<html><a href='/calendar-a'>Calendar</a><a href='/calendar-b'>Events calendar</a></html>")),7000);
        options.signal.addEventListener("abort",()=>{aborted++;clearTimeout(timer);reject(new DOMException("cancelled","AbortError"));},{once:true});
      });
    }});
  const supply=resolveDefaultEventSupply({PARRANDA_AGNOSTIC_EVENTS:"enabled"},{eventReader:null,eventCache:memoryCache(),
    requestTimeDiscovery:discover,failedRefreshClock:()=>clock});
  const args={anchor:{lat:-45.1,lng:170.2},placeLabel:"Fixture Region",now:"2026-10-13T08:00:00Z",selectedDate:"2026-10-13"};
  const pending=await supply(args),store=createLiveCompletionStore({now:()=>clock}),receipt=store.issue(pending);
  await tick();
  for(let n=0;n<5;n++){clock+=7000;t.mock.timers.tick(7000);await tick();}
  const terminal=store.read(receipt.token);
  assert.equal(terminal.status,200,"discovery must finish honestly before capability expiry, rather than outlive it");
  assert.equal(terminal.body.live_events.acquisition.request_time_discovery.status,"failed");
  assert.equal(terminal.body.live_events.acquisition.request_time_discovery.reason,"request_time_discovery_timeout");
  assert.ok(aborted>0,"the real active scout transport was cancelled");
  const count=sourceReads;
  clock+=120000;t.mock.timers.tick(120000);await tick();
  assert.equal(sourceReads,count,"cancelled discovery cannot continue its sequential fan-out");
  assert.equal((await discover(args)).status,"failed","short discovery hold is preserved");
});
