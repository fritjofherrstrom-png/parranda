"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessPlannerSourceSnapshot, createPlannerSnapshotAssessor, memoizePlannerWeather } = require('../server/planner/source-snapshot-readiness');
const { resolveAgnosticContext } = require('../server/planner/agnostic-route-context');
const { createPlannerLifecycle, lifecycleLoader } = require('../server/planner/cold-lifecycle');
const { createBackgroundSource } = require('../server/place-candidates/background-source');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');
const { nearbyCuratedSupply } = require('../server/planner/nearby-curated-supply');

const anchor = { lat: 48.5, lng: 8.5, anchorMode: 'place', dayRhythm: 'balanced' };
const request = { ...anchor, requestedIntents: ['culture'] };
const rows = (family, count = 3, type = 'museum') => Array.from({length:count}, (_,i) => ({
  id: `${family}-${i}`, name: `Visit ${family} ${i}`, type,
  lat: anchor.lat + i * .0009, lng: anchor.lng,
  sources: [{ provider: family, family, tier: 'inferred', url: `https://source.example/${family}/${i}` }],
}));
const assess = (records, loadRequest = request, independentSupply = [], extras = {}) => assessPlannerSourceSnapshot({
  records, request: loadRequest, independentSupply, selectedDate: '2026-10-17', ...extras,
});
const deferred = () => { let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve}; };
const flush = async () => { for (let i=0;i<60;i++) await Promise.resolve(); };

test('readiness uses real admission and intent evidence, not matching coordinate counts', () => {
  assert.deepEqual(assess(rows('open_knowledge',18)), { hasUsableSupply:false, ready:false });
  assert.deepEqual(assess(rows('open_directory')), { hasUsableSupply:true, ready:true });
  assert.equal(assess(rows('open_directory'), {...request, requestedIntents:['second_hand']}).ready,false);
  assert.equal(assess(rows('open_directory',3,'gallery')).ready,false,'partial culture is not strong coverage');
  assert.equal(assess(rows('open_directory',1)).ready,false,'one place cannot form the existing minimum pair');
  assert.equal(assess(rows('open_directory'), {...request, requestedIntents:['culture','second_hand']}).ready,false);
});

test('known closures, reach, identity and exclusions remain subtractive', () => {
  assert.equal(assess(rows('map').map(row=>({...row,opening_hours:'Sa off'}))).ready,false);
  assert.equal(assess(rows('map').map(row=>({...row,opening_hours:'24/7'}))).ready,true);
  assert.equal(assess(rows('map').map(row=>({...row,opening_hours:'unknown syntax'}))).ready,true,'unknown remains unknown under existing policy');
  assert.equal(assess(rows('map').map(row=>({...row,lat:row.lat+1}))).ready,false,'same reach bound as composer');
  assert.equal(assess(rows('map'),request,[],{excludedIds:['map-0','map-1']}).ready,false);
  const duplicate=rows('map',1)[0];
  assert.equal(assess([duplicate,duplicate,duplicate]).ready,false,'repeated rows are not multiple visit identities');
  const curated=nearbyCuratedSupply({anchor,date:'2026-10-17',configs:{owned:{
    key:'owned',label:'Owned',visibility:'public',catalog:{allItems:rows('catalog').map(row=>({...row,kind:'museum',tags:['museum']}))},
  }}});
  assert.equal(assess([],request,curated).ready,true,'real normalized independent server catalog can satisfy admission');
});

test('readiness respects the same trusted remaining-day hours and reach as composition', () => {
  const context={timezoneKnown:true,now:'2026-10-16T21:00:00'};
  const extras={selectedDate:'2026-10-16',context};
  assert.equal(assess(rows('map').map(row=>({...row,opening_hours:'Fr 09:00-10:00'})),request,[],extras).ready,false);
  assert.equal(assess(rows('map').map(row=>({...row,opening_hours:'Fr 20:00-23:00'})),request,[],extras).ready,true);
  const far=rows('map').map(row=>({...row,lat:anchor.lat+.04}));
  assert.equal(assess(far,{...request,anchorMode:'coordinates'},[],extras).ready,false,'late window does not get the focused 5km reach');
  assert.equal(assess(far,{...request,anchorMode:'coordinates'}).ready,true,'future/full-day reach control');
});

test('readiness and composition share one weather acquisition but resolve the actual trusted clock afresh', async () => {
  let weatherCalls=0,instant='2026-10-16T19:00:00Z';
  const provider=memoizePlannerWeather(async()=>{weatherCalls++;return {
    timezone_resolution:{timezone:'Europe/Berlin',timezone_source:'weather_provider_auto'},
  };});
  const resolveContext=({coords,date})=>resolveAgnosticContext({coords,date,weatherProvider:provider,clock:()=>new Date(instant)});
  const check=createPlannerSnapshotAssessor({selectedDate:'2026-10-16',resolveContext});
  const morning=rows('map').map(row=>({...row,opening_hours:'Fr 09:00-10:00'}));
  assert.equal((await check(rows('open_knowledge'),request,[])).ready,false);
  assert.equal(weatherCalls,0,'rejected knowledge rows do not trigger a context fetch');
  assert.equal((await check(morning,request,[])).ready,false,'real trusted context excludes the expired opening window');
  const later=await resolveContext({coords:anchor,date:'2026-10-16'});
  assert.equal(later.hour,21);
  instant='2026-10-16T20:00:00Z';
  assert.equal((await resolveContext({coords:anchor,date:'2026-10-16'})).hour,22,'composition is not pinned to the acquisition-time clock');
  assert.equal(weatherCalls,1,'no additional external attempt at the second context consumer');
  let failures=0;
  const failed=memoizePlannerWeather(()=>{failures++;throw new Error('controlled_weather_failure');});
  await assert.rejects(failed({date:'2026-10-16'}));
  await assert.rejects(failed({date:'2026-10-16'}));
  assert.equal(failures,1,'even a context failure cannot become an implicit provider retry');
});

async function replay({ keyFor = () => 'owned', primaryRows = rows('open_knowledge',18) } = {}) {
  const cache=createSourceCache(); const works=[]; let calls=0;
  const source=createBackgroundSource({cache,keyFor,load:(_anchor,req)=>{
    const work=deferred(); works.push({...work,signal:req.signal}); calls++; return work.promise;
  }});
  const loader=composeOpenDataLoaders(()=>primaryRows,null,source);
  const jobs=createPlannerLifecycle();
  const start=async (loadRequest=request) => jobs.start(async context=>{
    const load=lifecycleLoader(loader,context,{assessSnapshot:assess});
    const result=await load(loadRequest);
    return {status:200,body:{ids:result.map(row=>row.id),completion:result.loader_metadata?.source_completion}};
  });
  return {cache,works,jobs,start,calls:()=>calls};
}

test('unadmitted matching rows do not consume the reserve; hard deadline and late completion remain terminal', async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
  const r=await replay(); const pending=await r.start(); const token=pending.body.planner_lifecycle.token;
  for(const ms of [8000,8000,8000,8000,8000,5000]) { t.mock.timers.tick(ms); await flush(); }
  assert.equal(r.jobs.read(token).status,202,'no admitted supply at the 45s reserve boundary');
  t.mock.timers.tick(15000); await flush();
  assert.equal(r.jobs.read(token).status,202,'the same job can continue past the superseded60s boundary');
  t.mock.timers.tick(30000); await flush();
  assert.equal(r.jobs.read(token).body.error,'supply_wait_expired');
  assert.equal(r.works[0].signal.aborted,true);
  r.works[0].resolve(rows('open_directory')); await flush();
  assert.equal(r.cache.peek('owned'),null,'abandoned producer cannot warm the cache');
  assert.equal(r.jobs.read(token).body.error,'supply_wait_expired');
  assert.equal(r.calls(),1,'no reacquisition');
});

test('cancelled consumer and late old generation cannot publish or overwrite the replacement generation', async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
  const r=await replay(); const a=await r.start(); const old=a.body.planner_lifecycle.token;
  t.mock.timers.tick(8000); await flush();
  r.jobs.cancel(old); await flush();
  assert.equal(r.works[0].signal.aborted,true);
  const b=await r.start({...request,requestedIntents:['second_hand']});
  const current=b.body.planner_lifecycle.token;
  assert.equal(r.calls(),2,'new consumer owns its own generation after cancellation');
  r.works[1].resolve(rows('open_directory',3,'vintage-shop')); await flush();
  assert.equal(r.jobs.read(current).status,200);
  r.works[0].resolve(rows('map',3,'museum')); await flush();
  assert.equal(r.jobs.read(old).status,410);
  assert.ok(r.jobs.read(current).body.ids.every(id=>!id.startsWith('map-')));
  assert.ok(r.cache.peek('owned').every(row=>row.type==='vintage-shop'),'old aborted generation cannot replace new cache');
});

test('same-anchor changed intent is assessed independently and a published snapshot is immutable', async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
  const r=await replay({primaryRows:rows('map'),keyFor:(_a,req)=>req.requestedIntents.join(',')});
  const a=await r.start(); const b=await r.start({...request,requestedIntents:['second_hand']});
  const at=a.body.planner_lifecycle.token,bt=b.body.planner_lifecycle.token;
  t.mock.timers.tick(8000); await flush();
  const published=r.jobs.read(at);
  assert.equal(published.status,200,'admitted culture pair may publish within existing budget');
  assert.equal(r.jobs.read(bt).status,202,'culture readiness cannot satisfy a newer second-hand intent');
  r.works[1].resolve(rows('open_directory',3,'vintage-shop')); await flush();
  assert.equal(r.jobs.read(bt).status,200);
  r.works[0].resolve(rows('open_directory',3,'museum')); await flush();
  assert.deepEqual(r.jobs.read(at),published,'late source settlement cannot mutate a published response');
  assert.equal(r.calls(),2,'exactly the two independently keyed producers');
});

test('source settlement and cancellation win over an asynchronous readiness check without rearming its timer', async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
  for(const cancelled of [false,true]) {
    const source=deferred(),assessment=deferred(); let checks=0;
    const initial=rows('map');
    Object.defineProperty(initial,require('../server/place-candidates/background-source').SOURCE_COMPLETION,{value:source.promise});
    const jobs=createPlannerLifecycle();
    const pending=await jobs.start(async context=>{
      const load=lifecycleLoader(()=>initial,context,{assessSnapshot:()=>{checks++;return assessment.promise;}});
      const final=await load(request);
      return {status:200,body:{ids:final.map(row=>row.id)}};
    });
    const token=pending.body.planner_lifecycle.token;
    t.mock.timers.tick(8000);await flush();assert.equal(checks,1);
    if(cancelled)jobs.cancel(token);else source.resolve(rows('open_directory'));
    await flush();
    const final=jobs.read(token);
    assert.equal(final.status,cancelled?410:200);
    assessment.resolve({hasUsableSupply:false,ready:false});await flush();
    t.mock.timers.tick(8000);await flush();
    assert.equal(checks,1,'a late context answer cannot schedule another check after completion/cancellation');
    assert.deepEqual(jobs.read(token),final);
    source.resolve([]);await flush();
  }
});
