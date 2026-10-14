"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { createOpenDataLoader, composeOpenDataLoaders, createOvertureBackgroundSource } = require('../server/place-candidates/open-data-loader');
const { createBackgroundSource, SOURCE_COMPLETION } = require('../server/place-candidates/background-source');
const { createOvertureSource } = require('../server/place-candidates/overture-source');
const { createWikidataSource } = require('../server/place-candidates/wikidata-source');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createPlaceSelectionStore } = require('../server/place-candidates/place-selection');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const { evaluateOpeningHoursForWindow } = require('../server/place-candidates/opening-hours');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mapOvertureRow } = require('../server/place-candidates/overture-source');
const { createExternalOpenProvider } = require('../server/place-candidates/external-open-provider');
const { resolveCandidateIdentity } = require('../server/candidates/entity-resolution');
const { readSourceNegativeFacts } = require('../server/place-candidates/source-negative-facts');

const anchor = { lat: 55.6, lng: 13 };
const targetId = 'overture-00000000-0000-0000-0000-000000000001';
const targetName = 'Juniper Museum';
const targetHours = 'Th off; Fr-We 09:00-22:00';
const thursday = { weekday: 4, startMinute: 0, endMinute: 1440 };
function osm(id, name, type, offset, hours = '24/7') {
  return { type: 'node', id, lat: anchor.lat + offset, lon: anchor.lng,
    tags: { name, ...(type === 'museum' ? { tourism: type } : { amenity: type }),
      ...(hours ? { opening_hours: hours } : {}), wikidata: `Q${id}` } };
}
function fixturePool(target = osm(1000001, targetName, 'museum', .00001, targetHours)) {
  return [target,
    ...Array.from({ length: 18 }, (_, i) => osm(2000000 + i, `Alder Museum ${i}`, 'museum', .002 + i * .001)),
    ...Array.from({ length: 19 }, (_, i) => osm(3000000 + i, `Birch Restaurant ${i}`, 'restaurant', .003 + i * .001)),
    ...Array.from({ length: 19 }, (_, i) => osm(4000000 + i, `Cedar Cafe ${i}`, 'cafe', .004 + i * .001)),
  ];
}
async function withSourceApi(run) {
  const pool = fixturePool();
  const queries = [], acquisition = [];
  let directoryCalls = 0, knowledgeCalls = 0;
  const map = createOpenDataLoader({ cache: createSourceCache({ dir: null }), fetcher: async (_url, options) => {
    queries.push(new URLSearchParams(options.body).get('data'));
    return { ok: true, json: async () => ({ elements: pool }) };
  } });
  const directory = createOvertureSource({ releaseResolver: async () => '2026-09-23.0',
    queryRows: async () => {
      directoryCalls++;
      return [{ id: targetId.slice('overture-'.length), name: targetName, ...anchor,
        lat: pool[0].lat, confidence: .99, category: 'museum', category_hierarchy: ['museum'],
        licenses: ['CC0-1.0'], operating_status: 'open' }];
    }, cacheDir: null });
  const knowledge = createWikidataSource({ fetcher: async () => {
    knowledgeCalls++;
    return { ok: true, json: async () => ({ results: { bindings: [{
      item: { value: 'http://www.wikidata.org/entity/Q1000001' }, itemLabel: { value: targetName },
      lat: { value: String(pool[0].lat) }, lng: { value: String(anchor.lng) },
      classRoot: { value: 'http://www.wikidata.org/entity/Q33506' },
    }] } }) };
  } });
  const knowledgeBackground = createBackgroundSource({ cache: createSourceCache({ dir: null }),
    keyFor: ({ lat, lng }) => `${lat.toFixed(3)},${lng.toFixed(3)}`, load: knowledge,
    eager: false, waitForCompletion: false });
  const directoryBackground = createOvertureBackgroundSource({ source: directory, cache: createSourceCache({ dir: null }) });
  await knowledgeBackground.load(anchor, {})[SOURCE_COMPLETION];
  await directoryBackground.load(anchor, {})[SOURCE_COMPLETION];
  const composed = composeOpenDataLoaders(map, knowledgeBackground, directoryBackground);
  const loader = async request => {
    const rows = await composed(request);
    acquisition.push({ request, rows });
    return rows;
  };
  Object.defineProperties(loader, Object.getOwnPropertyDescriptors(composed));
  const server = buildApp({ openDataLoader: loader,
    placeResolver: async () => [{ label: 'Fixture town', ...anchor, confidence: 'medium',
      provenance: 'test_resolver', timezone: 'Europe/Stockholm' }],
    placeSelectionStore: createPlaceSelectionStore({ cacheDir: null }),
    placeSuggestions: null, sourceCatalog: null, reviewedPlaceSource: null, eventSupply: null,
    weatherProvider: async () => null, clock: () => new Date('2026-10-14T08:00:00Z'),
  }).listen(0, '127.0.0.1');
  try {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const post = (body = {}) => requestJson(server, { path: '/api/route-recommendations?lang=en', body: {
      place: 'Fixture town', dates: ['2026-10-22'], preferences: ['museums', 'food', 'coffee'], day_rhythm: 'full',
      include_external_candidates: 1, experimental_agnostic_route_output: 1, agnostic_engine_compose: 1,
      pinned_candidate_ids: [targetId], ...body,
    } });
    return await run({ post, acquisition, queries, calls: () => ({ osm: queries.length, directory: directoryCalls, knowledge: knowledgeCalls }) });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('HTTP source cut cannot lose selected-day closure and publish its pinned directory/knowledge twin', async () => {
  await withSourceApi(async ({ post, acquisition, queries, calls }) => {
    const response = await post();
    const experiment = response.body.agnostic_route_output_experiment;
    const stops = response.body.days[0]?.primary_route?.main_stops || [];
    assert.equal(response.status, 200);
    assert.equal(evaluateOpeningHoursForWindow(targetHours, thursday).eligible, false);
    assert.deepEqual(calls(), { osm: 1, directory: 1, knowledge: 1 });
    assert.deepEqual([...queries[0].matchAll(/out center (\d+);/g)].map(match => Number(match[1])), Array(8).fill(19));
    assert.ok(acquisition.every(({ rows }) => rows.filter(row => row.id.startsWith('osm-')).length === 25));
    console.log(JSON.stringify({ case: 'source-negative-http', providerCalls: calls(), publishedStopIds: stops.map(stop => stop.id),
      pins: experiment.pinned_candidates, closureExclusions: experiment.context?.influence?.opening_hours_excluded_candidate_count ?? null }));
    assert.equal(stops.some(stop => [stop.label, stop.name].includes(targetName)), false,
      'already acquired source-selected-day closure must survive the positive cut and cross-source reconciliation');
    assert.equal(experiment.context.influence.opening_hours_excluded_candidate_count, 1);
    assert.ok(stops.length >= 5, 'keep eligible Full-day depth, do not fail closed the whole route');
    assert.equal(response.body.days[0].primary_route.trust_summary.human_verified, false);
  });
});

const sourceRequest = { ...anchor, requestedIntents: ['museums', 'food', 'coffee'],
  dayRhythm: 'full', anchorMode: 'place', availabilityWindow: thursday };
function directoryTwin() {
  return mapOvertureRow({ id: targetId.slice('overture-'.length), name: targetName,
    ...anchor, lat: anchor.lat + .00001, confidence: .99, category: 'museum',
    category_hierarchy: ['museum'], licenses: ['CC0-1.0'], operating_status: 'open' });
}
function resolveRecords(rows, extras = [directoryTwin()]) {
  const candidates = createExternalOpenProvider({ key: 'agnostic' }, { dataset: [...rows, ...extras] }).listCandidates();
  return resolveCandidateIdentity(candidates);
}
function assertClosure(rows) {
  assert.equal(rows.length, 25);
  const identity = resolveRecords(rows);
  const target = identity.candidates.find(candidate => candidate.id === targetId);
  assert.ok(target, 'negative witness is not a new candidate; the directory supplies the actual place');
  assert.equal(target.opening_hours, targetHours);
  assert.equal(evaluateOpeningHoursForWindow(target.opening_hours, thursday).eligible, false);
  assert.equal(identity.summary.input_count, 26, 'facts do not enlarge the positive pool');
  assert.equal(identity.candidates.length, 26);
  assert.equal(target.evidence.length, 3, 'closure facts cannot corroborate/promote existence');
}

test('JSON disk restart retains closure on cache-only and neighbouring-budget reads without provider work', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-negative-cache-'));
  let calls = 0;
  try {
    const original = createOpenDataLoader({ cache: createSourceCache({ dir }), fetcher: async () => {
      calls++;
      return { ok: true, json: async () => ({ elements: fixturePool() }) };
    } });
    assertClosure(await original(sourceRequest));
    const restarted = createOpenDataLoader({ cache: createSourceCache({ dir }), fetcher: async () => {
      calls++;
      throw new Error('cache-only restart must never call provider');
    } });
    assertClosure(await restarted.readCached(anchor, sourceRequest));
    const neighbour = restarted.readNeighbouring(anchor, { ...sourceRequest,
      walkingTargetBand: { targetKm: 3, floorKm: 2, ceilingKm: 4 } });
    assert.ok(neighbour);
    assertClosure(neighbour);
    assert.equal(calls, 1);
    assert.equal(readSourceNegativeFacts(neighbour).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cuts and neighbouring indexes from the pre-ledger policy cannot masquerade as complete source evidence', async () => {
  const { mapOverpassResponse } = require('../server/place-candidates/open-data-loader');
  const cache = createSourceCache();
  const oldKey = 'v11:55.600,13.000:r5:w4.0.1440:l25:mplace:icoffee.food.museums:tnone:snone';
  const oldRows = JSON.parse(JSON.stringify(mapOverpassResponse({ elements: fixturePool() }, 25,
    { origin: anchor, requestedIntents: sourceRequest.requestedIntents, availabilityWindow: thursday })));
  cache.set(oldKey, { records: oldRows, status: 'loaded:25', error: null, metadata: null });
  for (const index of ['v11-budgets:55.600,13.000:l25:mplace:icoffee.food.museums:snone',
    'v11-evidence:55.600,13.000:l25:mplace:snone']) {
    cache.set(index, [{ key: oldKey, target_km: null, radius_km: 5 }]);
  }
  let calls = 0;
  const loader = createOpenDataLoader({ cache, fetcher: async () => {
    calls++;
    return { ok: true, json: async () => ({ elements: fixturePool() }) };
  } });
  assert.equal(loader.readNeighbouring(anchor, { ...sourceRequest,
    walkingTargetBand: { targetKm: 3, floorKm: 2, ceilingKm: 4 } }), null);
  assertClosure(await loader(sourceRequest));
  assert.equal(calls, 1);
  assertClosure(await loader(sourceRequest));
  assert.equal(calls, 1);
});

test('a non-winning wider pass keeps already acquired closure without adding its rows to the positive quota', async () => {
  const queries = [];
  const loader = createOpenDataLoader({ radiusKm: 1.5, fetcher: async (_url, options) => {
    queries.push(new URLSearchParams(options.body).get('data'));
    const elements = queries.length === 1
      ? fixturePool().filter(row => row.tags.amenity)
      : [fixturePool()[0]];
    return { ok: true, json: async () => ({ elements }) };
  } });
  const rows = await loader({ ...sourceRequest, requestedIntents: ['museums'] });
  assert.equal(queries.length, 2, 'only the already allowed primary + wider query');
  assert.deepEqual([...queries[0].matchAll(/out center (\d+);/g)].map(match => Number(match[1])), Array(8).fill(19));
  assert.deepEqual([...queries[1].matchAll(/out center (\d+);/g)].map(match => Number(match[1])), [150]);
  assert.equal(rows.loader_metadata.selection_reason, 'wider_supply_not_richer');
  assert.ok(rows.every(row => row.type !== 'museum'));
  assertClosure(rows);
});
