'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPlaceMedia, getPlaceMedia, setPlaceMediaForTests } = require('../server/place-media');
const { createWikimediaClient } = require('../server/place-media/wikimedia-client');
const {
  hydratePlaceMedia, isAttestedStopMedia, isAttestedStopMediaObject, resetAttestationForTests, matchers,
} = require('../server/place-media/hydrate');
const { createFixtureFetcher, clone } = require('./helpers/place-media-fixtures');

const MEDELHAVS = {
  id: 'osm-node-304609719', label: 'Medelhavsmuseet', lat: 59.3294531, lng: 18.0672982, type: 'museum', tags: ['museums'],
  is_live_event: false, event_id: null,
  provenance: { attribution: [
    { provider_id: 'osm', label: 'osm', source_family: 'map', url: 'https://www.openstreetmap.org/node/304609719' },
    { provider_id: 'wikidata', label: 'wikidata', source_family: 'open_knowledge', url: 'https://www.wikidata.org/wiki/Q1331646' },
  ] },
};
const TIDEMANS = { id: 'osm-node-360757854', label: 'Tidemans', lat: 59.3335675, lng: 18.0776856, type: 'cafe', tags: ['coffee'],
  is_live_event: false, provenance: { attribution: [{ url: 'https://www.openstreetmap.org/node/360757854' }] } };
const LIVE = { id: 'live-1', label: 'Konsert på Röhsska', lat: 57.699984, lng: 11.9735149, type: 'event', is_live_event: true,
  event_id: 'e1', provenance: { attribution: [{ url: 'https://www.wikidata.org/wiki/Q3107443' }] } };
const VALVET = { id: 'osm-node-1029436340', label: 'Valvet', lat: 55.7083041, lng: 13.1958386, type: 'restaurant',
  is_live_event: false, provenance: { attribution: [{ url: 'https://www.wikidata.org/wiki/Q60970028' }] } };

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-media-hydrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A service whose index already holds records fetched (offline) from the fixtures. */
async function seededService(t, qids, { mutate } = {}) {
  const dir = tempDir(t);
  const { fetcher } = createFixtureFetcher();
  const records = await createWikimediaClient({ fetcher, clock: () => Date.parse('2026-11-24T10:00:00Z') }).fetchRecords(qids);
  const lines = [...records.values()].map(record => JSON.stringify(mutate ? mutate(clone(record)) : record)).join('\n');
  fs.writeFileSync(path.join(dir, 'index-v1.jsonl'), `${lines}\n`);
  const calls = [];
  const service = createPlaceMedia({ dir, fetcher: async (...args) => { calls.push(args[0]); return fetcher(...args); } });
  return { service, dir, calls };
}

test('a gated stop gets wikidata_id, photo, kicker and excerpt in the request language', async t => {
  resetAttestationForTests();
  const { service, calls } = await seededService(t, ['Q1331646']);
  const route = { main_stops: [clone(MEDELHAVS), clone(TIDEMANS)] };
  await hydratePlaceMedia(route, { lang: 'en', placeMedia: service });
  const [stop, cafe] = route.main_stops;
  assert.equal(stop.wikidata_id, 'Q1331646');
  const photo = service.peek('Q1331646').photo;
  assert.deepEqual(stop.media, {
    version: 1, kind: 'photo', media_id: photo.media_id, width: 1780, height: photo.height, subject_qid: 'Q1331646', via: 'p18',
    author: 'Holger Ellgaard', license: 'CC-BY-SA-3.0', license_url: 'https://creativecommons.org/licenses/by-sa/3.0/',
    file_page_url: 'https://commons.wikimedia.org/wiki/File:Medelhavsmuseet_2007.jpg', modified: 'cropped', checked_on: '2026-11-24',
  });
  assert.deepEqual(stop.subtitle, { text: 'museum in Stockholm, Sweden', lang: 'en', subject_qid: 'Q1331646', source: 'wikidata' });
  assert.equal(stop.about.version, 1);
  assert.equal(stop.about.kind, 'excerpt');
  assert.equal(stop.about.lang, 'en');
  assert.equal(stop.about.subject_qid, 'Q1331646');
  assert.equal(stop.about.license, 'CC-BY-SA-4.0');
  assert.equal(stop.about.article_title, 'Medelhavsmuseet');
  assert.match(stop.about.article_url, /^https:\/\/en\.wikipedia\.org\/w\/index\.php\?oldid=\d+$/);
  assert.ok(matchers.wikipediaPermalink(stop.about.article_url));
  assert.ok(matchers.aboutText(stop.about.text));
  assert.deepEqual(cafe, TIDEMANS, 'a stop without a QID is untouched');
  assert.equal(calls.length, 0, 'indexed records need no upstream call');
  assert.equal(service.health().gate_passed, 1);

  const sv = { main_stops: [clone(MEDELHAVS)] };
  await hydratePlaceMedia(sv, { lang: 'sv', placeMedia: service });
  assert.equal(sv.main_stops[0].about.lang, 'sv');
  assert.equal(sv.main_stops[0].subtitle.text, 'museum i Stockholm');
});

test('an English excerpt reaches Swedish readers (behind a button); never the other way', async t => {
  const { service: onlyEn } = await seededService(t, ['Q1331646'], { mutate: r => { delete r.about.sv; return r; } });
  const sv = { main_stops: [clone(MEDELHAVS)] };
  await hydratePlaceMedia(sv, { lang: 'sv', placeMedia: onlyEn });
  assert.equal(sv.main_stops[0].about.lang, 'en');
  const { service: onlySv } = await seededService(t, ['Q1331646'], { mutate: r => { delete r.about.en; return r; } });
  const en = { main_stops: [clone(MEDELHAVS)] };
  await hydratePlaceMedia(en, { lang: 'en', placeMedia: onlySv });
  assert.equal(en.main_stops[0].about, undefined);
  assert.ok(en.main_stops[0].media);
});

test('the wait budget is respected with a slow upstream; the record lands for the next view', async t => {
  const dir = tempDir(t);
  const { fetcher, calls } = createFixtureFetcher({ delayMs: 150 });
  const service = createPlaceMedia({ dir, fetcher, waitMs: 40 });
  const route = { main_stops: [clone(MEDELHAVS)] };
  const started = Date.now();
  await hydratePlaceMedia(route, { lang: 'en', placeMedia: service });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 140, `waited ${elapsed} ms, budget 40 ms`);
  assert.deepEqual(route.main_stops[0], MEDELHAVS, 'no media yet, stop unchanged');
  // The fetch continues in the background and is persisted.
  await service.ensure(['Q1331646']);
  await service.flush();
  assert.ok(service.peek('Q1331646').photo);
  const learned = fs.readFileSync(path.join(dir, 'learned-v1.jsonl'), 'utf8').trim().split('\n');
  assert.equal(learned.length, 1);
  const before = calls.length;
  const again = { main_stops: [clone(MEDELHAVS)] };
  await hydratePlaceMedia(again, { lang: 'en', placeMedia: service });
  assert.ok(again.main_stops[0].media);
  assert.equal(calls.length, before, 'second view needs no upstream call');
  // An explicit zero budget never waits but still starts the lookup.
  const cold = createPlaceMedia({ dir: tempDir(t), fetcher: createFixtureFetcher({ delayMs: 50 }).fetcher });
  const t0 = Date.now();
  await hydratePlaceMedia({ main_stops: [clone(MEDELHAVS)] }, { placeMedia: cold, waitMs: 0 });
  assert.ok(Date.now() - t0 < 40);
  await cold.ensure(['Q1331646']);
  assert.ok(cold.peek('Q1331646'));
});

test('a fast upstream within the budget gives a first view its photo', async t => {
  const service = createPlaceMedia({ dir: tempDir(t), fetcher: createFixtureFetcher().fetcher, waitMs: 1500 });
  const route = { main_stops: [clone(MEDELHAVS)] };
  await hydratePlaceMedia(route, { lang: 'en', placeMedia: service });
  assert.ok(route.main_stops[0].media);
});

test('live-event stops are skipped: no lookup, no media', async t => {
  const { fetcher, calls } = createFixtureFetcher();
  const service = createPlaceMedia({ dir: tempDir(t), fetcher });
  const route = { main_stops: [clone(LIVE)] };
  await hydratePlaceMedia(route, { lang: 'en', placeMedia: service });
  assert.deepEqual(route.main_stops[0], LIVE);
  assert.equal(calls.length, 0);
});

test('two stops of one day with the same QID both go without media', async t => {
  const { service } = await seededService(t, ['Q1331646']);
  const twin = { ...clone(MEDELHAVS), id: 'osm-node-999', label: 'Medelhavsmuseet' };
  const route = { main_stops: [clone(MEDELHAVS), twin] };
  await hydratePlaceMedia(route, { lang: 'en', placeMedia: service });
  assert.equal(route.main_stops[0].media, undefined);
  assert.equal(route.main_stops[1].wikidata_id, undefined);
  assert.equal(service.health().gate.ambiguous, 2);
});

test('a curated visit note wins over the excerpt; the photo still shows', async t => {
  const { service } = await seededService(t, ['Q1331646']);
  const visit = { version: 1, text: { sv: 'Kuraterad text.', en: 'Curated text.' }, source_url: 'https://example.org/x', checked_on: '2026-11-01' };
  const route = { main_stops: [{ ...clone(MEDELHAVS), visit_content: visit }] };
  await hydratePlaceMedia(route, { lang: 'en', placeMedia: service });
  assert.equal(route.main_stops[0].about, undefined);
  assert.ok(route.main_stops[0].media);
  assert.deepEqual(route.main_stops[0].visit_content, visit);
});

test('a stop that fails the entity gate gets nothing (Valvet restaurant vs building)', async t => {
  const { service } = await seededService(t, ['Q60970028']);
  const route = { main_stops: [clone(VALVET)] };
  await hydratePlaceMedia(route, { lang: 'sv', placeMedia: service });
  assert.deepEqual(route.main_stops[0], VALVET);
  assert.equal(service.health().gate.venue_class, 1);
});

test('feature off: the route is unchanged (deep-equal)', async () => {
  const route = { main_stops: [clone(MEDELHAVS), clone(TIDEMANS), clone(LIVE)], other: { x: 1 } };
  const before = clone(route);
  const stops = route.main_stops;
  await hydratePlaceMedia(route, { lang: 'sv', placeMedia: null });
  assert.deepEqual(route, before);
  assert.equal(route.main_stops, stops, 'not even a new array');
  // Through the env singleton: unset env means off.
  const saved = process.env.PARRANDA_PLACE_MEDIA_DIR;
  delete process.env.PARRANDA_PLACE_MEDIA_DIR;
  setPlaceMediaForTests(undefined);
  try {
    assert.equal(getPlaceMedia(), null);
    await hydratePlaceMedia(route, { lang: 'sv' });
    assert.deepEqual(route, before);
  } finally {
    if (saved !== undefined) process.env.PARRANDA_PLACE_MEDIA_DIR = saved;
  }
  assert.equal(await hydratePlaceMedia(null, { placeMedia: null }), null);
});

test('request-supplied media fields never survive hydration', async t => {
  const forged = { ...clone(MEDELHAVS), wikidata_id: 'Q1', media: { version: 1, kind: 'photo', media_id: 'a'.repeat(40) }, about: { text: 'x' } };
  const off = { main_stops: [clone(forged)] };
  await hydratePlaceMedia(off, { placeMedia: null });
  assert.deepEqual(off.main_stops[0], MEDELHAVS);
  const { service } = await seededService(t, ['Q1331646']);
  const on = { main_stops: [clone(forged)] };
  await hydratePlaceMedia(on, { lang: 'en', placeMedia: service });
  assert.equal(on.main_stops[0].wikidata_id, 'Q1331646');
  assert.notEqual(on.main_stops[0].media.media_id, 'a'.repeat(40));
});

test('produced objects are attested; forged or re-pointed ones are not', async t => {
  resetAttestationForTests();
  const { service } = await seededService(t, ['Q1331646']);
  const route = { main_stops: [clone(MEDELHAVS)] };
  await hydratePlaceMedia(route, { lang: 'en', placeMedia: service });
  const stop = route.main_stops[0];
  assert.equal(isAttestedStopMedia(stop, { placeMedia: null }), true, 'registry alone');
  assert.equal(isAttestedStopMedia({ ...stop, media: { ...stop.media, author: 'Someone Else' } }, { placeMedia: null }), false);
  assert.equal(isAttestedStopMedia({ ...stop, about: { ...stop.about, text: `${stop.about.text} Extra.` } }, { placeMedia: null }), false);
  assert.equal(isAttestedStopMedia({ ...stop, wikidata_id: 'Q3107443' }, { placeMedia: null }), false, 'subject_qid ≠ wikidata_id');
  assert.equal(isAttestedStopMedia({ ...stop, wikidata_id: 'not-a-qid' }, { placeMedia: null }), false);
  assert.equal(isAttestedStopMediaObject('subtitle', stop, { placeMedia: null }), true);
  assert.equal(isAttestedStopMedia(MEDELHAVS), true, 'a stop without media has nothing to attest');
  // After a restart the registry is empty; the current record re-derives the same objects.
  resetAttestationForTests();
  assert.equal(isAttestedStopMedia(stop, { placeMedia: null }), false);
  assert.equal(isAttestedStopMedia(stop, { placeMedia: service }), true);
  // Re-derivation still runs the entity gate for the published stop.
  assert.equal(isAttestedStopMedia({ ...stop, lat: stop.lat + 0.01 }, { placeMedia: service }), false);
});

test('schema matchers', () => {
  assert.ok(matchers.qid('Q1331646'));
  assert.equal(matchers.qid('Q0'), false);
  assert.ok(matchers.mediaId('0123456789abcdef0123456789abcdef01234567'));
  assert.equal(matchers.mediaId('../etc/passwd'), false);
  assert.ok(matchers.commonsFilePageUrl('https://commons.wikimedia.org/wiki/File:Medelhavsmuseet_2007.jpg'));
  assert.equal(matchers.commonsFilePageUrl('https://commons.wikimedia.org/wiki/File:X.jpg?action=raw'), false);
  assert.ok(matchers.wikipediaPermalink('https://sv.wikipedia.org/w/index.php?oldid=59023844'));
  assert.equal(matchers.wikipediaPermalink('https://de.wikipedia.org/w/index.php?oldid=1'), false);
  assert.ok(matchers.ccLicenseUrl('https://creativecommons.org/licenses/by-sa/3.0/de/deed.en'));
  assert.ok(matchers.ccLicenseUrl('https://creativecommons.org/licenses/by/4.0/', 'CC-BY-4.0'));
  assert.equal(matchers.ccLicenseUrl('https://creativecommons.org/licenses/by/4.0/', 'CC-BY-SA-4.0'), false);
  assert.ok(matchers.creditText('Holger Ellgaard'));
  assert.equal(matchers.creditText('https://x'), false);
  assert.ok(matchers.subtitleText('museum i Stockholm'));
  assert.equal(matchers.subtitleText('x'.repeat(81)), false);
});

test('a branch whose OSM wikidata tag is its brand:wikidata gets no media, through the loader and the engine stop', async t => {
  // Review 2026-11-25: the build skips such elements, so at runtime the brand
  // QID is an index miss fetched on demand; a venue P31 without a chain class
  // (here the museum fixture) must still not give the branch the brand's photo.
  const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
  const { mapAdmittedSelectionToSourceCandidates } = require('../server/planner/agnostic-engine-compose');
  const element = { type: 'node', id: 304609719, lat: 59.3294531, lon: 18.0672982,
    tags: { name: 'Medelhavsmuseet', tourism: 'museum', wikidata: 'Q1331646', 'brand:wikidata': 'Q1331646' } };
  const toStop = record => {
    // The role selector's rich candidate (formatRoleCandidate) under the engine's experiment seam.
    const rich = { candidate_id: record.id, label: record.name, type: record.type, candidate_kind: 'draft_place',
      confidence: 'needs_review', coordinates: { lat: record.lat, lng: record.lng },
      provenance: { provider_id: 'overpass', source_family: 'openstreetmap', source_tier: 'inferred', human_verified: false,
        attribution: record.sources, corroborated_by_external: false },
      local_feel_rank: record.chain ? 2 : 0, chain: record.chain === true, brand: record.brand };
    const [stop] = mapAdmittedSelectionToSourceCandidates({
      selected: [{ role: 'culture_anchor', candidate_id: record.id, label: record.name, coordinates: rich.coordinates }],
      plannerRoles: { city: 'agnostic-engine-area', roles: [{ role: 'culture_anchor', slot: 'anchor', candidates: [rich] }] },
    });
    return { ...stop, label: record.name };
  };
  const branded = mapOsmElement(element);
  assert.equal(branded.chain, true);
  const { service } = await seededService(t, ['Q1331646']);
  const chainRoute = { main_stops: [toStop(branded)] };
  await hydratePlaceMedia(chainRoute, { lang: 'sv', placeMedia: service });
  assert.equal(chainRoute.main_stops[0].media, undefined, 'no brand photo on the branch');
  assert.equal(chainRoute.main_stops[0].wikidata_id, undefined);
  assert.equal(service.health().gate.brand, 1);
  // The same element without the brand tag is the place itself and gets its photo.
  const own = mapOsmElement({ ...element, tags: { name: 'Medelhavsmuseet', tourism: 'museum', wikidata: 'Q1331646' } });
  const ownRoute = { main_stops: [toStop(own)] };
  await hydratePlaceMedia(ownRoute, { lang: 'sv', placeMedia: service });
  assert.equal(ownRoute.main_stops[0].wikidata_id, 'Q1331646');
  assert.ok(ownRoute.main_stops[0].media);
});
