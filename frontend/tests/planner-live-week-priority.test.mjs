import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

// Real mounted Planner/LiveSheet, controlled HTTP boundary. Literal dates and
// outcomes model the deployed empty-day / listed-week race without network.
const future = { id: 'future-concert', title: 'Listed Monday concert',
  starts_at: '2026-10-26T17:00:00Z', timezone: 'Europe/Copenhagen',
  source_label: 'Library calendar', source_url: 'https://calendar.example/event',
  route_eligible: false };
function live({ pending = false, partial = true, today = [] } = {}) {
  return { coverage: 'covered', selected_date: '2026-10-25', pending,
    tonight: today, this_week: pending ? [] : [future],
    acquisition: { source_health: { status: pending ? 'pending' : partial ? 'partial' : 'healthy',
      result: pending ? 'pending' : 'events_found', selected_source_count: 3,
      responding_source_count: pending ? 0 : partial ? 1 : 3,
      event_bearing_source_count: pending ? 0 : 1, empty_source_count: 0,
      failed_source_count: pending ? 0 : partial ? 1 : 0,
      unavailable_source_count: pending ? 0 : partial ? 1 : 0,
      raw_event_count: pending ? 0 : 1, normalized_event_count: pending ? 0 : 1,
      accepted_event_count: pending ? 0 : 1, surfaced_event_count: pending ? 0 : 1,
      rejected_event_count: 0, reasons: partial ? ['source_failures_present'] : [] } } };
}
function day(events) {
  return { days: [{ date: '2026-10-25', experimental_agnostic_route_applied: true,
    primary_route: { id: '__agnostic_compose__', title: 'Published plan', estimated_km: 1,
      main_stops: [{ id: 'a', label: 'Museum', lat: 55.68, lng: 12.57 },
        { id: 'b', label: 'Cafe', lat: 55.681, lng: 12.571 }], legs: [], map_path_points: [] }, alternatives: [] }],
    agnostic_route_output_experiment: { promotion: { promote: true }, intake: { query: 'Testville' },
      source_status: { anchor: { lat: 55.68, lng: 12.57 } } }, live_events: events,
    ...(events.pending ? { live_completion: { version: 1, token: 'a'.repeat(48), expires_in_ms: 120000 } } : {}) };
}
const queries = h => h.fetchMock.calls.filter(c => c.url.startsWith('/api/live-events'));
const routes = h => h.fetchMock.calls.filter(c => c.url.includes('route-recommendations'));
const button = (h, text) => [...h.container.querySelectorAll('button')].find(b => b.textContent.trim() === text);
async function click(h, text) { const b = button(h, text); assert.ok(b, text); assert.equal(b.disabled, false, text); await h.act(() => b.dispatchEvent(new h.window.Event('click', { bubbles: true }))); }
async function start(t, events) {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount()); await h.clock.advance(500);
  await h.fetchMock.respond(routes(h)[0], day(events)); await h.clock.advance(50);
  await click(h, events.pending ? 'Explore live' : 'See all live'); return h;
}
function query(events) { return { contract: 'live_event_query_v1', route_mutation: false, day_anchor_mutation: false, live_events: events }; }

for (const partial of [false, true]) test(`first open prioritizes real following rows over an empty selected-day display (partial=${partial})`, async t => {
  const h = await start(t, live({ partial }));
  assert.equal(button(h, 'Following 7 days').getAttribute('aria-pressed'), 'true');
  assert.match(h.container.querySelector('[role="dialog"]').textContent, /Listed Monday concert/);
  assert.equal(routes(h).length, 1);
  assert.equal(queries(h).length, 0, 'published following rows need no wider-day request');
  if (partial) assert.match(h.container.querySelector('[role="dialog"]').textContent, /incomplete|couldn.t be reached/);
});

test('opening before completion moves automatically to following rows after the sheet query settles', async t => {
  const h = await start(t, live({ pending: true }));
  assert.equal(button(h, 'Sun 25 Oct').getAttribute('aria-pressed'), 'true', 'pending never proves an empty selected day');
  const initial = queries(h).at(-1); assert.equal(initial.body.time, 'tonight');
  await h.clock.advance(2000);
  const completion = h.fetchMock.calls.find(c => c.url === '/api/planner-live-completion');
  await h.fetchMock.respond(completion, { live_events: live(), live_completion: { version: 1, state: 'ready', route_upgrade: 'not_supported' } });
  await h.fetchMock.respond(initial, query(live()));
  assert.equal(button(h, 'Following 7 days').getAttribute('aria-pressed'), 'true');
  const week = queries(h).at(-1); assert.equal(week.body.time, 'this_week'); assert.equal(week.body.scope, 'around_place');
  assert.equal(week.body.selected_date, '2026-10-25');
  await h.fetchMock.respond(week, query(live()));
  assert.match(h.container.querySelector('[role="dialog"]').textContent, /Listed Monday concert/);
  assert.equal(routes(h).length, 1);
});

test('an explicit selected-day click during pending survives completion and reopen', async t => {
  const h = await start(t, live({ pending: true }));
  await click(h, 'Sun 25 Oct');
  const latest = queries(h).at(-1);
  await h.fetchMock.respond(latest, query(live()));
  assert.equal(button(h, 'Sun 25 Oct').getAttribute('aria-pressed'), 'true');
  const count = queries(h).length;
  const close = h.container.querySelector('[aria-label="Close live"]');
  await h.act(() => close.dispatchEvent(new h.window.Event('click', { bubbles: true })));
  await click(h, 'Explore live');
  assert.equal(button(h, 'Sun 25 Oct').getAttribute('aria-pressed'), 'true');
  assert.equal(queries(h).at(-1).body.time, 'tonight');
  assert.equal(queries(h).length, count + 1);
  assert.equal(routes(h).length, 1);
});

test('an explicit scope selection during pending keeps that scope and selected period', async t => {
  const h = await start(t, live({ pending: true }));
  const local = live({ today: [{ ...future, id: 'sunday', title: 'Listed Sunday event', starts_at: '2026-10-25T17:00:00Z' }] });
  await h.fetchMock.respond(queries(h).at(-1), query(local));
  await click(h, 'Near the route');
  const scoped = queries(h).at(-1); await h.fetchMock.respond(scoped, query(live()));
  assert.equal(button(h, 'Near the route').getAttribute('aria-pressed'), 'true');
  assert.equal(button(h, 'Sun 25 Oct').getAttribute('aria-pressed'), 'true');
  assert.equal(queries(h).at(-1).body.scope, 'near_route');
  assert.equal(routes(h).length, 1);
});

// A real selected-day row remains primary even when following rows exist.
test('listed selected-day rows keep the selected-day period', async t => {
  const today = { ...future, id: 'today', title: 'Listed Sunday concert', starts_at: '2026-10-25T17:00:00Z' };
  const h = await start(t, live({ today: [today] }));
  assert.equal(button(h, 'Sun 25 Oct').getAttribute('aria-pressed'), 'true');
  assert.match(h.container.querySelector('[role="dialog"]').textContent, /Listed Sunday concert/);
  assert.equal(queries(h).length, 0);
  assert.equal(routes(h).length, 1);
});
