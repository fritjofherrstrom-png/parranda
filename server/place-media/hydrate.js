'use strict';

// Hydration of place media onto a finished route (docs/PLACE_MEDIA.md,
// "Hydration"). Display only: it never changes which stops a day has or their
// order. Runs after hydrateVisitContent; a curated visit note wins over an
// excerpt. Every object it produces is attested so the published-day schema
// can tell our objects from forged ones.

const { getPlaceMedia } = require('./index');
const {
  stopMediaQid, gateEntityForStop, dropAmbiguous, normalizeName, isVenueStop, stopName,
} = require('./entity-gate');
const {
  isQid, isMediaId, isCommonsFilePageUrl, isAuthor, isExcerptText, isSubtitleText, isArticleTitle, isIsoDate,
} = require('./record');
const {
  WIKIPEDIA_TEXT_LICENSE, MEDIA_LICENSE_IDS, isMediaLicenseId, isMediaLicenseUrl,
} = require('../../shared/media-licenses.mjs');

const MEDIA_FIELDS = ['wikidata_id', 'media', 'subtitle', 'about'];
const LANGS = ['sv', 'en'];
const MAX_ATTESTED = 10000;
const MAX_VALUES_PER_KEY = 4;

function requestLang(lang) {
  return typeof lang === 'string' && lang.trim().toLowerCase().startsWith('sv') ? 'sv' : 'en';
}

// ---------- object builders (pure; also used to re-derive for attestation) ----------

function buildStopMedia(stop, record) {
  const photo = record?.photo;
  if (!photo) return null;
  // P5775 (interior image) only ever illustrates a venue stop.
  if (photo.via === 'p5775' && !isVenueStop(stop)) return null;
  return {
    version: 1, kind: 'photo', media_id: photo.media_id, width: photo.width, height: photo.height,
    subject_qid: record.qid, via: photo.via, author: photo.author, license: photo.license,
    license_url: photo.license_url ?? null, file_page_url: photo.file_page_url, modified: 'cropped',
    checked_on: record.checked_on,
  };
}

/** A Wikidata description earns a kicker only when it says more than the stop's type or name. */
function subtitleAddsToCategory(text, stop) {
  const norm = normalizeName(text);
  if (!norm || norm.split(' ').length < 2) return false;
  const type = normalizeName(String(stop?.type || '').replace(/[-_]+/g, ' '));
  if (type && norm === type) return false;
  if (norm === normalizeName(stopName(stop))) return false;
  return true;
}

function buildStopSubtitle(stop, record, lang) {
  const text = record?.subtitle?.[lang];
  if (!text || !subtitleAddsToCategory(text, stop)) return null;
  return { text, lang, subject_qid: record.qid, source: 'wikidata' };
}

function buildStopAbout(stop, record, lang) {
  if (stop?.visit_content) return null;
  // The request language; a Swedish reader may get the English excerpt (the
  // frontend keeps it behind "Visa beskrivningen på engelska"). Never translated.
  const excerpt = record?.about?.[lang] || (lang === 'sv' ? record?.about?.en : null);
  if (!excerpt) return null;
  return {
    version: 1, kind: 'excerpt', text: excerpt.text, lang: excerpt.lang, subject_qid: record.qid,
    article_url: `https://${excerpt.lang}.wikipedia.org/w/index.php?oldid=${excerpt.rev}`,
    article_title: excerpt.title, license: WIKIPEDIA_TEXT_LICENSE, checked_on: record.checked_on,
  };
}

// ---------- attestation ----------

const attested = new Map();

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function attestKey(kind, value) {
  if (kind === 'media') return `${value?.subject_qid}|${value?.media_id}|`;
  return `${value?.subject_qid}|${kind}|${value?.lang}`;
}

function remember(kind, value) {
  const key = attestKey(kind, value);
  const values = attested.get(key) || [];
  const text = canonical(value);
  attested.delete(key);
  attested.set(key, [text, ...values.filter(v => v !== text)].slice(0, MAX_VALUES_PER_KEY));
  while (attested.size > MAX_ATTESTED) attested.delete(attested.keys().next().value);
}

/** Registers every media object on a hydrated stop (bounded map keyed by qid|media_id|lang). */
function attestStopMedia(stop) {
  if (!stop || !isQid(stop.wikidata_id)) return;
  if (stop.media) remember('media', stop.media);
  if (stop.subtitle) remember('subtitle', stop.subtitle);
  if (stop.about) remember('about', stop.about);
}

function rederive(kind, stop, placeMedia) {
  const record = placeMedia?.peek?.(stop.wikidata_id);
  if (!record || !gateEntityForStop(stop, record).ok) return null;
  if (kind === 'media') return buildStopMedia(stop, record);
  const lang = stop[kind]?.lang;
  if (kind === 'subtitle') return LANGS.includes(lang) ? buildStopSubtitle(stop, record, lang) : null;
  if (kind === 'about') {
    const excerpt = record.about?.[lang];
    return excerpt ? buildStopAbout(stop, { ...record, about: { [lang]: excerpt } }, lang) : null;
  }
  return null;
}

/**
 * Whether stop[kind] ('media' | 'subtitle' | 'about') is exactly an object
 * this server produced for this stop's wikidata_id. Falls back to re-deriving
 * it from the current record, so attestation survives a restart.
 */
function isAttestedStopMediaObject(kind, stop, { placeMedia } = {}) {
  const value = stop?.[kind];
  if (!value || typeof value !== 'object' || !isQid(stop.wikidata_id) || value.subject_qid !== stop.wikidata_id) return false;
  const text = canonical(value);
  if ((attested.get(attestKey(kind, value)) || []).includes(text)) return true;
  const service = placeMedia === undefined ? getPlaceMedia() : placeMedia;
  const derived = service ? rederive(kind, stop, service) : null;
  return Boolean(derived) && canonical(derived) === text;
}

/** Every media/subtitle/about on the stop is attested and names the stop's wikidata_id. */
function isAttestedStopMedia(stop, options = {}) {
  if (!stop || typeof stop !== 'object') return false;
  const present = ['media', 'subtitle', 'about'].filter(kind => stop[kind] !== undefined && stop[kind] !== null);
  if (stop.wikidata_id !== undefined && stop.wikidata_id !== null && !isQid(stop.wikidata_id)) return false;
  if (!present.length) return true;
  return present.every(kind => isAttestedStopMediaObject(kind, stop, options));
}

function resetAttestationForTests() { attested.clear(); }

// ---------- scalar matchers for the published-day schema ----------

const WIKIPEDIA_PERMALINK = /^https:\/\/(?:sv|en)\.wikipedia\.org\/w\/index\.php\?oldid=[1-9]\d{0,11}$/;
const matchers = Object.freeze({
  qid: isQid,
  mediaId: isMediaId,
  commonsFilePageUrl: isCommonsFilePageUrl,
  wikipediaPermalink: value => typeof value === 'string' && WIKIPEDIA_PERMALINK.test(value),
  ccLicenseUrl: (value, licenseId) => licenseId === undefined
    ? MEDIA_LICENSE_IDS.some(id => id !== 'PD' && isMediaLicenseUrl(id, value))
    : isMediaLicenseUrl(licenseId, value),
  licenseId: isMediaLicenseId,
  creditText: isAuthor,
  aboutText: isExcerptText,
  subtitleText: isSubtitleText,
  articleTitle: isArticleTitle,
  checkedOn: isIsoDate,
  lang: value => LANGS.includes(value),
});

// ---------- hydration ----------

function hasMediaFields(stop) {
  return Boolean(stop) && typeof stop === 'object' && MEDIA_FIELDS.some(key => Object.hasOwn(stop, key));
}
function withoutMediaFields(stop) {
  if (!hasMediaFields(stop)) return stop;
  const clean = { ...stop };
  for (const key of MEDIA_FIELDS) delete clean[key];
  return clean;
}

async function waitWithin(promise, ms) {
  let timer;
  try {
    await Promise.race([
      promise.catch(() => {}),
      new Promise(resolve => { timer = setTimeout(resolve, Math.max(0, ms)); timer.unref?.(); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * hydratePlaceMedia(route, { lang, placeMedia, waitMs }) — adds wikidata_id,
 * media, subtitle and about to gated stops of route.main_stops. With the
 * feature off (no service) the route's stops are left as they are, except that
 * request-supplied media fields are always dropped.
 */
async function hydratePlaceMedia(route, options = {}) {
  if (!route || !Array.isArray(route.main_stops)) return route;
  // Media fields are server-owned: whatever came in with the request goes.
  if (route.main_stops.some(hasMediaFields)) route.main_stops = route.main_stops.map(withoutMediaFields);
  const placeMedia = Object.hasOwn(options, 'placeMedia') ? options.placeMedia : getPlaceMedia();
  if (!placeMedia) return route;
  const lang = requestLang(options.lang);
  const count = reason => placeMedia.countGate?.(reason);

  const candidates = new Map();
  for (const stop of route.main_stops) {
    const qid = stopMediaQid(stop); // null for live-event stops
    if (qid) candidates.set(stop, qid);
  }
  if (!candidates.size) return route;
  const unique = dropAmbiguous(candidates);
  for (const stop of candidates.keys()) if (!unique.has(stop)) count('ambiguous');

  const missing = [...new Set(unique.values())].filter(qid => placeMedia.peek(qid) === undefined);
  if (missing.length) {
    const budget = Number.isFinite(options.waitMs) ? options.waitMs : placeMedia.waitMs;
    const controller = new AbortController();
    const pending = Promise.resolve().then(() => placeMedia.ensure(missing, { signal: controller.signal }));
    if (budget > 0) await waitWithin(pending, budget);
    controller.abort();
    pending.catch(() => {});
  }

  route.main_stops = route.main_stops.map(stop => {
    const qid = unique.get(stop);
    if (!qid) return stop;
    const record = placeMedia.peek(qid);
    if (!record) return stop;
    const gate = gateEntityForStop(stop, record);
    count(gate.ok ? 'passed' : gate.reason);
    if (!gate.ok) return stop;
    const next = { ...stop, wikidata_id: qid };
    const media = buildStopMedia(stop, record);
    const subtitle = buildStopSubtitle(stop, record, lang);
    const about = buildStopAbout(stop, record, lang);
    if (media) next.media = media;
    if (subtitle) next.subtitle = subtitle;
    if (about) next.about = about;
    attestStopMedia(next);
    return next;
  });
  return route;
}

module.exports = {
  hydratePlaceMedia,
  attestStopMedia,
  isAttestedStopMedia,
  isAttestedStopMediaObject,
  buildStopMedia,
  buildStopSubtitle,
  buildStopAbout,
  subtitleAddsToCategory,
  matchers,
  resetAttestationForTests,
  MEDIA_STOP_FIELDS: MEDIA_FIELDS,
};
