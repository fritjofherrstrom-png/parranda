'use strict';

// Image bytes for place media (docs/PLACE_MEDIA.md, "Image bytes").
//
// GET /media/c/:media_id/:w serves a Commons photo from our own origin, so the
// browser never talks to Wikimedia. Only media ids the place-media service
// knows are served: the upstream URL is always built from that service's
// validated record, never from the request, so this route is no open proxy.
//
//   - widths 250, 500 and 960 only (400 otherwise); unknown ids 404;
//   - disk cache in PARRANDA_CACHE_DIR/place-media-bytes/ with an LRU byte cap
//     (PARRANDA_MEDIA_CACHE_MAX_MB, default 1024); memory only without a dir;
//   - at most 2 upstream fetches at once, 1.5 s timeout, 2 MB cap, and only
//     image/jpeg, image/png or image/webp whose first bytes match the type;
//   - upstream down and not cached: a fast 503 (circuit breaker, bounded queue);
//   - the public-access guard counts only real upstream misses
//     (`request[UPSTREAM_MISS_ADMISSION]`, set by server/lib/public-access-guard.js).

const fs = require('node:fs');
const path = require('node:path');
const { isMediaId, isCommonsUploadUrl } = require('./record');
const { USER_AGENT } = require('./wikimedia-client');
const { getPlaceMedia } = require('./index');
const { UPSTREAM_MISS_ADMISSION } = require('../lib/public-access-guard');

const MEDIA_WIDTHS = Object.freeze([250, 500, 960]);
const CACHE_SUBDIR = 'place-media-bytes';
const DEFAULT_CACHE_MAX_MB = 1024;
// Without a cache directory the bytes live in memory, so the cap is small.
const MEMORY_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 1500;
const MAX_PARALLEL_UPSTREAM = 2;
const MAX_QUEUED_UPSTREAM = 32;
const MAX_QUEUE_WAIT_MS = 3000;
const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 60 * 1000;
const MAX_RETRY_AFTER_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
const MAX_NEGATIVE = 5000;
// Wikimedia shortens thumb names whose original name is longer than this many
// bytes to "{w}px-thumbnail.{ext}" (FileRepo::nameForThumb, abbrvThreshold).
const THUMB_NAME_ABBREVIATION_BYTES = 160;

const TYPES = Object.freeze({
  'image/jpeg': { ext: 'jpg', magic: bytes => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  'image/png': { ext: 'png', magic: bytes => bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: bytes => bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP' },
});
const TYPE_BY_EXT = new Map(Object.entries(TYPES).map(([type, { ext }]) => [ext, type]));
const CACHE_FILE = /^([0-9a-f]{40})-(250|500|960)\.(jpg|png|webp)$/;
const COMMONS_UPLOAD = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#\s]+)$/;

/** True for the widths the route serves. */
function isMediaWidth(value) {
  return MEDIA_WIDTHS.includes(value);
}

function parseWidth(raw) {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,3}$/.test(raw)) return null;
  const value = Number(raw);
  return isMediaWidth(value) ? value : null;
}

/**
 * The upstream URL for one photo and width, built only from the validated
 * record. Commons never upscales, so a width at or above the original's asks
 * for the original. WebP originals also use the original: Wikimedia may render
 * their thumbs as PNG under another name, and guessing that name is fragile.
 */
function upstreamUrl(photo, width) {
  if (!photo || !isCommonsUploadUrl(photo.file_url) || !isMediaWidth(width)) return null;
  const match = COMMONS_UPLOAD.exec(photo.file_url);
  if (!match) return null;
  const [, a, ab, name] = match;
  let decoded;
  try { decoded = decodeURIComponent(name); } catch { return null; }
  const ext = path.extname(decoded).slice(1).toLowerCase();
  if (!Number.isInteger(photo.width) || width >= photo.width || ext === 'webp') return photo.file_url;
  if (!['jpg', 'jpeg', 'png'].includes(ext)) return null;
  const thumbName = Buffer.byteLength(decoded, 'utf8') > THUMB_NAME_ABBREVIATION_BYTES
    ? `${width}px-thumbnail.${ext}`
    : `${width}px-${name}`;
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${name}/${thumbName}`;
}

function etagFor(mediaId, width) {
  return `"${mediaId}-${width}"`;
}

function matchesIfNoneMatch(header, etag) {
  if (typeof header !== 'string' || !header) return false;
  return header.split(',').some(part => {
    const value = part.trim();
    return value === '*' || value === etag || value === `W/${etag}`;
  });
}

function retryAfterMs(response, clock) {
  const raw = response?.headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - clock()), MAX_RETRY_AFTER_MS);
  return null;
}

/** Reads at most `limit` bytes; returns null when the body is larger. */
async function readCapped(response, limit, signal) {
  const body = response.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        if (signal?.aborted) throw signal.reason || new Error('aborted');
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      }
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
    return Buffer.concat(chunks, size);
  }
  if (typeof response.arrayBuffer !== 'function') return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length > limit ? null : buffer;
}

function positiveNumber(raw, fallback) {
  const value = Number(String(raw ?? '').trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * createMediaBytes(options) → { handle(request, response), ready, health() }.
 * Every dependency is injectable; the defaults are the production ones.
 */
function createMediaBytes({
  cacheDir = null,
  maxCacheBytes = DEFAULT_CACHE_MAX_MB * 1024 * 1024,
  fetcher = globalThis.fetch,
  placeMedia = getPlaceMedia,
  clock = () => Date.now(),
  timeoutMs = UPSTREAM_TIMEOUT_MS,
  maxParallel = MAX_PARALLEL_UPSTREAM,
  maxQueue = MAX_QUEUED_UPSTREAM,
  maxQueueWaitMs = MAX_QUEUE_WAIT_MS,
  maxFileBytes = MAX_FILE_BYTES,
  breakerThreshold = BREAKER_THRESHOLD,
  breakerOpenMs = BREAKER_OPEN_MS,
} = {}) {
  const now = () => { const value = clock(); return value instanceof Date ? value.getTime() : Number(value); };
  const service = () => (typeof placeMedia === 'function' ? placeMedia() : placeMedia) || null;
  const dir = typeof cacheDir === 'string' && cacheDir.trim() ? cacheDir.trim() : null;
  const capBytes = dir ? maxCacheBytes : Math.min(maxCacheBytes, MEMORY_CACHE_MAX_BYTES);

  // LRU: Map insertion order, oldest first. Entry: { size, type, file?, bytes? }.
  const entries = new Map();
  let totalBytes = 0;
  const inFlight = new Map();
  const negative = new Map();
  const waiters = [];
  let active = 0;
  let consecutiveFailures = 0;
  let breakerOpenUntil = 0;
  const counters = {
    hits: 0, misses: 0, not_modified: 0, served_upstream: 0, joined_in_flight: 0,
    unknown: 0, bad_width: 0, rate_limited: 0, unavailable: 0, breaker_open: 0, queue_full: 0,
    upstream_gone: 0, refused_mime: 0, refused_size: 0, upstream_errors: 0, evicted: 0, cache_write_failures: 0,
  };

  function touch(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    totalBytes -= entry.size;
  }

  function evict() {
    for (const [key, entry] of entries) {
      if (totalBytes <= capBytes) break;
      remove(key);
      counters.evicted += 1;
      if (entry.file) fs.promises.unlink(entry.file).catch(() => {});
    }
  }

  function add(key, entry) {
    remove(key);
    entries.set(key, entry);
    totalBytes += entry.size;
    evict();
  }

  async function scan() {
    if (!dir) return;
    try { await fs.promises.mkdir(dir, { recursive: true }); } catch { return; }
    let names;
    try { names = await fs.promises.readdir(dir); } catch { return; }
    const found = [];
    for (const name of names) {
      const file = path.join(dir, name);
      if (name.startsWith('.tmp-')) {
        fs.promises.unlink(file).catch(() => {});
        continue;
      }
      const match = CACHE_FILE.exec(name);
      if (!match) continue;
      try {
        const stat = await fs.promises.stat(file);
        if (!stat.isFile() || stat.size < 1 || stat.size > maxFileBytes) continue;
        found.push({ key: `${match[1]}-${match[2]}`, entry: { size: stat.size, type: TYPE_BY_EXT.get(match[3]), file }, at: stat.mtimeMs });
      } catch { /* vanished while scanning */ }
    }
    found.sort((left, right) => left.at - right.at);
    for (const { key, entry } of found) if (!entries.has(key)) add(key, entry);
  }
  const ready = scan();

  // Another process may share the directory: look on disk before going upstream.
  async function findOnDisk(key) {
    if (!dir) return null;
    for (const [type, { ext }] of Object.entries(TYPES)) {
      const file = path.join(dir, `${key}.${ext}`);
      try {
        const stat = await fs.promises.stat(file);
        if (stat.isFile() && stat.size > 0 && stat.size <= maxFileBytes) {
          const entry = { size: stat.size, type, file };
          add(key, entry);
          return entry;
        }
      } catch { /* not there */ }
    }
    return null;
  }

  async function readCached(key) {
    let entry = entries.get(key) || await findOnDisk(key);
    if (!entry) return null;
    if (entry.bytes) {
      touch(key, entry);
      return { type: entry.type, bytes: entry.bytes };
    }
    try {
      const bytes = await fs.promises.readFile(entry.file);
      if (!bytes.length || bytes.length > maxFileBytes || !TYPES[entry.type].magic(bytes)) throw new Error('bad cache file');
      touch(key, entry);
      const stamp = new Date(now());
      fs.promises.utimes(entry.file, stamp, stamp).catch(() => {});
      return { type: entry.type, bytes };
    } catch {
      remove(key);
      fs.promises.unlink(entry.file).catch(() => {});
      return null;
    }
  }

  async function store(key, type, bytes) {
    if (!dir) {
      add(key, { size: bytes.length, type, bytes });
      return;
    }
    const file = path.join(dir, `${key}.${TYPES[type].ext}`);
    const temp = path.join(dir, `.tmp-${process.pid}-${key}-${Math.random().toString(16).slice(2)}`);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(temp, bytes);
      await fs.promises.rename(temp, file);
      add(key, { size: bytes.length, type, file });
    } catch {
      counters.cache_write_failures += 1;
      fs.promises.unlink(temp).catch(() => {});
    }
  }

  function remember(key, kind) {
    if (negative.size >= MAX_NEGATIVE) {
      const current = now();
      for (const [entryKey, value] of negative) if (value.until <= current) negative.delete(entryKey);
      if (negative.size >= MAX_NEGATIVE) negative.delete(negative.keys().next().value);
    }
    negative.set(key, { kind, until: now() + NEGATIVE_TTL_MS });
  }

  function negativeFor(key) {
    const value = negative.get(key);
    if (!value) return null;
    if (value.until <= now()) {
      negative.delete(key);
      return null;
    }
    return value.kind;
  }

  function breakerRemainingMs() {
    return Math.max(0, breakerOpenUntil - now());
  }

  function recordFailure(openForMs = null) {
    consecutiveFailures += 1;
    counters.upstream_errors += 1;
    if (openForMs !== null) breakerOpenUntil = Math.max(breakerOpenUntil, now() + Math.max(openForMs, 1000));
    else if (consecutiveFailures >= breakerThreshold) breakerOpenUntil = now() + breakerOpenMs;
  }

  function acquire() {
    if (active < maxParallel) {
      active += 1;
      return Promise.resolve(true);
    }
    if (waiters.length >= maxQueue) return Promise.resolve(false);
    return new Promise(resolve => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        resolve(false);
      }, maxQueueWaitMs);
      waiters.push(waiter);
    });
  }

  function release() {
    const next = waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(true);
      return;
    }
    if (active > 0) active -= 1;
  }

  /** One upstream fetch → { ok, type, bytes } | { kind: 'gone'|'refused'|'unavailable', retryAfterSec? }. */
  async function fetchUpstream(url) {
    if (!(await acquire())) {
      counters.queue_full += 1;
      return { kind: 'unavailable', retryAfterSec: 5 };
    }
    try {
      if (breakerRemainingMs() > 0) return { kind: 'unavailable', retryAfterSec: Math.ceil(breakerRemainingMs() / 1000) };
      const controller = new AbortController();
      let timer;
      // The deadline covers headers and body, and holds even for a fetcher that ignores the signal.
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(new Error('upstream timeout'));
          reject(new Error('upstream timeout'));
        }, timeoutMs);
      });
      deadline.catch(() => {});
      try {
        return await Promise.race([deadline, readUpstream(url, controller.signal)]);
      } catch {
        recordFailure();
        return { kind: 'unavailable', retryAfterSec: 5 };
      } finally {
        clearTimeout(timer);
      }
    } finally {
      release();
    }
  }

  async function readUpstream(url, signal) {
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'error',
      signal,
      headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT, Accept: 'image/webp,image/png,image/jpeg' },
    });
    const status = Number(response?.status);
    if (status === 404 || status === 410) {
      consecutiveFailures = 0;
      counters.upstream_gone += 1;
      return { kind: 'gone' };
    }
    if (status === 429 || status === 503) {
      recordFailure(retryAfterMs(response, now) ?? breakerOpenMs);
      return { kind: 'unavailable', retryAfterSec: Math.max(1, Math.ceil(breakerRemainingMs() / 1000)) };
    }
    if (status !== 200) {
      recordFailure();
      return { kind: 'unavailable', retryAfterSec: 5 };
    }
    const type = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!Object.hasOwn(TYPES, type)) {
      consecutiveFailures = 0;
      counters.refused_mime += 1;
      response.body?.cancel?.().catch?.(() => {});
      return { kind: 'refused' };
    }
    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > maxFileBytes) {
      consecutiveFailures = 0;
      counters.refused_size += 1;
      response.body?.cancel?.().catch?.(() => {});
      return { kind: 'refused' };
    }
    const bytes = await readCapped(response, maxFileBytes, signal);
    if (!bytes) {
      consecutiveFailures = 0;
      counters.refused_size += 1;
      return { kind: 'refused' };
    }
    if (!bytes.length || !TYPES[type].magic(bytes)) {
      consecutiveFailures = 0;
      counters.refused_mime += 1;
      return { kind: 'refused' };
    }
    consecutiveFailures = 0;
    return { ok: true, type, bytes };
  }

  function startFetch(key, url) {
    const job = (async () => {
      const result = await fetchUpstream(url);
      if (result.ok) {
        counters.served_upstream += 1;
        await store(key, result.type, result.bytes);
      } else if (result.kind === 'gone' || result.kind === 'refused') {
        remember(key, result.kind);
      }
      return result;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, job);
    return job;
  }

  function sendBytes(response, etag, type, bytes) {
    response
      .status(200)
      .set({
        'Content-Type': type,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'public, max-age=86400',
        ETag: etag,
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(bytes);
  }

  function sendError(response, status, error, retryAfterSec) {
    response.status(status).set({
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    if (retryAfterSec) response.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterSec))));
    response.json({ error, ...(retryAfterSec ? { retry_after_seconds: Math.max(1, Math.ceil(retryAfterSec)) } : {}) });
  }

  async function handle(request, response) {
    const media = service();
    const mediaId = String(request.params?.media_id || '');
    // Feature off: the route does not exist.
    if (!media) return sendError(response, 404, 'not_found');
    const width = parseWidth(String(request.params?.w || ''));
    if (!width) {
      counters.bad_width += 1;
      return sendError(response, 400, 'invalid_width');
    }
    const photo = isMediaId(mediaId) && typeof media.byMediaId === 'function' ? media.byMediaId(mediaId) : undefined;
    const url = photo && photo.media_id === mediaId ? upstreamUrl(photo, width) : null;
    if (!url) {
      counters.unknown += 1;
      return sendError(response, 404, 'not_found');
    }
    const etag = etagFor(mediaId, width);
    if (matchesIfNoneMatch(request.headers?.['if-none-match'], etag)) {
      counters.not_modified += 1;
      response.status(304).set({
        'Cache-Control': 'public, max-age=86400',
        ETag: etag,
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      }).end();
      return undefined;
    }

    await ready;
    const key = `${mediaId}-${width}`;
    const cached = await readCached(key);
    if (cached) {
      counters.hits += 1;
      return sendBytes(response, etag, cached.type, cached.bytes);
    }
    if (negativeFor(key)) return sendError(response, 404, 'not_found');

    let job = inFlight.get(key);
    if (job) {
      counters.joined_in_flight += 1;
    } else {
      if (breakerRemainingMs() > 0) {
        counters.breaker_open += 1;
        return sendError(response, 503, 'media_unavailable', breakerRemainingMs() / 1000);
      }
      // Only a fetch that really goes upstream is counted against the caller.
      const admit = request[UPSTREAM_MISS_ADMISSION];
      const verdict = typeof admit === 'function' ? admit() : { allowed: true };
      if (!verdict?.allowed) {
        counters.rate_limited += 1;
        return sendError(response, 429, 'rate_limited', verdict?.retryAfterSec || 60);
      }
      counters.misses += 1;
      job = startFetch(key, url);
    }
    const result = await job;
    if (result.ok) return sendBytes(response, etag, result.type, result.bytes);
    if (result.kind === 'gone' || result.kind === 'refused') return sendError(response, 404, 'not_found');
    counters.unavailable += 1;
    return sendError(response, 503, 'media_unavailable', result.retryAfterSec || 5);
  }

  return {
    cacheDir: dir,
    maxCacheBytes: capBytes,
    ready,
    handle,
    health: () => ({
      ...counters,
      cache_entries: entries.size,
      cache_bytes: totalBytes,
      cache_cap_bytes: capBytes,
      disk: Boolean(dir),
      upstream_active: active,
      upstream_queued: waiters.length,
      in_flight: inFlight.size,
      breaker_open: breakerRemainingMs() > 0,
    }),
  };
}

let singleton;
let singletonKey;
let override; // undefined: follow env; object: that instance

/** The service for PARRANDA_CACHE_DIR / PARRANDA_MEDIA_CACHE_MAX_MB. */
function getMediaBytes(env = process.env) {
  if (override !== undefined) return override;
  const base = String(env.PARRANDA_CACHE_DIR || '').trim();
  const maxMb = positiveNumber(env.PARRANDA_MEDIA_CACHE_MAX_MB, DEFAULT_CACHE_MAX_MB);
  const key = `${base}|${maxMb}`;
  if (!singleton || singletonKey !== key) {
    singleton = createMediaBytes({
      cacheDir: base ? path.join(base, CACHE_SUBDIR) : null,
      maxCacheBytes: Math.floor(maxMb * 1024 * 1024),
    });
    singletonKey = key;
  }
  return singleton;
}

/** Tests: an instance, or undefined (back to env). */
function setMediaBytesForTests(instance) {
  override = instance === null ? undefined : instance;
}

/** Express handler for GET /media/c/:media_id/:w. */
function handleMediaBytesRequest(request, response, next) {
  getMediaBytes().handle(request, response).catch(next);
}

module.exports = {
  createMediaBytes,
  getMediaBytes,
  setMediaBytesForTests,
  handleMediaBytesRequest,
  upstreamUrl,
  etagFor,
  isMediaWidth,
  MEDIA_WIDTHS,
  CACHE_SUBDIR,
  DEFAULT_CACHE_MAX_MB,
  MAX_FILE_BYTES,
  UPSTREAM_TIMEOUT_MS,
  MAX_PARALLEL_UPSTREAM,
};
