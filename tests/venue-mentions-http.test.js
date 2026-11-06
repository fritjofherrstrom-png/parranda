'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildApp } = require('../server/app');
const { createPublishedDayStore } = require('../server/planner/published-day-store');
const { requestJson, mockStableWeatherFetch } = require('./helpers/planner-reservoir-compare');
const DATE = '2026-11-06';
const NOW = `${DATE}T10:00:00.000Z`;
const ROUTE = '/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&agnostic_engine_compose=1';

// OFFLINE controlled transport, real catalog/source producer, real application,
// actual disk store and GET/parser. Not native or external-source acquisition.
test('actual HTTP publication, disk JSON, GET and recipient retain the reviewed venue articles', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'venue-mentions-http-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const oldFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  t.after(() => { global.fetch = oldFetch; });
  let loads = 0, writes = 0;
  const store = createPublishedDayStore({ directory, clock: () => Date.parse(NOW) });
  const app = buildApp({ openDataLoader: async () => { loads++; return []; },
    placeResolver: async () => [{ label: 'Roma, Italia', lat: 41.894501, lng: 12.473962,
      confidence: 'high', provenance: 'offline_fixture', timezone: 'Europe/Rome',
      osm_class: 'place', osm_ref: 'relation/41485' }],
    placeSuggestions: null, reviewedPlaceSource: null, sourceCatalog: null, eventSupply: null,
    placeSelectionStore: { issue: () => null },
    publishedDayStore: { read: store.read, async put(value) { writes++; return store.put(value); } },
    clock: { now: () => NOW } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const body = { place: 'Roma', dates: [DATE], preferences: ['food'], day_rhythm: 'calm',
    include_external_candidates: 1, pinned_candidate_ids: ['roscioli-salumeria'] };
  const baseline = await requestJson(server, { path: ROUTE, body });
  assert.equal(baseline.status, 200, 'the ordinary HTTP journey completes');
  assert.equal(baseline.body.agnostic_route_output_experiment?.promotion?.promote, true,
    'the actual finalizer publishes an eligible day');
  const real = baseline.body.days[0].primary_route.main_stops.find(stop => stop.id === 'roscioli-salumeria');
  assert.ok(real, 'the ordinary supported pin retains the exact real catalog venue');
  assert.equal(real.provenance?.venue_mentions?.length, 2, 'real source facts reach the final HTTP stop');
  const result = await requestJson(server, { path: `${ROUTE}&include_day_snapshot=1`, body });
  assert.equal(result.status, 200);
  assert.equal(result.body.day_snapshot?.state, 'ready',
    'ordinary complete HTTP publication must persist the reviewed article relation');
  assert.equal(writes, 1);
  const { day_snapshot, ...ordinary } = result.body;
  assert.deepEqual(ordinary, baseline.body, 'optional publication does not rerank or mutate the ordinary day');
  const beforeRead = loads;
  const read = await requestJson(server, { path: `/api/shared-days/${day_snapshot.ref}`, method: 'GET', body: null });
  assert.equal(read.status, 200);
  assert.equal(loads, beforeRead, 'a saved view does not reacquire providers');
  const { parsePublishedDay } = await import('../frontend/src/lib/published-day.mjs');
  const parsed = parsePublishedDay(read.body, { ref: day_snapshot.ref, decision: require('../anywhere-render-decision'), now: Date.parse(NOW) });
  assert.ok(parsed, 'the real client parser accepts the persisted server envelope');
  const restored = parsed.entry.safeResponse.days[0].primary_route.main_stops.find(stop => stop.id === real.id);
  assert.deepEqual(restored.provenance.venue_mentions, real.provenance.venue_mentions);
  await t.test('public article claims cannot populate source authority or alter the route', async () => {
    const claimed = await requestJson(server, { path: ROUTE, body: { ...body,
      venue_mentions: [{ publisher: 'Invented publisher', article_url: 'https://attacker.example/praise', verified: true, relation_kind: 'recommended' }],
      provenance: { venue_mentions: real.provenance.venue_mentions },
      source_policy: 'reviewed-venue-articles-v1', human_verified: true,
    } });
    assert.equal(claimed.status, 200);
    assert.deepEqual(claimed.body.days[0].primary_route, baseline.body.days[0].primary_route);
  });
  await t.test('the actual recipient refuses a cross-venue relation before installing saved state', async () => {
    const corrupted = structuredClone(read.body);
    const wrong = corrupted.result.days[0].primary_route.main_stops.find(stop => stop.id === real.id);
    wrong.provenance.venue_mentions[0].venue_binding.label = 'Another branch';
    assert.equal(Boolean(parsePublishedDay(corrupted, { ref: day_snapshot.ref, decision: require('../anywhere-render-decision'), now: Date.parse(NOW) })), false,
      'the real recipient must reject a broken article-to-stop binding');
  });
});
