import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

// Mounted component with controlled transport, not real-provider acceptance.
const health = Object.fromEntries(['selected_source_count', 'responding_source_count',
  'event_bearing_source_count', 'empty_source_count', 'failed_source_count',
  'unavailable_source_count', 'raw_event_count', 'normalized_event_count',
  'accepted_event_count', 'surfaced_event_count', 'rejected_event_count'].map(k => [k, 0]));
function live(date, title = 'Selected-day concert') {
  return { selected_date: date, coverage: 'covered', pending: false,
    acquisition: { source_health: { ...health, status: 'healthy', result: 'events_found', reasons: [],
      selected_source_count: 1, responding_source_count: 1, accepted_event_count: 1 } },
    tonight: [{ id: title, title, timezone: 'Europe/Helsinki', starts_at: `${date}T18:00:00Z`,
      source_label: 'Official calendar', source_url: 'https://calendar.example/concert' }], this_week: [] };
}
function day(date) {
  return { days: [{ experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', title: 'Published day', main_stops: [
      { id: 'a', label: 'Museum', lat: 60.17, lng: 24.94 },
      { id: 'b', label: 'Cafe', lat: 60.172, lng: 24.942 },
    ], estimated_km: 2, map_path_points: [], legs: [], confidence: 'low',
  }, alternatives: [] }], live_events: live(date),
  agnostic_route_output_experiment: { promotion: { promote: true }, source_status: { anchor: { lat: 60.17, lng: 24.94 } } } };
}
const button = (h, pattern) => [...h.container.querySelectorAll('button')].find(b => pattern.test(b.textContent));
async function click(h, control) {
  assert.ok(control, 'control exists');
  await h.act(() => control.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}

test('whole-area Live sends the published place and shows a farther event without changing the day', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const published = day('2026-06-29');
  published.agnostic_route_output_experiment.intake = { query: 'Testville' };
  await h.fetchMock.respond(h.fetchMock.pending()[0], published);
  await h.clock.advance(50);
  await click(h, button(h, /See all live/));
  const composeCount = h.fetchMock.calls.filter(c => c.url.includes('/api/route-recommendations')).length;
  await click(h, button(h, /^Whole area$/));
  const query = h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.equal(query.body.scope, 'in_place');
  assert.equal(query.body.place_query, 'Testville');
  assert.equal(query.body.selected_date, '2026-06-29');
  const events = live('2026-06-29', 'Neighbourhood village festa');
  events.tonight[0].live_proximity = 'in_place';
  events.tonight[0].anchor_distance_km = 8.4;
  await h.fetchMock.respond(query, { contract: 'live_event_query_v1', route_mutation: false, day_anchor_mutation: false, live_events: events });
  const sheet = h.container.querySelector('[role="dialog"]');
  assert.match(sheet.textContent, /Neighbourhood village festa/);
  assert.match(sheet.textContent, /8.4 km away/);
  assert.equal(h.fetchMock.calls.filter(c => c.url.includes('/api/route-recommendations')).length, composeCount);
});

for (const deferBody of [false, true]) test(`new day invalidates held-day Live results (deferred body: ${deferBody})`, async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day('2026-06-28'));
  await h.clock.advance(50);
  await click(h, button(h, /Adjust/));
  await click(h, button(h, /^Tomorrow$/));
  await click(h, button(h, /See all live/));
  await h.clock.advance(500);
  const compose = h.fetchMock.pending().find(c => c.url.includes('/api/route-recommendations'));
  assert.ok(compose);
  await click(h, button(h, /^Near the route$/));
  const query = h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.ok(query);
  assert.equal(query.body.selected_date, '2026-06-28');
  await h.fetchMock.respond(query, { contract: 'live_event_query_v1', route_mutation: false,
    day_anchor_mutation: false, live_events: live('2026-06-28', 'OLD DAY late event') }, 200, { deferBody });
  await h.fetchMock.respond(compose, day('2026-06-29'));
  if (deferBody) await h.act(() => query.releaseBody());
  assert.doesNotMatch(h.text(), /OLD DAY late event/);
  if (deferBody) assert.equal(query.aborted, true);
});

test('Live sheet uses the published calendar date and rejects a late body after date edit', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day('2026-06-29'));
  await h.clock.advance(50);
  assert.match(h.text(), /29 Jun/);
  await click(h, button(h, /See all live/));
  await click(h, button(h, /^Near the route$/));
  const query = h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.ok(query, 'changing Live scope requests the selected calendar date');
  assert.equal(query.body.selected_date, '2026-06-29');
  await h.fetchMock.respond(query, { contract: 'live_event_query_v1', route_mutation: false,
    day_anchor_mutation: false, live_events: live('2026-06-29', 'STALE query event') }, 200, { deferBody: true });
  await click(h, h.container.querySelector('[aria-label="Close live"]'));
  await click(h, button(h, /Adjust/));
  const before = h.fetchMock.calls.filter(c => c.url.includes('/api/route-recommendations')).length;
  await click(h, button(h, /^Tomorrow$/));
  assert.equal(query.aborted, true, 'abort before the new compose debounce');
  assert.equal(h.fetchMock.calls.filter(c => c.url.includes('/api/route-recommendations')).length, before);
  await h.act(() => query.releaseBody());
  await click(h, button(h, /See all live/));
  assert.doesNotMatch(h.text(), /STALE query event/);
});

test('switching Live time re-queries the selected period and cancels an older response', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day('2026-06-29'));
  await h.clock.advance(50);
  await click(h, button(h, /See all live/));
  await click(h, button(h, /^Following 7 days$/));
  const week = h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.equal(week.body.time, 'this_week');
  assert.equal(week.body.selected_date, '2026-06-29');
  const sheet = h.container.querySelector('[role="dialog"]');
  const selectedDay = [...sheet.querySelectorAll('button')].find(b => /29 Jun/.test(b.textContent));
  await click(h, selectedDay);
  assert.equal(week.aborted, true);
  const today = h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.equal(today.body.time, 'tonight');
  await h.fetchMock.respond(today, { contract: 'live_event_query_v1', route_mutation: false,
    day_anchor_mutation: false, live_events: live('2026-06-29', 'Fresh current-day result') });
  assert.match(sheet.textContent, /Fresh current-day result/);
});

test('cold Live continues beyond ten seconds and replaces pending with events automatically', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day('2026-06-29'));
  await h.clock.advance(50);
  await click(h, button(h, /See all live/));
  await click(h, button(h, /^Near the route$/));
  for (const delay of [1500, 3000, 5000, 5000]) {
    const query = h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
    assert.ok(query, 'refresh is still active');
    await h.fetchMock.respond(query, { contract: 'live_event_query_v1', route_mutation: false,
      day_anchor_mutation: false, live_events: { ...live('2026-06-29'), tonight: [], pending: true } });
    await h.clock.advance(delay);
  }
  const ready = h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.ok(ready, 'the old ten-second cutoff no longer strands the view');
  await h.fetchMock.respond(ready, { contract: 'live_event_query_v1', route_mutation: false,
    day_anchor_mutation: false, live_events: live('2026-06-29', 'Slow calendar concert') });
  assert.match(h.container.querySelector('[role="dialog"]').textContent, /Slow calendar concert/);
});

test('changing time near me reuses this Live location and keeps the Planner anchor intact', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  let permissions = 0;
  Object.defineProperty(h.window.navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition(success) { permissions += 1; success({ coords: { latitude: 60.18, longitude: 24.95 } }); },
  } });
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day('2026-06-29'));
  await h.clock.advance(50);
  await click(h, button(h, /See all live/));
  await click(h, button(h, /Near me$/));
  const near = h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.equal(near.body.scope, 'near_me');
  await h.fetchMock.respond(near, { contract: 'live_event_query_v1', route_mutation: false,
    day_anchor_mutation: false, live_events: live('2026-06-29') });
  await click(h, button(h, /^Following 7 days$/));
  const week = h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  assert.equal(week.body.time, 'this_week');
  assert.deepEqual(week.body.anchor, { lat: 60.18, lng: 24.95 });
  assert.equal(permissions, 1);
  assert.equal(h.fetchMock.calls.filter(c => c.url.includes('/api/route-recommendations')).length, 1);
});
