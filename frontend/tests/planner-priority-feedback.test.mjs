/** Mounted product UI with controlled API replies/clock; no provider or public-runtime acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';

const DATE = '2026-10-18', NEXT = '2026-10-19';
const LAST = 'parranda:anywhere:last', SAVED = 'parranda:anywhere:saved';
const endpointCalls = h => h.fetchMock.calls.filter(call => call.url.includes('/api/route-recommendations'));
const note = h => [...h.container.querySelectorAll('p')].find(element => /first choice/i.test(element.textContent))?.textContent || '';
const routeText = h => h.container.querySelector('ol[aria-label="The stops, in order"]')?.textContent || '';

function stop(id, type, facts = {}) {
  return { id, label: `Fixture ${id}`, type, lat: 55.6, lng: 13.0, commitment_eligible: true, ...facts };
}
const culture = () => stop('museum', 'museum', { covered_preferences: ['museums'], partial_preferences: [] });
const partialViews = () => stop('park', 'park', { covered_preferences: ['green'], partial_preferences: ['scenic'] });
const exactViews = () => stop('viewpoint', 'viewpoint', { covered_preferences: ['scenic'], partial_preferences: [] });
const vintage = () => stop('vintage', 'vintage-shop', { covered_preferences: ['second_hand'], partial_preferences: [] });

function day(stops, { date = DATE, label = 'Fixture day' } = {}) {
  return {
    days: [{ date, experimental_agnostic_route_applied: true, primary_route: {
      id: '__agnostic_compose__', title: label, main_stops: stops, estimated_km: 1.2,
      legs: [], map_route_points: [], map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })), confidence: 'low',
    }, alternatives: [] }],
    agnostic_route_output_experiment: {
      intake: { status: 'resolved', resolved: { label: 'Fixture Town', lat: 55.6, lng: 13 } },
      promotion: { promote: true, readiness: 'promotable' },
    },
  };
}

async function start(t, { preferences = 'culture,views', priority = 'views,culture', response = day([culture(), partialViews()]) } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${DATE}T10:00:00Z`) });
  const url = `http://localhost/anywhere?place=Fixture%20Town&prefs=${preferences}${priority ? `&prio=${priority}` : ''}&lang=en`;
  const h = await mountPlanner({ url });
  t.after(() => h.unmount());
  assert.equal(endpointCalls(h).length, 1, 'the actual URL-entry planner composes once');
  await h.fetchMock.respond(endpointCalls(h)[0], response);
  return h;
}

async function click(h, label) {
  const button = [...h.container.querySelectorAll('button')].find(element => element.textContent.trim() === label || element.getAttribute('aria-label') === label);
  assert.ok(button, `actual '${label}' control exists`);
  await h.act(() => button.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
}

// Removing the feedback or treating partial as exact must fail these consumer-visible cases.
for (const scenario of [
  { name: 'a missing explicitly ranked interest', preferences: 'culture,second_hand', priority: 'second_hand,culture', stops: [culture()], want: /first choice.*Second hand.*not (?:represented|included|in this day)/i },
  { name: 'a partial explicitly ranked interest', stops: [culture(), partialViews()], want: /first choice.*Views.*part(?:ly|ial)/i },
]) test(`the published day briefly identifies ${scenario.name} without inventing a cause`, async t => {
  const h = await start(t, { ...scenario, response: day(scenario.stops) });
  assert.match(routeText(h), /Fixture museum/, 'the usable route remains visible');
  assert.match(note(h), scenario.want);
  assert.doesNotMatch(note(h), /no (?:nearby|local) places|closed|walking|source(?:s)? (?:failed|unavailable)/i,
    'route coverage alone is not an explanation of absent supply');
});

for (const scenario of [
  { name: 'an exactly covered first interest even when it is not most numerous', preferences: 'culture,second_hand', priority: 'second_hand,culture', stops: [vintage(), culture(), { ...culture(), id: 'museum-2', label: 'Fixture second museum' }] },
  { name: 'a neutral interest set', priority: '', stops: [culture(), partialViews()] },
  { name: 'a route without preference evidence', stops: [stop('unlabelled', 'museum')] },
]) test(`no first-choice shortfall is claimed for ${scenario.name}`, async t => {
  const h = await start(t, { ...scenario, response: day(scenario.stops) });
  assert.ok(routeText(h), 'the real composed route is mounted');
  assert.equal(note(h), '');
});

test('new priority is not judged against the old route during debounce or pending composition', async t => {
  const h = await start(t, { priority: 'culture,views', response: day([culture()]) });
  assert.equal(note(h), '');
  await click(h, 'Adjust');
  const cultureChip = () => h.container.querySelector('[data-preference-key="culture"] button[aria-pressed]');
  await h.act(() => cultureChip().click());
  await h.act(() => cultureChip().click());
  assert.equal(note(h), '', 'the new Views priority cannot describe the old Culture answer before the debounce');
  await h.clock.advance(399);
  assert.equal(note(h), '');
  await h.clock.advance(1);
  const request = endpointCalls(h).at(-1);
  assert.deepEqual(request.body.preference_priority, ['views', 'culture']);
  assert.equal(note(h), '', 'the held route has not answered the new ranking');
  await h.fetchMock.respond(request, day([culture(), partialViews()]));
  assert.match(note(h), /first choice.*Views.*part(?:ly|ial)/i);
});

test('clearing priority removes the note and Undo restores the exact published priority and note without composing', async t => {
  const h = await start(t);
  const previous = h.readStorage(LAST);
  assert.match(note(h), /first choice.*Views.*part(?:ly|ial)/i);
  await click(h, 'Adjust');
  await click(h, 'Clear the order');
  assert.equal(note(h), '', 'the pending neutral intent must not retain a current first-choice claim');
  await h.clock.advance(400);
  await h.fetchMock.respond(endpointCalls(h).at(-1), day([culture()]));
  assert.equal(note(h), '');
  const callsBeforeUndo = endpointCalls(h).length;
  await click(h, 'Undo this change');
  await h.clock.advance(1000);
  assert.deepEqual(h.readStorage(LAST), previous, 'Undo restores the original answer and priority together');
  assert.match(note(h), /first choice.*Views.*part(?:ly|ial)/i);
  assert.equal(endpointCalls(h).length, callsBeforeUndo, 'Undo does not compose again');
});

test('explicit Save and Restore recover feedback from the saved priority rather than the current neutral controls', async t => {
  const h = await start(t);
  await click(h, 'Save');
  const saved = h.readStorage(SAVED)[0];
  assert.deepEqual(saved.inputs.preferencePriority, ['views', 'culture']);
  await click(h, 'Adjust');
  await click(h, 'Clear the order');
  await h.clock.advance(400);
  await h.fetchMock.respond(endpointCalls(h).at(-1), day([culture()]));
  assert.equal(note(h), '');
  const savedSection = [...h.container.querySelectorAll('section')].find(element => element.textContent.trim().startsWith('Saved days'));
  assert.ok(savedSection?.querySelector('li button'), 'the product offers the saved day');
  const callsBeforeRestore = endpointCalls(h).length;
  await h.act(() => savedSection.querySelector('li button').click());
  await h.clock.advance(1000);
  assert.ok(h.container.querySelector('[data-preference-key="views"][aria-label="Priority 1: Views"]'),
    'the saved first priority is restored in the actual controls');
  assert.match(note(h), /first choice.*Views.*part(?:ly|ial)/i);
  assert.equal(endpointCalls(h).length, callsBeforeRestore, 'snapshot restore does not compose again');
});

test('a late previous-date body cannot reinstate its first-choice shortfall after the next day is published', async t => {
  const h = await start(t);
  await click(h, 'Adjust');
  await click(h, 'Full');
  await h.clock.advance(400);
  const old = endpointCalls(h).at(-1);
  await h.fetchMock.respond(old, day([culture(), partialViews()]), 200, { deferBody: true });
  await click(h, 'Tomorrow');
  assert.equal(old.aborted, true);
  assert.equal(note(h), '', 'a previous day cannot provide current first-choice feedback');
  await h.clock.advance(400);
  const latest = endpointCalls(h).at(-1);
  assert.deepEqual(latest.body.dates, [NEXT]);
  await h.fetchMock.respond(latest, day([culture(), exactViews()], { date: NEXT }));
  assert.match(routeText(h), /Fixture viewpoint/);
  assert.equal(note(h), '');
  await h.fetchMock.releaseBody(old);
  assert.match(routeText(h), /Fixture viewpoint/);
  assert.equal(note(h), '');
  assert.equal(h.readStorage(LAST).dateIso, NEXT);
});
