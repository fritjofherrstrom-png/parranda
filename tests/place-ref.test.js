'use strict';
// A link's OSM identity (`place_ref`) re-validates the exact chosen place
// through the server's own lookup. Contract: Hermès' reply of 2026-10-08.
// No live network: provider rows are fixtures recorded from Nominatim /lookup.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');
const { createPlaceSelectionStore } = require('../server/place-candidates/place-selection');
const { parsePlaceRef, toPlaceRef, linkRefFor } = require('../server/place-candidates/place-ref');
const { resolveAgnosticIntake } = require('../server/planner/agnostic-place-intake');
const { executeLiveEventQuery } = require('../server/place-candidates/live-event-query');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');

// Shape recorded from /lookup?osm_ids=R5400890&format=jsonv2 on 2026-10-08.
const lisbonRow = (name = 'Lissabon', country = 'Portugal') => ({
  osm_type: 'relation', osm_id: 5400890, lat: '38.7077507', lon: '-9.1365919',
  category: 'boundary', type: 'administrative', place_rank: 14, importance: 0.76, addresstype: 'city',
  name, display_name: `${name}, Lisboa, ${country}`,
  address: { city: name, county: 'Lisboa', country, country_code: 'pt' },
  namedetails: { name: 'Lisboa', 'name:en': 'Lisbon', 'name:sv': 'Lissabon' },
  boundingbox: ['38.6913994', '38.7967584', '-9.2298356', '-9.0863328'],
});
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });

function resolverWith(respond, options = {}) {
  const urls = [];
  const resolver = createNominatimPlaceResolver({
    minIntervalMs: 0,
    sleep: async () => {},
    timeoutMs: 50,
    ...options,
    fetcher: async (url, init) => {
      const parsed = new URL(url);
      urls.push(parsed);
      return respond(parsed, init);
    },
  });
  return { resolver, urls };
}

// --- format -----------------------------------------------------------------

test('the compact identity is validated exactly, never repaired, and converts explicitly', () => {
  assert.equal(toPlaceRef('relation/5400890'), 'r5400890');
  assert.equal(toPlaceRef('node/25930131'), 'n25930131');
  assert.deepEqual(parsePlaceRef('r5400890'), { ref: 'r5400890', osmRef: 'relation/5400890', lookupId: 'R5400890' });
  for (const bad of ['R5400890', 'r5400890\n', ' r5400890', 'r5400890 ', 'x1', 'r0', 'r', 'r1234567890123', 'relation/5400890', { r: 1 }, 5400890, '']) {
    assert.equal(parsePlaceRef(bad), null, JSON.stringify(bad));
  }
  assert.equal(linkRefFor({ osm_ref: 'relation/5400890', osm_class: 'boundary' }), 'r5400890');
  assert.equal(linkRefFor({ osm_ref: 'node/1', osm_class: 'place' }), 'n1');
  assert.equal(linkRefFor({ osm_ref: 'node/2', osm_class: 'amenity' }), null, 'a venue anchors a day but is not linked by identity');
});

// --- lookup -----------------------------------------------------------------

test('lookup asks for that one identity in the reader language and caches the answer', async () => {
  const { resolver, urls } = resolverWith(() => json([lisbonRow()]));
  const first = await resolver.lookupRef('r5400890', { language: 'sv' });
  assert.equal(first.status, 'resolved');
  assert.equal(first.candidate.label, 'Lissabon, Lisboa, Portugal');
  assert.equal(first.candidate.osm_ref, 'relation/5400890');
  assert.equal(first.candidate.osm_class, 'boundary');
  assert.equal(first.candidate.confidence, 'medium', 'an identity never claims more than the automatic ceiling');
  assert.equal(urls[0].pathname, '/lookup');
  assert.equal(urls[0].searchParams.get('osm_ids'), 'R5400890');
  assert.equal(urls[0].searchParams.get('accept-language'), 'sv');
  await resolver.lookupRef('r5400890', { language: 'sv' });
  assert.equal(urls.length, 1);
});

test('invalid, wrong id, unsupported class, empty, 429, timeout and broken JSON stay distinct', async () => {
  const outcome = async (respond, ref = 'r5400890') => (await resolverWith(respond).resolver.lookupRef(ref)).status;
  const { resolver, urls } = resolverWith(() => json([lisbonRow()]));
  assert.equal((await resolver.lookupRef('lisbon')).status, 'invalid');
  assert.equal(urls.length, 0, 'an invalid identity never reaches the provider');
  assert.equal(await outcome(() => json([{ ...lisbonRow(), osm_id: 2897141 }])), 'not_found', 'another object is never accepted');
  assert.equal(await outcome(() => json([{ ...lisbonRow(), category: 'amenity', type: 'theatre' }])), 'unsupported');
  assert.equal(await outcome(() => json([])), 'not_found');
  assert.equal(await outcome(() => json({}, 429)), 'unavailable');
  assert.equal(await outcome(() => json({}, 503)), 'unavailable');
  assert.equal(await outcome(() => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('bad json'); } })), 'unavailable');
  assert.equal(await outcome((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))), 'unavailable');
});

test('a 429 on lookup holds the shared cooldown for the next search too', async () => {
  let now = 0;
  const waits = [];
  const { resolver, urls } = resolverWith(
    (url) => (url.pathname === '/lookup' ? json({}, 429) : json([])),
    { now: () => now, sleep: async (ms) => { waits.push(ms); now += ms; }, providerCooldownMs: 5000 },
  );
  assert.equal((await resolver.lookupRef('r5400890')).status, 'unavailable');
  await resolver('Lisbon');
  assert.ok(waits.some((ms) => ms >= 4000), 'search waited out the cooldown the lookup learned');
  assert.equal(urls.length, 2);
});

// --- intake -----------------------------------------------------------------

const lisbon = { label: 'Lissabon, Lisboa, Portugal', lat: 38.7077507, lng: -9.1365919, confidence: 'medium', provenance: 'nominatim_osm', osm_ref: 'relation/5400890', osm_class: 'boundary' };
const usTown = { label: 'Lisbon, Linn County, Iowa, United States', lat: 41.921, lng: -91.385, confidence: 'medium', provenance: 'nominatim_osm', osm_ref: 'relation/129082', osm_class: 'boundary' };
const store = () => createPlaceSelectionStore({ secret: Buffer.alloc(32, 7) });

function fakeResolver({ lookup = (ref, { language }) => ({ status: 'resolved', candidate: { ...lisbon, label: language === 'en' ? 'Lisbon, Lisboa, Portugal' : lisbon.label } }), search = [lisbon, usTown] } = {}) {
  const calls = { lookup: [], search: [] };
  const resolver = async (query, context) => { calls.search.push({ query, context }); return structuredClone(search); };
  resolver.lookupRef = async (ref, context) => { calls.lookup.push({ ref, context }); return structuredClone(lookup(ref, context)); };
  return { resolver, calls };
}

test('the same identity in sv and en, with an old label, resolves to the same place; language only changes the label', async () => {
  const outs = [];
  for (const [lang, text] of [['sv', 'Lisbon'], ['en', 'Lissabon, Lisboa, Portugal'], ['sv', 'an old label']]) {
    const { resolver, calls } = fakeResolver();
    outs.push(await resolveAgnosticIntake({ placeQuery: text, placeRef: 'r5400890', placeResolver: resolver, placeSelectionStore: store(), placeLanguage: lang }));
    assert.equal(calls.search.length, 0, 'free text never chooses when an identity is present');
  }
  assert.deepEqual(new Set(outs.map((o) => JSON.stringify(o.anchor))).size, 1);
  assert.deepEqual(outs.map((o) => o.intake.resolved.place_ref), ['r5400890', 'r5400890', 'r5400890']);
  assert.deepEqual(outs.map((o) => o.intake.resolved.label), ['Lissabon, Lisboa, Portugal', 'Lisbon, Lisboa, Portugal', 'Lissabon, Lisboa, Portugal']);
});

test('an identity without place text resolves, issues a receipt, and that receipt then serves the identity', async () => {
  const s = store();
  const { resolver, calls } = fakeResolver();
  const first = await resolveAgnosticIntake({ placeRef: 'r5400890', placeResolver: resolver, placeSelectionStore: s });
  assert.equal(first.intake.status, 'resolved');
  assert.equal(first.intake.resolved.place_ref, 'r5400890');
  const receipt = first.intake.resolved.selection_id;
  assert.ok(s.read(receipt));
  const again = await resolveAgnosticIntake({ placeRef: 'r5400890', placeSelection: receipt, placeResolver: resolver, placeSelectionStore: s });
  assert.equal(again.intake.resolved.selection_id, receipt);
  assert.equal(calls.lookup.length, 1, 'the matching receipt is reused without another lookup');
});

test('receipt A with identity B is a conflict; an expired receipt is restored only by verifying the identity', async () => {
  let now = 0;
  const s = createPlaceSelectionStore({ secret: Buffer.alloc(32, 9), now: () => now });
  const receiptForUs = s.issue(usTown, 'Lisbon');
  const conflict = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeSelection: receiptForUs, placeRef: 'r5400890', placeResolver: fakeResolver().resolver, placeSelectionStore: s });
  assert.equal(conflict.anchor, null);
  assert.deepEqual(conflict.intake.blockers, ['place_ref_conflict']);

  const receiptForLisbon = s.issue(lisbon, 'Lisbon');
  now = 8 * 24 * 60 * 60 * 1000;
  const verified = fakeResolver();
  const restored = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeSelection: receiptForLisbon, placeRef: 'r5400890', placeResolver: verified.resolver, placeSelectionStore: s });
  assert.equal(restored.intake.status, 'resolved');
  assert.equal(verified.calls.lookup.length, 1);

  const offline = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeSelection: receiptForLisbon, placeRef: 'r5400890', placeResolver: fakeResolver({ lookup: () => ({ status: 'unavailable' }) }).resolver, placeSelectionStore: s });
  assert.equal(offline.anchor, null, 'an expired receipt never lends its geography');
  assert.deepEqual(offline.intake.blockers, ['place_ref_unavailable']);
});

test('an identity with explicit coordinates is a conflict; coordinates without one keep their priority', async () => {
  const { resolver, calls } = fakeResolver();
  const both = await resolveAgnosticIntake({ coords: { lat: 55.6, lng: 13 }, placeQuery: 'Lisbon', placeRef: 'r5400890', placeResolver: resolver });
  assert.deepEqual(both.intake.blockers, ['place_ref_conflict']);
  assert.equal(calls.lookup.length, 0);
  const coordsOnly = await resolveAgnosticIntake({ coords: { lat: 55.6, lng: 13 }, placeQuery: 'Lisbon', placeResolver: resolver });
  assert.deepEqual(coordsOnly.anchor, { lat: 55.6, lng: 13 });
});

test('no namesake fallback: a failed read searches nothing; a confirmed absence offers choices but picks none', async () => {
  const offline = fakeResolver({ lookup: () => ({ status: 'unavailable' }) });
  const out = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeRef: 'r5400890', placeResolver: offline.resolver });
  assert.deepEqual(out.intake.blockers, ['place_ref_unavailable']);
  assert.equal(offline.calls.search.length, 0, 'no extra provider read during a failure or cooldown');

  const gone = fakeResolver({ lookup: () => ({ status: 'not_found' }), search: [usTown] });
  const absent = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeRef: 'r5400890', placeResolver: gone.resolver, placeSelectionStore: store() });
  assert.equal(absent.anchor, null);
  assert.deepEqual(absent.intake.blockers, ['place_ref_not_found']);
  assert.deepEqual(absent.intake.candidates.map((c) => c.place_ref), ['r129082']);

  for (const [lookup, blocker] of [[{ status: 'unsupported' }, 'place_ref_unsupported']]) {
    const r = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeRef: 'r5400890', placeResolver: fakeResolver({ lookup: () => lookup }).resolver });
    assert.deepEqual(r.intake.blockers, [blocker]);
  }
  const invalid = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeRef: 'r5400890\n', placeResolver: fakeResolver().resolver });
  assert.deepEqual(invalid.intake.blockers, ['place_ref_invalid'], 'a present but malformed identity never falls back to text');
});

test('without an identity the legacy chain is unchanged and only geographic places are echoed for links', async () => {
  const s = store();
  const venue = { label: 'Teatro, Lisboa', lat: 38.71, lng: -9.14, confidence: 'medium', provenance: 'nominatim_osm', osm_ref: 'node/77', osm_class: 'amenity' };
  const city = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeResolver: fakeResolver({ search: [lisbon] }).resolver, placeSelectionStore: s });
  assert.equal(city.intake.resolved.place_ref, 'r5400890');
  const theatre = await resolveAgnosticIntake({ placeQuery: 'Teatro', placeResolver: fakeResolver({ search: [venue] }).resolver, placeSelectionStore: s });
  assert.equal(theatre.intake.status, 'resolved');
  assert.equal('place_ref' in theatre.intake.resolved, false);
  const ambiguous = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeResolver: fakeResolver().resolver, placeSelectionStore: s });
  assert.deepEqual(ambiguous.intake.blockers, ['ambiguous_place']);
  assert.deepEqual(ambiguous.intake.candidates.map((c) => c.place_ref), ['r5400890', 'r129082']);
});

// --- the three endpoints ----------------------------------------------------

test('Planner, anywhere-Blitz and Live each carry the identity through their own trust boundaries', async () => {
  const { resolver, calls } = fakeResolver();
  const s = store();
  const app = buildApp({ placeResolver: resolver, placeSelectionStore: s, openDataLoader: null, eventSupply: null, weatherProvider: async () => null });
  const server = app.listen(0);
  try {
    const planner = await requestJson(server, { path: '/api/route-recommendations', body: { place: 'Lisbon', place_ref: 'r5400890', dates: ['2026-10-08'], day_rhythm: 'balanced', experimental_agnostic_route_output: 1 } });
    assert.equal(planner.body.agnostic_route_output_experiment.intake.resolved.place_ref, 'r5400890');
    const conflict = await requestJson(server, { path: '/api/route-recommendations', body: { place: 'Lisbon', place_ref: 'r5400890', lat: 55.6, lng: 13, dates: ['2026-10-08'], day_rhythm: 'balanced', experimental_agnostic_route_output: 1 } });
    assert.deepEqual(conflict.body.agnostic_route_output_experiment.intake.blockers, ['place_ref_conflict']);
    const blitz = await requestJson(server, { path: '/api/blitz?anywhere_blitz=1', body: { place: 'Lisbon', place_ref: 'r5400890' } });
    assert.equal(blitz.body.intake.resolved.place_ref, 'r5400890');
    assert.equal(calls.search.length, 0);
  } finally {
    await new Promise((r) => server.close(r));
  }

  let collected = 0;
  const eventSupply = async () => { collected++; return { events: [], source_status: [] }; };
  const live = (extra) => executeLiveEventQuery({
    payload: { scope: 'around_place', time: 'this_week', anchor: { lat: lisbon.lat, lng: lisbon.lng }, place_query: 'Lisbon', ...extra },
    eventSupply, placeResolver: resolver, placeSelectionStore: s, now: '2026-10-08T12:00:00Z',
  });
  assert.equal((await live({ place_ref: 'r5400890' })).status, 200);
  assert.equal(collected, 1);
  assert.deepEqual((await live({ place_ref: 'R5400890' })).body, { error: 'place_ref_invalid' });
  const far = await executeLiveEventQuery({
    payload: { scope: 'around_place', anchor: { lat: 55.6, lng: 13 }, place_query: 'Lisbon', place_ref: 'r5400890' },
    eventSupply, placeResolver: resolver, placeSelectionStore: s, now: '2026-10-08T12:00:00Z',
  });
  assert.deepEqual(far.body, { error: 'place_ref_conflict' }, 'an identity never moves or legitimises the collection geometry');
  assert.equal(collected, 1);
});
