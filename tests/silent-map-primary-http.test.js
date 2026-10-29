"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { composeOpenDataLoaders, createOpenDataLoader } = require('../server/place-candidates/open-data-loader');
const { requestJson } = require('./helpers/planner-reservoir-compare');

// Real HTTP through one app instance over several requests, with the real map
// loader behind a fake Overpass transport that counts provider calls. This is
// a latency fix: why the staging map source does not answer is separate.
const A = { lat: 48.5, lng: 8.5 };
const B = { lat: 52.1, lng: 4.3 };
const BOUND_MS = 1000;
const GRACE_MS = 50;
const directory = (anchor) => Array.from({ length: 15 }, (_, i) => ({
  id: `directory-${anchor.lat}-${i}`, name: `Directory ${i}`, type: ['museum', 'restaurant', 'park'][i % 3],
  lat: anchor.lat + (i % 5) * .0008, lng: anchor.lng + Math.floor(i / 5) * .0008, tags: [],
  sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred' }],
}));
const overpassAnswer = (anchor, base) => ({ ok: true, json: async () => ({ elements: Array.from({ length: 15 }, (_, i) => ({
  type: 'node', id: base + i, lat: anchor.lat + (i % 5) * .0007, lon: anchor.lng + Math.floor(i / 5) * .0007,
  // Every requested interest is present, so the loader asks no second query.
  tags: { name: `Mapped ${base + i}`, ...[{ amenity: 'restaurant' }, { amenity: 'cafe' }, { tourism: 'museum' }][i % 3] } })) }) });

function harness(t) {
  const calls = { A: 0, B: 0 };
  let releaseA = null;
  const osm = createOpenDataLoader({
    cache: createSourceCache(),
    timeoutMs: 20_000,
    fetcher: (_url, init) => {
      const lat = Number(/around:\d+,([-\d.]+),/.exec(decodeURIComponent(init.body))?.[1]);
      if (Math.abs(lat - B.lat) < .01) { calls.B += 1; return Promise.resolve(overpassAnswer(B, 900)); }
      calls.A += 1;
      // Place A's map source does not answer until the test lets it.
      return new Promise((resolve, reject) => {
        releaseA = () => resolve(overpassAnswer(A, 700));
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    },
  });
  const loader = composeOpenDataLoaders(osm, null, { eager: true, load: (anchor) => directory(anchor) }, null,
    { primaryWaitMs: BOUND_MS, silentGraceMs: GRACE_MS, silentPauseMs: 60_000 });
  const server = buildApp({
    openDataLoader: loader,
    weatherProvider: async () => null,
    clock: () => new Date('2026-10-01T10:00:00Z'),
    placeResolver: async (query) => [{ label: query, ...(query === 'Place B' ? B : A), confidence: 'high',
      provenance: 'test_resolver', timezone: 'Europe/Stockholm' }],
  }).listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const plan = async (place) => {
    const started = Date.now();
    const response = await requestJson(server, { path: '/api/route-recommendations?lang=sv', body: {
      place, dates: ['2026-10-01'], preferences: ['culture', 'food'], day_rhythm: 'balanced', leg_pacing: 'balanced',
      distance_mode: 'no_limit', start: { type: 'auto' }, end: { type: 'auto' }, home_base: { type: 'auto' },
      experimental_agnostic_route_output: 1, include_external_candidates: 1, agnostic_engine_compose: 1,
    } });
    assert.equal(response.status, 200);
    const experiment = response.body.agnostic_route_output_experiment;
    return {
      ms: Date.now() - started,
      stops: (response.body.days[0]?.primary_route?.main_stops || []).map(stop => stop.id),
      status: experiment.source_status.status,
      collection: experiment.source_status.collection.primary_collection,
      reason: experiment.source_status.collection.primary_collection_reason,
    };
  };
  return { plan, calls, release: () => releaseA?.() };
}

test('one app instance: a silent place answers within its grace with the same day; other places keep their own treatment', async t => {
  const { plan, calls, release } = harness(t);

  // Place B is planned while the provider slot is free: its map answer joins.
  const warmB = await plan('Place B');
  assert.equal(warmB.status, 'loaded:30', "B's fast map answer is merged with its directory");
  assert.equal(calls.B, 1);

  const first = await plan('Place A');
  assert.ok(first.ms >= BOUND_MS - 50, `the first day at A gives the map its full wait (${first.ms} ms)`);
  assert.equal(first.collection, 'background_refresh');
  assert.equal(first.reason, 'no_answered_map_evidence');
  assert.equal(first.status, 'loaded:15', 'only the directory reached the day');
  assert.equal(calls.A, 1);

  const second = await plan('Place A');
  assert.ok(second.ms < BOUND_MS - 200, `the next day at the silent place answers within its grace (${second.ms} ms)`);
  assert.deepEqual(second.stops, first.stops, 'the same published day');
  assert.deepEqual([second.status, second.collection, second.reason], [first.status, first.collection, first.reason],
    'and the same source status');
  assert.equal(calls.A, 1, 'no extra provider call: the day joined the query already in flight');

  // A slow place does not change another place: B's valid answer still serves it.
  const againB = await plan('Place B');
  assert.equal(againB.status, 'loaded:30', "A's silence does not take B's map evidence");
  assert.equal(calls.B, 1, 'B was answered from its cache');

  release();
  await new Promise(resolve => setTimeout(resolve, 50));
  const later = await plan('Place A');
  assert.equal(later.status, 'loaded:30', 'the late answer filled the cache and serves the later day');
  assert.notEqual(later.collection, 'background_refresh');
  assert.equal(calls.A, 1, 'still one provider call for place A');
});
