'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapOvertureRow } = require('../server/place-candidates/overture-source');
const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { mapRecordToCandidate } = require('../server/place-candidates/external-open-provider');
const { resolveCandidateIdentity } = require('../server/candidates/entity-resolution');

const row = (category, name = 'Fixture Kitchen') => ({
  id: '06d8f8c3-fb2b-4680-a518-8df6bf53c0b9', name, category,
  category_hierarchy: category === 'restaurant' ? ['food_and_drink', 'restaurant'] : ['food_and_drink', 'restaurant', category], confidence: 0.998,
  licenses: ['CDLA-Permissive-2.0'], lat: 59.33, lng: 18.06,
});
const osm = (cuisine, overrides = {}) => mapOsmElement({ type: 'node', id: 123,
  lat: 59.33, lon: 18.06, tags: { name: 'Fixture Kitchen', amenity: 'restaurant',
    ...(cuisine === undefined ? {} : { cuisine }), ...overrides } });
const candidate = record => mapRecordToCandidate({ key: 'fixture' }, record, '2026-11-06T08:00:00Z', 0);

test('specific directory cuisine survives generic restaurant mapping', () => {
  for (const category of ['indian_restaurant', 'north_indian_restaurant', 'south_indian_restaurant']) {
    const record = mapOvertureRow(row(category));
    assert.equal(record.type, 'restaurant');
    assert.deepEqual(record.search_facets, { cuisines: ['indian'] });
    assert.deepEqual(candidate(record).search_facets, { cuisines: ['indian'] });
  }
});

test('OSM explicit multi-cuisine facts are retained and deduplicated', () => {
  assert.deepEqual(osm('thai;indian;thai').search_facets, { cuisines: ['indian', 'thai'] });
  assert.deepEqual(candidate(osm('indian')).search_facets, { cuisines: ['indian'] });
});

test('venue name, generic type and alternate taxonomy never invent cuisine', () => {
  for (const record of [osm(undefined, { name: 'India Palace' }),
    mapOvertureRow({ ...row('restaurant', 'Indian Kitchen'), alternate: ['indian_restaurant'] }),
    osm('unsupported_future_value')]) {
    assert.equal(record.search_facets, undefined);
  }
});

test('untrusted-shaped facet values are rejected without affecting place admission', () => {
  for (const search_facets of [{ cuisines: 'indian' }, { cuisines: ['http://evil.test'] },
    { cuisines: ['indian'], source_url: 'http://evil.test' }, ['indian']]) {
    assert.equal(candidate({ ...osm(), search_facets }).search_facets, undefined);
  }
});

test('matching source identities keep cuisine even when directory identity wins', () => {
  const a = candidate(mapOvertureRow(row('restaurant')));
  const b = candidate(osm('indian'));
  const result = resolveCandidateIdentity([a, b]);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].search_facets, { cuisines: ['indian'] });
});

test('nearby different branches cannot lend cuisine facts', () => {
  const a = candidate({ ...mapOvertureRow(row('restaurant')), source_address: { street: 'Fixture Street', house_number: '1' } });
  const b = candidate({ ...osm('indian'), source_address: { street: 'Fixture Street', house_number: '2' } });
  const result = resolveCandidateIdentity([a, b]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates.find(c => c.id === a.id).search_facets, undefined);
});
