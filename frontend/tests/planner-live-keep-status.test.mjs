/** Real mounted controls with controlled API replies; no provider/walking causal proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';

const DATE = '2026-10-18';
const ID = `live:${DATE}:${'a'.repeat(32)}`;
const OTHER = `live:${DATE}:${'b'.repeat(32)}`;
const LAST = 'parranda:anywhere:last';
const URL = 'http://localhost/anywhere?place=Fixture%20Town&lang=en';
const stable = [
  { id: 'museum', label: 'Fixture Museum', type: 'museum', lat: 59.333, lng: 18.065, covered_preferences: ['culture'] },
  { id: 'lunch', label: 'Fixture Lunch', type: 'restaurant', lat: 59.334, lng: 18.066, covered_preferences: ['food'] },
];

function day({ occurrence = ID, honored = false } = {}) {
  const event = {
    id: occurrence === OTHER ? 'other-event' : 'source-event', title: occurrence === OTHER ? 'Other concert' : 'Evening concert',
    live_occurrence_id: occurrence, live_choice_eligible: true, route_eligible: true,
    occurrence_date: DATE, starts_at: `${DATE}T18:00:00Z`, timezone: 'Europe/Stockholm',
    lat: 59.335, lng: 18.067, source_label: 'Source', source_url: 'https://source.example/event',
  };
  return {
    days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: {
      id: '__agnostic_compose__', title: 'Fixture day', estimated_km: 3.9,
      main_stops: [...stable, { ...event, id: `live-event-${event.id}`, event_id: event.id,
        label: event.title, is_live_event: true, source: { label: 'Source', url: event.source_url } }],
      map_route_points: [], map_path_points: [], legs: [],
    }, alternatives: [] }],
    place_structure: { provenance: 'agnostic_anchor', area_count: 1, areas: [],
      district_day: { areas: [], evening_event: { ...event, woven_into_route: true } } },
    agnostic_route_output_experiment: { promotion: { promote: true },
      source_status: { anchor: { lat: 59.333, lng: 18.065 } },
      live_event_choices: { requested_count: honored ? 1 : 0, ignored_other_day_count: 0,
        remove_requested: false, honored_count: honored ? 1 : 0, unhonored: [] } },
    live_events: { coverage: 'covered', selected_date: DATE, pending: false, tonight: [event], this_week: [event],
      acquisition: { source_health: { status: 'healthy', result: 'events_found' } } },
  };
}

function sourceRefusal() {
  return {
    days: [],
    agnostic_route_output_experiment: { promotion: { promote: false },
      eligibility: { eligible: false, blockers: ['live_keep_not_preserved'] },
      live_event_choices: { requested_count: 1, ignored_other_day_count: 0, remove_requested: false,
        honored_count: 0, unhonored: [{ id: ID, reason: 'event_not_available_or_eligible' }] } },
    live_events: { coverage: 'unavailable', selected_date: DATE, pending: false, tonight: [], this_week: [],
      acquisition: { source_health: { status: 'failed', result: 'source_failed' } } },
  };
}

const routes = h => h.fetchMock.calls.filter(call => call.url.includes('route-recommendations'));
const button = (h, label) => [...h.container.querySelectorAll('button')].find(control =>
  control.textContent.trim() === label || control.getAttribute('aria-label') === label);
const routeText = h => h.container.querySelector('section[aria-label="The route"]')?.textContent || '';
async function click(h, label) {
  const control = button(h, label);
  assert.ok(control, `actual ${label} control`);
  await h.act(() => control.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
}
async function start(t, { manualTeardown = false } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${DATE}T10:00:00Z`) });
  const h = await mountPlanner({ url: URL });
  if (!manualTeardown) t.after(() => h.unmount());
  await h.fetchMock.respond(routes(h)[0], day());
  assert.match(routeText(h), /Evening concert/);
  assert.equal(Boolean(button(h, 'Kept — release')), false, 'automatic inclusion is not a Keep confirmation');
  return h;
}
async function requestKeep(h) {
  await click(h, 'Keep this event');
  await h.clock.advance(400);
  const request = routes(h).at(-1);
  assert.deepEqual(request.body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }]);
  assert.ok(!request.body.pinned_candidate_ids?.includes(ID), 'the occurrence is not a place pin');
  return request;
}

// An optimistic ledger write must not turn a pending request into a confirmed badge.
test('Keep pending for an already included event retains the old day without claiming Kept', async t => {
  const h = await start(t);
  const before = h.readStorage(LAST);
  const request = await requestKeep(h);
  assert.match(routeText(h), /Evening concert/);
  assert.deepEqual(h.readStorage(LAST), before);
  const prematurelyConfirmed = Boolean(button(h, 'Kept — release'));
  // Settle the deferred request before teardown; the assertion concerns the
  // captured pre-response state, not the later response.
  await h.fetchMock.respond(request, day({ honored: true }));
  assert.equal(prematurelyConfirmed, false, 'only a server-honored publication may say Kept');
});

// The absence of a newly honored occurrence must not borrow the old visible event as proof.
test('a source-refused Keep retains the old event and saved day without a confirmed Kept badge', async t => {
  const h = await start(t);
  const before = h.readStorage(LAST);
  const request = await requestKeep(h);
  await h.fetchMock.respond(request, sourceRefusal());
  assert.match(routeText(h), /Evening concert/);
  assert.deepEqual(h.readStorage(LAST), before);
  assert.ok(button(h, 'Try planning with this event again'), 'the saved intent remains recoverable');
  assert.equal(Boolean(button(h, 'Kept — release')), false, 'a refused request cannot confirm the old event');
});

test('a source failure is not presented as a proven walking rejection', async t => {
  const h = await start(t);
  const request = await requestKeep(h);
  await h.fetchMock.respond(request, sourceRefusal());
  assert.match(routeText(h), /Evening concert/);
  assert.ok(button(h, 'Try planning with this event again'));
  assert.doesNotMatch(h.text(), /could not be confirmed in a walkable day/i,
    'source evidence failure does not establish a walking-limit cause');
});

test('a transport failure leaves Keep unconfirmed without inventing a walking-limit cause', async t => {
  const h = await start(t);
  const before = h.readStorage(LAST);
  const request = await requestKeep(h);
  await h.act(() => request.rejectResponse(new Error('controlled transport failure')));
  assert.match(routeText(h), /Evening concert/);
  assert.deepEqual(h.readStorage(LAST), before);
  assert.ok(button(h, 'Try planning with this event again'));
  assert.doesNotMatch(h.text(), /could not be confirmed in a walkable day/i);
  assert.equal(Boolean(button(h, 'Kept — release')), false);
});

test('a publication of another occurrence cannot confirm the requested old occurrence', async t => {
  const h = await start(t);
  const request = await requestKeep(h);
  await h.fetchMock.respond(request, day({ occurrence: OTHER, honored: true }));
  assert.match(routeText(h), /Evening concert/);
  assert.doesNotMatch(routeText(h), /Other concert/);
  assert.equal(Boolean(button(h, 'Kept — release')), false);
});

// Removing Kept everywhere would hide the defect but break this positive journey.
test('only the honored same-occurrence publication says Kept, and Undo restores the prior unkept day without another request', async t => {
  const h = await start(t);
  const before = h.readStorage(LAST);
  const request = await requestKeep(h);
  await h.fetchMock.respond(request, day({ honored: true }));
  assert.ok(button(h, 'Kept — release'));
  assert.equal(h.readStorage(LAST).commitments.entries[ID].kind, 'pin');
  await click(h, 'Undo');
  await h.clock.advance(500);
  assert.equal(routes(h).length, 2);
  assert.deepEqual(h.readStorage(LAST), before);
  assert.match(routeText(h), /Evening concert/);
  assert.equal(Boolean(button(h, 'Kept — release')), false);
  assert.ok(button(h, 'Keep this event'));
});

test('a recovered reload intent still needs a fresh honored publication before saying Kept', async t => {
  const h = await start(t, { manualTeardown: true });
  let mounted = h;
  t.after(() => mounted?.unmount());
  const request = await requestKeep(h);
  await h.fetchMock.respond(request, day({ honored: true }));
  const last = h.readStorage(LAST);
  const url = h.window.location.href;
  await h.unmount();
  mounted = null;
  const reload = await mountPlanner({ url,
    storage: { [LAST]: last }, navigationType: 'reload' });
  mounted = reload;
  const fresh = routes(reload)[0];
  assert.deepEqual(fresh.body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }]);
  assert.equal(Boolean(button(reload, 'Kept — release')), false, 'an older stored verdict is not a fresh Keep verdict');
  await reload.fetchMock.respond(fresh, sourceRefusal());
  assert.equal(Boolean(button(reload, 'Kept — release')), false);
  assert.doesNotMatch(reload.text(), /could not be confirmed in a walkable day/i);
});

test('re-Keep after releasing the confirmed same occurrence cannot borrow its old confirmation during debounce', async t => {
  const h = await start(t);
  const first = await requestKeep(h);
  await h.fetchMock.respond(first, day({ honored: true }));
  assert.ok(button(h, 'Kept — release'));

  await click(h, 'Kept — release');
  assert.ok(button(h, 'Keep this event'));
  await click(h, 'Keep this event');
  const immediatelyConfirmed = Boolean(button(h, 'Kept — release'));
  await h.clock.advance(399);
  assert.equal(routes(h).length, 2, 'the fresh request is still inside its debounce');
  const debounceConfirmed = Boolean(button(h, 'Kept — release'));
  await h.clock.advance(1);
  assert.equal(routes(h).length, 3);
  const fresh = routes(h).at(-1);
  assert.deepEqual(fresh.body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }]);
  const pendingConfirmed = Boolean(button(h, 'Kept — release'));
  // Settle before reporting a captured failure, so an outstanding request is
  // never what prevents teardown of the negative/mutation case.
  await h.fetchMock.respond(fresh, day({ honored: true }));
  assert.equal(immediatelyConfirmed, false, 're-Keep is new intent, even for the same occurrence');
  assert.equal(debounceConfirmed, false, 'the old publication cannot confirm the debounce window');
  assert.equal(pendingConfirmed, false, 'only the fresh response can confirm the new Keep request');
  assert.ok(button(h, 'Kept — release'));
});

test('retry after an existing Keep fails revalidation cannot revive its older confirmation before a fresh answer', async t => {
  const h = await start(t);
  const first = await requestKeep(h);
  await h.fetchMock.respond(first, day({ honored: true }));
  const confirmedDay = h.readStorage(LAST);
  assert.ok(button(h, 'Kept — release'));

  await click(h, 'Adjust');
  await click(h, 'Full');
  await h.clock.advance(400);
  const revalidation = routes(h).at(-1);
  assert.deepEqual(revalidation.body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }]);
  await h.fetchMock.respond(revalidation, sourceRefusal());
  assert.match(routeText(h), /Evening concert/);
  assert.deepEqual(h.readStorage(LAST), confirmedDay, 'the refused adjustment retains the published day');
  assert.equal(Boolean(button(h, 'Kept — release')), false);

  await click(h, 'Try planning with this event again');
  const retry = routes(h).at(-1);
  assert.notEqual(retry, revalidation);
  assert.deepEqual(retry.body.live_event_choices, [{ occurrence_id: ID, action: 'keep' }], 'retry preserves the exact saved intent');
  assert.deepEqual(retry.body.dates, [DATE]);
  const prematurelyReconfirmed = Boolean(button(h, 'Kept — release'));
  assert.match(routeText(h), /Evening concert/);
  assert.deepEqual(h.readStorage(LAST), confirmedDay);
  // Settle the controlled retry before a possible assertion failure/teardown.
  await h.fetchMock.respond(retry, day({ honored: true }));
  assert.equal(prematurelyReconfirmed, false, 'clearing the refusal message must not restore an older Keep verdict');
  assert.ok(button(h, 'Kept — release'), 'the fresh honored retry may confirm the occurrence');
});
