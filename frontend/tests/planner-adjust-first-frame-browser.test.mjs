/**
 * The pending Adjust ring must exist at the first sampled native rAF after
 * activation, not merely after React's passive effects or an act() flush.
 * Runs the built application and real React with controlled HTTP replies.
 * This is native Chromium UI evidence, not provider/deployed/device acceptance.
 * Run after npm run build; optionally set PARRANDA_TEST_CHROMIUM and
 * PARRANDA_ADJUST_FRAME_RECEIPT (an output path outside frontend scan roots).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { buildApp } = require('../../server/app');
const DATE = '2026-11-26';
const controls = ['Food & drink', 'Relaxed', 'Tomorrow'];

// Public, synthetic response: no retained snapshot, capability or live source.
function composedDay(date) {
  const stops = ['a', 'b', 'c'].map((id, i) => ({
    id, label: `Frame fixture ${id}`, lat: 55.6 + i * 0.002, lng: 13,
    type: 'museum', covered_preferences: ['culture'], commitment_eligible: true,
  }));
  return {
    days: [{ date, experimental_agnostic_route_applied: true, primary_route: {
      id: '__agnostic_compose__', main_stops: stops, estimated_km: 2.1,
      legs: [], map_route_points: [], map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })),
    }, alternatives: [] }],
    agnostic_route_output_experiment: {
      intake: { status: 'resolved', resolved: { label: 'Testville' } },
      promotion: { promote: true, readiness: 'promotable' },
    },
    day_snapshot: { version: 1, state: 'unavailable' },
  };
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

// Only Date is controlled; native events, rAF, timers and debounce remain real.
function fixtureDate() {
  const NativeDate = Date;
  const offset = new NativeDate('2026-11-26T10:00:00Z').getTime() - NativeDate.now();
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [NativeDate.now() + offset])); }
    static now() { return NativeDate.now() + offset; }
  };
}

function armFirstFrame(target) {
  const control = [...document.querySelectorAll('button')].find(button => button.innerText === target);
  if (!control) throw new Error('Missing native Adjust control');
  const out = { target, pointerdown: null, click: null, trusted: null, mutations: [], frames: [], requests: [] };
  window.__adjustFirstFrame = out;
  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href);
    if (url.pathname === '/api/route-recommendations') out.requests.push(performance.now() - out.click);
    return Reflect.apply(nativeFetch, this, args);
  };
  const snapshot = () => ({
    t: performance.now() - out.click,
    pressed: control.getAttribute('aria-pressed'),
    ring: control.className.includes('animate-ring-pending'),
    shadow: getComputedStyle(control).boxShadow,
    routeStale: document.querySelector('section[aria-label="The route"]')?.dataset.rebuilding ?? null,
    status: document.querySelector('[data-adjust-rebuild]')?.dataset.adjustRebuild ?? null,
  });
  const observer = new MutationObserver(() => {
    if (out.click !== null) out.mutations.push(snapshot());
  });
  observer.observe(control, { attributes: true, attributeFilter: ['class', 'aria-pressed'] });
  control.addEventListener('pointerdown', () => { out.pointerdown = performance.now(); }, { once: true, capture: true });
  control.addEventListener('click', event => {
    out.click = performance.now();
    out.trusted = event.isTrusted;
    const frame = () => {
      out.frames.push(snapshot());
      if (out.frames.length < 8) requestAnimationFrame(frame);
      else observer.disconnect();
    };
    requestAnimationFrame(frame);
  }, { once: true, capture: true });
}

test('Adjust rings at the first sampled native frame while composition stays debounced', { timeout: 120_000 }, async t => {
  const plans = new Map();
  const receipt = { scope: 'built-UI synthetic HTTP fixture; no provider or physical-device acceptance', cases: [] };
  const app = buildApp({
    openDataLoader: null, placeResolver: null, placeSuggestions: null, eventSupply: null,
    sourceCatalog: null, reviewedPlaceSource: null, walkingRouter: null, walkingConfig: null,
    weatherProvider: async () => null,
    placeSelectionStore: { read: () => null, issue: () => null },
    publishedDayStore: { get: async () => null, read: async () => null },
    anywhereV2Dir: fileURLToPath(new URL('../dist/', import.meta.url)),
  });
  let browser;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return app(req, res);
    const plan = plans.get(req.headers['x-frame-case']);
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (url.pathname === '/api/route-recommendations' && plan) {
      const body = JSON.parse(raw || '{}');
      const date = body.dates?.[0];
      plan.requests.push({ t: performance.now(), date, preferences: body.preferences });
      if (plan.requests.length === 1) return json(res, 200, composedDay(date));
      // Keep the actual rebuild in flight until teardown; no fake early success.
      plan.pending.push(res);
      plan.receivedRebuild();
      return;
    }
    json(res, 503, { status: 'unavailable', retryable: false, controlled_fixture: true });
  });
  t.after(async () => {
    await browser?.close();
    receipt.browserClosed = true;
    for (const plan of plans.values()) for (const res of plan.pending) res.destroy();
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    receipt.serverClosed = !server.listening;
    if (process.env.PARRANDA_ADJUST_FRAME_RECEIPT) {
      writeFileSync(process.env.PARRANDA_ADJUST_FRAME_RECEIPT, JSON.stringify(receipt, null, 2) + '\n');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  receipt.browser = browser.version();

  for (const target of controls) await t.test(target, async st => {
    let receivedRebuild;
    const rebuilt = new Promise(resolve => { receivedRebuild = resolve; });
    const plan = { requests: [], pending: [], receivedRebuild };
    plans.set(target, plan);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
      locale: 'en-US', timezoneId: 'Europe/Stockholm', reducedMotion: 'no-preference',
      extraHTTPHeaders: { 'x-frame-case': target },
    });
    st.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route(url => url.origin !== origin, route => route.abort());
    await page.addInitScript(fixtureDate);
    await page.goto(`${origin}/anywhere?place=Testville&prefs=culture&lang=en`);
    await page.waitForFunction(() =>
      document.querySelectorAll('ol button[aria-controls^="route-stop-panel-"]').length === 3
      && !document.querySelector('astro-island[ssr]')
      && JSON.parse(localStorage.getItem('parranda:anywhere:last') || 'null')?.safeResponse?.days?.[0]?.primary_route?.main_stops?.length === 3);
    assert.equal(plan.requests.length, 1);
    assert.equal(plan.requests[0].date, DATE, 'fixture reply and selected date are bound');
    await page.getByRole('button', { name: /^Adjust/ }).tap();
    const control = page.getByRole('button', { name: target, exact: true });
    await control.waitFor();
    // Match the settled, open Adjust precondition; do not sample its entry animation.
    await page.waitForTimeout(500);
    assert.equal(await control.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('[class*="animate-ring-pending"]').count(), 0);
    await page.evaluate(armFirstFrame, target);
    await control.tap();
    await page.waitForFunction(() => window.__adjustFirstFrame.frames.length === 8);
    const observation = await page.evaluate(() => window.__adjustFirstFrame);
    observation.errors = errors;
    observation.composeRequestsAtSampleEnd = plan.requests.length;
    receipt.cases.push(observation);
    st.diagnostic(JSON.stringify(observation));
    assert.deepEqual(errors, []);
    assert.equal(observation.trusted, true, 'real native activation');
    assert.ok(observation.pointerdown !== null && observation.click !== null);
    assert.equal(observation.frames[0].pressed, 'true', 'the first frame has the changed selection');
    assert.ok(observation.frames.some(frame => frame.ring && frame.shadow !== 'none'), 'valid ring selector: the ring actually appears');
    // Eight samples need not fit inside 400 ms on a busy host. Only frames
    // actually inside the debounce window must still be render-only.
    assert.ok(observation.requests.every(time => time >= 399), 'no compose before the debounce settles');
    assert.ok(observation.frames.filter(frame => frame.t < 399)
      .every(frame => frame.routeStale === null && frame.status !== 'updating'), 'queued is render-only, not stale');
    assert.ok(observation.frames[0].ring && observation.frames[0].shadow !== 'none',
      `${target}: first native rAF must have pending ring, not only the second`);
    // A passing visual acknowledgment must not move composition before 400 ms.
    await page.waitForFunction(() => document.querySelector('[data-adjust-rebuild]')?.dataset.adjustRebuild === 'updating');
    await rebuilt;
    assert.equal(plan.requests.length, 2, 'exactly one debounced rebuild');
    const requests = await page.evaluate(() => window.__adjustFirstFrame.requests);
    assert.equal(requests.length, 1);
    assert.ok(requests[0] >= 399, `compose still waits for the 400 ms debounce: ${requests[0]} ms`);
    observation.rebuildRequests = plan.requests.length;
    observation.requests = requests;
  });
});
