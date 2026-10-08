'use strict';
// A link's OSM identity (`place_ref`) re-validates the exact chosen place
// through the server's own lookup. No live network: provider rows are fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');
const { createPlaceSelectionStore } = require('../server/place-candidates/place-selection');
const { parsePlaceRef, toPlaceRef } = require('../server/place-candidates/place-ref');
const { resolveAgnosticIntake } = require('../server/planner/agnostic-place-intake');

// Shape recorded from Nominatim /lookup?osm_ids=R5400890&accept-language=sv on 2026-10-08.
const lisbonRow = (name = 'Lissabon', country = 'Portugal') => ({
  osm_type: 'relation', osm_id: 5400890, lat: '38.7077507', lon: '-9.1365919',
  category: 'boundary', type: 'administrative', place_rank: 14, importance: 0.76, addresstype: 'city',
  name, display_name: `${name}, Lisboa, ${country}`,
  address: { city: name, county: 'Lisboa', country, country_code: 'pt' },
  namedetails: { name: 'Lisboa', 'name:en': 'Lisbon', 'name:sv': 'Lissabon' },
  boundingbox: ['38.6913994', '38.7967584', '-9.2298356', '-9.0863328'],
});

function resolverWith(respond) {
  const urls = [];
  const resolver = createNominatimPlaceResolver({
    minIntervalMs: 0,
    sleep: async () => {},
    fetcher: async (url) => {
      const parsed = new URL(url);
      urls.push(parsed);
      return respond(parsed);
    },
  });
  return { resolver, urls };
}
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });

test('the compact identity round-trips and rejects anything that is not an OSM id', () => {
  assert.equal(toPlaceRef('relation/5400890'), 'r5400890');
  assert.equal(toPlaceRef('node/25930131'), 'n25930131');
  assert.deepEqual(parsePlaceRef('r5400890'), { ref: 'r5400890', osmRef: 'relation/5400890', lookupId: 'R5400890' });
  for (const bad of ['R5400890', 'x1', 'r0', 'r', 'r1234567890123', ' r1', { r: 1 }, 5400890, null]) {
    assert.equal(parsePlaceRef(bad), null, String(bad));
  }
});

test('lookup asks the provider for that one identity, in the reader language, and caches the answer', async () => {
  const { resolver, urls } = resolverWith(() => json([lisbonRow()]));
  const first = await resolver.lookupRef('r5400890', { language: 'sv' });
  assert.equal(first.status, 'resolved');
  assert.equal(first.candidate.label, 'Lissabon, Lisboa, Portugal');
  assert.equal(first.candidate.osm_ref, 'relation/5400890');
  assert.equal(first.candidate.provenance, 'nominatim_osm');
  assert.equal(first.candidate.confidence, 'medium');
  assert.equal(urls[0].pathname, '/lookup');
  assert.equal(urls[0].searchParams.get('osm_ids'), 'R5400890');
  assert.equal(urls[0].searchParams.get('accept-language'), 'sv');
  await resolver.lookupRef('r5400890', { language: 'sv' });
  assert.equal(urls.length, 1, 'a second read of the same identity is served from cache');
});

test('a failed read is unavailable, an empty answer is not_found, and a different object is never accepted', async () => {
  assert.equal((await resolverWith(() => json({}, 503)).resolver.lookupRef('r5400890')).status, 'unavailable');
  assert.equal((await resolverWith(() => json([])).resolver.lookupRef('r5400890')).status, 'not_found');
  const other = { ...lisbonRow(), osm_id: 2897141 };
  assert.equal((await resolverWith(() => json([other])).resolver.lookupRef('r5400890')).status, 'not_found');
  const { resolver, urls } = resolverWith(() => json([lisbonRow()]));
  assert.equal((await resolver.lookupRef('lisbon')).status, 'unsupported');
  assert.equal(urls.length, 0, 'a malformed identity never reaches the provider');
});

// --- intake -----------------------------------------------------------------

const lisbon = { label: 'Lissabon, Lisboa, Portugal', lat: 38.7077507, lng: -9.1365919, confidence: 'medium', provenance: 'nominatim_osm', osm_ref: 'relation/5400890' };
const usTown = { label: 'Lisbon, Linn County, Iowa, United States', lat: 41.921, lng: -91.385, confidence: 'medium', provenance: 'nominatim_osm', osm_ref: 'relation/129082' };

function fakeResolver({ lookup = { status: 'resolved', candidate: lisbon }, search = [lisbon, usTown] } = {}) {
  const calls = { lookup: [], search: [] };
  const resolver = async (query, context) => { calls.search.push({ query, context }); return structuredClone(search); };
  resolver.lookupRef = async (ref, context) => { calls.lookup.push({ ref, context }); return structuredClone(lookup); };
  return { resolver, calls };
}

test('a link identity anchors the exact place even when its text is ambiguous, and is echoed for the next link', async () => {
  const store = createPlaceSelectionStore({ secret: Buffer.alloc(32, 1) });
  const { resolver, calls } = fakeResolver();
  const out = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeRef: 'r5400890', placeResolver: resolver, placeSelectionStore: store, placeLanguage: 'sv' });
  assert.deepEqual(out.anchor, { lat: lisbon.lat, lng: lisbon.lng });
  assert.equal(out.intake.status, 'resolved');
  assert.equal(out.intake.resolved.label, 'Lissabon, Lisboa, Portugal');
  assert.equal(out.intake.resolved.place_ref, 'r5400890');
  assert.ok(store.read(out.intake.resolved.selection_id, 'Lisbon'), 'a fresh receipt carries the session on');
  assert.deepEqual(calls.lookup, [{ ref: 'r5400890', context: { language: 'sv' } }]);
  assert.equal(calls.search.length, 0, 'no free-text guess when the identity is confirmed');
});

test('a valid receipt still wins; an expired receipt falls back to the link identity instead of failing', async () => {
  let now = 0;
  const store = createPlaceSelectionStore({ secret: Buffer.alloc(32, 2), now: () => now });
  const receipt = store.issue(lisbon, 'Lisbon');
  const fresh = fakeResolver();
  const kept = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeSelection: receipt, placeRef: 'r5400890', placeResolver: fresh.resolver, placeSelectionStore: store });
  assert.equal(kept.intake.resolved.selection_id, receipt);
  assert.equal(fresh.calls.lookup.length, 0);

  now = 8 * 24 * 60 * 60 * 1000;
  const expired = fakeResolver();
  const rescued = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeSelection: receipt, placeRef: 'r5400890', placeResolver: expired.resolver, placeSelectionStore: store });
  assert.equal(rescued.intake.status, 'resolved');
  assert.equal(rescued.intake.resolved.place_ref, 'r5400890');
  assert.equal(expired.calls.lookup.length, 1);

  const noRef = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeSelection: receipt, placeResolver: expired.resolver, placeSelectionStore: store });
  assert.deepEqual(noRef.intake.blockers, ['place_selection_invalid'], 'without a link identity the old rule holds');
});

test('a failed lookup is confirmed only by the same identity in free text; otherwise the reader chooses', async () => {
  const confirmed = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeRef: 'r5400890', placeResolver: fakeResolver({ lookup: { status: 'unavailable' } }).resolver });
  assert.deepEqual(confirmed.anchor, { lat: lisbon.lat, lng: lisbon.lng });

  const missing = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeRef: 'r5400890', placeResolver: fakeResolver({ lookup: { status: 'unavailable' }, search: [usTown] }).resolver });
  assert.equal(missing.anchor, null);
  assert.deepEqual(missing.intake.blockers, ['place_ref_unavailable']);
  assert.deepEqual(missing.intake.candidates.map((c) => c.place_ref), ['r129082'], 'other places are offered, never picked');

  const gone = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeRef: 'r5400890', placeResolver: fakeResolver({ lookup: { status: 'not_found' } }).resolver });
  assert.equal(gone.anchor, null);
  assert.deepEqual(gone.intake.blockers, ['place_ref_not_found'], 'a vanished identity is never replaced by a namesake');
  assert.equal(gone.intake.candidates.length, 2);

  const forged = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeRef: 'lat=38.7&lng=-9.1', placeResolver: fakeResolver().resolver });
  assert.equal(forged.anchor, null);
  assert.deepEqual(forged.intake.blockers, ['place_ref_unsupported']);
});

test('explicit coordinates keep priority over a link identity, and an absent identity changes nothing', async () => {
  const { resolver, calls } = fakeResolver();
  const coords = await resolveAgnosticIntake({ coords: { lat: 55.6, lng: 13 }, placeQuery: 'Lisbon', placeRef: 'r5400890', placeResolver: resolver });
  assert.deepEqual(coords.anchor, { lat: 55.6, lng: 13 });
  assert.equal(calls.lookup.length, 0);
  const plain = await resolveAgnosticIntake({ placeQuery: 'Lisbon', placeResolver: fakeResolver({ search: [lisbon] }).resolver });
  assert.equal(plain.intake.resolved.place_ref, 'r5400890', 'free-text resolution also names the identity for the next link');
});
