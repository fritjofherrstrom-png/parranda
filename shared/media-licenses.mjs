/**
 * The ONE licence list for place media (docs/PLACE_MEDIA.md). Server gates,
 * the published-day schema and the frontend credit line all read this file.
 *
 * Accepted: CC0 1.0, public domain, CC BY 1.0–4.0 and CC BY-SA 1.0–4.0. A
 * jurisdiction port ("CC BY-SA 3.0 de") maps to the generic id; the real
 * licence URL keeps the port. Everything else is refused: GFDL-only, Free Art
 * License, plain "Attribution", NC/ND variants and any licence the metadata
 * does not state in one readable way.
 */
const VERSIONS = ['1.0', '2.0', '2.5', '3.0', '4.0'];

function build() {
  const list = {
    'CC0-1.0': { label: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: false },
    PD: { label: 'Public domain', url: null, attribution: false },
  };
  for (const kind of ['by', 'by-sa']) {
    for (const version of VERSIONS) {
      const id = `CC-${kind.toUpperCase()}-${version}`;
      list[id] = { label: `CC ${kind.toUpperCase()} ${version}`, url: `https://creativecommons.org/licenses/${kind}/${version}/`, attribution: true };
    }
  }
  for (const value of Object.values(list)) Object.freeze(value);
  return Object.freeze(list);
}

export const MEDIA_LICENSES = build();
export const MEDIA_LICENSE_IDS = Object.freeze(Object.keys(MEDIA_LICENSES));
/** Wikipedia text is reused under CC BY-SA 4.0. */
export const WIKIPEDIA_TEXT_LICENSE = 'CC-BY-SA-4.0';
export const WIKIDATA_DATA_LICENSE = 'CC0-1.0';

export function isMediaLicenseId(id) {
  return typeof id === 'string' && Object.hasOwn(MEDIA_LICENSES, id);
}

export function mediaLicenseLabel(id) {
  return isMediaLicenseId(id) ? MEDIA_LICENSES[id].label : null;
}

/** PD and CC0 need no author; every CC BY / BY-SA licence does. */
export function mediaLicenseNeedsAuthor(id) {
  return isMediaLicenseId(id) ? MEDIA_LICENSES[id].attribution : true;
}

const CC_CODE = /^cc-(by|by-sa)-(1\.0|2\.0|2\.5|3\.0|4\.0)(?:-([a-z]{2,3}(?:-[a-z]{2,8})?))?$/;
const CC_URL = /^https:\/\/creativecommons\.org\/licenses\/(by|by-sa)\/(1\.0|2\.0|2\.5|3\.0|4\.0)\/(?:([a-z]{2,3}(?:-[a-z]{2,8})?)\/)?(?:deed\.[a-z]{2,3}(?:[-_][a-z]{2,4})?)?$/i;
const CC0_URL = /^https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/(?:deed\.[a-z]{2,3}(?:[-_][a-z]{2,4})?)?$/i;
const PD_MARK_URL = /^https?:\/\/creativecommons\.org\/publicdomain\/mark\/1\.0\/?(?:deed\.[a-z-]+)?$/i;

function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 300 || /[\u0000- \u007f"<>\\]/.test(trimmed)) return null;
  let url = trimmed.replace(/^http:\/\//i, 'https://').replace(/^\/\//, 'https://');
  // Commons writes both ".../by-sa/3.0" and ".../by-sa/3.0/".
  if (/\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)(?:\/[a-z]{2,3}(?:-[a-z]{2,8})?)?$/i.test(url)) url += '/';
  return url;
}

/** "CC BY-SA 3.0 de" → { id: 'CC-BY-SA-3.0', port: 'de' }; "CC0" → CC0; "Public domain" → PD. */
function parseShortName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  if (/^(?:cc0|cc0 1\.0|cc zero)$/i.test(name)) return { id: 'CC0-1.0', port: null };
  if (/^public domain$/i.test(name)) return { id: 'PD', port: null };
  const match = /^CC (BY|BY-SA) (1\.0|2\.0|2\.5|3\.0|4\.0)(?: ([a-z]{2,3}(?:-[a-z]{2,8})?))?$/i.exec(name);
  if (!match) return null;
  return { id: `CC-${match[1].toUpperCase()}-${match[2]}`, port: match[3] ? match[3].toLowerCase() : null };
}

/**
 * Normalises Commons extmetadata (License, LicenseShortName, LicenseUrl) to
 * { id, url } or null. Code, short name and URL must all tell the same story;
 * any disagreement reads as an unreadable (multi-)licence and is refused.
 */
export function normalizeCommonsLicense({ code, shortName, url } = {}) {
  const raw = String(code || '').trim().toLowerCase();
  let id; let port = null;
  if (raw === 'cc0' || raw === 'cc-zero') id = 'CC0-1.0';
  else if (raw === 'pd') id = 'PD';
  else {
    const match = CC_CODE.exec(raw);
    if (!match) return null;
    id = `CC-${match[1].toUpperCase()}-${match[2]}`;
    port = match[3] || null;
  }
  if (shortName !== undefined && shortName !== null && String(shortName).trim()) {
    const parsed = parseShortName(shortName);
    if (!parsed || parsed.id !== id || (parsed.port && parsed.port !== port)) return null;
  }
  if (id === 'PD') {
    // Public domain carries no licence URL, or at most the PD mark. Any other
    // URL (say CC BY 4.0) contradicts the code and would drop a needed credit.
    const stated = url === undefined || url === null ? '' : String(url).trim();
    if (stated && !PD_MARK_URL.test(stated)) return null;
    return { id, url: null };
  }
  const given = url === undefined || url === null || url === '' ? null : httpsUrl(url);
  if (url && !given) return null;
  if (id === 'CC0-1.0') {
    if (!given) return { id, url: MEDIA_LICENSES[id].url };
    return CC0_URL.test(given) ? { id, url: given } : null;
  }
  if (!given) {
    // A ported licence is only kept with its real URL; never guess a port's URL.
    return port ? null : { id, url: MEDIA_LICENSES[id].url };
  }
  const match = CC_URL.exec(given);
  if (!match) return null;
  const urlId = `CC-${match[1].toUpperCase()}-${match[2]}`;
  const urlPort = match[3] ? match[3].toLowerCase() : null;
  if (urlId !== id || urlPort !== port) return null;
  return { id, url: given };
}

/** Whether a stored licence URL is a well-formed URL for that licence id (ports allowed). */
export function isMediaLicenseUrl(id, url) {
  if (!isMediaLicenseId(id)) return false;
  if (id === 'PD') return url === null;
  if (typeof url !== 'string' || url !== url.trim() || url.length > 300) return false;
  if (id === 'CC0-1.0') return CC0_URL.test(url);
  const match = CC_URL.exec(url);
  return Boolean(match) && `CC-${match[1].toUpperCase()}-${match[2]}` === id;
}
