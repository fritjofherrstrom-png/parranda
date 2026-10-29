'use strict';
// Built UI -> real HTTP/handlers/engine. Sources, resolver, weather and clock
// are controlled fixtures; no product API response is intercepted or replaced.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { record, rows, anchor } = require('./helpers/day-composition-fixtures');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const DATE = '2026-10-27', NOW = '2026-10-27T11:45:00Z';
const KEY = 'parranda:anywhere:last', preferences = ['food', 'second_hand', 'green'];
const records = [record('lunch', 'restaurant', 3, { opening_hours: 'Mo-Su 11:00-15:00' }),
  record('dinner', 'restaurant', 8, { opening_hours: 'Mo-Su 18:00-23:00' }),
  ...rows('shop', 'vintage-shop', 4), ...rows('park', 'park', 4, 6)];
async function fixture(t, timezone = true) {
  const server = buildApp({ openDataLoader: async () => structuredClone(records), sourceCatalog: null,
    reviewedPlaceSource: null, eventSupply: null, placeSuggestions: null, weatherProvider: async () => null,
    placeResolver: async () => [{ label: 'Fixture place', ...anchor, confidence: 'high', provenance: 'test_resolver',
      ...(timezone ? { timezone: 'Europe/Stockholm' } : {}) }],
    clock: Object.assign(() => new Date(NOW), { now: () => NOW }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return server;
}
const mainStops = body => body.days?.[0]?.primary_route?.main_stops || [];
const body = { place: 'Fixture place', dates: [DATE], preferences, preference_priority: preferences,
  day_rhythm: 'full', distance_mode: 'no_limit', experimental_agnostic_route_output: 1,
  include_external_candidates: 1, agnostic_engine_compose: 1 };

test('HTTP uses trusted current context and cannot be made lunch-aware by forged client context', async t => {
  const trusted = await fixture(t), unknown = await fixture(t, false);
  const request = (server, extra = {}) => requestJson(server, {
    path: '/api/route-recommendations?lang=en', body: { ...body, ...extra } });
  const current = await request(trusted);
  assert.equal(current.status, 200);
  assert.equal(mainStops(current.body)[0].id, 'lunch');
  assert.equal(mainStops(current.body).at(-1).id, 'dinner');
  const plain = await request(unknown);
  const forged = await request(unknown, { timezone: 'Europe/Stockholm', now: NOW,
    mealContext: { date: DATE, nowLocalIso: DATE + 'T12:45:00', fullDay: true },
    __mealContext: { date: DATE, nowLocalIso: DATE + 'T12:45:00', fullDay: true } });
  assert.equal(forged.status, 200);
  assert.deepEqual(mainStops(forged.body).map(s => s.id), mainStops(plain.body).map(s => s.id));
  assert.notEqual(mainStops(forged.body)[0].id, 'lunch');
  assert.ok(mainStops(forged.body).every(s => s.open_now === undefined));
});

test('mobile built app publishes lunch first/dinner last and changes Relaxed -> Full through actual HTTP', { timeout: 90000 }, async t => {
  const server = await fixture(t), origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB', timezoneId: 'Europe/Stockholm' });
  await context.route(url => url.origin !== origin, route => route.abort());
  await context.addInitScript(epoch => { const D = Date; window.Date = class extends D {
    constructor(...args) { super(...(args.length ? args : [epoch])); } static now() { return epoch; }
  }; }, Date.parse(NOW));
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (new URL(r.url()).pathname === '/api/route-recommendations') requests.push(r.postDataJSON()); });
  await page.goto(`${origin}/anywhere?place=Fixture%20place&prefs=food,second_hand,green&prio=food,second_hand,green&rhythm=full&lang=en`);
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), KEY);
  const waitRhythm = rhythm => page.waitForFunction(({ KEY, rhythm }) =>
    JSON.parse(localStorage.getItem(KEY) || 'null')?.inputs?.walkKey === rhythm, { KEY, rhythm });
  const list = page.locator('ol[aria-label="The stops, in order"]');
  await list.locator(':scope > li > button').first().waitFor();
  await waitRhythm('full');
  let entry = await read(), stops = mainStops(entry.safeResponse);
  assert.equal(stops.length, 6);
  assert.equal(stops[0].id, 'lunch'); assert.equal(stops.at(-1).id, 'dinner');
  assert.match(await list.locator(':scope > li > button').first().innerText(), /lunch/i);
  assert.match(await list.locator(':scope > li > button').last().innerText(), /dinner/i);
  assert.equal(stops[0].daypart, 'midday'); assert.equal(stops.at(-1).daypart, 'evening');
  assert.deepEqual(stops.at(-1).selected_day_hours.windows, [{ opens: '18:00', closes: '23:00' }]);
  assert.ok(stops.every(s => s.open_now === undefined));
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await page.getByRole('button', { name: 'Relaxed', exact: true }).click(); await waitRhythm('calm');
  assert.equal(mainStops((await read()).safeResponse).length, 4);
  await page.getByRole('button', { name: 'Full', exact: true }).click(); await waitRhythm('full');
  entry = await read(); stops = mainStops(entry.safeResponse);
  assert.equal(stops.length, 6); assert.equal(stops[0].id, 'lunch'); assert.equal(stops.at(-1).id, 'dinner');
  assert.equal(requests.at(-1).day_rhythm, 'full');
  if (process.env.PARRANDA_MEAL_SCREENSHOT) await page.screenshot({ path: process.env.PARRANDA_MEAL_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []);
});
