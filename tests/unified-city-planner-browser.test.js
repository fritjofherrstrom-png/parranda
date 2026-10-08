'use strict';
// Full built UI in Chromium; API fixtures and blocked external hosts.
// Proves entry, map and interaction parity, not provider or deployed acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const DATE = '2026-10-07';
const HEALTH = Object.fromEntries(['selected_source_count', 'responding_source_count', 'event_bearing_source_count',
  'empty_source_count', 'failed_source_count', 'unavailable_source_count', 'raw_event_count',
  'normalized_event_count', 'out_of_period_event_count', 'accepted_event_count', 'surfaced_event_count', 'rejected_event_count'].map(key => [key, 0]));
let runtime;
async function start() {
  if (!runtime) runtime = (async () => {
    const browser = await chromium.launch({ ...(process.env.PARRANDA_TEST_CHROMIUM
      ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}), headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const server = buildApp({ openDataLoader: null, eventSupply: null, placeResolver: null, reviewedPlaceSource: null }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    return { browser, server, origin: `http://127.0.0.1:${server.address().port}` };
  })();
  return runtime;
}
test.after(async () => {
  if (!runtime) return;
  const { browser, server } = await runtime;
  await browser.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
function day(label, anchor, payload) {
  const points = ['a', 'b', 'c', 'extra'].map((id, index) => ({ id, label: `${label} ${id}`, name: `${label} ${id}`,
    type: index % 2 ? 'cafe' : 'museum', lat: anchor.lat + index * .001, lng: anchor.lng + index * .001,
    covered_preferences: [index % 2 ? 'coffee' : 'museums'], commitment_eligible: true }));
  const ids = new Set(['a', 'b', 'c', ...(payload.pinned_candidate_ids || [])]);
  const excluded = new Set(payload.excluded_candidate_ids || []);
  const stops = points.filter(p => ids.has(p.id) && !excluded.has(p.id));
  return { days: [{ date: DATE, experimental_agnostic_route_applied: true,
    primary_route: { id: '__agnostic_compose__', main_stops: stops, estimated_km: 1.5,
      legs: [], map_route_points: [], map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })), confidence: 'medium' }, alternatives: [] }],
    place_structure: { provenance: 'agnostic_anchor', area_count: 1, district_day: {
      areas: [{ center: anchor, stops: [points[3]], stop_names: [points[3].name], stop_ids: ['extra'], covers: ['coffee'], size: 1 }],
      legs: [], covered_intents: [], missing_intents: [] } },
    live_events: { selected_date: DATE, coverage: 'covered', tonight: [], this_week: [],
      acquisition: { source_health: { ...HEALTH, status: 'healthy', result: 'empty', reasons: [], selected_source_count: 1, responding_source_count: 1, empty_source_count: 1 } } },
    agnostic_route_output_experiment: { promotion: { promote: true, readiness: 'promotable' },
      intake: { status: 'resolved', query: label, resolved: { ...anchor, label } }, source_status: { anchor },
      pinned_candidates: { unhonored: [] } } };
}
for (const [label, path, anchor] of [
  ['Rome', '/rome', { lat: 41.889, lng: 12.47 }],
  ['Barcelona', '/barcelona/plan', { lat: 41.3874, lng: 2.1686 }],
  ['Athens', '/anywhere?city=athens&place=Athens', { lat: 37.9838, lng: 23.7275 }],
  ['Stockholm', '/anywhere?place=Stockholm', { lat: 59.3293, lng: 18.0686 }],
]) test(`${label} uses the same map, add/remove and Live UI`, { timeout: 60000 }, async t => {
  const { browser, origin } = await start();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const composes = [], liveQueries = [], errors = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/api/route-recommendations') {
      const payload = route.request().postDataJSON(); composes.push(payload);
      return route.fulfill({ json: day(label, anchor, payload) });
    }
    if (url.pathname === '/api/live-events') {
      const payload = route.request().postDataJSON(); liveQueries.push(payload);
      return route.fulfill({ json: { contract: 'live_event_query_v1', live_events: { ...day(label, anchor, {}).live_events,
        acquisition: { source_health: { ...HEALTH, status: 'healthy', result: 'events_found', reasons: [], selected_source_count: 1, responding_source_count: 1, event_bearing_source_count: 1, raw_event_count: 1, normalized_event_count: 1, accepted_event_count: 1, surfaced_event_count: 1 } },
        // This fixture occurs on the selected day: the contract puts it in
        // tonight, not the following-days bucket. The Live hierarchy preserves
        // the chosen day rather than switching to week when tonight is empty.
        tonight: [{ id: 'event', title: `${label} concert`, starts_at: `${DATE}T18:00:00Z`, timezone: ({ Rome: 'Europe/Rome', Barcelona: 'Europe/Madrid', Athens: 'Europe/Athens', Stockholm: 'Europe/Stockholm' })[label],
          source_url: 'https://calendar.example/event', source_label: 'Fixture calendar', lat: anchor.lat, lng: anchor.lng } ] }, query: { scope: payload.scope, time: payload.time, selected_date: payload.selected_date }, route_mutation: false, day_anchor_mutation: false } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { error: 'outside fixture scope' } });
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(`${DATE}T10:00:00Z`));
  await page.goto(`${origin}${path}`);
  assert.equal(new URL(page.url()).pathname, '/anywhere');
  assert.equal(new URL(page.url()).searchParams.has('city'), false);
  const region = page.getByRole('region', { name: 'The route', exact: true });
  await region.locator('.route-map-marker').nth(2).waitFor();
  assert.equal(composes[0].place, label);
  for (const payload of composes) {
    assert.ok(!('city' in payload));
    assert.equal(payload.agnostic_engine_compose, 1);
  }
  await page.getByRole('button', { name: 'Expand map', exact: true }).click();
  await page.getByRole('button', { name: 'Shrink map', exact: true }).waitFor();
  await region.locator('.route-map-marker').first().click();
  await region.locator('[data-route-map]').getByText(`${label} a`, { exact: true }).waitFor();
  await region.locator('button[aria-controls="route-stop-panel-0"]').click();
  await page.getByRole('button', { name: 'Keep this one', exact: true }).waitFor();
  const keepResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/route-recommendations');
  await page.getByRole('button', { name: 'Keep this one', exact: true }).click();
  await keepResponse;
  assert.deepEqual(composes.at(-1).pinned_candidate_ids, ['a']);
  // The next rendered day must retain the pin and can dismiss another stop.
  await region.locator('button[aria-controls="route-stop-panel-1"]').click();
  const removeResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/route-recommendations');
  await page.getByRole('button', { name: 'Not this one', exact: true }).click();
  await removeResponse;
  assert.deepEqual(composes.at(-1).excluded_candidate_ids, ['b']);
  await page.getByRole('button', { name: /detour idea.*near your route/ }).click();
  await page.getByRole('button', { name: `${label} extra`, exact: true }).click();
  const addResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/route-recommendations');
  await page.getByRole('button', { name: 'Add to my day', exact: true }).click();
  await addResponse;
  assert.deepEqual(composes.at(-1).pinned_candidate_ids, ['a', 'extra']);
  const beforeLive = composes.length;
  await page.getByRole('button', { name: /See all live|Explore live/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Whole area', exact: true }).click();
  // This fixture is on the selected day. Changing area must preserve that
  // tab, and a same-day event must not require a switch to following days.
  assert.equal(await dialog.getByRole('button', { name: 'Following 7 days', exact: true }).getAttribute('aria-pressed'), 'false');
  await dialog.getByText(`${label} concert`, { exact: true }).waitFor();
  assert.equal(liveQueries[0].selected_date, DATE);
  assert.equal(liveQueries[0].place_query, label);
  assert.deepEqual(liveQueries[0].anchor, anchor);
  assert.equal(composes.length, beforeLive, 'Live exploration does not recompose the day');
  assert.deepEqual(errors, [], 'no browser/React errors');
});
