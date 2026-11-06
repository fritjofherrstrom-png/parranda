import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mountPlanner} from './helpers/planner-harness.mjs';
import {LAST_KEY,buildSavedEntry} from '../src/lib/anywhere-storage.mjs';

const {unavailableLiveEvents}=createRequire(import.meta.url)('../../server/place-candidates/live-event-query.js');

const DATE='2026-11-06',TOKEN='original-capability';
const event={id:'recovered',title:'Recovered workshop',starts_at:DATE+'T15:00:00Z',timezone:'Europe/Copenhagen',source_label:'Source calendar',source_url:'https://calendar.example/event',route_eligible:false};
function live({pending=false,status='partial',rows=[event],date=DATE}={}){
 const healthy=status==='healthy';
 return {coverage:'covered',pending,selected_date:date,tonight:pending?[]:rows,this_week:[],
  acquisition:{source_health:{status:pending?'pending':status,result:pending?'pending':rows.length?'events_found':'empty',reasons:pending||healthy?[]:['source_failures_present'],
   selected_source_count:4,responding_source_count:pending?0:healthy?4:2,event_bearing_source_count:pending||!rows.length?0:1,
   empty_source_count:pending?0:healthy&&!rows.length?4:1,failed_source_count:pending||healthy?0:1,unavailable_source_count:pending||healthy?0:1,
   raw_event_count:pending?0:rows.length,normalized_event_count:pending?0:rows.length,accepted_event_count:pending?0:rows.length,surfaced_event_count:pending?0:rows.length,rejected_event_count:0}}};
}
const day=(events,{capability=false}={})=>({days:[{date:DATE,experimental_agnostic_route_applied:true,primary_route:{id:'__agnostic_compose__',title:'Published day',estimated_km:1,
 main_stops:[{id:'a',label:'Museum',lat:55.68,lng:12.57},{id:'b',label:'Cafe',lat:55.681,lng:12.571}],legs:[],map_path_points:[]},alternatives:[]}],
 agnostic_route_output_experiment:{promotion:{promote:true},intake:{query:'Testville'},source_status:{anchor:{lat:55.68,lng:12.57}}},live_events:events,
 ...(capability?{live_completion:{version:1,token:TOKEN,expires_in_ms:120000,route_upgrade:'not_supported'}}:{})});
const routes=h=>h.fetchMock.calls.filter(c=>c.url.includes('/api/route-recommendations'));
const queries=h=>h.fetchMock.calls.filter(c=>c.url.startsWith('/api/live-events'));
const reads=h=>h.fetchMock.calls.filter(c=>c.url==='/api/planner-live-completion');
const card=h=>[...h.container.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent.includes('Live in Testville'));
const button=(h,name)=>[...h.container.querySelectorAll('button')].find(b=>b.textContent.trim()===name);
async function click(h,name){const b=button(h,name);assert.ok(b,name);await h.act(()=>b.click());}
const terminal=events=>({live_events:events,live_completion:{version:1,state:'ready',route_upgrade:'not_supported'}});
const query=(events,extra={})=>({contract:'live_event_query_v1',route_mutation:false,day_anchor_mutation:false,query:{scope:'around_place',time:'tonight',selected_date:DATE,radius_m:3000,discovery_scope:'local',...extra},live_events:events});
async function arrive(t,capability=false){
 t.mock.timers.enable({apis:['Date'],now:new Date(2026,10,6,12).getTime()});
 const h=await mountPlanner({url:'http://localhost/anywhere?place=Testville&lang=en'});t.after(()=>h.unmount());await h.clock.advance(500);
 await h.fetchMock.respond(routes(h)[0],day(live({pending:true}),{capability}));await h.clock.advance(50);return h;
}
async function close(h){await h.act(()=>h.container.querySelector('[aria-label="Close live"]').click());}
async function selectedQuery(h){await click(h,'Explore live');await click(h,'Fri 6 Nov');return queries(h).at(-1);}
const exportLinks=h=>[...h.container.querySelectorAll('section[aria-label="Take the day with you"] a[href]')].map(a=>a.getAttribute('href'));

test('HTML502 can recover the original overview without opening a dialog or rebuilding the day',async t=>{
 const h=await arrive(t,true),before=structuredClone(h.readStorage(LAST_KEY).safeResponse.days),maps=exportLinks(h);
 await h.clock.advance(2000);const failed=reads(h)[0];assert.ok(failed);
 await h.act(()=>{failed.answered=true;failed.resolveResponse(new Response('<html>Bad Gateway</html>',{status:502}));});
 assert.match(card(h).textContent,/Checking the calendars/);
 await h.clock.advance(3000);const retried=reads(h)[1];assert.ok(retried,'same capability must be re-read');
 assert.deepEqual(retried.body,{token:TOKEN});await h.fetchMock.respond(retried,terminal(live()));
 assert.match(card(h).textContent,/Recovered workshop/);assert.match(card(h).textContent,/list may be incomplete/);
 assert.doesNotMatch(card(h).textContent,/couldn't verify|Checking the calendars/);
 assert.equal(routes(h).length,1);assert.equal(queries(h).length,0);assert.deepEqual(h.readStorage(LAST_KEY).safeResponse.days,before);assert.deepEqual(exportLinks(h),maps);
 assert.doesNotMatch(JSON.stringify(h.readStorage(LAST_KEY)),new RegExp(TOKEN));
});

test('matching selected-day lookup refreshes the overview and partial warning without changing the installed day',async t=>{
 const h=await arrive(t),before=structuredClone(h.readStorage(LAST_KEY)),maps=exportLinks(h);
 const request=await selectedQuery(h);assert.equal(request.body.scope,'around_place');assert.equal(request.body.time,'tonight');assert.equal(request.body.selected_date,DATE);
 await h.fetchMock.respond(request,query(live()));await close(h);
 assert.match(card(h).textContent,/Recovered workshop/);assert.match(card(h).textContent,/list may be incomplete/);
 assert.doesNotMatch(card(h).textContent,/couldn't verify|Checking the calendars/);
 assert.deepEqual(h.readStorage(LAST_KEY),before,'read-only query cannot republish or save a different original answer');
 assert.deepEqual(exportLinks(h),maps);assert.equal(routes(h).length,1);assert.equal(reads(h).length,0);
});

test('a matching healthy empty lookup reports a quiet calendar rather than an old transport failure',async t=>{
 const h=await arrive(t);await h.fetchMock.respond(await selectedQuery(h),query(live({status:'healthy',rows:[]})));await close(h);
 assert.match(card(h).textContent,/sources responded but list no events/i);assert.doesNotMatch(card(h).textContent,/couldn't verify/);
 assert.equal(routes(h).length,1);
});

for(const [name,extra,eventExtra] of [
 ['other scope',{scope:'near_route'},{}],['other period',{time:'this_week'},{}],['other reply date',{selected_date:'2026-11-07'},{}],
 ['other event date',{}, {date:'2026-11-07'}],['pending',{}, {pending:true}],
 ['regional fallback',{discovery_scope:'regional_nearby'},{}],['wider radius',{radius_m:25000},{}],['missing radius',{radius_m:null},{}],
])test(`${name} query result cannot replace the selected-day overview`,async t=>{
 const h=await arrive(t);await h.fetchMock.respond(await selectedQuery(h),query(live(eventExtra),extra));await close(h);
 assert.doesNotMatch(card(h).textContent,/Recovered workshop/);assert.match(card(h).textContent,/couldn't verify/);assert.equal(routes(h).length,1);
});

test('a successful following-week lookup does not claim to recover the selected-day overview',async t=>{
 const h=await arrive(t);await click(h,'Explore live');const request=queries(h).at(-1);assert.equal(request.body.time,'this_week');
 const events=live();events.this_week=[{...event,starts_at:'2026-11-07T15:00:00Z'}];events.tonight=[];
 await h.fetchMock.respond(request,query(events,{time:'this_week'}));await close(h);
 assert.doesNotMatch(card(h).textContent,/Recovered workshop/);assert.match(card(h).textContent,/couldn't verify/);
});

test('a week request cannot refresh the day overview even if its response claims tonight',async t=>{
 const h=await arrive(t);await click(h,'Explore live');const request=queries(h).at(-1);assert.equal(request.body.time,'this_week');
 await h.fetchMock.respond(request,query(live()));await close(h);
 assert.doesNotMatch(card(h).textContent,/Recovered workshop/);assert.match(card(h).textContent,/couldn't verify/);
});

test('a route-scope request cannot refresh the place overview even if its response claims around-place',async t=>{
 const h=await arrive(t);await h.fetchMock.respond(await selectedQuery(h),{error:'live_events_unavailable'},503);
 await click(h,'Near the route');const request=queries(h).at(-1);assert.equal(request.body.scope,'near_route');
 await h.fetchMock.respond(request,query(live()));await close(h);
 assert.doesNotMatch(card(h).textContent,/Recovered workshop/);assert.match(card(h).textContent,/couldn't verify/);
});

test('missing reply scope metadata cannot make a query the selected-day overview',async t=>{
 const h=await arrive(t);const response=query(live());delete response.query;
 await h.fetchMock.respond(await selectedQuery(h),response);await close(h);
 assert.doesNotMatch(card(h).textContent,/Recovered workshop/);assert.match(card(h).textContent,/couldn't verify/);
});

test('a later original completion cannot erase a successful explicit overview observation',async t=>{
 const h=await arrive(t,true);await click(h,'Explore live');const request=queries(h).at(-1);assert.equal(request.body.time,'tonight');
 await h.fetchMock.respond(request,query(live()));await close(h);await h.clock.advance(2000);
 await h.fetchMock.respond(reads(h)[0],terminal(live({status:'healthy',rows:[]})));
 assert.match(card(h).textContent,/Recovered workshop/);assert.match(card(h).textContent,/list may be incomplete/);
 assert.deepEqual(h.readStorage(LAST_KEY).safeResponse.live_events.tonight,[],'storage still belongs to the original completion, not the independent observation');
 assert.equal(routes(h).length,1);
});

test('changing intent drops the read-only observation even while the previous day remains on screen',async t=>{
 const h=await arrive(t);await h.fetchMock.respond(await selectedQuery(h),query(live()));await close(h);
 assert.match(card(h).textContent,/Recovered workshop/);await click(h,'Adjust');await click(h,'Tomorrow');
 assert.doesNotMatch(card(h).textContent,/Recovered workshop/);assert.equal(routes(h).length,1);
});

test('a body arriving after intent invalidation cannot recover the held overview',async t=>{
 const h=await arrive(t);const request=await selectedQuery(h);await h.fetchMock.respond(request,query(live()),200,{deferBody:true});await close(h);
 await click(h,'Adjust');await click(h,'Tomorrow');assert.equal(request.aborted,true);await h.fetchMock.releaseBody(request);
 assert.doesNotMatch(card(h).textContent,/Recovered workshop/);assert.equal(routes(h).length,1);
});

test('a new query for changed picks cannot relabel the old held day as recovered',async t=>{
 const h=await arrive(t);await click(h,'Adjust');await click(h,'Tomorrow');
 const request=await selectedQuery(h);await h.fetchMock.respond(request,query(live()));await close(h);
 assert.doesNotMatch(card(h).textContent,/Recovered workshop/);assert.equal(routes(h).length,1);
});

for(const walkKey of ['balanced','short','long',null])test(`restored ${walkKey??'missing-inputs'} day can refresh its matching overview without changing storage`,async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(2026,10,6,12).getTime()});
 const entry=buildSavedEntry({place:'Testville',dateIso:DATE,savedAt:DATE+'T10:00:00Z',safeResponse:day(live({pending:true})),
  classification:{status:'composed_limited',placeLabel:'Testville',limitations:[]},
  inputs:walkKey?{place:'Testville',mode:'typed',selected:['food','culture','views'],walkKey,dayOffset:0}:null});
 const h=await mountPlanner({url:'http://localhost/anywhere?restore=last&lang=en',storage:{[LAST_KEY]:entry}});t.after(()=>h.unmount());
 const request=await selectedQuery(h);assert.equal(request.body.selected_date,DATE);assert.equal(request.body.scope,'around_place');
 await h.fetchMock.respond(request,query(live()));await close(h);
 assert.match(card(h).textContent,/Recovered workshop/);assert.deepEqual(h.readStorage(LAST_KEY),entry);assert.equal(routes(h).length,0);
});

test('matching dated Live can recover even when no route could be composed',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(2026,10,6,12).getTime()});
 const h=await mountPlanner({url:'http://localhost/anywhere?place=Testville&lang=en'});t.after(()=>h.unmount());await h.clock.advance(500);
 const response=day(live({pending:true}));response.days=[];response.agnostic_route_output_experiment.promotion={promote:false};
 response.agnostic_route_output_experiment.intake.resolved={label:'Testville',lat:55.68,lng:12.57};
 await h.fetchMock.respond(routes(h)[0],response);await h.clock.advance(50);
 await h.fetchMock.respond(await selectedQuery(h),query(live()));await close(h);
 assert.match(card(h).textContent,/Recovered workshop/);assert.equal(routes(h).length,1);assert.equal(h.readStorage(LAST_KEY),null);
});

test('a source-failed HTTP200 lookup cannot mask a later successful original completion',async t=>{
 const h=await arrive(t,true),failure={...unavailableLiveEvents('event_supply_failed','failed'),selected_date:DATE};
 await h.fetchMock.respond(await selectedQuery(h),query(failure));await close(h);
 await h.clock.advance(2000);await h.fetchMock.respond(reads(h)[0],terminal(live({status:'healthy'})));
 assert.match(h.readStorage(LAST_KEY).safeResponse.live_events.tonight[0].title,/Recovered workshop/);
 assert.match(card(h).textContent,/Recovered workshop/);assert.equal(routes(h).length,1);
});

test('a successful healthy-empty observation still takes precedence over later original completion',async t=>{
 const h=await arrive(t,true);await h.fetchMock.respond(await selectedQuery(h),query(live({status:'healthy',rows:[]})));await close(h);
 await h.clock.advance(2000);await h.fetchMock.respond(reads(h)[0],terminal(live({status:'healthy'})));
 assert.match(card(h).textContent,/sources responded but list no events/i);assert.doesNotMatch(card(h).textContent,/Recovered workshop/);
 assert.equal(h.readStorage(LAST_KEY).safeResponse.live_events.tonight.length,1);
});

test('Undo restores ownership for a new read-only lookup without composing again',async t=>{
 const h=await arrive(t);await click(h,'Adjust');await click(h,'Tomorrow');await h.clock.advance(500);
 const replacement=day(live({pending:true,date:'2026-11-07'}));replacement.days[0].date='2026-11-07';
 await h.fetchMock.respond(routes(h)[1],replacement);await h.clock.advance(50);await click(h,'Undo');
 const before=structuredClone(h.readStorage(LAST_KEY));
 await h.fetchMock.respond(await selectedQuery(h),query(live()));await close(h);
 assert.match(card(h).textContent,/Recovered workshop/);assert.equal(routes(h).length,2);assert.deepEqual(h.readStorage(LAST_KEY),before);
});
