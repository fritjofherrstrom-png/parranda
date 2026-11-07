'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { requestJson, makeLoader } = require('./helpers/planner-reservoir-compare');

const anchor = { lat: 44.8178, lng: 20.4569 };
const clock = () => new Date('2026-10-25T09:00:00Z');
const date = '2026-10-26';
const routePath = '/api/route-recommendations';

function places() {
  return [
    ['View', { tourism: 'viewpoint' }],
    ['Park', { leisure: 'park' }],
    ['Bakery', { shop: 'bakery' }],
    ['Art museum', { tourism: 'museum', museum: 'art' }],
    ['History museum', { tourism: 'museum', museum: 'history' }],
    ['Restaurant', { amenity: 'restaurant' }],
  ].flatMap(([name, tags], group) => Array.from({ length: 4 }, (_, i) => {
    const id = 1000 + group * 10 + i;
    return mapOsmElement({
      type: 'node', id, lat: anchor.lat + i * .0008, lon: anchor.lng + group * .0005,
      tags: { ...tags, name: `${name} ${i + 1}`, wikidata: `Q${id}`, opening_hours: 'Mo-Su 09:00-20:00' },
    });
  }));
}

async function serve(t) {
  const server = buildApp({
    openDataLoader: makeLoader(places()), placeSuggestions: null, eventSupply: null,
    sourceCatalog: null, reviewedPlaceSource: null, publishedDayStore: null, clock,
    placeResolver: async () => [{
      ...anchor, label: 'Controlled neighbourhood', confidence: 'high', provenance: 'offline_fixture',
      timezone: 'Europe/Belgrade', osm_class: 'place', osm_ref: 'relation/123456',
    }],
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false,
      timezone_resolution: { timezone: 'Europe/Belgrade', timezone_source: 'weather_provider_auto', utc_offset_seconds: 3600 },
    }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return server;
}

function assertStops(body, expected) {
  assert.equal(body.days?.[0]?.date, date);
  const stops = body.days?.[0]?.primary_route?.main_stops;
  assert.ok(stops?.length >= 2, 'the existing engine published a walkable day');
  assert.equal(body.agnostic_route_output_experiment.walking_validation.valid, true);
  assert.ok(stops.every(stop => expected.some(key => stop.covered_preferences.includes(key))));
  for (const key of expected) assert.ok(stops.some(stop => stop.covered_preferences.includes(key)), key);
  return stops;
}

test('the same anchor and date compose two distinct days from exact grouped picks', async t => {
  const server = await serve(t);
  const plans = [];
  for (const preferences of [['parks_gardens', 'viewpoint_places'], ['bakeries', 'art_museums']]) {
    const response = await requestJson(server, {
      path: `${routePath}?lang=en&experimental_agnostic_route_output=1&agnostic_engine_compose=1`,
      body: { place: 'Controlled neighbourhood', dates: [date], preferences, preference_priority: [...preferences].reverse(),
        day_rhythm: 'balanced', include_external_candidates: 1 },
    });
    assert.equal(response.status, 200);
    plans.push(assertStops(response.body, preferences));
  }
  const first = new Set(plans[0].map(stop => stop.id));
  assert.ok(plans[1].every(stop => !first.has(stop.id)), 'new choices reach the actual stop selector');
  assert.ok(plans[1].some(stop => stop.place_details?.kind === 'art_museum'));
  assert.ok(plans[1].every(stop => !stop.label.includes('History museum')));
});

test('built chooser applies one mixed selection on desktop and mobile', { timeout: 45000 }, async t => {
  const server = await serve(t);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  t.after(() => browser.close());
  for (const width of [390, 1150]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, timezoneId: 'Europe/Belgrade' });
    try {
      await context.route(url => url.origin !== origin, route => route.abort());
      const page = await context.newPage();
      const requests = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === routePath) requests.push(request.postDataJSON());
      });
      await page.clock.setFixedTime(clock());
      await page.goto(`${origin}/anywhere?place=Controlled%20neighbourhood&prefs=food,views&day=1&rhythm=balanced&lang=en`);
      const list = page.getByRole('list', { name: 'The stops, in order', exact: true });
      await list.waitFor();
      const requestCount = requests.length;
      await page.getByRole('button', { name: 'Adjust', exact: true }).click();
      await page.getByRole('button', { name: 'All interests', exact: true }).click();
      await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
      await page.getByRole('button', { name: 'Bakeries', exact: true }).click();
      await page.getByRole('button', { name: 'Art museums', exact: true }).click();
      await page.getByRole('button', { name: 'Make Art museums first', exact: true }).click();
      assert.equal(requests.length, requestCount, 'draft edits do not compose');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const dir = process.env.PARRANDA_QA_ARTIFACT_DIR;
      if (dir) {
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, `interests-${width}.png`), fullPage: true });
      }
      const result = page.waitForResponse(async response => {
        const pathname = new URL(response.url()).pathname;
        if (pathname !== routePath && pathname !== '/api/planner-status') return false;
        if (!response.ok()) return false;
        const body = await response.json();
        return body.days?.[0]?.primary_route?.main_stops?.some(stop => stop.covered_preferences?.includes('art_museums'));
      });
      await page.getByRole('button', { name: 'Update day', exact: true }).click();
      const stops = assertStops(await (await result).json(), ['bakeries', 'art_museums']);
      await page.waitForFunction(labels => {
        const rows = [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button')];
        return rows.length === labels.length && rows.every((row, i) => row.textContent.includes(labels[i]));
      }, stops.map(stop => stop.label));
      assert.equal(requests.length, requestCount + 1);
      assert.deepEqual(requests.at(-1).preferences, ['bakeries', 'art_museums']);
      assert.deepEqual(requests.at(-1).preference_priority, ['art_museums', 'bakeries']);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});
