import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';
import { LAST_KEY } from '../src/lib/anywhere-storage.mjs';

// Deterministic mounted Planner + real React; not real-provider acceptance.
const counts = ['selected_source_count','responding_source_count','event_bearing_source_count','empty_source_count',
  'failed_source_count','unavailable_source_count','raw_event_count','normalized_event_count',
  'accepted_event_count','surfaced_event_count','rejected_event_count'];
const live = (extra = {}, health = {}) => ({ coverage:'covered', selected_date:'2026-10-07', tonight:[], this_week:[],
  acquisition:{source_health:{...Object.fromEntries(counts.map(k => [k,0])), status:'healthy',result:'empty',
    reasons:[],selected_source_count:1,responding_source_count:1,...health}}, ...extra });
const event = (id, date, extra = {}) => ({ id,title:id,place:'Source venue',lat:60.2,lng:24.94,
  timezone:'Europe/Helsinki',time_window:{kind:'occurrences',dates:[date],local_start:'18:00',local_end:'20:00'},
  source_url:'https://calendar.example/event',source_link_kind:'page',source_link_host:'calendar.example',...extra });
const day = (events, place='Testville') => ({ days:[{experimental_agnostic_route_applied:true,primary_route:{
  id:'__agnostic_compose__',title:'Published day',main_stops:[{id:'a',label:'Museum',lat:60.17,lng:24.94},
    {id:'b',label:'Cafe',lat:60.172,lng:24.942}],estimated_km:2,map_path_points:[],legs:[],confidence:'low'},alternatives:[]}],
  live_events:events,agnostic_route_output_experiment:{promotion:{promote:true},
    intake:{query:place},source_status:{anchor:{lat:60.17,lng:24.94}}} });
const body = events => ({contract:'live_event_query_v1',query:{scope:'in_place',time:'tonight',selected_date:'2026-10-07',
  discovery_scope:'resolved_area',radius_m:16000},route_mutation:false,day_anchor_mutation:false,live_events:events});
const button = (h, re) => [...h.container.querySelectorAll('button')].find(b => re.test(b.textContent));
const click = async (h, re) => { const b=button(h,re); assert.ok(b, `${re}: ${h.text()}`); await h.act(() => b.dispatchEvent(new h.window.Event('click',{bubbles:true}))); };
const text = h => h.container.querySelector('[role="dialog"]')?.textContent || '';
const queries = h => h.fetchMock.calls.filter(c => c.url.includes('/api/live-events'));
async function composed(t, events=live(), lang='en') {
  const h=await mountPlanner({url:`http://localhost/anywhere?place=Testville&lang=${lang}`});
  t.after(() => h.unmount()); await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0],day(events)); await h.clock.advance(50); return h;
}

test('healthy empty selected day automatically shows separately labelled wider-area suggestions without changing Where/When or day', async t => {
  const h=await composed(t,live({this_week:[event('Later local','2026-10-09')]}));
  const saved=h.readStorage(LAST_KEY);
  await click(h,/Explore live|See all live/);
  const query=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.ok(query,'one automatic wider-area request');
  assert.equal(query.body.scope,'in_place'); assert.equal(query.body.time,'tonight');
  assert.equal(query.body.selected_date,'2026-10-07');
  assert.deepEqual(query.body.anchor,{lat:60.17,lng:24.94});
  assert.equal(query.body.place_query,'Testville');
  await h.fetchMock.respond(query,body(live({tonight:[event('Wider concert','2026-10-07',{live_proximity:'in_place',anchor_distance_km:8.4})]})));
  assert.match(text(h),/Same day — wider area around Testville/);
  assert.match(text(h),/Wider concert/); assert.match(text(h),/8[.,]4 km/);
  assert.doesNotMatch(text(h),/Later local/);
  assert.equal(button(h,/^Around Testville$/).getAttribute('aria-pressed'),'true');
  assert.equal(button(h,/^Wed 7 Oct$/).getAttribute('aria-pressed'),'true');
  assert.deepEqual(h.readStorage(LAST_KEY),saved);
  assert.equal(h.fetchMock.calls.filter(c => c.url.includes('/api/route-recommendations')).length,1);
  await h.clock.advance(30000); assert.equal(queries(h).length,1,'no auto polling or fan-out');
});

test('opening while local calendars are pending keeps the selected day instead of silently switching to following days', async t => {
  const h=await composed(t,live({pending:true},{status:'pending',result:'pending'}));
  await click(h,/Explore live|See all live/);
  assert.equal(button(h,/^Wed 7 Oct$/).getAttribute('aria-pressed'),'true');
  assert.equal(button(h,/^Following 7 days$/).getAttribute('aria-pressed'),'false');
  const q=h.fetchMock.pending().find(c=>c.url.includes('/api/live-events'));
  assert.ok(q); assert.equal(q.body.time,'tonight');
  assert.equal(q.body.scope,'around_place');
});

test('a cold wider-area collection gets bounded completion reads, not a permanent empty state', async t => {
  const h=await composed(t);
  await click(h,/Explore live|See all live/);
  const first=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  await h.fetchMock.respond(first,body(live({pending:true},{status:'pending',result:'pending'})));
  assert.match(text(h),/Checking the wider area/);
  await h.clock.advance(4000);
  const next=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.ok(next,'a bounded completion read for the same cold collection');
  assert.deepEqual(next.body,first.body);
  await h.fetchMock.respond(next,body(live({tonight:[event('Cold concert','2026-10-07',{anchor_distance_km:8})]})));
  assert.match(text(h),/Cold concert/);
  await h.clock.advance(30000); assert.equal(queries(h).length,2);
});

test('geographic rejection is explained without calling responding sources unreliable', async t => {
  const events=live({}, {rejected_event_count:14,reasons:['all_event_evidence_rejected']});
  events.acquisition.rejection_summary=[{reason:'missing_event_coordinates',count:7},{reason:'outside_anchor_radius',count:7}];
  const h=await composed(t,events);
  assert.match(h.text(),/outside the area|confirm their locations/);
  assert.doesNotMatch(h.text(),/reliable or current enough/);
  await click(h,/Explore live|See all live/);
  assert.match(text(h),/outside the area|confirm their locations/);
});

test('explicit near-route cancels automatic wider suggestions without moving the day', async t => {
  const h=await composed(t);
  await click(h,/Explore live|See all live/);
  const wider=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  await click(h,/^Near the route$/);
  assert.equal(wider.aborted,true);
  const route=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.equal(route.body.scope,'near_route');
  await h.fetchMock.respond(route,{...body(live()),query:{scope:'near_route',time:'tonight',selected_date:'2026-10-07'}});
  await h.clock.advance(30000);
  assert.doesNotMatch(text(h),/Same day — wider area|Following days — around/);
  assert.equal(h.fetchMock.calls.filter(c => c.url.includes('/api/route-recommendations')).length,1);
});

test('a failing wider query is not retried or presented as an empty larger area', async t => {
  const h=await composed(t,live({this_week:[event('Future','2026-10-09')]}));
  await click(h,/See all live/);
  const query=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  await h.fetchMock.respond(query,{},502);
  await h.clock.advance(60000);
  assert.equal(queries(h).length,1);
  assert.match(text(h),/could not be confirmed/);
  assert.match(text(h),/Future/);
  assert.doesNotMatch(text(h),/No verified same-day events were listed in the wider area/);
});

test('pending completion reads stop at their fixed bound', async t => {
  const h=await composed(t);
  await click(h,/Explore live/);
  for (let i=0;i<7;i++) {
    const query=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
    assert.ok(query);
    await h.fetchMock.respond(query,body(live({pending:true},{status:'pending',result:'pending'})));
    await h.clock.advance(4000);
  }
  await h.clock.advance(60000);
  assert.equal(queries(h).length,7);
  assert.match(text(h),/could not be confirmed/);
});

test('a wider-area partial response still shows its verified events with a limitation', async t => {
  const h=await composed(t);
  await click(h,/Explore live/);
  const query=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  await h.fetchMock.respond(query,body(live({tonight:[event('Verified partial concert','2026-10-07',{anchor_distance_km:5})]},
    {status:'partial',selected_source_count:2,responding_source_count:1,failed_source_count:1,result:'events_found'})));
  assert.match(text(h),/Verified partial concert/);
  assert.match(text(h),/Some sources could not be read/);
});

test('following-days suggestions retain a source-timed single event, not just listed-date series', async t => {
  const future=event('Timed concert','2026-10-09',{time_window:{kind:'continuous',starts_at:'2026-10-09T16:00:00Z',ends_at:'2026-10-09T18:00:00Z'},anchor_distance_km:1});
  const h=await composed(t,live({this_week:[future]}));
  await click(h,/See all live/);
  const query=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  await h.fetchMock.respond(query,body(live()));
  assert.match(text(h),/Timed concert/);
  assert.match(text(h),/9 Oct/);
});

test('a late body after closing the sheet cannot publish wider events or restart polling', async t => {
  const h=await composed(t);
  await click(h,/Explore live/);
  const query=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  await h.fetchMock.respond(query,body(live({tonight:[event('Stale concert','2026-10-07',{anchor_distance_km:6})]})),200,{deferBody:true});
  const close=h.container.querySelector('[aria-label="Close live"]');
  assert.ok(close);
  await h.act(() => close.dispatchEvent(new h.window.Event('click',{bubbles:true})));
  query.releaseBody(); await h.clock.advance(30000);
  assert.equal(query.aborted,true);
  assert.doesNotMatch(h.text(),/Stale concert/);
  assert.equal(queries(h).length,1);
});

test('a mismatched wider response date never becomes selected-day suggestions', async t => {
  const h=await composed(t);
  await click(h,/Explore live/);
  const query=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  await h.fetchMock.respond(query,body(live({selected_date:'2026-10-08',tonight:[event('Wrong date concert','2026-10-08',{anchor_distance_km:4})]})));
  assert.doesNotMatch(text(h),/Wrong date concert/);
  assert.match(text(h),/could not be confirmed/);
});

for (const lang of ['en','sv']) test(`healthy wider selected-day empty reuses following-day local dates in ${lang}`, async t => {
  const future=event('Later local','2026-10-09');
  const h=await composed(t,live({this_week:[future]}),lang);
  await click(h,/See all live|Se allt live/);
  const query=h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.ok(query);
  await h.fetchMock.respond(query,body(live()));
  assert.match(text(h),lang === 'en' ? /Following days — around Testville/ : /Följande dagar — runt Testville/);
  assert.match(text(h),/Later local/); assert.match(text(h),/9 (Oct|okt)/i);
  assert.equal(queries(h).length,1,'future local already belongs to the local collection');
  assert.equal(button(h,/^(Around Testville|Runt Testville)$/).getAttribute('aria-pressed'),'true');
  assert.equal(button(h,/^(Wed 7 Oct|ons 7 okt\.)$/).getAttribute('aria-pressed'),'true');
});
