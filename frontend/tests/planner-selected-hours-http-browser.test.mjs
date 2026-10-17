/**
 * Built Planner -> real HTTP handlers/composer/publisher. The free-text URL is
 * ordinary Planner entry, not landing-form acceptance. Only trusted place rows,
 * resolver/weather/clock and the external website transport are controlled.
 * No product API interception, live providers or deployment acceptance.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { buildApp } = require('../../server/app');
const { createNominatimPlaceResolver } = require('../../server/place-candidates/place-resolver');
const { createOperatorVisitEnricher } = require('../../server/place-candidates/operator-visit-evidence');
const { createSourceCache } = require('../../server/place-candidates/source-cache');
const { externalRecord, makeLoader } = require('../../tests/helpers/planner-reservoir-compare');
const NOW = '2026-10-17T10:00:00Z';
const DATE = '2026-10-18';
const COMPOSE_PATHS = new Set(['/api/route-recommendations', '/api/planner-status']);
const records = Array.from({ length: 3 }, (_, index) => ({
  ...externalRecord(`selected-${index}`, `Selected museum ${index}`, 'museum', 55.6 + index * .001, 13, ['museum']),
  website: `https://museum-${index}.example/`,
}));
const stopsOf = body => body.days?.[0]?.primary_route?.main_stops || [];
let browser;
test.before(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
});
test.after(async () => { await browser?.close(); });

function sourcePage(record, mode) {
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org',
    '@type': 'Museum', name: record.name, url: record.website,
    geo: { '@type': 'GeoCoordinates', latitude: record.lat, longitude: record.lng },
    ...(mode === 'known' ? { openingHours: record.id === 'selected-0' ? 'Mo-Sa 10:00-17:00; Su off' : 'Mo-Su 10:00-17:00' } : {}),
  })}</script>`;
}

async function harness(t, mode) {
  const websiteRequests = [], resolverRequests = [], composeRequests = [], errors = [];
  let collections = 0;
  const rawLoader = makeLoader(records);
  const loader = async (...args) => { collections++; return rawLoader(...args); };
  loader.enrich = createOperatorVisitEnricher({
    now: () => Date.parse(NOW), cache: createSourceCache(), hoursCache: createSourceCache({ now: () => Date.parse(NOW) }),
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    fetcher: async url => {
      websiteRequests.push(url);
      const record = records.find(record => record.website === url);
      assert.ok(record, 'only a selected trusted website can choose the source transport URL');
      return new Response(mode === 'failed' ? 'Unavailable' : sourcePage(record, mode),
        { status: mode === 'failed' ? 503 : 200, headers: { 'Content-Type': 'text/html' } });
    },
  });
  const resolver = createNominatimPlaceResolver({ fetcher: async input => {
    resolverRequests.push(String(input));
    assert.equal(new URL(String(input)).searchParams.get('q'), 'Fixturehaven');
    return { ok: true, status: 200, json: async () => [{ display_name: 'Fixturehaven, Fixture Country',
      name: 'Fixturehaven', lat: '55.6', lon: '13', importance: .55, osm_type: 'relation', osm_id: 909090,
      place_rank: 16, class: 'place', type: 'city', address: { city: 'Fixturehaven', country: 'Fixture Country' },
    }] };
  } });
  const server = buildApp({ openDataLoader: loader, placeResolver: resolver, placeSuggestions: null,
    eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null, clock: { now: () => NOW },
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Stockholm' });
  t.after(() => context.close());
  // External browser assets only. Same-origin API requests reach the real app.
  await context.route(url => url.origin !== origin, route => route.abort());
  await context.addInitScript(epoch => {
    const NativeDate = window.Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [epoch])); }
      static now() { return epoch; }
    };
  }, Date.parse(NOW));
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/route-recommendations') {
      composeRequests.push({ payload: request.postDataJSON(), prefer: request.headers().prefer });
    }
  });
  t.after(() => assert.deepEqual(errors, [], 'built Planner raises no browser/React exceptions'));
  const published = page.waitForResponse(async response => {
    if (!COMPOSE_PATHS.has(new URL(response.url()).pathname) || response.status() !== 200) return false;
    try { return stopsOf(await response.json()).length > 0; } catch { return false; }
  }).then(response => response.json());
  await page.goto(`${origin}/anywhere?place=Fixturehaven&prefs=culture&day=1&rhythm=full&lang=en`);
  const body = await published;
  const stops = stopsOf(body);
  await page.waitForFunction(names => {
    const rows = [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button')];
    return rows.length === names.length && names.every((name, index) => rows[index].textContent.includes(name));
  }, stops.map(stop => stop.label || stop.name));
  assert.equal(body.days[0].date, DATE);
  assert.equal(body.agnostic_route_output_experiment.intake.status, 'resolved');
  assert.equal(body.agnostic_route_output_experiment.walking_validation.valid, true);
  assert.equal(composeRequests.length, 1, 'one ordinary URL entry submits one compose');
  assert.equal(composeRequests[0].prefer, 'respond-async', 'the built UI uses the modern cold lifecycle');
  assert.equal(composeRequests[0].payload.place, 'Fixturehaven');
  assert.equal(composeRequests[0].payload.place_selection, undefined, 'free text does not invent an autocomplete choice');
  assert.deepEqual(composeRequests[0].payload.dates, [DATE]);
  assert.deepEqual(composeRequests[0].payload.preferences, ['culture']);
  assert.equal(resolverRequests.length, 1);
  assert.equal(collections, 1, 'hours replay consumes the original frozen supply');
  assert.equal(websiteRequests.length, 3, 'selected website checks do not retry or reacquire supply');
  assert.equal(new Set(websiteRequests).size, 3);
  const route = page.getByRole('region', { name: 'The route', exact: true });
  const first = stops[0];
  await page.getByRole('list', { name: 'The stops, in order', exact: true }).locator(':scope > li > button').first().click();
  const panel = route.locator('#route-stop-panel-0');
  await panel.getByRole('link', { name: 'Website', exact: true }).waitFor();
  assert.equal(await panel.getByRole('link', { name: 'Website', exact: true }).getAttribute('href'), first.website);
  assert.equal(await panel.getByRole('button', { name: 'Replace', exact: true }).count(), 1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('parranda:anywhere:last')));
  assert.deepEqual(stopsOf(saved.safeResponse).map(stop => stop.id), stops.map(stop => stop.id),
    'the remembered day and the rendered day share the published identities');
  const evidenceDir = process.env.PARRANDA_SELECTED_HOURS_EVIDENCE_DIR;
  if (evidenceDir) {
    mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: join(evidenceDir, `${mode}-built-ui.png`), fullPage: true });
    writeFileSync(join(evidenceDir, `${mode}-built-ui.json`), JSON.stringify({
      boundary: 'built UI -> actual local HTTP -> real composer/publisher; controlled external source transport; not deployment or live-provider acceptance',
      date: DATE, requests: composeRequests, source_requests: websiteRequests, resolver_requests: resolverRequests,
      stops, pipeline: body.agnostic_route_output_experiment.eligibility.checks.candidate_pipeline, errors,
    }, null, 2));
  }
  t.diagnostic(JSON.stringify({ mode, real_http: true, selected_date: DATE,
    published_ids: stops.map(stop => stop.id), website_checks: websiteRequests.length, source_collections: collections }));
  return { body, stops, route, panel };
}

for (const mode of ['unknown', 'failed']) test(`built Planner keeps source-${mode} hours honest and offers Website plus Replace`, { timeout: 30000 }, async t => {
  const { stops, route, panel } = await harness(t, mode);
  assert.equal(stops.length, 3);
  assert.ok(stops.every(stop => stop.selected_day_hours === undefined && stop.open_now === undefined));
  assert.match(await route.innerText(), /Opening hours unavailable/);
  assert.match(await panel.innerText(), /Opening hours unavailable for the selected day/);
  assert.doesNotMatch(await panel.innerText(), /open now|currently open|Source hours for selected day/i);
});

test('built Planner publishes source hours and excludes an observed closed selected place through normal gates', { timeout: 30000 }, async t => {
  const { body, stops, route, panel } = await harness(t, 'known');
  assert.deepEqual(stops.map(stop => stop.id).sort(), ['selected-1', 'selected-2']);
  assert.equal(body.agnostic_route_output_experiment.eligibility.checks.candidate_pipeline.availability_excluded_candidate_count, 1);
  for (const stop of stops) {
    assert.equal(stop.selected_day_hours.status, 'known');
    assert.deepEqual(stop.selected_day_hours.windows, [{ opens: '10:00', closes: '17:00' }]);
    assert.equal(stop.selected_day_hours.date, DATE);
    assert.equal(stop.selected_day_hours.timezone, 'Europe/Stockholm');
    assert.equal(stop.selected_day_hours.source_url, stop.website);
    assert.equal(stop.selected_day_hours.observed_at, '2026-10-17T10:00:00.000Z');
    assert.equal(stop.open_now, undefined);
  }
  assert.match(await panel.innerText(), /Source hours for selected day: 10:00–17:00/);
  assert.doesNotMatch(await route.innerText(), /Selected museum 0|Opening hours unavailable|open now|currently open/i);
});
