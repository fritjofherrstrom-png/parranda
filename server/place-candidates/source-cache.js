"use strict";

/**
 * Persistent-capable cache for trusted source acquisition (Overpass / geocode).
 *
 * The open-data loader and place resolver hit rate-limited public endpoints
 * (Overpass, Nominatim). Before any of that can be turned on in a deploy, repeat
 * and concurrent lookups for the same place must not re-hit the network — the
 * "no public flip without persistent caching" guardrail. This module is that
 * cache:
 *
 *   - TTL per entry (stable place data → hours, not seconds).
 *   - In-flight de-duplication: concurrent identical lookups share one producer
 *     call instead of N parallel network hits.
 *   - Optional FILE backing (`dir`, from `PARRANDA_CACHE_DIR`): when a writable
 *     directory is configured the cache survives across requests on disk; point
 *     it at a mounted persistent disk and it survives redeploys/restarts too.
 *     With no dir it is an in-memory cache — still coalesces and de-dupes within
 *     the running instance, just not across restarts.
 *   - Only successful values are stored (`shouldStore`), so a transient error is
 *     never frozen into the cache.
 *
 * It is GENERIC (key → JSON-serializable value); the loader/resolver own how they
 * shape and re-hydrate their own results. Fail-open: any filesystem error
 * degrades to the in-memory path, never throws into the request.
 */

const nodeFs = require("node:fs");
const nodePath = require("node:path");

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h — place data is stable

function safeFileName(key) {
  // Deterministic, filesystem-safe name from an arbitrary cache key.
  const slug = String(key).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
  return `${slug || "key"}.json`;
}

function createSourceCache(options = {}) {
  const {
    namespace = "source",
    ttlMs = DEFAULT_TTL_MS,
    dir = null,
    now = () => Date.now(),
    fs = nodeFs,
    path = nodePath,
  } = options;

  const boundedTtlMs = Math.max(0, Math.floor(Number(ttlMs) || 0));
  const mem = new Map(); // key -> { value, expiresAt }
  const inFlight = new Map(); // key -> Promise<value>
  const fileDir = dir ? path.join(dir, namespace) : null;
  let fileReady = false;

  function ensureFileDir() {
    if (!fileDir || fileReady) return fileReady;
    try {
      fs.mkdirSync(fileDir, { recursive: true });
      fileReady = true;
    } catch (_error) {
      fileReady = false; // fail open: behave as in-memory only
    }
    return fileReady;
  }

  function fresh(entry) {
    return entry && typeof entry.expiresAt === "number" && entry.expiresAt > now();
  }

  function readFile(key) {
    if (!ensureFileDir()) return null;
    try {
      const raw = fs.readFileSync(path.join(fileDir, safeFileName(key)), "utf8");
      const entry = JSON.parse(raw);
      return fresh(entry) ? entry : null;
    } catch (_error) {
      return null; // missing / unreadable / stale-parse → treat as miss
    }
  }

  function writeFile(key, entry) {
    if (!ensureFileDir()) return;
    const target = path.join(fileDir, safeFileName(key));
    const tmp = `${target}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(entry));
      fs.renameSync(tmp, target); // atomic-ish replace
    } catch (_error) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch (_cleanup) {
        /* fail open */
      }
    }
  }

  /**
   * Return the cached value for `key`, or produce + store it.
   * @param {string} key
   * @param {() => Promise<any>} producer  computes the value on a miss
   * @param {{ shouldStore?: (value:any) => boolean }} [opts]
   */
  async function get(key, producer, opts = {}) {
    const shouldStore = typeof opts.shouldStore === "function" ? opts.shouldStore : () => true;

    const memEntry = mem.get(key);
    if (fresh(memEntry)) return memEntry.value;

    const fileEntry = readFile(key);
    if (fileEntry) {
      mem.set(key, fileEntry); // hydrate the hot path
      return fileEntry.value;
    }

    // Coalesce concurrent identical lookups onto one producer call.
    if (inFlight.has(key)) return inFlight.get(key);

    const promise = (async () => {
      const value = await producer();
      if (shouldStore(value)) {
        const entry = { value, expiresAt: now() + boundedTtlMs };
        mem.set(key, entry);
        writeFile(key, entry);
      }
      return value;
    })();

    inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(key);
    }
  }

  // Synchronous lookup with NO producer: returns a fresh cached value (memory,
  // then disk) or null. Lets a caller decide to serve immediately on a miss and
  // warm the cache out-of-band (used for slow sources like WDQS that must not
  // block the request path).
  function peek(key) {
    const memEntry = mem.get(key);
    if (fresh(memEntry)) return memEntry.value;
    const fileEntry = readFile(key);
    if (fileEntry) {
      mem.set(key, fileEntry);
      return fileEntry.value;
    }
    return null;
  }

  // Kick a producer to populate the cache without awaiting it (de-duped by the
  // in-flight map inside get). Fire-and-forget; errors are swallowed.
  function warm(key, producer, opts = {}) {
    Promise.resolve(get(key, producer, opts)).catch(() => {});
  }

  function clear() {
    mem.clear();
    inFlight.clear();
  }

  return { get, peek, warm, clear, namespace, ttlMs: boundedTtlMs, fileBacked: Boolean(fileDir) };
}

module.exports = { createSourceCache, DEFAULT_TTL_MS };
