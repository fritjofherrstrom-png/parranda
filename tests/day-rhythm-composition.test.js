const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { requestJson, mockStableWeatherFetch } = require('./helpers/planner-reservoir-compare');

// Independent source-owned evidence; not live supply in any reported city.
function supply(count = 6, corroborated = true) {
  return Array.from({ length: count }, (_, i) => {
    const lat = 55.6 + i * 0.003, lng = 13;
    const name = `Fixture Reuse ${i}`;
    const mapped = mapOsmElement({ type: 'node', id: 9700 + i, lat, lon: lng,
      tags: { name, shop: 'second_hand', opening_hours: 'Mo-Su 10:00-18:00' } });
    return corroborated ? [mapped, { id: `directory-${i}`, name, type: 'vintage-shop', lat, lng,
      sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred',
        url: `https://directory.example/store/${i}` }] }] : [mapped];
  }).flat();
}

async function compareRhythms(rows) {
  const { buildAnywherePayload } = await import('../frontend/src/lib/anywhere-payload.mjs');
  const originalFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: async () => rows,
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 20,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
    clock: () => new Date('2026-10-01T08:00:00Z'),
  }).listen(0);
  try {
    const routes = {};
    for (const rhythm of ['calm', 'balanced', 'full', 'free']) {
      const body = buildAnywherePayload({ coords: { lat: 55.6, lng: 13 }, dates: ['2026-10-08'],
        preferences: ['second_hand'], dayRhythm: rhythm });
      assert.equal(body.walking_km_target, undefined);
      const response = await requestJson(server, { path: '/api/route-recommendations?lang=en', body });
      assert.equal(response.status, 200);
      routes[rhythm] = response.body.days[0]?.primary_route;
      assert.ok(routes[rhythm], `${rhythm}: a viable day must be published`);
      assert.ok(Number.isFinite(routes[rhythm].estimated_km));
      assert.ok(routes[rhythm].main_stops.every(stop => /Fixture Reuse/.test(stop.name || stop.label)));
    }
    console.log('rhythm replay', JSON.stringify(Object.fromEntries(Object.entries(routes).map(([key, route]) =>
      [key, { profile: route.day_profile, ids: route.main_stops.map(stop => stop.id), km: route.estimated_km }]))));
    return routes;
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    global.fetch = originalFetch;
  }
}

test('modern rhythm changes actual composed density with sufficient shared-gate supply', async () => {
  const routes = await compareRhythms(supply());
  assert.deepEqual(Object.fromEntries(Object.entries(routes).map(([rhythm, route]) =>
    [rhythm, { profile: route.day_profile, stops: route.main_stops.length }])), {
    calm: { profile: 'light', stops: 4 },
    balanced: { profile: 'variation', stops: 5 },
    full: { profile: 'peak', stops: 6 },
    free: { profile: 'peak', stops: 6 },
  });
  assert.ok(routes.calm.main_stops.length < routes.balanced.main_stops.length,
    'calm must not be refilled toward an unrequested walking target');
  assert.ok(routes.balanced.main_stops.length < routes.full.main_stops.length,
    'balanced and full must differ when six eligible same-interest options exist');
  assert.deepEqual(routes.free.main_stops.map(stop => stop.id), routes.full.main_stops.map(stop => stop.id));
});

test('scarce two-stop supply stays honest for every rhythm', async () => {
  const routes = await compareRhythms(supply(2));
  for (const route of Object.values(routes)) assert.equal(route.main_stops.length, 2);
});

test('uncorroborated supply is not multiplied to fill a full rhythm day', async () => {
  const routes = await compareRhythms(supply(6, false));
  for (const route of Object.values(routes)) assert.ok(route.main_stops.length <= 2);
});
