'use strict';
// Built browser -> real HTTP, source admission, edit and publication. Only
// external source/resolver/weather and immutable storage seams are fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { mkdir } = require('node:fs/promises');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { createOpenDataLoader } = require('../server/place-candidates/open-data-loader');
const DATE = '2026-10-16', NOW = `${DATE}T08:00:00Z`, LAST = 'parranda:anywhere:last';
const current = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), LAST);
const ids = entry => entry.safeResponse.days[0].primary_route.main_stops.map(stop => stop.id);

test('built day search → exact preview/refusal → confirm → Undo → Save/reload/share uses one admitted answer', { timeout: 90000 }, async t => {
  let closed = false, loads = 0;
  const source = createOpenDataLoader({ endpoint: 'https://offline.example/overpass', radiusKm: 1, now: () => Date.parse(NOW),
    fetcher: async () => { loads++; return { ok: true, status: 200, json: async () => ({ elements: [
      ...Array.from({ length: 8 }, (_, i) => ({ type: 'node', id: 1001 + i, lat: 55.6 + i * .00015, lon: 13,
        tags: { name: `Harbour Collection ${i + 1}`, tourism: 'museum', wikidata: `Q${1001 + i}` } })),
      { type: 'node', id: 1009, lat: 55.6015, lon: 13.001, tags: { name: 'River Kitchen', amenity: 'restaurant', cuisine: 'indian', wikidata: 'Q1009', ...(closed ? { opening_hours: 'Mo-Su off' } : {}) } },
      { type: 'node', id: 1010, lat: 55.6016, lon: 13.001, tags: { name: 'Other Food', amenity: 'restaurant', wikidata: 'Q1010' } },
    ] }) }; } });
  // This tests publisher/recipient correlation without claiming Linux's
  // descriptor-relative file-store acceptance on a macOS browser host.
  const publications = new Map();
  const publishedDayStore = {
    async put(projection) {
      const snapshot = { version: 1, ref: randomBytes(24).toString('hex'), created_at: NOW, expires_at: '2026-10-18T08:00:00Z' };
      publications.set(snapshot.ref, { ...snapshot, ...structuredClone(projection) });
      return { state: 'ready', snapshot };
    },
    async read(ref) { return publications.has(ref) ? { status: 200, body: structuredClone(publications.get(ref)) } : { status: 404, body: { error: 'day_snapshot_unavailable' } }; },
  };
  const server = buildApp({ openDataLoader: source,
    placeResolver: async () => [{ label: 'Fixture Harbour', lat: 55.6, lng: 13, confidence: 'high', provenance: 'offline_fixture', timezone: 'Europe/Stockholm', osm_class: 'place', osm_ref: 'relation/123456' }],
    sourceCatalog: null, reviewedPlaceSource: null, placeSuggestions: null, eventSupply: null, publishedDayStore,
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 18, timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
    clock: Object.assign(() => new Date(NOW), { now: () => NOW }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true, ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function profile() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB', timezoneId: 'Europe/Stockholm' });
    await context.route(url => url.origin !== origin, route => route.abort());
    await context.addInitScript(epoch => { const NativeDate = Date; window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [epoch])); } static now() { return epoch; } }; }, Date.parse(NOW));
    return context;
  }
  const context = await profile(), page = await context.newPage(), requests = [], errors = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/route-recommendations') requests.push(request.postDataJSON()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/anywhere?place=Fixture%20Harbour&prefs=culture&walk=balanced&lang=en`);
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || 'null')?.safeResponse?.days?.[0]?.primary_route?.main_stops?.length === 5, LAST);
  const original = await current(page);
  const panel = page.getByRole('region', { name: 'Add a place', exact: true });
  await panel.waitFor({ timeout: 3000 }); // RED against the old built frontend.
  await panel.getByRole('searchbox').fill('indiskt');
  await panel.getByRole('searchbox').press('Enter');
  await panel.getByText('River Kitchen', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Preview change', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm addition', exact: true }).waitFor();
  assert.deepEqual(await current(page), original, 'preview never writes LAST or changes the visible day');
  if (process.env.PARRANDA_PLACE_QA_DIR) {
    await mkdir(process.env.PARRANDA_PLACE_QA_DIR, { recursive: true });
    await panel.screenshot({ path: `${process.env.PARRANDA_PLACE_QA_DIR}/mobile-preview.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await panel.screenshot({ path: `${process.env.PARRANDA_PLACE_QA_DIR}/desktop-preview.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desktop has no horizontal overflow');
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
      t.diagnostic(JSON.stringify(await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 8).map(el => ({ tag: el.tagName, className: String(el.className), width: el.getBoundingClientRect().width })) }))));
    }
    // The map observes a viewport shrink asynchronously. Judge the settled
    // layout, rather than the previous desktop canvas in its resize turn.
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, undefined, { timeout: 3000 });
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile has no horizontal overflow');
  await panel.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  closed = true;
  await panel.getByRole('button', { name: 'Preview change', exact: true }).click();
  await panel.getByText(/We could not add this place/).waitFor();
  assert.deepEqual(await current(page), original, 'a source that closed between search and preview is refused');
  closed = false;
  await panel.getByRole('button', { name: 'Preview change', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm addition', exact: true }).waitFor();
  const beforeConfirm = requests.length;
  await panel.getByRole('button', { name: 'Confirm addition', exact: true }).click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || 'null')?.safeResponse?.days?.[0]?.primary_route?.main_stops?.length === 6, LAST);
  const accepted = await current(page);
  assert.deepEqual(ids(accepted).filter(id => id !== 'osm-node-1009'), ids(original));
  assert.ok(!ids(accepted).includes('osm-node-1010'), 'an explicit outside-interest choice cannot recruit unrelated filler');
  assert.deepEqual(accepted.inputs.selected, ['culture']);
  assert.equal(requests.length, beforeConfirm, 'confirmation uses the already admitted generation');
  assert.equal(accepted.safeResponse.day_snapshot?.state, 'ready', 'native source witnesses permit publishing the exact edited generation');
  await page.getByRole('button', { name: 'Save this day', exact: true }).click();
  const copied = [];
  page.on('dialog', async dialog => { copied.push(dialog.defaultValue()); await dialog.dismiss(); });
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedDay = text; } } }); });
  await page.getByRole('button', { name: 'Share this day', exact: true }).click();
  const share = await page.evaluate(() => window.__copiedDay) || copied.at(-1);
  assert.ok(share?.includes('snapshot='), 'the accepted day has an immutable public reference');
  const beforeUndo = requests.length;
  await page.getByRole('button', { name: 'Undo this change', exact: true }).click();
  assert.deepEqual(await current(page), original);
  assert.equal(requests.length, beforeUndo);
  const saved = page.locator('section').filter({ has: page.getByText('Saved days', { exact: true }) });
  await saved.getByRole('button').first().click();
  await page.getByRole('region', { name: 'The route', exact: true }).getByText('River Kitchen', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('region', { name: 'The route', exact: true }).getByText('River Kitchen', { exact: true }).waitFor();
  assert.equal(requests.length, beforeUndo, 'Save/restore/reload cannot compose another day');
  const recipientContext = await profile(), recipient = await recipientContext.newPage(), loadsBeforeRead = loads;
  await recipient.goto(share);
  await recipient.getByRole('region', { name: 'The route', exact: true }).getByText('River Kitchen', { exact: true }).waitFor();
  assert.equal(loads, loadsBeforeRead, 'a new profile reads the same immutable answer without source acquisition');
  assert.deepEqual(errors, []);
});
