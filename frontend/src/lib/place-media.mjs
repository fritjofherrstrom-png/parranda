/**
 * Place media on a stop, as the browser may show it (docs/PLACE_MEDIA.md).
 *
 * The server owns identity, the entity and Commons gates and attestation;
 * these normalizers are the display contract only. They mirror the published
 * schema's scalar rules and refuse a whole object rather than repair it, so a
 * forged or odd object renders as no media at all — never as a half-credit
 * photo or a link we did not check.
 *
 * Images only ever come from our own origin (`/media/c/{media_id}/{w}`); the
 * browser never talks to Wikimedia. Text is shown verbatim, never translated.
 */
import { MEDIA_LICENSES, WIKIPEDIA_TEXT_LICENSE, WIKIDATA_DATA_LICENSE, isMediaLicenseId, isMediaLicenseUrl, mediaLicenseLabel, mediaLicenseNeedsAuthor } from '../../../shared/media-licenses.mjs';
import { isCreditName, isHatnoteText, hasMaintenanceMarker } from '../../../shared/place-media-text.mjs';

/** The widths `/media/c/:media_id/:w` serves. */
export const MEDIA_WIDTHS = Object.freeze([250, 500, 960]);
/** Row tile: 56 px drawn, 250 px requested (sharp up to ~4x). */
export const TILE_WIDTH = 250;
/** Panel figure: 500 px on phones, 960 px from the srcset on wide or dense screens. */
export const PANEL_WIDTH = 500;

const LANGS = ['sv', 'en'];
const VIAS = ['p18', 'p5775', 'osm_commons'];
const QID = /^Q[1-9]\d{0,11}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const COMMONS_FILE_PAGE = /^https:\/\/commons\.wikimedia\.org\/wiki\/File:[^/?#\s"'<>\\]+$/;
const WIKIPEDIA_PERMALINK = /^https:\/\/(sv|en)\.wikipedia\.org\/w\/index\.php\?oldid=[1-9]\d{0,11}$/;

const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const cleanText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max &&
  value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const urlFree = text => !/(?:https?:\/\/|www\.|\/\/[a-z0-9])/i.test(text);

function isoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && !value.startsWith('0000') &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
const isQid = value => typeof value === 'string' && QID.test(value);
const isMediaId = value => typeof value === 'string' && SHA1.test(value);
// No link, no "Unknown author"/"Okänd" placeholder, no bare "[1]" footnote (shared/place-media-text.mjs).
const isAuthor = value => cleanText(value, 200) && isCreditName(value);
const isCommonsFilePageUrl = value => typeof value === 'string' && value.length <= 2048 && COMMONS_FILE_PAGE.test(value);
// Never a hatnote to another article, never a "[källa behövs]" marker.
const isExcerptText = value => cleanText(value, 320) && value.length >= 40 && urlFree(value) && /[.!?…]["'”’»)]?$/.test(value) &&
  !isHatnoteText(value) && !hasMaintenanceMarker(value);
const isSubtitleText = value => cleanText(value, 80) && urlFree(value);
const isArticleTitle = value => cleanText(value, 255) && !/[<>[\]{}|#]/.test(value);
const dimension = (value, min) => Number.isInteger(value) && value >= min && value <= 100000;

/** The stop's attested Wikidata id, or null. Live events never carry media. */
function stopQid(stop) {
  if (!plainObject(stop) || stop.is_live_event) return null;
  return isQid(stop.wikidata_id) ? stop.wikidata_id : null;
}

/** stop.media when it is exactly a well-formed photo object for this stop's QID. */
export function normalizeStopMedia(stop) {
  const qid = stopQid(stop);
  const media = stop?.media;
  if (!qid || !plainObject(media)) return null;
  const { version, kind, media_id, width, height, subject_qid, via, author, license, license_url, file_page_url, modified, checked_on } = media;
  if (version !== 1 || kind !== 'photo' || subject_qid !== qid || !isMediaId(media_id) ||
      !dimension(width, 800) || !dimension(height, 1) || !VIAS.includes(via) ||
      !isMediaLicenseId(license) || !isMediaLicenseUrl(license, license_url ?? null) ||
      !isCommonsFilePageUrl(file_page_url) || modified !== 'cropped' || !isoDate(checked_on)) return null;
  if (author === null || author === undefined ? mediaLicenseNeedsAuthor(license) : !isAuthor(author)) return null;
  return {
    version: 1, kind: 'photo', media_id, width, height, subject_qid, via,
    author: author ?? null, license, license_url: license_url ?? null, file_page_url, modified, checked_on,
  };
}

/** stop.subtitle (a Wikidata description, CC0) when well formed for this stop's QID. */
export function normalizeStopSubtitle(stop) {
  const qid = stopQid(stop);
  const subtitle = stop?.subtitle;
  if (!qid || !plainObject(subtitle)) return null;
  const { text, lang, subject_qid, source } = subtitle;
  if (subject_qid !== qid || source !== 'wikidata' || !LANGS.includes(lang) || !isSubtitleText(text)) return null;
  return { text, lang, subject_qid, source };
}

/**
 * stop.about (a verbatim Wikipedia excerpt, CC BY-SA 4.0) when well formed for
 * this stop's QID. A curated visit note wins: a stop that has one shows no excerpt.
 */
export function normalizeStopAbout(stop) {
  const qid = stopQid(stop);
  const about = stop?.about;
  if (!qid || !plainObject(about) || stop.visit_content) return null;
  const { version, kind, text, lang, subject_qid, article_url, article_title, license, checked_on } = about;
  if (version !== 1 || kind !== 'excerpt' || subject_qid !== qid || !LANGS.includes(lang) || !isExcerptText(text) ||
      typeof article_url !== 'string' || WIKIPEDIA_PERMALINK.exec(article_url)?.[1] !== lang ||
      !isArticleTitle(article_title) || license !== WIKIPEDIA_TEXT_LICENSE || !isoDate(checked_on)) return null;
  return { version: 1, kind: 'excerpt', text, lang, subject_qid, article_url, article_title, license, checked_on };
}

/** Same-origin image URL for a width the media route serves, or null. */
export function mediaSrc(media, w) {
  if (!plainObject(media) || !isMediaId(media.media_id) || !MEDIA_WIDTHS.includes(w)) return null;
  return `/media/c/${media.media_id}/${w}`;
}

/** The panel figure's srcset: 500 and 960, both same-origin. */
export function mediaSrcSet(media) {
  const small = mediaSrc(media, 500);
  const large = mediaSrc(media, 960);
  return small && large ? `${small} 500w, ${large} 960w` : null;
}

/** Whether at least one stop of the day has a photo the page may show. */
export function dayHasPhotos(stops) {
  return Array.isArray(stops) && stops.some(stop => normalizeStopMedia(stop) !== null);
}

/** Whether the day shows any place media at all (photo, kicker or excerpt). */
export function dayHasPlaceMedia(stops) {
  return Array.isArray(stops) && stops.some(stop =>
    normalizeStopMedia(stop) !== null || normalizeStopSubtitle(stop) !== null || normalizeStopAbout(stop) !== null);
}

// ---------- credit strings (sv and en) ----------

const pick = (lang, sv, en) => (lang === 'sv' ? sv : en);

/** "Foto av {name}" / "Photo of {name}". */
export function photoAlt(name, lang) {
  return pick(lang, `Foto av ${name}`, `Photo of ${name}`);
}

/** A licence's short label; public domain is said in the reader's language. */
export function licenseLabel(id, lang) {
  if (id === 'PD') return pick(lang, 'Allmän egendom', 'Public domain');
  return mediaLicenseLabel(id);
}

/** The licence's own (possibly ported) URL, or null: public domain has none. */
function licenseHref(id, url) {
  return id !== 'PD' && isMediaLicenseUrl(id, url) ? url : null;
}

/**
 * The photo credit as parts, each its own link where it has one:
 * `Foto: {author} · {licence} · Wikimedia Commons` (+ "beskuren" when expanded).
 */
export function photoCredit(media, lang) {
  return {
    lead: pick(lang, 'Foto', 'Photo'),
    author: media.author ?? null,
    authorHref: media.file_page_url,
    license: licenseLabel(media.license, lang),
    licenseHref: licenseHref(media.license, media.license_url),
    source: 'Wikimedia Commons',
    sourceHref: media.file_page_url,
    modified: media.modified === 'cropped' ? pick(lang, 'beskuren', 'cropped') : null,
  };
}

/** "svenska"/"engelska" or "Swedish"/"English": the language a text is in, said in the reader's. */
export function textLanguageName(textLang, lang) {
  if (textLang === 'sv') return pick(lang, 'svenska', 'Swedish');
  return pick(lang, 'engelska', 'English');
}

/** `Utdrag ur Wikipedia ({språk}) · CC BY-SA 4.0`, as parts. */
export function excerptCredit(about, lang) {
  return {
    lead: pick(lang, 'Utdrag ur', 'Excerpt from'),
    source: `Wikipedia (${textLanguageName(about.lang, lang)})`,
    sourceHref: about.article_url,
    license: mediaLicenseLabel(WIKIPEDIA_TEXT_LICENSE),
    licenseHref: MEDIA_LICENSES[WIKIPEDIA_TEXT_LICENSE].url,
  };
}

/** The quiet button that reveals an excerpt in the other language. */
export function otherLanguageExcerptLabel(textLang, lang) {
  return textLang === 'en'
    ? pick(lang, 'Visa beskrivningen på engelska', 'Show the description in English')
    : pick(lang, 'Visa beskrivningen på svenska', 'Show the description in Swedish');
}

/** "Platsdata från Wikidata (CC0)" with the CC0 deed. */
export function wikidataCredit(lang) {
  return {
    text: pick(lang, 'Platsdata från Wikidata', 'Place data from Wikidata'),
    href: 'https://www.wikidata.org/',
    license: 'CC0',
    licenseHref: MEDIA_LICENSES[WIKIDATA_DATA_LICENSE].url,
  };
}

/**
 * Every credit the day shows, in route order: one row per stop with its photo
 * and/or excerpt. Stops without either are left out.
 */
export function dayMediaCredits(stops) {
  if (!Array.isArray(stops)) return [];
  const rows = [];
  for (const stop of stops) {
    const media = normalizeStopMedia(stop);
    const about = normalizeStopAbout(stop);
    if (!media && !about) continue;
    const name = String(stop?.label || stop?.name || '').trim();
    if (!name) continue;
    rows.push({ key: `${stop.wikidata_id}:${media?.media_id || ''}:${about?.lang || ''}`, name, media, about });
  }
  return rows;
}
