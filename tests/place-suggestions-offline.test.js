'use strict';
// Suggestions when Photon cannot answer: the offline GeoNames register, the
// circuit that stops waiting on a dead provider, and an earlier answer kept
// for the same query. Rows below follow the GeoNames `geoname` table columns.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { buildGazetteer, createGazetteerSearch, createLazyGazetteer, defaultGazetteerFile, unzipSingleFile } = require('../server/place-candidates/place-gazetteer');
const { createPlaceSuggestions, resolveDefaultPlaceSuggestions } = require('../server/place-candidates/place-suggestions');
const { createPlaceSelectionStore } = require('../server/place-candidates/place-selection');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');

const geoname = (id, name, alternates, lat, lng, code, country, admin1, population, timezone, featureClass = 'P') =>
  [id, name, name.normalize('NFKD').replace(/\p{M}/gu, ''), alternates.join(','), lat, lng, featureClass, code, country, '', admin1, '', '', '', population, '', '', timezone, '2026-11-01'].join('\t');
const CITIES = [
  geoname(2692969, 'Malmö', ['Malmo', 'Malmoe', 'MMX', 'SE-M', 'Malmö 2'], 55.60587, 13.00073, 'PPLA', 'SE', '27', 301706, 'Europe/Stockholm'),
  geoname(3146125, 'Malm', [], 64.07, 11.21, 'PPL', 'NO', '21', 1060, 'Europe/Oslo'),
  geoname(2618425, 'Copenhagen', ['Köpenhamn', 'København', 'Kopenhagen'], 55.67594, 12.56553, 'PPLC', 'DK', '17', 1153615, 'Europe/Copenhagen'),
  geoname(2886242, 'Köln', ['Cologne', 'Kyoln'], 50.93333, 6.95, 'PPLA2', 'DE', '07', 1024621, 'Europe/Berlin'),
  geoname(1857910, 'Kyoto', ['京都', 'Kyōto'], 35.02107, 135.75385, 'PPLA', 'JP', '22', 1459640, 'Asia/Tokyo'),
  geoname(2633352, 'York', [], 53.95763, -1.08271, 'PPLA2', 'GB', 'ENG', 153717, 'Europe/London'),
  geoname(4562407, 'York', [], 39.9626, -76.72774, 'PPLA2', 'US', 'PA', 44118, 'America/New_York'),
  geoname(4229476, 'Warner Robins', ['York'], 32.61574, -83.62664, 'PPL', 'US', 'GA', 73490, 'America/New_York'),
  geoname(5150529, 'Lisbon', [], 40.77201, -80.76814, 'PPL', 'US', 'OH', 2600, 'America/New_York'),
  geoname(5150530, 'Lisbon', [], 41.1, -81.5, 'PPL', 'US', 'OH', 1100, 'America/New_York'),
  geoname(1850144, 'Shibuya', [], 35.6536, 139.70956, 'PPLX', 'JP', '40', 224533, 'Asia/Tokyo'),
  geoname(9999991, 'Old Malmhaus', [], 55.6, 13.0, 'PPLH', 'SE', '27', 5000, 'Europe/Stockholm'),
  geoname(9999992, 'Malmberget Mine', [], 67.17, 20.66, 'MN', 'SE', '25', 0, 'Europe/Stockholm', 'S'),
].join('\n');
const ADMIN1 = ['SE.27\tSkåne\tSkane\t3337385', 'NO.21\tTrøndelag\tTrondelag\t1', 'DK.17\tCapital Region\tCapital Region\t1', 'DE.07\tNorth Rhine-Westphalia\tNorth Rhine-Westphalia\t1',
  'JP.22\tKyoto\tKyoto\t1', 'JP.40\tTokyo\tTokyo\t1', 'GB.ENG\tEngland\tEngland\t1', 'US.PA\tPennsylvania\tPennsylvania\t1', 'US.GA\tGeorgia\tGeorgia\t1', 'US.OH\tOhio\tOhio\t1'].join('\n');
const register = () => buildGazetteer({ citiesTsv: CITIES, admin1Tsv: ADMIN1, source: { name: 'GeoNames' } });
const search = () => createGazetteerSearch(register());
const titles = choices => choices.map(choice => `${choice.title} / ${choice.context}`);

test('the register keeps settlements only and never indexes codes or numbered names as names', () => {
  const data = register();
  assert.equal(data.count, 11, 'history (PPLH) and non-settlements (class S) are not anchors');
  const keys = data.keys.split('\n');
  assert.deepEqual([...keys].sort(), keys, 'the index is sorted at build time');
  assert.ok(!keys.includes('mmx') && !keys.includes('se-m') && !keys.includes('malmo 2'), 'airport and ISO codes and numbered names are not names a person types');
  assert.ok(keys.includes('kopenhamn') && keys.includes('京都'), 'exonyms and native scripts are folded into the index');
});

test('own and major names match by prefix; a minor alternate only by its exact name', () => {
  const find = search();
  assert.deepEqual(titles(find('Malm', { language: 'en' })), ['Malm / Trøndelag · Norway', 'Malmö / Skåne · Sweden'], 'an exact name before a larger prefix name');
  assert.equal(find('Köpen', { language: 'sv' })[0].title, 'Copenhagen', 'a major place is found through its Swedish name');
  assert.deepEqual(titles(find('Kyo', { language: 'en' })), ['Kyoto / Japan'], 'a rare transliteration (Kyoln) needs more than three letters');
  assert.deepEqual(titles(find('York', { language: 'en' })), ['York / England · United Kingdom', 'York / Pennsylvania · United States', 'Warner Robins / Georgia · United States'],
    'a former name of a smaller town follows the places that are called York');
  assert.deepEqual(titles(find('京都', { language: 'en' })), ['Kyoto / Japan']);
  assert.deepEqual(find('Shib', { language: 'en' }).map(choice => choice.kind), ['district']);
});

test('rows a reader cannot tell apart are one row, and a recent place lifts what lies near it', () => {
  const find = search();
  assert.deepEqual(titles(find('Lisbon', { language: 'en' })), ['Lisbon / Ohio · United States']);
  assert.equal(find('Lisbon')[0].candidate.lat, 40.77201, 'the larger of two identical labels is kept');
  const york = find('York', { language: 'en', near: { lat: 40, lng: -76.7 } });
  assert.equal(york[0].context, 'Pennsylvania · United States');
});

test('a register row is a point with its own source, licence and time zone, never an OSM identity', () => {
  const [malmo] = search()('Malmö', { language: 'sv' });
  assert.deepEqual(malmo.candidate, {
    label: 'Malmö, Skåne, Sweden', lat: 55.60587, lng: 13.00073, confidence: 'medium', provenance: 'geonames', geonames_id: 2692969,
    attribution: 'GeoNames', license: 'CC-BY-4.0', timezone: 'Europe/Stockholm',
    admin_context: { locality: null, county: null, region: 'Skåne', country: 'Sweden', country_code: 'se' },
  });
  assert.equal(malmo.context, 'Skåne · Sverige', 'the visible country speaks the reader’s language');
  assert.equal(malmo.query, 'Malmö, Skåne, Sweden');
});

test('a malformed or foreign register is no register', () => {
  assert.equal(createGazetteerSearch({ v: 2 }), null);
  const data = register();
  assert.equal(createGazetteerSearch({ ...data, names: data.names.slice(1) }), null);
  assert.equal(createGazetteerSearch({ ...data, keys: `${data.keys}\nextra` }), null);
});

test('the GeoNames dump unzips without a zip dependency', () => {
  const name = Buffer.from('cities1000.txt');
  const body = Buffer.from(CITIES);
  const deflated = zlib.deflateRawSync(body);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(deflated.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const centralAt = local.length + name.length + deflated.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(centralAt, 16);
  const zip = Buffer.concat([local, name, deflated, central, name, end]);
  assert.equal(unzipSingleFile(zip, 'cities1000.txt').toString(), CITIES);
  assert.throws(() => unzipSingleFile(zip, 'other.txt'), /zip_entry_missing/);
});

test('the register loads once, on first need, and a missing file is simply no register', async () => {
  let reads = 0;
  const lazy = createLazyGazetteer('/register.json', { readFile: async () => { reads++; return JSON.stringify(register()); } });
  assert.equal(reads, 0);
  lazy.warm();
  assert.equal((await lazy('Malmö', {}))[0].title, 'Malmö');
  await lazy('York', {});
  assert.equal(reads, 1);
  const missing = createLazyGazetteer('/nowhere.json', { readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } });
  assert.equal(await missing('Malmö', {}), null);
  assert.equal(createLazyGazetteer(null), null);
  assert.equal(createLazyGazetteer('disabled'), null);
  assert.equal(defaultGazetteerFile({ PARRANDA_CACHE_DIR: '/cache' }), path.join('/cache', 'place-gazetteer', 'geonames-cities1000.v1.json'));
  assert.equal(defaultGazetteerFile({ PARRANDA_PLACE_GAZETTEER: '/elsewhere.json', PARRANDA_CACHE_DIR: '/cache' }), '/elsewhere.json');
  assert.equal(defaultGazetteerFile({}), null);
});

// A provider whose every answer is chosen by the test.
function photon(answer) {
  const calls = [];
  const fetcher = (url, { signal }) => {
    calls.push(new URL(url).searchParams.get('q'));
    const reply = answer(calls.length);
    if (reply === 'hang') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    if (typeof reply === 'number') return Promise.resolve({ ok: false, status: reply, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ features: reply }) });
  };
  return { calls, fetcher };
}
const feature = (name, id) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [13, 55.6] }, properties: { name, country: 'Sverige', countrycode: 'SE', type: 'city', osm_key: 'place', osm_value: 'city', osm_type: 'R', osm_id: id } });
const offline = () => { const find = search(); return async (query, context) => find(query, context); };

test('a dead provider answers from the register at its deadline, then stops being asked', async () => {
  const provider = photon(() => 'hang');
  const suggest = createPlaceSuggestions({ fetcher: provider.fetcher, minIntervalMs: 0, timeoutMs: 20, offlinePlaces: offline() });
  const first = await suggest('Malmö', { language: 'sv' });
  assert.equal(first.status, 'ready');
  assert.deepEqual(first.choices.map(choice => choice.candidate.provenance), ['geonames']);
  assert.equal((await suggest('Copenhagen', { language: 'sv' })).choices[0].title, 'Copenhagen');
  assert.equal(provider.calls.length, 2);
  const started = performance.now();
  const third = await suggest('York', { language: 'en' });
  assert.ok(performance.now() - started < 15, 'an open circuit answers without waiting on the provider');
  assert.equal(third.choices[0].title, 'York');
  assert.equal(provider.calls.length, 2, 'no query reaches the provider while the circuit is open');
  assert.deepEqual(await suggest('Nowhereville', { language: 'en' }), { status: 'unavailable', choices: [], retryable: false }, 'without a register match the reader learns that a retry cannot help');
});

test('after the cooldown one query probes in the background, and a healthy answer closes the circuit', async () => {
  let clock = 0;
  const provider = photon(call => (call <= 2 ? 503 : [feature('Malmö', 1)]));
  const suggest = createPlaceSuggestions({ fetcher: provider.fetcher, now: () => clock, minIntervalMs: 0, timeoutMs: 200, offlinePlaces: offline() });
  await suggest('Malmo', { language: 'sv' });
  await suggest('Malmoe', { language: 'sv' });
  assert.equal(provider.calls.length, 2);
  clock += 31000;
  const probe = await suggest('Malmö', { language: 'sv' });
  assert.equal(probe.choices[0].candidate.provenance, 'geonames', 'the probe’s reader does not wait on it');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(provider.calls.length, 3, 'exactly one probe');
  const healthy = await suggest('Malm', { language: 'sv' });
  assert.equal(healthy.choices[0].candidate.provenance, 'photon_osm');
  assert.equal(provider.calls.length, 4);
});

test('a reader’s own retry asks the provider even while the circuit rests', async () => {
  const provider = photon(call => (call <= 2 ? 503 : [feature('Malmö', 1)]));
  const suggest = createPlaceSuggestions({ fetcher: provider.fetcher, minIntervalMs: 0, offlinePlaces: offline() });
  await suggest('Malmo', {});
  await suggest('Malmoe', {});
  assert.equal((await suggest('Malm', {})).choices[0].candidate.provenance, 'geonames');
  assert.equal(provider.calls.length, 2, 'an automatic lookup does not reach a resting provider');
  const retried = await suggest('Malm', { explicit: true });
  assert.equal(retried.choices[0].candidate.provenance, 'photon_osm');
  assert.equal(provider.calls.length, 3);
  assert.equal((await suggest('Malmö', {})).choices[0].candidate.provenance, 'photon_osm', 'its healthy answer closes the circuit');
});

test('an earlier answer to the same query outranks the register, within its age limit', async () => {
  let clock = 0;
  const provider = photon(call => (call === 1 ? [feature('Malmö', 1)] : 503));
  const suggest = createPlaceSuggestions({ fetcher: provider.fetcher, now: () => clock, minIntervalMs: 0, timeoutMs: 200, offlinePlaces: offline() });
  assert.equal((await suggest('Malmö', { language: 'sv' })).choices[0].candidate.provenance, 'photon_osm');
  clock += 2 * 60 * 60 * 1000;
  const stale = await suggest('Malmö', { language: 'sv' });
  assert.equal(stale.choices[0].candidate.osm_ref, 'relation/1', 'the provider’s own earlier answer, bounds and identity included');
  clock += 8 * 24 * 60 * 60 * 1000;
  assert.equal((await suggest('Malmö', { language: 'sv' })).choices[0].candidate.provenance, 'geonames');
});

test('a healthy empty answer, a busy provider and a reader who moves on are never replaced or counted', async () => {
  const empty = photon(() => []);
  const quiet = createPlaceSuggestions({ fetcher: empty.fetcher, minIntervalMs: 0, offlinePlaces: offline() });
  assert.deepEqual(await quiet('Malmö', {}), { status: 'ready', choices: [] }, 'no register rows over the provider’s own empty answer');
  const busy = photon(() => 429);
  assert.equal((await createPlaceSuggestions({ fetcher: busy.fetcher, minIntervalMs: 0, offlinePlaces: offline() })('Malmö', {})).status, 'busy');
  const hung = photon(call => (call <= 3 ? 'hang' : [feature('Malmö', 1)]));
  const suggest = createPlaceSuggestions({ fetcher: hung.fetcher, minIntervalMs: 0, timeoutMs: 1000, offlinePlaces: offline() });
  for (const query of ['Mal', 'Malm', 'Malmö']) {
    const controller = new AbortController();
    const pending = suggest(query, { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort();
    assert.deepEqual(await pending, { status: 'unavailable', choices: [] });
  }
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await suggest('Malmö stad', {})).choices[0].candidate.provenance, 'photon_osm', 'cancelled lookups did not open the circuit');
});

test('the API issues receipts for register rows, and a chosen row anchors a day without another geocode', async () => {
  const store = createPlaceSelectionStore();
  let geocodes = 0;
  const app = buildApp({
    placeSuggestions: createPlaceSuggestions({ fetcher: photon(() => 503).fetcher, minIntervalMs: 0, offlinePlaces: offline() }),
    placeSelectionStore: store, placeResolver: async () => { geocodes++; return []; }, openDataLoader: null, eventSupply: null, weatherProvider: async () => null,
  });
  const server = app.listen(0);
  try {
    const out = await requestJson(server, { path: '/api/place-suggestions?lang=sv', body: { query: 'Köpen' } });
    assert.equal(out.body.status, 'ready');
    const [row] = out.body.choices;
    assert.deepEqual([row.title, row.context, row.kind, row.attribution, row.license, row.place_ref], ['Copenhagen', 'Capital Region · Danmark', 'settlement', 'GeoNames', 'CC-BY-4.0', undefined]);
    assert.equal(store.read(row.selection_id, row.query).timezone, 'Europe/Copenhagen');
    const day = await requestJson(server, { path: '/api/blitz?anywhere_blitz=1', body: { place: row.query, place_selection: row.selection_id } });
    assert.equal(day.body.intake.resolved.label, row.query);
    assert.equal(geocodes, 0);
    await requestJson(server, { path: '/api/place-suggestions?lang=sv', body: { query: 'Malmo' } });
    const nothing = await requestJson(server, { path: '/api/place-suggestions?lang=sv', body: { query: 'Nowhereville' } });
    assert.deepEqual(nothing.body, { status: 'unavailable', choices: [], retryable: false });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('the default provider finds the register in the cache directory, and only there', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-register-'));
  try {
    assert.equal(typeof resolveDefaultPlaceSuggestions({ PARRANDA_CACHE_DIR: dir }), 'function');
    assert.equal(fs.readdirSync(dir).length, 0, 'nothing is fetched or written at startup');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
