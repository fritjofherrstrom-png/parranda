/**
 * Controlled worktree evidence, not provider/deployment acceptance.
 * Built UI -> Express HTTP -> real Ticketmaster mapper/normalizer -> publisher.
 * Only external Discovery transport and trusted place/resolver/weather/clock
 * seams are fixtures. Product API replies and occurrence identities are real.
 *
 * PARRANDA_TEST_CHROMIUM=/path/to/chrome \
 * PARRANDA_TICKETMASTER_EVIDENCE_DIR=/path/to/evidence \
 * node --test frontend/tests/ticketmaster-live-http-browser.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { assertExactNavigation } from './helpers/exact-navigation-observation.mjs';
import { liveDateLabel } from '../src/lib/live-event-query.mjs';

const require = createRequire(import.meta.url);
// Match the established native test's module preflight: cold catalog imports
// are not a browser/product readiness deadline on a shared ARM host.
const { buildApp } = require('../../server/app');
const { createPlaceSelectionStore } = require('../../server/place-candidates/place-selection');
const { collectAnchorEvents, resolveDefaultEventSupply } = require('../../server/place-candidates/agnostic-event-supply');
const { createSourceCache } = require('../../server/place-candidates/source-cache');
const { createBackgroundSource } = require('../../server/place-candidates/background-source');
const { composeOpenDataLoaders } = require('../../server/place-candidates/open-data-loader');
const { rows, anchor: fixtureAnchor } = require('../../tests/helpers/day-composition-fixtures');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OWNED = fileURLToPath(import.meta.url);
const NOW = '2026-10-18T08:00:00Z';
const DAY = '2026-10-19';
const NEXT = '2026-10-20';
const ANCHOR = { lat: 59.3326, lng: 18.0649 };
const PLACE = 'Fixture Stockholm anchor';
const LAST = 'parranda:anywhere:last';
const FAKE_KEY = 'fixture-only-never-a-real-ticketmaster-key';
const SOURCE_ORIGIN = 'https://app.ticketmaster.com';
const SOURCE_PATH = '/discovery/v2/events.json';
const TITLE = 'Source chamber concert';
const VENUE = 'Source concert venue';
const TARGET_URL = 'https://www.ticketmaster.se/event/fixture-twin-b';
const OTHER_URL = 'https://www.ticketmaster.se/event/fixture-twin-a';
const TARGET_START = `${DAY}T18:05:00.000Z`;
const PUBLISHED_PATHS = new Set(['/api/route-recommendations', '/api/planner-status', '/api/planner-live-route-upgrade']);
const REQUIRED = ['initial-real-composition', 'settled-live-and-bounded-browse', 'distinct-source-occurrences',
  'explicit-exact-keep', 'exact-no-compose-undo', 'keep-again', 'kept-url-reload',
  'ordinary-release', 'keep-for-manual-edits',
  'manual-shorter-remove-with-keep', 'manual-replace-with-keep', 'edited-url-reload',
  'edited-language-navigation', 'edited-native-back',
  'release-after-strict-edit', 'released-edit-url-reload'];
const stopsOf = body => body?.days?.[0]?.primary_route?.main_stops || [];
const savedDay = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), LAST);
const hash = value => createHash('sha256').update(value).digest('hex');

function sanitized(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/(?:^|_)(?:apikey|api_key|password|secret|token|receipt|selection|selection_id|place_selection|place_context_selection|authorization)$|^(?:placeSelection|placeContextSelection)$/i.test(key) && item != null) return '[REDACTED]';
    if (typeof item === 'string') return item.replaceAll(FAKE_KEY, '[REDACTED]')
      .replace(/([?&](?:apikey|token|receipt)=)[^&\s]+/gi, '$1[REDACTED]');
    return item;
  }));
}

function sourceSnapshot() {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const files = git('ls-files', 'frontend/dist').split('\n').filter(Boolean);
  return {
    observed_at: new Date().toISOString(), head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
    status: git('status', '--short'), tracked_diff_names: git('diff', 'HEAD', '--name-only').split('\n').filter(Boolean),
    tracked_diff: git('diff', 'HEAD', '--no-ext-diff'),
    owned_test_sha256: hash(readFileSync(OWNED)),
    lockfiles: ['package-lock.json', 'frontend/package-lock.json'].map(path => ({ path, sha256: hash(readFileSync(join(ROOT, path))) })),
    built_frontend: files.map(path => ({ path, sha256: hash(readFileSync(join(ROOT, path))) })),
  };
}

function discoveryFixture() {
  function event(id, name, date, minute, index, venueName = `Source hall ${index}`) {
    const clock = `18:${String(minute).padStart(2, '0')}:00`;
    return { id, name, url: `https://www.ticketmaster.se/event/${id}`,
      dates: { start: { dateTime: `${date}T${clock}Z`, localDate: date,
        localTime: `20:${String(minute).padStart(2, '0')}:00`, dateTBA: false, dateTBD: false, timeTBA: false },
        timezone: 'Europe/Stockholm', status: { code: 'onsale' } },
      classifications: [{ primary: true, segment: { name: 'Music' }, genre: { name: 'Classical' } }],
      _embedded: { venues: [{ id: `source-venue-${venueName === VENUE ? 'twins' : index}`, name: venueName,
        location: { latitude: String(ANCHOR.lat + index * 0.00008), longitude: String(ANCHOR.lng) },
        city: { name: 'Stockholm' }, country: { countryCode: 'SE' }, timezone: 'Europe/Stockholm' }] },
    };
  }
  const twins = [event('fixture-twin-a', TITLE, DAY, 0, 1, VENUE), event('fixture-twin-b', TITLE, DAY, 5, 1, VENUE)];
  const today = Array.from({ length: 10 }, (_, i) => event(`fixture-selected-${i}`, `Source concert ${i}`, DAY, 10 + i * 3, i + 2));
  const following = Array.from({ length: 8 }, (_, i) => event(`fixture-following-${i}`, `Following source concert ${i}`, NEXT, i * 4, i + 2));
  const events = [...twins, ...today, ...following];
  assert.ok(events.length > 12 && events.length <= 40, 'one bounded Discovery page, not an unbounded supply matrix');
  return { _embedded: { events }, page: { size: 40, totalElements: events.length, totalPages: 1, number: 0 } };
}

// Guard both native fetch and other Node TCP clients; fail-soft callers cannot
// hide an attempted escape because the counters are asserted in finalization.
function blockNodeOutbound(unexpected) {
  const nativeFetch = globalThis.fetch;
  const nativeConnect = net.Socket.prototype.connect;
  const loopback = host => !host || host === 'localhost' || host === '::1' || /^127\./.test(String(host));
  globalThis.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (loopback(url.hostname)) return nativeFetch.call(this, input, init);
    unexpected.push({ kind: 'node-fetch', origin: url.origin, pathname: url.pathname });
    return Promise.reject(new Error('Unexpected Node outbound fetch blocked'));
  };
  net.Socket.prototype.connect = function (...args) {
    const value = Array.isArray(args[0]) ? args[0][0] : args[0];
    const target = value && typeof value === 'object' ? (value.path ? null : value)
      : typeof value === 'number' ? { host: args[1], port: value } : null;
    if (!target || loopback(target.host)) return nativeConnect.apply(this, args);
    unexpected.push({ kind: 'node-tcp', host: String(target.host), port: target.port });
    process.nextTick(() => this.destroy(new Error('Unexpected Node outbound socket blocked')));
    return this;
  };
  return () => { globalThis.fetch = nativeFetch; net.Socket.prototype.connect = nativeConnect; };
}

function compactEvent(event) {
  return { id: event.id, source_occurrence_id: event.source_occurrence_id,
    live_occurrence_id: event.live_occurrence_id, live_choice_eligible: event.live_choice_eligible,
    occurrence_date: event.occurrence_date, title: event.title || event.label, starts_at: event.starts_at,
    source_url: event.source_url || event.source?.url, source_label: event.source_label || event.source?.label,
    place: event.place, timezone: event.timezone, is_live_event: event.is_live_event };
}
function flattenEvents(events) {
  return (events || []).flatMap(event => event.occurrences?.length ? flattenEvents(event.occurrences) : [event]);
}
function allLive(live) {
  return flattenEvents([...(live?.tonight || []), ...(live?.browse?.tonight?.more || []),
    ...(live?.this_week || []), ...(live?.browse?.this_week?.more || [])]);
}
function waitForPublished(page, predicate) {
  return page.waitForResponse(async response => {
    if (!PUBLISHED_PATHS.has(new URL(response.url()).pathname) || response.status() !== 200) return false;
    try { const envelope = await response.json(); return predicate(envelope.result || envelope); } catch { return false; }
  }, { timeout: 65000 }).then(async response => { const body = await response.json(); return body.result || body; });
}

function assertPriority(entry) {
  assert.deepEqual(entry.inputs.preferencePriority, ['culture'], 'explicit Culture priority survives the snapshot');
  assert.deepEqual(entry.inputs.selected, ['culture'], 'one explicit interest stays selected');
  assert.equal(entry.inputs.walkKey, 'full', 'Full rhythm remains unchanged');
}
function assertExactKeep(entry, id) {
  assertPriority(entry);
  const live = stopsOf(entry.safeResponse).filter(stop => stop.is_live_event);
  assert.equal(live.length, 1, 'the published day has one exact selected occurrence');
  assert.equal(live[0].live_occurrence_id, id, 'same-title nearby performance must not silently replace Keep');
  assert.equal(live[0].starts_at, TARGET_START, 'source exact start survives publication');
  assert.equal(live[0].source?.url || live[0].source_url, TARGET_URL, 'source event detail URL survives publication');
  assert.equal(live[0].source?.label || live[0].source_label, 'Ticketmaster');
  assert.equal(live[0].timezone, 'Europe/Stockholm');
  assert.equal(entry.safeResponse.place_structure?.district_day?.evening_event?.place, VENUE,
    'the selected occurrence retains its source-owned venue');
  assert.equal(entry.commitments.entries[id]?.kind, 'pin');
  assert.equal(entry.safeResponse.agnostic_route_output_experiment.live_event_choices.honored_count, 1,
    'Keep is confirmed by the actual final publisher, not the optimistic ledger');
  assert.equal(entry.safeResponse.agnostic_route_output_experiment.walking_validation.valid, true);
}
function assertShorter(entry, id, count, excluded) {
  assertExactKeep(entry, id);
  const stops = stopsOf(entry.safeResponse);
  assert.equal(stops.length, count, 'the intentionally shorter final published day must not refill');
  assert.equal(entry.inputs.dayEdit?.target_stop_count, count, 'manual extent is durable');
  for (const removed of excluded) assert.ok(!stops.some(stop => stop.id === removed), `excluded ${removed} cannot return`);
}

async function openStableStop(page, stop) {
  const disclosure = page.getByRole('list', { name: 'The stops, in order', exact: true })
    .locator(':scope > li > button[aria-controls]').filter({ hasText: stop.label });
  assert.equal(await disclosure.count(), 1, 'identify the real stop disclosure, not a map marker');
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  const panelId = await disclosure.getAttribute('aria-controls');
  const panel = page.locator(`[id="${panelId}"]`);
  await panel.waitFor({ state: 'visible' });
  return panel;
}

for (const coldPlace of [false, true]) test(`Ticketmaster exact occurrence survives built-UI Keep/Undo/reload and shorter manual remove/replace (${coldPlace ? 'cold place plus pending Live' : 'ready place'})`, { timeout: 240000 }, async t => {
  const directory = join(process.env.PARRANDA_TICKETMASTER_EVIDENCE_DIR || join(tmpdir(), 'ticketmaster-integrity-browser'),
    new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(directory, { recursive: true });
  const evidence = { classification: 'worktree-controlled-source-built-UI-real-HTTP', cold_place: coldPlace,
    not_claimed: ['frozen candidate head', 'live provider', 'deployment', 'physical device', 'landing intake', 'WebGL map rendering'],
    fixture: { anchor: ANCHOR, place: PLACE, now: NOW, selected_date: DAY, following_date: NEXT,
      raw_discovery_event_count: 20, source_ids: ['fixture-twin-a', 'fixture-twin-b'], target_source_url: TARGET_URL },
    outcome: 'INCOMPLETE', phase: 'setup', completed_contracts: [], required_contracts: REQUIRED,
    source_requests: [], collections: [], browser_requests: [], responses: [], server_receipts: [],
    blocked_browser_assets: [], unexpected_outbound: [], page_errors: [], checkpoints: [] };
  const beforeSource = sourceSnapshot();
  evidence.source_start = beforeSource;
  let browser, context, page, server, origin;
  let releaseColdMap, releaseColdEvents, coldMapSettled = false, coldAcquisitions = 0;
  const responseTasks = [];
  const restoreNetwork = blockNodeOutbound(evidence.unexpected_outbound);
  const done = label => { evidence.completed_contracts.push(label); };
  const setPhase = label => {
    evidence.phase = label;
    evidence.phase_started_at = new Date().toISOString();
    writeFileSync(join(directory, 'progress.json'), JSON.stringify(sanitized({ phase: label,
      observed_at: evidence.phase_started_at, completed_contracts: evidence.completed_contracts }), null, 2));
  };
  const composeRequests = () => evidence.browser_requests.filter(request => request.pathname === '/api/route-recommendations' && request.method === 'POST');
  const capture = async label => {
    if (!page || page.isClosed()) return;
    const entry = await savedDay(page);
    const checkpoint = { label, observed_at: new Date().toISOString(), url: page.url(), entry,
      text: await page.locator('body').innerText() };
    evidence.checkpoints.push(sanitized(checkpoint));
    await page.screenshot({ path: join(directory, `${label}-viewport.png`) });
    await page.screenshot({ path: join(directory, `${label}-full.png`), fullPage: true });
  };
  async function awaitSaved(predicate) {
    await page.waitForFunction(({ key, source }) => {
      const entry = JSON.parse(localStorage.getItem(key) || 'null');
      return Boolean(entry && (0, eval)(`(${source})`)(entry));
    }, { key: LAST, source: predicate.toString() });
    return savedDay(page);
  }
  async function chooseExact() {
    await page.getByRole('button', { name: 'See all live', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Live events', exact: true });
    await sheet.getByRole('button', { name: 'By time', exact: true }).click();
    const row = sheet.locator('li').filter({ has: page.locator(`a[href="${TARGET_URL}"]`) });
    await row.getByRole('button', { name: 'Plan with this event', exact: true }).waitFor();
    assert.match(await row.innerText(), /20:05/);
    const [body] = await Promise.all([
      waitForPublished(page, body => Boolean(body.agnostic_route_output_experiment?.live_event_choices?.requested_count)),
      row.getByRole('button', { name: 'Plan with this event', exact: true }).click(),
    ]);
    assert.equal(body.agnostic_route_output_experiment?.live_event_choices?.honored_count, 1,
      'real Ticketmaster Keep must be honored; source refusal is a blocker, not a passing selection');
    await page.getByRole('region', { name: 'The route', exact: true })
      .getByRole('button', { name: 'Kept — release', exact: true }).waitFor();
    await awaitSaved(entry => entry.safeResponse?.agnostic_route_output_experiment?.live_event_choices?.honored_count === 1);
    return savedDay(page);
  }
  try {
    const records = rows('ticketmaster-culture', 'museum', 9).map(row => ({ ...row,
      lat: ANCHOR.lat + row.lat - fixtureAnchor.lat, lng: ANCHOR.lng + row.lng - fixtureAnchor.lng }));
    // The integration control exercises the existing varied-directory rescue,
    // not a new single-category rescue policy. Unrequested fixture rows remain
    // subject to the ordinary explicit-Culture composition filter.
    const coldRecords = [...records, ...[...rows('cold-food', 'restaurant', 2, 10), ...rows('cold-green', 'park', 2, 12)]
      .map(row => ({ ...row, lat: ANCHOR.lat + row.lat - fixtureAnchor.lat,
        lng: ANCHOR.lng + row.lng - fixtureAnchor.lng }))];
    const coldCache = createSourceCache();
    assert.equal(coldCache.peek('isolated-first-place'), null);
    const coldDirectory = createBackgroundSource({ cache: coldCache, keyFor: () => 'isolated-first-place',
      load: async () => { coldAcquisitions++; return structuredClone(coldRecords); } });
    const mapWork = new Promise(resolve => { releaseColdMap = resolve; });
    const eventGate = new Promise(resolve => { releaseColdEvents = resolve; });
    const placeLoader = coldPlace ? composeOpenDataLoaders(async () => {
      const value = await mapWork; coldMapSettled = true; return value;
    }, null, coldDirectory) : async () => structuredClone(records);
    const fixture = discoveryFixture();
    const eventSupply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: 'enabled',
      PARRANDA_TICKETMASTER_KEY: FAKE_KEY, PARRANDA_EVENT_FEEDS: '[]', PARRANDA_REQUEST_TIME_EVENT_DISCOVERY: 'disabled',
      PARRANDA_QUALIFIED_SOURCE_RUNTIME: 'disabled', PARRANDA_EVENT_READER: 'disabled' }, {
      eventReader: null, requestTimeDiscovery: null, sourceCatalog: null,
      eventCache: createSourceCache({ now: () => Date.parse(NOW) }),
      collectEvents: async options => {
        const result = await collectAnchorEvents({ ...options, fetcher: async input => {
          const url = new URL(String(input));
          // Deliberately never retain/export the complete credential-bearing URL.
          evidence.source_requests.push({ observed_at: new Date().toISOString(), origin: url.origin, pathname: url.pathname,
            apikey: '[REDACTED]', latlong: url.searchParams.get('latlong'), radius: url.searchParams.get('radius'),
            size: url.searchParams.get('size'), start: url.searchParams.get('startDateTime'), end: url.searchParams.get('endDateTime') });
          if (url.origin !== SOURCE_ORIGIN || url.pathname !== SOURCE_PATH) {
            evidence.unexpected_outbound.push({ kind: 'injected-source-fetch', origin: url.origin, pathname: url.pathname });
            throw new Error('Unexpected source transport target blocked');
          }
          assert.equal(url.searchParams.get('apikey'), FAKE_KEY);
          assert.equal(url.searchParams.get('latlong'), `${ANCHOR.lat},${ANCHOR.lng}`);
          assert.equal(url.searchParams.get('unit'), 'km');
          assert.ok(Number(url.searchParams.get('size')) <= 40);
          assert.ok(Date.parse(url.searchParams.get('startDateTime')) <= Date.parse(TARGET_START));
          assert.ok(Date.parse(url.searchParams.get('endDateTime')) >= Date.parse(`${NEXT}T19:00:00Z`));
          if (coldPlace) await eventGate;
          return new Response(JSON.stringify(fixture), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } });
        evidence.collections.push({ selected_date: options.selectedDate, time: options.time, coverage: result.coverage,
          feeds: result.feeds, acquisition: result.acquisition, browse: result.browse,
          events: allLive(result).map(compactEvent) });
        return result;
      },
    });
    assert.equal(typeof eventSupply, 'function');
    const app = buildApp({ openDataLoader: placeLoader, eventSupply,
      placeSelectionStore: createPlaceSelectionStore({ cacheDir: null }),
      placeResolver: async query => {
        assert.equal(query, PLACE);
        return [{ ...ANCHOR, label: PLACE, confidence: 'high', provenance: 'controlled-resolver' }];
      }, placeSuggestions: null, reviewedPlaceSource: null, sourceCatalog: null,
      clock: Object.assign(() => new Date(NOW), { now: () => NOW }),
      weatherProvider: async () => ({ condition: 'sun', timezone_resolution: {
        timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
    });
    server = createServer((request, response) => {
      const receipt = { sequence: evidence.server_receipts.length + 1, method: request.method,
        pathname: new URL(request.url, 'http://localhost').pathname, received_at: new Date().toISOString() };
      if (receipt.pathname.startsWith('/api/')) {
        evidence.server_receipts.push(receipt);
        response.on('finish', () => { receipt.status = response.statusCode; receipt.finished_at = new Date().toISOString(); });
      }
      app(request, response);
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
    evidence.endpoint = origin;
    browser = await chromium.launch({ headless: true,
      ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
      // Map tiles are deliberately offline and map rendering is not this
      // regression's subject. Avoid costly software WebGL on shared ARM hosts;
      // real DOM, HTTP composition and server walking validation stay intact.
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-quic', '--disable-webgl',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'] });
    evidence.browser = { version: browser.version(), executable: process.env.PARRANDA_TEST_CHROMIUM || chromium.executablePath(),
      viewport: { width: 390, height: 844 }, timezone: 'Europe/Stockholm' };
    context = await browser.newContext({ viewport: evidence.browser.viewport, timezoneId: 'Europe/Stockholm', serviceWorkers: 'block' });
    const allowedAssetHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'tiles.openfreemap.org']);
    await context.route(url => ['http:', 'https:'].includes(url.protocol) && url.origin !== origin, async route => {
      const url = new URL(route.request().url());
      const row = { origin: url.origin, pathname: url.pathname, resource_type: route.request().resourceType() };
      (allowedAssetHosts.has(url.hostname) ? evidence.blocked_browser_assets : evidence.unexpected_outbound).push(row);
      await route.abort('blockedbyclient');
    });
    await context.addInitScript(epoch => {
      const NativeDate = window.Date;
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [epoch])); }
        static now() { return epoch; }
      };
    }, Date.parse(NOW));
    page = await context.newPage();
    // The ordinary product lifecycle already allows 60s. Do not introduce a
    // shorter DOM-observer deadline that turns CPU/swap contention into a
    // claimed product failure; the entire single journey is still hard-bounded.
    page.setDefaultTimeout(65000);
    page.on('pageerror', error => evidence.page_errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin !== origin || !url.pathname.startsWith('/api/')) return;
      evidence.browser_requests.push({ method: request.method(), pathname: url.pathname,
        observed_at: new Date().toISOString(), body: sanitized(request.postDataJSON()) });
    });
    page.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (!pathname.startsWith('/api/')) return;
      responseTasks.push((async () => {
        try {
          const envelope = await response.json(), body = envelope.result || envelope;
          evidence.responses.push({ pathname, status: response.status(), observed_at: new Date().toISOString(),
            date: body.days?.[0]?.date, stops: stopsOf(body).map(stop => ({ ...compactEvent(stop), id: stop.id })),
            edit: body.agnostic_route_output_experiment?.day_edit,
            live_choices: body.agnostic_route_output_experiment?.live_event_choices,
            live_pending: body.live_events?.pending, completion: body.live_completion?.state,
            upgrade: body.live_route_upgrade?.state, live: allLive(body.live_events).map(compactEvent),
            source_health: body.live_events?.acquisition?.source_health });
        } catch { /* A cancelled response is not a publication. */ }
      })());
    });
    setPhase('initial-real-composition');
    const [initial] = await Promise.all([
      waitForPublished(page, body => stopsOf(body).length > 0),
      page.goto(`${origin}/anywhere?place=${encodeURIComponent(PLACE)}&prefs=culture&prio=culture&day=1&rhythm=full&lang=en`),
    ]);
    assert.equal(initial.days[0].date, DAY);
    assert.equal(initial.agnostic_route_output_experiment?.context?.time?.now?.slice(0, 10), NOW.slice(0, 10));
    assert.equal(initial.agnostic_route_output_experiment?.walking_validation?.valid, true);
    assert.ok(stopsOf(initial).filter(stop => !stop.is_live_event).length >= 3,
      'baseline must contain enough eligible nonlive culture stops for Remove and Replace');
    if (coldPlace) {
      assert.equal(coldMapSettled, false, 'the original map is still pending when actual directory-backed stops publish');
      assert.equal(coldAcquisitions, 1, 'one real isolated directory producer');
      assert.equal(initial.live_events.pending, true, 'the independent original Ticketmaster collection remains pending');
      assert.equal(initial.live_completion.version, 1);
      assert.ok(evidence.responses.some(row => row.pathname === '/api/route-recommendations' && row.status === 202),
        'the browser received a genuine lifecycle acknowledgement');
      assert.ok(stopsOf(initial).every(stop => stop.type === 'museum'), 'variety used for rescue is not unrelated route filler');
      releaseColdMap([]);
      releaseColdEvents();
    }
    await page.getByRole('list', { name: 'The stops, in order', exact: true }).waitFor();
    await awaitSaved(entry => Boolean(entry.safeResponse?.live_events) && entry.safeResponse.live_events.pending !== true);
    assertPriority(await savedDay(page));
    done('initial-real-composition');

    setPhase('settled-live-and-bounded-browse');
    const composeBeforeBrowse = composeRequests().length;
    await page.getByRole('button', { name: 'See all live', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Live events', exact: true });
    await sheet.getByRole('button', { name: 'By time', exact: true }).click();
    await sheet.locator(`p a[href="${TARGET_URL}"]`).waitFor({ state: 'visible' });
    const sheetText = await sheet.innerText();
    assert.match(sheetText, /Calendars:\s*1 of 1 responded/);
    const sourceRow = sheet.locator('li').filter({ has: page.locator(`a[href="${TARGET_URL}"]`) });
    const sourceDetails = sourceRow.locator('summary').filter({ hasText: /^Source details$/ });
    assert.equal(await sourceDetails.count(), 1, 'the exact occurrence has its own source disclosure');
    assert.doesNotMatch(await sourceRow.innerText(), /via\s+Ticketmaster/, 'feed attribution starts collapsed');
    await sourceDetails.click();
    assert.match(await sourceRow.innerText(), /via\s+Ticketmaster/);
    const settledEntry = await savedDay(page);
    const live = settledEntry.safeResponse.live_events;
    assert.equal(live.acquisition.source_health.failed_source_count, 0);
    assert.equal(live.acquisition.source_health.accepted_event_count, 20, 'all twenty source facts pass the real collection gates');
    assert.ok(live.browse.tonight.more_count > 0, 'selected-day supply exceeds the highlight cut');
    assert.ok(live.browse.this_week.more_count > 0, 'following-day supply also exercises bounded browsing');
    const wovenSourceIds = new Set(stopsOf(settledEntry.safeResponse).filter(stop => stop.is_live_event).map(stop => stop.event_id));
    const selectedRows = flattenEvents([...(live.tonight || []), ...(live.browse.tonight.more || [])]);
    assert.equal(selectedRows.length, 12, 'all twelve selected-day source occurrences remain in the actual Live response');
    assert.equal(await sheet.locator('li').filter({ has: page.locator('a[href^="https://www.ticketmaster.se/event/"]') }).count(),
      selectedRows.filter(event => !wovenSourceIds.has(event.id)).length,
      'Live displays every selected-day row except the occurrence already presented in the actual route');
    await capture('live-selected-settled');
    await sheet.getByRole('button', { name: 'Next 7 days', exact: true }).click();
    await sheet.locator('p a[href="https://www.ticketmaster.se/event/fixture-following-0"]').waitFor({ state: 'visible' });
    assert.equal(await sheet.getByRole('button', { name: 'Plan with this event', exact: true }).count(), 0,
      'following-day events cannot become a Keep for the selected day');
    await capture('live-following-settled');
    await sheet.getByRole('button', { name: liveDateLabel(DAY, 'en'), exact: true }).click();
    await sheet.locator(`p a[href="${TARGET_URL}"]`).waitFor({ state: 'visible' });
    assert.equal(composeRequests().length, composeBeforeBrowse, 'Live period/order inspection never composes the day');
    done('settled-live-and-bounded-browse');

    setPhase('distinct-source-occurrences');
    const events = allLive((await savedDay(page)).safeResponse.live_events);
    const chosen = events.find(event => event.source_url === TARGET_URL);
    const other = events.find(event => event.source_url === OTHER_URL);
    assert.ok(chosen && other, 'both distinct Ticketmaster IDs at the same title/venue within five minutes survive fusion');
    assert.equal(chosen.title, other.title);
    assert.equal(chosen.place, VENUE);
    assert.equal(other.place, VENUE);
    assert.equal(chosen.starts_at, TARGET_START);
    assert.equal(other.starts_at, `${DAY}T18:00:00.000Z`);
    assert.notEqual(chosen.id, other.id);
    assert.equal(chosen.source_occurrence_id, 'fixture-twin-b');
    assert.equal(other.source_occurrence_id, 'fixture-twin-a');
    assert.match(chosen.live_occurrence_id || '', /^live:2026-10-19:[a-f0-9]{32}$/);
    assert.match(other.live_occurrence_id || '', /^live:2026-10-19:[a-f0-9]{32}$/);
    assert.notEqual(chosen.live_occurrence_id, other.live_occurrence_id);
    assert.equal(chosen.live_choice_eligible, true, 'the real source-backed occurrence is still eligible');
    evidence.chosen = compactEvent(chosen);
    evidence.competing = compactEvent(other);
    done('distinct-source-occurrences');
    await sheet.getByRole('button', { name: 'Close live', exact: true }).click();
    const beforeKeep = await savedDay(page);
    await capture('before-exact-keep');

    setPhase('explicit-exact-keep');
    const kept = await chooseExact();
    assertExactKeep(kept, chosen.live_occurrence_id);
    assert.deepEqual(composeRequests().at(-1).body.live_event_choices,
      [{ occurrence_id: chosen.live_occurrence_id, action: 'keep' }]);
    assert.ok(!composeRequests().at(-1).body.pinned_candidate_ids?.includes(chosen.live_occurrence_id));
    await capture('exact-keep-confirmed');
    done('explicit-exact-keep');

    setPhase('exact-no-compose-undo');
    const undoCount = composeRequests().length;
    await page.getByRole('button', { name: 'Undo this change', exact: true }).click();
    await page.waitForFunction(({ key, expected }) => localStorage.getItem(key) === JSON.stringify(expected), { key: LAST, expected: beforeKeep });
    assert.deepEqual(await savedDay(page), beforeKeep, 'Undo restores the exact prior complete inputs/response/commitment snapshot');
    await delay(650); // Beyond the actual 400ms automatic-compose debounce.
    assert.equal(composeRequests().length, undoCount, 'Undo must not issue a compose request');
    assert.equal(await page.getByRole('region', { name: 'The route', exact: true })
      .getByRole('button', { name: 'Kept — release', exact: true }).count(), 0);
    await capture('undo-exact-prior-snapshot');
    done('exact-no-compose-undo');

    setPhase('keep-again');
    assertExactKeep(await chooseExact(), chosen.live_occurrence_id);
    done('keep-again');
    setPhase('kept-url-reload');
    const beforeReloadCount = composeRequests().length;
    const acceptedKeep = await savedDay(page);
    await assertExactNavigation({ page, navigate: () => page.reload(), expectedEntry: acceptedKeep,
      readComposeCount: () => composeRequests().length });
    await page.getByRole('region', { name: 'The route', exact: true })
      .getByRole('button', { name: 'Kept — release', exact: true }).waitFor();
    const reloadedKeep = await awaitSaved(entry => entry.safeResponse?.agnostic_route_output_experiment?.live_event_choices?.honored_count === 1);
    assertExactKeep(reloadedKeep, chosen.live_occurrence_id);
    assert.equal(composeRequests().length, beforeReloadCount, 'ordinary reload restores the exact accepted Keep without revalidation');
    assert.deepEqual(reloadedKeep, acceptedKeep);
    await capture('kept-reloaded');
    done('kept-url-reload');

    // Complete ordinary Keep -> reload -> release before crossing a fresh Keep
    // with manual edits. Releasing an already strict edit is a separate contract,
    // not permission to weaken the independent Keep/manual-edit assertions.
    setPhase('ordinary-release');
    const [releasedBody] = await Promise.all([
      waitForPublished(page, body => (body.agnostic_route_output_experiment?.live_event_choices?.requested_count ?? 0) === 0),
      page.getByRole('region', { name: 'The route', exact: true })
        .getByRole('button', { name: 'Kept — release', exact: true }).click(),
    ]);
    assert.ok(stopsOf(releasedBody).length > 0, 'ordinary release publishes a real day rather than a refusal');
    const released = await awaitSaved(entry => !Object.keys(entry.commitments?.entries || {}).some(id => id.startsWith('live:')));
    assertPriority(released);
    assert.notEqual(released.commitments?.entries?.[chosen.live_occurrence_id]?.kind, 'pin');
    assert.ok(!composeRequests().at(-1).body.live_event_choices?.some(choice => choice.action === 'keep'));
    assert.equal(await page.getByRole('region', { name: 'The route', exact: true })
      .getByRole('button', { name: 'Kept — release', exact: true }).count(), 0);
    await capture('ordinary-released-after-reload');
    done('ordinary-release');

    setPhase('keep-for-manual-edits');
    const manualKeep = await chooseExact();
    assertExactKeep(manualKeep, chosen.live_occurrence_id);
    done('keep-for-manual-edits');
    setPhase('manual-shorter-remove-with-keep');
    const baselineCount = stopsOf(manualKeep.safeResponse).length;
    const removed = stopsOf(manualKeep.safeResponse).find(stop => !stop.is_live_event);
    const removePanel = await openStableStop(page, removed);
    const [removedBody] = await Promise.all([
      waitForPublished(page, body => Boolean(body.agnostic_route_output_experiment?.day_edit)),
      removePanel.getByRole('button', { name: 'Remove', exact: true }).click(),
    ]);
    assert.equal(removedBody.agnostic_route_output_experiment.day_edit.status, 'applied',
      'manual Remove must preserve a still-eligible explicit Keep or report its concrete atomic refusal');
    const cap = baselineCount - 1;
    const shortened = await awaitSaved(entry => entry.inputs?.dayEdit?.action === 'remove' && Boolean(entry.inputs.dayEdit.removed_candidate_ids?.length));
    assertShorter(shortened, chosen.live_occurrence_id, cap, [removed.id]);
    assert.ok(composeRequests().at(-1).body.excluded_candidate_ids.includes(removed.id));
    assert.equal(composeRequests().at(-1).body.day_edit.target_stop_count, cap);
    await capture('shorter-remove-keeps-exact-event');
    done('manual-shorter-remove-with-keep');

    setPhase('manual-replace-with-keep');
    const replaced = stopsOf(shortened.safeResponse).find(stop => !stop.is_live_event);
    const replacePanel = await openStableStop(page, replaced);
    const [replacedBody] = await Promise.all([
      waitForPublished(page, body => body.agnostic_route_output_experiment?.day_edit?.action === 'replace'),
      replacePanel.getByRole('button', { name: 'Replace', exact: true }).click(),
    ]);
    assert.equal(replacedBody.agnostic_route_output_experiment.day_edit.status, 'applied',
      'manual Replace must preserve the eligible exact Keep and shorter extent, not silently replace or refill it');
    await awaitSaved(entry => Object.values(entry.commitments?.entries || {}).some(item => item.kind === 'exclude'));
    const replacedEntry = await savedDay(page);
    assertShorter(replacedEntry, chosen.live_occurrence_id, cap, [removed.id, replaced.id]);
    assert.equal(replacedEntry.commitments.entries[replaced.id]?.kind, 'exclude');
    assert.ok(replacedEntry.inputs.dayEdit.removed_candidate_ids.includes(removed.id));
    const replaceRequest = composeRequests().at(-1).body;
    assert.equal(replaceRequest.day_edit.target_stop_count, cap);
    assert.ok(replaceRequest.day_edit.retained_candidate_ids.includes(stopsOf(shortened.safeResponse).find(stop => stop.is_live_event).id));
    assert.ok([removed.id, replaced.id].every(id => replaceRequest.excluded_candidate_ids.includes(id)));
    await capture('replacement-keeps-shorter-exact-event');
    done('manual-replace-with-keep');

    setPhase('edited-url-reload');
    const editedIds = stopsOf(replacedEntry.safeResponse).map(stop => stop.id);
    const editedReloadCount = composeRequests().length;
    await assertExactNavigation({ page, navigate: () => page.reload(), expectedEntry: replacedEntry,
      readComposeCount: () => composeRequests().length });
    await page.getByRole('region', { name: 'The route', exact: true })
      .getByRole('button', { name: 'Kept — release', exact: true }).waitFor();
    const editedReload = await awaitSaved(entry => entry.inputs?.dayEdit?.removed_candidate_ids?.length > 0 &&
      Object.values(entry.commitments?.entries || {}).some(item => item.kind === 'exclude'));
    assertShorter(editedReload, chosen.live_occurrence_id, cap, [removed.id, replaced.id]);
    assert.deepEqual(stopsOf(editedReload.safeResponse).map(stop => stop.id), editedIds, 'reload retains the applied edit rather than replaying replacement');
    assert.equal(composeRequests().length, editedReloadCount, 'applied replacement must not replay on exact reload');
    assert.equal(editedReload.inputs.dayEdit.action, 'remove', 'persisted applied extent is not a one-shot Replace command');
    assert.equal(editedReload.inputs.dayEdit.target_stop_count, cap);
    assert.deepEqual(editedReload.inputs.dayEdit.retained_candidate_ids, editedIds);
    assert.ok(editedReload.inputs.dayEdit.removed_candidate_ids.includes(removed.id), 'manual removal remains in its durable edit owner');
    assert.equal(editedReload.commitments.entries[replaced.id]?.kind, 'exclude', 'replacement exclusion remains in its durable ledger owner');
    assert.equal(new URL(page.url()).searchParams.get('prio'), 'culture');
    await capture('edited-reload-preserves-priority-cap-exclusions');
    done('edited-url-reload');

    setPhase('edited-language-navigation');
    await assertExactNavigation({ page, expectedEntry: editedReload,
      navigate: () => page.getByRole('link', { name: 'SV', exact: true }).click(),
      readComposeCount: () => composeRequests().length, listName: 'Stoppen i ordning' });
    assertExactKeep(await savedDay(page), chosen.live_occurrence_id);
    await page.getByRole('heading', { name: PLACE, exact: true }).waitFor();
    await capture('edited-language-keeps-exact-answer');
    done('edited-language-navigation');
    setPhase('edited-native-back');
    await assertExactNavigation({ page, expectedEntry: editedReload, navigate: () => page.goBack(),
      readComposeCount: () => composeRequests().length });
    assertShorter(await savedDay(page), chosen.live_occurrence_id, cap, [removed.id, replaced.id]);
    await capture('edited-native-back-keeps-exact-answer');
    done('edited-native-back');

    setPhase('release-after-strict-edit');
    const [releasedEditBody] = await Promise.all([
      waitForPublished(page, body => Boolean(body.agnostic_route_output_experiment?.day_edit)),
      page.getByRole('region', { name: 'The route', exact: true })
        .getByRole('button', { name: 'Kept — release', exact: true }).click(),
    ]);
    assert.equal(releasedEditBody.agnostic_route_output_experiment.day_edit.status, 'applied',
      'release must withdraw the old retained-Live obligation without losing the shorter extent or exclusions');
    assert.equal(composeRequests().at(-1).body.day_edit.preserve_retained, false,
      'an explicit release is an adjustment, not an instruction to retain the unpinned occurrence');
    const releasedEdit = await awaitSaved(entry => !Object.keys(entry.commitments?.entries || {}).some(id => id.startsWith('live:')));
    assertPriority(releasedEdit);
    assert.equal(stopsOf(releasedEdit.safeResponse).length, cap);
    assert.equal(releasedEdit.inputs.dayEdit.target_stop_count, cap);
    assert.ok([removed.id, replaced.id].every(id => !stopsOf(releasedEdit.safeResponse).some(stop => stop.id === id)));
    assert.ok(!composeRequests().at(-1).body.live_event_choices?.some(choice => choice.action === 'keep'));
    assert.equal(await page.getByRole('region', { name: 'The route', exact: true })
      .getByRole('button', { name: 'Kept — release', exact: true }).count(), 0);
    await capture('released-after-strict-edit');
    done('release-after-strict-edit');

    setPhase('released-edit-url-reload');
    const releasedIds = stopsOf(releasedEdit.safeResponse).map(stop => stop.id);
    await assertExactNavigation({ page, navigate: () => page.reload(), expectedEntry: releasedEdit,
      readComposeCount: () => composeRequests().length });
    const releasedReload = await awaitSaved(entry => Boolean(entry.inputs?.dayEdit) &&
      !Object.keys(entry.commitments?.entries || {}).some(id => id.startsWith('live:')));
    assertPriority(releasedReload);
    assert.equal(stopsOf(releasedReload.safeResponse).length, cap);
    assert.deepEqual(stopsOf(releasedReload.safeResponse).map(stop => stop.id), releasedIds);
    assert.ok([removed.id, replaced.id].every(id => !stopsOf(releasedReload.safeResponse).some(stop => stop.id === id)));
    assert.ok(!composeRequests().at(-1).body.live_event_choices?.some(choice => choice.action === 'keep'));
    await capture('released-edit-reload-retains-shorter-day');
    done('released-edit-url-reload');

    for (const request of composeRequests()) {
      assert.deepEqual(request.body.preference_priority, ['culture'], 'every actual HTTP composition preserves explicit priority');
      assert.deepEqual(request.body.dates, [DAY]);
      assert.equal(request.body.day_rhythm, 'full');
      for (const choice of request.body.live_event_choices || []) assert.deepEqual(Object.keys(choice).sort(), ['action', 'occurrence_id']);
    }
    assert.ok(evidence.source_requests.length >= 1 && evidence.source_requests.length <= 4, 'bounded source collection and scope/period cache reuse');
    assert.equal(evidence.server_receipts.filter(row => row.pathname === '/api/route-recommendations' && row.method === 'POST').length,
      composeRequests().length, 'every observed compose actually reaches the HTTP server');
    assert.deepEqual(evidence.unexpected_outbound, [], 'all unexpected browser/Node/source outbound attempts are blocked and counted');
    assert.deepEqual(evidence.page_errors, [], 'built UI has no browser/React exception');
    if (coldPlace) assert.equal(coldAcquisitions, 1, 'completion, edits and reload cannot restart directory acquisition');
    assert.deepEqual(evidence.completed_contracts, REQUIRED);
    evidence.outcome = 'PASS';
  } catch (error) {
    evidence.outcome = evidence.phase === 'setup' ? 'SETUP_LIMIT' : 'FAIL';
    evidence.failure = { phase: evidence.phase, name: error.name, message: error.message, stack: error.stack };
    if (page && !page.isClosed()) await capture(`failed-${evidence.phase}`).catch(captureError => { evidence.capture_error = captureError.message; });
    throw error;
  } finally {
    releaseColdMap?.([]); releaseColdEvents?.();
    await Promise.allSettled(responseTasks);
    await context?.close();
    await browser?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      evidence.listener_closed = !server.listening && server.address() === null;
    }
    restoreNetwork();
    evidence.source_end = sourceSnapshot();
    evidence.tracked_source_changed_during_run = evidence.source_start.tracked_diff !== evidence.source_end.tracked_diff;
    evidence.totals = { cold_place_acquisitions: coldAcquisitions,
      required_contracts: REQUIRED.length, completed_contracts: evidence.completed_contracts.length,
      unobserved_contracts: REQUIRED.filter(label => !evidence.completed_contracts.includes(label)),
      compose_posts: composeRequests().length, source_transport_calls: evidence.source_requests.length,
      collections: evidence.collections.length, blocked_browser_assets: evidence.blocked_browser_assets.length,
      unexpected_outbound_calls: evidence.unexpected_outbound.length, browser_exceptions: evidence.page_errors.length,
      server_api_receipts: evidence.server_receipts.length, screenshots: evidence.checkpoints.length * 2 };
    writeFileSync(join(directory, 'journey.json'), JSON.stringify(sanitized(evidence), null, 2));
    writeFileSync(join(directory, 'tracked-start.patch'), sanitized({ patch: beforeSource.tracked_diff }).patch);
    writeFileSync(join(directory, 'tracked-end.patch'), sanitized({ patch: evidence.source_end.tracked_diff }).patch);
    t.diagnostic(JSON.stringify({ outcome: evidence.outcome, phase: evidence.phase, directory: relative(ROOT, directory), ...evidence.totals }));
    assert.deepEqual(evidence.unexpected_outbound, [], 'unexpected outbound attempted: see sanitized journey.json');
    assert.deepEqual(evidence.page_errors, [], 'browser/React exceptions: see sanitized journey.json');
    if (server) assert.equal(evidence.listener_closed, true, 'owned local HTTP listener is closed');
  }
});
