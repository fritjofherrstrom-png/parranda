'use strict';

// Built UI -> actual HTTP lifecycle/handlers -> actual source composition,
// admission and route publication. Only external source/resolver boundaries
// are controlled. This is deterministic source replay, not live-provider QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createBackgroundSource } = require('../server/place-candidates/background-source');
const { composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');

const NOW = '2026-10-16T08:00:00Z';
const DATE = '2026-10-17';
const ANCHOR = { lat: 48.5, lng: 8.5 };
const COMPOSE_PATHS = new Set(['/api/route-recommendations', '/api/planner-status']);
const pendingCopy = 'Fetching source-backed places for your day. Your plan will continue automatically — no need to try again.';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const rows = (family, type, count) => Array.from({ length: count }, (_, i) => ({
  id: `${family}-${type}-${i}`,
  name: `${family === 'open_knowledge' ? 'Knowledge' : 'Directory'} ${type} ${i}`,
  type, lat: ANCHOR.lat + i * .0009, lng: ANCHOR.lng + (i % 2) * .001,
  sources: [{ provider: family, family, tier: 'inferred', url: `https://source.example/${family}/${type}/${i}` }],
}));

let browser;
test.before(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
});
test.after(async () => { await browser?.close(); });

async function fixture(t, { directoryLoad, knowledgeCount = 18 } = {}) {
  const cache = createSourceCache();
  const key = 'first-attempt-private-directory-window';
  const started = deferred();
  let acquisitions = 0, primaryCalls = 0, resolverCalls = 0, producerAborted = false;
  let producerStartedAt;
  const directory = createBackgroundSource({ cache, keyFor: () => key, load: (_anchor, request) => {
    acquisitions++;
    producerStartedAt = performance.now();
    request.signal.addEventListener('abort', () => { producerAborted = true; }, { once: true });
    started.resolve();
    return directoryLoad(acquisitions);
  } });
  const loader = composeOpenDataLoaders(async () => {
    primaryCalls++;
    return Object.assign([], { loader_status: 'error_failed_closed', loader_error: 'provider_unavailable' });
  }, () => rows('open_knowledge', 'museum', knowledgeCount), directory);
  const resolver = createNominatimPlaceResolver({ fetcher: async () => {
    resolverCalls++;
    return { ok: true, status: 200, json: async () => [{
      display_name: 'Regressionhaven, Fixture Region, Fixture Country', name: 'Regressionhaven',
      lat: String(ANCHOR.lat), lon: String(ANCHOR.lng), importance: .55,
      osm_type: 'relation', osm_id: 989801, place_rank: 16, class: 'place', type: 'city',
      address: { city: 'Regressionhaven', country: 'Fixture Country' },
    }] };
  } });
  const server = buildApp({ openDataLoader: loader, placeResolver: resolver, placeSuggestions: null,
    eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null,
    clock: () => new Date(NOW),
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false,
      timezone_resolution: { timezone: 'Europe/Berlin', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: 'Europe/Berlin' });
  t.after(() => context.close());
  // No product API route is mocked: browser assets/maps on external hosts are
  // blocked, while every same-origin request reaches the real Express app.
  await context.route(url => url.origin !== origin, route => route.abort());
  await context.addInitScript(epoch => {
    const NativeDate = window.Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [epoch])); }
      static now() { return epoch; }
    };
  }, new Date(NOW).getTime());
  const page = await context.newPage(), requests = [], observations = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (COMPOSE_PATHS.has(pathname)) requests.push({ path: pathname, body: request.postDataJSON() });
  });
  page.on('response', async response => {
    const pathname = new URL(response.url()).pathname;
    if (!COMPOSE_PATHS.has(pathname)) return;
    try {
      const body = await response.json();
      observations.push({ path: pathname, status: response.status(), pending: body.planner_lifecycle?.state || null,
        stops: body.days?.[0]?.primary_route?.main_stops?.map(stop => ({ id: stop.id, type: stop.type })) || [],
        completion: body.agnostic_route_output_experiment?.source_status?.collection?.source_completion || null,
        coverage: body.agnostic_route_output_experiment?.constraint_negotiation?.preference_coverage || null });
    } catch { /* Only JSON composition responses belong in this observation. */ }
  });
  t.after(() => {
    assert.deepEqual(errors, [], 'built UI must not raise browser exceptions');
    t.diagnostic(JSON.stringify({ real_http: true, source_boundary: 'controlled; not live acceptance',
      inputs: requests.filter(request => request.path === '/api/route-recommendations').map(({ body }) => ({
        preferences: body.preferences, dates: body.dates, day_rhythm: body.day_rhythm,
      })), observations, counts: counts() }));
  });
  const counts = () => ({ acquisitions, primaryCalls, resolverCalls, producerAborted });
  return { page, cache, key, requests, observations, started: started.promise, counts,
    elapsed: () => performance.now() - producerStartedAt,
    open: intent => page.goto(`${origin}/anywhere?place=Regressionhaven&prefs=${intent}&day=1&rhythm=balanced&lang=en`),
    // Optional evidence contains only fixture text and sanitized response
    // summaries. Lifecycle tokens and other capabilities never reach disk.
    capture: async label => {
      const dir = process.env.PARRANDA_PREFERENCE_DIAGNOSTICS_DIR;
      if (!dir) return;
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `${label}.png`), fullPage: true });
      fs.writeFileSync(path.join(dir, `${label}.json`), JSON.stringify({ observations,
        text: await page.locator('body').innerText(), counts: counts() }, null, 2));
    },
  };
}

function waitForApi(page, pathname, status) {
  return page.waitForResponse(response => new URL(response.url()).pathname === pathname &&
    (status === undefined || response.status() === status), { timeout: 15000 });
}
async function assertRenderedRoute(page, route) {
  const names = route.main_stops.map(stop => stop.label || stop.name);
  await page.waitForFunction(expected => {
    const rendered = [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button')];
    return rendered.length === expected.length && expected.every((name, i) => rendered[i].textContent.includes(name));
  }, names);
  assert.equal(await page.getByRole('list', { name: 'The stops, in order', exact: true }).locator(':scope > li > button').count(), 5);
}

// Catches ending a cold plan from geocoded/type-matching knowledge rows at the
// 8s snapshot boundary even though those rows cannot pass place admission.
test('built UI keeps the original cold job pending past 8s, then publishes its five admitted culture stops', { timeout: 35000 }, async t => {
  const work = deferred();
  t.after(() => work.resolve([]));
  const f = await fixture(t, { directoryLoad: () => work.promise });
  assert.equal(f.cache.peek(f.key), null, 'this is a fresh private cache, not a warm HTTP inference');
  const initialResponse = waitForApi(f.page, '/api/route-recommendations');
  await f.open('culture');
  const first = await initialResponse, firstBody = await first.json();
  assert.equal(first.status(), 202);
  assert.equal(firstBody.planner_lifecycle.state, 'warm_pending');
  await f.started;
  await f.page.getByText(pendingCopy, { exact: true }).waitFor();
  // Real time crosses production's existing 8s partial boundary. Browser/server
  // timers are not accelerated and the lifecycle budget is unchanged.
  await delay(Math.max(0, 8250 - f.elapsed()));
  const boundary = await waitForApi(f.page, '/api/planner-status');
  assert.equal(boundary.status(), 202, 'knowledge-only coordinates must not terminate the same pending source job');
  const boundaryBody = await boundary.json();
  assert.equal(boundaryBody.planner_lifecycle.token, firstBody.planner_lifecycle.token);
  assert.equal(await f.page.getByText(pendingCopy, { exact: true }).isVisible(), true);
  assert.equal(await f.page.getByRole('list', { name: 'The stops, in order', exact: true }).count(), 0);
  assert.equal(await f.page.getByRole('button', { name: 'Try again', exact: true }).count(), 0);
  await f.capture('cold-pending-past-8s');
  const finalResponse = waitForApi(f.page, '/api/planner-status', 200);
  work.resolve(rows('open_directory', 'museum', 8));
  const body = await (await finalResponse).json(), route = body.days?.[0]?.primary_route;
  assert.equal(route?.main_stops?.length, 5, 'the original Balanced submission must publish the actual admitted day');
  assert.equal(body.days[0].date, DATE);
  assert.ok(route.main_stops.every(stop => stop.id.startsWith('open_directory-') && stop.type === 'museum'));
  assert.equal(route.trust_summary.human_verified, false);
  assert.ok(route.main_stops.every(stop => stop.provisional === true));
  const experiment = body.agnostic_route_output_experiment;
  assert.equal(experiment.walking_validation.valid, true);
  assert.equal(experiment.source_status.collection.source_completion.status, 'complete');
  assert.equal(experiment.source_status.collection.source_completion.pending, 0);
  assert.equal(experiment.source_status.error, 'provider_unavailable', 'the map failure remains visible after directory rescue');
  assert.deepEqual(experiment.constraint_negotiation.preference_coverage.covered_preferences, ['museums']);
  await assertRenderedRoute(f.page, route);
  assert.equal(await f.page.getByText(pendingCopy, { exact: true }).count(), 0);
  const submissions = f.requests.filter(request => request.path === '/api/route-recommendations');
  assert.equal(submissions.length, 1, 'one user submission, no invisible recompose');
  assert.deepEqual(submissions[0].body.preferences, ['culture']);
  assert.deepEqual(submissions[0].body.dates, [DATE]);
  assert.equal(submissions[0].body.day_rhythm, 'balanced');
  assert.ok(!submissions[0].body.pinned_candidate_ids?.length);
  assert.ok(f.requests.filter(request => request.path === '/api/planner-status').every(request =>
    request.body.token === firstBody.planner_lifecycle.token), 'all progress reads belong to the original job');
  assert.deepEqual(f.counts(), { acquisitions: 1, primaryCalls: 1, resolverCalls: 1, producerAborted: false });
  assert.equal(f.cache.peek(f.key).length, 8, 'the same actual background producer populated its own cache');
  await f.capture('cold-first-submission-five-stops');
});

// Catches padding a terminal Second hand result with museums, claiming active
// fetching after completion, or silently retrying instead of awaiting the user.
test('built UI shows zero matches for terminal museum-only Second hand, then explicit retry recovers the same choices', { timeout: 35000 }, async t => {
  const firstWork = deferred();
  t.after(() => firstWork.resolve([]));
  const f = await fixture(t, { knowledgeCount: 12, directoryLoad: attempt => attempt === 1
    ? firstWork.promise : Promise.resolve(rows('open_directory', 'vintage-shop', 8)) });
  const initialResponse = waitForApi(f.page, '/api/route-recommendations');
  await f.open('second_hand');
  const first = await initialResponse;
  assert.equal(first.status(), 202);
  const terminalResponse = waitForApi(f.page, '/api/planner-status', 200);
  firstWork.reject(new Error('controlled directory transport failure'));
  const body = await (await terminalResponse).json(), experiment = body.agnostic_route_output_experiment;
  assert.ok(!body.days?.some(day => day.primary_route), 'unrelated museums must not become a route');
  assert.equal(experiment.constraint_negotiation.status, 'unresolved');
  assert.deepEqual(experiment.constraint_negotiation.preference_coverage.covered_preferences, []);
  assert.deepEqual(experiment.constraint_negotiation.preference_coverage.partial_preferences, []);
  assert.deepEqual(experiment.constraint_negotiation.preference_coverage.missing_preferences, ['second_hand']);
  assert.equal(experiment.source_status.collection.source_completion.status, 'complete');
  assert.equal(experiment.source_status.collection.source_completion.pending, 0);
  assert.equal(experiment.source_status.collection.source_completion.failed, 1);
  assert.ok(body.place_structure.areas.some(area => area.member_ids?.some(id => id.startsWith('open_knowledge-'))),
    'the raw diagnostic structure contains real nonmatching museum records');
  assert.deepEqual(body.place_structure.district_day.areas, [], 'diagnostics are not published as preference matches');
  await f.page.getByText('0 matches for your picks.', { exact: true }).waitFor();
  await f.page.getByText(/Planning finished without a route/).and(f.page.locator('div')).waitFor();
  await f.page.getByText(/One or more place sources failed/).and(f.page.locator('div')).waitFor();
  assert.equal(await f.page.getByRole('list', { name: 'The stops, in order', exact: true }).count(), 0);
  const candidates = f.page.locator('section').filter({ has: f.page.getByText('Candidates near this place', { exact: true }) });
  assert.match(await candidates.innerText(), /None of these candidates cover:\s*Second hand/);
  assert.equal(await candidates.getByRole('button', { name: /Knowledge museum/ }).count(), 0);
  assert.equal(await f.page.getByText(pendingCopy, { exact: true }).count(), 0);
  assert.equal(await f.page.getByText(/More places are on their way|Places .* are still being fetched/).count(), 0);
  const retry = f.page.getByRole('button', { name: 'Try again', exact: true });
  await retry.waitFor();
  await f.capture('terminal-second-hand-zero-matches');
  const before = f.requests.length;
  // The former silent-upgrade policy used 9 seconds. Observe beyond it, not
  // merely one polling interval, while all real lifecycle traffic stays idle.
  await delay(9500);
  assert.equal(f.requests.length, before, 'terminal UI must neither recompose nor keep polling automatically');
  assert.equal(f.counts().acquisitions, 1);
  assert.equal(f.cache.peek(f.key), null, 'the failed source result is not a cached successful empty answer');
  const recoveryResponse = f.page.waitForResponse(async response => {
    if (!COMPOSE_PATHS.has(new URL(response.url()).pathname) || response.status() !== 200) return false;
    try { return (await response.json()).days?.[0]?.primary_route?.main_stops?.length === 5; } catch { return false; }
  }, { timeout: 15000 });
  await retry.click();
  const recovered = await (await recoveryResponse).json(), route = recovered.days[0].primary_route;
  assert.ok(route.main_stops.every(stop => stop.type === 'vintage-shop' && stop.id.startsWith('open_directory-')));
  assert.deepEqual(recovered.agnostic_route_output_experiment.constraint_negotiation.preference_coverage.covered_preferences, ['second_hand']);
  assert.equal(recovered.agnostic_route_output_experiment.walking_validation.valid, true);
  assert.equal(recovered.days[0].date, DATE);
  await assertRenderedRoute(f.page, route);
  assert.equal(await f.page.getByText('0 matches for your picks.', { exact: true }).count(), 0);
  const submissions = f.requests.filter(request => request.path === '/api/route-recommendations');
  assert.equal(submissions.length, 2, 'only the explicit retry starts a new execution');
  assert.ok(submissions.every(({ body: input }) => input.day_rhythm === 'balanced' &&
    input.dates.length === 1 && input.dates[0] === DATE && input.preferences.length === 1 && input.preferences[0] === 'second_hand'));
  assert.deepEqual(f.counts(), { acquisitions: 2, primaryCalls: 2, resolverCalls: 1, producerAborted: false },
    'manual retry reuses the real resolver cache while the failed place source is acquired once again');
  await f.capture('manual-retry-second-hand-five-stops');
});
