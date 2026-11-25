'use strict';

// Place media service (docs/PLACE_MEDIA.md, "Place media service").
// Records per Wikidata QID come from a built index (index-v1.jsonl), from
// records learned on demand (learned-v1.jsonl, appended) and from memory.
// The feature is on only when PARRANDA_PLACE_MEDIA_DIR is set.

const fs = require('node:fs');
const path = require('node:path');
const { normalizeMediaRecord, normalizePhoto, isQid, isMediaId } = require('./record');
const { createWikimediaClient } = require('./wikimedia-client');
const { GATE_REASONS } = require('./entity-gate');

const INDEX_FILE = 'index-v1.jsonl';
const LEARNED_FILE = 'learned-v1.jsonl';
// Photos that stopped being a place's current photo (index rebuilt, record
// relearned). A shared day keeps showing the photo it was published with, so
// a retired photo stays servable well past the longest share lifetime
// (published-day-store ttlMs, 7 days by default), then is forgotten.
const RETAINED_FILE = 'retained-v1.jsonl';
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RETAINED = 50000;
const DEFAULT_WAIT_MS = 1500;
const MAX_ENSURE_QIDS = 50;
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const MAX_LEARNED_IN_MEMORY = 50000;
const MAX_FAILED_REMEMBERED = 10000;

function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) {
    return { records: [], skipped: 0, missing: error?.code === 'ENOENT', error: error?.code === 'ENOENT' ? null : error };
  }
  const records = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let raw;
    try { raw = JSON.parse(line); } catch { skipped += 1; continue; }
    const record = normalizeMediaRecord(raw);
    if (record) records.push(record); else skipped += 1;
  }
  return { records, skipped, missing: false, error: null };
}

function retainedLine(photo, retiredAtMs) {
  return `${JSON.stringify({ v: 1, retired_at: new Date(retiredAtMs).toISOString(), photo })}\n`;
}

/** retained-v1.jsonl → Map media_id → { photo, retiredAt }, expired and broken lines dropped. */
function readRetained(file, nowMs) {
  const retained = new Map();
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return retained; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let raw;
    try { raw = JSON.parse(line); } catch { continue; }
    const retiredAt = Date.parse(raw?.retired_at);
    const photo = raw?.v === 1 ? normalizePhoto(raw.photo) : null;
    if (!photo || !Number.isFinite(retiredAt) || nowMs - retiredAt > RETAIN_MS) continue;
    retained.delete(photo.media_id); // the latest retirement wins and moves to the end
    retained.set(photo.media_id, { photo, retiredAt });
  }
  while (retained.size > MAX_RETAINED) retained.delete(retained.keys().next().value);
  return retained;
}

/** Builder: remember photos a rebuilt index no longer uses, so live shares keep them. */
function appendRetainedPhotos(dir, photos, nowMs = Date.now()) {
  const list = (photos || []).map(normalizePhoto).filter(Boolean);
  if (list.length) fs.appendFileSync(path.join(dir, RETAINED_FILE), list.map(photo => retainedLine(photo, nowMs)).join(''), 'utf8');
  return list.length;
}

/**
 * createPlaceMedia({ dir, fetcher, waitMs = 1500, clock, client }) → service.
 * `client` (a createWikimediaClient instance) may be injected; otherwise one
 * is built from `fetcher` and `clock`.
 */
function createPlaceMedia({ dir, fetcher, waitMs = DEFAULT_WAIT_MS, clock = () => Date.now(), client } = {}) {
  if (!dir || typeof dir !== 'string') throw new TypeError('place-media: dir is required');
  const now = () => { const value = clock(); return value instanceof Date ? value.getTime() : Number(value); };
  const upstream = client || createWikimediaClient({ fetcher: fetcher || globalThis.fetch, clock });
  const records = new Map();
  // media_id → { photo, qids }: a photo stays current while any record uses it.
  const photos = new Map();
  const retained = readRetained(path.join(dir, RETAINED_FILE), now());
  let loading = true;
  const inFlight = new Map();
  const failedUntil = new Map();
  const counters = {
    index_records: 0, learned_records: 0, load_skipped: 0, load_errors: 0,
    ensure_calls: 0, ensure_qids: 0, fetched_records: 0, fetch_failures: 0, persisted: 0, persist_failures: 0,
    gate: Object.fromEntries(GATE_REASONS.map(reason => [reason, 0])), gate_passed: 0,
  };
  let learnedInMemory = 0;

  function retire(photo) {
    retained.delete(photo.media_id);
    retained.set(photo.media_id, { photo, retiredAt: now() });
    while (retained.size > MAX_RETAINED) retained.delete(retained.keys().next().value);
    // While loading, the replaced photo is still in the files it came from.
    if (!loading) persistRetained(photo);
  }

  function put(record) {
    const previous = records.get(record.qid);
    const previousId = previous?.photo?.media_id;
    if (previousId && previousId !== record.photo?.media_id) {
      const entry = photos.get(previousId);
      if (entry) {
        entry.qids.delete(record.qid);
        if (!entry.qids.size) { photos.delete(previousId); retire(entry.photo); }
      }
    }
    records.set(record.qid, record);
    if (record.photo) {
      const entry = photos.get(record.photo.media_id);
      if (entry) entry.qids.add(record.qid);
      else photos.set(record.photo.media_id, { photo: record.photo, qids: new Set([record.qid]) });
    }
  }

  for (const [file, key] of [[INDEX_FILE, 'index_records'], [LEARNED_FILE, 'learned_records']]) {
    const loaded = readJsonl(path.join(dir, file));
    counters.load_skipped += loaded.skipped;
    if (loaded.error) counters.load_errors += 1;
    // Later lines win: learned records are newer than the built index.
    for (const record of loaded.records) put(record);
    counters[key] = loaded.records.length;
  }
  loading = false;

  let persistQueue = Promise.resolve();
  function persistRetained(photo) {
    const line = retainedLine(photo, now());
    persistQueue = persistQueue.then(() => fs.promises.appendFile(path.join(dir, RETAINED_FILE), line, 'utf8'))
      .catch(() => { counters.persist_failures += 1; });
  }
  function persist(list) {
    const lines = list.map(record => `${JSON.stringify(record)}\n`).join('');
    persistQueue = persistQueue.then(() => fs.promises.appendFile(path.join(dir, LEARNED_FILE), lines, 'utf8'))
      .then(() => { counters.persisted += list.length; })
      .catch(() => { counters.persist_failures += list.length; });
    return persistQueue;
  }

  function peek(qid) {
    return isQid(qid) ? records.get(qid) : undefined;
  }

  async function fetchBatch(batch) {
    try {
      const fetched = await upstream.fetchRecords(batch);
      const fresh = [];
      for (const qid of batch) {
        const record = fetched.get(qid);
        if (!record) {
          failedUntil.set(qid, now() + FAILURE_BACKOFF_MS);
          continue;
        }
        if (learnedInMemory < MAX_LEARNED_IN_MEMORY || records.has(qid)) {
          if (!records.has(qid)) learnedInMemory += 1;
          put(record);
        }
        fresh.push(record);
      }
      counters.fetched_records += fresh.length;
      if (fresh.length) await persist(fresh);
    } catch {
      counters.fetch_failures += 1;
      for (const qid of batch) failedUntil.set(qid, now() + FAILURE_BACKOFF_MS);
    } finally {
      for (const qid of batch) inFlight.delete(qid);
      if (failedUntil.size > MAX_FAILED_REMEMBERED) {
        for (const [qid, until] of failedUntil) if (until <= now()) failedUntil.delete(qid);
      }
    }
  }

  /**
   * Fetch records the service does not hold yet. Concurrent calls share one
   * upstream fetch per QID. An aborted `signal` only stops the waiting: the
   * fetch finishes in the background and is still persisted.
   */
  function ensure(qids, { signal } = {}) {
    counters.ensure_calls += 1;
    const wanted = [...new Set((Array.isArray(qids) ? qids : []).filter(isQid))].slice(0, MAX_ENSURE_QIDS);
    const waits = [];
    const missing = [];
    for (const qid of wanted) {
      if (records.has(qid)) continue;
      if (inFlight.has(qid)) { waits.push(inFlight.get(qid)); continue; }
      if ((failedUntil.get(qid) || 0) > now()) continue;
      missing.push(qid);
    }
    if (missing.length) {
      counters.ensure_qids += missing.length;
      const job = fetchBatch(missing);
      for (const qid of missing) inFlight.set(qid, job);
      waits.push(job);
    }
    const all = Promise.all(waits).then(() => undefined);
    if (!signal) return all;
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const onAbort = () => resolve();
      signal.addEventListener('abort', onAbort, { once: true });
      all.then(() => { signal.removeEventListener('abort', onAbort); resolve(); });
    });
  }

  function byMediaId(mediaId) {
    if (!isMediaId(mediaId)) return undefined;
    const current = photos.get(mediaId);
    if (current) return current.photo;
    // A retired photo still serves the shares published with it, for a bounded time.
    const old = retained.get(mediaId);
    return old && now() - old.retiredAt <= RETAIN_MS ? old.photo : undefined;
  }

  function countGate(reason) {
    if (reason === 'passed') counters.gate_passed += 1;
    else if (Object.hasOwn(counters.gate, reason)) counters.gate[reason] += 1;
  }

  return {
    dir,
    waitMs: Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : DEFAULT_WAIT_MS,
    peek,
    ensure,
    byMediaId,
    countGate,
    /** Resolves when every learned record queued so far is on disk (tests, shutdown). */
    flush: () => persistQueue,
    health: () => ({
      enabled: true,
      ...counters,
      gate: { ...counters.gate },
      records: records.size,
      photos: photos.size,
      retained_photos: retained.size,
      in_flight: inFlight.size,
      backing_off: [...failedUntil.values()].filter(until => until > now()).length,
      client: typeof upstream.health === 'function' ? upstream.health() : null,
    }),
  };
}

let singleton;
let singletonDir;
let override; // undefined: follow env; null: feature forced off; object: that instance

/** The service for PARRANDA_PLACE_MEDIA_DIR, or null when the feature is off. */
function getPlaceMedia() {
  if (override !== undefined) return override;
  const dir = process.env.PARRANDA_PLACE_MEDIA_DIR;
  if (!dir || !dir.trim()) return null;
  if (!singleton || singletonDir !== dir) {
    singleton = createPlaceMedia({ dir: dir.trim() });
    singletonDir = dir;
  }
  return singleton;
}

/** Tests: an instance, null (feature off), or undefined (back to env). */
function setPlaceMediaForTests(instance) {
  override = instance;
}

module.exports = {
  createPlaceMedia,
  getPlaceMedia,
  setPlaceMediaForTests,
  INDEX_FILE,
  LEARNED_FILE,
  RETAINED_FILE,
  RETAIN_MS,
  DEFAULT_WAIT_MS,
  appendRetainedPhotos,
};
