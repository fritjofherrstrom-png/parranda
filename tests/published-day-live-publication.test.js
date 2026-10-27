'use strict';
require('./helpers/file-deadline');
require('./helpers/no-live-network');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildApp } = require('../server/app');
const { createWikidataSource } = require('../server/place-candidates/wikidata-source');
const { createPublishedDayStore } = require('../server/planner/published-day-store');
const { resolveDefaultEventSupply, collectAnchorEvents, HELSINKI_LINKED_EVENTS_FEED } = require('../server/place-candidates/agnostic-event-supply');
const { mockStableWeatherFetch } = require('./helpers/planner-reservoir-compare');
const ROUTE = '/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&agnostic_engine_compose=1&include_live_completion=1&include_live_route_upgrade=1';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function request(server, { method = 'POST', url = `${ROUTE}&include_day_snapshot=1`, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: url, method,
      headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject); req.end(payload);
  });
}
// Shared only by the owned backend/mounted tracer. Provider payloads enter at
// the transport seam; the configured supply, collector and normalizer stay real.
async function setup(t, { rows = [], put, transport, wix = false, appOptions = {} } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'published-live-day-'));
  const originalFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  const gate = deferred(), settlements = [];
  let loads = 0, resolutions = 0, puts = 0, supplies = 0, collections = 0, transports = 0;
  const records = await createWikidataSource({ limit: 60, fetcher: async () => ({ ok: true, json: async () => ({ results: { bindings:
    Array.from({ length: 24 }, (_, i) => ({ item: { value: `http://www.wikidata.org/entity/Q${1000+i}` },
      itemLabel: { value: `Collection ${i+1}` }, lat: { value: String(41.9+(i%6)*.0008) },
      lng: { value: String(12.49+Math.floor(i/6)*.0008) }, classRoot: { value: 'http://www.wikidata.org/entity/Q33506' } })) } }) }) })({ lat: 41.9, lng: 12.49 });
  const wixFeed = require('../config/reviewed-event-feeds.json').find(f => f.id === 'visit-ystad-osterlen-calendar');
  let venueLookups = 0;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: 'enabled',
    PARRANDA_EVENT_FEEDS: JSON.stringify(wix ? [{ ...wixFeed, bbox: [12,41,13,42] }] : [{ ...HELSINKI_LINKED_EVENTS_FEED, id: 'controlled-roma', label: 'Controlled calendar', bbox: [12,41,13,42], timezone: 'Europe/Rome' }]),
    PARRANDA_EVENT_READER: 'disabled', PARRANDA_REQUEST_TIME_EVENT_DISCOVERY: 'disabled',
  }, { eventReader: null, requestTimeDiscovery: null,
    ...(wix ? { venueResolver: async () => { venueLookups++; return [{ label: 'Harbour hall', lat: 41.903, lng: 12.493, confidence: 'high', provenance: 'offline_fixture' }]; } } : {}),
    collectEvents: async options => {
    collections++;
    const collected = deferred(); settlements.push(collected.promise);
    try { return await collectAnchorEvents({ ...options, fetcher: async input => {
      const url = new URL(String(input));
      transports++;
      await gate.promise;
      if (wix) {
        const wireUrl = String(input);
        const response = { ...wixTransport(wireUrl === WIX_ROOT || wireUrl === WIX_CHILD ? wireUrl : WIX_EVENT, options), url: wireUrl };
        return transport ? transport(options, wireUrl, response) : response;
      }
      assert.equal(url.origin, 'https://api.hel.fi'); assert.equal(url.pathname, '/linkedevents/v1/event/');
      return transport ? transport(options) : { ok: true, json: async () => ({ data: typeof rows === 'function' ? rows(options) : rows }) };
    } }); } finally { collected.resolve(); }
  } });
  const store = createPublishedDayStore({ directory });
  const tracedStore = { read: store.read, async put(value) { puts++; return put ? put(value, store) : store.put(value); } };
  const server = buildApp({ openDataLoader: async () => { loads++; return records; },
    placeResolver: async () => { resolutions++; return [{ label: 'Roma, Italia', lat: 41.9, lng: 12.49,
      confidence: 'high', provenance: 'offline_fixture', timezone: 'Europe/Rome', osm_class: 'place', osm_ref: 'relation/41485' }]; },
    placeSuggestions: null, reviewedPlaceSource: null, sourceCatalog: null,
    eventSupply: args => { supplies++; return supply(args); }, placeSelectionStore: { issue: () => null }, publishedDayStore: tracedStore,
    ...appOptions,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { gate.resolve(); await Promise.all(settlements); await turn(); await new Promise(r => server.close(r)); global.fetch = originalFetch; await fs.rm(directory, { recursive: true, force: true }); });
  return { server, directory, store, records, tracedStore,
    async complete() { gate.resolve(); await Promise.all(settlements); await turn(); },
    counts: () => ({ loads, resolutions, puts, supplies, collections, transports, ...(wix ? { venueLookups } : {}) }) };
}
const WIX_ROOT = 'https://www.visitystadosterlen.se/sitemap.xml';
const WIX_CHILD = 'https://www.visitystadosterlen.se/dynamic-evenemang-1_controlled_0_5000-sitemap.xml';
const WIX_EVENT = 'https://www.visitystadosterlen.se/evenemang-1/%C3%96ppen-kultur/101';
function wixTransport(url, options) {
  let text;
  if (url === WIX_ROOT) text = `<sitemapindex generatedBy="WIX"><sitemap><loc>${WIX_CHILD}</loc></sitemap></sitemapindex>`;
  else if (url === WIX_CHILD) text = `<urlset generatedBy="WIX"><url><loc>${WIX_EVENT}</loc></url></urlset>`;
  else {
    assert.equal(url, WIX_EVENT);
    const next = new Date(`${options.selectedDate}T12:00:00Z`); next.setUTCDate(next.getUTCDate()+1);
    text = `<!doctype html><html lang="sv"><head><meta name="generator" content="Wix.com Website Builder"><meta property="og:title" content="Original public exhibition"></head><body>
    <div data-testid="richTextElement"><h2>När:</h2></div><!--/$-->
    <div data-testid="richTextElement"><p>${new Date(`${options.selectedDate}T12:00:00Z`).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} - ${next.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</p></div><!--/$-->
    <div data-testid="richTextElement"><h2>Var:</h2></div><!--/$-->
    <div data-testid="richTextElement"><p>Harbour hall<br>Market street 2<br>123 45 Testhamn</p></div><!--/$-->
    <div data-testid="richTextElement"><h2>Öppettider</h2></div><!--/$-->
    <div data-testid="richTextElement"><p>10:00 - 17:00</p></div><!--/$--></body></html>`;
  }
  return { ok: true, status: 200, url, text: async () => text };
}
function originalBody(date = new Date().toISOString().slice(0,10)) {
  return { place: 'Roma', dates: [date], preferences: ['culture'], day_rhythm: 'balanced', include_external_candidates: 1 };
}
function eventRows(options) {
  return [{ id: 'roma-original-concert', name: { en: 'Original concert' },
    start_time: `${options.selectedDate}T16:00:00Z`, end_time: `${options.selectedDate}T18:00:00Z`,
    location: { position: { coordinates: [12.493, 41.903] }, name: { en: 'Test venue' } },
    info_url: { en: 'https://example.org/private-concert?ticket=controlled' }, data_source: 'fixture', keywords: [{ name: { en: 'music' } }] }];
}
function accepted(body) {
  assert.equal(body.agnostic_route_output_experiment.promotion.promote, true);
  assert.ok(body.days[0].primary_route.main_stops.length > 0);
  assert.ok(body.days[0].primary_route.main_stops.every(s => s.origin === 'curated_catalog' && !s.id.startsWith('wikidata-')));
}
function assertLiveFacts(actual, terminal) {
  assert.equal(actual.selected_date, terminal.selected_date);
  assert.equal(actual.coverage, terminal.coverage);
  assert.deepEqual(actual.acquisition.source_health, terminal.acquisition.source_health);
  // The established closed portable schema deliberately omits acquisition-only
  // ranking/geometry diagnostics. Compare every retained fact, plus explicit
  // identity/time/source preconditions, rather than demand diagnostic leakage.
  const compare = (got, source) => {
    if (Array.isArray(got)) { assert.equal(got.length, source.length); got.forEach((row, i) => compare(row, source[i])); }
    else if (got && typeof got === 'object') for (const key of Object.keys(got)) compare(got[key], source[key]);
    else assert.deepEqual(got, source);
  };
  for (const bucket of ['tonight','this_week']) {
    compare(actual[bucket], terminal[bucket]);
    actual[bucket].forEach((row, i) => {
      for (const key of ['id','title','source_provider_id','source_url','sources','starts_at','ends_at','starts_on','ends_on','time_window','lat','lng','trust_level'])
        assert.ok(Object.hasOwn(row, key), `portable event retains ${key}`);
      assert.equal(row.source_url, terminal[bucket][i].source_url);
    });
  }
  compare(actual.browse, terminal.browse);
}
module.exports = { setup, request, originalBody, accepted, assertLiveFacts, eventRows, ROUTE, deferred, turn, WIX_ROOT, WIX_CHILD, WIX_EVENT, wixTransport };
if (require.main === module) {
test('publication capture bounds the complete private frame before cloning or serialization', async t => {
  const { createDayPublication } = require('../server/planner/published-day-publication');
  const { createLiveCompletionStore, LIVE_COLLECTION_READ } = require('../server/planner/live-completion');
  const h = await setup(t);
  const body = originalBody();
  const original = await request(h.server, { body });
  assert.equal(original.status, 200); accepted(original.body);
  const publication = createDayPublication({ body, query: { include_day_snapshot: '1' } }, () => false);
  publication.retain({ records: h.records, date: original.body.days[0].date }, {
    preferences: ['culture'], preferencePriority: [], dayRhythm: 'balanced', excludedCandidateIds: [],
    pinnedCandidateIds: [], liveEventChoices: [], dayEdit: null,
  });
  const ordinary = publication.liveContext(original.body, 'en');
  assert.ok(ordinary);
  const witness = ordinary.privacy.publicSourceUrls;
  assert.ok(witness instanceof Set); assert.equal(witness.size, 24);
  const oversized = { ...original.body, capture_bound_diagnostic: 'x'.repeat(3 * 1024 * 1024) };
  const nativeClone = globalThis.structuredClone;
  const nativeStringify = JSON.stringify;
  let oversizedClones = 0, contextSerializations = 0;
  globalThis.structuredClone = (value, ...options) => {
    if (value && Object.hasOwn(value, 'capture_bound_diagnostic')) oversizedClones++;
    return nativeClone(value, ...options);
  };
  JSON.stringify = (value, ...options) => {
    if (value?.published || value && Object.hasOwn(value, 'capture_bound_diagnostic')) contextSerializations++;
    return nativeStringify(value, ...options);
  };
  try {
    assert.equal(publication.liveContext(oversized, 'en') === null, true, 'oversized capture must refuse before cloning');
    assert.equal(oversizedClones, 0, 'no native clone of an oversized frame');
    const oversizedWitness = 'https://example.org/' + 'x'.repeat(3 * 1024 * 1024);
    witness.add(oversizedWitness);
    try { assert.equal(publication.liveContext(original.body, 'en') === null, true, 'native witness payload shares the context budget'); }
    finally { witness.delete(oversizedWitness); }
    let reads = 0;
    const accessor = { ...original.body };
    Object.defineProperty(accessor, 'capture_bound_diagnostic', { enumerable: true, get() { reads++; return oversized; } });
    assert.equal(publication.liveContext(accessor, 'en') === null, true);
    assert.equal(reads, 0, 'unsupported capture accessors are never executed');
    const cyclic = { ...original.body }; cyclic.capture_bound_diagnostic = cyclic;
    assert.equal(publication.liveContext(cyclic, 'en') === null, true);
    const callable = { ...original.body, capture_bound_diagnostic: () => oversized };
    assert.equal(publication.liveContext(callable, 'en') === null, true, 'the data-only capture must not retain callable closures');
    const shared = { value: 'original' };
    let dag = shared;
    for (let i = 0; i < 24; i++) dag = { left: dag, right: dag };
    const captured = publication.liveContext({ ...original.body, capture_bound_diagnostic: dag }, 'en');
    assert.ok(captured, 'compact repeated-reference graph fits the retained graph budget');
    assert.equal(captured.privacy.publicSourceUrls, witness, 'native source witness is preserved, not reminted');
    assert.equal(captured.published.capture_bound_diagnostic.left, captured.published.capture_bound_diagnostic.right);
    let leaf = captured.published.capture_bound_diagnostic;
    for (let i = 0; i < 24; i++) leaf = leaf.left;
    shared.value = 'changed';
    assert.equal(leaf.value, 'original', 'bounded copy remains isolated from later source mutation');
    assert.equal(Object.hasOwn(captured.published, 'live_completion'), false);
    assert.equal(Object.hasOwn(captured.published, 'day_snapshot'), false);
    const store = createLiveCompletionStore();
    const capability = store.issue({ pending: true, [LIVE_COLLECTION_READ]: () => ({ pending: true }) });
    assert.equal(store.bindPublication(capability.token, captured, async () => null), true);
    assert.equal(store.bindPublication(store.issue({ pending: true, [LIVE_COLLECTION_READ]: () => ({ pending: true }) }).token,
      { ...captured, published: oversized }, async () => null), false, 'bind also rejects unsupported unbounded input');
    assert.equal(contextSerializations, 0, 'private context is never expanded with unbounded JSON serialization');
  } finally { globalThis.structuredClone = nativeClone; JSON.stringify = nativeStringify; }
  await h.complete();
  assert.equal(h.counts().puts, 0, 'refused capture changes no original route, Live result or storage');
});

test('original pending HTTP → configured healthy-empty collector → immutable terminal completion GET', async t => {
  const h = await setup(t);
  const body = originalBody();
  const original = await request(h.server, { body });
  assert.equal(original.status, 200); accepted(original.body);
  assert.equal(original.body.live_events.pending, true);
  assert.equal(original.body.day_snapshot.state, 'unavailable');
  const token = original.body.live_completion.token;
  assert.equal((await request(h.server, { url: '/api/planner-live-completion', body: { token } })).status, 202);
  assert.equal(h.counts().puts, 0);
  await h.complete();
  const terminal = await request(h.server, { url: '/api/planner-live-completion', body: { token } });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.live_events.acquisition.source_health.status, 'healthy');
  assert.equal(terminal.body.live_events.acquisition.source_health.result, 'empty');
  assert.deepEqual(terminal.body.live_events.tonight, []);
  assert.equal(terminal.body.days, undefined, 'events-only endpoint never carries a full day');
  assert.equal(terminal.body.day_snapshot?.state, 'ready', 'terminal original Live must publish its immutable revision');
  const counts = h.counts();
  const get = await request(h.server, { method: 'GET', url: `/api/shared-days/${terminal.body.day_snapshot.ref}` });
  assert.equal(get.status, 200);
  assert.deepEqual(get.body.result.days[0].primary_route.main_stops.map(s => s.id), original.body.days[0].primary_route.main_stops.map(s => s.id));
  assert.deepEqual(get.body.result.days[0].primary_route.map_path_points, original.body.days[0].primary_route.map_path_points);
  assert.deepEqual(get.body.result.days[0].primary_route.map_route_points, original.body.days[0].primary_route.map_route_points);
  assert.equal(get.body.intent.dateIso, body.dates[0]);
  assertLiveFacts(get.body.result.live_events, terminal.body.live_events);
  assert.equal(JSON.stringify(get.body).includes(token), false, 'no bearer in durable result');
  assert.deepEqual(h.counts(), counts, 'completion and GET do not reacquire');
  assert.equal(counts.puts, 1); assert.equal(counts.supplies, 1); assert.equal(counts.collections, 1);
});

test('concurrent and repeated terminal HTTP reads reserve one atomic immutable put; disconnect is consumer-local', async t => {
  const entered = deferred(), release = deferred();
  const h = await setup(t, { put: async (value, store) => { entered.resolve(); await release.promise; return store.put(value); } });
  t.after(() => release.resolve());
  const original = await request(h.server, { body: originalBody() });
  const token = original.body.live_completion.token;
  await h.complete();
  // First consumer disconnects after reservation. Its socket cannot revoke the
  // already-authorized original generation needed by the second consumer.
  const payload = JSON.stringify({ token });
  const abandoned = http.request({ hostname: '127.0.0.1', port: h.server.address().port, path: '/api/planner-live-completion', method: 'POST', headers: { 'Content-Type': 'application/json' } });
  abandoned.on('error', () => {}); abandoned.end(payload);
  await entered.promise;
  const closed = new Promise(resolve => abandoned.once('close', resolve)); abandoned.destroy(); await closed;
  const parallel = Array.from({ length: 4 }, () => request(h.server, { url: '/api/planner-live-completion', body: { token } }));
  assert.equal(h.counts().puts, 1);
  release.resolve();
  const answers = await Promise.all(parallel);
  assert.equal(answers[0].body.day_snapshot.state, 'ready');
  for (const answer of answers) assert.deepEqual(answer, answers[0]);
  for (let i = 0; i < 3; i++) assert.deepEqual(await request(h.server, { url: '/api/planner-live-completion', body: { token } }), answers[0]);
  assert.equal(h.counts().puts, 1);
  const ref = answers[0].body.day_snapshot.ref;
  const before = await fs.readFile(path.join(h.directory, 'published-days-v1', `${ref}.json`), 'utf8');
  assert.equal((await h.store.read(ref)).status, 200);
  assert.equal(await fs.readFile(path.join(h.directory, 'published-days-v1', `${ref}.json`), 'utf8'), before);
});

test('no opt-in, body-only claims and nonliteral opt-ins cannot authorize completion publication', async t => {
  const h = await setup(t);
  const tokens = [];
  for (const suffix of ['', '&include_day_snapshot=0', '&include_day_snapshot=true', '&include_day_snapshot=1&include_day_snapshot=1']) {
    const original = await request(h.server, { url: `${ROUTE}${suffix}`, body: { ...originalBody(), include_day_snapshot: 1, privacy: {}, publicSourceUrls: ['https://www.wikidata.org/wiki/Q1000'] } });
    accepted(original.body); assert.equal(original.body.day_snapshot, undefined);
    tokens.push(original.body.live_completion.token);
  }
  await h.complete();
  for (const token of tokens) {
    const terminal = await request(h.server, { url: '/api/planner-live-completion', body: { token } });
    assert.equal(terminal.status, 200); assert.equal(terminal.body.day_snapshot, undefined);
    assert.deepEqual(Object.keys(terminal.body).sort(), ['live_completion', 'live_events']);
  }
  assert.equal(h.counts().puts, 0);
});

test('mixed token requests refuse before publication and cannot change original intent or privacy', async t => {
  const h = await setup(t);
  const original = await request(h.server, { body: originalBody() });
  const token = original.body.live_completion.token;
  await h.complete();
  for (const call of [
    { url: '/api/planner-live-completion?include_day_snapshot=1', body: { token } },
    { url: '/api/planner-live-completion', body: { token, include_day_snapshot: 1 } },
    { url: '/api/planner-live-completion', body: { token, dates: ['2030-01-01'], privacy: { explicitCoordinatesPresent: false } } },
  ]) assert.equal((await request(h.server, call)).status, 400);
  assert.equal(h.counts().puts, 0);
  const terminal = await request(h.server, { url: '/api/planner-live-completion', body: { token } });
  assert.equal(terminal.body.day_snapshot.state, 'ready');
  const get = await h.store.read(terminal.body.day_snapshot.ref);
  assert.equal(get.body.intent.dateIso, original.body.days[0].date);
  assert.deepEqual(get.body.intent.selected, ['culture']);
});

test('raw private original presence survives successful HTTP completion and public claims', async t => {
  for (const extra of [{ lat: null }, { place_bias: null }, { home_base: null }, { start: { type: 'coordinates', lat: 41.9, lng: 12.49 } }]) {
    await t.test(Object.keys(extra)[0], async t => {
      const h = await setup(t);
      const original = await request(h.server, { body: { ...originalBody(), ...extra, privacy: { explicitCoordinatesPresent: false, customEndpointPresent: false, biasPresent: false } } });
      accepted(original.body);
      const token = original.body.live_completion.token;
      await h.complete();
      const terminal = await request(h.server, { url: '/api/planner-live-completion', body: { token } });
      assert.equal(terminal.status, 200);
      assert.equal(terminal.body.live_events.acquisition.source_health.result, 'empty');
      assert.deepEqual(terminal.body.day_snapshot, { version: 1, state: 'unavailable' });
      assert.equal(h.counts().puts, 0);
    });
  }
});

test('store failure is shared once and fail-soft without changing healthy terminal Live', async t => {
  const h = await setup(t, { put: () => { throw new Error('controlled persistence failure'); } });
  const original = await request(h.server, { body: originalBody() });
  const token = original.body.live_completion.token;
  await h.complete();
  const answers = await Promise.all(Array.from({ length: 4 }, () => request(h.server, { url: '/api/planner-live-completion', body: { token } })));
  for (const answer of answers) {
    assert.equal(answer.status, 200);
    assert.equal(answer.body.live_events.acquisition.source_health.status, 'healthy');
    assert.equal(answer.body.live_events.acquisition.source_health.result, 'empty');
    assert.deepEqual(answer.body.day_snapshot, { version: 1, state: 'unavailable' });
    assert.deepEqual(answer, answers[0]);
  }
  assert.equal(h.counts().puts, 1);
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('actual unsupported retained terminal event URL refuses whole snapshot without removing facts, health or upgrade', async t => {
  const date = new Date().toISOString().slice(0,10);
  const h = await setup(t, { rows: eventRows, appOptions: { clock: { now: () => `${date}T10:00:00.000Z` } } });
  const original = await request(h.server, { body: originalBody(date) });
  const token = original.body.live_completion.token;
  await h.complete();
  const terminal = await request(h.server, { url: '/api/planner-live-completion', body: { token } });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.live_events.acquisition.source_health.status, 'healthy');
  assert.equal(terminal.body.live_events.acquisition.source_health.result, 'events_found');
  assert.ok(JSON.stringify(terminal.body.live_events).includes('https://example.org/private-concert?ticket=controlled'));
  assert.ok(terminal.body.live_events.tonight.some(row => row.title === 'Original concert'));
  assert.deepEqual(terminal.body.day_snapshot, { version: 1, state: 'unavailable' });
  const upgrade = await request(h.server, { url: '/api/planner-live-route-upgrade', body: { token } });
  assert.equal(upgrade.status, 200); assert.equal(upgrade.body.live_route_upgrade.state, 'applied');
  assert.ok(upgrade.body.result.days[0].primary_route.main_stops.some(s => s.event_id === 'roma-original-concert'));
  assert.deepEqual(upgrade.body.result.day_snapshot, { version: 1, state: 'unavailable' });
  assert.equal(h.counts().puts, 0); assert.equal(h.counts().supplies, 1); assert.equal(h.counts().collections, 1);
});

test('original private source-pending frame cannot be made terminal by a completed Live calendar', async t => {
  const { createBackgroundSource, SOURCE_COMPLETION } = require('../server/place-candidates/background-source');
  const { createSourceCache } = require('../server/place-candidates/source-cache');
  const { composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');
  const work = deferred(); let records, frame;
  const background = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'original-private-pending', load: () => work.promise });
  const loader = composeOpenDataLoaders(() => records, null, background);
  const h = await setup(t, { appOptions: { openDataLoader: async (...args) => { frame = await loader(...args); return frame; } } });
  records = h.records;
  t.after(async () => { work.resolve([]); if (frame?.[SOURCE_COMPLETION]) await frame[SOURCE_COMPLETION]; });
  const original = await request(h.server, { body: originalBody() });
  accepted(original.body); assert.ok(frame[SOURCE_COMPLETION]);
  await h.complete();
  const terminal = await request(h.server, { url: '/api/planner-live-completion', body: { token: original.body.live_completion.token } });
  assert.equal(terminal.status, 200); assert.equal(terminal.body.live_events.acquisition.source_health.result, 'empty');
  assert.deepEqual(terminal.body.day_snapshot, { version: 1, state: 'unavailable' });
  assert.equal(h.counts().puts, 0);
  work.resolve([]); await frame[SOURCE_COMPLETION];
});

test('real source transport failure remains failure, never invented healthy emptiness, through snapshot GET', async t => {
  const h = await setup(t, { transport: () => { throw new Error('controlled source failure'); } });
  const original = await request(h.server, { body: originalBody() });
  await h.complete();
  const terminal = await request(h.server, { url: '/api/planner-live-completion', body: { token: original.body.live_completion.token } });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.live_events.acquisition.source_health.status, 'unavailable');
  assert.notEqual(terminal.body.live_events.acquisition.source_health.result, 'empty');
  assert.equal(terminal.body.live_events.acquisition.source_health.failed_source_count, 1);
  assert.equal(terminal.body.day_snapshot.state, 'ready');
  const get = await h.store.read(terminal.body.day_snapshot.ref);
  assertLiveFacts(get.body.result.live_events, terminal.body.live_events);
  assert.equal(h.counts().supplies, 1); assert.equal(h.counts().collections, 1);
});

test('publication metadata cannot push the completion result past its original 2 MiB bound', async t => {
  const { createLiveCompletionStore, LIVE_COLLECTION_READ } = require('../server/planner/live-completion');
  const h = await setup(t);
  const original = await request(h.server, { body: originalBody() });
  await h.complete();
  const actual = await request(h.server, { url: '/api/planner-live-completion', body: { token: original.body.live_completion.token } });
  // Deliberately incompatible diagnostic padding, not synthesized health or
  // publicness. The underlying terminal source facts are the actual collector's.
  const padded = structuredClone(actual.body.live_events);
  padded.acquisition.padding = '';
  const store = createLiveCompletionStore();
  const pending = { pending: true, [LIVE_COLLECTION_READ]: () => padded };
  const capability = store.issue(pending);
  store.bindPublication(capability.token, {}, async () => ({ version: 1, state: 'unavailable' }));
  const size = Buffer.byteLength(JSON.stringify(store.read(capability.token).body));
  // Use a fresh entry because the synchronous API intentionally freezes terminal.
  padded.acquisition.padding = 'x'.repeat(2 * 1024 * 1024 - size);
  const second = store.issue(pending);
  store.bindPublication(second.token, {}, async () => ({ version: 1, state: 'unavailable' }));
  const terminal = await store.readWithPublication(second.token);
  assert.equal(terminal.status, 200, 'optional metadata must not make usable Live unavailable');
  assert.ok(Buffer.byteLength(JSON.stringify(terminal.body)) <= 2 * 1024 * 1024, 'result remains inside the existing byte cap');
  assert.equal(terminal.body.live_events.acquisition.source_health.result, 'empty');
});

test('ready refs never revive original capability authority and snapshot expiry never slides', async t => {
  const h = await setup(t);
  const original = await request(h.server, { body: originalBody() });
  await h.complete();
  const token = original.body.live_completion.token;
  const terminal = await request(h.server, { url: '/api/planner-live-completion', body: { token } });
  const snapshot = terminal.body.day_snapshot;
  assert.equal(snapshot.state, 'ready');
  assert.equal(Date.parse(snapshot.expires_at) - Date.parse(snapshot.created_at), 7 * 24 * 60 * 60 * 1000);
  const before = await h.store.read(snapshot.ref);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(120000);
  assert.equal((await request(h.server, { url: '/api/planner-live-completion', body: { token } })).status, 410);
  assert.equal((await request(h.server, { url: '/api/planner-live-route-upgrade', body: { token } })).status, 410);
  assert.deepEqual(await h.store.read(snapshot.ref), before);
  assert.equal(h.counts().puts, 1);
});

test('private publication context preserves native source witness and refuses over-cap retention without retry', async t => {
  const { createDayPublication } = require('../server/planner/published-day-publication');
  const { createLiveCompletionStore, LIVE_COLLECTION_READ } = require('../server/planner/live-completion');
  const h = await setup(t);
  const body = originalBody();
  const original = await request(h.server, { body });
  const publication = createDayPublication({ body, query: { include_day_snapshot: '1' } }, () => false);
  publication.retain({ records: h.records, date: original.body.days[0].date }, { preferences: ['culture'], preferencePriority: [],
    dayRhythm: 'balanced', excludedCandidateIds: [], pinnedCandidateIds: [], liveEventChoices: [], dayEdit: null });
  const context = publication.liveContext(original.body, 'en');
  assert.ok(context.privacy.publicSourceUrls instanceof Set);
  assert.equal(context.privacy.publicSourceUrls.size, 24, 'actual Wikidata constructor witnesses survive retention');
  assert.equal(publication.liveContext(original.body, 'en').privacy.publicSourceUrls, context.privacy.publicSourceUrls);
  assert.equal(Object.hasOwn(context.published, 'live_completion'), false);
  assert.equal(Object.hasOwn(context.published, 'day_snapshot'), false);
  await h.complete();
  const actual = await request(h.server, { url: '/api/planner-live-completion', body: { token: original.body.live_completion.token } });
  const store = createLiveCompletionStore();
  const pending = { pending: true, [LIVE_COLLECTION_READ]: () => actual.body.live_events };
  const capability = store.issue(pending);
  let attempts = 0;
  const run = () => { attempts++; return { version: 1, state: 'unavailable' }; };
  assert.equal(store.bindPublication(capability.token, { ...context, padding: 'x'.repeat(2 * 1024 * 1024) }, run), false);
  assert.equal(store.bindPublication(capability.token, context, run), false, 'failed retention cannot revive authority or retry');
  const terminal = await store.readWithPublication(capability.token);
  assert.equal(terminal.status, 200); assert.equal(terminal.body.day_snapshot.state, 'unavailable'); assert.equal(attempts, 0);
  for (let i = 1; i < 128; i++) assert.ok(store.issue(pending));
  assert.equal(store.issue(pending), null, 'original 128-entry bound is unchanged');
});

test('original capability expiry forbids a new persistence attempt or revival after terminal collection', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const h = await setup(t);
  const original = await request(h.server, { body: originalBody() });
  await h.complete();
  t.mock.timers.tick(120000);
  for (let i = 0; i < 2; i++) {
    const terminal = await request(h.server, { url: '/api/planner-live-completion', body: { token: original.body.live_completion.token } });
    assert.equal(terminal.status, 410); assert.equal(terminal.body.day_snapshot, undefined);
  }
  assert.equal(h.counts().puts, 0);
});

test('a pre-expiry reserved real atomic put may settle after expiry but never expose a late ready ref', async t => {
  const entered = deferred(), release = deferred(), settled = deferred();
  const h = await setup(t, { put: async (value, store) => { entered.resolve(); await release.promise; const saved = await store.put(value); settled.resolve(saved); return saved; } });
  t.after(() => release.resolve());
  const original = await request(h.server, { body: originalBody() });
  await h.complete();
  t.mock.timers.enable({ apis: ['Date','setTimeout'], now: Date.now() });
  const pending = request(h.server, { url: '/api/planner-live-completion', body: { token: original.body.live_completion.token } });
  await entered.promise;
  t.mock.timers.tick(120000);
  const expired = await pending;
  assert.equal(expired.status, 410); assert.equal(expired.body.day_snapshot, undefined);
  release.resolve();
  const saved = await settled.promise; await turn();
  assert.equal(saved.state, 'ready', 'validly reserved write remains an immutable real record');
  assert.equal((await h.store.read(saved.snapshot.ref)).status, 200);
  assert.equal((await request(h.server, { url: '/api/planner-live-completion', body: { token: original.body.live_completion.token } })).status, 410);
  assert.equal(h.counts().puts, 1);
});
for (const mutation of ['contributor', 'schema-valid-empty-replacement']) test(`SPEC-1 before-put ${mutation} refuses sharing but preserves the ordinary Live answer`, async t => {
  const { collect, proof, rows } = require('./live-source-destination-evidence.test');
  const { createDayPublication, publishTerminalDay } = require('../server/planner/published-day-publication');
  const { LIVE_COLLECTION_READ, createLiveCompletionStore } = require('../server/planner/live-completion');
  const { publicLiveSourceUrls } = require('../server/place-candidates/live-source-destination-evidence');
  const { parsePublishedDay } = await import('../frontend/src/lib/published-day.mjs');
  const decision = require('../anywhere-render-decision');
  const h = await setup(t, { wix: true }), body = originalBody();
  const original = await request(h.server, { body }); accepted(original.body);
  assert.equal(original.body.live_events.pending, true);
  await h.complete();
  const value = await collect();
  assert.deepEqual([...proof(value)], [WIX_EVENT]);
  const publication = createDayPublication({ body, query: { include_day_snapshot: '1' } }, () => true);
  publication.retain({ records: h.records, date: original.body.days[0].date }, {
    preferences: ['culture'], preferencePriority: [], dayRhythm: 'balanced',
    excludedCandidateIds: [], pinnedCandidateIds: [], liveEventChoices: [], dayEdit: null,
  });
  const context = publication.liveContext(original.body, 'en'); assert.ok(context);
  const completion = createLiveCompletionStore(); let reads = 0;
  const issue = () => {
    const cap = completion.issue({ pending: true, [LIVE_COLLECTION_READ]: () => { reads++; return value; } });
    assert.equal(completion.bindPublication(cap.token, context,
      (saved, live, current) => publishTerminalDay(saved, live, current, h.tracedStore)), true);
    return cap;
  };
  const goodCap = issue(), good = await completion.readWithPublication(goodCap.token);
  assert.equal(good.body.day_snapshot.state, 'ready');
  const getGood = () => request(h.server, { method: 'GET', url: `/api/shared-days/${good.body.day_snapshot.ref}` });
  const saved = await getGood(); assert.equal(saved.status, 200);
  assert.ok(parsePublishedDay(saved.body, { ref: good.body.day_snapshot.ref, decision }));
  const badCap = issue(), terminal = completion.read(badCap.token);
  assert.equal(terminal.status, 200);
  assert.deepEqual([...publicLiveSourceUrls(terminal.body.live_events)], [WIX_EVENT]);
  const boundOriginal = terminal.body.live_events;
  // Controlled private-seam diagnostics, not claimed public HTTP exploits.
  if (mutation === 'contributor') {
    const row = rows(boundOriginal)[0];
    const unsupported = { ...row.sources[0], provider_id: 'unsupported-postcapture', identity: 'unsupported.example' };
    rows(value)[0].sources.push({ ...unsupported }); row.sources.push({ ...unsupported });
    assert.equal(proof(value), null, 'direct publication already refuses this claim');
  } else {
    const replacement = { ...boundOriginal, tonight: [], this_week: [], acquisition: {
      ...boundOriginal.acquisition,
      source_health: { ...boundOriginal.acquisition.source_health, surfaced_event_count: 0 },
    } };
    delete replacement.browse;
    const { projectPublishedDay } = require('../server/planner/published-day-projection');
    assert.ok(projectPublishedDay({ ...context, published: { ...context.published, live_events: replacement } }),
      'replacement must satisfy the unchanged schema before testing original identity');
    terminal.body.live_events = replacement;
  }
  const before = h.counts(), facts = JSON.parse(JSON.stringify(terminal.body.live_events));
  const bad = await completion.readWithPublication(badCap.token);
  assert.equal(bad.status, 200);
  assert.equal(bad.body.day_snapshot.state, 'unavailable', 'changed retained claims cannot borrow the original terminal witness');
  if (mutation === 'contributor') assert.equal(publicLiveSourceUrls(boundOriginal), null);
  else assert.deepEqual([...publicLiveSourceUrls(boundOriginal)], [WIX_EVENT], 'the independent original witness stays intact');
  assert.deepEqual(bad.body.live_events, facts, 'optional refusal never strips claims or changes Live health');
  assert.deepEqual(h.counts(), before, 'pre-put identity/claim refusal performs no write or acquisition');
  assert.deepEqual(await completion.readWithPublication(badCap.token), bad, 'refusal replays without retry');
  assert.deepEqual(h.counts(), before);
  assert.deepEqual(await getGood(), saved, 'the earlier immutable positive remains unchanged');
  assert.deepEqual(await fs.readdir(path.join(h.directory, 'published-days-v1')), [`${good.body.day_snapshot.ref}.json`],
    'no unissued changed snapshot is created for a before-put refusal');
  assert.equal(reads, 2, 'both capabilities retain their own original producer read');
});

for (const phase of ['during-put', 'after-ready', 'after-ready-replacement']) test(`SPEC-1 ${phase} claim mutation cannot reuse a ready reference`, async t => {
  const { collect, proof, rows } = require('./live-source-destination-evidence.test');
  const { createDayPublication, publishTerminalDay } = require('../server/planner/published-day-publication');
  const { LIVE_COLLECTION_READ, createLiveCompletionStore } = require('../server/planner/live-completion');
  const started = deferred(), release = deferred(); t.after(() => release.resolve());
  const h = await setup(t, { wix: true, put: async (value, store) => {
    started.resolve(); await release.promise; return store.put(value);
  } });
  const body = originalBody(), original = await request(h.server, { body }); accepted(original.body);
  await h.complete(); const value = await collect(); assert.deepEqual([...proof(value)], [WIX_EVENT]);
  const publication = createDayPublication({ body, query: { include_day_snapshot: '1' } }, () => true);
  publication.retain({ records: h.records, date: original.body.days[0].date }, {
    preferences: ['culture'], preferencePriority: [], dayRhythm: 'balanced',
    excludedCandidateIds: [], pinnedCandidateIds: [], liveEventChoices: [], dayEdit: null,
  });
  const context = publication.liveContext(original.body, 'en'); assert.ok(context);
  const completion = createLiveCompletionStore(), cap = completion.issue({ pending: true, [LIVE_COLLECTION_READ]: () => value });
  assert.equal(completion.bindPublication(cap.token, context,
    (saved, live, current) => publishTerminalDay(saved, live, current, h.tracedStore)), true);
  const terminal = completion.read(cap.token); assert.equal(terminal.status, 200);
  const before = h.counts(), pending = completion.readWithPublication(cap.token);
  await started.promise;
  let previous;
  if (phase !== 'during-put') {
    release.resolve(); previous = await pending; assert.equal(previous.body.day_snapshot.state, 'ready');
  }
  if (phase === 'after-ready-replacement') {
    previous.body.live_events = { ...previous.body.live_events, tonight: [], this_week: [], browse: {
      tonight: { more: [] }, this_week: { more: [] },
    } };
  } else {
    const row = rows(terminal.body.live_events)[0];
    row.sources.push({ ...row.sources[0], provider_id: 'unsupported-late', identity: 'unsupported.example' });
  }
  const facts = JSON.parse(JSON.stringify((previous || terminal).body.live_events));
  release.resolve();
  const answer = phase !== 'during-put' ? await completion.readWithPublication(cap.token) : await pending;
  assert.equal(answer.status, 200);
  assert.equal(answer.body.day_snapshot.state, 'unavailable', 'a cached or awaited ref must still match the terminal facts returned now');
  assert.deepEqual(answer.body.live_events, facts, 'optional refusal preserves the ordinary changed Live answer');
  assert.deepEqual(h.counts(), { ...before, puts: before.puts + 1 }, 'one already-reserved write, no retry or acquisition');
  const filenames = await fs.readdir(path.join(h.directory, 'published-days-v1'));
  assert.equal(filenames.length, 1);
  const persisted = await fs.readFile(path.join(h.directory, 'published-days-v1', filenames[0]), 'utf8');
  assert.equal(persisted.includes('unsupported-late'), false, 'the immutable capture stays original even when its ref is withheld');
  if (previous) {
    const got = await request(h.server, { method: 'GET', url: `/api/shared-days/${previous.body.day_snapshot.ref}` });
    assert.equal(got.status, 200); assert.ok(!JSON.stringify(got.body).includes('unsupported-late'));
  }
});

for (const phase of ['before-put', 'during-put', 'after-ready']) for (const mutation of ['accessor', 'alias', 'proxy', 'callable'])
  test(`QUALITY-1 ${phase} ${mutation} refuses before optional serialization or hooks`, async t => {
    const { collect, proof, rows } = require('./live-source-destination-evidence.test');
    const { createDayPublication, publishTerminalDay } = require('../server/planner/published-day-publication');
    const { LIVE_COLLECTION_READ, createLiveCompletionStore } = require('../server/planner/live-completion');
    const { publicLiveSourceUrls } = require('../server/place-candidates/live-source-destination-evidence');
    const entered = deferred(), release = deferred(); t.after(() => release.resolve());
    let pause = false;
    const h = await setup(t, { wix: true, put: async (value, store) => {
      if (pause) { entered.resolve(); await release.promise; }
      return store.put(value);
    } });
    const body = originalBody(), original = await request(h.server, { body }); accepted(original.body);
    await h.complete(); const value = await collect(); assert.deepEqual([...proof(value)], [WIX_EVENT]);
    const publication = createDayPublication({ body, query: { include_day_snapshot: '1' } }, () => true);
    publication.retain({ records: h.records, date: original.body.days[0].date }, {
      preferences: ['culture'], preferencePriority: [], dayRhythm: 'balanced',
      excludedCandidateIds: [], pinnedCandidateIds: [], liveEventChoices: [], dayEdit: null,
    });
    const context = publication.liveContext(original.body, 'en'); assert.ok(context);
    const completion = createLiveCompletionStore();
    const issue = () => {
      const cap = completion.issue({ pending: true, [LIVE_COLLECTION_READ]: () => value });
      assert.equal(completion.bindPublication(cap.token, context,
        (saved, live, current) => publishTerminalDay(saved, live, current, h.tracedStore)), true);
      return cap;
    };
    const goodCap = issue(), good = await completion.readWithPublication(goodCap.token);
    assert.equal(good.body.day_snapshot.state, 'ready');
    const getGood = () => request(h.server, { method: 'GET', url: `/api/shared-days/${good.body.day_snapshot.ref}` });
    const goodSaved = await getGood(); assert.equal(goodSaved.status, 200);
    const cap = issue(), terminal = completion.read(cap.token), live = terminal.body.live_events;
    assert.deepEqual([...publicLiveSourceUrls(live)], [WIX_EVENT]);
    const before = h.counts(); let pending;
    if (phase === 'during-put') {
      pause = true; pending = completion.readWithPublication(cap.token); await entered.promise;
    } else if (phase === 'after-ready') {
      const ready = await completion.readWithPublication(cap.token); assert.equal(ready.body.day_snapshot.state, 'ready');
    }
    const row = rows(live)[0]; let hooks = 0, serializations = 0;
    if (mutation === 'accessor') {
      const descriptor = Object.getOwnPropertyDescriptor(row, 'source_url');
      Object.defineProperty(row, 'source_url', { enumerable: true, configurable: true,
        get() { hooks++; throw new Error('controlled accessor must not run'); } });
      t.after(() => Object.defineProperty(row, 'source_url', descriptor));
    } else if (mutation === 'alias') {
      let dag = { diagnostic: 'controlled private seam, not provider evidence' };
      for (let index = 0; index < 24; index++) dag = { left: dag, right: dag };
      row.diagnostic = dag;
    } else if (mutation === 'proxy') {
      row.diagnostic = new Proxy({}, { ownKeys() { hooks++; throw new Error('controlled Proxy must not run'); } });
    } else row.toJSON = () => { hooks++; throw new Error('controlled callable must not run'); };
    assert.equal(publicLiveSourceUrls(live), null); assert.equal(hooks, 0, 'the private seal alone already refuses safely');
    const stringify = JSON.stringify; let answer;
    try {
      JSON.stringify = (input, ...options) => {
        if (input === live || input?.live_events === live) {
          serializations++; throw new Error('do not serialize an invalid terminal graph for optional proof');
        }
        return stringify(input, ...options);
      };
      release.resolve();
      answer = pending ? await pending : await completion.readWithPublication(cap.token);
      const replay = await completion.readWithPublication(cap.token);
      assert.equal(replay.body.day_snapshot.state, 'unavailable');
    } finally { JSON.stringify = stringify; }
    assert.equal(answer.status, 200); assert.equal(answer.body.day_snapshot.state, 'unavailable');
    assert.equal(answer.body.live_events, live, 'optional refusal leaves the ordinary result untouched');
    assert.equal(serializations, 0, 'owning publication call site must preflight before every optional JSON size check');
    assert.equal(hooks, 0, 'no accessor/Proxy/toJSON execution');
    assert.deepEqual(h.counts(), { ...before, puts: before.puts + (phase === 'before-put' ? 0 : 1) },
      'only an already reserved write, no retry or acquisition');
    assert.deepEqual(await getGood(), goodSaved, 'earlier immutable bytes stay unchanged');
  });

test('actual nonempty original terminal concurrent readers publish once; warm direct publication uses the same source evidence', async t => {
  const h = await setup(t, { wix: true }); const body = originalBody();
  const original = await request(h.server, { body }); accepted(original.body);
  const token = original.body.live_completion.token;
  const pending = await request(h.server, { url: '/api/planner-live-completion', body: { token } });
  assert.equal(pending.status, 202); assert.equal(h.counts().puts, 0);
  await h.complete();
  const answers = await Promise.all(Array.from({ length: 4 }, () => request(h.server, { url: '/api/planner-live-completion', body: { token } })));
  const terminal = answers[0]; assert.equal(terminal.status, 200); assert.equal(terminal.body.day_snapshot.state, 'ready');
  for (const answer of answers) assert.deepEqual(answer, terminal);
  assert.equal(h.counts().puts, 1); const counts = h.counts();
  const oldFile = path.join(h.directory, 'published-days-v1', `${terminal.body.day_snapshot.ref}.json`);
  const oldBytes = await fs.readFile(oldFile, 'utf8');
  const warm = await request(h.server, { body }); accepted(warm.body);
  assert.equal(warm.body.live_completion, undefined); assert.equal(warm.body.day_snapshot.state, 'ready');
  assert.notEqual(warm.body.day_snapshot.ref, terminal.body.day_snapshot.ref);
  assert.equal(h.counts().collections, counts.collections); assert.equal(h.counts().transports, counts.transports);
  assert.equal(h.counts().venueLookups, counts.venueLookups); assert.equal(h.counts().puts, 2);
  const frozen = h.counts();
  const { parsePublishedDay } = await import('../frontend/src/lib/published-day.mjs');
  for (const value of [terminal.body, warm.body]) {
    const get = await request(h.server, { method: 'GET', url: `/api/shared-days/${value.day_snapshot.ref}` });
    assert.equal(get.status, 200); assert.ok(parsePublishedDay(get.body, { ref: value.day_snapshot.ref, decision: require('../anywhere-render-decision') }));
    assertLiveFacts(get.body.result.live_events, value.live_events);
    assert.equal(JSON.stringify(get.body).includes('_live_destination_inputs'), false);
    assert.equal(JSON.stringify(get.body).includes('wix-public-event-catalog'), false);
    assert.equal(JSON.stringify(get.body).includes(token), false);
  }
  assert.equal(await fs.readFile(oldFile, 'utf8'), oldBytes); assert.deepEqual(h.counts(), frozen);
});

test('nonempty approved-source store failure is optional and attempted once with unchanged facts/health', async t => {
  const h = await setup(t, { wix: true, put: () => { throw new Error('controlled nonempty store refusal'); } });
  const original = await request(h.server, { body: originalBody() });
  await h.complete(); const token = original.body.live_completion.token;
  const answers = await Promise.all([1,2,3].map(() => request(h.server, { url: '/api/planner-live-completion', body: { token } })));
  assert.equal(h.counts().puts, 1);
  for (const answer of answers) {
    assert.equal(answer.status, 200); assert.equal(answer.body.day_snapshot.state, 'unavailable');
    assert.equal(answer.body.live_events.acquisition.source_health.result, 'events_found');
    assert.equal([...answer.body.live_events.tonight, ...answer.body.live_events.this_week][0].source_url, WIX_EVENT);
    assert.deepEqual(answer, answers[0]);
  }
});

test('mixed approved/unsupported actual Wix claims refuse terminal and warm snapshots with zero writes, without losing Live', async t => {
  const unsupported = 'https://www.visitystadosterlen.se/evenemang-1/z-unsupported.slug/202';
  const h = await setup(t, { wix: true, transport: (_options, url, original) => url === WIX_CHILD ? { ...original,
    text: async () => `<urlset generatedBy="WIX"><url><loc>${WIX_EVENT}</loc></url><url><loc>${unsupported}</loc></url></urlset>` }
    : url === unsupported ? { ...original, text: async () => (await original.text()).replaceAll('Original public exhibition', 'Unsupported public exhibition') } : original });
  const body = originalBody(), original = await request(h.server, { body }); accepted(original.body);
  await h.complete();
  const terminal = await request(h.server, { url: '/api/planner-live-completion', body: { token: original.body.live_completion.token } });
  assert.equal(terminal.status, 200); assert.equal(terminal.body.live_events.acquisition.source_health.status, 'healthy');
  assert.equal(terminal.body.live_events.acquisition.source_health.accepted_event_count, 2);
  const retained = [...terminal.body.live_events.tonight, ...terminal.body.live_events.this_week];
  assert.deepEqual(retained.map(row => row.source_url).sort(), [WIX_EVENT, unsupported].sort());
  assert.equal(terminal.body.day_snapshot.state, 'unavailable'); assert.equal(h.counts().puts, 0);
  const counts = h.counts();
  const warm = await request(h.server, { body }); accepted(warm.body);
  assert.equal(warm.body.day_snapshot.state, 'unavailable'); assert.equal(h.counts().puts, 0);
  assert.equal(h.counts().collections, counts.collections); assert.equal(h.counts().transports, counts.transports);
  assert.equal(h.counts().venueLookups, counts.venueLookups); assert.deepEqual(await fs.readdir(h.directory), []);
});

test('nonempty source proof never grants publication to a request without the original snapshot opt-in', async t => {
  const h = await setup(t, { wix: true });
  const original = await request(h.server, { url: ROUTE, body: originalBody() }); accepted(original.body);
  assert.equal(original.body.day_snapshot, undefined); await h.complete();
  const terminal = await request(h.server, { url: '/api/planner-live-completion', body: { token: original.body.live_completion.token } });
  assert.equal(terminal.status, 200); assert.equal(terminal.body.live_events.acquisition.source_health.result, 'events_found');
  assert.equal(terminal.body.day_snapshot, undefined); assert.equal(h.counts().puts, 0);
});

}

