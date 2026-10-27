'use strict';
// Built UI -> actual HTTP/handlers/engine and real catalog. Resolver, weather,
// clock and external acquisition are controlled; no product API is fulfilled.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');
const KEY = 'parranda:anywhere:last', NOW = '2026-10-27T01:20:00Z';
const read = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
const stops = entry => entry.safeResponse.days[0].primary_route.main_stops;

test('built HTTP Remove -> Relaxed -> Full releases the extent while retaining exclusion through Undo and reload', { timeout: 90000 }, async t => {
  const { assertExactNavigation } = await import('../frontend/tests/helpers/exact-navigation-observation.mjs');
  const resolver = createNominatimPlaceResolver({ fetcher: async () => ({ ok: true, status: 200, json: async () => [{
    display_name: 'Rome, Italy', name: 'Rome', lat: '41.8933203', lon: '12.4829321', importance: .55,
    osm_type: 'relation', osm_id: 41485, place_rank: 16, class: 'place', type: 'city', address: { city: 'Rome', country: 'Italy' },
  }] }) });
  const server = buildApp({ openDataLoader: async () => [], sourceCatalog: null, reviewedPlaceSource: null,
    placeResolver: resolver, eventSupply: null, placeSuggestions: null,
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 18, timezone_resolution: {
      timezone: 'Europe/Rome', timezone_source: 'weather_provider_auto', utc_offset_seconds: 3600 } }),
    clock: Object.assign(() => new Date(NOW), { now: () => NOW }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB', timezoneId: 'Europe/Rome' });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await context.route(url => url.origin !== origin, route => route.abort());
  await context.addInitScript(epoch => { const D = Date; window.Date = class extends D {
    constructor(...args) { super(...(args.length ? args : [epoch])); } static now() { return epoch; }
  }; }, Date.parse(NOW));
  const page = await context.newPage(), requests = [], errors = [];
  page.on('request', r => { if (new URL(r.url()).pathname === '/api/route-recommendations') requests.push(r.postDataJSON()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/anywhere?place=Roma&prefs=culture&lang=en`);
  const list = page.locator('ol[aria-label="The stops, in order"]');
  await list.locator(':scope > li > button').first().waitFor();
  assert.equal(stops(await read(page)).length, 5);
  const removed = stops(await read(page))[0].id;
  await list.locator(':scope > li > button').first().click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || 'null')?.safeResponse?.days?.[0]?.primary_route?.main_stops?.length === 4, KEY);
  const controlBody = { ...requests.at(-1), day_rhythm: 'full' };
  delete controlBody.day_edit;
  const control = await (await fetch(origin + '/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&agnostic_engine_compose=1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(controlBody),
  })).json();
  const controlCount = control.days[0].primary_route.main_stops.length;
  assert.ok(controlCount > 4, 'same actual reservoir/exclusion can provide a larger Full day without an edit cap');
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  const waitRhythm = key => page.waitForFunction(({ KEY, key }) => JSON.parse(localStorage.getItem(KEY) || 'null')?.inputs?.walkKey === key, { KEY, key });
  await page.getByRole('button', { name: 'Relaxed', exact: true }).click(); await waitRhythm('calm');
  const relaxed = await read(page);
  await page.getByRole('button', { name: 'Full', exact: true }).click(); await waitRhythm('full');
  const full = await read(page);
  assert.equal(stops(full).length, controlCount);
  assert.ok(!stops(full).some(stop => stop.id === removed));
  assert.equal(requests.at(-1).day_edit, undefined);
  assert.ok(requests.at(-1).excluded_candidate_ids.includes(removed));
  assert.equal(full.inputs.dayEdit, undefined);
  const before = requests.length;
  await page.getByRole('button', { name: 'Undo this change', exact: true }).click(); await waitRhythm('calm');
  assert.deepEqual(await read(page), relaxed);
  assert.equal(requests.length, before);
  await page.getByRole('button', { name: 'Full', exact: true }).click(); await waitRhythm('full');
  await assertExactNavigation({ page, navigate: () => page.reload(), expectedEntry: await read(page), readComposeCount: () => requests.length });
  assert.deepEqual(errors, []);
});
