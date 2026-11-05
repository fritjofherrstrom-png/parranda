'use strict';
// Built UI -> real API/lifecycle -> real acquisition/normalization -> composer.
// External source payloads, resolver, weather and clock are controlled. No
// product API response is intercepted, and no public provider/cache is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { DuckDBInstance } = require('@duckdb/node-api');
const { buildApp } = require('../server/app');
const { createOpenDataLoader, resolveDefaultOpenDataLoader } = require('../server/place-candidates/open-data-loader');
const { createOvertureSource, buildOvertureQuery, mapOvertureRow } = require('../server/place-candidates/overture-source');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { digest } = require('../server/place-candidates/overture-sample-cache');
const { createHash } = require('node:crypto');

const anchor = { lat: 44.8178, lng: 20.4569 };
const clock = () => new Date('2026-10-25T09:00:00Z');
const scenarios = [
  { name: 'explicit used clothing and books', kind: 'osm-shops', preferences: ['second_hand'], covered: ['second_hand'], partial: [] },
  { name: 'used-bookstore taxonomy through actual SQL', kind: 'directory', preferences: ['second_hand'], covered: ['second_hand'], partial: [] },
  { name: 'park relations preserve Green and partial Views', kind: 'osm-parks', preferences: ['green', 'views'], covered: ['green'], partial: ['scenic'] },
  { name: 'cafés preserve Coffee and partial Food', kind: 'osm-cafes', preferences: ['food', 'fika'], covered: ['coffee'], partial: ['food'] },
  { name: 'previous-query reserve survives controlled outage', kind: 'directory-reserve', preferences: ['fika'], covered: ['coffee'], partial: [] },
];

async function makeLoader(t, kind) {
  const state = { calls: 0, inputs: [], queries: [] };
  if (kind === 'directory-reserve') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-universal-reserve-browser-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const release = '2026-09-23.0', verifiedAt = Date.now() - 1000;
    const asset = { path: `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/part-browser.zstd.parquet`, etag: '"reserve-v1"', length: 12000 };
    const source = createOvertureSource();
    const key = source.cacheKeyFor(anchor);
    const records = Array.from({ length: 8 }, (_, i) => mapOvertureRow({
      id: `30000000-0000-0000-0000-${String(i).padStart(12, '0')}`, name: `Кафе ${i}`,
      category: 'coffee_shop', category_hierarchy: ['coffee_shop'], confidence: .99,
      operating_status: null, licenses: ['CC0-1.0'], lat: anchor.lat + i * .0008, lng: anchor.lng + (i % 2) * .001,
    }));
    const priorSql = buildOvertureQuery({ release, parquetPaths: [asset.path], ...anchor }).replace(/, 'used_bookstore'/g, '');
    const receipt = { version: 1, release, assets: [asset], acquiredAt: verifiedAt, verifiedAt, recordsHash: digest(records),
      queryHash: createHash('sha256').update('overture-v6:normalizer-1\0').update(priorSql).digest('hex') };
    const raw = createSourceCache({ dir, namespace: 'overture-v6', ttlMs: 100, now: () => verifiedAt });
    raw.set(key, { version: 1, cacheKey: key, records, receipt });
    const before = raw.inspect(key);
    t.mock.method(globalThis, 'fetch', async () => { state.calls++; return { ok: false, status: 503 }; });
    const loader = resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: 'enabled', PARRANDA_OVERTURE_SOURCE: 'enabled',
      PARRANDA_CACHE_DIR: dir, PARRANDA_SOURCE_CACHE_TTL_MS: '100', PARRANDA_OVERPASS_ENDPOINTS: 'https://controlled.example/overpass' });
    return { state, load: async request => {
      const rows = await loader(request); state.inputs = rows;
      assert.equal(rows.loader_metadata.cache.served_stale, true);
      assert.equal(rows.loader_metadata.cache.query_contract, 'previous');
      assert.deepEqual(raw.inspect(key), before, 'HTTP composition must not renew the predecessor envelope');
      return rows;
    } };
  }
  if (kind === 'directory') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-universal-browser-'));
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    t.after(() => { conn.closeSync(); instance.closeSync(); fs.rmSync(dir, { recursive: true, force: true }); });
    await conn.run(`CREATE TABLE places (
      id VARCHAR, names STRUCT("primary" VARCHAR), taxonomy STRUCT("primary" VARCHAR, hierarchy VARCHAR[], alternates VARCHAR[]),
      confidence DOUBLE, operating_status VARCHAR, websites VARCHAR[], brand STRUCT(names STRUCT("primary" VARCHAR)),
      sources STRUCT(license VARCHAR)[], bbox STRUCT(xmin DOUBLE, ymin DOUBLE))`);
    for (let i = 0; i < 10; i++) {
      const leaf = i < 8 ? 'used_bookstore' : 'bookstore';
      const hierarchy = ['shopping', 'specialty_store', 'books_music_and_video_store', 'bookstore', ...(i < 8 ? ['used_bookstore'] : [])];
      await conn.run(`INSERT INTO places VALUES (?, {'primary': ?}, ?::JSON::STRUCT("primary" VARCHAR, hierarchy VARCHAR[], alternates VARCHAR[]),
        .99, NULL, [], {'names': {'primary': NULL}}, [{'license':'CC0-1.0'}], {'xmin': ?, 'ymin': ?})`,
      [`20000000-0000-0000-0000-${String(i).padStart(12, '0')}`, i < 8 ? `Книги ${i}` : `Used vintage books name-only ${i}`,
        JSON.stringify({ primary: leaf, hierarchy, alternates: i < 8 ? [] : ['used_bookstore'] }),
        anchor.lng + (i % 2) * .001, anchor.lat + i * .0008]);
    }
    const file = path.join(dir, 'places.parquet');
    await conn.run(`COPY places TO '${file}' (FORMAT PARQUET)`);
    const source = createOvertureSource({ releaseResolver: async () => '2026-09-23.0', queryRows: async sql => {
      state.calls++; state.queries.push(sql);
      // Substitute only the external Parquet location, retaining actual SQL.
      return (await conn.runAndReadAll(sql.replace(/s3:\/\/[^']+/, file))).getRowObjectsJson();
    } });
    return { state, load: async request => { const rows = await source(request); state.inputs = rows; return rows; } };
  }
  const elements = Array.from({ length: 8 }, (_, i) => ({
    type: kind === 'osm-parks' ? 'relation' : 'node', id: 100 + i,
    ...(kind === 'osm-parks' ? { center: { lat: anchor.lat + i * .0008, lon: anchor.lng + (i % 2) * .001 } }
      : { lat: anchor.lat + i * .0008, lon: anchor.lng + (i % 2) * .001 }),
    tags: { name: `Место ${i}`, ...(kind === 'osm-shops' ? { shop: i % 2 ? 'books' : 'clothes', second_hand: i % 2 ? 'yes' : 'only' }
      : kind === 'osm-parks' ? { leisure: 'park' } : { amenity: 'cafe' }) },
  }));
  if (kind === 'osm-shops') elements.push(
    { type: 'node', id: 999, lat: anchor.lat, lon: anchor.lng, tags: { name: 'Vintage name-only', shop: 'clothes' } },
    { type: 'node', id: 998, lat: anchor.lat, lon: anchor.lng, tags: { name: 'Closed used shop', shop: 'clothes', second_hand: 'only', disused: 'yes', opening_hours: 'closed' } },
  );
  const load = createOpenDataLoader({ endpoint: 'https://controlled.example/interpreter', radiusKm: 1.5,
    cache: createSourceCache(), fetcher: async (_url, options) => {
      state.calls++; const query = new URLSearchParams(options.body).get('data'); state.queries.push(query);
      // This finite provider boundary checks the acquisition contract before
      // answering. It does not implement or replace the product API/mapper.
      if (kind === 'osm-shops' && !query.includes('["shop"="clothes"]["second_hand"="only"]')) return { ok: true, json: async () => ({ elements: [] }) };
      if (kind === 'osm-parks' && !query.includes('relation["leisure"="park"]')) return { ok: true, json: async () => ({ elements: [] }) };
      return { ok: true, json: async () => ({ elements }) };
    } });
  return { state, load: async request => { const rows = await load(request); state.inputs = rows; return rows; } };
}

for (const scenario of scenarios) test(`built UI and real HTTP: ${scenario.name}`, { timeout: 35000 }, async t => {
  const { load, state } = await makeLoader(t, scenario.kind);
  const server = buildApp({ openDataLoader: load, placeSuggestions: null, eventSupply: null,
    sourceCatalog: null, reviewedPlaceSource: null, clock,
    placeResolver: async () => [{ ...anchor, label: 'Controlled neighbourhood', confidence: 'high', provenance: { provider: 'controlled' } }],
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false,
      timezone_resolution: { timezone: 'Europe/Belgrade', timezone_source: 'weather_provider_auto', utc_offset_seconds: 3600 } }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: 'Europe/Belgrade' });
  await context.route(url => url.origin !== origin, route => route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(clock());
  const finalResponse = page.waitForResponse(r => ['/api/route-recommendations', '/api/planner-status'].includes(new URL(r.url()).pathname) && r.status() === 200);
  await page.goto(`${origin}/anywhere?place=Controlled%20neighbourhood&prefs=${scenario.preferences.join(',')}&day=1&rhythm=balanced&lang=en`);
  const body = await (await finalResponse).json();
  const route = body.days?.[0]?.primary_route;
  assert.ok(route, 'the real API publishes a day');
  assert.ok(route.main_stops.length >= 2);
  assert.equal(new Set(route.main_stops.map(stop => stop.id)).size, route.main_stops.length);
  assert.equal(body.agnostic_route_output_experiment.walking_validation.valid, true);
  for (const stop of route.main_stops) {
    assert.deepEqual([...stop.covered_preferences].sort(), [...scenario.covered].sort());
    assert.deepEqual([...stop.partial_preferences].sort(), [...scenario.partial].sort());
    assert.deepEqual(stop.missing_preferences, []);
    assert.equal(stop.provisional, true);
    assert.ok(!['osm-node-998', 'osm-node-999'].includes(stop.id));
    assert.ok(!stop.opening_hours, 'unknown actual hours are never synthesized');
    assert.ok(state.inputs.some(row => row.id === stop.id), 'every published identity belongs to the actual mapped source answer');
  }
  const names = route.main_stops.map(stop => stop.label || stop.name);
  const rendered = async names => page.waitForFunction(expected => {
    const rows = [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button')];
    return rows.length === expected.length && rows.every((row, i) => row.textContent.includes(expected[i]));
  }, names);
  await rendered(names);
  const capture = async (suffix, actualRoute) => {
    if (!process.env.PARRANDA_QA_ARTIFACT_DIR) return;
    fs.mkdirSync(process.env.PARRANDA_QA_ARTIFACT_DIR, { recursive: true });
    const prefix = path.join(process.env.PARRANDA_QA_ARTIFACT_DIR, `${scenario.kind}-${suffix}`);
    await page.screenshot({ path: `${prefix}.png`, fullPage: true });
    fs.writeFileSync(`${prefix}.dom.html`, await page.locator('body').innerHTML());
    fs.writeFileSync(`${prefix}.json`, JSON.stringify({ scenario: scenario.name, route: actualRoute, source_calls: state.calls }, null, 2));
  };
  if (scenario.partial.length) {
    const picks = await page.getByRole('list', { name: 'Your picks in this day', exact: true }).innerText();
    assert.ok(picks.includes('partly'));
    assert.ok(!picks.includes('not in this day'), 'the real UI does not falsely report the exact requested match missing');
  } else assert.equal(await page.getByText('All picks included', { exact: true }).count(), 1);
  assert.ok(state.calls > 0 && state.calls <= 2, 'only the existing bounded initial/expansion source passes');
  if (scenario.kind === 'directory' || scenario.kind === 'osm-shops') assert.equal(route.main_stops.length, 5, 'one interest alone retains Balanced depth');
  const list = page.getByRole('list', { name: 'The stops, in order', exact: true });
  await list.locator(':scope > li > button').first().click();
  if (scenario.kind !== 'osm-parks') {
    assert.equal(await list.getByText('Opening hours unavailable for the selected day', { exact: true }).count(), 1);
  }
  await capture('balanced', route);
  const rhythmCounts = { balanced: route.main_stops.length };
  if (scenario.kind === 'directory') {
    await page.getByRole('button', { name: 'Adjust', exact: true }).click();
    for (const [rhythm, label, expected] of [['full', 'Full', 6], ['calm', 'Relaxed', 4]]) {
      const next = page.waitForResponse(async response => {
        if (!['/api/route-recommendations', '/api/planner-status'].includes(new URL(response.url()).pathname) || response.status() !== 200) return false;
        try { return (await response.json()).days?.[0]?.primary_route?.main_stops?.length === expected; } catch { return false; }
      });
      await page.getByRole('button', { name: label, exact: true }).click();
      const published = (await (await next).json()).days[0].primary_route;
      assert.ok(published.main_stops.every(stop => stop.type === 'vintage-shop' && stop.covered_preferences.includes('second_hand')));
      assert.equal(published.main_stops.length, expected);
      await rendered(published.main_stops.map(stop => stop.label || stop.name));
      rhythmCounts[rhythm] = published.main_stops.length;
      await capture(rhythm, published);
    }
    assert.deepEqual(rhythmCounts, { balanced: 5, full: 6, calm: 4 });
  }
  assert.deepEqual(errors, []);
  t.diagnostic(JSON.stringify({ kind: scenario.kind, mapped_candidates: state.inputs.length,
    published_ids: route.main_stops.map(stop => stop.id), covered: scenario.covered, partial: scenario.partial,
    estimated_km: route.estimated_km, rhythm_counts: rhythmCounts, source_calls: state.calls, browser: browser.version(), errors }));
});
