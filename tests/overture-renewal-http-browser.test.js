'use strict';
// Built UI -> real HTTP handlers/lifecycle -> source acquisition/mapper ->
// receipt cache -> admission/composer. Only resolver, weather and external
// catalog/native boundaries are controlled; this is not live acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createOvertureSampleCache } = require('../server/place-candidates/overture-sample-cache');
const { createOvertureSource } = require('../server/place-candidates/overture-source');
const { createOvertureBackgroundSource, composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');
const anchor = { lat: 48.5, lng: 8.5 };
const date = '2026-10-17';
const initialRelease = '2026-09-23.1';
const asset = release => `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/part-00001-controlled.zstd.parquet`;

test('cold UI publishes actual catalog stops; expired unchanged, changed and failed refreshes obey source proof', { timeout: 45000 }, async t => {
  let clock = 1000, release = initialRelease, metadataFailure = false, queryCalls = 0, verifications = 0, unlock;
  const wait = new Promise(resolve => { unlock = resolve; });
  t.after(() => unlock());
  const source = createOvertureSource({ now: () => clock,
    releaseResolver: async () => release,
    assetResolver: async () => [asset(release)],
    assetVerifier: async paths => { verifications++; if (metadataFailure) throw new Error('controlled_offline');
      return paths.map(path => ({ path, etag: '"catalog-a"', length: 12000 })); },
    queryRows: async () => {
      queryCalls++; await wait;
      const rows = Array.from({ length: 8 }, (_, i) => ({
        id: `10000000-0000-0000-0000-${String(queryCalls * 100 + i).padStart(12, '0')}`,
        name: `Catalog museum ${queryCalls}-${i}`, category: 'museum', category_hierarchy: ['museum'],
        confidence: .99, operating_status: 'open', licenses: ['CC0-1.0'],
        lat: anchor.lat + i * .0009, lng: anchor.lng + (i % 2) * .001,
      }));
      Object.defineProperty(rows, 'source_assets', { value: [{ path: asset(release), etag: '"catalog-a"', length: 12000 }] });
      return rows;
    },
  });
  const raw = createSourceCache({ namespace: 'isolated-v6', ttlMs: 100, now: () => clock });
  const cache = createOvertureSampleCache({ cache: raw, now: () => clock, validateReceipt: source.validateReceipt });
  const directory = createOvertureBackgroundSource({ source, cache });
  const loader = composeOpenDataLoaders(async () => Object.assign([], {
    loader_status: 'error_failed_closed', loader_error: 'controlled_map_unavailable',
  }), null, directory);
  const server = buildApp({ openDataLoader: loader, placeSuggestions: null, eventSupply: null,
    sourceCatalog: null, reviewedPlaceSource: null, clock: () => new Date('2026-10-16T08:00:00Z'),
    placeResolver: async () => [{ ...anchor, label: 'Cataloghaven', confidence: 'high', provenance: { provider: 'controlled' } }],
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false,
      timezone_resolution: { timezone: 'Europe/Berlin', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ timezoneId: 'Europe/Berlin' });
  await context.route(url => url.origin !== origin, route => route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-16T08:00:00Z'));
  const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/route-recommendations');
  assert.equal(raw.inspect(source.cacheKeyFor(anchor)), null);
  await page.goto(`${origin}/anywhere?place=Cataloghaven&prefs=culture&day=1&rhythm=balanced&lang=en`);
  assert.equal((await pending).status(), 202, 'one cold submission owns a real pending source job');
  const final = page.waitForResponse(r => new URL(r.url()).pathname === '/api/planner-status' && r.status() === 200);
  unlock();
  const first = await (await final).json();
  const ids = first.days?.[0]?.primary_route?.main_stops?.map(stop => stop.id);
  assert.equal(ids?.length, 5);
  assert.ok(ids.every(id => id.startsWith('overture-10000000-0000-0000-0000-0000000001')));
  const names = first.days[0].primary_route.main_stops.map(stop => stop.label || stop.name);
  await page.waitForFunction(expected => {
    const rendered = [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button')];
    return rendered.length === expected.length && expected.every((name, i) => rendered[i].textContent.includes(name));
  }, names);
  assert.equal(first.agnostic_route_output_experiment.walking_validation.valid, true);
  assert.equal(queryCalls, 1);
  assert.ok(raw.inspect(source.cacheKeyFor(anchor)).value.receipt.assets.length);

  const input = { place: 'Cataloghaven', dates: [date], preferences: ['culture'], day_rhythm: 'balanced',
    agnostic_engine_compose: true, experimental_agnostic_route_output: true, include_external_candidates: true };
  async function request(body = input, pathname = '/api/route-recommendations') {
    const response = await fetch(origin + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'respond-async' }, body: JSON.stringify(body) });
    let result = { status: response.status, body: await response.json() };
    if (result.status === 202) {
      const token = result.body.planner_lifecycle.token;
      for (let i = 0; i < 20 && result.status === 202; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        const poll = await fetch(origin + '/api/planner-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        result = { status: poll.status, body: await poll.json() };
      }
    }
    assert.equal(result.status, 200); return result.body;
  }
  clock = 1200;
  const unchanged = await request();
  assert.deepEqual(unchanged.days[0].primary_route.main_stops.map(stop => stop.id), ids);
  assert.equal(queryCalls, 1); assert.equal(verifications, 1);
  const retained = raw.inspect(source.cacheKeyFor(anchor));
  assert.equal(retained.value.receipt.acquiredAt, 1000);
  assert.equal(retained.value.receipt.verifiedAt, 1200);

  clock = 1400; release = '2026-10-21.0';
  const changed = await request();
  assert.equal(queryCalls, 2);
  assert.equal(changed.days[0].primary_route.main_stops.length, 5);
  assert.ok(changed.days[0].primary_route.main_stops.every(stop => !ids.includes(stop.id)));
  assert.equal(raw.inspect(source.cacheKeyFor(anchor)).value.receipt.release, release);
  const beforeFailure = raw.inspect(source.cacheKeyFor(anchor));
  clock = 1600; metadataFailure = true;
  const failed = await request();
  assert.ok(!failed.days?.some(day => day.primary_route), 'expired old rows cannot become a fresh route after a failed verifier');
  assert.equal(queryCalls, 2); assert.equal(verifications, 2);
  assert.equal(cache.peek(source.cacheKeyFor(anchor)), null);
  assert.equal(raw.inspect(source.cacheKeyFor(anchor)).expiresAt, beforeFailure.expiresAt);
  assert.equal(failed.agnostic_route_output_experiment.source_status.error, 'controlled_map_unavailable');
  assert.deepEqual(errors, []);
  t.diagnostic(JSON.stringify({ controlled: true, coldStops: ids.length, unchangedBulkQueries: 0,
    changedReleaseStops: changed.days[0].primary_route.main_stops.length, failedRefreshRoute: false, queryCalls, verifications }));
});
