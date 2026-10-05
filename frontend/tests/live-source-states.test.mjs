import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const capturedUncovered = JSON.parse(readFileSync(new URL('./fixtures/captured-uncovered-live.json', import.meta.url)));
// Exact Live response bodies from integration-549-1ebf3be-20261005T013305Z/
// browser-responses.json (SHA256 40c47acd6af950635357ee5165cfa5de7bdd3e806379e2bedef233e82180d03e).
// Replaying captured transport is deterministic UI regression, not provider acceptance.
import { mountPlanner } from './helpers/planner-harness.mjs';

// Mounted component with controlled transport. It proves how the Planner reads
// the server's source-health contract (tests/live-failed-refresh.test.js); it
// is not provider or Pi acceptance.
const COUNT_FIELDS = ['selected_source_count', 'responding_source_count',
  'event_bearing_source_count', 'empty_source_count', 'failed_source_count',
  'unavailable_source_count', 'raw_event_count', 'normalized_event_count',
  'accepted_event_count', 'surfaced_event_count', 'rejected_event_count'];

function live(health, extra = {}) {
  return {
    selected_date: '2026-09-25',
    coverage: 'covered',
    feeds: [{ id: 'calendar', label: 'Official calendar', status: 'failed' }],
    tonight: [],
    this_week: [],
    acquisition: { source_health: {
      ...Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0])),
      reasons: [],
      ...health,
    } },
    ...extra,
  };
}
const FAILED = { status: 'unavailable', result: 'unknown', selected_source_count: 1,
  failed_source_count: 1, reasons: ['source_failures_present', 'all_sources_unavailable'] };
const PARTIAL_EMPTY = { status: 'partial', result: 'empty', selected_source_count: 2,
  responding_source_count: 1, empty_source_count: 1, failed_source_count: 1,
  reasons: ['source_failures_present', 'no_current_events_found'] };
const HEALTHY_EMPTY = { status: 'healthy', result: 'empty', selected_source_count: 1,
  responding_source_count: 1, empty_source_count: 1, reasons: ['no_current_events_found'] };
const PENDING = { status: 'pending', result: 'pending', selected_source_count: 1,
  reasons: ['background_refresh_pending'] };

function day(liveEvents) {
  return { days: [{ experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', title: 'Published day', main_stops: [
      { id: 'a', label: 'Museum', lat: 60.17, lng: 24.94 },
      { id: 'b', label: 'Cafe', lat: 60.172, lng: 24.942 },
    ], estimated_km: 2, map_path_points: [], legs: [], confidence: 'low',
  }, alternatives: [] }], live_events: liveEvents,
  agnostic_route_output_experiment: { promotion: { promote: true }, source_status: { anchor: { lat: 60.17, lng: 24.94 } } } };
}
const queryBody = (liveEvents) => ({ contract: 'live_event_query_v1', route_mutation: false,
  day_anchor_mutation: false, live_events: liveEvents });
const button = (h, pattern) => [...h.container.querySelectorAll('button')].find((b) => pattern.test(b.textContent));
async function click(h, control) {
  assert.ok(control, 'control exists');
  await h.act(() => control.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}
async function composed(liveEvents, lang = 'en') {
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Testville&lang=${lang}` });
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day(liveEvents));
  await h.clock.advance(50);
  return h;
}
const sheetText = (h) => h.container.querySelector('[role="dialog"]')?.textContent || '';

for (const lang of ['en', 'sv']) test(`captured uncovered Live distinguishes missing coverage in ${lang}`, async t => {
  const h = await composed(capturedUncovered[0].live_events, lang);
  t.after(() => h.unmount());
  await click(h, button(h, /Explore live|Utforska live/));
  for (const response of capturedUncovered) {
    if (response.query.time === 'this_week') await click(h, button(h, /^(Following 7 days|Följande 7 dagar)$/));
    const query = h.fetchMock.pending().find(call => call.url.includes('/api/live-events'));
    if (query) await h.fetchMock.respond(query, response);
    else {
      await click(h, button(h, /^(Around Testville|Runt Testville)$/));
      await h.fetchMock.respond(h.fetchMock.pending().find(call => call.url.includes('/api/live-events')), response);
    }
    assert.match(sheetText(h), lang === 'en' ? /No verified calendar coverage for this area yet/ : /Verifierad kalendertäckning saknas för det här området/);
    assert.doesNotMatch(sheetText(h), /Nothing verified|Nothing listed|Inget verifierat|Inget listat|0\/0|no_approved_sources/);
  }
  assert.equal(h.fetchMock.calls.filter(call => call.url.includes('/api/route-recommendations')).length, 1);
});

for (const lang of ['en', 'sv']) for (const health of [
  { status: 'unavailable', result: 'unknown' },
  { status: 'unknown', result: 'unknown' },
]) test(`Live ${health.status} without selected sources stays unknown in ${lang}`, async t => {
  const events = live(health, { feeds: [] });
  const h = await composed(events, lang);
  t.after(() => h.unmount());
  await click(h, button(h, /Explore live|Utforska live/));
  const query = h.fetchMock.pending().find(call => call.url.includes('/api/live-events'));
  if (query) await h.fetchMock.respond(query, queryBody(events));
  assert.match(sheetText(h), lang === 'en' ? /Live information is unavailable right now/ : /Live-information är inte tillgänglig just nu/);
  assert.doesNotMatch(sheetText(h), /Nothing verified|Nothing listed|Inget verifierat|Inget listat|0\/0/);
  assert.ok(button(h, /^(Try again|Försök igen)$/));
});

const SINGLE_FAILURE = "Parranda couldn't fetch the event source just now, so no events can be shown. That doesn't mean nothing is on — try again shortly.";

test('a failed source is reported as a failure in Live and the Live sheet — not loading, not quiet', async (t) => {
  const h = await composed(live(FAILED));
  t.after(() => h.unmount());
  assert.ok(h.text().includes(SINGLE_FAILURE), h.text());
  assert.doesNotMatch(h.text(), /quiet calendar|Checking the calendars|couldn't verify/);

  await click(h, button(h, /Explore live/));
  const query = h.fetchMock.pending().find((call) => call.url.includes('/api/live-events'));
  assert.ok(query, 'opening Live after a failure checks again');
  await h.fetchMock.respond(query, queryBody(live(FAILED)));
  const sheet = sheetText(h);
  assert.ok(sheet.includes(SINGLE_FAILURE), sheet);
  assert.match(sheet, /Source health: 0\/1 responded/);
  assert.doesNotMatch(sheet, /Nothing verified|still updating/);
});

test('a partial failure with nothing accepted names the share of sources fetched', async (t) => {
  const h = await composed(live(PARTIAL_EMPTY));
  t.after(() => h.unmount());
  assert.ok(h.text().includes(
    "Parranda could only fetch 1 of 2 event sources just now, and no events could be confirmed. That doesn't mean nothing is on",
  ), h.text());
});

test('a responding empty calendar is stated as what the sources list, not as a quiet place', async (t) => {
  const h = await composed(live(HEALTHY_EMPTY, { feeds: [{ id: 'calendar', label: 'Official calendar', status: 'empty' }] }));
  t.after(() => h.unmount());
  assert.ok(h.text().includes('The sources responded but list no events for this period.'), h.text());
  assert.doesNotMatch(h.text(), /quiet calendar|couldn't fetch|couldn't verify/);
});

// Observed in the #506 Pi review (Malmö): the municipal source returned 18 rows,
// every one was rejected and the festival source failed. Rows are not hits.
const ROWS_REJECTED_ONE_FAILED = { status: 'partial', result: 'empty', selected_source_count: 2,
  responding_source_count: 1, event_bearing_source_count: 1, failed_source_count: 1,
  raw_event_count: 18, normalized_event_count: 18, rejected_event_count: 18,
  accepted_event_count: 0, surfaced_event_count: 0,
  reasons: ['source_failures_present', 'all_event_evidence_rejected'] };

test('returned rows that were all rejected are never shown as source hits', async (t) => {
  const h = await composed(live(ROWS_REJECTED_ONE_FAILED));
  t.after(() => h.unmount());
  assert.ok(h.text().includes('Parranda could only fetch 1 of 2 event sources just now, and no events could be confirmed.'), h.text());
  await click(h, button(h, /Explore live/));
  const query = h.fetchMock.pending().find((call) => call.url.includes('/api/live-events'));
  assert.ok(query);
  await h.fetchMock.respond(query, queryBody(live(ROWS_REJECTED_ONE_FAILED)));
  const sheet = sheetText(h);
  assert.ok(sheet.includes('Parranda could only fetch 1 of 2 event sources just now'), sheet);
  assert.match(sheet, /Source health: 1\/2 responded/);
  assert.doesNotMatch(sheet, /with events/);
});

test('accepted events that surfaced keep the per-source hit count', async (t) => {
  const surfaced = live({ status: 'healthy', result: 'events_found', selected_source_count: 1,
    responding_source_count: 1, event_bearing_source_count: 1, raw_event_count: 3,
    normalized_event_count: 3, accepted_event_count: 1, surfaced_event_count: 1,
    reasons: ['bounded_events_found'] }, {
    feeds: [{ id: 'calendar', label: 'Official calendar', status: 'ok' }],
    tonight: [{ id: 'concert', title: 'Harbour concert', timezone: 'Europe/Stockholm',
      starts_at: '2026-09-25T17:00:00Z', source_label: 'Official calendar',
      source_url: 'https://calendar.example/concert' }],
  });
  const h = await composed(surfaced);
  t.after(() => h.unmount());
  await click(h, button(h, /See all live/));
  const sheet = sheetText(h);
  assert.match(sheet, /Harbour concert/);
  assert.match(sheet, /Source health: 1\/1 responded · 1 with events/);
});

test('a route-woven event is not described as no verified events in the Live sheet', async (t) => {
  const event = { id: 'concert', title: 'Harbour concert', timezone: 'Europe/Stockholm',
    starts_at: '2026-09-25T17:00:00Z', source_label: 'Official calendar' };
  const result = day(live({ status: 'healthy', result: 'events_found', selected_source_count: 1,
    responding_source_count: 1, accepted_event_count: 1, surfaced_event_count: 1 },
  { tonight: [event] }));
  result.days[0].primary_route.main_stops.push({ id: 'live-concert', event_id: 'concert', is_live_event: true,
    label: 'Harbour concert', lat: 60.174, lng: 24.946 });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], result);
  await h.clock.advance(50);
  assert.match(h.text(), /Harbour concert · Included in today's route/);
  assert.doesNotMatch(h.text(), /The sources responded but list no events/);
  await click(h, button(h, /Explore live/));
  const sheet = sheetText(h);
  assert.match(sheet, /Harbour concert · Included in today's route/);
  assert.doesNotMatch(sheet, /Nothing verified/);
});

test('while waiting, the Live sheet does not print responded counts that read as a failure', async (t) => {
  const h = await composed(live(PENDING, { pending: true, feeds: [{ id: 'calendar', label: 'Official calendar', status: 'pending' }] }));
  t.after(() => h.unmount());
  assert.match(h.text(), /Checking the calendars — updates automatically in a moment\./);
  await click(h, button(h, /Explore live/));
  const sheet = sheetText(h);
  assert.match(sheet, /Refreshing verified sources for this area/);
  assert.doesNotMatch(sheet, /Source health: 0\/1 responded/);
  assert.doesNotMatch(sheet, /couldn't fetch/);
});

for (const health of [FAILED, PARTIAL_EMPTY]) test(`a terminal ${health.status} source result offers a working retry in the current Live cell`, async (t) => {
  const h = await composed(live(health));
  t.after(() => h.unmount());
  await click(h, button(h, /Explore live/));
  const initial = h.fetchMock.pending().find((call) => call.url.includes('/api/live-events'));
  await h.fetchMock.respond(initial, queryBody(live(health)));
  const composeCount = h.fetchMock.calls.filter((call) => call.url.includes('/api/route-recommendations')).length;
  const retry = [...h.container.querySelector('[role="dialog"]').querySelectorAll('button')]
    .find((control) => /^Try again$/.test(control.textContent));
  assert.ok(retry, 'a finished source failure has a retry action, not only advice to try again');
  await click(h, retry);
  const next = h.fetchMock.pending().find((call) => call.url.includes('/api/live-events'));
  assert.deepEqual(next.body, initial.body, 'retry retains the selected scope, period, preferences and date');
  await h.fetchMock.respond(next, queryBody(live(HEALTHY_EMPTY)));
  assert.doesNotMatch(sheetText(h), /couldn't fetch|could only fetch/);
  assert.equal(h.fetchMock.calls.filter((call) => call.url.includes('/api/route-recommendations')).length, composeCount);
});

test('reopening Live keeps the queried period and route scope instead of relabelling old results', async (t) => {
  const today = { id: 'today', title: 'Selected-day concert', starts_at: '2026-09-25T18:00:00Z' };
  const h = await composed(live(HEALTHY_EMPTY, { tonight: [today] }));
  t.after(() => h.unmount());
  await click(h, button(h, /See all live/));
  await click(h, button(h, /^Near the route$/));
  await h.fetchMock.respond(h.fetchMock.pending().find((call) => call.url.includes('/api/live-events')),
    queryBody(live(HEALTHY_EMPTY, { tonight: [today] })));
  await click(h, button(h, /^Following 7 days$/));
  const weekQuery = h.fetchMock.pending().find((call) => call.url.includes('/api/live-events'));
  assert.equal(weekQuery.body.scope, 'near_route');
  assert.equal(weekQuery.body.time, 'this_week');
  const following = { id: 'following', title: 'Following-day market', starts_at: '2026-09-26T18:00:00Z' };
  await h.fetchMock.respond(weekQuery, queryBody(live(HEALTHY_EMPTY, { this_week: [following] })));
  assert.match(sheetText(h), /Following-day market/);
  await click(h, h.container.querySelector('[role="dialog"] button[aria-label="Close live"]'));
  await click(h, button(h, /See all live/));
  const reopened = h.fetchMock.pending().find((call) => call.url.includes('/api/live-events'));
  assert.ok(reopened, 'reopening refreshes the selected cell');
  assert.equal(reopened.body.time, 'this_week');
  assert.equal(reopened.body.scope, 'near_route');
  await h.fetchMock.respond(reopened, queryBody(live(HEALTHY_EMPTY, { this_week: [following] })));
  const sheet = h.container.querySelector('[role="dialog"]');
  assert.match(sheetText(h), /Following-day market/);
  assert.equal([...sheet.querySelectorAll('button')].find((b) => /^Following 7 days$/.test(b.textContent)).getAttribute('aria-pressed'), 'true');
  assert.equal([...sheet.querySelectorAll('button')].find((b) => /^Near the route$/.test(b.textContent)).getAttribute('aria-pressed'), 'true');
});

test('reopening an interrupted Live refresh retries its route scope and period', async (t) => {
  const today = { id: 'today', title: 'Selected-day concert', starts_at: '2026-09-25T18:00:00Z' };
  const h = await composed(live(HEALTHY_EMPTY, { tonight: [today] }));
  t.after(() => h.unmount());
  await click(h, button(h, /See all live/));
  await click(h, button(h, /^Near the route$/));
  await h.fetchMock.respond(h.fetchMock.pending().find((call) => call.url.includes('/api/live-events')),
    queryBody(live(HEALTHY_EMPTY, { tonight: [today] })));
  await click(h, button(h, /^Following 7 days$/));
  await h.fetchMock.respond(h.fetchMock.pending().find((call) => call.url.includes('/api/live-events')),
    queryBody(live(PENDING, { pending: true })));
  await click(h, h.container.querySelector('[role="dialog"] button[aria-label="Close live"]'));
  await click(h, button(h, /See all live/));
  const query = h.fetchMock.pending().find((call) => call.url.includes('/api/live-events'));
  assert.ok(query, 'reopening resumes the interrupted query');
  assert.equal(query.body.scope, 'near_route');
  assert.equal(query.body.time, 'this_week');
  assert.equal(query.body.selected_date, '2026-09-25');
});
