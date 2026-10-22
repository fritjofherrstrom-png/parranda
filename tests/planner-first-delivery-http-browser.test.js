"use strict";
// Built UI -> real HTTP/lifecycle -> real directory normalizer -> composer.
// Isolated empty cache, controlled providers/resolver/weather/clock. No product
// API interception, actual external providers, public cache or Pi acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createOvertureSource } = require('../server/place-candidates/overture-source');
const { createOvertureBackgroundSource, composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');

test('one cold built-UI submission renders its actual day while the original map request remains outstanding', { timeout: 35000 }, async t => {
  const anchor = { lat: 48.5, lng: 8.5 };
  let finishMap, finishDirectory, mapFinished = false, queries = 0, mapCalls = 0;
  const mapWork = new Promise(resolve => { finishMap = resolve; });
  const directoryWork = new Promise(resolve => { finishDirectory = resolve; });
  const source = createOvertureSource({ releaseResolver: async () => '2026-08-19.0', queryRows: async () => {
    queries++; await directoryWork;
    return Array.from({ length: 21 }, (_, i) => ({
      id: `20000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      name: `Source-owned ${i < 12 ? 'museum' : i < 17 ? 'restaurant' : 'park'} ${i}`,
      category: i < 12 ? 'museum' : i < 17 ? 'restaurant' : 'park',
      category_hierarchy: [i < 12 ? 'museum' : i < 17 ? 'restaurant' : 'park'],
      confidence: .99, operating_status: 'open', licenses: ['CC0-1.0'],
      lat: anchor.lat + i * .0003, lng: anchor.lng + (i % 2) * .001,
    }));
  } });
  const cache = createSourceCache();
  const directory = createOvertureBackgroundSource({ source, cache });
  assert.equal(cache.peek(source.cacheKeyFor(anchor)), null, 'known isolated cold cache, not inferred from HTTP status');
  const loader = composeOpenDataLoaders(async () => {
    mapCalls++; const rows = await mapWork; mapFinished = true; return rows;
  }, null, directory);
  const clock = Object.assign(() => new Date('2026-10-17T08:00:00Z'), { now: () => '2026-10-17T08:00:00Z' });
  const server = buildApp({ openDataLoader: loader, placeSuggestions: null, eventSupply: null,
    sourceCatalog: null, reviewedPlaceSource: null, clock,
    placeResolver: async () => [{ ...anchor, label: 'Controlled place', confidence: 'high', provenance: { provider: 'controlled' } }],
    weatherProvider: async () => ({ condition: 'sun',
      timezone_resolution: { timezone: 'Europe/Berlin', timezone_source: 'weather_provider_auto' } }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { finishMap([]); finishDirectory(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ timezoneId: 'Europe/Berlin' });
  await context.route(url => url.origin !== origin, route => route.abort());
  const page = await context.newPage(), errors = [], posts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/route-recommendations') posts.push(request.postDataJSON());
  });
  await page.clock.setFixedTime(new Date('2026-10-17T08:00:00Z'));
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/route-recommendations');
  await page.goto(`${origin}/anywhere?place=Controlled%20place&prefs=culture&day=1&rhythm=balanced&lang=en`);
  const response = await pending;
  assert.equal(response.status(), 202, 'the captured cold producer acknowledges without waiting for either source');
  const token = (await response.json()).planner_lifecycle.token;
  assert.equal(mapFinished, false); assert.equal(queries, 1); assert.equal(mapCalls, 1);
  const final = page.waitForResponse(r => new URL(r.url()).pathname === '/api/planner-status' && r.status() === 200);
  finishDirectory();
  const body = await (await final).json();
  const stops = body.days?.[0]?.primary_route?.main_stops || [];
  assert.equal(stops.length, 5, 'actual balanced Culture day, not a candidate counter');
  assert.equal(mapFinished, false, 'publication does not await the outstanding map timeout');
  assert.ok(stops.every(stop => stop.id.startsWith('overture-20000000-') && stop.type === 'museum'));
  assert.equal(body.agnostic_route_output_experiment.walking_validation.valid, true);
  assert.equal(body.agnostic_route_output_experiment.source_status.collection.primary_collection, 'background_refresh');
  const names = stops.map(stop => stop.label || stop.name);
  await page.waitForFunction(expected => {
    const rows = [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button')];
    return rows.length === expected.length && rows.every((row, i) => row.textContent.includes(expected[i]));
  }, names);
  assert.equal(posts.length, 1, 'status polls cannot create another composition');
  const before = await page.locator('ol[aria-label="The stops, in order"]').innerText();
  finishMap(Object.assign([], { loader_status: 'error_failed_closed', loader_error: 'controlled_map_timeout' }));
  await new Promise(resolve => setImmediate(resolve));
  const retained = await fetch(origin + '/api/planner-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.deepEqual((await retained.json()).days, body.days, 'a late primary failure cannot mutate the published day');
  assert.equal(await page.locator('ol[aria-label="The stops, in order"]').innerText(), before);
  assert.equal(queries, 1); assert.equal(mapCalls, 1); assert.deepEqual(errors, []);
});
