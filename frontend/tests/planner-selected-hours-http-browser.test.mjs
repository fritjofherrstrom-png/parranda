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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const OWNER_WEBSITE = 'https://www.uu.se/gustavianum';
const OWNER_HOURS_URL = 'https://www.uu.se/gustavianum/besok-oss/oppettider';
const OWNER_ID = 'overture-4c66d132-2f58-4ec2-b45e-97f8207d9158';
const SEASONAL_NOW = '2026-10-18T10:00:00Z';
const SEASONAL_DATE = '2026-10-19';
const seasonalPages = new Map([
  [OWNER_WEBSITE, readFileSync(new URL('../../tests/fixtures/selected-place-visit-hours/gustavianum-entry.html', import.meta.url), 'utf8')],
  [OWNER_HOURS_URL, readFileSync(new URL('../../tests/fixtures/selected-place-visit-hours/gustavianum-hours.html', import.meta.url), 'utf8')],
]);
// The existing trusted-source scaffold controls candidate admission; the owner
// HTML and supplied identity/coordinates are recorded factual input. No source
// trust is inferred from the hours page and no external provider is contacted.
const seasonalRecords = [
  { id: OWNER_ID, name: 'Gustavianum', type: 'museum', lat: 59.85794448852539, lng: 17.63179588317871,
    tags: ['museum'], website: OWNER_WEBSITE, sources: [
      { provider: 'overture', family: 'open_directory', tier: 'inferred', url: 'https://overturemaps.org/' },
      { provider: 'wikidata', family: 'open_knowledge', tier: 'inferred', url: 'https://www.wikidata.org/wiki/Q1506922' },
    ] },
  ...records.slice(1).map((record, index) => ({ ...record,
    lat: 59.85794448852539 + (index + 1) * .001, lng: 17.63179588317871 })),
];
const cafeRecord = { ...externalRecord('selected-cafe', 'Centralkonditoriet', 'cafe', 59.856815338134766, 17.64398193359375, ['coffee']), website: 'http://www.centralkonditoriet.com/' };
const cafeRecords = [cafeRecord, ...records.slice(1).map((row, index) => ({ ...row, type: 'cafe', tags: ['coffee'],
  lat: cafeRecord.lat + (index + 1) * .001, lng: cafeRecord.lng }))];
const cafeHtml = readFileSync(new URL('../../tests/fixtures/selected-place-visit-hours/centralkonditoriet-owner-structure.html', import.meta.url), 'utf8');
const stopsOf = body => body.days?.[0]?.primary_route?.main_stops || [];
const contextStopsOf = body => body.place_structure?.district_day?.areas?.flatMap(area => area.stops || []) || [];
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
  const seasonal = ['recorded-seasonal', 'recorded-holiday', 'recorded-closure'].includes(mode);
  const cafe = mode === 'recorded-cafe';
  const fixtureRecords = cafe ? cafeRecords : seasonal ? seasonalRecords : records;
  const now = seasonal || cafe ? SEASONAL_NOW : NOW;
  const viewerNow = mode === 'recorded-holiday' ? '2026-10-30T10:00:00Z' : mode === 'recorded-closure' ? '2026-12-23T10:00:00Z' : now;
  const date = mode === 'recorded-holiday' ? '2026-10-31' : mode === 'recorded-closure' ? '2026-12-24' : seasonal || cafe ? SEASONAL_DATE : DATE;
  const preference = cafe ? 'fika' : 'culture';
  const anchor = fixtureRecords[0];
  const websiteRequests = [], resolverRequests = [], composeRequests = [], errors = [];
  let collections = 0;
  const rawLoader = makeLoader(fixtureRecords);
  const loader = async (...args) => { collections++; return rawLoader(...args); };
  loader.enrich = createOperatorVisitEnricher({
    now: () => Date.parse(now), cache: createSourceCache(), hoursCache: createSourceCache({ now: () => Date.parse(now) }),
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    fetcher: async url => {
      websiteRequests.push(url);
      if (cafe && url === 'https://www.centralkonditoriet.com/') return new Response(cafeHtml,
        { status: 200, headers: { 'Content-Type': 'text/html' } });
      if (seasonalPages.has(url) && seasonal) return new Response(seasonalPages.get(url),
        { status: 200, headers: { 'Content-Type': 'text/html' } });
      const record = fixtureRecords.find(record => record.website === url);
      assert.ok(record, 'only a selected trusted website can choose the source transport URL');
      return new Response(mode === 'failed' ? 'Unavailable' : sourcePage(record, mode),
        { status: mode === 'failed' ? 503 : 200, headers: { 'Content-Type': 'text/html' } });
    },
  });
  const resolver = createNominatimPlaceResolver({ fetcher: async input => {
    resolverRequests.push(String(input));
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://nominatim.openstreetmap.org');
    if (url.pathname === '/search') {
      assert.equal(url.searchParams.get('q'), 'Fixturehaven');
      assert.equal(url.searchParams.get('osm_ids'), null);
    } else {
      assert.equal(url.pathname, '/lookup', 'only the source-owned reference may resolve a reload');
      assert.equal(url.searchParams.get('osm_ids'), 'R909090');
      assert.equal(url.searchParams.get('q'), null);
    }
    assert.equal(url.searchParams.get('format'), 'jsonv2');
    assert.equal(url.searchParams.get('addressdetails'), '1');
    assert.equal(url.searchParams.get('namedetails'), '1');
    return { ok: true, status: 200, json: async () => [{ display_name: 'Fixturehaven, Fixture Country',
      name: 'Fixturehaven', lat: String(anchor.lat), lon: String(anchor.lng), importance: .55, osm_type: 'relation', osm_id: 909090,
      place_rank: 16, class: 'place', type: 'city', address: { city: 'Fixturehaven', country: 'Fixture Country' },
    }] };
  } });
  const server = buildApp({ openDataLoader: loader, placeResolver: resolver, placeSuggestions: null,
    eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null, clock: Object.assign(() => new Date(now), { now: () => now }),
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
  }, Date.parse(viewerNow));
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
  await page.goto(`${origin}/anywhere?place=Fixturehaven&prefs=${preference}&day=1&rhythm=full&lang=en`);
  const body = await published;
  const stops = stopsOf(body);
  await page.waitForFunction(names => {
    const rows = [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button')];
    return rows.length === names.length && names.every((name, index) => rows[index].textContent.includes(name));
  }, stops.map(stop => stop.label || stop.name));
  assert.equal(body.days[0].date, date);
  assert.equal(body.agnostic_route_output_experiment.context?.time?.now?.slice(0, 10), now.slice(0, 10),
    'the actual composition uses the controlled clock rather than the wall date');
  assert.equal(body.agnostic_route_output_experiment.intake.status, 'resolved');
  assert.equal(body.agnostic_route_output_experiment.walking_validation.valid, true);
  assert.equal(composeRequests.length, 1, 'one ordinary URL entry submits one compose');
  assert.equal(composeRequests[0].prefer, 'respond-async', 'the built UI uses the modern cold lifecycle');
  assert.equal(composeRequests[0].payload.place, 'Fixturehaven');
  assert.equal(composeRequests[0].payload.place_selection, undefined, 'free text does not invent an autocomplete choice');
  assert.deepEqual(composeRequests[0].payload.dates, [date]);
  assert.deepEqual(composeRequests[0].payload.preferences, [preference]);
  assert.equal(resolverRequests.length, 1);
  assert.equal(collections, 1, 'hours replay consumes the original frozen supply');
  if (!seasonal) {
    assert.equal(websiteRequests.length, 3, 'selected website checks do not retry or reacquire supply');
    assert.equal(new Set(websiteRequests).size, 3);
  }
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
      date, context_time: body.agnostic_route_output_experiment.context.time.now, requests: composeRequests, source_requests: websiteRequests, resolver_requests: resolverRequests,
      stops, context_stops: contextStopsOf(body),
      pipeline: body.agnostic_route_output_experiment.eligibility.checks.candidate_pipeline, errors,
    }, null, 2));
  }
  t.diagnostic(JSON.stringify({ mode, real_http: true, selected_date: date,
    published_ids: stops.map(stop => stop.id), website_checks: websiteRequests.length, source_collections: collections }));
  return { body, stops, route, panel, page, websiteRequests, composeRequests,
    get collections() { return collections; } };
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
  const closedContext = body.place_structure?.district_day?.areas?.flatMap(area => area.stops || [])
    .find(stop => stop.id === 'selected-0');
  assert.equal(closedContext?.selected_day_hours?.status, 'closed',
    'the broader source context retains the selected-day fact used to withhold the detour');
  const detours = route.getByRole('button', { name: /detour ideas? near your route/ });
  if (await detours.count()) await detours.click();
  assert.equal(await detours.count(), 0, 'a known-closed place is not offered as an optional detour');
  assert.doesNotMatch(await route.innerText(), /Selected museum 0|Opening hours unavailable|open now|currently open/i);
});

test('built Planner withholds a recorded seasonal Monday closure across reload and keeps Tuesday hours unknown', { timeout: 30000 }, async t => {
  const f = await harness(t, 'recorded-seasonal');
  const evidenceDir = process.env.PARRANDA_SELECTED_HOURS_EVIDENCE_DIR;
  const observations = [{ stage: 'monday', body: f.body }];
  t.after(() => {
    if (!evidenceDir) return;
    writeFileSync(join(evidenceDir, 'recorded-seasonal-journey.json'), JSON.stringify({
      boundary: 'built UI -> real local HTTP -> enricher/composer/publisher; recorded owner HTML; controlled source identity scaffold; no product API response mocks or provider traffic',
      observations, requests: f.composeRequests, source_requests: f.websiteRequests, source_collections: f.collections,
    }, null, 2));
  });
  const assertMonday = async (body, page) => {
    assert.deepEqual(stopsOf(body).map(stop => stop.id).sort(), ['selected-1', 'selected-2'],
      'the recorded owner states that this selected Monday is closed');
    assert.equal(body.days[0].date, '2026-10-19');
    assert.equal(body.agnostic_route_output_experiment.walking_validation.valid, true);
    assert.equal(body.agnostic_route_output_experiment.eligibility.checks.candidate_pipeline.availability_excluded_candidate_count, 1);
    assert.ok(stopsOf(body).every(stop => stop.selected_day_hours === undefined && stop.open_now === undefined),
      'unknown-hour neighbors remain eligible without borrowing owner hours');
    assert.deepEqual(contextStopsOf(body).find(stop => stop.id === OWNER_ID)?.selected_day_hours, {
      status: 'closed', all_day: false, windows: [], date: '2026-10-19', timezone: 'Europe/Stockholm',
      source_url: OWNER_HOURS_URL, observed_at: '2026-10-18T10:00:00.000Z',
    }, 'the exact dated closure and linked-page provenance survive on broader source context');
    const route = page.getByRole('region', { name: 'The route', exact: true });
    const detours = route.getByRole('button', { name: /detour ideas? near your route/ });
    if (await detours.count()) await detours.click();
    assert.doesNotMatch(await route.innerText(), /Gustavianum|open now|currently open/i,
      'the owner-closed place cannot return as a route stop or optional detour');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('parranda:anywhere:last')));
    assert.equal(saved.dateIso, '2026-10-19');
    assert.deepEqual(stopsOf(saved.safeResponse).map(stop => stop.id).sort(), ['selected-1', 'selected-2']);
    assert.deepEqual(contextStopsOf(saved.safeResponse).find(stop => stop.id === OWNER_ID)?.selected_day_hours,
      contextStopsOf(body).find(stop => stop.id === OWNER_ID)?.selected_day_hours);
  };
  const nextPublished = () => f.page.waitForResponse(async response => {
    if (!COMPOSE_PATHS.has(new URL(response.url()).pathname) || response.status() !== 200) return false;
    try { return stopsOf(await response.json()).length > 0; } catch { return false; }
  }).then(response => response.json());
  const waitRendered = body => f.page.waitForFunction(names => {
    const rows = [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button')];
    return rows.length === names.length && names.every((name, index) => rows[index].textContent.includes(name));
  }, stopsOf(body).map(stop => stop.label || stop.name));

  await assertMonday(f.body, f.page);
  assert.deepEqual(f.websiteRequests.slice().sort(),
    [OWNER_WEBSITE, OWNER_HOURS_URL, 'https://museum-1.example/', 'https://museum-2.example/'].sort(),
    'only the selected websites and one source-owned visit-hours link are read');

  const reloaded = nextPublished();
  await f.page.reload();
  const mondayAgain = await reloaded;
  observations.push({ stage: 'monday-reload', body: mondayAgain });
  await waitRendered(mondayAgain);
  await assertMonday(mondayAgain, f.page);
  assert.equal(f.composeRequests.length, 2, 'reload owns one new intent, without a replay submission');
  assert.equal(f.collections, 2, 'each intent reuses its own single frozen supply acquisition');
  assert.ok(f.websiteRequests.length <= 8, 'reload cannot expand the bounded source reads');
  if (evidenceDir) await f.page.screenshot({ path: join(evidenceDir, 'recorded-seasonal-monday-reload.png'), fullPage: true });

  // The server source cache and observed-at clock remain unchanged. Moving the
  // viewer's clock to Tuesday and choosing Today asks that cache another date.
  await f.page.evaluate(epoch => {
    const NativeDate = window.Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [epoch])); }
      static now() { return epoch; }
    };
  }, Date.parse('2026-10-20T10:00:00Z'));
  const nextDay = nextPublished();
  await f.page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await f.page.getByRole('group', { name: 'Which day', exact: true })
    .getByRole('button', { name: 'Today', exact: true }).click();
  const tuesday = await nextDay;
  observations.push({ stage: 'tuesday-same-source-cache', body: tuesday });
  await waitRendered(tuesday);
  assert.equal(tuesday.days[0].date, '2026-10-20');
  assert.deepEqual(f.composeRequests.map(request => request.payload.dates),
    [['2026-10-19'], ['2026-10-19'], ['2026-10-20']]);
  assert.equal(f.collections, 3);
  assert.deepEqual(stopsOf(tuesday).map(stop => stop.id).sort(), [OWNER_ID, 'selected-1', 'selected-2'].sort(),
    'a cached Monday closure cannot exclude Tuesday');
  assert.equal(tuesday.agnostic_route_output_experiment.walking_validation.valid, true);
  assert.ok(stopsOf(tuesday).every(stop => stop.open_now === undefined && (stop.selected_day_hours === undefined || stop.selected_day_hours.status === 'unknown')),
    'unknown-hour neighbors cannot borrow owner facts');
  assert.equal(contextStopsOf(tuesday).find(stop => stop.id === OWNER_ID)?.selected_day_hours?.status, 'unknown');
  const ownerButton = f.page.getByRole('list', { name: 'The stops, in order', exact: true })
    .locator(':scope > li > button').filter({ hasText: 'Gustavianum' });
  await ownerButton.click();
  const ownerPanel = f.page.getByRole('region', { name: 'The route', exact: true });
  assert.match(await ownerPanel.innerText(), /Regular hours: 12:00–17:00.*Selected day unconfirmed/);
  assert.equal(await ownerPanel.getByRole('link', { name: 'Website', exact: true }).getAttribute('href'), OWNER_WEBSITE);
  assert.doesNotMatch(await ownerPanel.innerText(), /Source hours for selected day|open now|currently open/i);
  if (evidenceDir) await f.page.screenshot({ path: join(evidenceDir, 'recorded-seasonal-tuesday.png'), fullPage: true });
});


test('built UI publishes actual owner date override and withholds dated closure without permanent inactivity', { timeout: 60000 }, async t => {
  for (const mode of ['recorded-holiday', 'recorded-closure']) {
    const f = await harness(t, mode);
    const stop = stopsOf(f.body).find(row => row.id === OWNER_ID);
    if (mode === 'recorded-holiday') {
      assert.equal(stop.selected_day_hours.status, 'known');
      assert.deepEqual(stop.selected_day_hours.windows, [{ opens: '12:00', closes: '17:00' }]);
      const button = f.page.getByRole('list', { name: 'The stops, in order', exact: true }).locator(':scope > li > button').filter({ hasText: 'Gustavianum' });
      if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
      assert.match(await f.route.innerText(), /Source hours for selected day: 12:00–17:00/);
    } else {
      assert.equal(stop, undefined);
      const withheld = contextStopsOf(f.body).find(row => row.id === OWNER_ID);
      assert.equal(withheld.selected_day_hours.status, 'closed');
      assert.equal(withheld.selected_day_hours.date, '2026-12-24');
      assert.notEqual(withheld.opening_hours, 'off');
      assert.doesNotMatch(await f.route.innerText(), /Gustavianum/);
    }
  }
});

test('built UI displays recorded café ordinary hours conditionally through HTTP and ordinary reload', { timeout: 30000 }, async t => {
  const f = await harness(t, 'recorded-cafe');
  const verify = async body => {
    const stop = stopsOf(body).find(row => row.id === cafeRecord.id);
    assert.ok(stop, 'unresolved holiday conditions do not prohibit a route');
    assert.equal(stop.selected_day_hours.status, 'unknown');
    assert.equal(stop.open_now, undefined);
    assert.equal(stop.selected_day_hours.ordinary_status, 'known');
    assert.deepEqual(stop.selected_day_hours.ordinary_windows, [{ opens: '06:30', closes: '18:00' }]);
    const button = f.page.getByRole('list', { name: 'The stops, in order', exact: true }).locator(':scope > li > button').filter({ hasText: cafeRecord.name });
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
    assert.match(await f.route.innerText(), /Regular hours: 06:30–18:00.*Holiday hours unconfirmed/);
    assert.doesNotMatch(await f.route.innerText(), /currently open|open now|Source hours for selected day/i);
    return stop.selected_day_hours;
  };
  const originalFact = await verify(f.body);
  const reloaded = f.page.waitForResponse(async response => {
    if (!COMPOSE_PATHS.has(new URL(response.url()).pathname) || response.status() !== 200) return false;
    try { return stopsOf(await response.json()).some(row => row.id === cafeRecord.id); } catch { return false; }
  }).then(response => response.json());
  await f.page.reload();
  const body = await reloaded;
  await f.page.getByRole('list', { name: 'The stops, in order', exact: true }).locator(':scope > li > button').filter({ hasText: cafeRecord.name }).waitFor();
  assert.deepEqual(await verify(body), originalFact, 'reload keeps original observation and qualified uncertainty');
  assert.equal(f.collections, 2);
  assert.equal(f.websiteRequests.filter(url => url.includes('centralkonditoriet')).length, 1, 'date-independent calendar reused without refetch');
});
