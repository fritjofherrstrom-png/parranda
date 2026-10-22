'use strict';

// Built UI -> real HTTP handlers -> real provider implementations. Only the
// external Photon/Overpass transports are controlled. No API response routing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { createPlaceSuggestions } = require('../server/place-candidates/place-suggestions');
const { createOpenDataLoader } = require('../server/place-candidates/open-data-loader');
const { requestJson } = require('./helpers/planner-reservoir-compare');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const photon = title => ({ ok: true, status: 200, json: async () => ({ features: [{
  type: 'Feature', geometry: { type: 'Point', coordinates: [13, 55.6] },
  properties: { name: title, type: 'city', osm_key: 'place', osm_value: 'city',
    osm_type: 'R', osm_id: 101, state: 'Fixture Region', country: 'Fixture Country' },
}] }) });
let browser;
test.before(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
});
test.after(async () => { await browser?.close(); });

async function serve(t, options) {
  const server = buildApp({ placeSuggestions: null, placeResolver: null, openDataLoader: null,
    eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null,
    weatherProvider: async () => null, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
async function landing(t, provider) {
  const { server, origin } = await serve(t, { placeSuggestions: provider });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Block external browser traffic only; all product requests reach Express.
  await context.route(url => url.origin !== origin, route => route.abort());
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'built UI must not raise browser exceptions'));
  await page.goto(`${origin}/?lang=en`);
  await page.waitForFunction(() => !document.querySelector('[role=combobox]')?.closest('astro-island')?.hasAttribute('ssr'));
  const field = page.getByRole('combobox', { name: 'Type a city or place' });
  return { page, field, server };
}

test('built autocomplete displays a valid 4500ms Photon answer through the actual HTTP handler', { timeout: 20000 }, async t => {
  let calls = 0, elapsed;
  const provider = createPlaceSuggestions({ fetcher: async (_url, { signal }) => {
    calls++;
    const started = performance.now();
    await delay(4500, null, { signal });
    elapsed = performance.now() - started;
    return photon('Slowport');
  } }); // Production 5000ms total budget and 750ms pacing, unchanged.
  const { page, field } = await landing(t, provider);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/place-suggestions');
  await field.fill('slowport');
  await page.getByRole('option').filter({ hasText: 'Slowport' }).waitFor({ timeout: 8000 });
  const body = await (await response).json();
  assert.equal(body.status, 'ready');
  assert.equal(calls, 1, 'a slow valid answer must not need a UI retry');
  assert.ok(elapsed >= 4400, 'exercise the real slow boundary, not a ready fixture API');
  assert.ok(body.choices[0].selection_id, 'the actual handler issues a selectable identity');
  t.diagnostic(JSON.stringify({ provider_elapsed_ms: elapsed, native_calls: calls, api_status: body.status }));
});

test('a new built-UI prefix cancels its abandoned HTTP owner and never publishes or caches the old answer', { timeout: 15000 }, async t => {
  const entered = deferred(), aborted = deferred(), release = deferred();
  const calls = [];
  const provider = createPlaceSuggestions({ fetcher: async (url, { signal }) => {
    const query = new URL(url).searchParams.get('q');
    calls.push(query);
    if (calls.length === 1) {
      signal.addEventListener('abort', () => aborted.resolve(true), { once: true });
      entered.resolve();
      await release.promise; // Deliberately ignores cancellation and returns late.
      return photon('Obsolete Harbour');
    }
    return photon(query === 'newport' ? 'Newport' : 'Fresh Oldport');
  } });
  const { page, field } = await landing(t, provider);
  try {
    await field.fill('oldport'); await entered.promise;
    await field.fill('newport');
    let timer;
    try {
      assert.equal(await Promise.race([aborted.promise, new Promise(resolve => { timer = setTimeout(() => resolve(false), 1500); })]), true,
        'browser abort must reach the actual handler and producer ownership');
    } finally { clearTimeout(timer); }
    release.resolve();
    await page.getByRole('option').filter({ hasText: 'Newport' }).waitFor();
    assert.equal(await page.getByRole('option').filter({ hasText: 'Obsolete Harbour' }).count(), 0);
    await field.fill('oldport');
    await page.getByRole('option').filter({ hasText: 'Fresh Oldport' }).waitFor();
    assert.deepEqual(calls, ['oldport', 'newport', 'oldport'], 'late abandoned work must not populate the cache');
  } finally { release.resolve(); }
});

test('real unavailable responses retry once, explicit retry recovers and signed selection reaches composition', { timeout: 15000 }, async t => {
  let calls = 0;
  const provider = createPlaceSuggestions({ fetcher: async () => ++calls <= 2
    ? { ok: false, status: 503 } : photon('Retryport') });
  const { page, field } = await landing(t, provider);
  await field.fill('retryport');
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await retry.waitFor();
  await delay(1100);
  assert.equal(calls, 2, 'no endless automatic source retry');
  assert.equal(await field.inputValue(), 'retryport');
  await retry.click();
  await page.getByRole('option').filter({ hasText: 'Retryport' }).waitFor();
  assert.equal(calls, 3);
  await field.press('ArrowDown'); await field.press('Enter');
  const composed = page.waitForRequest(r => new URL(r.url()).pathname === '/api/route-recommendations');
  await page.getByRole('button', { name: 'Build my day', exact: true }).click();
  const payload = (await composed).postDataJSON();
  assert.equal(payload.place, 'Retryport, Fixture Region, Fixture Country');
  assert.ok(payload.place_selection, 'the real signed selection must survive navigation');
});

test('persistent real suggestion failure still permits ordinary free-text navigation and composition', { timeout: 15000 }, async t => {
  let calls = 0;
  const { page, field } = await landing(t, createPlaceSuggestions({ fetcher: async () => {
    calls++; return { ok: false, status: 503 };
  } }));
  await field.fill('Freeport');
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  assert.equal(calls, 2);
  const composed = page.waitForRequest(r => new URL(r.url()).pathname === '/api/route-recommendations');
  await page.getByRole('button', { name: 'Build my day', exact: true }).click();
  const payload = (await composed).postDataJSON();
  assert.equal(payload.place, 'Freeport');
  assert.equal(payload.place_selection, undefined, 'failure must not invent a selected identity');
  assert.equal(new URL(page.url()).searchParams.get('place'), 'Freeport');
});

test('actual route handlers preserve cooldown failure health, suppress traffic, then distinguish genuine empty recovery', async t => {
  let clock = 1_000_000, calls = 0;
  const loader = createOpenDataLoader({ now: () => clock, fetcher: async () => {
    calls++;
    return calls === 1 ? { ok: false, status: 502, headers: { get: () => null } }
      : { ok: true, status: 200, json: async () => ({ elements: [] }) };
  } });
  const { server } = await serve(t, { openDataLoader: loader });
  const query = lng => requestJson(server, { path: '/api/route-recommendations?lang=en&experimental_agnostic_route_output=1',
    body: { city: 'unknown-test-anchor', dates: ['2026-10-16'], lat: 55.6, lng,
      preferences: ['coffee'], include_external_candidates: 1 } });
  for (const lng of [13, 13.02]) {
    const result = await query(lng);
    assert.equal(result.status, 200);
    const block = result.body.agnostic_route_output_experiment;
    assert.equal(block.source_status.status, 'error_failed_closed');
    assert.equal(block.source_status.error, 'provider_unavailable');
    assert.ok(block.readiness_blockers.includes('loader_error'));
    assert.equal(block.route_mutation, false);
    assert.deepEqual(result.body.days, []);
    assert.equal(calls, 1, 'another actual HTTP request must respect the same endpoint hold');
  }
  clock += 60_001; // Source cooldown clock only; no product or browser deadline changes.
  const recovered = await query(13.04);
  // The real route pipeline can make several bounded discovery queries after
  // an empty answer. The exact one-fetch assertion applies DURING the hold;
  // after expiry, prove real reacquisition and honest empty classification.
  assert.ok(calls > 1, 'expiry must allow fresh native acquisition');
  const block = recovered.body.agnostic_route_output_experiment;
  assert.equal(block.source_status.status, 'loaded:0');
  assert.ok(block.readiness_blockers.includes('no_usable_trusted_records'));
  assert.ok(!block.readiness_blockers.includes('loader_error'), 'real empty evidence differs from provider failure');
  t.diagnostic(JSON.stringify({ calls_during_hold: 1, calls_after_recovery: calls - 1,
    recovered_status: block.source_status.status }));
});
