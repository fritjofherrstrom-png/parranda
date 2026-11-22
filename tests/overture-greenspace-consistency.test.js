'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mapOvertureRow, selectRecords } = require('../server/place-candidates/overture-source');
const captured = require('./fixtures/overture-care-park-20261108.json');
const care = captured.records.find(record => record.name === 'Norlandia Närlunda Park');
const parks = captured.records.filter(record => record !== care);
const anchor = { lat: 56.0442098, lng: 12.7037060 };
const options = { anchor, requestedIntents: ['parks_gardens'], limit: 80 };

function syntheticRow(record = care, overrides = {}) {
  // Synthetic mapper input using the captured candidate's factual identity;
  // the fixture does not claim to retain the original raw Parquet taxonomy.
  return {
    id: record.id.replace(/^overture-/, ''), name: record.name,
    lat: record.lat, lng: record.lng, category: 'park', category_hierarchy: ['park'],
    confidence: 0.99, licenses: ['CDLA-Permissive-2.0'],
    operating_status: 'open', websites: [record.website], ...overrides,
  };
}

test('retained park selection withholds the identity-bound care-facility conflict without rewriting source facts', () => {
  const before = JSON.stringify(captured.records);
  const selected = selectRecords(captured.records, options);
  assert.ok(!selected.some(record => record.id === care.id),
    'a service-specific care-facility website must not count as a public park');
  assert.deepEqual(new Set(selected.map(record => record.id)), new Set(parks.map(record => record.id)));
  assert.equal(JSON.stringify(captured.records), before, 'retained sample/receipt inputs remain immutable');
});

test('fresh park mapping withholds the same care-facility conflict before caching', () => {
  const row = syntheticRow();
  const before = JSON.stringify(row);
  assert.equal(mapOvertureRow(row), null, 'fresh and retained source paths must agree');
  assert.equal(JSON.stringify(row), before);
});

test('care-service contradiction generalizes beyond the captured language, identity and geography', () => {
  const alternate = { ...care, id: 'overture-f17b0f98-3c38-4b32-a040-b45994db6329',
    name: 'Maple Grove Gardens', lat: 51.5, lng: -0.12,
    website: 'https://provider.example/care-homes/maple-grove-gardens' };
  assert.deepEqual(selectRecords([alternate], { anchor: { lat: 51.5, lng: -0.12 }, requestedIntents: ['parks_gardens'] }), []);
});

test('a nested care-service index is not a facility identity in retained selection', () => {
  for (const type of ['park', 'garden']) {
    for (const leaf of ['senior-living', 'senior_living', '%73enior-living', 'senior-living.html']) {
      const record = { ...care, type, name: 'Senior Living Gardens',
        website: 'https://provider.example/care-homes/' + leaf };
      assert.equal(selectRecords([record], options)[0], record,
        'a second generic service index must preserve the ambiguous source record');
    }
  }
});

test('a nested care-service index preserves fresh park and garden mapping', () => {
  for (const category of ['park', 'botanical_garden']) {
    for (const leaf of ['senior-living', 'senior_living', '%73enior-living', 'senior-living.html']) {
      const row = syntheticRow(care, { name: 'Senior Living Gardens', category,
        category_hierarchy: [category], websites: ['https://provider.example/care-homes/' + leaf] });
      assert.equal(mapOvertureRow(row)?.type, category === 'park' ? 'park' : 'garden',
        'a service leaf is not a named facility in fresh mapping');
    }
  }
});

test('the specific care-facility contradiction also applies to a source garden', () => {
  const record = { ...care, type: 'garden', name: 'Maple Grove Gardens',
    website: 'https://provider.example/care-homes/maple-grove-gardens' };
  assert.deepEqual(selectRecords([record], options), []);
  assert.equal(mapOvertureRow(syntheticRow(record, {
    category: 'botanical_garden', category_hierarchy: ['botanical_garden'],
  })), null);
});

test('malformed, credentialled, non-HTTP and oversized facts do not establish the negative identity claim', () => {
  const { hasGreenspaceCareFacilityConflict } = require('../server/place-candidates/overture-greenspace-consistency');
  for (const record of [
    { ...care, website: 'https://provider.example/care-homes/maple%ZZgrove-gardens' },
    { ...care, website: 'https://unused:synthetic@example.com/care-homes/maple-grove-gardens' },
    { ...care, website: 'file:///care-homes/maple-grove-gardens' },
    { ...care, website: 'not a URL' },
    { ...care, website: 'https://provider.example/' + 'x'.repeat(2048) },
    { ...care, name: 'x'.repeat(501) },
  ]) {
    const before = JSON.stringify(record);
    assert.equal(hasGreenspaceCareFacilityConflict(record), false);
    assert.equal(selectRecords([record], options)[0], record);
    assert.equal(JSON.stringify(record), before);
  }
});

test('ordinary parks, ambiguous names and unbound care URLs retain existing eligibility', () => {
  for (const [name, website] of [
    ['Maple Grove Gardens', 'https://parks.example/parks/maple-grove-gardens'],
    ['Care Home Memorial Park', 'https://parks.example/parks/care-home-memorial-park'],
    ['Maple Grove Gardens', 'https://provider.example/care-homes/unrelated-location'],
    ['Maple Grove Gardens', 'https://provider.example/care-homes'],
    ['Maple Grove Gardens', 'https://parks.example/parks/maple-grove-gardens?topic=care-homes'],
    ['Maple Grove Gardens', 'https://care-homes.example/parks/maple-grove-gardens'],
    ['Maple Grove Gardens', null],
  ]) {
    const record = { ...care, name, website };
    const selected = selectRecords([record], options);
    assert.equal(selected.length, 1, `${name}: ${website}`);
    assert.equal(selected[0], record, 'no new facts, location, type or source authority');
    const mapped = mapOvertureRow(syntheticRow(record, { websites: website ? [website] : [] }));
    assert.equal(mapped?.type, 'park', `${name}: fresh preservation`);
  }
});

test('the narrow negative park check does not recategorize other venue types or change source attributes', () => {
  for (const type of ['museum', 'restaurant', 'bar', 'vintage-shop']) {
    const record = { ...care, type };
    const selected = selectRecords([record], { ...options, requestedIntents: [] });
    assert.equal(selected[0], record, type);
  }
  const ordinary = mapOvertureRow(syntheticRow(parks[0]));
  assert.equal(ordinary?.id, parks[0].id);
  assert.equal(ordinary?.type, 'park');
  assert.deepEqual(ordinary?.sources, parks[0].sources);
  assert.equal(ordinary?.website, parks[0].website);
});

test('real HTTP publication and the frontend coverage reader exclude the care site but keep the captured parks', async t => {
  const { once } = require('node:events');
  const { buildApp } = require('../server/app');
  const { makeLoader, requestJson } = require('./helpers/planner-reservoir-compare');
  const { routePreferenceCoverage } = await import('../frontend/src/lib/route-context-view.mjs');
  const server = buildApp({
    openDataLoader: makeLoader(selectRecords(captured.records, options)),
    placeSuggestions: null, eventSupply: null, sourceCatalog: null,
    reviewedPlaceSource: null, publishedDayStore: null,
    clock: () => new Date('2026-11-08T10:00:00Z'),
    placeResolver: async () => [{ ...anchor, label: 'Controlled source area',
      confidence: 'high', provenance: 'offline_fixture', timezone: 'Europe/Stockholm',
      osm_class: 'place', osm_ref: 'relation/123456' }],
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 3600 } }),
  }).listen(0, '127.0.0.1');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await once(server, 'listening');
  const response = await requestJson(server, {
    path: '/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&agnostic_engine_compose=1',
    body: { place: 'Controlled source area', dates: ['2026-11-09'],
      preferences: ['parks_gardens'], preference_priority: ['parks_gardens'],
      day_rhythm: 'balanced', include_external_candidates: 1 },
  });
  assert.equal(response.status, 200);
  const stops = response.body.days?.[0]?.primary_route?.main_stops;
  assert.ok(stops?.length >= 2, 'publish a real composed route from retained source facts');
  assert.ok(!stops.some(stop => stop.id === care.id), 'care site must not survive into public route coverage');
  assert.deepEqual(new Set(stops.map(stop => stop.id)), new Set(parks.map(record => record.id)));
  assert.deepEqual(routePreferenceCoverage(stops, ['parks_gardens']), {
    has_coverage_evidence: true, covered_preferences: ['parks_gardens'],
    partial_preferences: [], missing_preferences: [],
  });
  assert.equal(response.body.agnostic_route_output_experiment.walking_validation.valid, true);
});
