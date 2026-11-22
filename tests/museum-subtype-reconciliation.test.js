'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveCandidateIdentity } = require('../server/candidates/entity-resolution');
const { matchCandidateToIntent } = require('../server/candidates/intent-vocabulary');
const { mapRecordToCandidate } = require('../server/place-candidates/external-open-provider');
const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { mapOvertureRow } = require('../server/place-candidates/overture-source');

function directory(category = 'art_museum', id = '10000000-0000-0000-0000-000000000001') {
  const record = mapOvertureRow({ id, name: 'Cedar Museum', lat: 55.6, lng: 13,
    confidence: 0.99, licenses: ['CC0-1.0'], category, category_hierarchy: ['museum', category] });
  return mapRecordToCandidate({ key: 'fixture' }, record, null, 0);
}

function mapMuseum(museum, tags = {}) {
  const record = mapOsmElement({ type: 'node', id: 100, lat: 55.60001, lon: 13,
    tags: { tourism: 'museum', name: 'Cedar Museum', museum,
      'addr:street': 'Cedar Lane', 'addr:housenumber': '3', ...tags } });
  return mapRecordToCandidate({ key: 'fixture' }, record, null, 0);
}

for (const [museum, mapTags] of [
  ['children', {}],
  ['person', { wikidata: 'Q123' }],
  ['history', {}],
]) {
  test(`a matched museum classified as ${museum} by the map cannot cover a disputed exact subtype`, () => {
    const listed = directory();
    const mapped = mapMuseum(museum, mapTags);
    for (const input of [[listed, mapped], [mapped, listed]]) {
      const { candidates } = resolveCandidateIdentity(input);
      assert.equal(candidates.length, 1);
      const [candidate] = candidates;
      assert.deepEqual(candidate.place_details, { address: 'Cedar Lane 3' });
      assert.equal(matchCandidateToIntent(candidate, 'art_museums').level, 'none');
      assert.equal(matchCandidateToIntent(candidate, 'history_museums').level, 'none');
      assert.equal(matchCandidateToIntent(candidate, 'museums').level, 'strong');
    }
  });
}

test('a same or unknown map classification does not dispute explicit art museum evidence', () => {
  for (const museum of ['art', undefined, 'unrecognized']) {
    const { candidates } = resolveCandidateIdentity([directory(), mapMuseum(museum, { wikidata: 'Q123' })]);
    assert.equal(candidates.length, 1);
    assert.equal(matchCandidateToIntent(candidates[0], 'art_museums').level, 'strong');
  }
});

test('a different subtype from the same directory family keeps the canonical classification', () => {
  const { candidates } = resolveCandidateIdentity([directory(),
    directory('history_museum', '10000000-0000-0000-0000-000000000002')]);
  assert.equal(candidates.length, 1);
  assert.equal(matchCandidateToIntent(candidates[0], 'art_museums').level, 'strong');
});

test('a subsequent duplicate cannot restore an independently disputed museum subtype', () => {
  const listed = directory();
  const mapped = mapMuseum('person');
  const anotherListing = directory('art_museum', '10000000-0000-0000-0000-000000000000');
  for (const input of [[listed, mapped, anotherListing], [anotherListing, mapped, listed], [listed, anotherListing, mapped]]) {
    const { candidates } = resolveCandidateIdentity(input);
    assert.equal(candidates.length, 1);
    assert.equal(matchCandidateToIntent(candidates[0], 'art_museums').level, 'none');
  }
});

test('an exact museum request refreshes cached map rows that predate subtype preservation', async () => {
  const { createOpenDataLoader } = require('../server/place-candidates/open-data-loader');
  const { createSourceCache } = require('../server/place-candidates/source-cache');
  const { createOverpassEmulator } = require('./helpers/dense-centre-fixture');
  const origin = { lat: 55.6, lng: 13 };
  const oldKey = 'q2:v10:55.600,13.000:r1.5:wnone:l25:munknown:iart_museums:tnone:snone';
  const cache = createSourceCache({ ttlMs: 60_000 });
  const record = mapOsmElement({ type: 'node', id: 100, lat: origin.lat, lon: origin.lng,
    tags: { tourism: 'museum', name: 'Cedar Museum' } });
  cache.set(oldKey, { records: [record], status: 'loaded:1' });
  const { fetcher, stats } = createOverpassEmulator([
    { category: 'museum', osmId: 100, name: record.name, ...origin, osmTags: { museum: 'person' } },
  ]);
  const loader = createOpenDataLoader({ fetcher, radiusKm: 1.5, cache });
  const rows = await loader({ ...origin, requestedIntents: ['art_museums'], dayRhythm: 'balanced' });
  const mapped = mapRecordToCandidate({ key: 'fixture' }, rows[0], null, 0);
  const { candidates } = resolveCandidateIdentity([directory(), mapped]);
  assert.equal(candidates.length, 1);
  assert.equal(matchCandidateToIntent(candidates[0], 'art_museums').level, 'none');
  assert.ok(stats.calls > 0);
});
