'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { requestJson, mockStableWeatherFetch } = require('./helpers/planner-reservoir-compare');

const ANCHOR = { lat: 55.6, lng: 13 };
const DATE = '2026-10-08';

// Four equally evidenced useful places form a compact cluster. Two same-role
// alternatives lie farther away. An internal 6km fallback must not persuade a
// rhythm request with no kilometre goal to replace a compact choice with one.
function supply() {
  return [0, 0.001, 0.002, 0.003, 0.020, 0.027].flatMap((delta, i) => {
    const lat = ANCHOR.lat + delta, lng = ANCHOR.lng, name = `Fixture Reuse ${i}`;
    return [mapOsmElement({ type: 'node', id: 9900 + i, lat, lon: lng,
      tags: { name, shop: 'second_hand', opening_hours: 'Mo-Su 10:00-18:00' } }),
    { id: `directory-${i}`, name, type: 'vintage-shop', lat, lng,
      sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred',
        url: `https://directory.example/store/${i}` }] }];
  });
}

async function withPlanner(rows, run) {
  const { buildAnywherePayload } = await import('../frontend/src/lib/anywhere-payload.mjs');
  const originalFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: async () => rows,
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 20,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
    clock: () => new Date('2026-10-01T08:00:00Z'),
  }).listen(0);
  const request = async (dayRhythm, extra = {}) => {
    const body = { ...buildAnywherePayload({ coords: ANCHOR, dates: [DATE],
      preferences: ['second_hand'], dayRhythm }), ...extra };
    const response = await requestJson(server, { path: '/api/route-recommendations?lang=en', body });
    assert.equal(response.status, 200);
    const route = response.body.days[0]?.primary_route;
    assert.ok(route, 'usable fixture supply must publish a day through real handlers');
    return { body, result: response.body, route };
  };
  try { await run(request); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    global.fetch = originalFetch;
  }
}

test('Relaxed publishes four compact relevant stops rather than stretching toward an unrequested kilometre goal', async () => {
  await withPlanner(supply(), async request => {
    const { body, route } = await request('calm');
    assert.equal(body.walking_km_target, undefined);
    assert.deepEqual(route.main_stops.map(stop => stop.id).sort(),
      ['directory-0', 'directory-1', 'directory-2', 'directory-3']);
    assert.ok(route.estimated_km < 1.2, `compact four-stop chain should stay short, got ${route.estimated_km}km`);
    assert.ok(route.longest_leg_km < 0.6, `compact choices avoid a long hop, got ${route.longest_leg_km}km`);
  });
});

test('rhythm keeps 4/5/6 useful stops while the denser fixture days can walk farther', async () => {
  await withPlanner(supply(), async request => {
    const calm = (await request('calm')).route;
    const balanced = (await request('balanced')).route;
    const full = (await request('full')).route;
    assert.deepEqual([calm.main_stops.length, balanced.main_stops.length, full.main_stops.length], [4, 5, 6]);
    assert.ok(calm.estimated_km < balanced.estimated_km);
    assert.ok(balanced.estimated_km < full.estimated_km);
    assert.ok(calm.longest_leg_km < balanced.longest_leg_km);
    assert.ok(full.main_stops.every(stop => stop.type === 'vintage-shop'));
  });
});

test('an explicit legacy kilometre request still uses relevant farther supply', async () => {
  await withPlanner(supply(), async request => {
    const { route } = await request('calm', {
      day_rhythm: undefined, walking_km_target: 6, distance_mode: 'soft_target',
    });
    assert.ok(route.estimated_km >= 3.6, `a real 6km request should not collapse to the compact cluster: ${route.estimated_km}`);
    assert.ok(route.main_stops.some(stop => ['directory-4', 'directory-5'].includes(stop.id)));
  });
});

test('compactness cannot buy a closed, wrong-interest or unattributed nearby place', async () => {
  const extra = (id, overrides) => ({
    id, name: id, type: 'vintage-shop', lat: ANCHOR.lat + 0.0001, lng: ANCHOR.lng,
    sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred',
      url: `https://directory.example/store/${id}` }], ...overrides,
  });
  const rows = [...supply(),
    extra('closed-near', { opening_hours: 'Mo-Su off' }),
    extra('coffee-near', { type: 'cafe' }),
    extra('no-evidence-near', { sources: [] }),
    extra('knowledge-only-near', { sources: [{ provider: 'wikidata', family: 'open_knowledge',
      tier: 'inferred', url: 'https://www.wikidata.org/wiki/Q9990001' }] }),
  ];
  await withPlanner(rows, async request => {
    const { route } = await request('calm');
    assert.deepEqual(route.main_stops.map(stop => stop.id).sort(),
      ['directory-0', 'directory-1', 'directory-2', 'directory-3']);
    assert.equal(route.main_stops.length, 4);
    assert.ok(route.main_stops.every(stop => stop.trust.human_verified === false));
  });
});

test('a usable farther Keep remains an explicit choice through repeated Relaxed composition', async () => {
  await withPlanner(supply(), async request => {
    const extra = { pinned_candidate_ids: ['directory-5'] };
    const first = (await request('calm', extra)).route;
    const replayed = (await request('calm', extra)).route;
    assert.ok(first.main_stops.some(stop => stop.id === 'directory-5'));
    // Existing Keep semantics append an admitted missing identity; this is an
    // explicit extra choice, unlike automatic stretching of a four-stop day.
    assert.deepEqual(first.main_stops.map(stop => stop.id).sort(),
      ['directory-0', 'directory-1', 'directory-2', 'directory-3', 'directory-5']);
    assert.ok(first.estimated_km > 1.2, 'an honoured farther choice must retain its honest walking cost');
    assert.deepEqual(replayed.main_stops.map(stop => stop.id), first.main_stops.map(stop => stop.id));
    assert.equal(replayed.estimated_km, first.estimated_km);
  });
});
