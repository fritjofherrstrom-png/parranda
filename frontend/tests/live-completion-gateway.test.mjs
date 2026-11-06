import test from 'node:test';
import assert from 'node:assert/strict';
import {followLiveCompletion, LIVE_COMPLETION_ENDPOINT, LIVE_ROUTE_UPGRADE_ENDPOINT} from '../src/lib/live-completion.mjs';

const capability={token:'private-original-capability',expiresInMs:120000,routeUpgrade:'not_supported'};
const terminal=(route_upgrade='not_supported')=>Response.json({live_events:{coverage:'covered',pending:false,tonight:[{id:'e',title:'Source event'}]},live_completion:{version:1,state:'ready',route_upgrade}});
const html=status=>new Response('<html><title>Bad gateway</title></html>',{status,headers:{'Content-Type':'text/html'}});
function transport(answers){
 let clock=0;const calls=[],waits=[];
 return {calls,waits,now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},fetcher:async(url,options)=>{
  calls.push({url,body:JSON.parse(options.body)});assert.ok(answers.length,'no unplanned additional read');return answers.shift()();
 }};
}

for(const status of [502,503,504])test(`HTML${status} completion recovers the original result on the existing cadence`,async()=>{
 const h=transport([()=>html(status),()=>terminal()]),seen=[];
 const out=await followLiveCompletion({...h,capability,signal:new AbortController().signal,onLiveEvents:e=>seen.push(e)});
 assert.equal(out.live,'terminal');assert.equal(seen.length,1);assert.equal(seen[0].tonight[0].title,'Source event');
 assert.deepEqual(h.waits,[2000,3000]);
 assert.deepEqual(h.calls,[{url:LIVE_COMPLETION_ENDPOINT,body:{token:capability.token}},{url:LIVE_COMPLETION_ENDPOINT,body:{token:capability.token}}]);
});

for(const [name,answer,expected] of [
 ['structured503 refusal',()=>Response.json({error:'live_completion_unavailable'},{status:503}),'unavailable'],
 ['expiry',()=>Response.json({error:'live_completion_expired'},{status:410}),'expired'],
 ['malformed successful body',()=>html(200),'unavailable'],
 ['other HTTP error',()=>html(500),'unavailable'],
 ['rate limit',()=>Response.json({error:'rate_limited'},{status:429}),'unavailable'],
])test(`${name} remains terminal rather than being hidden by gateway retries`,async()=>{
 const h=transport([answer]);const out=await followLiveCompletion({...h,capability,signal:new AbortController().signal});
 assert.equal(out.live,expected);assert.equal(h.calls.length,1);
});

test('persistent HTML gateways stop at the original lifetime without a new collection or upgrade',async()=>{
 const h=transport([()=>html(502),()=>html(502)]),seen=[];
 const out=await followLiveCompletion({...h,capability:{...capability,expiresInMs:7000},signal:new AbortController().signal,onLiveEvents:e=>seen.push(e)});
 assert.equal(out.live,'expired');assert.deepEqual(h.waits,[2000,3000]);assert.equal(h.calls.length,2);assert.deepEqual(seen,[]);
 assert.ok(h.calls.every(c=>c.url===LIVE_COMPLETION_ENDPOINT&&c.body.token===capability.token));
});

test('intent cancellation during the gateway recovery wait prevents another completion read',async()=>{
 const controller=new AbortController(),h=transport([()=>html(502)]);let waits=0;
 const wait=async ms=>{if(++waits===2){controller.abort();throw new Error('cancelled');}await h.wait(ms);};
 const out=await followLiveCompletion({...h,wait,capability,signal:controller.signal});
 assert.equal(out.live,'cancelled');assert.equal(h.calls.length,1);
});

test('gateway policy does not retry the separate route-upgrade action',async()=>{
 const h=transport([()=>terminal('explicit_request'),()=>html(502)]);
 const out=await followLiveCompletion({...h,capability:{...capability,routeUpgrade:'explicit_request'},signal:new AbortController().signal});
 assert.equal(out.live,'terminal');assert.deepEqual(out.upgrade,{kind:'failed'});
 assert.deepEqual(h.calls.map(c=>c.url),[LIVE_COMPLETION_ENDPOINT,LIVE_ROUTE_UPGRADE_ENDPOINT]);
});
