'use strict';

// Commons gate (docs/PLACE_MEDIA.md, "Commons gate"). Pure: one page from a
// commons.wikimedia.org `prop=imageinfo` answer in, a photo or a refusal out.
// Anything the metadata does not state clearly is refused; no photo is better
// than a wrongly credited one.

const {
  normalizeCommonsLicense,
  mediaLicenseNeedsAuthor,
} = require('../../shared/media-licenses.mjs');

const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MIN_WIDTH = 800;
const MAX_AUTHOR = 200;
const SHA1 = /^[0-9a-f]{40}$/;
const VIAS = new Set(['p18', 'p5775', 'osm_commons', 'page_image']);
// Maps, plans, logos, flags, coats of arms and diagrams are not a photo of the
// place, whatever their licence. Matched as whole words in the file title, in
// the languages Parranda's regions name files in.
const NOT_A_PHOTO = /(?:^|[^\p{L}\p{N}])(?:map|maps|mapa|karta|kartta|kort|carte|karte|stadtplan|plan|plano|planta|pianta|grundriss|floor ?plan|site ?plan|logo|logotyp|logotype|logotipo|flag|flagga|flagge|bandera|drapeau|bandiera|coat of arms|arms|vapen|vapensköld|wappen|escudo|blason|stemma|emblem|emblema|seal|diagram|diagramm|schema|scheme|locator|location)(?=$|[^\p{L}\p{N}])/iu;
const NO_MACHINE_READABLE_AUTHOR = /^No machine-readable author provided\b/i;
const SIGNATURE_STAMP = /\s*(?:--\s*)?\d{1,2}:\d{2},\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}\s+\(UTC\)\s*$/;
const SIGNATURE_TALK = /\s*\((?:talk|diskussion)\)\s*$/i;
function withoutSignature(text) {
  return text.replace(SIGNATURE_STAMP, '').replace(SIGNATURE_TALK, '').trim();
}
const OWN_WORK = /^(?:own work|self-photographed|eget arbete|egen bild|travail personnel|trabajo propio|eigenes werk|opera propria|treball propi)\.?$/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#x')) { const code = parseInt(lower.slice(2), 16); return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''; }
    if (lower.startsWith('#')) { const code = parseInt(lower.slice(1), 10); return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''; }
    return Object.hasOwn(ENTITIES, lower) ? ENTITIES[lower] : all;
  });
}

/** Strip HTML from an extmetadata value: hidden spans go, tags go, entities decode. */
function stripHtml(value) {
  if (typeof value !== 'string') return '';
  let text = value;
  // Hidden duplicates (e.g. "Unknown author<span style="display: none;">Unknown author</span>").
  for (let i = 0; i < 5; i += 1) {
    const next = text.replace(/<(span|div|bdi)\b[^>]*style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[^<]*<\/\1>/gi, '');
    if (next === text) break;
    text = next;
  }
  text = text.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function meta(ii, key) {
  const entry = ii?.extmetadata?.[key];
  const value = entry && typeof entry === 'object' ? entry.value : undefined;
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function validAuthor(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_AUTHOR &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value) && !/^(?:https?|www\.|\/\/)/i.test(value);
}

/** The commons file path "a/ab/Name.jpg" of an upload URL, query dropped. */
function commonsFileUrl(value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org' || url.username || url.password || url.port) return null;
  if (!/^\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/[^/]+$/.test(url.pathname)) return null;
  return `https://upload.wikimedia.org${url.pathname}`;
}
function commonsFilePageUrl(value, title) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'commons.wikimedia.org' || url.username || url.password || url.port) return null;
  if (!/^\/wiki\/File:[^/]+$/.test(url.pathname)) return null;
  const expected = `/wiki/${encodeURI(title.replace(/ /g, '_')).replace(/\?/g, '%3F')}`;
  // The description page must be this file's own page.
  try { if (decodeURIComponent(url.pathname) !== decodeURIComponent(expected)) return null; } catch { return null; }
  return `https://commons.wikimedia.org${url.pathname}`;
}

/**
 * imageinfo page → photo, or { rejected: reason }. `via` names the route the
 * candidate came by (p18, p5775, osm_commons, page_image).
 */
function gateCommonsPage(page, { via } = {}) {
  if (!VIAS.has(via)) return { rejected: 'via' };
  if (!page || typeof page !== 'object') return { rejected: 'missing' };
  if (page.missing !== undefined || page.invalid !== undefined) return { rejected: 'missing' };
  if (page.ns !== 6 || typeof page.title !== 'string' || !page.title.startsWith('File:')) return { rejected: 'missing' };
  // Asked on commons.wikimedia.org: "local" means the file lives on Commons.
  if (page.imagerepository !== 'local') return { rejected: 'not_commons' };
  const ii = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
  if (!ii) return { rejected: 'missing' };
  const title = page.title;
  if (NOT_A_PHOTO.test(title.slice(5).replace(/[_]+/g, ' ').replace(/\.[a-z0-9]+$/i, ''))) return { rejected: 'not_a_photo' };
  const mime = String(ii.mime || '').toLowerCase();
  if (!MIMES.has(mime)) return { rejected: 'mime' };
  const width = Number(ii.width);
  const height = Number(ii.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || height < 1) return { rejected: 'size' };
  if (width < MIN_WIDTH) return { rejected: 'size' };
  const sha1 = String(ii.sha1 || '').toLowerCase();
  if (!SHA1.test(sha1)) return { rejected: 'sha1' };
  const fileUrl = commonsFileUrl(ii.url);
  if (!fileUrl) return { rejected: 'not_commons' };
  const filePageUrl = commonsFilePageUrl(ii.descriptionurl, title);
  if (!filePageUrl) return { rejected: 'not_commons' };
  const nonFree = meta(ii, 'NonFree').trim().toLowerCase();
  if (nonFree && nonFree !== 'false' && nonFree !== '0') return { rejected: 'nonfree' };
  if (stripHtml(meta(ii, 'Restrictions'))) return { rejected: 'restrictions' };
  const license = normalizeCommonsLicense({
    code: meta(ii, 'License'),
    shortName: stripHtml(meta(ii, 'LicenseShortName')),
    url: meta(ii, 'LicenseUrl').trim(),
  });
  if (!license) return { rejected: 'license' };
  let author = null;
  for (const key of ['Attribution', 'Artist', 'Credit']) {
    // {{self}} writes the uploader's own credit as "I, <name>"; the name is the credit.
    const text = stripHtml(meta(ii, key)).replace(/^I,\s+(?=\S)/, '');
    if (!text) continue;
    // "Own work" is a source note, not a name; it never credits anyone.
    if (OWN_WORK.test(text)) continue;
    // Commons' own placeholder when a file names no author ("No machine-readable
    // author provided. X assumed (based on copyright claims).") is a guess, not a
    // credit: treated as no author (stricter than crediting the guessed uploader).
    if (NO_MACHINE_READABLE_AUTHOR.test(text)) continue;
    // Old talk-page signatures leave "Name 15:22, 28 March 2007 (UTC)" or
    // "Name (talk)" in Artist; the credit is the name.
    const name = withoutSignature(text);
    if (!name) continue;
    author = name;
    break;
  }
  if (author !== null && !validAuthor(author)) return { rejected: 'author' };
  if (author === null && mediaLicenseNeedsAuthor(license.id)) return { rejected: 'author' };
  return {
    media_id: sha1,
    file_title: title,
    file_url: fileUrl,
    width,
    height,
    via,
    author,
    license: license.id,
    license_url: license.url,
    file_page_url: filePageUrl,
  };
}

module.exports = { gateCommonsPage, stripHtml, NOT_A_PHOTO_TITLE: NOT_A_PHOTO, MIN_WIDTH };
