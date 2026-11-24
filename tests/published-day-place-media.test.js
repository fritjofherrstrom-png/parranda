'use strict';
// Place media on a shared day (docs/PLACE_MEDIA.md, "Published schema"): a
// hydrated live day and its shared copy carry identical media; forged media
// refuse the share; unreadable media are dropped so they never refuse it; the
// URL witness bag never grows; with the feature off nothing changes.
require('./helpers/file-deadline');
require('./helpers/no-live-network');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildApp } = require('../server/app');
const { createPlaceMedia, setPlaceMediaForTests } = require('../server/place-media');
const { createWikimediaClient } = require('../server/place-media/wikimedia-client');
const { resetAttestationForTests } = require('../server/place-media/hydrate');
const { budget } = require('../server/planner/published-day-fields');
const { projectPublishedDay } = require('../server/planner/published-day-projection');
const { capturePublishedDayPrivacy } = require('../server/planner/published-day-privacy');
const { createPublishedDayStore } = require('../server/planner/published-day-store');
const { attestPublicPlaceRecords, publicSourceUrlsForRecords } = require('../server/place-candidates/source-url-evidence');
const { mockStableWeatherFetch } = require('./helpers/planner-reservoir-compare');
const { createBackgroundSource } = require('../server/place-candidates/background-source');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createFixtureFetcher } = require('./helpers/place-media-fixtures');

const DATE = '2026-05-25';
const NOW = `${DATE}T08:00:00.000Z`;
const QID = 'Q1331646';
const MUSEUM = 'osm-node-304609719';
const ROUTE = '/api/route-recommendations?lang=sv&experimental_agnostic_route_output=1&agnostic_engine_compose=1';
const BODY = { place: 'Stockholm', dates: [DATE], preferences: ['culture', 'fika', 'food'], day_rhythm: 'balanced',
  include_external_candidates: 1, pinned_candidate_ids: [MUSEUM] };
const INTENT = { dateIso: DATE, preferences: ['culture', 'fika', 'food'], preferencePriority: [], dayRhythm: 'balanced',
  excludedCandidateIds: [], pinnedCandidateIds: [MUSEUM], liveEventChoices: [], dayEdit: null };
const MEDIA_KEYS = ['wikidata_id', 'media', 'subtitle', 'about'];
const CENTER = { lat: 59.3294, lng: 18.0674 };

function record(id, name, type, lat, lng, tags, qid) {
  return { id, name, type, lat, lng, tags, sources: [
    { provider: 'osm', family: 'map', tier: 'inferred', url: `https://www.openstreetmap.org/node/${id.slice('osm-node-'.length)}` },
    ...(qid ? [{ provider: 'wikidata', family: 'open_knowledge', tier: 'inferred', url: `https://www.wikidata.org/wiki/${qid}` }] : []),
  ] };
}
// OSM-shaped rows as the Overpass source issues them: Medelhavsmuseet (real
// node, its own wikidata tag) at the real P625 of Q1331646, plus filler stops
// without any Wikidata identity.
const RECORDS = [record(MUSEUM, 'Medelhavsmuseet', 'museum', 59.32939444, 18.06740278, ['museum'], QID),
  ...[['food', 'restaurant', ['mat']], ['cafe', 'cafe', ['fika']], ['museum', 'museum', ['museum']]].flatMap(([prefix, type, tags]) =>
    Array.from({ length: 8 }, (_, i) => record(`osm-node-${9100000 + prefix.length * 100 + i}`, `${prefix} ${i}`, type,
      CENTER.lat + (i % 4) * 0.0008 + 0.0005, CENTER.lng + Math.floor(i / 4) * 0.0008 + 0.0005, tags)))];

function request(server, { method = 'POST', pathname = ROUTE, body = BODY, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method,
      headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject); req.end(payload);
  });
}

async function tempDir(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

/** A place-media service whose index already holds Q1331646, built offline from real-shaped fixtures. */
async function mediaService(t) {
  const dir = await tempDir(t, 'published-day-place-media-');
  const { fetcher } = createFixtureFetcher();
  const records = await createWikimediaClient({ fetcher, clock: () => Date.parse('2026-11-24T10:00:00Z') }).fetchRecords([QID]);
  await fs.writeFile(path.join(dir, 'index-v1.jsonl'), `${[...records.values()].map(row => JSON.stringify(row)).join('\n')}\n`);
  const upstream = [];
  const service = createPlaceMedia({ dir, fetcher: async (...args) => { upstream.push(args[0]); return fetcher(...args); } });
  return { service, upstream };
}

/**
 * The real disk store where this platform can persist (Linux CI); otherwise an
 * in-memory store with the same put/read contract, so the publish → GET round
 * trip and every projection assertion still run on macOS.
 */
async function portableStore(t) {
  const directory = await tempDir(t, 'published-day-place-media-store-');
  const disk = createPublishedDayStore({ directory, clock: () => Date.parse(NOW) });
  const probe = await disk.put({ language: 'en', intent: { selected_date: DATE },
    result: { days: [{ date: DATE, primary_route: { main_stops: [{ id: 'probe', label: 'Probe', lat: 55.6, lng: 13 }] } }] } });
  if (probe?.state === 'ready') return { store: disk, kind: 'disk' };
  const saved = new Map();
  return { kind: 'memory', store: {
    async put(projection) {
      const ref = randomBytes(24).toString('hex');
      const snapshot = { version: 1, ref, created_at: NOW, expires_at: '2026-06-24T08:00:00.000Z' };
      saved.set(ref, JSON.stringify({ ...snapshot, ...projection }));
      return { state: 'ready', snapshot };
    },
    async read(ref) {
      return saved.has(ref) ? { status: 200, body: JSON.parse(saved.get(ref)) } : { status: 404, body: { error: 'day_snapshot_unavailable' } };
    },
  } };
}

async function setup(t, { media = true, openDataLoader = null } = {}) {
  resetAttestationForTests();
  const oldFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  t.after(() => { global.fetch = oldFetch; });
  const placeMedia = media ? await mediaService(t) : null;
  setPlaceMediaForTests(placeMedia ? placeMedia.service : null);
  t.after(() => setPlaceMediaForTests(undefined));
  const { store, kind } = await portableStore(t);
  let puts = 0, settled;
  const persisted = new Promise(resolve => { settled = resolve; });
  // Witnessed like the real OSM source cache does, so sharing can succeed.
  const server = buildApp({ openDataLoader: openDataLoader || (async () => attestPublicPlaceRecords(structuredClone(RECORDS), 'osm')),
    placeResolver: async () => [{ label: 'Stockholm, Sverige', lat: CENTER.lat, lng: CENTER.lng, confidence: 'high',
      provenance: 'offline_fixture', timezone: 'Europe/Stockholm', osm_class: 'place', osm_ref: 'relation/398021' }],
    placeSuggestions: null, reviewedPlaceSource: null, sourceCatalog: null, eventSupply: null,
    placeSelectionStore: { issue: () => null }, clock: () => new Date(NOW),
    publishedDayStore: { read: ref => store.read(ref), async put(value) {
      puts++; const saved = await store.put(value); settled(saved); return saved;
    } },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return { server, placeMedia, storeKind: kind, puts: () => puts, persisted };
}

const privacy = (body = BODY) => ({ ...capturePublishedDayPrivacy({ body, query: {} }),
  publicSourceUrls: publicSourceUrlsForRecords(attestPublicPlaceRecords(structuredClone(RECORDS), 'osm')) });
function withoutSnapshot(body) { const { day_snapshot, ...rest } = body; return rest; }
function project(published, { intent = INTENT, policy = privacy() } = {}) {
  return projectPublishedDay({ published: withoutSnapshot(published), intent, language: 'sv', privacy: policy });
}
const museumOf = body => body.days[0].primary_route.main_stops.find(stop => stop.id === MUSEUM);
const pick = (stop, keys = MEDIA_KEYS) => Object.fromEntries(keys.filter(key => Object.hasOwn(stop, key)).map(key => [key, stop[key]]));
function stripMedia(value) {
  if (Array.isArray(value)) return value.map(stripMedia);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !MEDIA_KEYS.includes(key)).map(([key, item]) => [key, stripMedia(item)]));
}
function mediaKeyPaths(value, at = '$', out = []) {
  if (Array.isArray(value)) value.forEach((item, i) => mediaKeyPaths(item, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (MEDIA_KEYS.includes(key)) out.push(`${at}.${key}`);
    mediaKeyPaths(item, `${at}.${key}`, out);
  }
  return out;
}

function assertHydrated(stop) {
  assert.equal(stop.wikidata_id, QID);
  assert.equal(stop.media?.subject_qid, QID);
  assert.equal(stop.media.author, 'Holger Ellgaard');
  assert.equal(stop.media.file_page_url, 'https://commons.wikimedia.org/wiki/File:Medelhavsmuseet_2007.jpg');
  assert.deepEqual(stop.subtitle, { text: 'museum i Stockholm', lang: 'sv', subject_qid: QID, source: 'wikidata' },
    'the kicker follows the request language');
  assert.equal(stop.about?.lang, 'sv');
  assert.match(stop.about.article_url, /^https:\/\/sv\.wikipedia\.org\/w\/index\.php\?oldid=\d+$/);
}

test('a hydrated day publishes, and the shared GET returns the identical photo, kicker and excerpt', async t => {
  const h = await setup(t);
  const live = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1` });
  assert.equal(live.status, 200);
  assert.equal(live.body.agnostic_route_output_experiment.promotion.promote, true, 'real composed day must publish');
  const stop = museumOf(live.body);
  assertHydrated(stop);
  const others = live.body.days[0].primary_route.main_stops.filter(row => row.id !== MUSEUM);
  assert.ok(others.length >= 2 && others.every(row => MEDIA_KEYS.every(key => !Object.hasOwn(row, key))),
    'stops without a Wikidata identity gain nothing');
  assert.deepEqual(h.placeMedia.upstream, [], 'an indexed QID needs no upstream call');

  // Pure projection: runs on every platform.
  const projected = project(live.body);
  if (!projected) assert.doesNotThrow(() => budget(privacy()).copy('Result', withoutSnapshot(live.body)), 'diagnose the closed publication boundary');
  assert.ok(projected, 'media must survive real portable publication');
  assert.deepEqual(pick(museumOf(projected.result)), pick(stop));
  assert.equal(JSON.stringify(museumOf(projected.result).media), JSON.stringify(stop.media), 'same keys in the same order');

  // Publication and the shared-day read.
  assert.equal(live.body.day_snapshot?.state, 'ready', `store ${h.storeKind}`);
  assert.equal(h.puts(), 1);
  const read = await request(h.server, { method: 'GET', pathname: `/api/shared-days/${live.body.day_snapshot.ref}`, body: null });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.result, projected.result, 'the stored day is exactly the projection');
  const shared = museumOf(read.body.result);
  assert.deepEqual(pick(shared), pick(stop), 'live and shared days carry identical media');
  assert.deepEqual(shared.media, stop.media);
  assert.deepEqual(shared.subtitle, stop.subtitle);
  assert.deepEqual(shared.about, stop.about);
});

test('a manual day edit is hydrated before publication and shares the same media', async t => {
  const h = await setup(t);
  const first = await request(h.server);
  const ids = first.body.days[0].primary_route.main_stops.map(stop => stop.id);
  const removed = ids.find(id => id !== MUSEUM);
  const retained = ids.filter(id => id !== removed);
  const command = { version: 1, action: 'remove', candidate_id: removed, retained_candidate_ids: retained,
    target_stop_count: retained.length, slot_index: ids.indexOf(removed), replacement_preference: null, removed_candidate_ids: [] };
  const edited = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, body: { ...BODY, day_edit: command } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.agnostic_route_output_experiment.day_edit.status, 'applied');
  assertHydrated(museumOf(edited.body));
  assert.equal(edited.body.day_snapshot?.state, 'ready', 'an edited day with media still shares');
  const editedRead = await request(h.server, { method: 'GET', pathname: `/api/shared-days/${edited.body.day_snapshot.ref}`, body: null });
  assert.deepEqual(pick(museumOf(editedRead.body.result)), pick(museumOf(edited.body)));
});

test('the async planner-status completion is hydrated before its publication', { timeout: 20000 }, async t => {
  // A cold source: the planner answers 202 and the original worker owns the
  // completion and its publication, exactly as in production.
  let release;
  const work = new Promise(resolve => { release = resolve; });
  const background = createBackgroundSource({ cache: createSourceCache(), keyFor: () => 'place-media-cold', load: () => work });
  const h = await setup(t, { openDataLoader: value => background.load(value, value) });
  t.after(() => release([]));
  const started = await request(h.server, { pathname: `${ROUTE}&include_day_snapshot=1`, headers: { Prefer: 'respond-async' } });
  assert.equal(started.status, 202);
  release(attestPublicPlaceRecords(structuredClone(RECORDS), 'osm'));
  await h.persisted;
  await new Promise(resolve => setImmediate(resolve));
  const status = await request(h.server, { pathname: '/api/planner-status', body: { token: started.body.planner_lifecycle.token } });
  assert.equal(status.status, 200);
  assertHydrated(museumOf(status.body));
  assert.equal(status.body.day_snapshot?.state, 'ready');
  const read = await request(h.server, { method: 'GET', pathname: `/api/shared-days/${status.body.day_snapshot.ref}`, body: null });
  assert.deepEqual(pick(museumOf(read.body.result)), pick(museumOf(status.body)), 'the cold publication carries the same media');
});

test('forged media refuse the share: unattested, another subject, or not this stop', async t => {
  const h = await setup(t);
  const live = await request(h.server);
  const base = withoutSnapshot(live.body);
  assert.ok(project(base), 'precondition: the genuine day shares');
  const forged = mutate => { const copy = structuredClone(base); mutate(copy.days[0].primary_route.main_stops); return copy; };
  const museum = stops => stops.find(stop => stop.id === MUSEUM);
  const other = stops => stops.find(stop => stop.id !== MUSEUM);
  const cases = {
    'unattested author': stops => { museum(stops).media.author = 'Someone Else'; },
    'unattested excerpt': stops => { museum(stops).about.text = 'Ett påhittat museum med mycket fina samlingar från hela världen.'; },
    'unattested kicker': stops => { museum(stops).subtitle.text = 'världens bästa museum'; },
    'unattested media id': stops => { museum(stops).media.media_id = 'a'.repeat(40); },
    'wrong subject_qid': stops => { museum(stops).media.subject_qid = 'Q42'; },
    'wrong subject on excerpt': stops => { museum(stops).about.subject_qid = 'Q42'; },
    'wikidata_id not the stop\'s QID': stops => { const stop = museum(stops); stop.wikidata_id = 'Q42'; stop.media.subject_qid = 'Q42'; },
    'media without wikidata_id': stops => { delete museum(stops).wikidata_id; },
    'media copied onto another stop': stops => { Object.assign(other(stops), pick(museum(stops))); },
    'wikidata_id on a stop without that identity': stops => { other(stops).wikidata_id = QID; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    assert.equal(project(forged(mutate)), null, name);
  }
});

test('media that break a scalar rule are dropped before the copy, so the share still succeeds', async t => {
  const h = await setup(t);
  const live = await request(h.server);
  const base = withoutSnapshot(live.body);
  const genuine = museumOf(base);
  const variant = mutate => { const copy = structuredClone(base); mutate(museumOf(copy)); return copy; };

  const urlAuthor = variant(stop => { stop.media.author = 'http://x'; });
  const before = JSON.stringify(urlAuthor);
  const projected = project(urlAuthor);
  assert.ok(projected, 'an unreadable credit must not refuse the whole day');
  assert.equal(JSON.stringify(urlAuthor), before, 'the pre-copy step never mutates its input');
  const shared = museumOf(projected.result);
  assert.equal(Object.hasOwn(shared, 'media'), false, 'the photo with a URL as author is dropped');
  assert.deepEqual(pick(shared, ['wikidata_id', 'subtitle', 'about']), pick(genuine, ['wikidata_id', 'subtitle', 'about']),
    'readable siblings stay');

  for (const [name, mutate, gone] of [
    ['author starting with www.', stop => { stop.media.author = 'www.example.org'; }, ['media']],
    ['licence URL of another licence', stop => { stop.media.license_url = 'https://creativecommons.org/licenses/by/4.0/'; }, ['media']],
    ['author missing under CC BY-SA', stop => { stop.media.author = null; }, ['media']],
    ['excerpt over 320 characters', stop => { stop.about.text = `${'Ett museum. '.repeat(30)}Slut.`; }, ['about']],
    ['excerpt permalink elsewhere', stop => { stop.about.article_url = 'https://example.org/w/index.php?oldid=1'; }, ['about']],
    ['kicker with a URL', stop => { stop.subtitle.text = 'se https://example.org'; }, ['subtitle']],
    ['malformed wikidata_id', stop => { stop.wikidata_id = 'q1331646'; }, MEDIA_KEYS],
  ]) {
    const result = project(variant(mutate));
    assert.ok(result, name);
    const stop = museumOf(result.result);
    for (const key of MEDIA_KEYS) assert.equal(Object.hasOwn(stop, key), !gone.includes(key) && Object.hasOwn(genuine, key), `${name}: ${key}`);
  }
});

test('publicSourceUrls does not grow: media URLs pass only through their dedicated types', async t => {
  const h = await setup(t);
  const live = await request(h.server);
  const policy = privacy();
  const witnesses = [...policy.publicSourceUrls];
  const stop = museumOf(live.body);
  const mediaUrls = [stop.media.file_page_url, stop.media.license_url, stop.about.article_url];
  assert.ok(mediaUrls.every(url => !policy.publicSourceUrls.has(url)), 'no media URL is a source witness');
  assert.ok(project(live.body, { policy }), 'the share succeeds without them');
  assert.deepEqual([...policy.publicSourceUrls], witnesses, 'projection never adds to the witness bag');
  for (const url of mediaUrls) {
    assert.throws(() => budget(policy).copy('Stop', { ...stripMedia(stop), website: url }), /url/,
      'a media URL in an ordinary URL field is still unattested');
  }
  assert.throws(() => budget(policy).copy('StopAbout', { ...stop.about, article_url: stop.media.file_page_url }), /wikipediaPermalink/);
  assert.throws(() => budget(policy).copy('StopMedia', { ...stop.media, file_page_url: stop.about.article_url }), /commonsFilePageUrl/);
});

test('with the feature off the response is the response without media, byte for byte', async t => {
  const off = await setup(t, { media: false });
  const plain = await request(off.server);
  assert.equal(plain.status, 200);
  assert.deepEqual(mediaKeyPaths(plain.body), [], 'feature off adds no media field anywhere');
  const on = await setup(t);
  const hydrated = await request(on.server);
  assertHydrated(museumOf(hydrated.body));
  assert.equal(JSON.stringify(stripMedia(hydrated.body)), JSON.stringify(plain.body),
    'media are purely additive: same stops, order, geometry and copy');
});
