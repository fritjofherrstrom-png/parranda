'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { matchCandidateToIntent } = require('../server/candidates/intent-vocabulary');
const { resolveCandidateIdentity } = require('../server/candidates/entity-resolution');
const { mapRecordToCandidate } = require('../server/place-candidates/external-open-provider');
const { createOpenDataLoader, mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createWikidataSource } = require('../server/place-candidates/wikidata-source');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');
const { createOverpassEmulator } = require('./helpers/dense-centre-fixture');

const origin = { lat: 55.6, lng: 13 };
const unrelated = ['restaurant', 'cafe', 'museum'].flatMap((category, group) =>
  Array.from({ length: 4 }, (_, index) => ({ category, osmId: 300 + group * 10 + index,
    name: `${category} ${index}`, lat: origin.lat, lng: origin.lng + index * .001 })));

function places(category, osmTags = {}) {
  return Array.from({ length: 4 }, (_, index) => ({ category, osmId: 101 + index,
    name: `Outdoor stop ${index}`, lat: origin.lat + index * .003, lng: origin.lng,
    osmType: 'way', osmTags: { wikidata: `Q${101 + index}`, ...osmTags } }));
}

async function compose(openDataLoader, intent) {
  const { result } = await composeAgnosticRouteOutput({ coords: origin, baselineResult: { days: [] },
    externalRequested: true, openDataLoader, preferences: [intent], date: '2026-10-22',
    todayIsoDate: '2026-10-14', trustedTimezone: 'Europe/Stockholm', timezone: 'Europe/Stockholm',
    clock: () => new Date('2026-10-14T08:00:00Z'), synthesizeVia: 'engine', distanceMode: 'no_limit',
    dayRhythm: 'balanced', weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false }),
  });
  return result.days[0]?.primary_route?.main_stops || [];
}

for (const [intent, category] of [['viewpoint_places', 'scenic_viewpoint'], ['waterside', 'marina']]) {
  test(`unnamed features cannot exhaust Overpass's bounded ${intent} output before named places`, async () => {
    const unnamed = Array.from({ length: 90 }, (_, index) => ({ category, osmId: index + 1,
      ...origin, osmType: 'node' }));
    const { fetcher, stats } = createOverpassEmulator([...unnamed, ...places(category), ...unrelated]);
    const loader = createOpenDataLoader({ fetcher, radiusKm: 1.5 });
    const stops = await compose(loader, intent);
    assert.equal(stops.length, 4);
    assert.ok(stops.every(stop => stop.id.startsWith('osm-way-10') && stop.covered_preferences.includes(intent)));
    assert.equal(stats.calls, 1, 'the named places fit in the original query budget');
  });
}

test('explicit natural bathing places reach the route, while an ordinary beach remains waterside only', async () => {
  const bareBeach = mapOsmElement({ type: 'node', id: 201, lat: origin.lat, lon: origin.lng,
    tags: { name: 'Swimming Beach', natural: 'beach' } });
  assert.equal(matchCandidateToIntent(bareBeach, 'bathing_places').level, 'none');
  assert.equal(matchCandidateToIntent(bareBeach, 'waterside').level, 'strong');

  const { fetcher, stats } = createOverpassEmulator([
    ...places('marina', { leisure: 'bathing_place' }), ...unrelated,
    { category: 'marina', osmId: 201, name: 'Swimming Beach', ...origin, osmTags: { leisure: undefined, natural: 'beach' } },
  ]);
  const loader = createOpenDataLoader({ fetcher, radiusKm: 1.5 });
  const stops = await compose(loader, 'bathing_places');
  assert.equal(stops.length, 4);
  assert.ok(stops.every(stop => stop.type === 'beach' && stop.covered_preferences.includes('bathing_places')));
  assert.ok(stops.every(stop => !stop.selected_day_hours), 'bathing classification provides no selected-day hours');
  assert.equal(stats.calls, 1);
});

test('explicitly prohibited swimming overrides an OSM bathing classification without removing the waterside place', () => {
  for (const evidence of [{ natural: 'beach' }, { leisure: 'bathing_place' }, { leisure: 'swimming_area' }]) {
    const record = mapOsmElement({ type: 'node', id: 201, lat: origin.lat, lon: origin.lng,
      tags: { name: 'Waterfront spot', swimming: 'no', ...evidence } });
    assert.ok(record);
    assert.equal(matchCandidateToIntent(record, 'bathing_places').level, 'none');
    assert.equal(matchCandidateToIntent(record, 'waterside').level, 'strong');
  }
});

test('the corrected outdoor query replaces a cached old negative and keeps its own warm answer', async () => {
  const oldKey = 'q2:v10:55.600,13.000:r1.5:wnone:l25:munknown:iviewpoint_places:tnone:snone';
  const cache = createSourceCache({ ttlMs: 60_000 });
  cache.set(oldKey, { records: [], status: 'loaded:0', error: null, metadata: null });
  const { fetcher, stats } = createOverpassEmulator([...places('scenic_viewpoint'), ...unrelated]);
  const loader = createOpenDataLoader({ fetcher, radiusKm: 1.5, cache });
  const request = { ...origin, requestedIntents: ['viewpoint_places'], dayRhythm: 'balanced' };
  const records = await loader(request);
  assert.equal(records.filter(record => matchCandidateToIntent(record, 'viewpoint_places').level === 'strong').length, 4);
  assert.deepEqual((await loader(request)).map(({ id }) => id), records.map(({ id }) => id));
  assert.deepEqual(cache.peek(oldKey).records, []);
  assert.equal(stats.calls, 1);
});

test('a failed outdoor refresh can use the preceding query’s positive evidence as stale', async () => {
  const oldKey = 'q2:v10:55.600,13.000:r1.5:wnone:l25:munknown:iwaterside:tnone:snone';
  const cache = createSourceCache({ ttlMs: 60_000 });
  const record = mapOsmElement({ type: 'way', id: 201, center: { lat: origin.lat, lon: origin.lng },
    tags: { name: 'Source pier', man_made: 'pier' } });
  cache.set(oldKey, { records: [record], status: 'loaded:1', error: null, metadata: null });
  const loader = createOpenDataLoader({ fetcher: async () => ({ ok: false, status: 502 }),
    radiusKm: 1.5, cache, staleIfErrorMs: 5_000 });
  const request = { ...origin, requestedIntents: ['waterside'], dayRhythm: 'balanced' };
  const records = await loader(request);
  assert.deepEqual(records.map(({ id }) => id), ['osm-way-201']);
  assert.equal(records.loader_metadata?.cache?.served_stale, true);
  assert.equal(records.loader_metadata?.cache?.query_contract, 'previous');
  assert.equal(cache.peek(oldKey).metadata, null);
});

test('outdoor refresh retains independently collected nearby map evidence while its query is pending', () => {
  const oldExactKey = 'q2:v10:55.600,13.000:r1.5:wnone:l25:munknown:iwaterside:tnone:snone';
  const neighbouringKey = 'q2:v10:55.600,13.000:r1.5:wnone:l25:munknown:iother:tnone:snone';
  const evidenceKey = 'q2:v10-evidence:55.600,13.000:l25:munknown:snone';
  const cache = createSourceCache({ ttlMs: 60_000 });
  const record = mapOsmElement({ type: 'way', id: 201, center: { lat: origin.lat, lon: origin.lng },
    tags: { name: 'Source pier', man_made: 'pier' } });
  cache.set(oldExactKey, { records: [{ ...record, id: 'old-exact' }], status: 'loaded:1' });
  cache.set(neighbouringKey, { records: [record], status: 'loaded:1' });
  cache.set(evidenceKey, [oldExactKey, neighbouringKey].map(key => ({ key, radius_km: 1.5 })));
  const loader = createOpenDataLoader({ fetcher: async () => assert.fail('cache-only read'), radiusKm: 1.5, cache });
  const records = loader.readNeighbouring(origin, { requestedIntents: ['waterside'], dayRhythm: 'balanced' });
  assert.deepEqual(records?.map(({ id }) => id), ['osm-way-201']);
});

test('an exact Wikidata bathing-site classification enriches the same mapped beach', async () => {
  // Fria Bad is natural=beach in OSM, but its exact linked Wikidata entity
  // independently declares instance of bathing site (Q567998).
  const mapRecord = mapOsmElement({ type: 'way', id: 169558285, center: { lat: 56.05844, lon: 12.68101 },
    tags: { name: 'Fria Bad', natural: 'beach', wikidata: 'Q10727537' } });
  const binding = (qid, label, classId) => ({
    item: { value: `http://www.wikidata.org/entity/${qid}` }, itemLabel: { value: label },
    lat: { value: '56.0579468897119' }, lng: { value: '12.6804176204359' },
    classRoot: { value: `http://www.wikidata.org/entity/${classId}` },
  });
  const queries = [];
  const source = createWikidataSource({ fetcher: async url => {
    queries.push(new URL(url).searchParams.get('query'));
    return { ok: true, json: async () => ({ results: { bindings: [
      binding('Q10727537', 'Örestrandsbadet', 'Q567998'),
      binding('Q200', 'Swimming Beach', 'Q40080'),
    ] } }) };
  } });

  const wikiRecords = await source({ lat: mapRecord.lat, lng: mapRecord.lng });
  assert.deepEqual(wikiRecords.map(record => record.id), ['wikidata-Q10727537']);
  assert.deepEqual(wikiRecords[0].sources.map(source => source.family), ['open_knowledge']);
  assert.equal(wikiRecords[0].human_verified, false);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /VALUES \?classRoot \{ wd:Q567998 \}\s+\?item wdt:P31 \?classRoot/);
  assert.match(queries[0], /LIMIT 25$/);

  const city = { key: 'controlled' };
  const mapCandidate = mapRecordToCandidate(city, mapRecord);
  const wikidataCandidate = mapRecordToCandidate(city, wikiRecords[0]);
  assert.equal(matchCandidateToIntent(mapCandidate, 'bathing_places').level, 'none', 'the link alone has no subtype');
  const { candidates } = resolveCandidateIdentity([mapCandidate, wikidataCandidate]);
  assert.equal(candidates.length, 1);
  assert.equal(matchCandidateToIntent(candidates[0], 'bathing_places').level, 'strong');
  assert.equal(candidates[0].opening_hours, undefined);

  const restricted = mapRecordToCandidate(city, mapOsmElement({
    type: 'way', id: 169558285, center: { lat: mapRecord.lat, lon: mapRecord.lng },
    tags: { name: 'Fria Bad', natural: 'beach', wikidata: 'Q10727537', swimming: 'no' },
  }));
  // The prohibition belongs to the physical site even if the positive
  // classification becomes the canonical record.
  for (const positive of [wikidataCandidate, { ...wikidataCandidate, city_pack_owned: true }]) {
    const { candidates: merged } = resolveCandidateIdentity([positive, restricted]);
    assert.equal(merged.length, 1);
    assert.equal(matchCandidateToIntent(merged[0], 'bathing_places').level, 'none');
    assert.equal(matchCandidateToIntent(merged[0], 'swimming').level, 'none');
    assert.equal(matchCandidateToIntent(merged[0], 'waterside').level, 'strong');
  }
});
