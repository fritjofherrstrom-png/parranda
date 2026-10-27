/** Mounted UI regressions. API replies below are controlled fixtures, not provider acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';
import dayPolicy from '../../server/planner/day-composition-policy.js';

const DATE = '2026-10-16';
const PLANNER_URL = 'http://localhost/anywhere?place=Fixture%20Town&lang=en&rhythm=full';
const LAST = 'parranda:anywhere:last';
const routeCalls = h => h.fetchMock.calls.filter(c => c.url.includes('route-recommendations'));
const initialStops = [
  { id: 'museum', label: 'Fixture Museum', lat: 59.333, lng: 18.065, type: 'museum', covered_preferences: ['culture'] },
  { id: 'lunch', label: 'Fixture Lunch', lat: 59.334, lng: 18.066, type: 'restaurant', covered_preferences: ['food'] },
  { id: 'gallery', label: 'Fixture Gallery', lat: 59.335, lng: 18.067, type: 'gallery', covered_preferences: ['culture'] },
  { id: 'park', label: 'Fixture Park', lat: 59.336, lng: 18.068, type: 'park', covered_preferences: ['views'] },
  { id: 'exhibit', label: 'Fixture Exhibit', lat: 59.337, lng: 18.069, type: 'museum', covered_preferences: ['culture'] },
].map(stop => ({ ...stop, commitment_eligible: true }));

function response(stops = initialStops, dayEdit = null) {
  const points = [{ lat: 59.3326, lng: 18.0649, label: 'Fixture Town', role: 'start' }, ...stops,
    { lat: 59.3326, lng: 18.0649, label: 'Fixture Town', role: 'end' }];
  const legs = points.slice(1).map((to, index) => ({
    from_label: points[index].label, to_label: to.label, distance_km: 0.1, estimated_walk_minutes: 2,
  }));
  return {
    days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: {
      id: '__agnostic_compose__', title: 'Fixture day', estimated_km: legs.reduce((sum, leg) => sum + leg.distance_km, 0),
      main_stops: stops, map_path_points: [], map_route_points: points, legs,
    }, alternatives: [] }],
    agnostic_route_output_experiment: {
      promotion: { promote: true }, source_status: { anchor: { lat: 59.3326, lng: 18.0649 } },
      ...(dayEdit ? { day_edit: dayEdit } : {}),
    },
    live_events: { coverage: 'covered', selected_date: DATE, pending: false, tonight: [], this_week: [],
      acquisition: { source_health: { status: 'healthy', result: 'empty' } } },
  };
}

function button(h, text) {
  return [...h.container.querySelectorAll('button')].find(item => item.textContent.trim() === text);
}

async function click(h, text) {
  const target = button(h, text);
  assert.ok(Boolean(target), `real button '${text}' exists`);
  await h.act(() => target.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
}

async function expandMuseum(h) {
  const disclosure = [...h.container.querySelectorAll('button[aria-controls]')]
    .find(item => item.textContent.includes('Fixture Museum'));
  assert.ok(Boolean(disclosure), 'published museum has a real disclosure button');
  await h.act(() => disclosure.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
}

async function completed(t, options = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-16T10:00:00Z') });
  const { teardown = true, publishedStops = initialStops, publishedResponse, ...mountOptions } = options;
  const h = await mountPlanner({ url: PLANNER_URL, ...mountOptions });
  if (teardown) t.after(() => h.unmount());
  assert.equal(routeCalls(h).length, 1, 'the real mounted arrival emits exactly one compose');
  await h.fetchMock.respond(routeCalls(h)[0], publishedResponse ?? response(publishedStops));
  return h;
}

test('place stop actions distinguish compact Replace from Remove', async t => {
  const h = await completed(t);
  await expandMuseum(h);
  assert.ok(Boolean(button(h, 'Replace')), 'replace is named for the operation, not an ambiguous dismissal');
  assert.ok(Boolean(button(h, 'Remove')), 'a separate removal action is available');
  const editGroup = button(h, 'Replace').closest('[role="group"]');
  assert.ok(Boolean(editGroup?.contains(button(h, 'Remove'))), 'replace and remove form one compact edit group');
  assert.ok(!button(h, 'Not this one'), 'the former conflated action is no longer offered');
  assert.match(h.container.querySelector('section[aria-label="The route"]').textContent, /Fixture Museum/);
});

test('Remove requests one fewer stop and preserves the other published IDs', async t => {
  const h = await completed(t);
  await expandMuseum(h);
  await click(h, 'Remove');
  await h.clock.advance(400);
  assert.equal(routeCalls(h).length, 2, 'one deliberate edit emits one compose');
  const request = routeCalls(h).at(-1);
  assert.deepEqual(request.body.day_edit, {
    version: 1, action: 'remove', candidate_id: 'museum',
    retained_candidate_ids: ['lunch', 'gallery', 'park', 'exhibit'],
    target_stop_count: 4, slot_index: 0, replacement_preference: null,
    removed_candidate_ids: ['museum'],
  });
  assert.ok(request.body.excluded_candidate_ids.includes('museum'), 'ordinary exclusions agree with edit intent');
  assert.equal(request.body.day_rhythm, 'full', 'manual shortening is not a disguised rhythm change');
  await h.fetchMock.respond(request, response(initialStops.filter(stop => stop.id !== 'museum')));
});

for (const action of ['Remove', 'Replace']) test(`${action} counts an already woven Live stop in the same published extent`, async t => {
  const event = { id: 'live-event-counted', label: 'Counted evening occurrence',
    lat: 59.338, lng: 18.07, type: null, is_live_event: true,
    event_id: 'counted', live_occurrence_id: `live:${DATE}:${'d'.repeat(32)}`,
    live_choice_eligible: true, occurrence_date: DATE, starts_at: `${DATE}T18:00:00Z`, timezone: 'Europe/Stockholm' };
  const h = await completed(t, { publishedStops: [...initialStops, event] });
  await expandMuseum(h); await click(h, action); await h.clock.advance(400);
  const request = routeCalls(h).at(-1);
  assert.equal(request.body.day_edit.target_stop_count, action === 'Remove' ? 5 : 6,
    'the visible six-stop day includes Live, not only stable places');
  assert.deepEqual(request.body.day_edit.retained_candidate_ids, [...initialStops.slice(1).map(stop => stop.id), event.id]);
});

test('applied Remove persists the shorter intent and Undo restores the previous answer without recomposing', async t => {
  const h = await completed(t);
  const previous = h.readStorage(LAST);
  await expandMuseum(h);
  await click(h, 'Remove');
  await h.clock.advance(400);
  const request = routeCalls(h).at(-1);
  const remaining = initialStops.filter(stop => stop.id !== 'museum');
  await h.fetchMock.respond(request, response(remaining, dayPolicy.dayEditOutcome(request.body.day_edit, remaining)));
  const saved = h.readStorage(LAST);
  assert.equal(saved.inputs.dayEdit?.target_stop_count, 4, 'a DOM-only filter is not durable removal');
  assert.deepEqual(saved.inputs.dayEdit.retained_candidate_ids, remaining.map(stop => stop.id));
  assert.notEqual(saved.id, previous.id, 'the shorter intent has a distinct canonical saved identity');
  assert.equal(JSON.parse(new URL(h.window.location.href).searchParams.get('edit')).target_stop_count, 4);
  assert.match(h.text(), /Removed/);
  await click(h, 'Undo');
  assert.match(h.container.querySelector('section[aria-label="The route"]').textContent, /Fixture Museum/);
  assert.equal(h.readStorage(LAST).id, previous.id);
  assert.equal(h.readStorage(LAST).inputs.dayEdit, undefined);
  await h.clock.advance(500);
  assert.equal(routeCalls(h).length, 2, 'Undo installs the old answer atomically, not another generation');
});

test('reload carries the applied shorter day instead of regenerating the original Full extent', async t => {
  let h = await completed(t, { teardown: false });
  t.after(() => h?.unmount());
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const request = routeCalls(h).at(-1);
  const remaining = initialStops.filter(stop => stop.id !== 'museum');
  await h.fetchMock.respond(request, response(remaining, dayPolicy.dayEditOutcome(request.body.day_edit, remaining)));
  const saved = h.readStorage(LAST), url = h.window.location.href;
  await h.unmount(); h = null;
  h = await mountPlanner({ url, storage: { [LAST]: saved }, navigationType: 'reload' });
  const reloaded = routeCalls(h)[0];
  await h.fetchMock.respond(reloaded, response(remaining, reloaded.body.day_edit ? dayPolicy.dayEditOutcome(reloaded.body.day_edit, remaining) : null));
  assert.equal(reloaded.body.day_edit?.target_stop_count, 4, 'reload must not discard an explicit manual count');
  assert.deepEqual(reloaded.body.day_edit.retained_candidate_ids, remaining.map(stop => stop.id));
  assert.ok(reloaded.body.excluded_candidate_ids.includes('museum'));
  await h.clock.advance(500);
  assert.equal(routeCalls(h).length, 1, 'adopting a saved edit does not replay an extra action');
  assert.doesNotMatch(h.container.querySelector('section[aria-label="The route"]').textContent, /Fixture Museum/);
});

test('a refused replacement keeps the published day and offers undo without saving a fake success', async t => {
  const h = await completed(t);
  const before = h.readStorage(LAST);
  await expandMuseum(h); await click(h, 'Replace'); await h.clock.advance(400);
  const request = routeCalls(h).at(-1);
  const failure = { days: [], agnostic_route_output_experiment: { promotion: { promote: false },
    day_edit: dayPolicy.dayEditOutcome(request.body.day_edit, [], 'no_safe_replacement') } };
  await h.fetchMock.respond(request, failure);
  const route = h.container.querySelector('section[aria-label="The route"]');
  assert.ok(Boolean(route), 'an unsuccessful shuffle must not destroy the already published day');
  assert.match(route.textContent, /Fixture Museum/);
  assert.equal(h.readStorage(LAST).id, before.id);
  assert.match(h.text(), /No similar stop could be confirmed/);
  await click(h, 'Undo');
  await h.clock.advance(500);
  assert.equal(routeCalls(h).length, 2, 'undoing an unfulfilled action cannot launch an unrelated day');
  assert.equal(new URL(h.window.location.href).searchParams.has('edit'), false);
});

test('a server refusal to preserve Live Keep leaves the previous day and stored intent intact', async t => {
  const h = await completed(t);
  const before = h.readStorage(LAST);
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const request = routeCalls(h).at(-1);
  await h.fetchMock.respond(request, { days: [], agnostic_route_output_experiment: {
    promotion: { promote: false }, day_edit: dayPolicy.dayEditOutcome(request.body.day_edit, [], 'live_keep_not_preserved'),
  } });
  assert.equal(h.readStorage(LAST).id, before.id);
  assert.equal(h.readStorage(LAST).inputs.dayEdit, undefined);
  assert.match(h.container.querySelector('section[aria-label="The route"]').textContent, /Fixture Museum/);
  assert.match(h.text(), /The change could not be confirmed/);
  assert.doesNotMatch(h.text(), /Removed/);
  await click(h, 'Undo'); await h.clock.advance(500);
  assert.equal(h.readStorage(LAST).id, before.id);
  assert.equal(new URL(h.window.location.href).searchParams.has('edit'), false);
  assert.equal(routeCalls(h).length, 2);
});

test('removing the final stop remembers intentional emptiness and Undo restores the one-stop answer', async t => {
  const h = await completed(t, { publishedStops: [initialStops[0]] });
  const previous = h.readStorage(LAST);
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const request = routeCalls(h).at(-1);
  assert.equal(request.body.day_edit.target_stop_count, 0);
  const empty = { days: [{ date: DATE, primary_route: null, alternatives: [], manual_empty_day: true }],
    agnostic_route_output_experiment: { promotion: { promote: false }, manual_edit_published: true,
      day_edit: dayPolicy.dayEditOutcome(request.body.day_edit, []) } };
  await h.fetchMock.respond(request, empty);
  assert.match(h.text(), /Your day is empty/);
  assert.doesNotMatch(h.text(), /couldn't compose/);
  assert.ok(!h.container.querySelector('a[href*="/maps/dir/"]'), 'an empty choice has no fabricated route handoff');
  assert.equal(h.readStorage(LAST).inputs.dayEdit?.target_stop_count, 0);
  assert.equal(h.readStorage(LAST).classification.status, 'edited_empty');
  await click(h, 'Undo');
  assert.equal(h.readStorage(LAST).id, previous.id);
  assert.match(h.container.querySelector('section[aria-label="The route"]').textContent, /Fixture Museum/);
  await h.clock.advance(500);
  assert.equal(routeCalls(h).length, 2);
});

test('a later preference adjustment keeps the shorter cap but releases old venue retention', async t => {
  const h = await completed(t);
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const removal = routeCalls(h).at(-1), remaining = initialStops.filter(stop => stop.id !== 'museum');
  await h.fetchMock.respond(removal, response(remaining, dayPolicy.dayEditOutcome(removal.body.day_edit, remaining)));
  await click(h, 'Adjust'); await click(h, 'Second hand'); await h.clock.advance(400);
  const adjusted = routeCalls(h).at(-1);
  await h.fetchMock.respond(adjusted, response(remaining, dayPolicy.dayEditOutcome(adjusted.body.day_edit, remaining)));
  assert.equal(adjusted.body.day_edit.target_stop_count, 4);
  assert.equal(adjusted.body.day_edit.preserve_retained, false, 'new interests can change content without undoing manual shortening');
  assert.ok(adjusted.body.excluded_candidate_ids.includes('museum'));
  assert.deepEqual(adjusted.body.preference_priority, ['second_hand'], 'a picked interest ranks in pick order; untouched defaults stay unranked');
});

test('Add after removal can pin a new place without freezing the old retained set or refilling the slot', async t => {
  const h = await completed(t);
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const removal = routeCalls(h).at(-1), remaining = initialStops.slice(1);
  const outsider = { ...initialStops[2], id: 'outside', label: 'Outside Gallery', lat: 59.338, lng: 18.07 };
  const removed = response(remaining, dayPolicy.dayEditOutcome(removal.body.day_edit, remaining));
  removed.place_structure = { provenance: 'agnostic_anchor', area_count: 1, district_day: {
    areas: [{ center: { lat: outsider.lat, lng: outsider.lng }, stops: [outsider],
      stop_names: [outsider.label], stop_ids: [outsider.id], covers: ['museums'], size: 1 }],
    legs: [], covered_intents: [], missing_intents: [] } };
  await h.fetchMock.respond(removal, removed);
  const beforeAdd = h.readStorage(LAST);
  const detours = [...h.container.querySelectorAll('button')].find(item => /detour idea.*near your route/.test(item.textContent));
  assert.ok(Boolean(detours), 'a real eligible outside candidate is offered');
  await h.act(() => detours.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  await click(h, 'Outside Gallery'); await click(h, 'Add to my day'); await h.clock.advance(400);
  const added = routeCalls(h).at(-1);
  assert.deepEqual(added.body.pinned_candidate_ids, ['outside']);
  assert.equal(added.body.day_edit.target_stop_count, 4, 'a new commitment does not silently reset the chosen extent');
  assert.equal(added.body.day_edit.preserve_retained, false,
    'the prior transaction cannot forbid the explicitly requested new pin');
  assert.ok(added.body.excluded_candidate_ids.includes('museum'));
  const nextStops = [...remaining.slice(0, 3), outsider];
  await h.fetchMock.respond(added, response(nextStops, dayPolicy.dayEditOutcome(added.body.day_edit, nextStops)));
  assert.ok(h.readStorage(LAST).safeResponse.days[0].primary_route.main_stops.some(stop => stop.id === 'outside'));
  assert.equal(h.readStorage(LAST).inputs.dayEdit.target_stop_count, 4);
  await click(h, 'Undo'); await h.clock.advance(500);
  assert.equal(h.readStorage(LAST).id, beforeAdd.id);
  assert.equal(routeCalls(h).length, 3, 'Undo restores the pre-Add shorter day without a new request');
});

test('a saved snapshot restores priority and manual count together before an explicit rebuild', async t => {
  let h = await completed(t, { teardown: false, url: `${PLANNER_URL}&prefs=food,culture,views&prio=culture,food,views` });
  t.after(() => h?.unmount());
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const request = routeCalls(h).at(-1), remaining = initialStops.filter(stop => stop.id !== 'museum');
  await h.fetchMock.respond(request, response(remaining, dayPolicy.dayEditOutcome(request.body.day_edit, remaining)));
  const saved = h.readStorage(LAST);
  assert.deepEqual(saved.inputs.preferencePriority, ['culture', 'food', 'views'], 'precondition: the source snapshot has an explicit priority');
  await h.unmount(); h = null;
  h = await mountPlanner({ url: 'http://localhost/anywhere?restore=last&lang=en', storage: { [LAST]: saved } });
  assert.equal(routeCalls(h).length, 0, 'a snapshot restore is not permission to fetch another day');
  await click(h, 'Adjust');
  assert.equal(h.container.querySelector('[data-preference-key="culture"]').getAttribute('aria-label'), 'Priority 1: Culture');
  await click(h, 'rebuild for fresh events');
  const rebuild = routeCalls(h).at(-1);
  await h.fetchMock.respond(rebuild, response(remaining, rebuild.body.day_edit ? dayPolicy.dayEditOutcome(rebuild.body.day_edit, remaining) : null));
  assert.deepEqual(rebuild.body.preference_priority, ['culture', 'food', 'views']);
  assert.equal(rebuild.body.day_edit?.target_stop_count, 4);
});

test('an empty day has an explicit start-over action that can itself be undone', async t => {
  const h = await completed(t, { publishedStops: [initialStops[0]] });
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const removal = routeCalls(h).at(-1);
  await h.fetchMock.respond(removal, { days: [{ date: DATE, primary_route: null, alternatives: [], manual_empty_day: true }],
    agnostic_route_output_experiment: { promotion: { promote: false }, manual_edit_published: true,
      day_edit: dayPolicy.dayEditOutcome(removal.body.day_edit, []) } });
  const emptyId = h.readStorage(LAST).id;
  await click(h, 'Start over'); await h.clock.advance(400);
  const reset = routeCalls(h).at(-1);
  await h.fetchMock.respond(reset, response());
  assert.equal(reset.body.day_edit, undefined);
  assert.equal(reset.body.excluded_candidate_ids, undefined);
  assert.equal(h.readStorage(LAST).inputs.dayEdit, undefined);
  await click(h, 'Undo');
  assert.match(h.text(), /Your day is empty/);
  assert.equal(h.readStorage(LAST).id, emptyId);
  await h.clock.advance(500);
  assert.equal(routeCalls(h).length, 3);
});

// Ranking is the pick order: tapping a chip off and on moves it last in the order.
async function repick(h, key) {
  const chip = () => h.container.querySelector(`[data-preference-key="${key}"] button[aria-pressed]`);
  assert.ok(Boolean(chip()), `interest chip for ${key} exists`);
  for (let tap = 0; tap < 2; tap += 1) await h.act(() => chip().dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  assert.equal(chip().getAttribute('aria-pressed'), 'true');
}

test('a late primary body for the former priority cannot overwrite a newer priority intent', async t => {
  const h = await completed(t);
  const original = h.readStorage(LAST);
  await click(h, 'Adjust'); await repick(h, 'culture'); await h.clock.advance(400);
  const obsolete = routeCalls(h).at(-1);
  assert.deepEqual(obsolete.body.preference_priority, ['culture']);
  await h.fetchMock.respond(obsolete, response(), 200, { deferBody: true });
  await repick(h, 'food');
  assert.equal(obsolete.aborted, true, 'the click invalidates the former priority before its debounce');
  await h.fetchMock.releaseBody(obsolete);
  assert.equal(h.readStorage(LAST).id, original.id);
  await h.clock.advance(400);
  const latest = routeCalls(h).at(-1);
  assert.deepEqual(latest.body.preference_priority, ['culture', 'food']);
  await h.fetchMock.respond(latest, response());
  assert.deepEqual(h.readStorage(LAST).inputs.preferencePriority, ['culture', 'food']);
  assert.equal(routeCalls(h).length, 3);
});

for (const action of ['Remove', 'Replace']) test(`a late ${action} primary body cannot install after a date change`, async t => {
  const h = await completed(t);
  const original = h.readStorage(LAST);
  await expandMuseum(h); await click(h, action); await h.clock.advance(400);
  const obsolete = routeCalls(h).at(-1);
  const editedStops = action === 'Remove' ? initialStops.slice(1)
    : [{ ...initialStops[0], id: 'alternative', label: 'Obsolete replacement' }, ...initialStops.slice(1)];
  await h.fetchMock.respond(obsolete, response(editedStops, dayPolicy.dayEditOutcome(obsolete.body.day_edit, editedStops)), 200, { deferBody: true });
  await click(h, 'Adjust'); await click(h, 'Tomorrow');
  assert.equal(obsolete.aborted, true);
  await h.fetchMock.releaseBody(obsolete);
  assert.equal(h.readStorage(LAST).id, original.id, 'a body for the old date must not be persisted');
  assert.doesNotMatch(h.text(), /Obsolete replacement/);
  await h.clock.advance(400);
  const latest = routeCalls(h).at(-1);
  assert.deepEqual(latest.body.dates, ['2026-10-17']);
  assert.equal(latest.body.day_edit, undefined);
  const next = response(); next.days[0].date = '2026-10-17';
  await h.fetchMock.respond(latest, next);
  assert.equal(h.readStorage(LAST).dateIso, '2026-10-17');
  assert.equal(h.readStorage(LAST).inputs.dayEdit, undefined);
  assert.doesNotMatch(h.text(), /Obsolete replacement/);
});

const pendingLive = body => ({ ...body,
  live_events: { ...body.live_events, pending: true },
  live_completion: { version: 1, token: 'c'.repeat(48), expires_in_ms: 120000 },
});
const completionReads = h => h.fetchMock.calls.filter(call => call.url === '/api/planner-live-completion');
const staleCompletion = () => ({ live_events: {
  pending: false, coverage: 'covered', selected_date: DATE,
  tonight: [{ id: 'stale-completion', title: 'Obsolete completion event' }], this_week: [],
}, live_completion: { version: 1, state: 'ready', route_upgrade: 'not_supported' } });

for (const change of ['Remove', 'Replace', 'priority', 'Tomorrow']) test(`${change} rejects a late Live completion body for the former intent`, async t => {
  const h = await completed(t, { publishedResponse: pendingLive(response()) });
  const original = h.readStorage(LAST);
  await h.clock.advance(2000);
  const read = completionReads(h)[0];
  assert.ok(Boolean(read), 'precondition: the published day follows its actual completion capability');
  await h.fetchMock.respond(read, staleCompletion(), 200, { deferBody: true });
  if (change === 'Remove' || change === 'Replace') { await expandMuseum(h); await click(h, change); }
  else { await click(h, 'Adjust'); if (change === 'priority') await repick(h, 'culture'); else await click(h, change); }
  assert.equal(read.aborted, true, 'the new intent cancels completion before its compose debounce');
  await h.fetchMock.releaseBody(read);
  assert.equal(h.readStorage(LAST).id, original.id);
  assert.equal(JSON.stringify(h.readStorage(LAST)).includes('Obsolete completion event'), false);
  assert.doesNotMatch(h.text(), /Obsolete completion event/);
  await h.clock.advance(400);
  assert.equal(routeCalls(h).length, 2, 'only the explicit new intent composes');
  assert.equal(completionReads(h).length, 1);
});

test('Undo rejects a late completion from the removed day without recomposing', async t => {
  const h = await completed(t);
  const original = h.readStorage(LAST);
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const removal = routeCalls(h).at(-1), remaining = initialStops.slice(1);
  await h.fetchMock.respond(removal, pendingLive(response(remaining, dayPolicy.dayEditOutcome(removal.body.day_edit, remaining))));
  await h.clock.advance(2000);
  const read = completionReads(h)[0];
  assert.ok(Boolean(read));
  await h.fetchMock.respond(read, staleCompletion(), 200, { deferBody: true });
  await click(h, 'Undo');
  assert.equal(read.aborted, true);
  await h.fetchMock.releaseBody(read);
  await h.clock.advance(500);
  assert.equal(h.readStorage(LAST).id, original.id);
  assert.equal(h.readStorage(LAST).inputs.dayEdit, undefined);
  assert.match(h.container.querySelector('section[aria-label="The route"]').textContent, /Fixture Museum/);
  assert.equal(JSON.stringify(h.readStorage(LAST)).includes('Obsolete completion event'), false);
  assert.doesNotMatch(h.text(), /Obsolete completion event/);
  assert.equal(routeCalls(h).length, 2, 'Undo restores the actual prior answer rather than composing again');
});

test('Looking for more places after date-change Undo retains the restored frozen date and one-stop cap', async t => {
  const withPendingSource = (stops, edit = null) => {
    const body = response(stops, edit);
    body.agnostic_route_output_experiment.source_status.collection = {
      source_completion: { status: 'partial', reason: 'bounded_lifecycle_snapshot', pending: 1, completed: 1, failed: 0 },
    };
    return body;
  };
  const priority = ['views', 'food', 'culture'];
  const h = await completed(t, { url: `${PLANNER_URL}&prefs=food,culture,views&prio=views,food,culture`,
    publishedResponse: withPendingSource(initialStops.slice(0, 2)) });
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const removal = routeCalls(h).at(-1), remaining = [initialStops[1]];
  assert.equal(removal.body.day_edit.target_stop_count, 1);
  await h.fetchMock.respond(removal, withPendingSource(remaining, dayPolicy.dayEditOutcome(removal.body.day_edit, remaining)));
  const previous = h.readStorage(LAST);
  await click(h, 'Adjust'); await click(h, 'Tomorrow'); await h.clock.advance(400);
  const tomorrow = routeCalls(h).at(-1), next = response(); next.days[0].date = '2026-10-17';
  assert.deepEqual(tomorrow.body.dates, ['2026-10-17']);
  assert.equal(tomorrow.body.day_edit, undefined);
  await h.fetchMock.respond(tomorrow, next);
  await click(h, 'Undo'); await h.clock.advance(500);
  assert.equal(routeCalls(h).length, 3, 'Undo itself emits no request');
  assert.deepEqual(h.readStorage(LAST), previous);
  await click(h, 'Look for more places');
  const retry = routeCalls(h).at(-1);
  assert.equal(routeCalls(h).length, 4);
  assert.deepEqual(retry.body.dates, [DATE], 'retry answers the restored day, not the undone request');
  assert.deepEqual(retry.body.day_edit, previous.inputs.dayEdit);
  assert.deepEqual(retry.body.preference_priority, priority);
});

test('a seven-stop replacement explains its unsupported bound without changing the day or getting stuck', async t => {
  const event = { id: 'live-event-boundary', event_id: 'boundary', label: 'Boundary occurrence',
    is_live_event: true, lat: 59.338, lng: 18.07, type: null };
  const sixStable = [...initialStops, { ...initialStops[0], id: 'sixth', label: 'Sixth museum' }];
  const h = await completed(t, { publishedStops: [...sixStable, event] });
  const before = h.readStorage(LAST), url = h.window.location.href;
  await expandMuseum(h); await click(h, 'Replace'); await h.clock.advance(500);
  assert.equal(routeCalls(h).length, 1, 'the existing schema is not expanded or truncated to force a request');
  assert.deepEqual(h.readStorage(LAST), before);
  assert.equal(h.window.location.href, url);
  assert.match(h.text(), /This change is not supported for this day/);
  assert.equal(button(h, 'Replace').disabled, false, 'no unsupported click enters a fake pending operation');
  assert.equal(button(h, 'Remove').disabled, false);
});

for (const position of [false, true]) for (const action of ['Remove', 'Replace']) test(`${action} on a restored ${position ? 'position' : 'typed'} snapshot explains rebuilding before entering pending`, async t => {
  let h = await completed(t, { teardown: false, publishedStops: initialStops.slice(0, 2), ...(position ? {
    url: 'http://localhost/anywhere?anchor=near&lang=en',
    sessionStorage: { 'parranda:anchor:coords': { lat: 59.3326, lng: 18.0649 } },
  } : {}) });
  t.after(() => h?.unmount());
  const saved = h.readStorage(LAST);
  await h.unmount(); h = null;
  h = await mountPlanner({ url: 'http://localhost/anywhere?restore=last&lang=en', storage: { [LAST]: saved } });
  let geoCalls = 0;
  Object.defineProperty(h.window.navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition() { geoCalls++; },
  } });
  assert.equal(routeCalls(h).length, 0);
  await expandMuseum(h); await click(h, action); await h.clock.advance(500);
  assert.match(h.text(), /Rebuild this saved day/);
  assert.equal(routeCalls(h).length, 0, 'a snapshot click is not an automatic rebuild');
  assert.equal(geoCalls, 0, 'saved route coordinates cannot replace explicit GPS consent');
  assert.deepEqual(h.readStorage(LAST), saved);
  assert.equal(button(h, 'Replace').disabled, false);
  assert.equal(button(h, 'Remove').disabled, false, 'no request means no permanent pending lock');
});

for (const error of ['busy', 'rate_limited']) for (const action of ['Remove', 'Replace']) test(`${error} during ${action} retains the published answer and Undo without claiming success`, async t => {
  const h = await completed(t, { publishedStops: initialStops.slice(0, 3) });
  const before = h.readStorage(LAST);
  await expandMuseum(h); await click(h, action); await h.clock.advance(400);
  assert.equal(routeCalls(h).length, 2);
  await h.fetchMock.respond(routeCalls(h).at(-1), { error, retry_after_seconds: 3 }, 429);
  assert.deepEqual(h.readStorage(LAST), before);
  assert.ok(Boolean(h.container.querySelector('section[aria-label="The route"]')), 'a failed manual attempt does not erase the old answer');
  assert.match(h.text(), error === 'busy' ? /Parranda is busy right now/ : /pause new requests briefly/);
  assert.match(h.text(), /showing your previous day/);
  assert.doesNotMatch(h.text(), /Removed|Replaced/);
  assert.ok(Boolean(button(h, 'Undo')));
  await click(h, 'Undo'); await h.clock.advance(500);
  assert.deepEqual(h.readStorage(LAST), before);
  assert.equal(new URL(h.window.location.href).searchParams.has('edit'), false);
  assert.equal(routeCalls(h).length, 2, 'Undo after capacity refusal does not recompose');
});

test('explicit retry of a capacity-refused manual edit keeps its frozen day across midnight and still offers Undo', async t => {
  const h = await completed(t, { publishedStops: initialStops.slice(0, 3) });
  const before = h.readStorage(LAST);
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const attempt = routeCalls(h).at(-1);
  await h.fetchMock.respond(attempt, { error: 'busy', retry_after_seconds: 3 }, 429);
  t.mock.timers.setTime(new Date('2026-10-17T01:00:00Z').getTime());
  await h.clock.advance(3500);
  assert.equal(routeCalls(h).length, 2, 'no automatic retry consumes capacity');
  await click(h, 'Try updating again');
  const retry = routeCalls(h).at(-1);
  assert.deepEqual(retry.body.dates, [DATE]);
  assert.deepEqual(retry.body.day_edit, attempt.body.day_edit);
  const remaining = initialStops.slice(1, 3);
  await h.fetchMock.respond(retry, response(remaining, dayPolicy.dayEditOutcome(retry.body.day_edit, remaining)));
  assert.equal(h.readStorage(LAST).inputs.dayEdit.target_stop_count, 2);
  assert.doesNotMatch(h.text(), /The change could not be confirmed/, 'successful retry must not keep the old failure verdict');
  await click(h, 'Undo'); await h.clock.advance(500);
  assert.deepEqual(h.readStorage(LAST), before);
  assert.equal(routeCalls(h).length, 3);
});

test('an ordinary non-edit capacity refusal keeps its existing no-day policy', async t => {
  const h = await completed(t);
  const before = h.readStorage(LAST);
  await click(h, 'Adjust'); await click(h, 'Relaxed'); await h.clock.advance(400);
  const request = routeCalls(h).at(-1);
  assert.equal(request.body.day_edit, undefined);
  await h.fetchMock.respond(request, { error: 'busy', retry_after_seconds: 3 }, 429);
  assert.ok(!h.container.querySelector('section[aria-label="The route"]'), 'general service-refusal policy is not rewritten');
  assert.match(h.text(), /Parranda is busy right now/);
  assert.deepEqual(h.readStorage(LAST), before);
});

test('an explicit rhythm change releases the old stop count while preserving removed identities', async t => {
  const h = await completed(t, { url: PLANNER_URL.replace('rhythm=full', 'rhythm=balanced') });
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const removal = routeCalls(h).at(-1), remaining = initialStops.slice(1);
  await h.fetchMock.respond(removal, response(remaining, dayPolicy.dayEditOutcome(removal.body.day_edit, remaining)));
  await click(h, 'Adjust'); await click(h, 'Relaxed'); await h.clock.advance(400);
  const relaxed = routeCalls(h).at(-1);
  assert.equal(relaxed.body.day_rhythm, 'calm');
  assert.equal(relaxed.body.day_edit, undefined, 'a new extent must not carry the preceding four-stop command');
  assert.ok(relaxed.body.excluded_candidate_ids.includes('museum'), 'the removed place must not return');
  await h.fetchMock.respond(relaxed, response(remaining));
  await click(h, 'Full'); await h.clock.advance(400);
  const full = routeCalls(h).at(-1);
  assert.equal(full.body.day_rhythm, 'full');
  assert.equal(full.body.day_edit, undefined);
  assert.ok(full.body.excluded_candidate_ids.includes('museum'));
  const expanded = [...remaining, { ...initialStops[0], id: 'another-museum', label: 'Another Museum' },
    { ...initialStops[2], id: 'another-gallery', label: 'Another Gallery' }];
  await h.fetchMock.respond(full, response(expanded));
  assert.equal(h.readStorage(LAST).safeResponse.days[0].primary_route.main_stops.length, 6);
  assert.equal(h.readStorage(LAST).inputs.dayEdit, undefined);
  assert.equal(new URL(h.window.location.href).searchParams.has('edit'), false);
  assert.equal(h.readStorage(LAST).commitments.entries.museum.kind, 'exclude');
});

test('rhythm expansion preserves a pin and Undo restores the exact shorter day without composing', async t => {
  const h = await completed(t, { url: PLANNER_URL.replace('rhythm=full', 'rhythm=balanced') });
  const lunch = [...h.container.querySelectorAll('button[aria-controls]')].find(b => b.textContent.includes('Fixture Lunch'));
  await h.act(() => lunch.click()); await click(h, 'Keep this one'); await h.clock.advance(400);
  await h.fetchMock.respond(routeCalls(h).at(-1), response());
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const removal = routeCalls(h).at(-1), remaining = initialStops.slice(1);
  await h.fetchMock.respond(removal, response(remaining, dayPolicy.dayEditOutcome(removal.body.day_edit, remaining)));
  const before = h.readStorage(LAST);
  await click(h, 'Adjust'); await click(h, 'Full'); await h.clock.advance(400);
  const full = routeCalls(h).at(-1);
  assert.equal(full.body.day_edit, undefined);
  assert.deepEqual(full.body.pinned_candidate_ids, ['lunch']);
  assert.ok(full.body.excluded_candidate_ids.includes('museum'));
  await h.fetchMock.respond(full, response([...remaining, { ...initialStops[0], id: 'other', label: 'Other Museum' }]));
  const count = routeCalls(h).length;
  await click(h, 'Undo'); await h.clock.advance(500);
  assert.deepEqual(h.readStorage(LAST), before);
  assert.equal(routeCalls(h).length, count, 'Undo reinstalls the accepted answer, not another request');
  assert.equal(h.readStorage(LAST).inputs.dayEdit.target_stop_count, 4);
});

test('a late removal cannot restore its old extent after an explicit rhythm change', async t => {
  const h = await completed(t, { url: PLANNER_URL.replace('rhythm=full', 'rhythm=balanced') });
  await expandMuseum(h); await click(h, 'Remove'); await h.clock.advance(400);
  const removal = routeCalls(h).at(-1), remaining = initialStops.slice(1);
  await h.fetchMock.respond(removal, response(remaining, dayPolicy.dayEditOutcome(removal.body.day_edit, remaining)), 200, { deferBody: true });
  await click(h, 'Adjust'); await click(h, 'Full'); await h.clock.advance(400);
  const full = routeCalls(h).at(-1);
  assert.equal(removal.aborted, true);
  assert.equal(full.body.day_edit, undefined);
  assert.ok(full.body.excluded_candidate_ids.includes('museum'));
  await h.fetchMock.respond(full, response([...remaining, { ...initialStops[0], id: 'other', label: 'Other Museum' }]));
  const accepted = h.readStorage(LAST);
  await h.fetchMock.releaseBody(removal); await h.clock.advance(500);
  assert.deepEqual(h.readStorage(LAST), accepted);
  const gallery = [...h.container.querySelectorAll('button[aria-controls]')].find(b => b.textContent.includes('Fixture Gallery'));
  await h.act(() => gallery.click()); await click(h, 'Remove'); await h.clock.advance(400);
  assert.equal(routeCalls(h).length, 4, 'a cancelled edit cannot leave future stop actions locked');
  await h.fetchMock.respond(routeCalls(h).at(-1), { days: [] });
});
