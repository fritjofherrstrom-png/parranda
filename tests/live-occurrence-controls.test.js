'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {weaveEveningEvent}=require('../server/candidates/evening-event-weave');
const {buildApp}=require('../server/app');
const {resolveDefaultEventSupply,HELSINKI_LINKED_EVENTS_FEED}=require('../server/place-candidates/agnostic-event-supply');
const {externalRecord}=require('./helpers/planner-reservoir-compare');
const DATE='2026-06-28',ID='live:2026-06-28:f26902f0b98c5dc55fee1825024bdaa4',SECOND='live:2026-06-28:47a282cb93cd946ca4cf28d9a0882479';
const first={id:'first',source_provider_id:'fixture-feed',title:'First concert',starts_at:DATE+'T18:00:00Z',ends_at:DATE+'T20:00:00Z',timezone:'Europe/Helsinki',lat:60.173,lng:24.943,route_eligible:true,cultural_tier:'cultural',source_url:'https://example.org/first',source_label:'Published source'};
const second={...first,id:'second',title:'Second concert',source_url:'https://example.org/second'};
const structure={district_day:{areas:[{center:{lat:60.17,lng:24.94}}]}};
const live=events=>({coverage:'covered',selected_date:DATE,tonight:events,this_week:[],acquisition:{source_health:{status:'healthy',result:'events_found',responding_source_count:1}}});
const weave=(events,choices=[],date=DATE)=>weaveEveningEvent(structure,live(events),{selectedDate:date,liveEventChoices:choices});
test('a published candidate binds its identity to actual source occurrence, independent of title/end update',()=>{const a=weave([first]).district_day.evening_event;assert.equal(a.live_occurrence_id,ID);assert.equal(weave([{...first,title:'Updated title',ends_at:DATE+'T21:00:00Z'}]).district_day.evening_event.live_occurrence_id,ID);assert.notEqual(weave([{...first,starts_at:'2026-06-29T18:00:00Z',ends_at:'2026-06-29T20:00:00Z'}],[],'2026-06-29').district_day.evening_event.live_occurrence_id,ID);});
test('remove suppresses automatic Live insertion while replacement chooses next trusted occurrence',()=>{assert.equal(weave([first,second],[{occurrence_id:ID,action:'remove'}]).district_day.evening_event,null);assert.equal(weave([first,second],[{occurrence_id:ID,action:'replace'}]).district_day.evening_event.id,'second');});
test('keep prioritizes the exact eligible occurrence without modifying source rows',()=>{const events=Object.freeze([Object.freeze({...first}),Object.freeze({...second})]);assert.equal(weave(events,[{occurrence_id:SECOND,action:'keep'}]).district_day.evening_event.id,'second');assert.equal(events[0].title,'First concert');});
test('manual keep never upgrades Pulse-only or unknown source occurrence',()=>{for(const changed of [{route_eligible:false},{route_eligible:undefined},{timezone:null},{lat:null}])assert.equal(weave([first,{...second,...changed}],[{occurrence_id:SECOND,action:'keep'}]).district_day.evening_event,null);assert.equal(weave([first],[{occurrence_id:'live:2026-06-28:'+ '0'.repeat(32),action:'keep'}]).district_day.evening_event,null);});
test('other-day choice does not exclude a different day of same publisher series',()=>{assert.equal(weave([{...first,starts_at:'2026-06-29T18:00:00Z',ends_at:'2026-06-29T20:00:00Z'}],[{occurrence_id:ID,action:'remove'}],'2026-06-29').district_day.evening_event.id,'first');});
function post(server,path,body){return new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port:server.address().port,path,method:'POST',headers:{'Content-Type':'application/json'}},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});r.on('error',reject);r.end(JSON.stringify(body));});}
const routePath='/api/route-recommendations?include_live_completion=1&include_live_route_upgrade=1';
const routeBody={lat:60.17,lng:24.94,dates:[DATE],preferences:['food','culture','views'],day_rhythm:'balanced',experimental_agnostic_route_output:1,include_external_candidates:1,agnostic_engine_compose:true};
async function setup(t){let settle;let current=live([first,second]);const work=new Promise(r=>settle=r);const records=['restaurant','viewpoint'].flatMap((type,g)=>Array.from({length:6},(_,i)=>externalRecord(`choice-${type}-${i}`,`Fixture ${type} ${i}`,type,60.17+g*.002+i*.0003,24.94+i*.0003,[type==='restaurant'?'mat':'utsikt'])));let deferred=false;
 const supply=resolveDefaultEventSupply({PARRANDA_AGNOSTIC_EVENTS:'enabled',PARRANDA_EVENT_FEEDS:JSON.stringify([HELSINKI_LINKED_EVENTS_FEED])},{collectEvents:async()=>deferred?work:current});
 const server=buildApp({eventSupply:supply,openDataLoader:async()=>records,weatherProvider:async()=>null,placeResolver:null,reviewedPlaceSource:null,sourceCatalog:null,clock:{now:()=>DATE+'T12:00:00Z'}}).listen(0);t.after(async()=>{settle(current);await new Promise(r=>server.close(r))});return {server,defer:()=>deferred=true,release:x=>settle(x),set:x=>current=x};}
async function finished(h,b=routeBody){let r=await post(h.server,routePath,b);if(r.body.live_events?.pending){await new Promise(r=>setImmediate(r));const token=r.body.live_completion.token;await post(h.server,'/api/planner-live-completion',{token});const u=await post(h.server,'/api/planner-live-route-upgrade',{token});if(u.body.result)r={status:u.status,body:u.body.result};}return r;}
test('real HTTP publication issues occurrence identity then honors removal and replacement on normal recompose',async t=>{const h=await setup(t);const before=await finished(h);assert.equal(before.status,200);const stop=before.body.days[0].primary_route.main_stops.find(s=>s.is_live_event);assert.ok(stop);assert.equal(stop.live_occurrence_id,ID);assert.equal(stop.live_choice_eligible,true);for(const action of ['remove','replace']){const r=await finished(h,{...routeBody,live_event_choices:[{occurrence_id:ID,action}]});assert.equal(r.status,200);const after=r.body.days[0].primary_route.main_stops.filter(s=>s.is_live_event);if(action==='remove')assert.equal(after.length,0);else assert.equal(after[0].live_occurrence_id,SECOND);}});
test('real HTTP rejects factual payload additions to an occurrence choice',async t=>{const h=await setup(t);for(const extra of [{title:'Invented'},{lat:60.173},{route_eligible:true},{source_url:'https://fake.org'}]){const r=await post(h.server,routePath,{...routeBody,live_event_choices:[{occurrence_id:ID,action:'keep',...extra}]});assert.equal(r.status,400);assert.equal(r.body.error,'invalid_live_event_choices');}});
test('completion replay never reinserts a removed Live slot after cold acquisition',async t=>{const h=await setup(t);h.defer();const initial=await post(h.server,routePath,{...routeBody,live_event_choices:[{occurrence_id:ID,action:'remove'}]});assert.equal(initial.body.live_events.pending,true);const original=JSON.stringify(initial.body.days),token=initial.body.live_completion.token;h.release(live([first,second]));await new Promise(r=>setImmediate(r));const ready=await post(h.server,'/api/planner-live-completion',{token});assert.equal(ready.status,200);assert.equal(ready.body.live_events.tonight.length,2,'removal selects the day; it does not erase source evidence');const upgrade=await post(h.server,'/api/planner-live-route-upgrade',{token});assert.equal(upgrade.body.live_route_upgrade.state,'not_eligible');assert.equal(upgrade.body.result,undefined);assert.equal(JSON.stringify(initial.body.days),original);});
test('supplied distinct same-series time slots remain individually selectable',()=>{const later={...first,starts_at:DATE+'T19:00:00Z',ends_at:DATE+'T21:00:00Z'};const group={...first,occurrences:[first,later]};const r=weave([group],[{occurrence_id:ID,action:'replace'}]);assert.equal(r.district_day.evening_event.starts_at,later.starts_at);assert.notEqual(r.district_day.evening_event.live_occurrence_id,ID);});
test('floating timestamps never mint a manual choice identity as though an instant was verified',()=>{
  const {execFileSync}=require('node:child_process');
  const script=`
    const {liveOccurrenceId}=require(${JSON.stringify(require.resolve('../server/planner/live-occurrence-choice'))});
    const {weaveEveningEvent}=require(${JSON.stringify(require.resolve('../server/candidates/evening-event-weave'))});
    const first=${JSON.stringify(first)},structure=${JSON.stringify(structure)},date=${JSON.stringify(DATE)};
    const floating={...first,starts_at:date+'T21:00:00',ends_at:date+'T23:00:00'};
    const weave=row=>weaveEveningEvent(structure,{coverage:'covered',selected_date:date,tonight:[row],this_week:[]},{selectedDate:date}).district_day.evening_event;
    const event=weave(floating),positive=weave(first);
    process.stdout.write(JSON.stringify({
      floating_id:liveOccurrenceId(floating),event_present:Boolean(event),
      woven_id:event?.live_occurrence_id??null,choice_eligible:event?.live_choice_eligible??null,
      explicit_id:liveOccurrenceId(first),explicit_woven_id:positive?.live_occurrence_id,
      explicit_choice_eligible:positive?.live_choice_eligible,
    }));
  `;
  for(const timezone of ['UTC','Europe/Stockholm','America/Los_Angeles']){
    const result=JSON.parse(execFileSync(process.execPath,['-e',script],{encoding:'utf8',env:{...process.env,TZ:timezone}}));
    assert.equal(result.floating_id,null,`${timezone}: the identity constructor must refuse an unverified instant`);
    assert.equal(result.woven_id,null,`${timezone}: selection cannot acquire an identity through weaving`);
    // The invalid floating row may be filtered out before evening weaving.
    // If present, its manual-choice gate must still be explicitly false.
    if(result.event_present)assert.equal(result.choice_eligible,false,timezone);
    assert.equal(result.explicit_id,ID,`${timezone}: a stated UTC instant keeps its source identity`);
    assert.equal(result.explicit_woven_id,ID,timezone);
    assert.equal(result.explicit_choice_eligible,true,timezone);
  }
});

test('real cold completion honors an explicit kept occurrence independently of soft preference rank', async t => {
  const warm = await setup(t);
  const before = await finished(warm);
  assert.equal(before.body.days[0].primary_route.main_stops.find(s => s.is_live_event).live_occurrence_id, ID);
  const h = await setup(t);
  h.defer();
  const initial = await post(h.server, routePath, { ...routeBody, preferences: ['food', 'views'], live_event_choices: [{ occurrence_id: ID, action: 'keep' }] });
  assert.equal(initial.body.live_events.pending, true);
  h.release(live([first, second]));
  await new Promise(resolve => setImmediate(resolve));
  const token = initial.body.live_completion.token;
  await post(h.server, '/api/planner-live-completion', { token });
  const upgrade = await post(h.server, '/api/planner-live-route-upgrade', { token });
  assert.equal(upgrade.body.live_route_upgrade.state, 'applied');
  assert.equal(upgrade.body.result.days[0].primary_route.main_stops.find(s => s.is_live_event).live_occurrence_id, ID);
  assert.equal(upgrade.body.result.days[0].primary_route.main_stops.length, 5,
    'completion includes the selected occurrence within Balanced extent');
  assert.equal(upgrade.body.result.agnostic_route_output_experiment.live_event_choices.honored_count, 1);
});

test('real HTTP keep does not override a walking failure or a changed source verdict', async t => {
  for (const changed of [{ lat: 61.173 }, { route_eligible: false }]) {
    const h = await setup(t);
    h.set(live([{ ...first, ...changed }, second]));
    // Finish the controlled producer first: pending evidence is not a terminal
    // impossibility verdict. This assertion exercises the completed snapshot.
    await finished(h);
    const r = await finished(h, { ...routeBody, live_event_choices: [{ occurrence_id: ID, action: 'keep' }] });
    assert.notEqual(r.body.live_events?.pending, true);
    assert.equal(r.status, 200);
    assert.equal(r.body.days?.[0]?.primary_route?.main_stops?.length || 0, 0,
      'a terminal impossible Keep refuses atomically instead of publishing a substitute day');
    assert.equal(r.body.agnostic_route_output_experiment.promotion.promote, false);
    assert.equal(r.body.agnostic_route_output_experiment.live_event_choices.honored_count, 0);
    assert.deepEqual(r.body.agnostic_route_output_experiment.live_event_choices.unhonored.map(x => x.id), [ID]);
  }
});

test('cold completion considers verified slots inside a source series individually', async t => {
  const h = await setup(t);
  h.defer();
  const initial = await post(h.server, routePath, { ...routeBody, live_event_choices: [{ occurrence_id: SECOND, action: 'keep' }] });
  assert.equal(initial.body.live_events.pending, true);
  h.release(live([{ ...first, route_eligible: false, occurrences: [first, second] }]));
  await new Promise(resolve => setImmediate(resolve));
  const token = initial.body.live_completion.token;
  await post(h.server, '/api/planner-live-completion', { token });
  const upgrade = await post(h.server, '/api/planner-live-route-upgrade', { token });
  assert.equal(upgrade.body.live_route_upgrade.state, 'applied');
  assert.equal(upgrade.body.result.days[0].primary_route.main_stops.find(s => s.is_live_event).live_occurrence_id, SECOND);
});

test('cold completion preserves the exact Live occurrence and strict shortened saved day together', async t => {
  const warm = await setup(t);
  const before = await finished(warm, { ...routeBody, live_event_choices: [{ occurrence_id: ID, action: 'keep' }] });
  const stops = before.body.days[0].primary_route.main_stops;
  const removed = stops.find(stop => !stop.is_live_event);
  const retained = stops.filter(stop => stop.id !== removed.id).map(stop => stop.id);
  const edit = { version: 1, action: 'remove', candidate_id: removed.id,
    retained_candidate_ids: retained, target_stop_count: retained.length, slot_index: 0,
    replacement_preference: null, removed_candidate_ids: [removed.id] };
  const h = await setup(t);
  h.defer();
  const initial = await post(h.server, routePath, { ...routeBody, day_edit: edit,
    live_event_choices: [{ occurrence_id: ID, action: 'keep' }] });
  assert.equal(initial.body.live_events.pending, true);
  assert.equal(initial.body.agnostic_route_output_experiment.promotion.promote, false,
    'the incomplete edited chain is withheld while its original producer runs');
  assert.equal(initial.body.live_completion.route_upgrade, 'explicit_request');
  h.release(live([first, second]));
  await new Promise(resolve => setImmediate(resolve));
  const token = initial.body.live_completion.token;
  const read = await post(h.server, '/api/planner-live-completion', { token });
  assert.equal(read.body.live_completion.state, 'ready');
  const upgrade = await post(h.server, '/api/planner-live-route-upgrade', { token });
  assert.equal(upgrade.status, 200);
  assert.equal(upgrade.body.live_route_upgrade.state, 'applied');
  const result = upgrade.body.result;
  assert.deepEqual(result.days[0].primary_route.main_stops.map(stop => stop.id), retained);
  assert.equal(result.days[0].primary_route.main_stops.at(-1).live_occurrence_id, ID);
  assert.equal(result.agnostic_route_output_experiment.day_edit.actual_stop_count, retained.length);
  assert.equal(result.agnostic_route_output_experiment.day_edit.status, 'applied');
  assert.equal(result.agnostic_route_output_experiment.walking_validation.valid, true);
});
