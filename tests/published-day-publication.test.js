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
const { publicSourceUrlsForRecords } = require('../server/place-candidates/source-url-evidence');
const { capturePublishedDayPrivacy } = require('../server/planner/published-day-privacy');
const { projectPublishedDay } = require('../server/planner/published-day-projection');
const { createPublishedDayStore } = require('../server/planner/published-day-store');
const { mockStableWeatherFetch, externalRecord } = require('./helpers/planner-reservoir-compare');
const { createBackgroundSource, SOURCE_COMPLETION, SOURCE_SNAPSHOT } = require('../server/place-candidates/background-source');
const { composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { resolveDefaultEventSupply, collectAnchorEvents, HELSINKI_LINKED_EVENTS_FEED } = require('../server/place-candidates/agnostic-event-supply');
const DATE = '2026-05-25';
const NOW = `${DATE}T10:00:00.000Z`;
const ROUTE = '/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&agnostic_engine_compose=1';
const BODY = { place: 'Roma', dates: [DATE], preferences: ['culture'], day_rhythm: 'balanced', include_external_candidates: 1 };
const INTENT = { dateIso: DATE, preferences: ['culture'], preferencePriority: [], dayRhythm: 'balanced',
  excludedCandidateIds: [], pinnedCandidateIds: [], liveEventChoices: [], dayEdit: null };
const IDS = ['mercato-monti', 'piazza-vittorio', 'colosseum', 'teatro-di-marcello', 'piazza-navona'];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function request(server, { method = 'POST', pathname = ROUTE, body = BODY, headers = {}, rawBody } = {}) {
  return new Promise((resolve, reject) => {
    const payload = rawBody ?? (body === null ? null : JSON.stringify(body));
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method,
      headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject); req.end(payload);
  });
}
async function listen(t, options) {
  const server = buildApp(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return server;
}
async function setup(t, overrides = {}, storeOptions = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'published-day-http-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const oldFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  t.after(() => { global.fetch = oldFetch; });
  let factoryCalls = 0, loads = 0, puts = 0;
  const source = createWikidataSource({ limit: 60, fetcher: async () => {
    factoryCalls++;
    return { ok: true, json: async () => ({ results: { bindings: Array.from({ length: 24 }, (_, i) => ({
      item: { value: `http://www.wikidata.org/entity/Q${1000 + i}` }, itemLabel: { value: `Collection ${i + 1}` },
      lat: { value: String(41.9 + (i % 6) * .0008) }, lng: { value: String(12.49 + Math.floor(i / 6) * .0008) },
      classRoot: { value: 'http://www.wikidata.org/entity/Q33506' },
    })) } }) };
  } });
  const records = await source({ lat: 41.9, lng: 12.49 });
  assert.equal(records.length, 24);
  assert.equal(publicSourceUrlsForRecords(records).size, 24, 'actual factory issued witnesses');
  const store = createPublishedDayStore({ directory, clock: () => Date.parse(NOW), ...storeOptions });
  const writes = [];
  const tracedStore = { read: store.read, async put(value) {
    puts++; writes.push(value); return store.put(value);
  } };
  const options = { openDataLoader: async () => { loads++; return records; },
    placeResolver: async () => [{ label: 'Roma, Italia', lat: 41.9, lng: 12.49,
      confidence: 'high', provenance: 'offline_fixture', timezone: 'Europe/Rome', osm_class: 'place', osm_ref: 'relation/41485' }],
    placeSuggestions: null, reviewedPlaceSource: null, sourceCatalog: null, eventSupply: null,
    placeSelectionStore: { issue: () => null }, publishedDayStore: tracedStore, clock: { now: () => NOW }, ...overrides };
  return { server: await listen(t, options), directory, store, records, writes, options,
    counts: () => ({ factoryCalls, loads, puts }) };
}
function withoutSnapshot(body) { const { day_snapshot, ...result } = body; return result; }
function project(body, records, intent = INTENT, original = BODY) {
  return projectPublishedDay({ published: withoutSnapshot(body), intent, language: 'en',
    privacy: { ...capturePublishedDayPrivacy({ body: original, query: {} }), publicSourceUrls: publicSourceUrlsForRecords(records) } });
}
function accepted(body, ids = IDS) {
  assert.equal(body.agnostic_route_output_experiment.promotion.promote, true);
  assert.equal(body.agnostic_route_output_experiment.synthesized_via, 'agnostic_compose_engine');
  assert.equal(body.agnostic_route_output_experiment.eligibility.eligible, true);
  assert.equal(body.days[0].date, DATE);
  assert.deepEqual(body.days[0].primary_route.main_stops.map(stop => stop.id), ids);
  assert.ok(body.days[0].primary_route.main_stops.every(stop => !stop.id.startsWith('wikidata-')), 'knowledge-only rows are not admitted');
  assert.ok(body.days[0].primary_route.main_stops.every(stop => stop.origin === 'curated_catalog'), 'actual selected source is curated catalog');
  const route = body.days[0].primary_route;
  assert.ok(route.map_path_points.length >= 2, 'actual final walking path is present');
  assert.ok(route.map_route_points.length >= ids.length, 'actual final route points retain stops');
  assert.ok(route.map_path_points.every(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)));
}

for (const [name, label, portable] of [
  ['500-character boundary', 'L'.repeat(500), true],
  ['500-character Unicode boundary', 'Ö'.repeat(500), true],
  ['501-character refusal', 'L'.repeat(501), false],
  ['embedded control-character refusal', 'North\u0000port, Testland', false],
  ['DEL-character refusal', 'North\u007fport, Testland', false],
]) {
  test(`publication/GET/recipient share the resolved-label contract: ${name}`, async t => {
    const h = await setup(t, { placeResolver: async () => [{ label, lat: 41.9, lng: 12.49,
      confidence: 'high', provenance: 'offline_fixture', timezone: 'Europe/Rome',
      osm_class: 'place', osm_ref: 'relation/41485' }] });
    const baseline = await request(h.server);
    const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1` });
    assert.equal(result.status, 200);
    accepted(result.body);
    assert.equal(result.body.agnostic_route_output_experiment.intake.resolved.label, label,
      'source identity is never truncated or rewritten to make sharing succeed');
    assert.deepEqual(withoutSnapshot(result.body), baseline.body,
      'optional publication refusal must not change the accepted ordinary day');
    assert.equal(result.body.day_snapshot?.state, portable ? 'ready' : 'unavailable');
    assert.equal(h.counts().puts, portable ? 1 : 0, 'refusal happens before the persistence boundary');
    if (!portable) {
      assert.deepEqual(await fs.readdir(h.directory), [], 'no unreadable immutable record was written');
      return;
    }
    const { ref } = result.body.day_snapshot;
    const beforeRead = h.counts();
    const read = await request(h.server, { method: 'GET', pathname: `/api/shared-days/${ref}`, body: null });
    assert.equal(read.status, 200);
    assert.equal(read.body.intent.place, label);
    assert.equal(read.body.intent.placeLabel, label);
    const { parsePublishedDay } = await import('../frontend/src/lib/published-day.mjs');
    const parsed = parsePublishedDay(read.body, { ref, decision: require('../anywhere-render-decision'), now: Date.parse(NOW) });
    assert.ok(parsed, 'every advertised ready snapshot is accepted by the actual recipient parser');
    assert.equal(parsed.entry.dateIso, DATE);
    assert.deepEqual(h.counts(), beforeRead, 'recipient read does not acquire sources again');
  });
}

test('direct accepted Roma day persists and reads identically after app/store restart without acquisition', async t => {
  const h = await setup(t);
  const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1` });
  assert.equal(result.status, 200);
  accepted(result.body);
  const projected = project(result.body, h.records);
  assert.ok(projected, 'unchanged projector accepts actual curated final body, not Wikidata-only stops');
  t.diagnostic(JSON.stringify({ tracer: 'actual-http-curated-roma', selectedDate: result.body.days[0].date,
    stops: result.body.days[0].primary_route.main_stops.map(stop => ({ id: stop.id, origin: stop.origin })),
    routePoints: result.body.days[0].primary_route.map_route_points, portable: true }));
  assert.equal(result.body.day_snapshot?.state, 'ready', 'opted-in accepted server day must emit a persisted snapshot');
  const sidecar = result.body.day_snapshot;
  assert.match(sidecar.ref, /^[a-f0-9]{48}$/);
  assert.deepEqual(Object.keys(sidecar).sort(), ['created_at', 'expires_at', 'ref', 'state', 'version']);
  assert.equal(h.counts().puts, 1);
  const read = await request(h.server, { method: 'GET', pathname: `/api/shared-days/${sidecar.ref}`, body: null });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { version: 1, ref: sidecar.ref, created_at: sidecar.created_at, expires_at: sidecar.expires_at, ...projected });
  const counts = h.counts();
  const restart = await listen(t, { ...h.options, publishedDayStore: createPublishedDayStore({ directory: h.directory, clock: () => Date.parse(NOW) }),
    openDataLoader: () => assert.fail('read restart must not acquire'), placeResolver: () => assert.fail('read must not resolve') });
  assert.deepEqual(await request(restart, { method: 'GET', pathname: `/api/shared-days/${sidecar.ref}`, body: null }), read);
  assert.deepEqual(h.counts(), counts);
});

test('cold original acquisition publishes once and status replays original intent and reference', { timeout: 15000 }, async t => {
  const work = deferred(), persisted = deferred();
  let acquisitions = 0;
  const background = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'original-roma',
    load: () => { acquisitions++; return work.promise; } });
  const h = await setup(t, { openDataLoader: value => background.load(value, value) });
  t.after(() => work.resolve([]));
  const put = h.options.publishedDayStore.put;
  h.options.publishedDayStore.put = async value => {
    const saved = await put(value); persisted.resolve(saved); return saved;
  };
  const body = { ...BODY, preference_priority: ['culture'], excluded_candidate_ids: ['not-a-stop'], pinned_candidate_ids: ['mercato-monti'] };
  const initial = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body, headers: { Prefer: 'respond-async' } });
  assert.equal(initial.status, 202);
  assert.equal(acquisitions, 1);
  const token = initial.body.planner_lifecycle.token;
  assert.equal((await request(h.server, { pathname: '/api/planner-status', body: { token, include_day_snapshot: 1, lat: 0 } })).status, 202);
  work.resolve(h.records);
  // Wait for actual filesystem settlement, not guessed turns or status poll loops.
  await persisted.promise;
  await turn();
  const final = await request(h.server, { pathname: '/api/planner-status?include_day_snapshot=0',
    body: { token, preferences: ['food'], dates: ['2030-01-01'], pinned_candidate_ids: ['forged'], day_snapshot: { ref: 'f'.repeat(48) } } });
  assert.equal(final.status, 200);
  accepted(final.body, [...IDS.slice(0, 4), 'orto-botanico', IDS[4]]);
  assert.equal(final.body.day_snapshot?.state, 'ready', 'original cold operation must publish its accepted final day');
  await persisted.promise;
  const intent = { ...INTENT, preferencePriority: ['culture'], excludedCandidateIds: ['not-a-stop'], pinnedCandidateIds: ['mercato-monti'] };
  const read = await request(h.server, { method: 'GET', pathname: `/api/shared-days/${final.body.day_snapshot.ref}`, body: null });
  const projected = project(final.body, h.records, intent, body);
  assert.ok(projected);
  assert.deepEqual(read.body.intent, projected.intent);
  assert.deepEqual(read.body.result, projected.result);
  for (let i = 0; i < 3; i++) assert.deepEqual(await request(h.server, { pathname: '/api/planner-status?include_day_snapshot=1', body: { token, lat: null, safeResponse: {} } }), final);
  assert.equal(h.counts().puts, 1);
  assert.equal(acquisitions, 1);
});

test('accepted day with genuinely pending retained sources does not publish a snapshot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const work = deferred();
  const background = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'still-acquiring', eager: true, load: () => work.promise });
  let rows;
  const loader = composeOpenDataLoaders(() => rows, null, background);
  const h = await setup(t, { openDataLoader: loader });
  rows = h.records;
  t.after(() => work.resolve([]));
  const initial = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, headers: { Prefer: 'respond-async' } });
  assert.equal(initial.status, 202);
  t.mock.timers.tick(8000);
  await turn();
  const response = await request(h.server, { pathname: '/api/planner-status', body: { token: initial.body.planner_lifecycle.token } });
  assert.equal(response.status, 200);
  accepted(response.body);
  assert.equal(response.body.agnostic_route_output_experiment.source_status.collection.source_completion.pending, 1);
  assert.ok(project(response.body, h.records), 'portable field projection alone does not establish terminal source ownership');
  assert.deepEqual(response.body.day_snapshot, { version: 1, state: 'unavailable' }, 'pending producer must not mint ready');
  assert.equal(h.counts().puts, 0);
});

for (const withExclusions of [false, true]) {
  test(`direct private source completion blocks publication ${withExclusions ? 'through exclusion filtering' : 'without exclusions'}`, async t => {
    const work = deferred();
    let rows, acquisitions = 0;
    const frames = [];
    const background = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'direct-original-pending',
      load: () => { acquisitions++; return work.promise; } });
    const composed = composeOpenDataLoaders(() => rows, null, background);
    const loader = async (...args) => {
      const records = await composed(...args);
      frames.push(records);
      return records;
    };
    const h = await setup(t, { openDataLoader: loader });
    rows = h.records;
    t.after(() => work.resolve([]));
    const body = withExclusions ? { ...BODY, excluded_candidate_ids: ['not-a-stop'] } : BODY;
    const baseline = await request(h.server, { body });
    const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body });
    assert.equal(result.status, 200);
    accepted(result.body);
    assert.deepEqual(withoutSnapshot(result.body), baseline.body, 'ordinary final day remains exactly unchanged');
    assert.equal(acquisitions, 1, 'original producer is shared, not restarted for publication');
    assert.ok(frames.length > 0);
    for (const frame of frames) {
      assert.ok(frame[SOURCE_COMPLETION], 'actual original loader frame privately owns the pending producer');
      assert.equal(frame.loader_metadata?.source_completion, undefined, 'initial frame has no public completion metadata');
      const snapshot = frame[SOURCE_SNAPSHOT]();
      assert.equal(snapshot.loader_metadata.source_completion.status, 'partial');
      assert.equal(snapshot.loader_metadata.source_completion.pending, 1);
    }
    const intent = withExclusions ? { ...INTENT, excludedCandidateIds: ['not-a-stop'] } : INTENT;
    assert.ok(project(result.body, h.records, intent, body), 'unchanged projector accepts this actual final HTTP body');
    t.diagnostic(JSON.stringify({ actualPrivatePendingFrame: true, withExclusions, puts: h.counts().puts,
      snapshot: result.body.day_snapshot?.state }));
    assert.deepEqual(result.body.day_snapshot, { version: 1, state: 'unavailable' },
      'SPEC-01: direct original pending source must refuse before persistence even without JSON metadata');
    assert.equal(h.counts().puts, 0);
    assert.deepEqual(await fs.readdir(h.directory), []);
    work.resolve([]);
    await Promise.all(frames.map(frame => frame[SOURCE_COMPLETION]));
    assert.equal(h.counts().puts, 0, 'settlement cannot publish a late reference for the original response');
    const settled = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body });
    accepted(settled.body);
    assert.equal(settled.body.day_snapshot.state, 'ready', 'a separate terminal original is still publishable');
    assert.equal(acquisitions, 1, 'the new original reuses settled trusted supply without new acquisition');
    assert.equal(h.counts().puts, 1);
    assert.equal((await h.store.read(settled.body.day_snapshot.ref)).status, 200);
  });
}

test('publication observation preserves selected enrichment through exclusion filtering', async t => {
  let rows, enrichments = 0;
  const loader = async () => rows;
  loader.enrichSelected = async function(records, options) {
    assert.equal(this, loader, 'original method receiver is preserved');
    assert.equal(options.date, DATE);
    assert.ok(options.selectedIds.length > 0);
    assert.ok(!options.selectedIds.includes('not-a-stop'));
    enrichments++;
    return records;
  };
  const h = await setup(t, { openDataLoader: loader });
  rows = h.records;
  const body = { ...BODY, excluded_candidate_ids: ['not-a-stop'] };
  const baseline = await request(h.server, { body });
  assert.equal(enrichments, 1);
  const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body });
  accepted(result.body);
  assert.deepEqual(withoutSnapshot(result.body), baseline.body);
  assert.equal(enrichments, 2, 'opt-in preserves one original selected-enrichment call');
  assert.equal(result.body.day_snapshot.state, 'ready');
  assert.equal(h.counts().puts, 1);
});

test('pending Live stays enabled and an unsupported terminal upgrade explicitly refuses sharing without a write', async t => {
  const work = deferred();
  let eventCalls = 0;
  const feed = { ...HELSINKI_LINKED_EVENTS_FEED, id: 'offline-roma-events', label: 'Offline Roma transport', bbox: [12.3, 41.7, 12.7, 42.1] };
  const eventSupply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: 'enabled', PARRANDA_EVENT_FEEDS: JSON.stringify([feed]) },
    { eventReader: null, requestTimeDiscovery: null, collectEvents: async options => {
      eventCalls++; await work.promise;
      return collectAnchorEvents({ ...options, fetcher: async () => ({ ok: true, json: async () => ({ data: [{
        id: 'roma-offline-concert', name: { en: 'Evening music' }, start_time: `${DATE}T16:00:00Z`, end_time: `${DATE}T18:00:00Z`,
        location: { position: { coordinates: [12.493, 41.903] }, name: { en: 'Test venue' } },
        info_url: { en: 'https://example.org/private-concert?ticket=secret' }, data_source: 'fixture', keywords: [{ name: { en: 'music' } }],
      }] }) }) });
    } });
  const h = await setup(t, { eventSupply });
  t.after(() => work.resolve());
  const initial = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1&include_live_completion=1&include_live_route_upgrade=1` });
  accepted(initial.body);
  assert.equal(initial.body.live_events.pending, true, 'real default source owns outstanding collection');
  assert.ok(initial.body.live_completion.token, 'ordinary completion remains enabled');
  assert.deepEqual(initial.body.day_snapshot, { version: 1, state: 'unavailable' }, 'deferred Live may not become portable');
  assert.equal(h.counts().puts, 0);
  const noCompletion = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1` });
  assert.equal(noCompletion.body.live_events.pending, true);
  assert.equal(noCompletion.body.live_completion, undefined);
  assert.deepEqual(noCompletion.body.day_snapshot, { version: 1, state: 'unavailable' });
  work.resolve(); await turn();
  const upgraded = await request(h.server, { pathname: '/api/planner-live-route-upgrade', body: { token: initial.body.live_completion.token } });
  assert.equal(upgraded.status, 200);
  assert.equal(upgraded.body.live_route_upgrade.state, 'applied', 'real accepted trial still uses ordinary upgrade gates');
  assert.equal(upgraded.body.result.days[0].primary_route.main_stops.at(-1).event_id, 'roma-offline-concert');
  assert.deepEqual(upgraded.body.result.day_snapshot, { version: 1, state: 'unavailable' }, 'the applied HTTP answer explicitly refuses the unsupported event destination');
  assert.equal(h.counts().puts, 0);
  const warm = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1` });
  assert.equal(warm.body.agnostic_route_output_experiment.promotion.promote, true);
  assert.equal(warm.body.days[0].primary_route.main_stops.at(-1).event_id, 'roma-offline-concert');
  assert.equal(warm.body.days[0].primary_route.main_stops.at(-1).source.url, 'https://example.org/private-concert?ticket=secret');
  assert.deepEqual(warm.body.day_snapshot, { version: 1, state: 'unavailable' }, 'completed unapproved event URL still refuses the full projection');
  assert.equal(h.counts().puts, 0);
  assert.equal(eventCalls, 1);
});

test('absent malformed duplicate or body-only opt-in preserves complete default response and untouched store', async t => {
  const h = await setup(t);
  const baseline = await request(h.server);
  accepted(baseline.body);
  for (const query of ['', '&include_day_snapshot=', '&include_day_snapshot=true', '&include_day_snapshot=01',
    '&include_day_snapshot=1&include_day_snapshot=1', '&include_day_snapshot=1&include_day_snapshot=0',
    '&include_day_snapshot[]=1', '&include_day_snapshot=%201', '&include_day_snapshot=1%20']) {
    const result = await request(h.server, { pathname: `${ROUTE}${query}`, body: { ...BODY, include_day_snapshot: '1', day_snapshot: { state: 'ready' }, safeResponse: { forged: true } } });
    assert.deepEqual(result, baseline, `not an exact single query string: ${query}`);
  }
  assert.equal(h.counts().puts, 0);
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('raw coordinate narrowing and endpoint presence cannot be erased by coercion or public privacy claims', async t => {
  const h = await setup(t);
  const claims = { privacy: { explicitCoordinatesPresent: false, biasPresent: false, customEndpointPresent: false },
    publicSourceUrls: [], public_source_url_policy: 'wikidata-entity-v1', safeResponse: { days: [{ trusted: true }] } };
  const cases = [
    { lat: null }, { lat: 0 }, { lng: 0 }, { lat: 'invalid' }, { lat: null, lng: null }, { lat: 0, lng: 0 },
    { lat: 41.9, lng: 12.49 }, { origin: { lat: null } }, { origin: { lng: 0 } },
    { place_bias: null }, { place_bias: { lat: 41.9, lng: 12.49 } }, { place_context_selection: null },
    { home_base: null }, { start: { type: 'coordinates', lat: 41.9, lng: 12.49 } }, { end: { type: 'auto', lat: null } },
    { place_ref: null }, { place_selection: 'forged' },
  ];
  let acceptedDays = 0;
  for (const extra of cases) {
    const body = { ...BODY, ...claims, ...extra };
    const baseline = await request(h.server, { body });
    const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body });
    assert.deepEqual(withoutSnapshot(result.body), baseline.body, `preserve actual day/refusal for ${JSON.stringify(extra)}`);
    assert.notEqual(result.body.day_snapshot?.state, 'ready');
    if (result.body.agnostic_route_output_experiment?.promotion?.promote) {
      acceptedDays++;
      assert.deepEqual(result.body.day_snapshot, { version: 1, state: 'unavailable' });
    }
  }
  assert.ok(acceptedDays > 0, 'includes actually accepted private days, not only intake refusals');
  for (const query of ['&lat=', '&lat=null', '&lng=0', '&lat=41.9&lng=12.49']) {
    const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1${query}` });
    assert.notEqual(result.body.day_snapshot?.state, 'ready');
  }
  assert.equal(h.counts().puts, 0);
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('body result and source proof claims cannot supply publication authority', async t => {
  const h = await setup(t);
  const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body: { ...BODY,
    result: { days: [{ date: '2030-01-01', primary_route: { main_stops: [{ id: 'forged' }] } }] },
    safeResponse: { days: [{ forged: true }] }, day_snapshot: { ref: 'f'.repeat(48), state: 'ready' },
    privacy: { explicitCoordinatesPresent: true }, publicSourceUrls: ['https://attacker.example/secret'] } });
  accepted(result.body);
  assert.equal(result.body.day_snapshot.state, 'ready');
  const read = await request(h.server, { method: 'GET', pathname: `/api/shared-days/${result.body.day_snapshot.ref}`, body: null });
  assert.deepEqual(read.body.result, project(result.body, h.records).result);
  assert.ok(!JSON.stringify(read.body).includes('forged'));
});

test('unsupported retained source URLs refuse the entire projection and preserve exact final day', async t => {
  const records = Array.from({ length: 12 }, (_, i) => ({
    ...externalRecord(`unsupported-${i}`, `Independent museum ${i}`, 'museum', 41.9 + i * .0004, 12.49 + i * .0003, ['culture']),
    website: `https://example.org/admission/${i}?ticket=private#entry`,
  }));
  const h = await setup(t, { openDataLoader: async () => records });
  const baseline = await request(h.server, { body: { ...BODY, pinned_candidate_ids: ['unsupported-0'] } });
  assert.equal(baseline.body.agnostic_route_output_experiment.promotion.promote, true);
  const stop = baseline.body.days[0].primary_route.main_stops.find(stop => stop.id === 'unsupported-0');
  assert.ok(stop, 'actual trusted engine admitted independently corroborated supplier record, not knowledge-only factory record');
  assert.equal(stop.website, records[0].website, 'unsupported URL is genuinely retained, not removed or normalized');
  const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body: { ...BODY, pinned_candidate_ids: ['unsupported-0'],
    publicSourceUrls: records.flatMap(row => [row.website, ...row.sources.map(source => source.url)]), public_source_url_policy: 'wikidata-entity-v1' } });
  assert.deepEqual(withoutSnapshot(result.body), baseline.body);
  assert.deepEqual(result.body.day_snapshot, { version: 1, state: 'unavailable' });
  assert.equal(h.counts().puts, 0);
});

test('distinct original operations mint distinct refs and real quota refusal preserves the accepted day', async t => {
  const h = await setup(t, {}, { maxEntries: 2 });
  const a = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1` });
  const b = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1` });
  assert.equal(a.body.day_snapshot.state, 'ready');
  assert.equal(b.body.day_snapshot.state, 'ready');
  assert.notEqual(a.body.day_snapshot.ref, b.body.day_snapshot.ref);
  assert.deepEqual(withoutSnapshot(a.body), withoutSnapshot(b.body));
  const refused = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1` });
  assert.deepEqual(withoutSnapshot(refused.body), withoutSnapshot(a.body));
  assert.deepEqual(refused.body.day_snapshot, { version: 1, state: 'unavailable' });
  assert.equal(h.counts().puts, 3);
  assert.equal((await fs.readdir(path.join(h.directory, 'published-days-v1'))).length, 2);
});

test('complete persisted envelope byte bound refuses a projector-fitting real day without leaking a reason', async t => {
  const h = await setup(t);
  const baseline = await request(h.server);
  const projected = project(baseline.body, h.records);
  assert.ok(projected);
  const maxEntryBytes = Buffer.byteLength(JSON.stringify(projected));
  const store = createPublishedDayStore({ directory: h.directory, maxEntryBytes, clock: () => Date.parse(NOW) });
  let refusal;
  h.options.publishedDayStore.put = async value => { refusal = await store.put(value); return refusal; };
  const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1` });
  assert.equal(refusal.reason, 'entry_too_large', 'real store, including envelope overhead, is the refusing authority');
  assert.deepEqual(withoutSnapshot(result.body), baseline.body);
  assert.deepEqual(result.body.day_snapshot, { version: 1, state: 'unavailable' });
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('store throw and actual filesystem refusal preserve accepted day with only unavailable', async t => {
  const h = await setup(t);
  const baseline = await request(h.server);
  for (const put of [() => { throw new Error('/private/cache/secret ENOSPC receipt=private'); },
    createPublishedDayStore({ directory: path.join(h.directory, 'missing') }).put,
    async () => ({ state: 'unavailable', reason: '/private/failure' })]) {
    h.options.publishedDayStore.put = put;
    const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1` });
    assert.equal(result.status, 200);
    assert.deepEqual(withoutSnapshot(result.body), baseline.body);
    assert.deepEqual(result.body.day_snapshot, { version: 1, state: 'unavailable' });
  }
});

test('direct HTTP waits for settled real persistence before emitting ready', { timeout: 15000 }, async t => {
  const h = await setup(t);
  const entered = deferred(), release = deferred();
  const put = h.options.publishedDayStore.put;
  h.options.publishedDayStore.put = async value => { entered.resolve(); await release.promise; return put(value); };
  t.after(() => release.resolve());
  let responded = false;
  const pending = request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1` }).then(value => { responded = true; return value; });
  await entered.promise;
  await turn();
  assert.equal(responded, false, 'no response while put is still unsettled');
  assert.deepEqual(await fs.readdir(h.directory), []);
  release.resolve();
  const result = await pending;
  assert.equal(result.body.day_snapshot.state, 'ready');
  const read = await h.store.read(result.body.day_snapshot.ref);
  assert.equal(read.status, 200);
  assert.equal(read.body.created_at, result.body.day_snapshot.created_at);
  assert.equal(read.body.expires_at, result.body.day_snapshot.expires_at);
});

test('cancelled cold original cannot admit late acquisition to storage', async t => {
  const work = deferred();
  let acquisitionSignal;
  const background = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'cancel-before-admission',
    load: value => { acquisitionSignal = value.signal; return work.promise; } });
  const h = await setup(t, { openDataLoader: value => background.load(value, value) });
  const initial = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, headers: { Prefer: 'respond-async' } });
  assert.equal(initial.status, 202);
  const token = initial.body.planner_lifecycle.token;
  assert.equal((await request(h.server, { method: 'DELETE', pathname: '/api/planner-status', body: { token } })).status, 204);
  assert.equal(acquisitionSignal.aborted, true, 'ordinary source cancellation is preserved');
  work.resolve(h.records); await turn();
  const final = await request(h.server, { pathname: '/api/planner-status', body: { token, include_day_snapshot: 1 } });
  assert.equal(final.status, 410);
  assert.equal(final.body.day_snapshot, undefined);
  assert.equal(h.counts().puts, 0);
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('cancelled cold original does not issue an already committed late store settlement or roll it back', { timeout: 15000 }, async t => {
  const work = deferred(), committed = deferred(), release = deferred(), returned = deferred();
  const background = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'cancel-after-admission', load: () => work.promise });
  const h = await setup(t, { openDataLoader: value => background.load(value, value) });
  const put = h.options.publishedDayStore.put;
  h.options.publishedDayStore.put = async value => {
    const saved = await put(value); committed.resolve(saved); await release.promise; returned.resolve(); return saved;
  };
  t.after(() => { release.resolve(); work.resolve([]); });
  const initial = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, headers: { Prefer: 'respond-async' } });
  assert.equal(initial.status, 202);
  const token = initial.body.planner_lifecycle.token;
  work.resolve(h.records);
  const saved = await committed.promise;
  assert.equal(saved.state, 'ready', 'real atomic store has finished, not a synthetic settlement');
  assert.equal((await request(h.server, { method: 'DELETE', pathname: '/api/planner-status', body: { token } })).status, 204);
  release.resolve(); await returned.promise; await turn();
  const final = await request(h.server, { pathname: '/api/planner-status', body: { token } });
  assert.equal(final.status, 410);
  assert.equal(final.body.day_snapshot, undefined);
  assert.equal(h.counts().puts, 1);
  assert.equal((await h.store.read(saved.snapshot.ref)).status, 200, 'unissued record remains immutable and consumes quota');
  assert.equal((await fs.readdir(path.join(h.directory, 'published-days-v1'))).length, 1);
});

test('cold status cannot add consent or remove original private endpoint presence', async t => {
  for (const original of [{ ...BODY, start: { type: 'coordinates', lat: 41.9, lng: 12.49 } }, BODY]) {
    await t.test(original === BODY ? 'absent original opt-in' : 'original private endpoint', async t => {
      const work = deferred();
      const background = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'private-original', load: () => work.promise });
      const h = await setup(t, { openDataLoader: value => background.load(value, value) });
      const opted = original !== BODY;
      const initial = await request(h.server, { pathname: `${ROUTE}${opted ? '&include_day_snapshot=1' : ''}`, body: original, headers: { Prefer: 'respond-async' } });
      assert.equal(initial.status, 202);
      const token = initial.body.planner_lifecycle.token;
      work.resolve(h.records); await turn();
      const result = await request(h.server, { pathname: '/api/planner-status?include_day_snapshot=1',
        body: { token, privacy: { customEndpointPresent: false }, start: { type: 'auto' }, dates: ['2030-01-01'], include_day_snapshot: 1 } });
      assert.equal(result.status, 200);
      accepted(result.body);
      if (opted) assert.deepEqual(result.body.day_snapshot, { version: 1, state: 'unavailable' });
      else assert.equal(result.body.day_snapshot, undefined);
      assert.equal(h.counts().puts, 0);
      assert.deepEqual(await request(h.server, { pathname: '/api/planner-status', body: { token } }), result);
    });
  }
});

test('applied removal and explicit empty day keep exact edit and pin truth through publication and read', async t => {
  const h = await setup(t);
  for (const empty of [false, true]) {
    const retained = empty ? [] : [IDS[1], IDS[2]];
    const command = { version: 1, action: 'remove', candidate_id: IDS[0], retained_candidate_ids: retained,
      target_stop_count: retained.length, slot_index: 0, replacement_preference: null, removed_candidate_ids: [IDS[4]] };
    const body = { ...BODY, day_edit: command, pinned_candidate_ids: empty ? [] : [IDS[1]], excluded_candidate_ids: ['earlier-dismissed'] };
    const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body });
    assert.equal(result.status, 200);
    const experiment = result.body.agnostic_route_output_experiment;
    assert.equal(experiment.day_edit.status, 'applied', 'real publisher accepted the edit');
    assert.deepEqual(result.body.days[0].primary_route?.main_stops.map(stop => stop.id) || [], retained);
    assert.equal(experiment.pinned_candidates.honored_count, empty ? 0 : 1);
    if (empty) { assert.equal(result.body.days[0].manual_empty_day, true); assert.equal(experiment.manual_edit_published, true); }
    assert.equal(result.body.day_snapshot.state, 'ready');
    const read = await request(h.server, { method: 'GET', pathname: `/api/shared-days/${result.body.day_snapshot.ref}`, body: null });
    const intent = { ...INTENT, dayEdit: command, excludedCandidateIds: ['earlier-dismissed', IDS[0], IDS[4]], pinnedCandidateIds: body.pinned_candidate_ids };
    assert.deepEqual(read.body.result, project(result.body, h.records, intent, body).result);
    assert.deepEqual(read.body.intent.dayEdit.retained_candidate_ids, retained);
    assert.deepEqual(read.body.intent.excludedCandidateIds, intent.excludedCandidateIds);
  }
});

test('implicit selected composition date is retained across a later clock rollover', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  let weatherCalls = 0;
  const h = await setup(t, { weatherProvider: async () => {
    if (++weatherCalls === 1) t.mock.timers.tick(24 * 60 * 60 * 1000);
    return null;
  } });
  const { dates, ...body } = BODY;
  const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body });
  assert.ok(weatherCalls > 0);
  assert.equal(result.body.days[0].date, DATE, 'date was chosen before the trusted weather await');
  assert.equal(result.body.day_snapshot.state, 'ready');
  const read = await h.store.read(result.body.day_snapshot.ref);
  assert.equal(read.body.intent.dateIso, DATE);
  assert.equal(read.body.result.days[0].date, DATE);
});

test('source-owned age and actual unhonored-pin reasons remain exact through restart reads without mtime renewal', async t => {
  let rows;
  const h = await setup(t, { openDataLoader: async () => rows });
  const cacheAge = { served_stale: true, stale_age_seconds: 123, refresh_reason: 'stale_cache_refresh_failed' };
  // An injected trusted loader owns this envelope; none of these fields are
  // accepted from HTTP. This is pass-through coverage, not a source refresh test.
  rows = Object.assign([...h.records], { loader_metadata: { cache: cacheAge } });
  const body = { ...BODY, pinned_candidate_ids: ['missing-source-place'] };
  const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body });
  accepted(result.body);
  const experiment = result.body.agnostic_route_output_experiment;
  assert.deepEqual(experiment.source_status.collection.cache, cacheAge);
  assert.equal(experiment.pinned_candidates.unhonored[0].id, 'missing-source-place');
  assert.ok(experiment.pinned_candidates.unhonored[0].reason, 'actual final refusal has a source-bound reason');
  assert.equal(result.body.day_snapshot.state, 'ready');
  const filename = path.join(h.directory, 'published-days-v1', `${result.body.day_snapshot.ref}.json`);
  const before = await fs.stat(filename, { bigint: true });
  const read = await request(h.server, { method: 'GET', pathname: `/api/shared-days/${result.body.day_snapshot.ref}`, body: null });
  const projected = project(result.body, h.records, { ...INTENT, pinnedCandidateIds: body.pinned_candidate_ids }, body);
  assert.deepEqual(read.body.result, projected.result);
  const restart = await listen(t, { ...h.options, publishedDayStore: createPublishedDayStore({ directory: h.directory, clock: () => Date.parse(NOW) }),
    openDataLoader: () => assert.fail('restart read must not refresh ages') });
  assert.deepEqual(await request(restart, { method: 'GET', pathname: `/api/shared-days/${result.body.day_snapshot.ref}`, body: null }), read);
  assert.equal((await fs.stat(filename, { bigint: true })).mtimeNs, before.mtimeNs);
});

test('unrepresentable deep JSON preference refuses only sharing and preserves the actual HTTP day', async t => {
  const h = await setup(t);
  const rawBody = '{"place":"Roma","dates":["' + DATE + '"],"preferences":["culture",' +
    '{"nested":'.repeat(4000) + '{}' + '}'.repeat(4000) +
    '],"day_rhythm":"balanced","include_external_candidates":1}';
  assert.ok(Buffer.byteLength(rawBody) < 100 * 1024, 'valid JSON remains inside the ordinary HTTP input limit');
  const baseline = await request(h.server, { rawBody });
  assert.equal(baseline.status, 200, 'the original non-sharing HTTP operation really succeeds');
  accepted(baseline.body);
  const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, rawBody });
  assert.equal(result.status, 200, 'QUALITY-01: optional retention must not turn the same accepted day into a 500');
  assert.deepEqual(withoutSnapshot(result.body), baseline.body);
  assert.deepEqual(result.body.day_snapshot, { version: 1, state: 'unavailable' });
  assert.equal(h.counts().puts, 0);
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('failed retention clears prior private context without changing the accepted day', async t => {
  const { createDayPublication } = require('../server/planner/published-day-publication');
  const h = await setup(t);
  const baseline = await request(h.server);
  accepted(baseline.body);
  const publication = createDayPublication({ body: BODY, query: { include_day_snapshot: '1' } }, () => true);
  publication.retain({ records: h.records, date: DATE }, INTENT);
  const brokenIntent = { ...INTENT, get preferences() { throw new Error('private retention fixture failure'); } };
  assert.doesNotThrow(() => publication.retain({ records: h.records, date: DATE }, brokenIntent),
    'QUALITY-01: a failed later retention must remain inside the optional publication boundary');
  const published = structuredClone(baseline.body);
  await publication.publish(published, 'en', h.options.publishedDayStore);
  assert.deepEqual(withoutSnapshot(published), baseline.body);
  assert.deepEqual(published.day_snapshot, { version: 1, state: 'unavailable' });
  assert.equal(h.counts().puts, 0, 'failure must not reuse the earlier valid retained frame');
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('actual accepted duplicate preference selection publishes its normalized set without changing the day', async t => {
  const h = await setup(t);
  const body = { ...BODY, preferences: ['culture', 'culture'], preference_priority: ['culture', 'culture'],
    pinned_candidate_ids: ['mercato-monti', 'mercato-monti'], excluded_candidate_ids: ['dismissed', 'dismissed'] };
  const baseline = await request(h.server, { body });
  assert.equal(baseline.body.agnostic_route_output_experiment.promotion.promote, true);
  const result = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body });
  assert.deepEqual(withoutSnapshot(result.body), baseline.body);
  assert.equal(result.body.day_snapshot?.state, 'ready', 'bind the preference set actually used by the composer');
  const read = await h.store.read(result.body.day_snapshot.ref);
  assert.deepEqual(read.body.intent.selected, ['culture']);
  assert.deepEqual(read.body.intent.preferencePriority, ['culture']);
  assert.deepEqual(read.body.intent.pinnedCandidateIds, ['mercato-monti']);
  assert.deepEqual(read.body.intent.excludedCandidateIds, ['dismissed']);
});
