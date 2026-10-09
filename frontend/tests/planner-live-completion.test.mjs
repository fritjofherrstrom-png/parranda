import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';
import { LAST_KEY } from '../src/lib/anywhere-storage.mjs';
import { readFileSync } from 'node:fs';

// Mounted Planner + real React with controlled transport and clock. Fixture
// evidence for the client side of the Live completion contract; the endpoint
// shapes follow the backend handoff and are not live-provider acceptance.
const TOKEN = 'opaque-live-token-1';
// The completion and upgrade answers are the backend's own (#584 81d2ad7,
// real endpoint/store/engine with injected collector transport).
const wire = JSON.parse(readFileSync(new URL('./fixtures/live-wire-81d2ad7.json', import.meta.url), 'utf8')).fixtures;
const wireBody = (name, edit = (body) => body) => edit(structuredClone(wire[name].body));
const COUNTS = ['selected_source_count', 'responding_source_count', 'event_bearing_source_count', 'empty_source_count',
  'failed_source_count', 'unavailable_source_count', 'raw_event_count', 'normalized_event_count',
  'accepted_event_count', 'surfaced_event_count', 'rejected_event_count'];
const health = (extra) => ({ ...Object.fromEntries(COUNTS.map((k) => [k, 0])), selected_source_count: 1, ...extra });
const pendingLive = () => ({ coverage: 'covered', pending: true, tonight: [], this_week: [],
  acquisition: { source_health: health({ status: 'pending', result: 'pending', reasons: [] }) } });
const stops = [{ id: 'a', label: 'Museum', lat: 60.17, lng: 24.94 }, { id: 'b', label: 'Cafe', lat: 60.172, lng: 24.942 }];
const day = (live, { capability, extraStops = [], km = 2 } = {}) => ({
  days: [{ experimental_agnostic_route_applied: true, primary_route: { id: '__agnostic_compose__', title: 'Published day',
    main_stops: [...stops, ...extraStops], estimated_km: km, map_path_points: [], legs: [], confidence: 'low' }, alternatives: [] }],
  live_events: live,
  agnostic_route_output_experiment: { promotion: { promote: true }, intake: { query: 'Testville' },
    source_status: { anchor: { lat: 60.17, lng: 24.94 } } },
  ...(capability ? { live_completion: { version: 1, token: TOKEN, expires_in_ms: 120000, ...capability } } : {}),
});
const routeCalls = (h) => h.fetchMock.calls.filter((c) => c.url.startsWith('/api/route-recommendations'));
const completionCalls = (h) => h.fetchMock.calls.filter((c) => c.url === '/api/planner-live-completion');
const upgradeCalls = (h) => h.fetchMock.calls.filter((c) => c.url === '/api/planner-live-route-upgrade');
const pendingTo = (h, url) => h.fetchMock.pending().find((c) => c.url === url);
const button = (h, re) => [...h.container.querySelectorAll('button')].find((b) => re.test(b.textContent));
const click = async (h, re) => {
  const b = button(h, re);
  assert.ok(b, `${re}: ${h.text()}`);
  await h.act(() => b.dispatchEvent(new h.window.Event('click', { bubbles: true })));
};

async function arrive(t, response) {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const [compose] = routeCalls(h);
  assert.match(compose.url, /include_live_completion=1&include_live_route_upgrade=1/);
  await h.fetchMock.respond(compose, response);
  await h.clock.advance(50);
  return h;
}

test('pending Live is read through the capability; the route is never recomposed and the token never stored', async (t) => {
  const h = await arrive(t, day(pendingLive(), { capability: { route_upgrade: 'not_supported' } }));
  assert.match(h.text(), /Checking the calendars — updates automatically in a moment\./);
  assert.doesNotMatch(JSON.stringify(h.readStorage(LAST_KEY)), new RegExp(TOKEN), 'the bearer token never reaches storage');
  assert.doesNotMatch(h.container.innerHTML, new RegExp(TOKEN));

  await h.clock.advance(2000);
  const first = pendingTo(h, '/api/planner-live-completion');
  assert.ok(first, 'the first completion read leaves after 2 s');
  assert.deepEqual(first.body, { token: TOKEN }, 'exactly {token}');
  await h.fetchMock.respond(first, wireBody('completion_pending'), 202);
  await h.clock.advance(3000);
  const second = pendingTo(h, '/api/planner-live-completion');
  assert.ok(second);
  await h.fetchMock.respond(second, wireBody('completion_ready', (body) => {
    body.live_completion.route_upgrade = 'not_supported';
    return body;
  }));
  await h.clock.advance(50);

  assert.match(h.text(), /Concert/, 'the terminal Live result reaches the Live card');
  assert.doesNotMatch(h.text(), /Checking the calendars/);
  assert.equal(h.readStorage(LAST_KEY).safeResponse.live_events.tonight[0].title, 'Concert', 'the remembered day carries it too');
  assert.doesNotMatch(JSON.stringify(h.readStorage(LAST_KEY)), new RegExp(TOKEN));

  await h.clock.advance(120000);
  assert.equal(routeCalls(h).length, 1, 'no timer-driven route compose because Live was pending');
  assert.equal(completionCalls(h).length, 2);
  assert.equal(upgradeCalls(h).length, 0, 'an unauthorized capability never asks for an upgrade');
});

test('pending Live with no capability says unavailable and does not poll or recompose', async (t) => {
  const h = await arrive(t, day(pendingLive()));
  assert.doesNotMatch(h.text(), /Checking the calendars/, 'nothing is following it, so it is not "still loading"');
  assert.match(h.text(), /couldn't verify events right now|could not be fetched|couldn't fetch/i);
  await h.clock.advance(120000);
  assert.equal(routeCalls(h).length, 1);
  assert.equal(completionCalls(h).length, 0);
});

test('an expired capability ends as unavailable, never as an empty calendar', async (t) => {
  const h = await arrive(t, day(pendingLive(), { capability: {} }));
  await h.clock.advance(2000);
  await h.fetchMock.respond(pendingTo(h, '/api/planner-live-completion'), { error: 'live_completion_expired' }, 410);
  await h.clock.advance(50);
  assert.doesNotMatch(h.text(), /Checking the calendars/);
  assert.doesNotMatch(h.text(), /list no events/);
  assert.match(h.text(), /couldn't verify events right now|could not be fetched|couldn't fetch/i);
  await h.clock.advance(120000);
  assert.equal(routeCalls(h).length, 1);
});

async function toUpgrade(t) {
  const h = await arrive(t, day(pendingLive(), { capability: { route_upgrade: 'explicit_request' } }));
  await h.clock.advance(2000);
  await h.fetchMock.respond(pendingTo(h, '/api/planner-live-completion'), wireBody('completion_ready'));
  await h.clock.advance(50);
  const upgrade = pendingTo(h, '/api/planner-live-route-upgrade');
  assert.ok(upgrade, 'an authorized terminal read asks for the upgrade');
  assert.deepEqual(upgrade.body, { token: TOKEN }, 'no events, dates or geography from the client');
  return { h, upgrade };
}

const applied = () => wireBody('upgrade_applied');

test('an applied upgrade replaces the day visibly, and Undo puts the original back', async (t) => {
  const { h, upgrade } = await toUpgrade(t);
  await h.fetchMock.respond(upgrade, applied());
  await h.clock.advance(50);

  assert.match(h.text(), /Changed: Live: event added/);
  assert.match(h.text(), /Concert/);
  const stored = h.readStorage(LAST_KEY);
  const storedStops = stored.safeResponse.days[0].primary_route.main_stops;
  assert.equal(storedStops.length, 6, 'save and share use the upgraded day');
  assert.equal(storedStops.at(-1).is_live_event, true);
  assert.equal(stored.place, 'Testville', 'the saved identity is the original question, not the event stop');
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(TOKEN));

  await click(h, /^Undo$/);
  assert.doesNotMatch(h.text(), /Changed: Live/);
  assert.equal(h.readStorage(LAST_KEY).safeResponse.days[0].primary_route.main_stops.length, 2);
  await h.clock.advance(120000);
  assert.equal(routeCalls(h).length, 1, 'neither the upgrade nor Undo recomposes');
  assert.equal(upgradeCalls(h).length, 1, 'exactly one upgrade request');
});

test('an upgrade that lands after the user changed the day is dropped', async (t) => {
  const { h, upgrade } = await toUpgrade(t);
  await click(h, /Adjust/);
  await click(h, /^Coffee$|^Fika$/);
  // The adjustment is waiting out its 400 ms debounce when the upgrade lands.
  await h.fetchMock.respond(upgrade, applied());
  await h.clock.advance(50);
  assert.doesNotMatch(h.text(), /Live: event added/);
  assert.equal(h.readStorage(LAST_KEY).safeResponse.days[0].primary_route.main_stops.length, 2);
});

test('a new compose cancels the previous day\'s completion run', async (t) => {
  const h = await arrive(t, day(pendingLive(), { capability: {} }));
  await h.clock.advance(2000);
  const read = pendingTo(h, '/api/planner-live-completion');
  await click(h, /Adjust/);
  await click(h, /^Coffee$|^Fika$/);
  await h.clock.advance(500);
  assert.ok(read.aborted, 'the old capability stops being read once the day it belongs to is being replaced');
  assert.equal(routeCalls(h).length, 2);
});
