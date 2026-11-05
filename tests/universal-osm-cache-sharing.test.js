'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createOpenDataLoader, mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { publicSourceUrlsForRecords } = require('../server/place-candidates/source-url-evidence');

const request = { lat: 44.8178, lng: 20.4569, requestedIntents: ['second_hand'], dayRhythm: 'balanced' };
const oldKey = 'v10:44.818,20.457:r1.5:wnone:l25:munknown:isecond_hand:tnone:snone';

test('owned previous-query disk fallback retains sharing destinations without renewing its source facts', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'universal-osm-share-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const namespace of ['overpass', 'unrelated-cache']) {
    let now = 1000;
    const options = { dir, namespace, ttlMs: 1000, now: () => now };
    const record = mapOsmElement({ type: 'node', id: 77, lat: request.lat, lon: request.lng,
      tags: { name: 'Source bookstore', shop: 'second_hand', website: 'https://books.example.org/store' } });
    const writer = createSourceCache(options);
    writer.set(oldKey, { records: [record], status: 'loaded:1', error: null, metadata: null });
    const before = writer.inspect(oldKey);
    now = before.expiresAt + 500;
    const cache = createSourceCache(options);
    const loader = createOpenDataLoader({ radiusKm: 1.5, limit: 25, cache, now: () => now, staleIfErrorMs: 5000,
      endpoint: 'https://controlled.example/interpreter', fetcher: async () => ({ ok: false, status: 502 }) });
    const rows = await loader(request);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0], record, 'precondition: source facts were decoded from disk');
    assert.deepEqual(rows[0], record);
    assert.equal(rows.loader_error, 'stale_cache_refresh_failed');
    assert.deepEqual(rows.loader_metadata.cache, { served_stale: true, stale_age_seconds: 0,
      refresh_reason: 'http_non_200', query_contract: 'previous' });
    assert.deepEqual(cache.inspect(oldKey), before, 'source observation and expiry remain unchanged');
    assert.equal(cache.inspect(`q2:${oldKey}`), null, 'fallback never becomes fresh expanded-query coverage');
    assert.deepEqual([...publicSourceUrlsForRecords(rows)], namespace === 'overpass'
      ? ['https://www.openstreetmap.org/node/77', 'https://books.example.org/store'] : [],
    'only the existing source-owned cache may confer sharing destinations');
    assert.deepEqual([...publicSourceUrlsForRecords(structuredClone(rows))], [], 'JSON-shaped public copies acquire no authority');
  }
});
