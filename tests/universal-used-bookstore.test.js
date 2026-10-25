'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DuckDBInstance } = require('@duckdb/node-api');
const { buildOvertureQuery, categoryMapping, createOvertureSource, mapOvertureRow } = require('../server/place-candidates/overture-source');
const { mapRecordToCandidate } = require('../server/place-candidates/external-open-provider');
const { matchCandidateToIntent } = require('../server/candidates/intent-vocabulary');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createOvertureSampleCache, digest } = require('../server/place-candidates/overture-sample-cache');

const RELEASE = '2026-09-23.0';
const ANCHOR = { lat: 40, lng: 12 };
// Frozen official 2026-09-23.0 taxonomy, not an invented second_hand_store child.
const USED_HIERARCHY = ['shopping', 'specialty_store', 'books_music_and_video_store', 'bookstore', 'used_bookstore'];
const BOOK_HIERARCHY = USED_HIERARCHY.slice(0, -1);
const asset = { path: `s3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/part-books.zstd.parquet`, etag: '"books-v1"', length: 12000 };
const queryHash = sql => createHash('sha256').update('overture-v6:normalizer-1\0').update(sql).digest('hex');
function row(overrides = {}) {
  return { id: '10000000-0000-0000-0000-000000000001', name: 'Книжный двор',
    category: 'used_bookstore', category_hierarchy: USED_HIERARCHY, confidence: .99,
    operating_status: null, websites: [], brand: null, licenses: ['CC0-1.0'], ...ANCHOR, ...overrides };
}

test('explicit used_bookstore primary supplies existing second-hand meaning with unknown hours and inferred trust', () => {
  assert.deepEqual(categoryMapping('used_bookstore'), { type: 'vintage-shop', tags: ['second_hand'] });
  const record = mapOvertureRow(row());
  assert.equal(record.name, 'Книжный двор');
  assert.equal(record.type, 'vintage-shop');
  assert.deepEqual(record.tags, ['second_hand']);
  assert.deepEqual(record.sources, [{ provider: 'overture', family: 'open_directory', tier: 'inferred',
    url: 'https://overturemaps.org/', license: 'CC0-1.0' }]);
  assert.equal(record.operational_status, 'unknown');
  assert.equal(record.opening_hours, undefined);
  const candidate = mapRecordToCandidate({ key: 'coordinate-only' }, record, '2026-10-25T10:00:00Z', 0);
  assert.equal(matchCandidateToIntent(candidate, 'second_hand').level, 'strong');
  assert.equal(candidate.trust.source_tier, 'inferred');
  assert.equal(candidate.trust.human_verified, false);
  assert.equal(candidate.trust.confidence, 'needs_review');
  assert.equal(candidate.opening_hours, undefined);
  assert.equal(candidate.operational_status, 'unknown');
});

test('book names, alternate facets, malformed hierarchy and unsafe used-bookstore facts cannot grant eligibility', () => {
  const negatives = [
    { category: 'bookstore', category_hierarchy: BOOK_HIERARCHY },
    { category: 'bookstore', category_hierarchy: BOOK_HIERARCHY, alternates: ['used_bookstore'] },
    { category: 'shopping', category_hierarchy: ['shopping'], name: 'Used Bookstore Second Hand' },
    ...[undefined, [], ['shopping', 'bookstore'], ['used_bookstore', 'used_bookstore'], ['bad category', 'used_bookstore']]
      .map(category_hierarchy => ({ category_hierarchy })),
    { licenses: [] }, { licenses: ['unknown'] }, { operating_status: 'closed_permanently' },
    { operating_status: 'temporarily_closed' }, { confidence: .5 }, { lat: null },
  ];
  for (const overrides of negatives) assert.equal(mapOvertureRow(row(overrides)), null, JSON.stringify(overrides));
  const cafe = mapOvertureRow(row({ category: 'coffee_shop', category_hierarchy: ['food_and_drink', 'non_alcoholic_beverage_venue', 'coffee_shop'],
    name: 'Used Bookstore Cafe', alternates: ['used_bookstore'] }));
  assert.equal(cafe.type, 'cafe');
  assert.equal(matchCandidateToIntent(cafe, 'second_hand').level, 'none');
  const active = mapOvertureRow(row({ operating_status: 'open' }));
  assert.equal(active?.operational_status, 'source_indicated_active');
  assert.equal(active?.opening_hours, undefined, 'active operation is not verified opening hours');
});

test('real production DuckDB SQL acquires the used-bookstore primary and preserves mapper safety controls', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-used-books-sql-'));
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  t.after(() => { conn.closeSync(); instance.closeSync(); fs.rmSync(dir, { recursive: true, force: true }); });
  await conn.run(`CREATE TABLE fixtures (
    id VARCHAR, names STRUCT("primary" VARCHAR), taxonomy STRUCT("primary" VARCHAR, hierarchy VARCHAR[], alternates VARCHAR[]),
    confidence DOUBLE, operating_status VARCHAR, websites VARCHAR[], brand STRUCT(names STRUCT("primary" VARCHAR)),
    sources STRUCT(license VARCHAR)[], bbox STRUCT(xmin DOUBLE, ymin DOUBLE))`);
  const cases = [
    {},
    { category: 'bookstore', category_hierarchy: BOOK_HIERARCHY },
    { category: 'bookstore', category_hierarchy: BOOK_HIERARCHY, alternates: ['used_bookstore'] },
    { category: 'shopping', category_hierarchy: ['shopping'], name: 'Used Bookstore Second Hand' },
    { category_hierarchy: BOOK_HIERARCHY },
    { category_hierarchy: ['used_bookstore', 'used_bookstore'] },
    { licenses: ['unknown'] },
    { operating_status: 'closed_permanently' },
    { confidence: .5 },
    { lng: 13 },
  ];
  for (const [i, overrides] of cases.entries()) {
    const value = row({ ...overrides, id: `10000000-0000-0000-0000-${String(i).padStart(12, '0')}` });
    await conn.run(`INSERT INTO fixtures VALUES (?, {'primary': ?},
      ?::JSON::STRUCT("primary" VARCHAR, hierarchy VARCHAR[], alternates VARCHAR[]),
      ?, ?, [], {'names': {'primary': NULL}}, ?::JSON::STRUCT(license VARCHAR)[], {'xmin': ?, 'ymin': ?})`,
    [value.id, value.name, JSON.stringify({ primary: value.category, hierarchy: value.category_hierarchy, alternates: value.alternates || [] }),
      value.confidence, value.operating_status, JSON.stringify(value.licenses.map(license => ({ license }))), value.lng, value.lat]);
  }
  const file = path.join(dir, 'books.parquet');
  await conn.run(`COPY fixtures TO '${file}' (FORMAT PARQUET)`);
  const productionSql = buildOvertureQuery({ release: RELEASE, ...ANCHOR });
  // Only the external relation changes; filtering, stratification and limits are production.
  const rows = (await conn.runAndReadAll(productionSql.replace(/s3:\/\/[^']+/, file))).getRowObjectsJson();
  assert.deepEqual(rows.map(value => value.id).sort(), [0, 5, 6].map(i => `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`));
  assert.deepEqual(rows.map(value => mapOvertureRow(value)).filter(Boolean).map(value => value.id), ['overture-10000000-0000-0000-0000-000000000000']);
  const source = createOvertureSource({ releaseResolver: async () => RELEASE, queryRows: async () => rows });
  const selected = await source({ ...ANCHOR, requestedIntents: ['second_hand'] });
  assert.deepEqual(selected.map(value => value.id), ['overture-10000000-0000-0000-0000-000000000000']);
  assert.equal(selected[0].opening_hours, undefined);
});

for (const empty of [false, true]) test(`persisted prior-query ${empty ? 'negative' : 'positive'} samples cannot claim new used-bookstore coverage`, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-used-books-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = 1000, queries = 0, verifications = 0;
  const source = createOvertureSource({ now: () => clock, releaseResolver: async () => RELEASE,
    assetResolver: async () => [asset.path], assetVerifier: async () => { verifications++; return [asset]; },
    queryRows: async () => { queries++; const rows = [row()]; Object.defineProperty(rows, 'source_assets', { value: [asset] }); return rows; } });
  const key = source.cacheKeyFor(ANCHOR);
  // Reconstruct the previous finite-map SQL by removing exactly the new leaf
  // from its acquisition IN and route-type CASE. Everything else stays fixed.
  const priorSql = buildOvertureQuery({ release: RELEASE, parquetPaths: [asset.path], ...ANCHOR }).replace(/, 'used_bookstore'/g, '');
  const records = empty ? [] : [mapOvertureRow(row({ category: 'coffee_shop', category_hierarchy: ['coffee_shop'] }))];
  const prior = { version: 1, cacheKey: key, records, receipt: { version: 1, release: RELEASE,
    queryHash: queryHash(priorSql), assets: [asset], acquiredAt: clock, verifiedAt: clock, recordsHash: digest(records) } };
  const rawOptions = { dir, namespace: 'overture-v6', ttlMs: 100, now: () => clock };
  createSourceCache(rawOptions).set(key, prior);
  const restarted = createOvertureSampleCache({ cache: createSourceCache(rawOptions), now: () => clock, validateReceipt: source.validateReceipt });
  assert.equal(source.validateReceipt(prior.receipt, key), false);
  assert.equal(restarted.peek(key), null, 'old fresh disk sample is not new-contract coverage');
  clock = 1200;
  assert.equal(restarted.previous(key), null, 'old expired sample cannot become a renewal or stale fallback');
  const fresh = await restarted.get(key, () => source.acquire({ ...ANCHOR, previousSample: prior }));
  assert.equal(queries, 1, 'changed category SQL forces actual acquisition even with unchanged source object');
  assert.equal(verifications, 0, 'old sample cannot take the HEAD-only renewal path');
  assert.deepEqual(fresh.map(value => value.type), ['vintage-shop']);
  assert.equal(fresh.source_receipt.acquiredAt, clock);
  assert.equal(source.validateReceipt(fresh.source_receipt, key), true);
  assert.notEqual(fresh.source_receipt.queryHash, prior.receipt.queryHash);
});
