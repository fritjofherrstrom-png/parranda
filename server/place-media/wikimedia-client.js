'use strict';

// Wikimedia client for place media (docs/PLACE_MEDIA.md, "Wikimedia client").
// One request at a time, a real User-Agent, a 4 s timeout per call, Retry-After
// honoured, and a circuit breaker (5 failures or 429s in a row → 10 min open).
// Only batched calls: wbgetentities, Commons imageinfo and Wikipedia extracts.
// Only QIDs and file/article titles ever leave the server.

const { gateCommonsPage } = require('./commons-gate');
const { normalizeMediaRecord, isQid, isExcerptText, MIN_EXCERPT, MAX_EXCERPT, MAX_SUBTITLE, MAX_ALIASES } = require('./record');
const { isHatnoteText, maintenanceMarkerIndex } = require('../../shared/place-media-text.mjs');
const { REJECT_CLASSES, VENUE_CLASSES } = require('./entity-gate');

const USER_AGENT = 'Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda) place-media';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const LANGS = ['sv', 'en'];
const ENTITY_BATCH = 50;
const IMAGEINFO_BATCH = 50;
const EXTRACT_BATCH = 20;
const DEFAULT_TIMEOUT_MS = 4000;
const BREAKER_THRESHOLD = 5;
const BREAKER_OPEN_MS = 10 * 60 * 1000;
const MAX_BODY_CHARS = 16 * 1024 * 1024;
const MAX_P18 = 3;
const MAX_P5775 = 2;
const EXTMETADATA_KEYS = 'License|LicenseShortName|LicenseUrl|Artist|Attribution|Credit|NonFree|Restrictions|AttributionRequired|Copyrighted';
const EARTH = 'http://www.wikidata.org/entity/Q2';

function clientError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function cleanString(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text && text.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(text) ? text : null;
}

function todayIso(clock) {
  const now = clock();
  return new Date(now instanceof Date ? now.getTime() : Number(now)).toISOString().slice(0, 10);
}

function parseRetryAfterMs(value, nowMs) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

// ---------- pure parsing ----------

const ABBREVIATIONS = new Set([
  // sv
  'bl.a', 't.ex', 'f.d', 'f.kr', 'e.kr', 'm.m', 'm.fl', 'o.s.v', 'osv', 'ca', 'kl', 'resp', 'inkl', 'exkl', 'ev', 'jfr',
  'nr', 'st', 's:t', 'd.v.s', 'dvs', 'p.g.a', 'pga', 'fr.o.m', 't.o.m', 'f.ö', 'bl', 'mm', 'tex', 'prof', 'dir',
  // en
  'e.g', 'i.e', 'etc', 'mr', 'mrs', 'ms', 'dr', 'jr', 'sr', 'no', 'vol', 'pp', 'approx', 'c', 'cf', 'vs', 'inc', 'ltd',
  'co', 'corp', 'mt', 'ft', 'u.s', 'u.k', 'a.d', 'b.c', 'st', 'ave', 'rd', 'est', 'b', 'd', 'fl', 'ed', 'eds',
]);

function isSentenceEnd(paragraph, start, end) {
  const before = paragraph.slice(0, start);
  const token = (/(\S+)$/.exec(before) || [, ''])[1].replace(/^[("'“‘«]+/, '').toLowerCase();
  if (paragraph[start] === '.') {
    if (!token) return false;
    if (/^\p{L}$/u.test(token)) return false; // an initial ("J. S. Bach")
    if (ABBREVIATIONS.has(token)) return false;
    if (/^(?:\p{L}\.)+\p{L}$/u.test(token)) return false; // "t.ex", "U.S"
  }
  const rest = paragraph.slice(end);
  if (!rest.trim()) return true;
  const next = rest.replace(/^\s+/, '')[0];
  return /[\p{Lu}\p{N}"'“‘«(¿¡]/u.test(next);
}

/**
 * Verbatim excerpt from a plain-text intro: the first paragraph that is not a
 * hatnote, cut only at a sentence end before any maintenance marker
 * ("[källa behövs]"), MIN_EXCERPT..MAX_EXCERPT characters, no URL inside.
 * null when no such cut exists. svwiki keeps the hatnote ("För slottet i
 * Helsingborg, se …") as the intro's own first paragraph: it points to another
 * article and is never about this place.
 */
function cutExcerpt(text) {
  if (typeof text !== 'string') return null;
  const paragraph = text.split(/\n+/).map(part => part.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean)
    .find(part => !isHatnoteText(part));
  if (!paragraph || /[\u0000-\u001f\u007f-\u009f]/.test(paragraph)) return null;
  const marker = maintenanceMarkerIndex(paragraph);
  const limit = marker === -1 ? MAX_EXCERPT : Math.min(MAX_EXCERPT, marker);
  let best = null;
  const ends = /[.!?…]["'”’»)]*(?=\s|$)/g;
  let match;
  while ((match = ends.exec(paragraph))) {
    const end = match.index + match[0].length;
    if (end > limit) break;
    if (end < MIN_EXCERPT) continue;
    if (!isSentenceEnd(paragraph, match.index, end)) continue;
    best = paragraph.slice(0, end);
  }
  if (!best || /(?:https?:\/\/|www\.|\/\/[a-z0-9])/i.test(best) || !isExcerptText(best)) return null;
  return best;
}

function claimValues(claims, property) {
  const list = Array.isArray(claims?.[property]) ? claims[property] : [];
  const rank = { preferred: 0, normal: 1 };
  return list
    .filter(claim => claim && claim.rank !== 'deprecated' && claim.mainsnak?.snaktype === 'value' && claim.mainsnak.datavalue)
    .map((claim, index) => ({ claim, index, order: rank[claim.rank] ?? 1 }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ claim }) => claim.mainsnak.datavalue.value);
}

function fileTitle(name) {
  const text = cleanString(name, 240);
  if (!text || /[|#<>[\]{}]/.test(text)) return null;
  const bare = text.replace(/^(?:File|Image|Fil|Bild):/i, '').replace(/_/g, ' ').trim();
  return bare ? `File:${bare.charAt(0).toUpperCase()}${bare.slice(1)}` : null;
}

/**
 * wbgetentities entity → the facts a record needs, or null when the entity is
 * missing or is not this QID (a redirect changes identity: no media).
 */
function parseEntity(qid, raw) {
  if (!raw || typeof raw !== 'object' || raw.missing !== undefined || raw.id !== qid || raw.type !== 'item') return null;
  const claims = raw.claims || {};
  const p31 = [...new Set(claimValues(claims, 'P31').map(value => value?.id).filter(isQid))].slice(0, 50);
  let coord = null;
  for (const value of claimValues(claims, 'P625')) {
    const lat = Number(value?.latitude);
    const lng = Number(value?.longitude);
    if ((value?.globe === undefined || value.globe === EARTH) && Number.isFinite(lat) && Number.isFinite(lng) &&
        Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { coord = { lat, lng }; break; }
  }
  const labels = {};
  for (const lang of LANGS) {
    const label = cleanString(raw.labels?.[lang]?.value, 300);
    if (label) labels[lang] = label;
  }
  // Names in every language feed the name gate. sv/en aliases first, then the
  // other languages' labels and aliases, unique, capped.
  const seen = new Set(Object.values(labels));
  const aliases = [];
  const push = value => {
    const text = cleanString(value, 300);
    if (text && !seen.has(text) && aliases.length < MAX_ALIASES) { seen.add(text); aliases.push(text); }
  };
  for (const lang of LANGS) for (const row of raw.aliases?.[lang] || []) push(row?.value);
  for (const [lang, row] of Object.entries(raw.labels || {})) if (!LANGS.includes(lang)) push(row?.value);
  for (const [lang, rows] of Object.entries(raw.aliases || {})) if (!LANGS.includes(lang)) for (const row of rows || []) push(row?.value);
  const subtitle = {};
  for (const lang of LANGS) {
    const text = cleanString(raw.descriptions?.[lang]?.value, MAX_SUBTITLE);
    if (text && !/(?:https?:\/\/|www\.)/i.test(text)) subtitle[lang] = text;
  }
  const sitelinks = {};
  for (const lang of LANGS) {
    const title = cleanString(raw.sitelinks?.[`${lang}wiki`]?.title, 255);
    if (title && !/[<>[\]{}|#]/.test(title)) sitelinks[lang] = title;
  }
  const p18 = claimValues(claims, 'P18').map(fileTitle).filter(Boolean).slice(0, MAX_P18);
  const p5775 = claimValues(claims, 'P5775').map(fileTitle).filter(Boolean).slice(0, MAX_P5775);
  return { entity: { p31, labels, aliases, coord }, subtitle, sitelinks, p18, p5775 };
}

/** Wikipedia extracts page → { excerpt } or { rejected }. */
function parseExtractPage(page, { qid, lang }) {
  if (!page || typeof page !== 'object' || page.missing !== undefined || page.invalid !== undefined || page.ns !== 0) return { rejected: 'missing' };
  const props = page.pageprops || {};
  if (props.disambiguation !== undefined) return { rejected: 'disambiguation' };
  if (props.wikibase_item !== qid) return { rejected: 'wikibase_item' };
  const title = cleanString(page.title, 255);
  const rev = Number(page.revisions?.[0]?.revid ?? page.lastrevid);
  if (!title || !Number.isSafeInteger(rev) || rev < 1) return { rejected: 'revision' };
  const text = cutExcerpt(page.extract);
  if (!text) return { rejected: 'excerpt' };
  return { excerpt: { text, title, rev, lang } };
}

function pagesOf(body) {
  const pages = body?.query?.pages;
  if (Array.isArray(pages)) return pages;
  return pages && typeof pages === 'object' ? Object.values(pages) : [];
}

/** requested title → page, following `normalized` and `redirects`. */
function pagesByRequestedTitle(body, titles) {
  const normalized = new Map((body?.query?.normalized || []).map(row => [row.from, row.to]));
  const redirects = new Map((body?.query?.redirects || []).map(row => [row.from, row.to]));
  const byTitle = new Map(pagesOf(body).map(page => [page?.title, page]));
  const out = new Map();
  for (const title of titles) {
    let current = normalized.get(title) || title;
    for (let hops = 0; hops < 3 && redirects.has(current); hops += 1) current = redirects.get(current);
    if (byTitle.has(current)) out.set(title, byTitle.get(current));
  }
  return out;
}

// ---------- client ----------

function createWikimediaClient({
  fetcher = globalThis.fetch,
  clock = () => Date.now(),
  sleep = ms => new Promise(resolve => { const t = setTimeout(resolve, ms); t.unref?.(); }),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryAfterMaxWaitMs = 0,
  breakerThreshold = BREAKER_THRESHOLD,
  breakerOpenMs = BREAKER_OPEN_MS,
} = {}) {
  if (typeof fetcher !== 'function') throw new TypeError('place-media: fetcher must be a function');
  const now = () => { const value = clock(); return value instanceof Date ? value.getTime() : Number(value); };
  let queue = Promise.resolve();
  let consecutiveFailures = 0;
  let openUntil = 0;
  let retryUntil = 0;
  const stats = { requests: 0, failures: 0, timeouts: 0, throttled: 0, breaker_opens: 0, short_circuited: 0,
    photo_rejections: {}, excerpt_rejections: {} };

  function noteFailure() {
    stats.failures += 1;
    consecutiveFailures += 1;
    if (consecutiveFailures >= breakerThreshold) {
      openUntil = now() + breakerOpenMs;
      consecutiveFailures = 0;
      stats.breaker_opens += 1;
    }
  }

  async function attempt(url) {
    stats.requests += 1;
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(clientError('timeout')); }, timeoutMs);
      timer.unref?.();
    });
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => fetcher(url, {
          method: 'GET',
          headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Encoding': 'gzip' },
          signal: controller.signal,
          redirect: 'error',
        })),
        timeout,
      ]);
      if (response.status === 429 || response.status === 503) {
        const wait = parseRetryAfterMs(response.headers?.get?.('retry-after'), now());
        if (wait !== null) retryUntil = Math.max(retryUntil, now() + wait);
        stats.throttled += 1;
        throw clientError('throttled', `HTTP ${response.status}`);
      }
      if (!response.ok) throw clientError('http', `HTTP ${response.status}`);
      const text = await Promise.race([Promise.resolve().then(() => response.text()), timeout]);
      if (typeof text !== 'string' || text.length > MAX_BODY_CHARS) throw clientError('body');
      let body;
      try { body = JSON.parse(text); } catch { throw clientError('json'); }
      if (body && body.error) throw clientError('api', String(body.error.code || 'api error'));
      return body;
    } catch (error) {
      if (error?.code === 'timeout') stats.timeouts += 1;
      throw error?.code ? error : clientError('network', error?.message);
    } finally {
      clearTimeout(timer);
    }
  }

  async function run(url) {
    if (now() < openUntil) { stats.short_circuited += 1; throw clientError('circuit_open'); }
    for (let tries = 0; ; tries += 1) {
      const wait = retryUntil - now();
      if (wait > 0) {
        if (wait > retryAfterMaxWaitMs) { stats.short_circuited += 1; throw clientError('retry_after'); }
        await sleep(wait);
      }
      try {
        const body = await attempt(url);
        consecutiveFailures = 0;
        return body;
      } catch (error) {
        noteFailure();
        // Retry once after a Retry-After the caller agreed to wait for.
        const retryable = error.code === 'throttled' && tries === 0 && retryUntil - now() > 0 &&
          retryUntil - now() <= retryAfterMaxWaitMs && now() >= openUntil;
        if (!retryable) throw error;
      }
    }
  }

  /** Serial: each call waits for the one before it. */
  function request(url) {
    const result = queue.then(() => run(url));
    queue = result.catch(() => {});
    return result;
  }

  function apiUrl(base, params) {
    const search = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
    return `${base}?${search.toString()}`;
  }

  /** qid → raw entity (or null when missing/moved). Failed batches are left out. */
  async function getEntities(qids) {
    const out = new Map();
    const errors = [];
    for (const batch of chunk([...new Set(qids.filter(isQid))], ENTITY_BATCH)) {
      let body;
      try {
        body = await request(apiUrl(WIKIDATA_API, {
          action: 'wbgetentities', ids: batch.join('|'), props: 'claims|labels|aliases|descriptions|sitelinks',
          sitefilter: 'svwiki|enwiki',
        }));
      } catch (error) { errors.push(error); continue; }
      const entities = body?.entities && typeof body.entities === 'object' ? body.entities : null;
      if (!entities) { errors.push(clientError('shape')); continue; }
      for (const qid of batch) {
        if (Object.hasOwn(entities, qid)) { out.set(qid, entities[qid]); continue; }
        const moved = Object.values(entities).some(entity => entity?.redirects?.from === qid);
        if (moved) out.set(qid, null);
      }
    }
    return { entities: out, errors };
  }

  /** File title → imageinfo page. */
  async function getImageinfo(titles) {
    const out = new Map();
    const errors = [];
    for (const batch of chunk([...new Set(titles.filter(Boolean))], IMAGEINFO_BATCH)) {
      let body;
      try {
        body = await request(apiUrl(COMMONS_API, {
          action: 'query', prop: 'imageinfo', iiprop: 'url|size|mime|sha1|extmetadata',
          iiextmetadatafilter: EXTMETADATA_KEYS, iiextmetadatalanguage: 'en', titles: batch.join('|'),
        }));
      } catch (error) { errors.push(error); continue; }
      for (const [title, page] of pagesByRequestedTitle(body, batch)) out.set(title, page);
    }
    return { pages: out, errors };
  }

  /** Article title → extracts page, for one language wiki. */
  async function getExtracts(lang, titles) {
    if (!LANGS.includes(lang)) throw clientError('lang');
    const out = new Map();
    const errors = [];
    for (const batch of chunk([...new Set(titles.filter(Boolean))], EXTRACT_BATCH)) {
      let body;
      try {
        body = await request(apiUrl(`https://${lang}.wikipedia.org/w/api.php`, {
          action: 'query', prop: 'extracts|pageprops|revisions', exintro: '1', explaintext: '1', exlimit: String(EXTRACT_BATCH),
          ppprop: 'disambiguation|wikibase_item', rvprop: 'ids', redirects: '1', titles: batch.join('|'),
        }));
      } catch (error) { errors.push(error); continue; }
      for (const [title, page] of pagesByRequestedTitle(body, batch)) out.set(title, page);
    }
    return { pages: out, errors };
  }

  function count(bucket, reason) { stats[bucket][reason] = (stats[bucket][reason] || 0) + 1; }

  /**
   * qid → finished index record. Only definitive answers become records: a
   * QID whose entity, excerpt or image lookups failed is left out and can be
   * asked again later. `osmCommons` maps qid → "File:…" from the OSM
   * wikimedia_commons tag.
   */
  async function fetchRecords(qids, { osmCommons } = {}) {
    const hints = osmCommons instanceof Map ? osmCommons : new Map(Object.entries(osmCommons || {}));
    const wanted = [...new Set((qids || []).filter(isQid))];
    const records = new Map();
    if (!wanted.length) return records;
    const checkedOn = todayIso(clock);
    const failed = new Set();
    const { entities, errors: entityErrors } = await getEntities(wanted);
    const parsed = new Map();
    for (const qid of wanted) {
      if (!entities.has(qid)) { failed.add(qid); continue; }
      parsed.set(qid, parseEntity(qid, entities.get(qid)));
    }
    // Only entities that could ever pass the gate are worth text and images.
    const useful = [...parsed].filter(([, facts]) => facts && facts.entity.p31.length && facts.entity.coord &&
      !facts.entity.p31.some(q => REJECT_CLASSES.has(q)));

    const excerpts = new Map();
    for (const lang of LANGS) {
      const titles = useful.map(([, facts]) => facts.sitelinks[lang]).filter(Boolean);
      if (!titles.length) continue;
      const { pages } = await getExtracts(lang, titles);
      for (const [qid, facts] of useful) {
        const title = facts.sitelinks[lang];
        if (!title) continue;
        if (!pages.has(title)) { failed.add(qid); continue; }
        const result = parseExtractPage(pages.get(title), { qid, lang });
        if (result.excerpt) excerpts.set(`${qid}|${lang}`, result.excerpt);
        else count('excerpt_rejections', result.rejected);
      }
    }

    const candidates = new Map();
    for (const [qid, facts] of useful) {
      if (failed.has(qid)) continue;
      const list = facts.p18.map(title => ({ title, via: 'p18' }));
      // P5775 (interior) is for venues only: the entity itself must be a venue.
      if (facts.entity.p31.some(q => VENUE_CLASSES.has(q))) list.push(...facts.p5775.map(title => ({ title, via: 'p5775' })));
      const hint = fileTitle(typeof hints.get(qid) === 'string' && /^File:/i.test(hints.get(qid)) ? hints.get(qid) : '');
      if (hint) list.push({ title: hint, via: 'osm_commons' });
      // No Wikipedia page image (review 2026-11-25): on svwiki the infobox of a
      // nature reserve or park shows a typical species or a nearby building, and
      // PageImages picks it — about 240 of 306 such photos in the Sweden index
      // showed a bird, plant, lichen or another place. Only the item's own
      // statements and the element's own OSM tag name a photo of the place.
      candidates.set(qid, list);
    }
    const allTitles = [...candidates.values()].flatMap(list => list.map(row => row.title));
    const { pages: imagePages } = allTitles.length ? await getImageinfo(allTitles) : { pages: new Map() };

    for (const qid of wanted) {
      if (failed.has(qid)) continue;
      const facts = parsed.get(qid);
      let photo = null;
      const subtitle = {};
      const about = {};
      if (facts) {
        Object.assign(subtitle, facts.subtitle);
        for (const lang of LANGS) if (excerpts.has(`${qid}|${lang}`)) about[lang] = excerpts.get(`${qid}|${lang}`);
        let incomplete = false;
        for (const { title, via } of candidates.get(qid) || []) {
          if (!imagePages.has(title)) { incomplete = true; break; }
          const result = gateCommonsPage(imagePages.get(title), { via });
          if (result.rejected) { count('photo_rejections', result.rejected); continue; }
          photo = result;
          break;
        }
        if (incomplete) continue;
      }
      const record = normalizeMediaRecord({ v: 1, qid, checked_on: checkedOn, entity: facts ? facts.entity : null, photo, subtitle, about });
      if (record) records.set(qid, record);
    }
    if (!records.size && entityErrors.length) throw entityErrors[0];
    return records;
  }

  return {
    getEntities,
    getImageinfo,
    getExtracts,
    fetchRecords,
    health: () => ({
      ...stats,
      photo_rejections: { ...stats.photo_rejections },
      excerpt_rejections: { ...stats.excerpt_rejections },
      consecutive_failures: consecutiveFailures,
      breaker_open: now() < openUntil,
      breaker_open_until: openUntil ? new Date(openUntil).toISOString() : null,
      retry_after_until: retryUntil > now() ? new Date(retryUntil).toISOString() : null,
    }),
  };
}

module.exports = {
  createWikimediaClient,
  parseEntity,
  parseExtractPage,
  cutExcerpt,
  fileTitle,
  USER_AGENT,
  ENTITY_BATCH,
  IMAGEINFO_BATCH,
  EXTRACT_BATCH,
};
