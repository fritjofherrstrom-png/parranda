'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenDataLoader, buildOverpassQuery, mapOsmElement, mapOverpassResponse } = require('../server/place-candidates/open-data-loader');
const { matchCandidateToIntent } = require('../server/candidates/intent-vocabulary');
const { createSourceCache } = require('../server/place-candidates/source-cache');

const anchor = { lat: 44.8178, lng: 20.4569 };
const node = (id, tags) => ({ type: 'node', id, lat: anchor.lat + id * .00001, lon: anchor.lng, tags: { name: `Берза ${id}`, ...tags } });

test('explicit second-hand clothes and books survive mapping with source facts intact', () => {
  for (const shop of ['clothes', 'books']) for (const second_hand of ['yes', 'only']) {
    const record = mapOsmElement(node(1, { shop, second_hand, opening_hours: 'Mo-Sa 10:00-18:00', 'addr:street': 'Улица', 'addr:housenumber': '2' }));
    assert.ok(record, `${shop}, second_hand=${second_hand}`);
    assert.equal(record.type, 'vintage-shop');
    assert.equal(record.name, 'Берза 1');
    assert.equal(matchCandidateToIntent(record, 'second_hand').level, 'strong');
    assert.equal(record.opening_hours, 'Mo-Sa 10:00-18:00');
    assert.equal(record.sources.length, 1, 'classification never invents corroboration');
    assert.equal(record.sources[0].family, 'map');
    assert.deepEqual(record.source_address, { street: 'Улица', house_number: '2' });
  }
});

test('ordinary retail, irrelevant used merchandise and name-only claims stay outside second hand', () => {
  for (const shop of ['clothes', 'books']) for (const second_hand of [undefined, 'no', 'unknown', 'yes;no']) {
    assert.equal(mapOsmElement(node(1, { shop, second_hand, name: 'Vintage second hand' })), null);
  }
  for (const shop of ['car', 'computer', 'mobile_phone', 'electronics', 'vacant']) {
    assert.equal(mapOsmElement(node(2, { shop, second_hand: 'only' })), null, shop);
  }
  assert.equal(mapOsmElement(node(3, { shop: 'clothes', description: 'second hand vintage', name: 'Vintage shop' })), null);
});

test('real query includes compound selectors and supported relations in unchanged category quotas', () => {
  const q = buildOverpassQuery({ ...anchor, radiusM: 1500, limit: 150 });
  assert.match(q, /^\[out:json\]\[timeout:25\];/);
  for (const shop of ['clothes', 'books']) for (const value of ['yes', 'only']) {
    assert.ok(q.includes(`node["shop"="${shop}"]["second_hand"="${value}"](around:1500,44.8178,20.4569);`), `${shop}/${value} guarded selector`);
  }
  for (const [key, value] of [['leisure', 'park'], ['tourism', 'museum'], ['shop', 'second_hand']]) {
    assert.ok(q.includes(`relation["${key}"="${value}"](around:1500,44.8178,20.4569);`));
  }
  const quotas = [...q.matchAll(/out center (\d+);/g)].map(match => Number(match[1]));
  assert.deepEqual(quotas, Array(8).fill(19), 'new element types share the existing bounded category output');
  assert.ok(!q.includes('"shop"="car"'));
  assert.ok(!q.includes('"shop"="clothes"](around'), 'ordinary clothes must not be fetched');
});

test('relation identity, finite center and lifecycle retain existing gates', () => {
  const relation = { type: 'relation', id: 9, center: { lat: anchor.lat, lon: anchor.lng }, tags: { name: 'Парк', leisure: 'park' } };
  const mapped = mapOsmElement(relation);
  assert.equal(mapped.id, 'osm-relation-9');
  assert.equal(matchCandidateToIntent(mapped, 'green').level, 'strong');
  assert.equal(mapped.sources[0].url, 'https://www.openstreetmap.org/relation/9');
  assert.equal(mapOsmElement({ ...relation, center: undefined }), null);
  assert.equal(mapOsmElement({ ...relation, center: { lat: NaN, lon: anchor.lng } }), null);
  assert.equal(mapOverpassResponse({ elements: [relation, relation] }, 25).length, 1);
  const closed = mapOsmElement(node(5, { shop: 'clothes', second_hand: 'only', opening_hours: 'closed', disused: 'yes' }));
  assert.ok(closed, 'closed evidence remains available to the downstream gate');
  assert.equal(closed.operational_status, 'inactive');
  assert.equal(closed.opening_hours, 'closed');
});

test('real loader acquires compound shops and relations without another request or extra output', async () => {
  let calls = 0;
  const shops = Array.from({ length: 8 }, (_, i) => node(i + 1, { shop: i % 2 ? 'books' : 'clothes', second_hand: i % 2 ? 'yes' : 'only' }));
  const controls = Array.from({ length: 8 }, (_, i) => node(20 + i, i % 2 ? { amenity: 'cafe' } : { leisure: 'park' }));
  const loader = createOpenDataLoader({ radiusKm: 1.5, limit: 25, endpoint: 'https://controlled.example/interpreter', fetcher: async (_url, options) => {
    calls++;
    const q = new URLSearchParams(options.body).get('data');
    assert.ok(q.includes('["shop"="clothes"]["second_hand"="only"]'));
    assert.ok(q.includes('relation["leisure"="park"]'));
    return { ok: true, json: async () => ({ elements: [...shops, ...controls] }) };
  } });
  const rows = await loader({ ...anchor, requestedIntents: ['second_hand'], dayRhythm: 'balanced' });
  assert.equal(calls, 1);
  assert.equal(rows.length, 16);
  assert.equal(rows.filter(r => matchCandidateToIntent(r, 'second_hand').level === 'strong').length, 8);
  assert.equal(rows.loader_error, null);
});

test('new acquisition contract does not reuse a fresh old negative map cache', async () => {
  const cache = createSourceCache({ now: () => 1000, ttlMs: 10000 });
  const oldKey = 'v10:44.818,20.457:r1.5:wnone:l25:munknown:isecond_hand:tnone:snone';
  cache.set(oldKey, { records: [], status: 'loaded:0', error: null, metadata: null });
  let calls = 0;
  const loader = createOpenDataLoader({ radiusKm: 1.5, cache, endpoint: 'https://controlled.example/interpreter', fetcher: async () => {
    calls++;
    return { ok: true, json: async () => ({ elements: Array.from({ length: 16 }, (_, i) => node(i, i < 8
      ? { shop: 'clothes', second_hand: 'only' } : i % 2 ? { amenity: 'cafe' } : { leisure: 'park' })) }) };
  } });
  const request = { ...anchor, requestedIntents: ['second_hand'], dayRhythm: 'balanced' };
  const rows = await loader(request);
  assert.equal(calls, 1);
  assert.equal(rows.filter(r => matchCandidateToIntent(r, 'second_hand').level === 'strong').length, 8);
  assert.deepEqual(cache.peek(oldKey).records, [], 'old evidence is preserved, never overwritten or relabelled');
  assert.equal((await loader(request)).length, rows.length);
  assert.equal(calls, 1, 'same new contract remains cacheable');
});

test('previous-contract positive evidence remains bounded outage fallback without being made fresh', async () => {
  for (const age of [0, 6000]) {
    let now = 1000;
    const cache = createSourceCache({ now: () => now, ttlMs: 1000 });
    const oldKey = 'v10:44.818,20.457:r1.5:wnone:l25:munknown:isecond_hand:tnone:snone';
    const record = mapOsmElement(node(77, { shop: 'second_hand' }));
    cache.set(oldKey, { records: [record], status: 'loaded:1', error: null, metadata: null });
    const expiresAt = cache.inspect(oldKey).expiresAt;
    now = expiresAt + age;
    const loader = createOpenDataLoader({ radiusKm: 1.5, cache, now: () => now, staleIfErrorMs: 5000,
      endpoint: 'https://controlled.example/interpreter', fetcher: async () => ({ ok: false, status: 502 }) });
    const rows = await loader({ ...anchor, requestedIntents: ['second_hand'], dayRhythm: 'balanced' });
    if (age === 0) {
      assert.deepEqual(rows.map(r => r.id), [record.id]);
      assert.equal(rows.loader_error, 'stale_cache_refresh_failed');
      assert.equal(rows.loader_metadata.cache.served_stale, true);
      assert.equal(rows.loader_metadata.cache.query_contract, 'previous');
    } else assert.equal(rows.length, 0, 'expired evidence outside the existing fallback bound is not resurrected');
    assert.equal(cache.inspect(oldKey).expiresAt, expiresAt, 'migration never extends source acceptance');
  }
});

test('previous-contract evidence never replaces a healthy empty answer or crosses anchors', async () => {
  for (const scenario of ['empty', 'other-anchor']) {
    const cache = createSourceCache({ now: () => 1000, ttlMs: 10000 });
    const oldKey = 'v10:44.818,20.457:r1.5:wnone:l25:munknown:isecond_hand:tnone:snone';
    const record = mapOsmElement(node(77, { shop: 'second_hand' }));
    cache.set(oldKey, { records: [record], status: 'loaded:1', error: null, metadata: null });
    const loader = createOpenDataLoader({ radiusKm: 1.5, cache, now: () => 1000, staleIfErrorMs: 5000,
      endpoint: 'https://controlled.example/interpreter', fetcher: async () => scenario === 'empty'
        ? { ok: true, json: async () => ({ elements: [] }) } : { ok: false, status: 502 } });
    const rows = await loader({ ...anchor, ...(scenario === 'other-anchor' ? { lat: anchor.lat + 1 } : {}),
      requestedIntents: ['second_hand'], dayRhythm: 'balanced' });
    assert.equal(rows.length, 0);
    assert.notEqual(rows.loader_metadata?.cache?.query_contract, 'previous');
  }
});
