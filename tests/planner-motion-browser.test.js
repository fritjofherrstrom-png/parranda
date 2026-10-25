'use strict';

// Actual built UI/CSS in native Chromium, local real app/composer and trusted
// fixture rows. Only the HTTP transport gate and source inputs are controlled.
// This is not live-provider, deployed-runtime or physical-Safari acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const ROOT = process.env.PARRANDA_MOTION_APP_ROOT || path.resolve(__dirname, '..');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright-core'));
const { buildApp } = require(path.join(ROOT, 'server/app'));
const { rows } = require(path.join(ROOT, 'tests/helpers/day-composition-fixtures'));
const NOW = '2026-10-21T08:00:00Z';
const LAST = 'parranda:anywhere:last';
const OUT = process.env.PARRANDA_MOTION_EVIDENCE_DIR;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function motionHarness(t, width, reducedMotion) {
  const initial = deferred(), pending = new Set([initial]), requests = [], errors = [], checkpoints = [];
  let gate = initial, transportFailure = false;
  let browser, context;
  const trace = stage => { if (process.env.PARRANDA_MOTION_TRACE) process.stderr.write(`[motion ${width} ${reducedMotion}] ${stage}\n`); };
  const records = [...rows('Motion gallery', 'museum', 7), ...rows('Motion cafe', 'cafe', 7, 8)];
  const app = buildApp({
    openDataLoader: async () => Object.assign(structuredClone(records), {
      loader_status: 'loaded:14', loader_error: 'controlled_place_source_partial',
      loader_metadata: { source_completion: { status: 'partial', completed: 1, pending: 0, failed: 1 } },
    }),
    placeResolver: async () => [{ lat: 55.6, lng: 13, label: 'Motionhaven', confidence: 'high', provenance: 'controlled-resolver' }],
    placeSuggestions: null, reviewedPlaceSource: null, sourceCatalog: null, eventSupply: null,
    clock: () => new Date(NOW),
    weatherProvider: async () => ({ condition: 'sun', timezone_resolution: {
      timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
  });
  const server = http.createServer((req, res) => {
    (async () => {
      if (req.method === 'POST' && new URL(req.url, 'http://localhost').pathname === '/api/route-recommendations') {
        const owned = gate;
        if (owned) await owned.promise;
        if (transportFailure) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"controlled_http_failure"}'); return; }
      }
      app(req, res);
    })().catch(error => { if (!res.headersSent) res.writeHead(500); res.end(); errors.push(String(error)); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const label = `${width}-${reducedMotion}`;
  t.after(async () => {
    for (const item of pending) item.resolve();
    if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify({
      boundary: 'native built CSS/UI with real local app/composer; controlled HTTP gate, trusted rows/clock; not live/public acceptance',
      browser: browser?.version(), root: ROOT, width, reducedMotion, requests, checkpoints, errors,
    }, null, 2)); }
    await context?.close(); await browser?.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  });
  trace('server listening; launch browser');
  browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  trace('browser launched; create context');
  context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion, timezoneId: 'Europe/Stockholm' });
  await context.route(url => url.origin !== origin, route => route.abort());
  await context.addInitScript(epoch => {
    const NativeDate = window.Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [epoch])); }
      static now() { return epoch; }
    };
  }, Date.parse(NOW));
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => {
    if (new URL(req.url()).pathname !== '/api/route-recommendations') return;
    const body = req.postDataJSON();
    requests.push({ place: body.place, dates: body.dates, preferences: body.preferences,
      rhythm: body.day_rhythm, priority: body.preference_priority });
  });
  trace('page ready');
  async function capture(stage) {
    trace(`capture ${stage}`);
    const snapshot = await page.evaluate(() => ({ text: document.body.innerText,
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      ringMarks: [...document.querySelectorAll('[data-ring-mark]')].map(e => ({ width: parseFloat(getComputedStyle(e).width),
        height: parseFloat(getComputedStyle(e).height), position: getComputedStyle(e).position,
        animation: getComputedStyle(e).animationName })),
      animations: document.getAnimations().filter(a => a.playState === 'running').map(a => ({
        name: a.animationName || `transition:${a.transitionProperty}`, tag: a.effect?.target?.tagName,
        duration: a.effect?.getTiming().duration })),
    }));
    checkpoints.push({ stage, ...snapshot });
    if (OUT && process.env.PARRANDA_MOTION_SCREENSHOTS === '1') {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${label}-${stage}.png`) });
    }
    return snapshot;
  }

  return { page, origin, initial, requests, errors, capture,
    hold(fail = false) { transportFailure = fail; gate = deferred(); pending.add(gate); return gate; },
    release(item) { if (item === gate) gate = null; item.resolve(); },
    fail(item) { transportFailure = true; if (item === gate) gate = null; item.resolve(); },
  };
}

for (const [width, reducedMotion] of [[375, 'no-preference'], [1280, 'no-preference'], [390, 'reduce']]) {
  test(`calm native loading and rebuild at ${width}px, motion=${reducedMotion}`, { timeout: 45000 }, async t => {
    const h = await motionHarness(t, width, reducedMotion), { page } = h;
    await page.goto(`${h.origin}/anywhere?place=Motionhaven&prefs=culture&day=1&lang=en`);
    await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
    await page.locator('[data-day-shape="stations"]').waitFor({ state: 'visible' });
    const loading = await h.capture('loading');
    assert.ok(loading.scrollWidth <= width + 1, 'no viewport overflow');
    assert.equal(await page.locator('[data-day-station]').count(), 5);
    const shape = await page.evaluate(() => {
      const station = document.querySelector('[data-day-shape="stations"]');
      const map = document.querySelector('[data-day-shape="map"], [data-day-shape="map-column"]');
      const wordmark = document.querySelector('nav a[aria-label] > [aria-hidden=true]');
      return { station: station.getBoundingClientRect().toJSON(), map: map.getBoundingClientRect().toJSON(),
        sheen: getComputedStyle(document.querySelector('.skeleton')).animationName,
        breathe: getComputedStyle(document.querySelector('[data-day-station]')).animationName,
        delays: [...document.querySelectorAll('[data-day-station]')].map(e => getComputedStyle(e).animationDelay),
        wordmarkAnimation: getComputedStyle(wordmark).animationName,
        wordmarkDescendantAnimations: wordmark.getAnimations({ subtree: true }).length,
        ringDraw: getComputedStyle(document.querySelector('[data-ring-mark] circle[pathLength]')).animationName };
    });
    assert.equal(shape.wordmarkAnimation, 'none'); assert.equal(shape.wordmarkDescendantAnimations, 0);
    if (reducedMotion === 'reduce') {
      assert.equal(shape.sheen, 'none'); assert.equal(shape.breathe, 'none'); assert.equal(shape.ringDraw, 'none');
      assert.equal(loading.animations.length, 0, 'the actual CSS removes all loading motion');
    } else {
      assert.equal(shape.sheen, 'parranda-sheen'); assert.equal(shape.breathe, 'parranda-breathe'); assert.equal(shape.ringDraw, 'parranda-mark-draw');
      assert.deepEqual(shape.delays, ['0s', '0.3s', '0.6s', '0.9s', '1.2s']);
    }
    if (width < 1024) assert.ok(shape.map.y >= shape.station.y + shape.station.height, 'phone: stops before map');
    else assert.ok(shape.map.x > shape.station.x + shape.station.width - 1, 'desktop: map in second column');
    h.release(h.initial);
    await page.getByRole('list', { name: 'The stops, in order', exact: true }).waitFor();
    const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).safeResponse.days[0].primary_route.main_stops.map(s => s.id), LAST);
    await page.getByRole('button', { name: 'Adjust', exact: true }).click();
    const rebuild = h.hold();
    await page.getByRole('button', { name: 'Coffee', exact: true }).click();
    await page.locator('[data-adjust-rebuild="updating"]').waitFor();
    assert.match(await page.locator('ul[aria-label="Your picks in this day"]').innerText(), /Coffee\s*· finding places/);
    assert.ok(await page.locator('[data-adjust-rebuild="updating"] [data-ring-mark]').count());
    const held = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).safeResponse.days[0].primary_route.main_stops.map(s => s.id), LAST);
    assert.deepEqual(held, before, 'pending adjustment does not silently replace the old day');
    const updating = await h.capture('updating');
    assert.ok(updating.ringMarks.every(r => r.width <= 14 && r.height <= 14 && r.position !== 'fixed'),
      'status signs retain their small layout size and never float over controls');
    if (reducedMotion === 'reduce') assert.equal(updating.animations.filter(a => /^parranda-/.test(a.name)).length, 0,
      'all working-indicator and redraw loops are stationary; unrelated short control transitions are separate');
    // Fail the newly added, still-unanswered pick, not a later removal of an
    // already successful pick. Terminal work must stop its pending indicator.
    h.fail(rebuild);
    await page.locator('[data-adjust-rebuild="failed"]').waitFor();
    const failure = await h.capture('failed');
    assert.match(failure.text, /Couldn't update — your previous day is shown/);
    const unanswered = page.locator('ul[aria-label="Your picks in this day"] > li').filter({ hasText: 'Coffee' });
    assert.doesNotMatch(await unanswered.innerText(), /finding places|not in this day|partly/);
    assert.equal(await unanswered.locator('[data-ring-mark]').count(), 0);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).safeResponse.days[0].primary_route.main_stops.map(s => s.id), LAST), before);
    const retry = h.hold();
    await page.getByRole('button', { name: 'Try updating again', exact: true }).click();
    await page.locator('[data-adjust-rebuild="updating"]').waitFor();
    h.release(retry);
    await page.locator('[data-adjust-rebuild="updated"]').waitFor();
    await page.getByRole('button', { name: 'Undo this change', exact: true }).waitFor();
    await h.capture('updated');
    assert.deepEqual(h.errors, []);
    t.diagnostic(JSON.stringify({ width, reducedMotion, built_css: true, requests: h.requests.length, loading, shape }));
  });
}
