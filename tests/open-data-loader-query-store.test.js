'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { composeOpenDataLoaders, createOpenDataLoader } = require('../server/place-candidates/open-data-loader');

// Staging QA, 14 Nov 2026: 0 of 123 stops came from the map source. Three
// causes were found in this loader. This file covers two of them:
// - A "today" request keys its map answer by the current local minute (the
//   availability window), so a stored answer was never the same key a minute
//   later and every request asked Overpass again.
// - A stored answer that had expired was served only when the refresh failed
//   fast. While the refresh was merely slow, the day was composed without the
//   map family although the place's previous answer was on disk.
// The third (a late answer is deliberately not cached, see
// overpass-gate-lifecycle.test.js) is unchanged here.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const KINDS = [{ amenity: 'restaurant' }, { amenity: 'cafe' }, { tourism: 'museum' }, { leisure: 'park' }, { amenity: 'bar' }];
const elements = (count = 20) => Array.from({ length: count }, (_, i) => ({
  type: 'node', id: i + 1, lat: 41.9 + i * 0.0004, lon: 12.5, tags: { name: `Place ${i}`, ...KINDS[i % KINDS.length] },
}));
const answer = (count = 20) => ({ ok: true, status: 200, json: async () => ({ elements: elements(count) }) });
const failure = (status = 500) => ({ ok: false, status, headers: { get: () => null } });
const PLACE = { lat: 41.9, lng: 12.5, dayRhythm: 'balanced', anchorMode: 'place' };
const today = minute => ({ weekday: 6, startMinute: minute, endMinute: 1440 });

function setup({ respond = () => answer(), staleIfErrorMs = 7 * DAY } = {}) {
  const state = { clock: 1_000_000_000_000, calls: 0, queries: [], respond };
  const cache = createSourceCache({ namespace: 'overpass', now: () => state.clock });
  const loader = createOpenDataLoader({ cache, staleIfErrorMs, now: () => state.clock,
    fetcher: async (...args) => {
      state.calls += 1;
      state.queries.push(decodeURIComponent(String(args[1]?.body || '').replace(/^data=/, '')));
      return state.respond(...args);
    } });
  return { state, cache, loader };
}

test('the same place a minute later reuses the stored map answer instead of asking Overpass again', async () => {
  const { state, loader } = setup();
  const first = await loader({ ...PLACE, availabilityWindow: today(600) });
  assert.match(first.loader_status, /^loaded:/);
  const asked = state.calls;
  const minuteLater = await loader({ ...PLACE, availabilityWindow: today(601) });
  const tomorrow = await loader({ ...PLACE, availabilityWindow: { weekday: 0, startMinute: 0, endMinute: 1440 } });
  assert.equal(state.calls, asked, 'the query text is the same, so its stored answer is the answer');
  for (const result of [minuteLater, tomorrow]) {
    assert.match(result.loader_status, /^loaded:/);
    assert.equal(result.loader_error, null);
    assert.deepEqual(result.map(r => r.id).sort(), first.map(r => r.id).sort());
    assert.equal(result.loader_metadata?.cache ?? null, null, 'a fresh stored answer is not a stale fallback');
  }
});

test('a different question still asks; an interest that leaves the query text unchanged does not', async () => {
  const { state, loader } = setup();
  await loader({ ...PLACE, availabilityWindow: today(600) });
  let asked = state.calls;
  // A broad interest asks the identical first query and only selects
  // differently from its answer. (It may widen: that is another query text.)
  const food = await loader({ ...PLACE, requestedIntents: ['food'], availabilityWindow: today(600) });
  assert.equal(new Set(state.queries).size, state.queries.length, 'no query text is sent to the provider twice');
  assert.ok(food.some(r => r.type === 'restaurant'));
  asked = state.calls;
  // A focused interest adds its own selectors to the query.
  await loader({ ...PLACE, requestedIntents: ['restaurants'], availabilityWindow: today(600) });
  assert.ok(state.calls > asked, 'a focused interest is another query');
  asked = state.calls;
  await loader({ ...PLACE, lat: 48.86, lng: 2.35, availabilityWindow: today(600) });
  assert.ok(state.calls > asked, 'another place is another query');
  asked = state.calls;
  await loader({ ...PLACE, dayRhythm: 'calm', availabilityWindow: today(600) });
  assert.ok(state.calls > asked, 'another aperture is another query');
  assert.equal(new Set(state.queries).size, state.queries.length, 'and still no query text was sent twice');
});

test('two requests asking the same query text at the same moment share one provider call', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { state, loader } = setup({ respond: async () => { await gate; return answer(); } });
  const first = loader({ ...PLACE, availabilityWindow: today(600) });
  const second = loader({ ...PLACE, availabilityWindow: today(601) });
  await new Promise(resolve => setImmediate(resolve));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(new Set(state.queries).size, state.queries.length, 'the identical query was sent once');
  assert.match(a.loader_status, /^loaded:/);
  assert.deepEqual(b.map(r => r.id).sort(), a.map(r => r.id).sort());
});

test('an empty answer is not kept as the place\'s stored answer', async () => {
  const { state, loader } = setup({ respond: () => answer(0) });
  await loader({ ...PLACE, availabilityWindow: today(600) });
  const asked = state.calls;
  await loader({ ...PLACE, availabilityWindow: today(601) });
  assert.ok(state.calls > asked, 'an empty or truncated 200 must not stand in for the place for hours');
});

test('when the refresh fails, the previous answer is kept across minutes and weekdays, labelled and never renewed', async () => {
  const { state, loader } = setup();
  const first = await loader({ ...PLACE, availabilityWindow: today(600) });
  state.clock += 7 * HOUR; // past the 6 h lifetime
  state.respond = () => failure(500);
  const stale = await loader({ ...PLACE, availabilityWindow: today(1020) });
  assert.deepEqual(stale.map(r => r.id).sort(), first.map(r => r.id).sort(), 'the place keeps its map evidence');
  assert.equal(stale.loader_error, 'stale_cache_refresh_failed');
  assert.deepEqual(stale.loader_metadata.cache, { served_stale: true, stale_age_seconds: 3600, refresh_reason: 'http_non_200' });
  // The fallback is not written back as a fresh answer: once the provider
  // answers again it is asked, and the fresh answer replaces the fallback.
  state.clock += 61 * 1000; // past the endpoint's short pause
  state.respond = () => answer();
  const asked = state.calls;
  const recovered = await loader({ ...PLACE, availabilityWindow: today(1021) });
  assert.ok(state.calls > asked, 'a recovered provider is asked');
  assert.equal(recovered.loader_error, null);
  assert.equal(recovered.loader_metadata?.cache ?? null, null);
});

test('the fallback ends with the configured window, and is off when the window is zero', async () => {
  const bounded = setup();
  await bounded.loader({ ...PLACE, availabilityWindow: today(600) });
  bounded.state.clock += 6 * HOUR + 7 * DAY + 1000;
  bounded.state.respond = () => failure(500);
  const expired = await bounded.loader({ ...PLACE, availabilityWindow: today(601) });
  assert.equal(expired.length, 0, 'older than the stale window is not served');
  assert.equal(expired.loader_error, 'http_non_200');

  const off = setup({ staleIfErrorMs: 0 });
  await off.loader({ ...PLACE, availabilityWindow: today(600) });
  off.state.clock += 7 * HOUR;
  off.state.respond = () => failure(500);
  const none = await off.loader({ ...PLACE, availabilityWindow: today(601) });
  assert.equal(none.length, 0);
  assert.equal(none.loader_error, 'http_non_200');
});

test('without a cache nothing is stored and every request asks, as before', async () => {
  let calls = 0;
  const loader = createOpenDataLoader({ fetcher: async () => { calls += 1; return answer(); } });
  await loader({ ...PLACE, availabilityWindow: today(600) });
  const asked = calls;
  await loader({ ...PLACE, availabilityWindow: today(601) });
  assert.ok(calls > asked);
});

// The composed loader: a directory that can carry the day alone, and a map
// primary that is still outstanding at the wait bound.
const directory = anchor => Array.from({ length: 15 }, (_, i) => ({
  id: `directory-${i}`, name: `Visit ${i}`, type: ['museum', 'restaurant', 'park'][i % 3],
  lat: anchor.lat + i * 0.0001, lng: anchor.lng, sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred' }],
}));
const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };

test('while the map refresh is slow, the day keeps the place\'s previous map answer', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000_000_000 });
  const cache = createSourceCache({ namespace: 'overpass' });
  let hang = false;
  const pending = [];
  const osm = createOpenDataLoader({ cache, staleIfErrorMs: 7 * DAY, fetcher: async () => {
    if (!hang) return answer();
    return new Promise(resolve => { pending.push(resolve); });
  } });
  const loader = composeOpenDataLoaders(osm, null, { eager: true, load: anchor => directory(anchor) }, null,
    { primaryWaitMs: 100, silentGraceMs: 10, silentPauseMs: 1000 });

  const first = await loader({ ...PLACE, availabilityWindow: today(600) });
  const mapIds = first.filter(r => r.sources?.[0]?.provider === 'osm').map(r => r.id).sort();
  assert.ok(mapIds.length > 0, 'precondition: the healthy day has map rows');

  t.mock.timers.tick(7 * HOUR); // the stored answer has expired
  hang = true;
  let slow;
  loader({ ...PLACE, availabilityWindow: today(1020) }).then(value => { slow = value; });
  await flush();
  t.mock.timers.tick(100); // the wait bound
  await flush();
  assert.ok(slow, 'the composition answers at its bound');
  assert.deepEqual(slow.filter(r => r.sources?.[0]?.provider === 'osm').map(r => r.id).sort(), mapIds,
    'the previous map answer is kept instead of dropping the family');
  assert.equal(slow.loader_metadata.primary_collection, 'stored_map_answer');
  assert.equal(slow.loader_metadata.primary_collection_reason, 'primary_outstanding_at_wait_bound');
  assert.deepEqual(slow.loader_metadata.cache, { served_stale: true, stale_age_seconds: 3600, refresh_reason: 'refresh_outstanding' });
  assert.ok(slow.some(r => r.sources?.[0]?.provider === 'directory'), 'the directory rescue is still there');
  for (const resolve of pending) resolve(failure(504));
});

test('a place with no stored map answer is rescued by the directory alone, as before', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000_000_000 });
  const cache = createSourceCache({ namespace: 'overpass' });
  const pending = [];
  const osm = createOpenDataLoader({ cache, staleIfErrorMs: 7 * DAY,
    fetcher: async () => new Promise(resolve => { pending.push(resolve); }) });
  const loader = composeOpenDataLoaders(osm, null, { eager: true, load: anchor => directory(anchor) }, null,
    { primaryWaitMs: 100, silentGraceMs: 10, silentPauseMs: 1000 });
  let result;
  loader({ ...PLACE, availabilityWindow: today(600) }).then(value => { result = value; });
  await flush();
  t.mock.timers.tick(100);
  await flush();
  assert.equal(result.loader_metadata.primary_collection, 'background_refresh');
  assert.equal(result.loader_metadata.primary_collection_reason, 'no_answered_map_evidence');
  assert.ok(result.every(r => r.sources?.[0]?.provider === 'directory'));
  for (const resolve of pending) resolve(failure(504));
});

// Real HTTP through the app: the label reaches the published source status.
test('over HTTP, a day planned while the map refresh is slow keeps the stored map answer and says so', async t => {
  const { buildApp } = require('../server/app');
  const { requestJson } = require('./helpers/planner-reservoir-compare');
  const A = { lat: 48.5, lng: 8.5 };
  let clock = Date.parse('2026-10-01T10:00:00Z'), hang = false;
  const waiting = [];
  const mapAnswer = () => ({ ok: true, json: async () => ({ elements: Array.from({ length: 15 }, (_, i) => ({
    type: 'node', id: 700 + i, lat: A.lat + (i % 5) * 0.0007, lon: A.lng + Math.floor(i / 5) * 0.0007,
    tags: { name: `Mapped ${700 + i}`, ...[{ amenity: 'restaurant' }, { amenity: 'cafe' }, { tourism: 'museum' }][i % 3] } })) }) });
  const osm = createOpenDataLoader({ cache: createSourceCache({ namespace: 'overpass', now: () => clock }), now: () => clock,
    staleIfErrorMs: 7 * DAY, timeoutMs: 20_000,
    fetcher: (_url, init) => hang ? new Promise((resolve, reject) => {
      waiting.push(resolve);
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }) : Promise.resolve(mapAnswer()) });
  const loader = composeOpenDataLoaders(osm, null, { eager: true, load: anchor => Array.from({ length: 15 }, (_, i) => ({
    id: `directory-${i}`, name: `Directory ${i}`, type: ['museum', 'restaurant', 'park'][i % 3],
    lat: anchor.lat + (i % 5) * 0.0008, lng: anchor.lng + Math.floor(i / 5) * 0.0008, tags: [],
    sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred' }] })) }, null,
  { primaryWaitMs: 300, silentGraceMs: 50, silentPauseMs: 60_000 });
  const server = buildApp({ openDataLoader: loader, weatherProvider: async () => null, clock: () => new Date(clock),
    placeResolver: async query => [{ label: query, ...A, confidence: 'high', provenance: 'test_resolver', timezone: 'Europe/Stockholm' }],
  }).listen(0);
  t.after(() => { for (const resolve of waiting) resolve({ ok: false, status: 504, headers: { get: () => null } });
    return new Promise(resolve => server.close(resolve)); });
  const plan = async () => {
    const response = await requestJson(server, { path: '/api/route-recommendations?lang=en', body: {
      place: 'Place A', dates: ['2026-10-01'], preferences: ['culture', 'food'], day_rhythm: 'balanced', leg_pacing: 'balanced',
      distance_mode: 'no_limit', start: { type: 'auto' }, end: { type: 'auto' }, home_base: { type: 'auto' },
      experimental_agnostic_route_output: 1, include_external_candidates: 1, agnostic_engine_compose: 1 } });
    assert.equal(response.status, 200);
    const status = response.body.agnostic_route_output_experiment.source_status;
    return { status: status.status, collection: status.collection.primary_collection, cache: status.collection.cache,
      stops: response.body.days[0]?.primary_route?.main_stops || [] };
  };
  const healthy = await plan();
  assert.equal(healthy.status, 'loaded:30', 'the healthy day has the map answer and the directory');
  assert.equal(healthy.collection, null);

  clock += 7 * HOUR; // the same afternoon: a new minute, and the stored answer has expired
  hang = true;
  const slow = await plan();
  assert.equal(slow.status, 'loaded:30', 'the map family is still in the day');
  assert.equal(slow.collection, 'stored_map_answer');
  assert.deepEqual(slow.cache, { served_stale: true, stale_age_seconds: 3600, refresh_reason: 'refresh_outstanding' });
  assert.ok(slow.stops.length >= 2, 'a day is published');
});
