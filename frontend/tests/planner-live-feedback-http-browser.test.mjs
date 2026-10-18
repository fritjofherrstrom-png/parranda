/** Built UI -> real HTTP/composer; controlled trusted rows and external source transport only. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { buildApp } = require('../../server/app');
const { collectAnchorEvents, resolveDefaultEventSupply, HELSINKI_LINKED_EVENTS_FEED } = require('../../server/place-candidates/agnostic-event-supply');
const { createSourceCache } = require('../../server/place-candidates/source-cache');
const { createOperatorVisitEnricher } = require('../../server/place-candidates/operator-visit-evidence');
const { rows } = require('../../tests/helpers/day-composition-fixtures');
const NOW = '2026-10-17T08:00:00Z', DATE = '2026-10-18';
const ANCHOR = { lat: 60.17, lng: 24.94 };
const LAST = 'parranda:anywhere:last';
const paths = new Set(['/api/route-recommendations', '/api/planner-status']);
const stopsOf = body => body?.days?.[0]?.primary_route?.main_stops || [];
const identities = entry => stopsOf(entry.safeResponse).map(stop => [stop.id, stop.live_occurrence_id || null]);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const savedDay = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), LAST);
let browser;
test.before(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
});
test.after(async () => { await browser?.close(); });

function waitForPublished(page, predicate) {
  return page.waitForResponse(async response => {
    if (!paths.has(new URL(response.url()).pathname) || response.status() !== 200) return false;
    try { return predicate(await response.json()); } catch { return false; }
  }).then(response => response.json());
}

async function harness(t, initialMode) {
  const sourceRequests = [], websiteRequests = [], requests = [], responses = [], errors = [], checkpoints = [];
  let current, lastSourceArgs, passed = false;
  const records = [...rows('culture', 'museum', 7), ...rows('views', initialMode === 'empty' ? 'park' : 'viewpoint', 2)]
    .map(record => ({ ...record, lat: record.lat + 4.57, lng: record.lng + 11.94,
      website: `https://${record.id}.example/` }));
  const event = { id: 'feedback-concert', name: { en: 'Source evening concert' },
    start_time: `${DATE}T18:00:00Z`, end_time: `${DATE}T20:00:00Z`,
    location: { position: { coordinates: [24.941, 60.171] }, name: { en: 'Source venue' } },
    info_url: { en: 'https://venue.example/evening-concert' }, data_source: 'controlled-transport',
    keywords: [{ name: { en: 'music' } }] };
  function source(mode) {
    const settled = deferred();
    const run = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: 'enabled',
      PARRANDA_EVENT_FEEDS: JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]),
      PARRANDA_REQUEST_TIME_EVENT_DISCOVERY: 'disabled', PARRANDA_EVENT_READER: 'disabled',
    }, { eventReader: null, requestTimeDiscovery: null, eventCache: createSourceCache(),
      collectEvents: async options => {
        try {
          return await collectAnchorEvents({ ...options, fetcher: async input => {
            const url = new URL(String(input));
            sourceRequests.push({ mode, url: url.href });
            assert.equal(url.origin, 'https://api.hel.fi');
            assert.equal(url.pathname, '/linkedevents/v1/event/');
            return new Response(JSON.stringify({ data: mode === 'healthy' ? [event] : [] }),
              { status: mode === 'failed' ? 503 : 200, headers: { 'Content-Type': 'application/json' } });
          } });
        } finally { settled.resolve(); }
      },
    });
    return { run, settled: settled.promise };
  }
  current = source(initialMode);
  const loader = async () => structuredClone(records);
  loader.enrich = createOperatorVisitEnricher({
    now: () => Date.parse(NOW), cache: createSourceCache(), hoursCache: createSourceCache({ now: () => Date.parse(NOW) }),
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    fetcher: async url => {
      websiteRequests.push(url);
      const record = records.find(record => record.website === url);
      assert.ok(record, 'website transport only receives an existing source-owned identity');
      return new Response(`<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org', '@type': record.type === 'museum' ? 'Museum' : 'Place',
        name: record.name, url: record.website,
        geo: { '@type': 'GeoCoordinates', latitude: record.lat, longitude: record.lng },
        openingHours: 'Mo-Su 10:00-23:00',
      })}</script>`, { headers: { 'Content-Type': 'text/html' } });
    },
  });
  const server = buildApp({ openDataLoader: loader,
    eventSupply: args => { lastSourceArgs = args; return current.run(args); },
    placeResolver: async query => {
      assert.equal(query, 'Fixture Helsinki');
      return [{ ...ANCHOR, label: 'Fixture Helsinki', confidence: 'high', provenance: 'controlled-resolver' }];
    }, placeSuggestions: null, reviewedPlaceSource: null, sourceCatalog: null, clock: Object.assign(() => new Date(NOW), { now: () => NOW }),
    weatherProvider: async () => ({ condition: 'sun', timezone_resolution: {
      timezone: 'Europe/Helsinki', timezone_source: 'weather_provider_auto', utc_offset_seconds: 10800 } }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Helsinki' });
  t.after(() => context.close());
  // Only external browser assets are aborted; product API requests reach Express.
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
    if (new URL(request.url()).pathname === '/api/route-recommendations') requests.push(request.postDataJSON());
  });
  page.on('response', async response => {
    const pathname = new URL(response.url()).pathname;
    if (!paths.has(pathname) && !pathname.startsWith('/api/planner-live-')) return;
    try {
      const body = await response.json(), published = body.result || body;
      responses.push({ pathname, status: response.status(), live_pending: body.live_events?.pending,
        completion: body.live_completion?.state, upgrade: body.live_route_upgrade?.state,
        live_choices: published.agnostic_route_output_experiment?.live_event_choices,
        stops: stopsOf(published).map(stop => [stop.id, stop.live_occurrence_id || null]) });
    } catch { /* An abandoned response is not a publication. */ }
  });
  const evidenceDir = process.env.PARRANDA_LIVE_FEEDBACK_EVIDENCE_DIR;
  async function capture(label) {
    const entry = await savedDay(page);
    checkpoints.push({ label, entry, text: await page.locator('body').innerText() });
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({ path: join(evidenceDir, `${initialMode}-${label}.png`), fullPage: true });
    }
  }
  t.after(() => {
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, `${initialMode}-journey.json`), JSON.stringify({
        outcome: passed ? 'PASS' : 'FAIL',
        boundary: 'built UI -> local HTTP -> real Linked Events normalizer/composer/publisher; controlled source transport, trusted rows/resolver/weather/clock',
        excluded: ['live providers', 'deployment', 'physical device', 'landing-form acceptance'],
        requests, responses, sourceRequests, websiteRequests, checkpoints, errors,
      }, null, 2));
    }
    assert.deepEqual(errors, [], 'built UI raises no browser/React exceptions');
    t.diagnostic(JSON.stringify({ initialMode, compose_posts: requests.length, source_transport_calls: sourceRequests.length }));
  });
  const initial = waitForPublished(page, body => stopsOf(body).length > 0);
  await page.goto(`${origin}/anywhere?place=Fixture%20Helsinki&prefs=culture,views${initialMode === 'empty' ? '&prio=views' : ''}&day=1&rhythm=full&lang=en`);
  const body = await initial;
  assert.equal(body.days[0].date, DATE);
  assert.equal(body.agnostic_route_output_experiment.context?.time?.now?.slice(0, 10), '2026-10-17',
    'the actual composition must use the controlled clock rather than the wall date');
  assert.equal(body.agnostic_route_output_experiment.walking_validation.valid, true);
  assert.ok(websiteRequests.length > 0 && websiteRequests.length <= 4, 'selected-hours checks share the bounded identity budget');
  assert.ok(stopsOf(body).some(stop => stop.selected_day_hours?.source_url === stop.website), 'actual website evidence reaches the published day');
  await page.getByRole('list', { name: 'The stops, in order', exact: true }).waitFor();
  if (initialMode === 'empty') await page.waitForFunction(key => {
    const entry = JSON.parse(localStorage.getItem(key) || 'null');
    return Boolean(entry?.safeResponse?.live_events) && entry.safeResponse.live_events.pending !== true;
  }, LAST);
  const route = page.getByRole('region', { name: 'The route', exact: true });
  return { page, route, requests, responses, websiteRequests, capture, pass: () => { passed = true; },
    switchSource: mode => { current = source(mode); },
    async warmSource(mode) {
      assert.ok(lastSourceArgs, 'the actual HTTP request supplied the source scope');
      const fresh = source(mode);
      await fresh.run(lastSourceArgs);
      await fresh.settled;
      await new Promise(resolve => setImmediate(resolve));
      current = fresh;
    },
  };
}

async function undoWithoutCompose(h, previous) {
  const count = h.requests.length;
  await h.page.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await h.page.waitForFunction(({ key, expected }) => localStorage.getItem(key) === JSON.stringify(expected), { key: LAST, expected: previous });
  assert.deepEqual(await savedDay(h.page), previous, 'Undo restores the exact response, inputs and commitment snapshot');
  await delay(600); // Beyond the real auto-compose debounce.
  assert.equal(h.requests.length, count, 'Undo makes no compose request');
}

test('real HTTP Keep distinguishes source refusal from confirmed Keep and preserves exact Undo', { timeout: 45000 }, async t => {
  const h = await harness(t, 'healthy');
  await h.route.getByRole('button', { name: 'Keep this event', exact: true }).waitFor();
  const before = await savedDay(h.page);
  const chosen = stopsOf(before.safeResponse).find(stop => stop.is_live_event);
  assert.match(chosen?.live_occurrence_id || '', /^live:2026-10-18:[a-f0-9]{32}$/);
  assert.equal(await h.route.getByRole('button', { name: 'Kept — release', exact: true }).count(), 0);
  h.switchSource('failed');
  await h.route.getByRole('button', { name: 'Keep this event', exact: true }).click();
  try {
    await h.page.getByText(/The chosen event could not be confirmed.*Your previous day is retained\./).waitFor();
  } catch (error) { await h.capture('keep-refusal-observed'); throw error; }
  assert.deepEqual(h.requests.at(-1).live_event_choices, [{ occurrence_id: chosen.live_occurrence_id, action: 'keep' }]);
  assert.ok(h.responses.some(response => response.upgrade === 'not_eligible'), 'the real source-backed retry was refused');
  assert.ok(h.responses.some(response => response.live_choices?.unhonored.some(choice =>
    choice.id === chosen.live_occurrence_id && choice.reason === 'event_not_available_or_eligible')));
  assert.deepEqual(await savedDay(h.page), before);
  assert.match(await h.route.innerText(), /Source evening concert/);
  assert.equal(await h.route.getByRole('button', { name: 'Kept — release', exact: true }).count(), 0);
  assert.equal(await h.route.getByRole('button', { name: 'Selected — release', exact: true }).count(), 1);
  assert.doesNotMatch(await h.page.locator('body').innerText(), /could not be confirmed in a walkable day/i);
  await h.capture('keep-source-refused');
  await undoWithoutCompose(h, before);
  h.switchSource('healthy');
  await h.route.getByRole('button', { name: 'Keep this event', exact: true }).click();
  await h.route.getByRole('button', { name: 'Kept — release', exact: true }).waitFor();
  const kept = await savedDay(h.page);
  assert.equal(kept.commitments.entries[chosen.live_occurrence_id].kind, 'pin');
  assert.equal(kept.safeResponse.agnostic_route_output_experiment.live_event_choices.honored_count, 1);
  assert.ok(h.responses.some(response => response.live_choices?.honored_count === 1), 'the actual publisher confirmed Keep');
  assert.equal(stopsOf(kept.safeResponse).find(stop => stop.is_live_event).live_occurrence_id, chosen.live_occurrence_id);
  await h.capture('keep-confirmed');
  await undoWithoutCompose(h, before);
  assert.equal(await h.route.getByRole('button', { name: 'Kept — release', exact: true }).count(), 0);
  await h.route.getByRole('button', { name: 'Keep this event', exact: true }).waitFor();
  await h.capture('undo-confirmed-keep');
  // Combined contract: a real Keep/reload/release must retain the dated hours
  // from the selected website without calling those windows "open now".
  await h.route.getByRole('button', { name: 'Keep this event', exact: true }).click();
  await h.route.getByRole('button', { name: 'Kept — release', exact: true }).waitFor();
  const beforeReload = await savedDay(h.page);
  const hoursStop = stopsOf(beforeReload.safeResponse).find(stop => stop.selected_day_hours?.source_url === stop.website);
  assert.ok(hoursStop, 'confirmed Keep retains identity-bound selected website hours');
  const fact = hoursStop.selected_day_hours;
  assert.equal(fact.date, DATE);
  assert.equal(fact.timezone, 'Europe/Helsinki');
  assert.equal(fact.observed_at, '2026-10-17T08:00:00.000Z');
  assert.deepEqual(fact.windows, [{ opens: '10:00', closes: '23:00' }]);
  await h.page.reload();
  await h.route.getByRole('button', { name: 'Kept — release', exact: true }).waitFor();
  const afterReload = await savedDay(h.page);
  assert.equal(stopsOf(afterReload.safeResponse).find(stop => stop.is_live_event)?.live_occurrence_id, chosen.live_occurrence_id);
  assert.equal(afterReload.commitments.entries[chosen.live_occurrence_id]?.kind, 'pin');
  assert.deepEqual(stopsOf(afterReload.safeResponse).find(stop => stop.id === hoursStop.id)?.selected_day_hours, fact,
    'ordinary URL reload and Keep revalidation preserve the selected date, website and original observation');
  await h.page.getByRole('list', { name: 'The stops, in order', exact: true })
    .locator(':scope > li > button').filter({ hasText: hoursStop.label }).click();
  const visiblePanel = h.route.locator('[id^="route-stop-panel-"]:visible');
  await visiblePanel.getByText('Source hours for selected day: 10:00–23:00', { exact: true }).waitFor();
  assert.equal(await visiblePanel.getByRole('link', { name: 'Website', exact: true }).getAttribute('href'), hoursStop.website);
  assert.doesNotMatch(await visiblePanel.innerText(), /open now|currently open/i);
  await h.capture('reload-kept-with-dated-hours');
  const releasedResponse = waitForPublished(h.page, body => stopsOf(body).length > 0 &&
    (body.agnostic_route_output_experiment?.live_event_choices?.requested_count ?? 0) === 0);
  await h.route.getByRole('button', { name: 'Kept — release', exact: true }).click();
  await releasedResponse;
  await h.route.getByRole('button', { name: 'Keep this event', exact: true }).waitFor();
  const released = await savedDay(h.page);
  assert.notEqual(released.commitments?.entries[chosen.live_occurrence_id]?.kind, 'pin');
  assert.ok(!h.requests.at(-1).live_event_choices?.some(choice => choice.action === 'keep'));
  assert.equal(await h.route.getByRole('button', { name: 'Kept — release', exact: true }).count(), 0);
  assert.deepEqual(stopsOf(released.safeResponse).find(stop => stop.id === hoursStop.id)?.selected_day_hours, fact);
  await h.capture('released-with-dated-hours');
  h.pass();
});

test('ordinary priority HTTP composition labels its actual new Live occurrence and Undo restores the original day', { timeout: 30000 }, async t => {
  const h = await harness(t, 'empty');
  await h.page.getByText('Your first choice Views is only partly represented in this day.', { exact: true }).waitFor();
  const before = await savedDay(h.page);
  assert.ok(stopsOf(before.safeResponse).every(stop => !stop.is_live_event));
  assert.ok(stopsOf(before.safeResponse).some(stop => stop.type === 'park' && stop.partial_preferences?.includes('scenic')),
    'the real publisher supplies partial scenic evidence rather than invented reasons');
  await h.warmSource('healthy');
  const anchor = h.page.getByRole('region', { name: "Your day's starting point", exact: true });
  await anchor.getByRole('button', { name: 'Adjust', exact: true }).click();
  const ordinary = waitForPublished(h.page, body => stopsOf(body).some(stop => stop.is_live_event));
  await anchor.getByRole('button', { name: 'Culture', exact: true }).click();
  await anchor.getByRole('button', { name: 'Culture', exact: true }).click();
  const body = await ordinary;
  assert.notEqual(body.live_events?.pending, true, 'the ordinary HTTP response contains the actual new Live occurrence');
  assert.deepEqual(h.requests.at(-1).preference_priority, ['views', 'culture']);
  await h.page.getByText(/Live: event added/).waitFor();
  await h.route.getByText('Source evening concert', { exact: true }).waitFor();
  const after = await savedDay(h.page);
  assert.notDeepEqual(identities(after), identities(before));
  assert.equal(stopsOf(after.safeResponse).filter(stop => stop.is_live_event).length, 1);
  await h.capture('ordinary-priority-live-attributed');
  await undoWithoutCompose(h, before);
  assert.doesNotMatch(await h.route.innerText(), /Source evening concert/);
  assert.equal(await h.page.getByText(/Live: event added/).count(), 0);
  await h.capture('undo-priority-exact-day');
  h.pass();
});
