'use strict';

// Entity gate for place media (docs/PLACE_MEDIA.md, "Entity gate"). Pure, no
// network. A Wikidata QID earns media for a stop only when the entity is the
// stop itself: right kind of thing, the stop's own name, within walking reach
// of the stop's own coordinate, and — for food, drink and shops — a venue,
// never the building it sits in. Every refusal carries a reason code.

// P31 classes that are never a visitable stop. Direct P31 match only (no
// subclass walk). Class QIDs were checked against wikidata.org labels on
// 2026-11-24; the contract's "Q18534524 restaurant chain" does not exist, the
// real item is Q18534542. Reason `brand` marks brand/chain/company identities
// whose media are a logo, a headquarters or a different branch.
const REJECT_ENTRIES = [
  // brand / chain / company: never the place in front of the reader.
  ['Q431289', 'brand', 'brand'],
  ['Q167270', 'trademark', 'brand'],
  ['Q507619', 'retail chain', 'brand'],
  ['Q18534542', 'restaurant chain', 'brand'],
  ['Q76212517', 'café chain', 'brand'],
  ['Q18509232', 'fast food restaurant chain', 'brand'],
  ['Q18043413', 'supermarket chain', 'brand'],
  ['Q134722156', 'second-hand store chain', 'brand'],
  ['Q120679388', 'cocktail bar chain', 'brand'],
  ['Q42360247', 'brewpub chain', 'brand'],
  ['Q111099898', 'record shop chain', 'brand'],
  // Extension (stricter than the contract list): a company identity is the
  // legal entity, not a venue; its image is a logo or an office.
  ['Q4830453', 'business', 'brand'],
  ['Q783794', 'company', 'brand'],
  ['Q6881511', 'enterprise', 'brand'],
  // people
  ['Q5', 'human', 'p31_rejected'],
  // settlements and administrative areas: a whole town is not a stop.
  ['Q515', 'city', 'p31_rejected'],
  ['Q1549591', 'big city', 'p31_rejected'],
  ['Q5119', 'capital city', 'p31_rejected'],
  ['Q3957', 'town', 'p31_rejected'],
  ['Q532', 'village', 'p31_rejected'],
  ['Q486972', 'human settlement', 'p31_rejected'],
  ['Q17343829', 'unincorporated community', 'p31_rejected'],
  ['Q15284', 'municipality', 'p31_rejected'],
  ['Q56061', 'administrative territorial entity', 'p31_rejected'],
  ['Q6256', 'country', 'p31_rejected'],
  ['Q3624078', 'sovereign state', 'p31_rejected'],
  ['Q82794', 'region', 'p31_rejected'],
  ['Q1907114', 'metropolitan area', 'p31_rejected'],
  // parts of a town
  ['Q123705', 'neighbourhood', 'p31_rejected'],
  ['Q149621', 'district', 'p31_rejected'],
  ['Q2983893', 'quarter', 'p31_rejected'],
  ['Q5195043', 'borough', 'p31_rejected'],
  // streets and squares: a bakery on a square is not the square.
  ['Q79007', 'street', 'p31_rejected'],
  ['Q34442', 'road', 'p31_rejected'],
  ['Q83620', 'thoroughfare', 'p31_rejected'],
  ['Q7543083', 'avenue', 'p31_rejected'],
  ['Q174782', 'square', 'p31_rejected'],
  // transport: a restaurant named after its bus stop is not the bus stop.
  ['Q953806', 'bus stop', 'p31_rejected'],
  ['Q494829', 'bus station', 'p31_rejected'],
  ['Q2175765', 'tram stop', 'p31_rejected'],
  ['Q55488', 'railway station', 'p31_rejected'],
  ['Q55678', 'railway stop', 'p31_rejected'],
  ['Q928830', 'metro station', 'p31_rejected'],
  ['Q12280', 'bridge', 'p31_rejected'],
  // Wikimedia housekeeping items are never places.
  ['Q4167410', 'Wikimedia disambiguation page', 'p31_rejected'],
  ['Q13406463', 'Wikimedia list article', 'p31_rejected'],
  ['Q4167836', 'Wikimedia category', 'p31_rejected'],
];
// Object.freeze does not freeze a Map's entries: block its mutators too, so no
// caller can widen or narrow the gate at runtime.
function readOnlyMap(entries) {
  const map = new Map(entries);
  for (const method of ['set', 'delete', 'clear']) {
    Object.defineProperty(map, method, { value: () => { throw new TypeError('place-media class lists are read-only'); } });
  }
  return Object.freeze(map);
}
const REJECT_CLASSES = readOnlyMap(REJECT_ENTRIES.map(([qid, label, reason]) => [qid, Object.freeze({ label, reason })]));

// P31 classes that are a venue (the business in front of the reader, not the
// building around it). Direct P31 match only. Labels checked on wikidata.org
// (2026-11-24). Two contract QIDs are wrong and deliberately left out: Q11410
// is "game" (not "store") and Q1758825 is "list of Italian composers" (not
// "second-hand shop"; the real item is Q2925872).
const VENUE_ENTRIES = [
  ['Q11707', 'restaurant'], ['Q30022', 'café'], ['Q4236467', 'coffeehouse'], ['Q187456', 'bar'],
  ['Q212198', 'pub'], ['Q274393', 'bakery'], ['Q213441', 'shop'], ['Q57334497', 'retail outlet'],
  ['Q2925872', 'second-hand shop'], ['Q153551', 'charity shop'], ['Q3267025', 'antique shop'],
  ['Q1365056', 'book shop'], ['Q2243978', 'record shop'], ['Q1068824', 'boutique'], ['Q216107', 'department store'],
  ['Q1295201', 'grocery store'], ['Q3231410', 'delicatessen'], ['Q3574069', 'confectionery store'],
  ['Q861651', 'pâtisserie'], ['Q131734', 'brewery'], ['Q3640372', 'brewpub'], ['Q2363097', 'coffee roaster'],
  ['Q1072166', 'tea house'], ['Q1922416', 'wine bar'], ['Q2556304', 'wine tavern'], ['Q30748895', 'cocktail lounge'],
  ['Q154250', 'tavern'], ['Q1193068', 'izakaya'], ['Q5526883', 'gastropub'], ['Q857909', 'beer garden'],
  ['Q858012', 'beer hall'], ['Q1690553', 'trattoria'], ['Q1581509', 'brasserie'], ['Q866742', 'bistro'],
  ['Q1501212', 'pizzeria'], ['Q1751429', 'fast food restaurant'], ['Q1311064', 'ice cream parlor'],
  ['Q27979885', 'sandwich shop'], ['Q622425', 'nightclub'],
  // Overture maps winery and distillery categories to stop type "bar"; like a
  // brewery, the producer is the venue a visitor walks into.
  ['Q156362', 'winery'], ['Q1251750', 'distillery'],
  // One branch of a chain is still that one venue; the brand QID is not.
  ['Q124656585', 'restaurant chain location'],
  // "Granja M. Viader" (Barcelona) is typed only as a commercial establishment.
  ['Q3751865', 'commercial establishment'],
  // Markets: a market venue, never the square (the square is rejected above).
  ['Q330284', 'marketplace'], ['Q132510', 'market'], ['Q2080521', 'market hall'], ['Q385870', 'flea market'],
  ['Q18355750', 'food hall'],
];
const VENUE_CLASSES = readOnlyMap(VENUE_ENTRIES);

// Parranda stop types (server/place-candidates/open-data-loader.js OSM_TAG_MAP,
// overture-source.js, catalog kinds) that are food, drink or shops.
const VENUE_STOP_TYPES = new Set([
  'cafe', 'cafe-bar', 'coffee', 'coffee_shop', 'tea_room', 'bakery', 'restaurant', 'taverna', 'street-food',
  'bar', 'pub', 'rooftop-bar', 'wine-bar', 'cocktail-bar', 'brewery', 'shop', 'vintage-shop', 'second-hand',
  'second_hand', 'bookshop', 'market', 'food-hall', 'ice-cream',
]);
const VENUE_TYPE_PATTERN = /(?:^|[-_])(?:cafe|café|coffee|bakery|restaurant|bistro|taverna|tavern|trattoria|pizzeria|izakaya|food|bar|pub|brewery|wine|shop|store|market|deli)(?:$|[-_])/;
// Large outdoor stops whose Wikidata coordinate can sit far from the gate.
const NATURE_STOP_TYPES = new Set(['park', 'garden', 'beach', 'nature', 'nature-reserve', 'forest', 'botanical-garden']);

const MAX_DISTANCE_M = 250;
const MAX_NATURE_DISTANCE_M = 500;
const QID = /^Q[1-9]\d{0,11}$/;
const WIKIDATA_URL = /^https:\/\/www\.wikidata\.org\/wiki\/(Q[1-9]\d{0,11})$/;

const FOLD = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** lowercase, NFKD, strip diacritics and punctuation, collapse spaces. */
function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '')
    .replace(/[øæœßłđðþı]/g, ch => FOLD[ch])
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

function haversineM(aLat, aLng, bLat, bLng) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function stopType(stop) {
  return typeof stop?.type === 'string' ? stop.type.trim().toLowerCase() : '';
}
function isVenueStop(stop) {
  const type = stopType(stop);
  return Boolean(type) && (VENUE_STOP_TYPES.has(type) || VENUE_TYPE_PATTERN.test(type));
}
function isNatureStop(stop) {
  return NATURE_STOP_TYPES.has(stopType(stop));
}
function stopName(stop) {
  for (const value of [stop?.label, stop?.name]) if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}

/** QID candidate for a stop: its own wikidata id, else an attributed Wikidata URL. */
function stopMediaQid(stop) {
  if (!stop || typeof stop !== 'object' || stop.is_live_event === true) return null;
  for (const id of [stop.id, stop.candidate_id]) {
    const match = typeof id === 'string' ? /^wikidata-(Q[1-9]\d{0,11})$/.exec(id) : null;
    if (match) return match[1];
  }
  const attribution = stop.provenance?.attribution;
  if (!Array.isArray(attribution)) return null;
  const found = new Set();
  for (const row of attribution) {
    const match = typeof row?.url === 'string' ? WIKIDATA_URL.exec(row.url.trim()) : null;
    if (match) found.add(match[1]);
  }
  // Two different QIDs attributed to one stop: no identity to trust.
  return found.size === 1 ? [...found][0] : null;
}

function hasFacts(record) {
  const entity = record?.entity;
  return Boolean(entity) && Array.isArray(entity.p31) && entity.p31.length > 0 &&
    entity.p31.every(q => typeof q === 'string' && QID.test(q)) &&
    entity.labels && typeof entity.labels === 'object' && Array.isArray(entity.aliases) &&
    Number.isFinite(entity.coord?.lat) && Number.isFinite(entity.coord?.lng);
}

function nameMatches(stopNorm, names) {
  if (!stopNorm || stopNorm.length < 2) return false;
  const needle = ` ${stopNorm} `;
  for (const name of names) {
    const norm = normalizeName(name);
    if (!norm) continue;
    // Only the safe direction: the item's name equals the stop name or holds it
    // whole as a word sequence. A stop name that merely contains the item's name
    // ("Forno Campo de' Fiori" vs the square "Campo de' Fiori") never matches.
    if (norm === stopNorm || ` ${norm} `.includes(needle)) return true;
  }
  return false;
}

/** { ok: true } or { ok: false, reason } for one stop and one index record. */
function gateEntityForStop(stop, record) {
  if (!stop || typeof stop !== 'object') return { ok: false, reason: 'no_facts' };
  if (!hasFacts(record)) return { ok: false, reason: 'no_facts' };
  const { entity } = record;
  if (typeof stop.brand_wikidata === 'string' && stop.brand_wikidata.trim() === record.qid) return { ok: false, reason: 'brand' };
  for (const q of entity.p31) {
    const reject = REJECT_CLASSES.get(q);
    if (reject) return { ok: false, reason: reject.reason };
  }
  const names = [...Object.values(entity.labels), ...entity.aliases].filter(v => typeof v === 'string');
  if (!nameMatches(normalizeName(stopName(stop)), names)) return { ok: false, reason: 'name' };
  if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return { ok: false, reason: 'distance' };
  const limit = isNatureStop(stop) ? MAX_NATURE_DISTANCE_M : MAX_DISTANCE_M;
  if (!(haversineM(stop.lat, stop.lng, entity.coord.lat, entity.coord.lng) <= limit)) return { ok: false, reason: 'distance' };
  if (isVenueStop(stop) && !entity.p31.some(q => VENUE_CLASSES.has(q))) return { ok: false, reason: 'venue_class' };
  return { ok: true };
}

/**
 * Same-day ambiguity: a QID claimed by two stops of one day belongs to
 * neither. Takes Map<stop, qid> and returns a new Map without those entries.
 */
function dropAmbiguous(stopQids) {
  const entries = stopQids instanceof Map ? [...stopQids] : [];
  const count = new Map();
  for (const [, qid] of entries) if (qid) count.set(qid, (count.get(qid) || 0) + 1);
  return new Map(entries.filter(([, qid]) => qid && count.get(qid) === 1));
}

const GATE_REASONS = Object.freeze(['brand', 'p31_rejected', 'name', 'distance', 'venue_class', 'ambiguous', 'no_facts']);

module.exports = {
  REJECT_CLASSES,
  VENUE_CLASSES,
  GATE_REASONS,
  MAX_DISTANCE_M,
  MAX_NATURE_DISTANCE_M,
  normalizeName,
  haversineM,
  isVenueStop,
  isNatureStop,
  stopName,
  stopMediaQid,
  gateEntityForStop,
  dropAmbiguous,
};
