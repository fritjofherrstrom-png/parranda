'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createOwnerCorrectionStore, foldEvents, typeForOsmTag, validateEvent, withOwnerCorrections,
} = require('../server/planner/owner-corrections');
const { SOURCE_COMPLETION, SOURCE_SNAPSHOT } = require('../server/place-candidates/background-source');
const { main: cli } = require('../scripts/owner-correction');

const FLAT_SERVICE = 'overture-537a9f68-f791-4e64-9b01-5b66db7aab08';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'owner-corrections-'));
const silent = { warn: () => {} };
function storeAt(dir = tempDir(), options = {}) {
  let clock = Date.parse('2026-11-25T12:00:00Z');
  const store = createOwnerCorrectionStore({ directory: dir, now: () => clock, logger: silent, ...options });
  return { dir, store, tick: (ms = 1000) => { clock += ms; } };
}
const hide = (id, reason = 'Not a place to visit') => ({ event: 'add', action: 'hide', target: { id }, reason });
const supply = () => [
  { id: FLAT_SERVICE, name: 'Flat Service', type: 'vintage-shop', tags: ['second_hand'], place_details: { kind: 'second_hand_clothing' } },
  { id: 'osm-node-3343392544', name: 'Antik Ambra', type: 'vintage-shop', tags: ['vintage', 'antique'] },
  { id: 'osm-node-7', name: 'Museum', type: 'museum', tags: ['kultur', 'museum'] },
];

test('without a directory there is no store and the loader is returned unchanged', () => {
  assert.equal(createOwnerCorrectionStore({}), null);
  assert.equal(createOwnerCorrectionStore({ directory: '  ' }), null);
  const loader = async () => [];
  assert.equal(withOwnerCorrections(loader, null), loader);
  assert.equal(withOwnerCorrections(null, storeAt().store), null);
});

test('a hidden place never comes back from the loader; the rest keeps its order', async () => {
  const { store } = storeAt();
  store.append(hide(FLAT_SERVICE, 'Property manager, not a second-hand shop'));
  const loader = withOwnerCorrections(async () => supply(), store);
  assert.deepEqual((await loader()).map(record => record.name), ['Antik Ambra', 'Museum']);
});

test('a re-typed place takes the type and tags of the OSM mapping and drops its old details', async () => {
  const { store } = storeAt();
  store.append({ event: 'add', action: 'set_type', target: { id: FLAT_SERVICE }, value: { osm: 'tourism=museum' }, reason: 'Test' });
  const [first] = await withOwnerCorrections(async () => supply(), store)();
  assert.equal(first.type, 'museum');
  assert.deepEqual(first.tags, ['kultur', 'museum']);
  assert.equal(first.place_details, undefined);
  assert.equal(first.name, 'Flat Service', 'name, place and sources are never changed');
});

test('revoking a correction brings the place back, and nothing is erased from the log', async () => {
  const { store } = storeAt();
  const added = store.append(hide(FLAT_SERVICE));
  store.append({ event: 'revoke', id: added.id, reason: 'Was right after all' });
  const records = await withOwnerCorrections(async () => supply(), store)();
  assert.equal(records.length, 3);
  const log = fs.readFileSync(store.file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(log.map(event => event.event), ['add', 'revoke']);
  assert.throws(() => store.append({ event: 'revoke', id: added.id }), /no active correction/);
});

test('the latest correction for a place wins, and a hide outranks a re-type', () => {
  const at = '2026-11-25T12:00:00Z';
  const add = (id, action, value) => ({ v: 1, event: 'add', id, at, target: { id: 'osm-node-1' }, action, value, reason: 'x' });
  const later = foldEvents([add('c_aaaaaa', 'set_type', { osm: 'amenity=cafe' }), add('c_bbbbbb', 'set_type', { osm: 'amenity=bar' })]);
  assert.equal(later.retype.get('osm-node-1').type, 'bar');
  const both = foldEvents([add('c_aaaaaa', 'set_type', { osm: 'amenity=cafe' }), add('c_bbbbbb', 'hide', null)]);
  assert.ok(both.hidden.has('osm-node-1'));
  assert.equal(both.retype.size, 0);
});

test('nothing invalid can be written, and every refusal names its reason', () => {
  const { store } = storeAt();
  const refuse = (input, reason) => assert.throws(() => store.append(input), error => error.reason === reason);
  refuse({ ...hide(FLAT_SERVICE), reason: '' }, 'reason_required');
  refuse({ ...hide(FLAT_SERVICE), reason: 'x'.repeat(281) }, 'reason_required');
  refuse(hide('../../etc/passwd'), 'bad_target');
  refuse({ ...hide(FLAT_SERVICE), action: 'set_hours' }, 'unknown_action');
  refuse({ event: 'add', action: 'set_type', target: { id: FLAT_SERVICE }, value: { osm: 'office=company' }, reason: 'x' }, 'unknown_type');
  refuse({ event: 'add', action: 'set_type', target: { id: FLAT_SERVICE }, value: { osm: 'shop=clothes' }, reason: 'x' }, 'unknown_type');
  assert.equal(fs.existsSync(store.file), false, 'a refused correction writes nothing');
  assert.deepEqual(typeForOsmTag('shop=antiques'), { type: 'vintage-shop', tags: ['vintage', 'antique'] });
  assert.equal(validateEvent({ v: 2 }).error, 'unknown_version');
});

test('unreadable lines are skipped and counted, the rest still applies', async () => {
  const { store, dir } = storeAt();
  store.append(hide(FLAT_SERVICE));
  fs.appendFileSync(path.join(dir, 'corrections.jsonl'), 'not json\n{"v":1,"event":"add","id":"c_zzzzzz"}\n');
  assert.equal(store.skippedLines(), 2);
  assert.equal((await withOwnerCorrections(async () => supply(), store)()).length, 2);
});

test('a correction written by another process applies without a restart', async () => {
  const { dir, store, tick } = storeAt();
  const loader = withOwnerCorrections(async () => supply(), store);
  assert.equal((await loader()).length, 3);
  const other = createOwnerCorrectionStore({ directory: dir, logger: silent });
  other.append(hide(FLAT_SERVICE));
  tick(1000);
  assert.equal((await loader()).length, 2);
});

test('the loader answer keeps its status and metadata, and failures pass untouched', async () => {
  const { store } = storeAt();
  store.append(hide(FLAT_SERVICE));
  const answer = supply();
  answer.loader_status = 'loaded:3';
  Object.defineProperty(answer, 'loader_metadata', { value: { cache: 'hit' } });
  const records = await withOwnerCorrections(async () => answer, store)();
  assert.equal(records.loader_status, 'loaded:3');
  assert.deepEqual(records.loader_metadata, { cache: 'hit' });
  assert.equal(Object.keys(records).includes('loader_metadata'), false, 'hidden metadata stays out of JSON');
  const failure = { error: 'fetch_error' };
  assert.equal(await withOwnerCorrections(async () => failure, store)(), failure);
});

test('with nothing to correct the very same answer comes back', async () => {
  const { store } = storeAt();
  const answer = supply();
  assert.equal(await withOwnerCorrections(async () => answer, store)(), answer);
  store.append(hide('osm-node-404'));
  assert.equal(await withOwnerCorrections(async () => answer, store)(), answer);
});

test('places that arrive late from a background source pass the same corrections', async () => {
  const { store } = storeAt();
  store.append(hide(FLAT_SERVICE));
  const initial = [supply()[2]];
  let finish;
  Object.defineProperty(initial, SOURCE_COMPLETION, { value: new Promise(resolve => { finish = resolve; }) });
  Object.defineProperty(initial, SOURCE_SNAPSHOT, { value: () => supply() });
  const records = await withOwnerCorrections(async () => initial, store)();
  assert.notEqual(records, initial);
  assert.deepEqual(records[SOURCE_SNAPSHOT]().map(record => record.name), ['Antik Ambra', 'Museum']);
  finish(supply());
  assert.deepEqual((await records[SOURCE_COMPLETION]).map(record => record.name), ['Antik Ambra', 'Museum']);
});

test('helpers hung on the loader keep working through the wrap', async () => {
  const { store } = storeAt();
  store.append(hide(FLAT_SERVICE));
  const loader = async () => supply();
  loader.enrich = records => records;
  loader.readCached = () => [];
  const wrapped = withOwnerCorrections(loader, store);
  assert.equal(wrapped.enrich, loader.enrich);
  assert.equal(wrapped.readCached, loader.readCached);
});

test('the command-line tool adds, lists and revokes', () => {
  const dir = tempDir();
  const lines = [];
  const out = { log: line => lines.push(line) };
  cli(['hide', FLAT_SERVICE, '--reason', 'Property manager', '--label', 'Flat Service', '--source', 'overture', '--dir', dir], {}, out);
  cli(['list', '--dir', dir], {}, out);
  assert.match(lines.at(-2), /hide {2}overture-537a9f68.* \(Flat Service\) {2}— Property manager/);
  assert.match(lines.at(-1), /^1 active correction/);
  const id = lines[0].match(/c_[a-z0-9]+/)[0];
  cli(['revoke', id, '--dir', dir], {}, out);
  cli(['list', '--dir', dir], {}, out);
  assert.match(lines.at(-1), /^0 active correction/);
  assert.throws(() => cli(['list'], {}, out), /PARRANDA_CORRECTIONS_DIR/);
  assert.throws(() => cli(['retype', FLAT_SERVICE, '--osm', 'office=company', '--reason', 'x', '--dir', dir], {}, out), /unknown_type/);
});

test('HTTP: a hidden place leaves the published day, and comes back when revoked', async t => {
  const { buildApp } = require('../server/app');
  const { requestJson } = require('./helpers/planner-reservoir-compare');
  const { rows } = require('./helpers/day-composition-fixtures');
  const { store } = storeAt(tempDir(), { now: () => Date.now() });
  const records = [...rows('museum', 'museum', 8), ...rows('shop', 'vintage-shop', 6)]
    .map(record => ({ ...record, lat: record.lat + 1, lng: record.lng + 1 }));
  const server = buildApp({
    openDataLoader: async () => records,
    ownerCorrections: store,
    eventSupply: async () => [],
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 18,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
    clock: () => new Date('2026-10-16T08:00:00Z'),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const { buildAnywherePayload } = await import('../frontend/src/lib/anywhere-payload.mjs');
  const body = buildAnywherePayload({ coords: { lat: 56.6, lng: 14 }, dates: ['2026-10-17'],
    preferences: ['second_hand', 'culture'], preferencePriority: ['second_hand', 'culture'], dayRhythm: 'full' });
  const stopIds = async () => {
    const reply = await requestJson(server, { path: '/api/route-recommendations?lang=en', body });
    assert.equal(reply.status, 200);
    return reply.body.days[0]?.primary_route?.main_stops.map(stop => stop.id) || [];
  };
  const before = await stopIds();
  const shop = before.find(id => id.startsWith('shop-'));
  assert.ok(shop, `precondition: a second-hand stop is published (${before})`);

  const correction = store.append(hide(shop, 'Not a second-hand shop'));
  const hidden = await stopIds();
  assert.equal(hidden.includes(shop), false, 'the hidden place is gone from the day');
  assert.ok(hidden.length > 0, 'the day is still built from the rest');

  store.append({ event: 'revoke', id: correction.id });
  assert.ok((await stopIds()).includes(shop), 'revoking brings it back');
});
