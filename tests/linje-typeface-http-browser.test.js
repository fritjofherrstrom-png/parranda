'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');

test('built landing and saved day render Archivo from localhost at mobile and desktop widths', { timeout: 30000 }, async t => {
  const host = '127.0.0.1';
  const app = buildApp({ placeSuggestions: null, placeResolver: null, openDataLoader: null,
    eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null, weatherProvider: async () => null });
  const server = app.listen(0, host);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await once(server, 'listening');
  const origin = `http://${host}:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext();
  // Even without a third-party connection, these two routes can render the
  // approved variable face. Exercise the real compiled CSS and static handler.
  await context.route(url => url.origin !== origin, route => route.abort());
  const date = '2026-11-19';
  const place = 'Łódź';
  await context.addInitScript(({ date, place }) => {
    if (location.pathname !== '/anywhere') return;
    const stops = [
      { id: 'a', label: 'Konstmuseet', type: 'museum', lat: 59.61, lng: 16.54 },
      { id: 'b', label: 'Kaféet', type: 'cafe', lat: 59.62, lng: 16.55 },
    ];
    const primary_route = { id: '__agnostic_compose__', main_stops: stops, estimated_km: 1.2,
      legs: [], map_path_points: [], confidence: 'low' };
    const safeResponse = { days: [{ date, primary_route, experimental_agnostic_route_applied: true, alternatives: [] }],
      agnostic_route_output_experiment: { intake: { status: 'resolved', resolved: { label: place, lat: stops[0].lat, lng: stops[0].lng } },
        promotion: { promote: true, readiness: 'promotable' } } };
    localStorage.setItem('parranda:anywhere:saved', JSON.stringify([{
      id: 'font-fixture', label: place, place, dateIso: date, safeResponse, savedAt: Date.now(),
      classification: { status: 'composed', hasStructure: false, placeLabel: place },
      inputs: { place, mode: 'typed', dayOffset: 0, walkKey: 'balanced', selected: ['food', 'culture', 'views'] },
    }]));
  }, { date, place });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const fontResponses = [];
  page.on('response', response => {
    if (response.request().resourceType() === 'font') fontResponses.push(response);
  });

  for (const [width, lang, pathname, title, stretch, weight] of [
    [320, 'sv', '/', /nästa stopp/i, '125%', '900'],
    [1440, 'en', '/', /next stop/i, '125%', '900'],
    [390, 'sv', '/anywhere?saved=font-fixture', /en dag i łódź/i, '112%', '900'],
    [1440, 'en', '/anywhere?saved=font-fixture', /a day in łódź/i, '112%', '900'],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    const url = new URL(pathname, origin);
    url.searchParams.set('lang', lang);
    await page.goto(url.href);
    const heading = page.getByRole('heading', { level: 1, name: title });
    await heading.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    const label = `${pathname} ${lang} at ${width}px`;
    assert.ok(fonts.length > 0 && fonts.every(font => /^Archivo\b/.test(font.familyName) && font.isCustomFont),
      `${label}: ${JSON.stringify(fonts)}`);
    const metrics = await heading.evaluate(element => {
      const style = getComputedStyle(element);
      return { stretch: style.fontStretch, weight: style.fontWeight, scrollWidth: document.documentElement.scrollWidth };
    });
    assert.deepEqual(metrics, { stretch, weight, scrollWidth: width }, label);
  }
  assert.ok(fontResponses.length > 0, 'there must be a downloaded font');
  for (const response of fontResponses) {
    assert.equal(new URL(response.url()).origin, origin);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['content-type'], 'font/woff2');
  }
});
