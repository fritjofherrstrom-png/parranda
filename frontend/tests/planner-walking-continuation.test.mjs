import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';
import { LAST_KEY } from '../src/lib/anywhere-storage.mjs';
import { createRequire } from 'node:module';

const { dayEditOutcome } = createRequire(import.meta.url)('../../server/planner/day-composition-policy.js');

// Controlled component evidence; these are authored source-shaped stations,
// not live-provider results, a measured walk or a claim that a visit occurred.
const points = [
  { lat: 50, lng: 10 },
  { lat: 50.001, lng: 10.01 },
  { lat: 50.002, lng: 10.02 },
  { lat: 50.003, lng: 10.03 },
];
function day(date) {
  const stops = points.map((point, index) => ({
    ...point, id: `published-${index}`, label: `Published stop ${index + 1}`, type: 'museum',
  }));
  return {
    days: [{ date, experimental_agnostic_route_applied: true, primary_route: {
      id: '__agnostic_compose__', title: 'Published day', estimated_km: 3,
      main_stops: stops, legs: [], map_path_points: [],
      map_route_points: stops.map((stop, index) => ({ ...stop, role: index ? 'stop' : 'first-stop' })),
    }, alternatives: [] }],
    agnostic_route_output_experiment: { promotion: { promote: true } },
  };
}
const button = (h, name) => [...h.container.querySelectorAll('button')]
  .find(control => control.textContent.trim() === name);
async function click(h, name) {
  const control = button(h, name);
  assert.ok(control, name);
  await h.act(() => control.click());
}
async function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 12, 12).getTime() });
  const watches = [];
  const clears = [];
  const geolocation = {
    watchPosition(ok, error) { watches.push({ ok, error }); return watches.length; },
    clearWatch(id) { clears.push(id); },
  };
  const h = await mountPlanner({
    url: 'http://localhost/anywhere?place=Testville&lang=en', geolocation, visibilityState: 'visible',
  });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const first = h.fetchMock.pending()[0];
  await h.fetchMock.respond(first, day(first.body.dates[0]));
  await h.clock.advance(50);
  const fix = async index => h.act(() => watches.at(-1).ok({
    coords: { latitude: points[index].lat, longitude: points[index].lng, accuracy: 10 },
    timestamp: Date.now(),
  }));
  return { h, watches, clears, fix };
}

test('at a middle station the reader can explicitly continue in published order without replanning', async t => {
  const { h, watches, fix } = await setup(t);
  const saved = structuredClone(h.readStorage(LAST_KEY));
  const calls = h.fetchMock.calls.length;
  const originalLinks = [...h.container.querySelectorAll('a[href*="google.com/maps/dir"]')].map(link => link.href);
  assert.equal(watches.length, 0, 'no implicit location request');

  await click(h, 'Follow the day');
  await fix(1);
  assert.match(h.text(), /You're at Published stop 2/);
  const continuation = [...h.container.querySelectorAll('a')]
    .find(link => link.textContent.includes('Continue from here'));
  assert.ok(continuation, 'a middle station offers an explicit walking continuation');
  assert.match(continuation.textContent, /Maps/, 'the action names its external Maps destination before a tap');
  const url = new URL(continuation.href);
  assert.equal(url.searchParams.get('travelmode'), 'walking');
  assert.equal(url.searchParams.get('origin'), `${points[1].lat},${points[1].lng}`);
  assert.equal(url.searchParams.get('destination'), `${points[3].lat},${points[3].lng}`);
  assert.equal(url.searchParams.get('waypoints'), `${points[2].lat},${points[2].lng}`);
  assert.ok(!continuation.href.includes('50%2C10%7C'), 'the earlier station is not reintroduced');
  assert.match(h.text(), /From Published stop 2 onward/);
  assert.deepEqual(h.readStorage(LAST_KEY), saved, 'the accepted saved day stays exact');
  assert.equal(h.fetchMock.calls.length, calls, 'continuation acquires and composes nothing');
  for (const href of originalLinks) {
    assert.ok([...h.container.querySelectorAll('a')].some(link => link.href === href), 'the whole-day handoff remains available unchanged');
  }
});

test('stopping location following removes continuation without changing the accepted day', async t => {
  const { h, fix, clears } = await setup(t);
  const saved = structuredClone(h.readStorage(LAST_KEY));
  const calls = h.fetchMock.calls.length;
  await click(h, 'Follow the day');
  await fix(1);
  assert.ok(h.container.querySelector('[data-walking-continuation]'));
  await click(h, 'Stop following');
  assert.equal(Boolean(h.container.querySelector('[data-walking-continuation]')), false);
  assert.deepEqual(clears, [1]);
  assert.deepEqual(h.readStorage(LAST_KEY), saved);
  assert.equal(h.fetchMock.calls.length, calls);
});

test('an expired fix removes the continuation instead of retaining a stale Maps origin', async t => {
  const { h, fix } = await setup(t);
  await click(h, 'Follow the day');
  await fix(1);
  assert.ok(h.container.querySelector('[data-walking-continuation]'));
  t.mock.timers.tick(60001);
  await h.clock.advance(60001);
  assert.equal(Boolean(h.container.querySelector('[data-walking-continuation]')), false);
  assert.match(h.text(), /position couldn't be found/i);
});

test('a new selected day removes the old-position continuation before the new result arrives', async t => {
  const { h, fix } = await setup(t);
  await click(h, 'Follow the day');
  await fix(1);
  assert.ok(h.container.querySelector('[data-walking-continuation]'));
  await click(h, 'Adjust');
  await click(h, 'Tomorrow');
  assert.equal(Boolean(h.container.querySelector('[data-walking-continuation]')), false);
  await h.clock.advance(500);
  const compose = h.fetchMock.pending().find(call => call.url.includes('/api/route-recommendations'));
  assert.ok(compose, 'tomorrow is actually requested');
  await h.fetchMock.respond(compose, day(compose.body.dates[0]));
  assert.equal(Boolean(h.container.querySelector('[data-walking-continuation]')), false);
});

test('a retained stale day after a failed rhythm request cannot regain continuation', async t => {
  const { h, fix } = await setup(t);
  const saved = structuredClone(h.readStorage(LAST_KEY));
  await click(h, 'Follow the day');
  await fix(1);
  assert.ok(h.container.querySelector('[data-walking-continuation]'));
  await click(h, 'Adjust');
  const full = [...h.container.querySelectorAll('button')].find(control => /^Full/.test(control.textContent.trim()));
  assert.ok(full, 'the real Full rhythm control exists');
  await h.act(() => full.click());
  await h.clock.advance(500);
  const request = h.fetchMock.pending().find(call => call.url.includes('/api/route-recommendations'));
  assert.equal(request.body.day_rhythm, 'full');
  await h.fetchMock.respond(request, { error: 'controlled_unavailable' }, 503);
  await fix(1);
  assert.match(h.text(), /Published stop 2/, 'the old accepted day is still visible');
  assert.equal(Boolean(h.container.querySelector('[data-walking-continuation]')), false,
    'retained stale error state must not authorize a fresh-position continuation');
  assert.deepEqual(h.readStorage(LAST_KEY), saved);
});

test('a retained stale day after a refused replacement cannot regain continuation', async t => {
  const { h, fix } = await setup(t);
  const saved = structuredClone(h.readStorage(LAST_KEY));
  await click(h, 'Follow the day');
  await fix(1);
  const row = [...h.container.querySelectorAll('button[aria-expanded]')]
    .find(control => control.textContent.includes('Published stop 1'));
  assert.ok(row, 'the real station disclosure exists');
  await h.act(() => row.click());
  await click(h, 'Replace');
  await h.clock.advance(500);
  const request = h.fetchMock.pending().find(call => call.url.includes('/api/route-recommendations'));
  assert.equal(request.body.day_edit.action, 'replace');
  const response = day(request.body.dates[0]);
  // Use the real server outcome producer, with its actual refusal reason.
  response.agnostic_route_output_experiment.day_edit = dayEditOutcome(
    request.body.day_edit, response.days[0].primary_route.main_stops, 'no_safe_replacement',
  );
  assert.equal(response.agnostic_route_output_experiment.day_edit.status, 'refused');
  await h.fetchMock.respond(request, response);
  await fix(1);
  assert.match(h.text(), /Published stop 1/, 'the rejected edit leaves the prior day visible');
  assert.equal(Boolean(h.container.querySelector('[data-walking-continuation]')), false,
    'retained stale done state must not authorize a fresh-position continuation');
  assert.deepEqual(h.readStorage(LAST_KEY), saved);
});

test('two fresh fixes in one watch update the continuation without composing', async t => {
  const { h, fix, watches } = await setup(t);
  await click(h, 'Follow the day');
  await fix(1);
  assert.ok(h.container.querySelector('[data-walking-continuation]'));
  const calls = h.fetchMock.calls.length;
  await fix(2);
  const link = h.container.querySelector('[data-walking-continuation] a');
  assert.ok(link);
  const url = new URL(link.href);
  assert.equal(url.searchParams.get('origin'), `${points[2].lat},${points[2].lng}`);
  assert.equal(url.searchParams.get('destination'), `${points[3].lat},${points[3].lng}`);
  assert.equal(url.searchParams.get('waypoints'), null);
  assert.equal(watches.length, 1);
  assert.equal(h.fetchMock.calls.length, calls);
});
