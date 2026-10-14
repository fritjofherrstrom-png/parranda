"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { createOpenDataLoader, buildOverpassQuery, mapOsmElement, mapOverpassResponse } = require('../server/place-candidates/open-data-loader');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createPlaceSelectionStore } = require('../server/place-candidates/place-selection');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const { evaluateOpeningHoursForWindow } = require('../server/place-candidates/opening-hours');
const { deriveSecondaryAnchors, spatialScopeCacheKey } = require('../server/place-candidates/spatial-scope');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');

const anchor = { lat: 55.6, lng: 13 };
const futureWindow = { weekday: 4, startMinute: 0, endMinute: 1440 };
function rawPool({ center = anchor, closedHours = 'Mo-Su off', cafeHours = 'Mo-Su 09:00-22:00' } = {}) {
  const node = (id, amenity, offset, hours) => ({
    type: 'node', id, lat: center.lat + offset, lon: center.lng,
    tags: { name: `Fixture ${amenity} ${id}`, amenity, wikidata: `Q${id}`,
      ...(hours === undefined ? {} : { opening_hours: hours }) },
  });
  // Eight query categories, ceil(150 / 8) = 19 rows/category; not an
  // impossible response whose dense category silently exceeds the source cap.
  return [
    ...Array.from({ length: 19 }, (_, i) => node(10000 + i, 'restaurant', .00001 * i, closedHours)),
    ...Array.from({ length: 7 }, (_, i) => node(20000 + i, 'cafe', .001 + .00001 * i, closedHours)),
    ...Array.from({ length: 12 }, (_, i) => node(30000 + i, 'cafe', .005 + .0005 * i, cafeHours)),
  ];
}
function availableCount(rows, window) {
  return rows.filter(row => evaluateOpeningHoursForWindow(row.opening_hours, window).status === 'available_in_window').length;
}
async function withApi({ pool = rawPool(), timezone = 'Europe/Stockholm', clock = () => new Date('2026-10-14T08:00:00Z'), weather = null } = {}, run) {
  const acquisition = [], queries = [], sequence = [];
  const loader = createOpenDataLoader({ cache: createSourceCache(), fetcher: async (_url, options) => {
    sequence.push('source');
    queries.push(new URLSearchParams(options.body).get('data'));
    return { ok: true, json: async () => ({ elements: pool }) };
  } });
  const wrapped = async function (request) {
    const rows = await Reflect.apply(loader, this, [request]);
    acquisition.push({ request, rows });
    return rows;
  };
  // Observation must not disable cache/progress capabilities on the real path.
  Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(loader));
  const server = buildApp({
    openDataLoader: wrapped,
    placeResolver: async () => [{ label: 'Fixture town', ...anchor, confidence: 'medium', provenance: 'test_resolver', ...(timezone ? { timezone } : {}) }],
    placeSelectionStore: createPlaceSelectionStore({ cacheDir: null }), placeSuggestions: null,
    sourceCatalog: null, reviewedPlaceSource: null, eventSupply: null,
    weatherProvider: async () => { sequence.push('weather'); return weather; }, clock,
  }).listen(0, '127.0.0.1');
  try {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const post = (body = {}) => requestJson(server, { path: '/api/route-recommendations?lang=en', body: {
      place: 'Fixture town', dates: ['2026-10-22'], preferences: ['food'], day_rhythm: 'full',
      include_external_candidates: 1, experimental_agnostic_route_output: 1, agnostic_engine_compose: 1,
      ...body,
    } });
    return await run({ post, acquisition, queries, sequence });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
function assertPartialFoodRoute(response) {
  const route = response.body.days[0]?.primary_route;
  assert.ok(route?.main_stops.length >= 5, 'publish at least the baseline partial-food depth instead of losing it before gates');
  assert.ok(route.main_stops.every(stop => stop.type === 'cafe' && stop.partial_preferences.includes('food') && !stop.covered_preferences.includes('food')));
  assert.equal(route.trust_summary.human_verified, false);
  assert.equal(response.body.agnostic_route_output_experiment.walking_validation.valid, true);
  assert.equal(response.body.agnostic_route_output_experiment.promotion.promote, true);
  assert.equal(route.legs.length, route.map_route_points.length - 1);
  assert.ok(Number.isFinite(route.estimated_km));
  assert.ok(route.main_stops.every(stop => stop.selected_day_hours?.windows?.[0]?.closes === '22:00'));
}

test('HTTP intake preserves available partial-food depth before the source cap using only resolver-attested time', async () => {
  await withApi({}, async ({ post, acquisition, queries, sequence }) => {
    const response = await post({
      // None of these public claims may affect the source cut or final gate.
      timezone: 'Pacific/Honolulu', trustedTimezone: 'Pacific/Honolulu',
      availabilityWindow: { weekday: 0, startMinute: 0, endMinute: 1 },
      clock: '2030-01-01T00:00:00Z', now: '2030-01-01T00:00:00Z',
    });
    assert.equal(response.status, 200);
    assert.equal(queries.length, 1, 'same single provider acquisition, not an availability retry');
    assert.equal(queries[0], buildOverpassQuery({ ...anchor, radiusM: 5000, limit: 150 }));
    assert.ok(acquisition.length >= 2, 'exercise both structure and route acquisition boundaries');
    assert.ok(acquisition.every(({ rows }) => rows.length === 25), 'unchanged source cap');
    console.log(JSON.stringify({ case: 'http-partial-food', providerCalls: queries.length,
      sourceWindows: acquisition.map(({ request }) => request.availabilityWindow ?? null),
      acquiredOpen: acquisition.map(({ rows }) => availableCount(rows, futureWindow)),
      publishedStops: response.body.days[0]?.primary_route?.main_stops.length ?? 0 }));
    assertPartialFoodRoute(response);
    for (const { request } of acquisition) assert.deepEqual(request.availabilityWindow, futureWindow);
    assert.deepEqual(sequence, ['source', 'weather'], 'weather remains after acquisition, not moved before empty/blocked decisions');
    assert.equal(response.body.agnostic_route_output_experiment.context.time.timezone, 'Europe/Stockholm');
  });
});

test('regional partition retains available partial-food rows inside the unchanged per-cluster cap', async () => {
  const scope = { source: 'test_resolver', kind: 'region', bounds: { south: 55.3, north: 55.9, west: 12.85, east: 13.15 } };
  const secondary = deriveSecondaryAnchors(scope, anchor)[0];
  const queries = [];
  const loader = createOpenDataLoader({ fetcher: async (_url, options) => {
    queries.push(new URLSearchParams(options.body).get('data'));
    return { ok: true, json: async () => ({ elements: queries.length === 1 ? [] : rawPool({ center: secondary }) }) };
  } });
  const rows = await loader({ ...anchor, requestedIntents: ['food'], dayRhythm: 'full', anchorMode: 'place',
    spatialScope: scope, availabilityWindow: futureWindow });
  assert.equal(queries.length, 2, 'one primary and one bounded regional query, no retry/extra radius');
  assert.equal(queries[0], buildOverpassQuery({ ...anchor, radiusM: 5000, limit: 150 }));
  assert.ok(queries[1].includes(`around:3000,${secondary.lat},${secondary.lng}`));
  assert.deepEqual([...queries[1].matchAll(/out center (\d+);/g)].map(match => Number(match[1])), Array(8).fill(19));
  assert.equal(rows.length, 25);
  console.log(JSON.stringify({ case: 'regional-partial-food', providerCalls: queries.length,
    selectedAnchor: rows.loader_metadata?.regional_scout?.selected_anchor,
    acquiredOpen: availableCount(rows, futureWindow), acquired: rows.length }));
  assert.equal(availableCount(rows, futureWindow), 12, 'the supplied window must reach each regional partition before its source cut');
  assert.equal(rows.loader_metadata.regional_scout.selected_anchor, secondary.id);
  assert.ok(rows.every(row => Math.abs(row.lat - secondary.lat) < .02), 'never mix primary and secondary clusters');
});

test('HTTP without an acquisition timezone preserves partial fits for the existing late weather-timezone gate', async () => {
  await withApi({ timezone: null, weather: { timezone_resolution: { timezone: 'Europe/Stockholm' } } },
    async ({ post, acquisition, queries, sequence }) => {
      const response = await post({ timezone: 'Europe/Stockholm', trustedTimezone: 'Europe/Stockholm',
        availabilityWindow: futureWindow });
      assert.equal(response.status, 200);
      assert.equal(queries.length, 1);
      assert.ok(acquisition.every(({ request }) => request.availabilityWindow == null), 'public timezone/window cannot become source authority');
      console.log(JSON.stringify({ case: 'late-weather-timezone', sourceWindows: acquisition.map(({ request }) => request.availabilityWindow),
        acquiredOpen: acquisition.map(({ rows }) => availableCount(rows, futureWindow)),
        publishedStops: response.body.days[0]?.primary_route?.main_stops.length ?? 0 }));
      assertPartialFoodRoute(response);
      assert.deepEqual(sequence, ['source', 'weather']);
      assert.equal(response.body.agnostic_route_output_experiment.context.time.timezone_source, 'weather_provider_auto');
    });
});

test('cached cuts from the regressed policy cannot hide the corrected primary or regional supply', async () => {
  for (const [regional, dayRhythm] of [[false, 'full'], [true, 'full'], [true, null]]) {
    const scope = regional ? { source: 'test_resolver', kind: 'region', bounds: { south: 55.3, north: 55.9, west: 12.85, east: 13.15 } } : null;
    const center = regional ? deriveSecondaryAnchors(scope, anchor)[0] : anchor;
    const window = regional ? futureWindow : null;
    const request = { ...anchor, requestedIntents: ['food'], dayRhythm, anchorMode: 'place', spatialScope: scope, availabilityWindow: window };
    const cache = createSourceCache();
    const oldKey = `${dayRhythm ? 'v10' : 'v9'}:55.600,13.000:r${dayRhythm ? 5 : 1.5}:w${window ? '4.0.1440' : 'none'}:l25:mplace:ifood:tnone:s${spatialScopeCacheKey(scope)}`;
    const brokenRows = dayRhythm
      ? rawPool({ center }).filter(row => row.id < 30000).slice(0, 25).map(mapOsmElement)
      : mapOverpassResponse({ elements: rawPool({ center }) }, 25, { origin: center });
    cache.set(oldKey, { records: brokenRows, status: 'loaded:25', error: null, metadata: null });
    let calls = 0;
    const loader = createOpenDataLoader({ cache, fetcher: async () => {
      calls++;
      return { ok: true, json: async () => ({ elements: regional && calls < (dayRhythm ? 2 : 3) ? [] : rawPool({ center }) }) };
    } });
    const rows = await loader(request);
    assert.equal(availableCount(rows, futureWindow), regional ? 12 : 5, 'invalidate old source cuts, not the cache contract');
    const beforeRepeat = calls;
    assert.equal(beforeRepeat, regional ? (dayRhythm ? 2 : 3) : 1);
    assert.deepEqual((await loader(request)).map(row => row.id), rows.map(row => row.id));
    assert.equal(calls, beforeRepeat, 'repeat the corrected exact identity without another transport');
  }
});

test('HTTP selected weekday closure reaches acquisition while an open next day keeps strong food depth', async () => {
  await withApi({ pool: rawPool({ closedHours: 'Mo-We 09:00-22:00; Th off; Fr-Su 09:00-22:00' }) },
    async ({ post, acquisition, queries }) => {
      const thursday = await post();
      assertPartialFoodRoute(thursday);
      assert.ok(acquisition.every(({ rows }) => availableCount(rows, futureWindow) === 12));
      const friday = await post({ dates: ['2026-10-23'] });
      assert.equal(friday.status, 200);
      assert.equal(queries.length, 2, 'another selected weekday gets its own cut, not a bigger query budget');
      assert.ok(friday.body.days[0]?.primary_route?.main_stops.length >= 5);
      assert.ok(friday.body.days[0].primary_route.main_stops.every(stop => stop.type === 'restaurant' && stop.covered_preferences.includes('food')));
      assert.equal(friday.body.agnostic_route_output_experiment.context.time.status, 'selected_date_unanchored');
      await post({ dates: ['2026-10-23'] });
      assert.equal(queries.length, 2, 'same selected day is a warm cache hit');
    });
});

test('HTTP today excludes time-limited strong matches already closed in the remaining local day', async () => {
  await withApi({ pool: rawPool({ closedHours: 'Mo-Su 06:00-09:00' }), clock: () => new Date('2026-10-14T15:00:00Z') },
    async ({ post, acquisition, queries }) => {
      const response = await post({ dates: ['2026-10-14'] });
      assertPartialFoodRoute(response);
      for (const { request, rows } of acquisition) {
        assert.deepEqual(request.availabilityWindow, { weekday: 3, startMinute: 1020, endMinute: 1440 });
        assert.equal(availableCount(rows, request.availabilityWindow), 12);
      }
      assert.equal(queries.length, 1);
    });
});

test('regional day/time-limited closures use the supplied window in either partition', async () => {
  const scope = { source: 'test_resolver', kind: 'region', bounds: { south: 55.3, north: 55.9, west: 12.85, east: 13.15 } };
  for (const center of deriveSecondaryAnchors(scope, anchor)) {
    let calls = 0;
    const window = { weekday: 4, startMinute: 1020, endMinute: 1440 };
    const loader = createOpenDataLoader({ fetcher: async () => {
      calls++;
      return { ok: true, json: async () => ({ elements: calls === 1 ? [] : rawPool({ center,
        closedHours: 'Th 06:00-09:00; Fr-Su 09:00-22:00', cafeHours: 'Th 17:00-22:00' }) }) };
    } });
    const rows = await loader({ ...anchor, requestedIntents: ['food'], dayRhythm: 'full', anchorMode: 'place', spatialScope: scope, availabilityWindow: window });
    assert.equal(calls, 2);
    assert.equal(rows.length, 25);
    assert.equal(availableCount(rows, window), 12);
    assert.equal(rows.loader_metadata.regional_scout.selected_anchor, center.id);
    assert.ok(rows.every(row => Math.abs(row.lat - center.lat) < .02));
  }
});

for (const cafeHours of [null, 'Mo-Su 09:00-22:00; PH off']) {
  test(`HTTP preserves ${cafeHours === null ? 'missing' : 'unsupported'} hours as unknown partial fits, never invented opening facts`, async () => {
    await withApi({ pool: rawPool({ cafeHours }) }, async ({ post, acquisition, queries }) => {
      const response = await post();
      assert.equal(response.status, 200);
      const stops = response.body.days[0]?.primary_route?.main_stops;
      assert.ok(stops?.length >= 5);
      assert.ok(stops.every(stop => stop.type === 'cafe' && stop.partial_preferences.includes('food') && !stop.covered_preferences.includes('food')));
      assert.ok(stops.every(stop => stop.selected_day_hours == null && !('opening_hours' in stop)));
      for (const { rows } of acquisition) assert.equal(rows.filter(row => row.id.startsWith('osm-node-3')).length, 12);
      assert.equal(queries.length, 1);
    });
  });
}

test('HTTP with no trusted timezone at any stage keeps context unknown and does not erase possible partial fits', async () => {
  await withApi({ timezone: null }, async ({ post, acquisition, queries }) => {
    const response = await post({ timezone: 'Europe/Stockholm', trustedTimezone: 'Europe/Stockholm', availabilityWindow: futureWindow });
    assert.equal(response.status, 200);
    assert.equal(queries.length, 1);
    assert.ok(acquisition.every(({ request, rows }) => request.availabilityWindow == null && availableCount(rows, futureWindow) >= 5));
    const ctx = response.body.agnostic_route_output_experiment.context;
    assert.equal(ctx.time.timezone_known, false);
    assert.equal(ctx.time.status, 'timezone_unavailable');
    assert.equal(ctx.time.now, null);
    assert.equal(ctx.influence.time_fed_into_selection, false);
    const stops = response.body.days[0]?.primary_route?.main_stops;
    assert.ok(stops?.length >= 2);
    assert.ok(stops.every(stop => stop.selected_day_hours == null && !('opening_hours' in stop)));
  });
});

test('HTTP shares one clock sample across structure, route and late context at minute/local-midnight boundaries', async () => {
  for (const firstInstant of ['2026-10-14T15:59:59Z', '2026-10-14T21:59:59Z']) {
    let reads = 0;
    const clock = () => ++reads === 1 ? new Date(firstInstant) : new Date('2026-10-15T00:00:00Z');
    await withApi({ pool: rawPool({ cafeHours: '24/7' }), clock }, async ({ post, acquisition, queries }) => {
      const response = await post({ dates: ['2026-10-14'] });
      assert.equal(response.status, 200);
      assert.equal(reads, 1, 'cache identity and final availability cannot sample a second moment');
      assert.equal(queries.length, 1);
      const startMinute = firstInstant.includes('15:59') ? 1079 : 1439;
      for (const { request } of acquisition) assert.deepEqual(request.availabilityWindow, { weekday: 3, startMinute, endMinute: 1440 });
      assert.equal(response.body.agnostic_route_output_experiment.context.time.now, `2026-10-14T${startMinute === 1079 ? '17:59' : '23:59'}:00`);
    });
  }
});

test('HTTP blocked and healthy-empty source paths never fetch weather to manufacture an early window', async () => {
  await withApi({}, async ({ post, queries, sequence }) => {
    await post({ include_external_candidates: 0 });
    assert.equal(queries.length, 0);
    assert.deepEqual(sequence, []);
  });
  await withApi({ pool: [] }, async ({ post, queries, sequence }) => {
    const response = await post();
    assert.equal(response.status, 200);
    assert.equal(queries.length, 1);
    assert.deepEqual(sequence, ['source']);
  });
});

test('HTTP failed trusted clock remains unavailable across source cuts instead of retrying into another cache identity', async () => {
  let reads = 0;
  await withApi({ clock: () => {
    if (++reads === 1) throw new Error('fixture clock unavailable');
    return new Date('2026-10-14T08:00:00Z');
  } }, async ({ post, acquisition, queries }) => {
    const response = await post();
    assert.equal(response.status, 200);
    assert.equal(reads, 1, 'a failed sample must not become a second sampling attempt');
    assert.equal(queries.length, 1, 'one source identity even when trusted time is unavailable');
    assert.ok(acquisition.every(({ request }) => request.availabilityWindow == null));
    assert.equal(response.body.agnostic_route_output_experiment.context.time.now, null);
  });
});

test('retained composition reuses its original trusted window without clock/weather resampling', async () => {
  let calls = 0, snapshot, firstRequest, replayRequest, replayClockCalls = 0, replayWeatherCalls = 0;
  const source = createOpenDataLoader({ cache: createSourceCache(), fetcher: async () => {
    calls++;
    return { ok: true, json: async () => ({ elements: rawPool() }) };
  } });
  const args = { coords: anchor, baselineResult: { days: [] }, externalRequested: true,
    date: '2026-10-22', todayIsoDate: '2026-10-14', preferences: ['food'], dayRhythm: 'full', anchorMode: 'place',
    synthesizeVia: 'engine', distanceMode: 'no_limit', trustedTimezone: 'Europe/Stockholm',
    clock: () => new Date('2026-10-14T08:00:00Z'), weatherProvider: async () => null };
  const original = await composeAgnosticRouteOutput({ ...args,
    openDataLoader: async request => { firstRequest = request; return source(request); },
    onRetainComposition: value => { snapshot = value; } });
  const replay = await composeAgnosticRouteOutput({ ...args, retainedContext: snapshot.context,
    trustedTimezone: 'Pacific/Honolulu', clock: () => { replayClockCalls++; return new Date('2026-10-23T08:00:00Z'); },
    weatherProvider: async () => { replayWeatherCalls++; return null; },
    openDataLoader: async request => { replayRequest = request; return snapshot.records; } });
  assert.equal(calls, 1);
  assert.equal(replayClockCalls, 0);
  assert.equal(replayWeatherCalls, 0);
  assert.deepEqual(firstRequest.availabilityWindow, futureWindow);
  assert.deepEqual(replayRequest.availabilityWindow, futureWindow);
  assert.deepEqual(replay.experiment.context, original.experiment.context);
  assert.deepEqual(replay.result.days, original.result.days);
});

test('HTTP final pin and exclusion gates still apply to the preserved available partial-food pool', async () => {
  await withApi({}, async ({ post, queries }) => {
    const response = await post({ excluded_candidate_ids: ['osm-node-30000'], pinned_candidate_ids: ['osm-node-30011'] });
    assertPartialFoodRoute(response);
    const stops = response.body.days[0].primary_route.main_stops;
    assert.ok(stops.some(stop => stop.id === 'osm-node-30011'));
    assert.ok(stops.every(stop => stop.id !== 'osm-node-30000'));
    assert.equal(queries.length, 1);
  });
});
