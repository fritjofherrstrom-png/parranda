'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeUserIntents, matchCandidateToIntent } = require('../server/candidates/intent-vocabulary');
const { mapOvertureRow, createOvertureSource } = require('../server/place-candidates/overture-source');
const { mapOsmElement, mapOverpassResponse } = require('../server/place-candidates/open-data-loader');
const { buildCuratedCatalogPlaceCandidates } = require('../server/place-candidates/curated-catalog-provider');
const { mapSchemaOrgPlaceToRecord } = require('../server/place-candidates/schema-org-place-source');
const { mapRecordToCandidate } = require('../server/place-candidates/external-open-provider');
const { canonicalPriority } = require('../server/planner/day-composition-policy');
const { selectPlannerRoleCandidates } = require('../server/planner/role-selector');

const origin = { lat: 55.6, lng: 13 };
const city = { key: 'interest-fixture', label: 'Fixture', center: origin, timezone: 'Europe/Stockholm',
  todayIsoDate: () => '2026-11-12', catalog: { allItems: [] } };
function osmElement(tags, id = 1) {
  return { type: 'node', id, lat: origin.lat + id * 0.00001, lon: origin.lng,
    tags: { name: `Place ${id}`, wikidata: `Q${id}`, ...tags } };
}
const osm = (tags, id) => mapOsmElement(osmElement(tags, id));
function directory(category, id = 1, extra = {}) {
  return mapOvertureRow({ id: `10000000-0000-0000-0000-${String(id).padStart(12, '0')}`,
    name: `Directory place ${id}`, lat: origin.lat + id * 0.00001, lng: origin.lng,
    confidence: 0.99, licenses: ['CC0-1.0'], category, category_hierarchy: [category], ...extra });
}
function schema(type, priceRange, extra = {}) {
  const record = mapSchemaOrgPlaceToRecord({ '@type': type, name: 'Publisher venue',
    url: 'https://official.example/place', geo: { latitude: origin.lat, longitude: origin.lng },
    priceRange, ...extra }, { id: 'official', evidence_family: 'official', source_tier: 'official' });
  return record && mapRecordToCandidate(city, record, null, 0);
}

for (const [intent, positive, negative] of [
  ['restaurants', () => osm({ amenity: 'restaurant' }), () => osm({ amenity: 'cafe', name: 'Corner Restaurant' })],
  ['brunch', () => directory('breakfast_and_brunch_restaurant'), () => directory('restaurant', 1, { name: 'Brunch Club', alternates: ['breakfast_and_brunch_restaurant'] })],
  ['cafes', () => osm({ amenity: 'cafe' }), () => osm({ shop: 'bakery', name: 'Bakery Café' })],
  ['bakeries', () => directory('bakery'), () => directory('cafe', 1, { name: 'Bakery & Pastry' })],
  ['art_museums', () => osm({ tourism: 'museum', museum: 'art' }), () => osm({ tourism: 'museum', name: 'Museum of Art' })],
  ['history_museums', () => directory('history_museum'), () => directory('science_museum', 1, { name: 'History of Science Museum' })],
  ['art_galleries', () => osm({ tourism: 'gallery' }), () => osm({ amenity: 'arts_centre', name: 'Art Gallery' })],
  ['historic_sites', () => directory('historic_site'), () => schema('TouristAttraction', null)],
  ['viewpoint_places', () => osm({ tourism: 'viewpoint' }), () => osm({ leisure: 'park', name: 'Panoramic View Park' })],
  ['parks_gardens', () => directory('botanical_garden'), () => osm({ leisure: 'nature_reserve', name: 'Nature Park' })],
  ['waterside', () => osm({ man_made: 'pier' }), () => osm({ leisure: 'park', name: 'Waterfront Park' })],
  ['bathing_places', () => osm({ leisure: 'swimming_area' }), () => osm({ leisure: 'marina', name: 'Harbour Baths' })],
  ['marketplaces', () => osm({ amenity: 'marketplace' }), () => directory('farm', 1, { name: 'Farm Market' })],
  ['flea_markets', () => directory('flea_market'), () => osm({ amenity: 'marketplace', name: 'Flea Market' })],
  ['second_hand', () => osm({ shop: 'second_hand' }), () => directory('market')],
  ['antique_shops', () => osm({ shop: 'antiques' }), () => osm({ shop: 'second_hand', name: 'Antique Finds' })],
  ['wine_bars', () => directory('wine_bar'), () => directory('winery', 1, { name: 'Wine Bar' })],
  ['cocktail_bars', () => directory('cocktail_bar'), () => directory('bar', 1, { name: 'Cocktail Bar' })],
  ['beer_places', () => directory('brewery'), () => directory('pub', 1, { name: 'Beer House' })],
]) {
  test(`${intent} matches its source classification and distinguishes a neighboring place`, () => {
    assert.deepEqual(normalizeUserIntents([intent]).intents, [intent]);
    const candidate = positive(), neighbor = negative();
    assert.ok(candidate);
    assert.ok(neighbor);
    assert.equal(matchCandidateToIntent(candidate, intent).level, 'strong');
    assert.equal(matchCandidateToIntent(neighbor, intent).level, 'none');
  });
}

test('an unclassified beach and a coastal walk supply no exact bathing classification', () => {
  const beach = osm({ natural: 'beach', name: 'Public swimming beach' });
  assert.equal(matchCandidateToIntent(beach, 'bathing_places').level, 'none');
  assert.equal(matchCandidateToIntent(beach, 'swimming').level, 'strong', 'legacy swimming keeps its previous meaning');
  assert.equal(matchCandidateToIntent(osm({ leisure: 'swimming_area' }), 'bathing_places').level, 'strong');
});

test('cheap eats requires the trusted lowest food price level', () => {
  const curated = buildCuratedCatalogPlaceCandidates({ ...city, catalog: { allItems: [
    { id: 'low', name: 'Curated lunch', kind: 'restaurant', priceLevel: '$', ...origin },
    { id: 'high', name: 'Cheap Eats', kind: 'restaurant', priceLevel: '$$', ...origin },
    { id: 'no-food', name: 'Cheap outing', kind: 'bar', priceLevel: '$', ...origin },
  ] } });
  const sources = [schema('Restaurant', '$'), schema('Restaurant', '$$'),
    schema('Restaurant', '$-$$'), schema('Restaurant', undefined), schema('BarOrPub', '$'),
    schema('Restaurant', ['$']), schema('Restaurant', null, { offers: { priceRange: '$' } }),
    osm({ amenity: 'fast_food' }), directory('fast_food_restaurant')];
  assert.deepEqual([...curated, ...sources].map(candidate => matchCandidateToIntent(candidate, 'cheap_eats').level),
    ['strong', 'none', 'none', 'strong', 'none', 'none', 'none', 'none', 'none', 'none', 'none', 'none']);
});

test('a music venue does not satisfy the dated Live music interest', () => {
  assert.deepEqual(normalizeUserIntents(['live_music']).intents, ['live_music']);
  assert.equal(matchCandidateToIntent(directory('piano_bar'), 'live_music').level, 'none');
});

test('grouped and legacy preferences share the same ranked prefix', () => {
  assert.deepEqual(canonicalPriority(['brunch', 'fika', 'wine_bars'], ['wine_bars', 'fika', 'brunch']),
    ['brunch', 'coffee', 'wine_bars']);
});

test('a bounded source selection keeps both requested museum subtypes', () => {
  const elements = [...Array.from({ length: 12 }, (_, i) =>
    osmElement({ tourism: 'museum', museum: 'art' }, i + 1)),
  osmElement({ tourism: 'museum', museum: 'history' }, 25)];
  const requestedIntents = ['art_museums', 'history_museums'];
  const osmRows = mapOverpassResponse({ elements }, 3, { origin, requestedIntents });
  assert.ok(osmRows.some(row => row.id === 'osm-node-25'));
  assert.equal(osmRows.length, 3);

  const source = createOvertureSource({ limit: 3, queryRows: async () => [] });
  const directoryRows = source.select([
    ...Array.from({ length: 12 }, (_, i) => directory('art_museum', i + 1)),
    directory('history_museum', 25),
  ], { ...origin, requestedIntents });
  assert.ok(directoryRows.some(row => row.id.endsWith('025')));
  assert.equal(directoryRows.length, 3);
});

test('a bounded culture role keeps both requested museum subtypes after ordinary gate evaluation', () => {
  const output = selectPlannerRoleCandidates(city, { origin, preferences: ['art_museums', 'history_museums'],
    include_external_candidates: 1, limitPerRole: 3 }, {
    external_provider: { dataset: () => [
      ...Array.from({ length: 12 }, (_, i) => osm({ tourism: 'museum', museum: 'art' }, i + 1)),
      osm({ tourism: 'museum', museum: 'history' }, 25),
      osm({ tourism: 'museum', museum: 'history', disused: 'yes' }, 40),
    ] },
    experimentalAdmitCandidate: () => null,
  });
  const role = output.roles.find(({ role }) => role === 'culture_stop');
  assert.equal(role?.requested, true);
  assert.equal(role.candidates.length, 3);
  assert.ok(role.candidates.some(candidate => candidate.covered_preferences.includes('art_museums')));
  assert.ok(role.candidates.some(candidate => candidate.candidate_id === 'osm-node-25' &&
    candidate.covered_preferences.includes('history_museums')));
  assert.ok(!role.candidates.some(candidate => candidate.candidate_id === 'osm-node-40'));
});

test('Overpass reserves part of its bounded response for explicitly selected museum subtypes', async () => {
  const { createOverpassEmulator } = require('./helpers/dense-centre-fixture');
  const { createOpenDataLoader } = require('../server/place-candidates/open-data-loader');
  const places = Array.from({ length: 45 }, (_, i) => ({
    category: 'museum', osmId: i + 1, name: `Museum ${i}`, lat: origin.lat + i * .00001, lng: origin.lng,
    osmTags: { museum: i < 43 ? 'science' : i === 43 ? 'art' : 'history' },
  }));
  places.push(
    { category: 'restaurant', osmId: 46, name: 'Lunch', ...origin },
    { category: 'park', osmId: 47, name: 'Park', ...origin },
  );
  const { fetcher, stats } = createOverpassEmulator(places);
  const loader = createOpenDataLoader({ fetcher, radiusKm: 1 });
  const rows = await loader({ ...origin, requestedIntents: ['art_museums', 'history_museums'], dayRhythm: 'balanced' });
  assert.deepEqual(rows.filter(row => row.place_details?.kind).map(row => row.place_details.kind).sort(),
    ['art_museum', 'history_museum']);
  assert.equal(stats.calls, 1);
});

test('the universal Overture sample keeps a rare exact subtype within its existing row limit', async t => {
  const { createOvertureQueryRows } = require('./helpers/dense-centre-fixture');
  const { buildOvertureQuery } = require('../server/place-candidates/overture-source');
  const places = Array.from({ length: 12 }, (_, i) => {
    const lat = origin.lat + i * .0001;
    return { category: i < 11 ? 'restaurant' : 'breakfast_and_brunch_restaurant', name: `Venue ${i}`,
      overtureId: `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`, lat, lng: origin.lng,
      directoryLat: lat, directoryLng: origin.lng };
  });
  const fixture = await createOvertureQueryRows(places);
  t.after(() => fixture.close());
  const sql = buildOvertureQuery({ release: '2026-10-21.0', ...origin, rowLimit: 3 });
  const sampled = await fixture.queryRows(sql);
  assert.ok(sampled.some(row => row.category === 'breakfast_and_brunch_restaurant'));
  assert.equal(sampled.length, 3);
});

test('a kept café survives a grouped Bakery request without claiming a bakery match', async t => {
  const { once } = require('node:events');
  const { buildApp } = require('../server/app');
  const { requestJson, makeLoader } = require('./helpers/planner-reservoir-compare');
  const date = '2026-11-12';
  const server = buildApp({
    openDataLoader: makeLoader([
      osm({ amenity: 'cafe', opening_hours: 'Mo-Su 08:00-19:00' }, 100),
      ...[110, 180, 240].map(id => osm({ shop: 'bakery', opening_hours: 'Mo-Su 08:00-19:00' }, id)),
    ]),
    placeSuggestions: null, eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null, publishedDayStore: null,
    clock: () => new Date('2026-11-11T09:00:00Z'),
    placeResolver: async () => [{
      ...origin, label: 'Controlled neighbourhood', confidence: 'high', provenance: 'offline_fixture',
      timezone: 'Europe/Stockholm', osm_class: 'place', osm_ref: 'relation/123456',
    }],
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 3600 },
    }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const response = await requestJson(server, {
    path: '/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&agnostic_engine_compose=1',
    body: { place: 'Controlled neighbourhood', dates: [date], preferences: ['bakeries'],
      preference_priority: ['bakeries'], day_rhythm: 'balanced', include_external_candidates: 1,
      pinned_candidate_ids: ['osm-node-100'] },
  });
  assert.equal(response.status, 200);
  const stops = response.body.days?.[0]?.primary_route?.main_stops;
  const kept = stops?.find(stop => stop.id === 'osm-node-100');
  assert.ok(kept);
  assert.ok(!kept.covered_preferences.includes('bakeries'));
  assert.ok(stops.some(stop => stop.covered_preferences.includes('bakeries')));
});
