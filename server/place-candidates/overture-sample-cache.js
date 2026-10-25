'use strict';

const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const RELEASE = /^\d{4}-\d{2}-\d{2}\.\d+$/;
const MAX_FALLBACK_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ETAG = /^"[\x21\x23-\x7e]{1,200}"$/;

function validAssets(assets, release) {
  if (!Array.isArray(assets) || assets.length > 64) return false;
  const prefix = `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/`;
  const seen = new Set();
  return assets.every(asset => {
    if (!asset || typeof asset.path !== 'string' || !asset.path.startsWith(prefix)
      || !/^part-[A-Za-z0-9_-]+\.zstd\.parquet$/.test(asset.path.slice(prefix.length))
      || !ETAG.test(asset.etag) || !Number.isSafeInteger(asset.length) || asset.length < 12
      || seen.has(asset.path)) return false;
    seen.add(asset.path); return true;
  });
}

function validSample(records, receipt, now = Date.now()) {
  if (!Number.isFinite(now) || !Array.isArray(records) || records.source_error || records.length > 600
    || !receipt || receipt.version !== 1 || !RELEASE.test(receipt.release)
    || !HASH.test(receipt.queryHash) || !HASH.test(receipt.recordsHash)
    || !Number.isFinite(receipt.acquiredAt) || receipt.acquiredAt < 0
    || !Number.isFinite(receipt.verifiedAt) || receipt.verifiedAt < receipt.acquiredAt || receipt.verifiedAt > now
    || !validAssets(receipt.assets, receipt.release) || (records.length && !receipt.assets.length)) return false;
  const ids = new Set();
  for (const row of records) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || typeof row.name !== 'string' || !row.name || typeof row.type !== 'string' || !row.type
      || !Number.isFinite(row.lat) || Math.abs(row.lat) > 90 || !Number.isFinite(row.lng) || Math.abs(row.lng) > 180) return false;
    ids.add(row.id);
  }
  const json = JSON.stringify(records);
  return Buffer.byteLength(json) <= 2 * 1024 * 1024 && digest(records) === receipt.recordsHash;
}

// This adapter alone interprets retained Overture evidence. The generic cache
// does not grant freshness to old values, nor does it know release semantics.
function createOvertureSampleCache({ cache, validateReceipt = () => true, now = Date.now, maxFallbackAgeMs = MAX_FALLBACK_AGE_MS }) {
  const fallbackAgeMs = Math.max(0, Math.min(MAX_FALLBACK_AGE_MS, Number(maxFallbackAgeMs) || 0));
  function valid(value, key, at = now()) {
    try {
      return value?.version === 1 && value.cacheKey === key
        && validSample(value.records, value.receipt, at) && validateReceipt(value.receipt, key);
    } catch (_) { return false; }
  }
  function decode(value) {
    const records = structuredClone(value.records);
    Object.defineProperty(records, 'source_receipt', { value: structuredClone(value.receipt) });
    return records;
  }
  function encode(records, key) {
    const value = { version: 1, cacheKey: key, records, receipt: records?.source_receipt };
    return valid(value, key) ? structuredClone(value) : null;
  }
  const acceptedAt = entry => Math.min(now(), entry.expiresAt - cache.ttlMs);
  return {
    peek(key) {
      const entry = cache.inspect(key);
      return Number.isFinite(entry?.expiresAt) && entry.expiresAt > now() && valid(entry.value, key, acceptedAt(entry)) ? decode(entry.value) : null;
    },
    previous(key) {
      const entry = cache.inspect(key);
      if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt > now() || !valid(entry.value, key, acceptedAt(entry))) return null;
      return { records: structuredClone(entry.value.records), receipt: structuredClone(entry.value.receipt) };
    },
    async get(key, producer, options = {}) {
      const value = await cache.get(key, async () => {
        const records = await producer();
        return encode(records, key) || records;
      }, {
        signal: options.signal,
        validateCached: (value, entry) => valid(value, key, acceptedAt(entry)),
        shouldStore: value => valid(value, key) && (typeof options.shouldStore !== 'function' || options.shouldStore(decode(value))),
        staleIfErrorMs: fallbackAgeMs,
        onStale: (previous, info) => {
          // Abandoned owners and successful empty/new answers cannot use a
          // fallback. Identity, original receipt and age remain unchanged.
          options.signal?.throwIfAborted();
          const age = now() - previous.receipt.verifiedAt;
          if ((!info.refreshError && !info.refreshValue?.source_error)
            || !Number.isFinite(age) || age < 0 || age > fallbackAgeMs) {
            if (info.refreshError) throw info.refreshError;
            return info.refreshValue;
          }
          const records = decode(previous);
          Object.defineProperty(records, 'source_error', { value: 'stale_cache_refresh_failed' });
          Object.defineProperty(records, 'loader_metadata', { value: { cache: {
            served_stale: true, stale_age_seconds: Math.floor(age / 1000),
            refresh_reason: 'stale_cache_refresh_failed',
          } } });
          return records;
        },
      });
      return valid(value, key) ? decode(value) : value;
    },
  };
}

module.exports = { createOvertureSampleCache, validSample, validAssets, digest, MAX_FALLBACK_AGE_MS };
