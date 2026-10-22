const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { mapOvertureRow } = require('../server/place-candidates/overture-source');
const { requestJson, mockStableWeatherFetch } = require('./helpers/planner-reservoir-compare');

// These expectations come from source atoms, not a name, preference or prose.
test('a detailed place kind comes only from the source primary category', () => {
  const row = { id: '06d8f8c3-fb2b-4680-a518-8df6bf53c0b9', name: 'Fixture Shop',
    category: 'second_hand_clothing_store', category_hierarchy: ['second_hand_clothing_store'],
    confidence: 0.998, operating_status: 'open', lat: 55.6, lng: 13,
    licenses: ['CDLA-Permissive-2.0'] };
  assert.equal(mapOvertureRow(row).place_details?.kind, 'second_hand_clothing');
  assert.equal(mapOvertureRow({ ...row, category: 'second_hand_store',
    category_hierarchy: ['second_hand_store'], alternate: ['second_hand_clothing_store'] }).place_details, undefined,
  'a broad second-hand category cannot claim a clothes assortment');
});

async function publishedStops(payloadExtras = {}) {
  const rows = Array.from({ length: 4 }, (_, i) => {
    const mapped = mapOsmElement({ type: 'node', id: 99700 + i,
      lat: 55.6 + i * 0.001, lon: 13, tags: { name: `Fixture Antiques ${i}`, shop: 'antiques',
        'addr:street': 'Fixture Street', 'addr:housenumber': String(10 + i), opening_hours: 'Mo-Su 09:00-20:00' } });
    return [mapped, { id: `directory-fixture-${i}`, name: mapped.name, type: 'vintage-shop', lat: mapped.lat, lng: mapped.lng,
      sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred', url: `https://directory.example/${i}` }] }];
  }).flat();
  const { buildAnywherePayload } = await import('../frontend/src/lib/anywhere-payload.mjs');
  const prior = global.fetch;
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: async () => rows,
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 20,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
    clock: () => new Date('2026-10-01T08:00:00Z') }).listen(0);
  try {
    const body = { ...buildAnywherePayload({ coords: { lat: 55.6, lng: 13 }, dates: ['2026-10-08'],
      preferences: ['second_hand'], dayRhythm: 'calm' }), ...payloadExtras };
    const response = await requestJson(server, { path: '/api/route-recommendations?lang=en', body });
    assert.equal(response.status, 200);
    const stops = response.body.days[0]?.primary_route?.main_stops;
    assert.equal(stops?.length, 4);
    return stops;
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    global.fetch = prior;
  }
}

test('source-owned kind and branch address survive actual HTTP composition and publication', async () => {
  const stops = await publishedStops();
  for (const stop of stops) {
    const i = Number(stop.label.match(/(\d+)$/)[1]);
    assert.deepEqual(stop.place_details, { kind: 'antiques', address: `Fixture Street ${10 + i}` });
    assert.equal(stop.summary, null, 'category facts do not manufacture a place description');
  }
});

test('public payload cannot replace source place details', async () => {
  const stops = await publishedStops({ place_details: { kind: 'art_museum', address: 'Injected address', description: 'Invented' } });
  assert.ok(stops.every(stop => stop.place_details?.kind === 'antiques'));
  assert.ok(stops.every(stop => !JSON.stringify(stop.place_details).includes('Injected')));
});
