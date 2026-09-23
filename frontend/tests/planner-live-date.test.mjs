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
