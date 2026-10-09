import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';

const token = 'a'.repeat(48);
const live = (pending = true) => ({ pending, coverage: 'covered', selected_date: '2026-10-09', tonight: [], this_week: [], acquisition: { source_health: {
  status: pending ? 'pending' : 'healthy', result: pending ? 'pending' : 'empty', reasons: [],
  selected_source_count: 1, responding_source_count: pending ? 0 : 1,
  event_bearing_source_count: 0, empty_source_count: pending ? 0 : 1, failed_source_count: 0,
  unavailable_source_count: 0, raw_event_count: 0, normalized_event_count: 0, accepted_event_count: 0,
  surfaced_event_count: 0, rejected_event_count: 0,
} } });
function day() {
  return {
    days: [{ date: '2026-10-09', experimental_agnostic_route_applied: true, primary_route: {
      id: '__agnostic_compose__', title: 'Plan', estimated_km: 1.2,
      main_stops: ['a','b'].map(id => ({ id, label: `Place ${id}`, lat: 41.9, lng: 12.49, type: 'restaurant', tags: [] })),
      map_route_points: [], map_path_points: [], legs: [],
    }, alternatives: [] }],
    place_structure: { provenance: 'agnostic_anchor', area_count: 1, areas: [], district_day: { areas: [] } },
    agnostic_route_output_experiment: { promotion: { promote: true }, source_status: { anchor: { lat: 41.9, lng: 12.49 } } },
    live_events: live(), live_completion: { version: 1, token, expires_in_ms: 120000 },
  };
}
const routes = h => h.fetchMock.calls.filter(c => c.url.includes('route-recommendations'));
const reads = h => h.fetchMock.calls.filter(c => c.url === '/api/planner-live-completion');
async function start(t, body = day()) {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(routes(h)[0], body);
  assert.match(h.text(), /Place a/);
  return h;
}
const storage = h => Object.fromEntries(Object.keys(h.window.localStorage).map(k => [k, h.window.localStorage.getItem(k)]));
const completion = (events, state = events.pending ? 'pending' : 'ready') => ({ live_events: events, live_completion: { version: 1, state, route_upgrade: 'not_supported' } });

test('mounted pending Live completes through token-only reads without republishing or persisting a capability', async t => {
  const h = await start(t);
  const before = storage(h);
  await h.clock.advance(9000);
  assert.equal(reads(h).length, 1, 'pending Live must read completion, not compose again');
  assert.match(routes(h)[0].url, /include_live_completion=1/);
  assert.deepEqual(reads(h)[0].body, { token });
  assert.equal(JSON.stringify(before).includes(token), false);
  assert.equal(JSON.stringify(before).includes('live_completion'), false);
  await h.fetchMock.respond(reads(h)[0], completion(live(false)));
  await h.clock.advance(120000);
  assert.equal(routes(h).length, 1);
  assert.equal(reads(h).length, 1);
  assert.deepEqual(storage(h), before);
  assert.match(h.text(), /Place a/);
  assert.doesNotMatch(h.text(), /checking local|still checking/i);
});

const queryResponse = events => ({ contract: 'live_event_query_v1', route_mutation: false, day_anchor_mutation: false, live_events: events });
const button = (h, text) => [...h.container.querySelectorAll('button')].find(b => b.textContent.trim() === text);
async function click(h, text) {
  const b = button(h, text); assert.ok(b, text); assert.equal(b.disabled, false, text);
  await h.act(() => b.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}
const queries = h => h.fetchMock.calls.filter(c => c.url.startsWith('/api/live-events?'));

test('a stalled completion body reaches its fixed local deadline without another route request', async t => {
  const h = await start(t);
  await h.clock.advance(9000);
  const read = reads(h)[0];
  await h.fetchMock.respond(read, completion(live(false)), 200, { deferBody: true });
  await h.clock.advance(120000);
  assert.equal(read.aborted, true);
  assert.match(h.text(), /couldn.t verify|couldn.t be verified/i);
  await h.act(() => read.releaseBody());
  assert.equal(routes(h).length, 1);
  assert.match(h.text(), /couldn.t verify|couldn.t be verified/i);
});

test('completion preserves a newer near-route × week query including its late body', async t => {
  const body = day(); body.days[0].primary_route.main_stops[1].lat = 41.901;
  const h = await start(t, body);
  await click(h, 'Explore live');
  await h.fetchMock.respond(queries(h).at(-1), queryResponse(live(false)));
  await click(h, 'Near the route');
  await h.fetchMock.respond(queries(h).at(-1), queryResponse(live(false)));
  await click(h, 'Following 7 days');
  const newer = queries(h).at(-1);
  const events = live(false);
  events.this_week = [{ id: 'filtered', title: 'Filtered occurrence', time_window: { kind: 'occurrences', dates: ['2026-10-10'] } }];
  await h.fetchMock.respond(newer, queryResponse(events), 200, { deferBody: true });
  await h.clock.advance(9000);
  await h.fetchMock.respond(reads(h)[0], completion(live(false)));
  assert.equal(newer.aborted, false, 'sidecar completion is not a new published day');
  assert.equal(button(h, 'Near the route').getAttribute('aria-pressed'), 'true');
  assert.equal(button(h, 'Following 7 days').getAttribute('aria-pressed'), 'true');
  await h.act(() => newer.releaseBody());
  assert.match(h.text(), /Filtered occurrence/);
  assert.equal(queries(h).length, 3);
  await h.clock.advance(120000);
  assert.equal(routes(h).length, 1);
});

for (const cause of ['navigation', 'intent']) test(`${cause} aborts completion immediately and rejects a late terminal body`, async t => {
  const h = await start(t);
  await h.clock.advance(9000);
  const read = reads(h)[0];
  const events = live(false); events.tonight = [{ id: 'stale', title: 'Stale event' }];
  await h.fetchMock.respond(read, completion(events), 200, { deferBody: true });
  if (cause === 'navigation') await h.act(() => h.window.dispatchEvent(new h.window.Event('pagehide')));
  else { await click(h, 'Adjust'); await click(h, 'Tomorrow'); }
  assert.equal(read.aborted, true, 'completion controller must abort at invalidation, not debounce');
  await h.act(() => read.releaseBody());
  assert.doesNotMatch(h.text(), /Stale event/);
  await h.clock.advance(120000);
  assert.equal(reads(h).length, 1);
  assert.equal(routes(h).length, cause === 'navigation' ? 1 : 2, 'only an explicit adjustment may submit another route');
});

for (const outcome of ['missing', 'unsupported', 'expired', 'invalid', 'failed', 'uncovered', 'healthy-empty']) test(`mounted ${outcome} completion stays honest without route replay`, async t => {
  const original = day();
  if (outcome === 'missing') delete original.live_completion;
  if (outcome === 'unsupported') original.live_completion.version = 2;
  const h = await start(t, original);
  const before = storage(h);
  await h.clock.advance(9000);
  if (['missing','unsupported'].includes(outcome)) assert.equal(reads(h).length, 0);
  else {
    const events = live(false);
    if (outcome === 'failed') { events.coverage = 'unavailable'; Object.assign(events.acquisition.source_health, {status: 'failed', result: 'unavailable', responding_source_count: 0, empty_source_count: 0, failed_source_count: 1}); }
    if (outcome === 'uncovered') { events.coverage = 'uncovered'; Object.assign(events.acquisition.source_health, {status: 'uncovered', result: 'uncovered', selected_source_count: 0, responding_source_count: 0, empty_source_count: 0}); }
    await h.fetchMock.respond(reads(h)[0], outcome === 'expired' ? {error: 'live_completion_expired'} : outcome === 'invalid' ? {error: 'live_completion_unavailable'} : completion(events), outcome === 'expired' ? 410 : outcome === 'invalid' ? 503 : 200);
  }
  await h.clock.advance(120000);
  assert.equal(routes(h).length, 1);
  assert.deepEqual(storage(h), before);
  if (['missing','unsupported','expired','invalid','failed'].includes(outcome)) assert.match(h.text(), /couldn.t verify|couldn.t be verified/i);
  if (outcome === 'uncovered') assert.match(h.text(), /No live-events feed reaches this place yet/i);
  assert.match(h.text(), /Place a/);
});

test('pending completion reads are strictly serial and stop after four attempts', async t => {
  const h = await start(t);
  for (let i = 0; i < 4; i++) {
    await h.clock.advance([9000,12000,18000,24000][i]);
    assert.equal(reads(h).length, i + 1);
    await h.clock.advance(1000);
    assert.equal(reads(h).length, i + 1, 'unanswered read never overlaps another');
    await h.fetchMock.respond(reads(h)[i], completion(live()), 202);
  }
  await h.clock.advance(120000);
  assert.equal(reads(h).length, 4);
  assert.equal(routes(h).length, 1);
  assert.match(h.text(), /couldn.t verify|couldn.t be verified/i);
});

test('new route publication cannot receive the previous completion body', async t => {
  const h = await start(t);
  await h.clock.advance(9000);
  const old = reads(h)[0];
  const stale = live(false); stale.tonight = [{id: 'stale', title: 'Stale event'}];
  await h.fetchMock.respond(old, completion(stale), 200, {deferBody: true});
  await click(h, 'Adjust'); await click(h, 'Tomorrow');
  await h.clock.advance(400);
  const next = day(); next.live_events = live(false); delete next.live_completion;
  next.days[0].primary_route.main_stops[0].label = 'New route';
  await h.fetchMock.respond(routes(h).at(-1), next);
  const before = storage(h);
  await h.act(() => old.releaseBody());
  assert.match(h.text(), /New route/); assert.doesNotMatch(h.text(), /Stale event/);
  assert.deepEqual(storage(h), before);
});
