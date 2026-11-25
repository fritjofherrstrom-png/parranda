'use strict';

// Shape of one place-media index record (docs/PLACE_MEDIA.md, "Media record").
// Every record read from disk or built from upstream passes normalizeMediaRecord;
// anything malformed is dropped whole, never repaired.

const { isMediaLicenseId, isMediaLicenseUrl, mediaLicenseNeedsAuthor } = require('../../shared/media-licenses.mjs');
const { isCreditName, isHatnoteText, hasMaintenanceMarker } = require('../../shared/place-media-text.mjs');

const QID = /^Q[1-9]\d{0,11}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const LANGS = ['sv', 'en'];
// No Wikipedia page image: it often shows a species or another building. A
// record from an older index that used one is dropped on load and fetched again.
const VIAS = new Set(['p18', 'p5775', 'osm_commons']);
const MAX_SUBTITLE = 80;
const MIN_EXCERPT = 40;
const MAX_EXCERPT = 320;
const MAX_LABEL = 300;
const MAX_ALIASES = 200;

const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const cleanText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max &&
  value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
function isoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && !value.startsWith('0000') &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function isQid(value) { return typeof value === 'string' && QID.test(value); }
function isMediaId(value) { return typeof value === 'string' && SHA1.test(value); }

function isCommonsUploadUrl(value) {
  return typeof value === 'string' && value.length <= 2048 &&
    /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/[^/?#\s]+$/.test(value);
}
function isCommonsFilePageUrl(value) {
  return typeof value === 'string' && value.length <= 2048 &&
    /^https:\/\/commons\.wikimedia\.org\/wiki\/File:[^/?#\s]+$/.test(value);
}
/**
 * The upload URL and the description page must both belong to the titled file:
 * same name, and the upload path is Commons' md5 bucket of that name. A photo
 * never mixes one file's credit with another file's bytes.
 */
function photoFilesAgree(title, fileUrl, pageUrl) {
  if (typeof title !== 'string' || !title.startsWith('File:') || typeof fileUrl !== 'string' || typeof pageUrl !== 'string') return false;
  const name = title.slice(5).replace(/ /g, '_');
  const pagePrefix = 'https://commons.wikimedia.org/wiki/File:';
  if (!name || !pageUrl.startsWith(pagePrefix)) return false;
  let uploadName;
  let pageName;
  try {
    uploadName = decodeURIComponent(fileUrl.slice(fileUrl.lastIndexOf('/') + 1));
    pageName = decodeURIComponent(pageUrl.slice(pagePrefix.length)).replace(/ /g, '_');
  } catch { return false; }
  if (uploadName !== name || pageName !== name) return false;
  const md5 = require('node:crypto').createHash('md5').update(name, 'utf8').digest('hex');
  return fileUrl.startsWith(`https://upload.wikimedia.org/wikipedia/commons/${md5[0]}/${md5.slice(0, 2)}/`);
}
function isAuthor(value) {
  // shared/place-media-text.mjs: no link, no "Unknown author"/"Okänd" or Commons
  // "No machine-readable author provided" placeholder, no bare "[1]" footnote.
  return Boolean(cleanText(value, 200)) && isCreditName(value);
}
function isUrlFree(text) {
  return !/(?:https?:\/\/|www\.|\/\/[a-z0-9])/i.test(text);
}
function isExcerptText(value) {
  // A hatnote ("För slottet i Helsingborg, se …") is about another article and a
  // maintenance marker ("[källa behövs]") is not the place's text.
  return Boolean(cleanText(value, MAX_EXCERPT)) && value.length >= MIN_EXCERPT && isUrlFree(value) &&
    /[.!?…]["'”’»)]?$/.test(value) && !isHatnoteText(value) && !hasMaintenanceMarker(value);
}
function isSubtitleText(value) {
  return cleanText(value, MAX_SUBTITLE) && isUrlFree(value);
}
function isArticleTitle(value) {
  return cleanText(value, 255) && !/[<>[\]{}|#]/.test(value);
}

function normalizePhoto(photo) {
  if (!plainObject(photo)) return null;
  const { media_id, file_title, file_url, width, height, via, author, license, license_url, file_page_url } = photo;
  if (!isMediaId(media_id) || !cleanText(file_title, 255) || !file_title.startsWith('File:') ||
      !isCommonsUploadUrl(file_url) || !isCommonsFilePageUrl(file_page_url) ||
      !Number.isInteger(width) || width < 800 || !Number.isInteger(height) || height < 1 || !VIAS.has(via) ||
      !isMediaLicenseId(license) || !isMediaLicenseUrl(license, license_url) ||
      !photoFilesAgree(file_title, file_url, file_page_url)) return null;
  if (author === null ? mediaLicenseNeedsAuthor(license) : !isAuthor(author)) return null;
  return { media_id, file_title, file_url, width, height, via, author, license, license_url, file_page_url };
}

function normalizeExcerpt(value, lang) {
  if (!plainObject(value)) return null;
  const { text, title, rev } = value;
  if (value.lang !== lang || !isExcerptText(text) || !isArticleTitle(title) || !Number.isSafeInteger(rev) || rev < 1) return null;
  return { text, title, rev, lang };
}

function normalizeEntity(entity) {
  if (entity === null) return null;
  if (!plainObject(entity)) return undefined;
  const p31 = Array.isArray(entity.p31) ? entity.p31.filter(isQid) : null;
  if (!p31 || p31.length !== entity.p31.length || p31.length > 50) return undefined;
  if (!plainObject(entity.labels)) return undefined;
  const labels = {};
  for (const [lang, label] of Object.entries(entity.labels)) {
    if (!/^[a-z]{2,3}(?:-[a-z0-9-]{1,20})?$/i.test(lang) || !cleanText(label, MAX_LABEL)) return undefined;
    labels[lang] = label;
  }
  if (!Array.isArray(entity.aliases) || entity.aliases.length > MAX_ALIASES || !entity.aliases.every(a => cleanText(a, MAX_LABEL))) return undefined;
  let coord = null;
  if (entity.coord !== null && entity.coord !== undefined) {
    const { lat, lng } = entity.coord;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
    coord = { lat, lng };
  }
  return { p31, labels, aliases: [...entity.aliases], coord };
}

/** A valid record (copied) or null. */
function normalizeMediaRecord(raw) {
  if (!plainObject(raw) || raw.v !== 1 || !isQid(raw.qid) || !isoDate(raw.checked_on)) return null;
  const entity = normalizeEntity(raw.entity === undefined ? null : raw.entity);
  if (entity === undefined) return null;
  let photo = null;
  if (raw.photo !== null && raw.photo !== undefined) {
    photo = normalizePhoto(raw.photo);
    if (!photo) return null;
  }
  const subtitle = {};
  if (raw.subtitle !== undefined && raw.subtitle !== null) {
    if (!plainObject(raw.subtitle)) return null;
    for (const [lang, text] of Object.entries(raw.subtitle)) {
      if (!LANGS.includes(lang) || !isSubtitleText(text)) return null;
      subtitle[lang] = text;
    }
  }
  const about = {};
  if (raw.about !== undefined && raw.about !== null) {
    if (!plainObject(raw.about)) return null;
    for (const [lang, excerpt] of Object.entries(raw.about)) {
      if (!LANGS.includes(lang)) return null;
      const normalized = normalizeExcerpt(excerpt, lang);
      if (!normalized) return null;
      about[lang] = normalized;
    }
  }
  return { v: 1, qid: raw.qid, checked_on: raw.checked_on, entity, photo, subtitle, about };
}

module.exports = {
  normalizeMediaRecord,
  normalizePhoto,
  photoFilesAgree,
  isQid,
  isMediaId,
  isIsoDate: isoDate,
  isCommonsUploadUrl,
  isCommonsFilePageUrl,
  isAuthor,
  isExcerptText,
  isSubtitleText,
  isArticleTitle,
  MIN_EXCERPT,
  MAX_EXCERPT,
  MAX_SUBTITLE,
  MAX_ALIASES,
};
