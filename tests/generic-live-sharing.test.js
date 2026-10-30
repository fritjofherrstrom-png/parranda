'use strict';
require('./helpers/no-live-network');
const test=require('node:test');
const assert=require('node:assert/strict');
const {setup,request,originalBody,eventRows,accepted,assertLiveFacts}=require('./published-day-live-publication.test');
const DATE='2026-10-27';
function publicRows(options){return eventRows(options).map(row=>({...row,info_url:{en:'https://events.example.org/programme/original-concert'}}));}
async function terminal(t,rows=publicRows){
  const now=`${DATE}T10:00:00.000Z`;
  const h=await setup(t,{rows,appOptions:{clock:Object.assign(()=>new Date(now),{now:()=>now})}});
  const original=await request(h.server,{body:originalBody(DATE)});accepted(original.body);
  await h.complete();
  const reply=await request(h.server,{url:'/api/planner-live-completion',body:{token:original.body.live_completion.token}});
  assert.equal(reply.status,200);assert.ok(reply.body.live_events.tonight.length);
  return {h,body:reply.body,token:original.body.live_completion.token};
}
test('real configured Linked Events factory -> collector -> HTTP completion publishes the original day and public Live facts',async t=>{
  const {h,body}=await terminal(t);
  assert.equal(body.day_snapshot?.state,'ready');
  const before=h.counts();
  const get=await request(h.server,{method:'GET',url:`/api/shared-days/${body.day_snapshot.ref}`});
  assert.equal(get.status,200);assertLiveFacts(get.body.result.live_events,body.live_events);
  assert.deepEqual(h.counts(),before,'reading the immutable day must not acquire facts again');
});

for(const [name,url] of [
  ['booking query','https://events.example.org/programme/concert?ticket=private'],
  ['login credentials','https://member:private@events.example.org/concert'],
  ['private IP','http://192.168.1.2/event/1'],
  ['loopback','https://127.0.0.1/event/1'],
  ['private host','https://calendar.internal/event/1'],
  ['private fragment','https://events.example.org/event/1#access-token'],
  ['private path','https://events.example.org/checkout/private-token'],
  ['trailing-dot loopback','http://localhost./event/1'],
  ['trailing-dot private host','https://calendar.internal./event/1'],
  ['encoded login path','https://events.example.org/%6cogin/private-token'],
  ['encoded checkout separator','https://events.example.org/checkout%2fprivate-token'],
  ['double-encoded login path','https://events.example.org/%256cogin/private-token'],
  ['matrix session token','https://events.example.org/login;jsessionid=private-token'],
  ['matrix private token','https://events.example.org/private;token=private-token'],
  ['home-network host','http://router.home.arpa/event/1'],
  ['localdomain host','https://calendar.localdomain/event/1'],
])test(`generic sharing refuses ${name} while retaining the actual Live facts`,async t=>{
  const {h,body}=await terminal(t,options=>publicRows(options).map(row=>({...row,info_url:{en:url}})));
  assert.equal(body.live_events.tonight[0].source_url,url);
  assert.equal(body.day_snapshot?.state,'unavailable');
  assert.equal(h.counts().puts,0);
});

test('an actually applied Live route upgrade publishes a new exact snapshot instead of reusing the original route',async t=>{
  const {h,body,token}=await terminal(t);
  assert.equal(body.day_snapshot.state,'ready');
  const before=h.counts();
  const upgrade=await request(h.server,{url:'/api/planner-live-route-upgrade',body:{token}});
  assert.equal(upgrade.status,200);assert.equal(upgrade.body.live_route_upgrade.state,'applied');
  assert.ok(upgrade.body.result.days[0].primary_route.main_stops.some(stop=>stop.is_live_event));
  assert.equal(upgrade.body.result.day_snapshot?.state,'ready');
  assert.notEqual(upgrade.body.result.day_snapshot.ref,body.day_snapshot.ref,'a changed route needs its own immutable answer');
  const get=await request(h.server,{method:'GET',url:`/api/shared-days/${upgrade.body.result.day_snapshot.ref}`});
  assert.equal(get.status,200);
  const facts=result=>({date:result.days[0].date,stops:result.days[0].primary_route.main_stops.map(stop=>({id:stop.id,label:stop.label,lat:stop.lat,lng:stop.lng,is_live_event:stop.is_live_event,occurrence:stop.live_occurrence_id})),points:result.days[0].primary_route.map_route_points});
  assert.deepEqual(facts(get.body.result),facts(upgrade.body.result));
  assertLiveFacts(get.body.result.live_events,upgrade.body.result.live_events);
  assert.equal(h.counts().loads,before.loads);assert.equal(h.counts().collections,before.collections);
});

test('generic provider authority survives owned disk reuse but not a JSON replay, config change or renewed cache age',async t=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const {resolveDefaultEventSupply,collectAnchorEvents,HELSINKI_LINKED_EVENTS_FEED}=require('../server/place-candidates/agnostic-event-supply');
  const {LIVE_COLLECTION_READ}=require('../server/planner/live-completion');
  const {shapeCollectedLiveEvents}=require('../server/place-candidates/live-event-query');
  const {publicLiveSourceUrls}=require('../server/place-candidates/live-source-destination-evidence');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'generic-event-sharing-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const feed={...HELSINKI_LINKED_EVENTS_FEED,id:'controlled-roma',bbox:[12,41,13,42],timezone:'Europe/Rome'};
  const env={PARRANDA_AGNOSTIC_EVENTS:'enabled',PARRANDA_EVENT_READER:'disabled',PARRANDA_REQUEST_TIME_EVENT_DISCOVERY:'disabled',PARRANDA_EVENT_FEEDS:JSON.stringify([feed]),PARRANDA_CACHE_DIR:directory};
  const args={anchor:{lat:41.9,lng:12.49},now:`${DATE}T10:00:00Z`,selectedDate:DATE,preferences:['culture']};
  let done,acquisitions=0;const settled=new Promise(r=>done=r);
  const supply=resolveDefaultEventSupply(env,{eventReader:null,requestTimeDiscovery:null,collectEvents:async options=>{
    acquisitions++;try{return await collectAnchorEvents({...options,fetcher:async()=>({ok:true,json:async()=>({data:publicRows(options)})})});}finally{done();}
  }});
  const first=await supply(args);await settled;await new Promise(r=>setImmediate(r));
  const original=first[LIVE_COLLECTION_READ]();
  const proof=value=>publicLiveSourceUrls(shapeCollectedLiveEvents(value));
  assert.deepEqual([...proof(original)],['https://events.example.org/programme/original-concert']);
  assert.equal(proof(JSON.parse(JSON.stringify(original))),null);
  const [file]=await fs.readdir(path.join(directory,'agnostic-events-v25'));
  const location=path.join(directory,'agnostic-events-v25',file),bytes=await fs.readFile(location,'utf8'),stat=await fs.stat(location);
  const script=`require('./tests/helpers/no-live-network');const {resolveDefaultEventSupply}=require('./server/place-candidates/agnostic-event-supply');const {shapeCollectedLiveEvents}=require('./server/place-candidates/live-event-query');const {publicLiveSourceUrls}=require('./server/place-candidates/live-source-destination-evidence');const {env,args}=JSON.parse(process.argv[1]);resolveDefaultEventSupply(env,{eventReader:null,requestTimeDiscovery:null,collectEvents:()=>{throw Error('no acquisition');}})(args).then(v=>{const p=publicLiveSourceUrls(shapeCollectedLiveEvents(v));process.stdout.write(JSON.stringify({urls:p?[...p]:null,health:v.acquisition.source_health}));});`;
  const child=require('node:child_process').spawnSync(process.execPath,['-e',script,JSON.stringify({env,args})],{cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stderr);const restarted=JSON.parse(child.stdout);
  assert.deepEqual(restarted.urls,[...proof(original)]);assert.deepEqual(restarted.health,original.acquisition.source_health);
  const changed=resolveDefaultEventSupply({...env,PARRANDA_EVENT_FEEDS:JSON.stringify([{...feed,label:'Changed source configuration'}])},{eventReader:null,requestTimeDiscovery:null,collectEvents:()=>{throw Error('no acquisition');}});
  assert.equal(proof(await changed(args)),null);
  assert.equal(await fs.readFile(location,'utf8'),bytes);assert.equal((await fs.stat(location)).mtimeMs,stat.mtimeMs);assert.equal(acquisitions,1);
});
