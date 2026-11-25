'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REJECT_CLASSES, VENUE_CLASSES, normalizeName, gateEntityForStop, stopMediaQid, dropAmbiguous, isVenueStop, isNatureStop,
} = require('../server/place-media/entity-gate');
const { recordFromEntity } = require('./helpers/place-media-fixtures');

// Stops in the shape the agnostic route output gives main_stops (QA capture
// 2026-11-24): id, label, lat/lng, type and provenance.attribution URLs.
function stop({ id, label, lat, lng, type, qid, extra = {} }) {
  const attribution = [{ provider_id: 'osm', label: 'osm', source_family: 'map', url: `https://www.openstreetmap.org/${id.replace(/^osm-(node|way)-/, '$1/')}` }];
  if (qid) attribution.push({ provider_id: 'wikidata', label: 'wikidata', source_family: 'open_knowledge', url: `https://www.wikidata.org/wiki/${qid}` });
  return { id, label, lat, lng, type, tags: [], is_live_event: false, event_id: null, provenance: { attribution }, ...extra };
}

// Gold set from the coverage study (review-shots/place-media-20261124): real
// stop coordinates, real Wikidata entities unless marked synthetic.
const GOLD_ACCEPT = [
  { name: 'Medelhavsmuseet (Stockholm)', qid: 'Q1331646',
    stop: stop({ id: 'osm-node-304609719', label: 'Medelhavsmuseet', lat: 59.3294531, lng: 18.0672982, type: 'museum', qid: 'Q1331646' }) },
  { name: 'Gustavianum (Uppsala)', qid: 'Q1506922',
    stop: stop({ id: 'osm-way-32119036', label: 'Gustavianum', lat: 59.8579425, lng: 17.6317236, type: 'museum', qid: 'Q1506922' }) },
  { name: 'Röhsska museet (Gothenburg)', qid: 'Q3107443',
    stop: stop({ id: 'osm-node-1852952439', label: 'Röhsska museet', lat: 57.699984, lng: 11.9735149, type: 'museum', qid: 'Q3107443' }) },
  { name: 'Ørstedsparken (Copenhagen), park within 500 m', qid: 'Q2686981',
    stop: stop({ id: 'osm-way-3098756', label: 'Ørstedsparken', lat: 55.680921, lng: 12.5663335, type: 'park', qid: 'Q2686981' }) },
];

test('gold set: real Swedish museums and a park pass the gate', () => {
  for (const { name, qid, stop: s } of GOLD_ACCEPT) {
    assert.equal(stopMediaQid(s), qid, name);
    assert.deepEqual(gateEntityForStop(s, recordFromEntity(qid)), { ok: true }, name);
  }
});

test('gold set: a bakery matched to its square is refused (Forno Campo de\' Fiori → Campo de\' Fiori)', () => {
  const bakery = stop({ id: 'forno-campo-de-fiori', label: "Forno Campo de' Fiori", lat: 41.8962, lng: 12.472, type: 'bakery', qid: 'Q28303' });
  assert.deepEqual(gateEntityForStop(bakery, recordFromEntity('Q28303')), { ok: false, reason: 'p31_rejected' });
  // Even a same-named "Campo de' Fiori" bakery could never be the square.
  assert.equal(gateEntityForStop({ ...bakery, label: "Campo de' Fiori" }, recordFromEntity('Q28303')).reason, 'p31_rejected');
});

test('gold set: a restaurant matched to its square or bus stop is refused', () => {
  const solferino = stop({ id: 'osm-node-2895936801', label: 'Le Solférino', lat: 48.859329, lng: 2.322665, type: 'restaurant', qid: 'Q56733243' });
  assert.deepEqual(gateEntityForStop(solferino, recordFromEntity('Q56733243')), { ok: false, reason: 'p31_rejected' });
  const wallers = stop({ id: 'osm-node-315981584', label: 'Wallers', lat: 57.6388926, lng: 18.295878, type: 'restaurant', qid: 'Q41660931' });
  assert.deepEqual(gateEntityForStop(wallers, recordFromEntity('Q41660931')), { ok: false, reason: 'p31_rejected' });
});

test('gold set: Valvet restaurant is not the Valvet building (venue gate)', () => {
  const valvet = stop({ id: 'osm-node-1029436340', label: 'Valvet', lat: 55.7083041, lng: 13.1958386, type: 'restaurant', qid: 'Q60970028' });
  // Name and distance (24 m) both fit; only the venue class tells them apart.
  assert.deepEqual(gateEntityForStop(valvet, recordFromEntity('Q60970028')), { ok: false, reason: 'venue_class' });
  // The same building QID is fine for a non-venue stop of that name.
  assert.deepEqual(gateEntityForStop({ ...valvet, type: 'historic-site' }, recordFromEntity('Q60970028')), { ok: true });
  // A real restaurant entity passes the venue gate.
  const restaurant = recordFromEntity('Q60970028', {});
  restaurant.entity = { ...restaurant.entity, p31: ['Q11707'] };
  assert.deepEqual(gateEntityForStop(valvet, restaurant), { ok: true });
});

test('gold set: a brand or chain QID is refused', () => {
  const cafe = stop({ id: 'osm-node-1', label: 'Espresso House', lat: 59.3335, lng: 18.0776, type: 'cafe', qid: 'Q100' });
  // Synthetic chain entity shaped like wbgetentities output.
  const chain = { v: 1, qid: 'Q100', checked_on: '2026-11-24',
    entity: { p31: ['Q76212517'], labels: { sv: 'Espresso House', en: 'Espresso House' }, aliases: [], coord: { lat: 59.3335, lng: 18.0776 } },
    photo: null, subtitle: {}, about: {} };
  assert.deepEqual(gateEntityForStop(cafe, chain), { ok: false, reason: 'brand' });
  for (const p31 of ['Q431289', 'Q507619', 'Q18534542', 'Q4830453']) {
    assert.equal(gateEntityForStop(cafe, { ...chain, entity: { ...chain.entity, p31: ['Q30022', p31] } }).reason, 'brand', p31);
  }
  // A chain stop (OSM brand / brand:wikidata tag) never gets media, even on a venue P31.
  const venue = { ...chain, entity: { ...chain.entity, p31: ['Q30022'] } };
  assert.equal(gateEntityForStop({ ...cafe, chain: true }, venue).reason, 'brand');
  assert.deepEqual(gateEntityForStop(cafe, venue), { ok: true });
});

test('gold set: 御池大橋 is never a sight through a bridge or its street', () => {
  const sight = stop({ id: 'overture-oike', label: '御池大橋', lat: 35.0110263, lng: 135.7716562, type: 'historic-site', qid: 'Q11489180' });
  // The real OSM tag points at Oike Street (a street without a coordinate).
  assert.equal(gateEntityForStop(sight, recordFromEntity('Q11489180')).ok, false);
  const street = recordFromEntity('Q11489180');
  street.entity = { ...street.entity, coord: { lat: 35.0110, lng: 135.7700 } };
  assert.deepEqual(gateEntityForStop(sight, street), { ok: false, reason: 'p31_rejected' });
  // Synthetic bridge item named exactly like the stop, at the stop.
  const bridge = { v: 1, qid: 'Q101', checked_on: '2026-11-24',
    entity: { p31: ['Q12280'], labels: { en: 'Oike Bridge' }, aliases: ['御池大橋'], coord: { lat: 35.01103, lng: 135.77166 } },
    photo: null, subtitle: {}, about: {} };
  assert.deepEqual(gateEntityForStop(sight, bridge), { ok: false, reason: 'p31_rejected' });
});

test('gold set: a same-name item more than 250 m away is refused (Raven Row, 1.46 km)', () => {
  const gallery = stop({ id: 'overture-raven-row', label: 'Raven Row', lat: 51.5191132, lng: -0.0565614, type: 'gallery', qid: 'Q7296420' });
  assert.deepEqual(gateEntityForStop(gallery, recordFromEntity('Q7296420')), { ok: false, reason: 'distance' });
  const museum = recordFromEntity('Q1331646');
  const s = stop({ id: 'osm-node-304609719', label: 'Medelhavsmuseet', lat: 59.3294531, lng: 18.0672982, type: 'museum' });
  // ~300 m north: refused for a museum, allowed for a park-type stop.
  const far = { ...s, lat: s.lat + 0.0027 };
  assert.equal(gateEntityForStop(far, museum).reason, 'distance');
  assert.deepEqual(gateEntityForStop({ ...far, type: 'park' }, museum), { ok: true });
  assert.equal(gateEntityForStop({ ...s, lat: s.lat + 0.0050, type: 'park' }, museum).reason, 'distance');
  assert.equal(gateEntityForStop({ ...s, lat: undefined }, museum).reason, 'distance');
});

test('name gate: only the safe direction, a whole word sequence', () => {
  const nebraska = recordFromEntity('Q955344');
  const s = stop({ id: 'overture-gothenburg-historical', label: 'Gothenburg Historical Museum', lat: 40.9328507, lng: -100.1589766, type: 'museum' });
  // The stop name contains the item's name, never the other way round.
  assert.deepEqual(gateEntityForStop(s, nebraska), { ok: false, reason: 'name' });
  const rohsska = recordFromEntity('Q3107443');
  const base = stop({ id: 'osm-node-1852952439', label: 'Röhsska', lat: 57.699984, lng: 11.9735149, type: 'museum' });
  assert.deepEqual(gateEntityForStop(base, rohsska), { ok: true }, 'label "Röhsska museet" holds "Röhsska" as a word');
  assert.equal(gateEntityForStop({ ...base, label: 'Röhs' }, rohsska).reason, 'name', 'not a word prefix');
  assert.deepEqual(gateEntityForStop({ ...base, label: 'ROHSSKA MUSEET!' }, rohsska), { ok: true }, 'case, diacritics, punctuation');
  assert.equal(gateEntityForStop({ ...base, label: '' }, rohsska).reason, 'name');
});

test('normalizeName folds case, diacritics and punctuation', () => {
  assert.equal(normalizeName("  Forno  Campo de' Fiori "), 'forno campo de fiori');
  assert.equal(normalizeName('Ørstedsparken'), 'orstedsparken');
  assert.equal(normalizeName('Röhsska-museet'), 'rohsska museet');
  assert.equal(normalizeName('Musée de l’Orangerie'), 'musee de l orangerie');
  assert.equal(normalizeName('御池大橋'), '御池大橋');
  assert.equal(normalizeName(null), '');
});

test('missing facts are refused with no_facts', () => {
  const s = GOLD_ACCEPT[0].stop;
  const good = recordFromEntity('Q1331646');
  assert.equal(gateEntityForStop(s, undefined).reason, 'no_facts');
  assert.equal(gateEntityForStop(s, { ...good, entity: null }).reason, 'no_facts');
  assert.equal(gateEntityForStop(s, { ...good, entity: { ...good.entity, p31: [] } }).reason, 'no_facts');
  assert.equal(gateEntityForStop(s, { ...good, entity: { ...good.entity, coord: null } }).reason, 'no_facts');
  assert.equal(gateEntityForStop(s, { ...good, entity: { ...good.entity, aliases: undefined } }).reason, 'no_facts');
});

test('stopMediaQid: wikidata ids first, then one attributed Wikidata URL; never live events', () => {
  assert.equal(stopMediaQid({ id: 'wikidata-Q42' }), 'Q42');
  assert.equal(stopMediaQid({ id: 'osm-node-1', candidate_id: 'wikidata-Q7' }), 'Q7');
  assert.equal(stopMediaQid(GOLD_ACCEPT[2].stop), 'Q3107443');
  assert.equal(stopMediaQid({ ...GOLD_ACCEPT[2].stop, is_live_event: true }), null);
  assert.equal(stopMediaQid({ id: 'osm-node-1', provenance: { attribution: [{ url: 'https://www.openstreetmap.org/node/1' }] } }), null);
  assert.equal(stopMediaQid({ id: 'x', provenance: { attribution: [{ url: 'https://www.wikidata.org/wiki/Q1' }, { url: 'https://www.wikidata.org/wiki/Q2' }] } }), null,
    'two different QIDs attributed: no identity');
  assert.equal(stopMediaQid({ id: 'x', provenance: { attribution: [{ url: 'http://www.wikidata.org/wiki/Q1' }] } }), null);
  assert.equal(stopMediaQid({ id: 'wikidata-Q0' }), null);
});

test('dropAmbiguous removes every stop of a day that shares a QID', () => {
  const a = { id: 'a' }; const b = { id: 'b' }; const c = { id: 'c' };
  const kept = dropAmbiguous(new Map([[a, 'Q1'], [b, 'Q1'], [c, 'Q2']]));
  assert.deepEqual([...kept], [[c, 'Q2']]);
  assert.equal(dropAmbiguous(null).size, 0);
});

test('class lists: brand/chain/settlement/street/transport rejected, venues are venues, never a building', () => {
  for (const q of ['Q5', 'Q515', 'Q3957', 'Q532', 'Q486972', 'Q15284', 'Q56061', 'Q79007', 'Q174782', 'Q953806',
    'Q2175765', 'Q55488', 'Q12280', 'Q123705', 'Q149621', 'Q431289', 'Q507619', 'Q18534542']) assert.ok(REJECT_CLASSES.has(q), q);
  for (const q of ['Q11707', 'Q30022', 'Q187456', 'Q212198', 'Q274393', 'Q213441', 'Q2925872', 'Q131734']) assert.ok(VENUE_CLASSES.has(q), q);
  assert.equal(VENUE_CLASSES.has('Q41176'), false, 'building');
  assert.equal(REJECT_CLASSES.get('Q431289').reason, 'brand');
  assert.equal(REJECT_CLASSES.get('Q174782').reason, 'p31_rejected');
  for (const type of ['cafe', 'restaurant', 'bar', 'rooftop-bar', 'wine-bar', 'vintage-shop', 'bakery', 'market', 'taverna', 'street-food'])
    assert.ok(isVenueStop({ type }), type);
  for (const type of ['museum', 'gallery', 'park', 'viewpoint', 'historic-site', 'castle', 'monument'])
    assert.equal(isVenueStop({ type }), false, type);
});

test('contract class QIDs that name something else never enter the lists', () => {
  // Checked on wikidata.org 2026-11-24: Q11410 is "game", Q1758825 is a list
  // article and Q18534524 does not exist. The real items are used instead.
  for (const q of ['Q11410', 'Q1758825', 'Q18534524']) {
    assert.equal(VENUE_CLASSES.has(q), false, q);
    assert.equal(REJECT_CLASSES.has(q), false, q);
  }
  assert.ok(VENUE_CLASSES.has('Q2925872'), 'second-hand shop');
  assert.ok(REJECT_CLASSES.has('Q18534542'), 'restaurant chain');
});

test('every stop type the planner emits is classed: venues, nature, or neither', () => {
  // Types from open-data-loader OSM_TAG_MAP, overture-source and the catalogs.
  const venues = ['cafe', 'bar', 'restaurant', 'market', 'vintage-shop', 'bakery', 'street-food', 'cocktail-bar'];
  const others = ['museum', 'gallery', 'park', 'garden', 'beach', 'viewpoint', 'promenade', 'castle', 'historic-site',
    'monument', 'lighthouse', 'landmark'];
  for (const type of venues) assert.ok(isVenueStop({ type }), type);
  for (const type of others) assert.equal(isVenueStop({ type }), false, type);
  for (const type of ['park', 'garden', 'beach']) assert.ok(isNatureStop({ type }), type);
  for (const type of ['promenade', 'museum', 'viewpoint', 'cafe']) assert.equal(isNatureStop({ type }), false, type);
});

test('a winery typed "bar" by Overture passes the venue gate as a winery', () => {
  // Synthetic winery entity shaped like wbgetentities output.
  const record = { v: 1, qid: 'Q102', checked_on: '2026-11-24',
    entity: { p31: ['Q156362'], labels: { sv: 'Vingården i Klagshamn' }, aliases: [], coord: { lat: 55.5203, lng: 12.9122 } },
    photo: null, subtitle: {}, about: {} };
  const bar = stop({ id: 'overture-klagshamn', label: 'Vingården i Klagshamn', lat: 55.5204, lng: 12.9121, type: 'bar', qid: 'Q102' });
  assert.deepEqual(gateEntityForStop(bar, record), { ok: true });
  const building = { ...record, entity: { ...record.entity, p31: ['Q41176'] } };
  assert.deepEqual(gateEntityForStop(bar, building), { ok: false, reason: 'venue_class' });
});

test('class lists cannot be changed at runtime', () => {
  assert.throws(() => REJECT_CLASSES.set('Q1', {}), TypeError);
  assert.throws(() => VENUE_CLASSES.delete('Q11707'), TypeError);
  assert.throws(() => VENUE_CLASSES.clear(), TypeError);
  assert.ok(VENUE_CLASSES.has('Q11707'));
});
