'use strict';

// Real acquisition/normalization; only official metadata and native I/O are
// controlled. These assertions are not live-provider or latency acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOvertureSource } = require('../server/place-candidates/overture-source');

const RELEASE = '2026-09-23.1';
const ANCHOR = { lat: 51.5074456, lng: -0.1277653 };
const asset = release => `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/part-00001-test.zstd.parquet`;
const row = (id = 1) => ({ id: `10000000-0000-0000-0000-${String(id).padStart(12, '0')}`,
  name: `Source cafe ${id}`, category: 'coffee_shop', category_hierarchy: ['coffee_shop'],
  confidence: .99, operating_status: 'open', websites: ['https://operator.example/'],
  brand: null, licenses: ['CC0-1.0'], ...ANCHOR });

function fixture() {
  let release = RELEASE, etag = '"source-a"', clock = 1000, failMetadata = false;
  const calls = { query: 0, verification: 0, plans: [] };
  const source = createOvertureSource({
    now: () => clock,
    releaseResolver: async () => release,
    assetResolver: async () => [asset(release)],
    assetVerifier: async (paths, { signal }) => {
      calls.verification++;
      signal?.throwIfAborted();
      if (failMetadata) throw new Error('controlled_metadata_unavailable');
      return paths.map(path => ({ path, etag, length: 12000 }));
    },
    queryRows: async (_sql, options) => {
      calls.query++;
      calls.plans.push(options.prefetch);
      const rows = [row(calls.query)];
      Object.defineProperty(rows, 'source_assets', { value: [{ path: asset(release), etag, length: 12000 }] });
      return rows;
    },
  });
  return { source, calls, set: changes => {
    if (changes.release !== undefined) release = changes.release;
    if (changes.etag !== undefined) etag = changes.etag;
    if (changes.clock !== undefined) clock = changes.clock;
    if (changes.failMetadata !== undefined) failMetadata = changes.failMetadata;
  } };
}
const previous = records => ({ records, receipt: records.source_receipt });

test('new acquisition binds normalized facts to the exact release, query and pinned source objects', async () => {
  const f = fixture();
  const records = await f.source.acquire(ANCHOR);
  assert.equal(records.length, 1);
  assert.equal(records.source_receipt?.release, RELEASE);
  assert.match(records.source_receipt.queryHash, /^[a-f0-9]{64}$/);
  assert.match(records.source_receipt.recordsHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(records.source_receipt.assets, [{ path: asset(RELEASE), etag: '"source-a"', length: 12000 }]);
  assert.equal(records.source_receipt.acquiredAt, 1000);
  assert.equal(records.source_receipt.verifiedAt, 1000);
  assert.equal(Object.keys(records).includes('source_receipt'), false);
  assert.deepEqual(f.calls.plans, [{ paths: [asset(RELEASE)], window: { ...ANCHOR, radiusKm: 5 }, distanceFilter: 'sample-radius-v1' }]);
  assert.equal(records[0].sources[0].tier, 'inferred', 'receipt must not promote source trust');
});

test('unchanged expired sample is reverified once without a bulk reread or rewriting its acquisition time', async () => {
  const f = fixture();
  const first = await f.source.acquire(ANCHOR);
  f.set({ clock: 22000000 });
  const renewed = await f.source.acquire({ ...ANCHOR, previousSample: previous(first) });
  assert.equal(f.calls.query, 1, 'only a proved unchanged input may avoid a bulk query');
  assert.equal(f.calls.verification, 1);
  assert.deepEqual(renewed, first);
  assert.equal(renewed.source_receipt.acquiredAt, 1000);
  assert.equal(renewed.source_receipt.verifiedAt, 22000000);
});

for (const [name, changes] of [
  ['changed release', { release: '2026-10-21.0' }],
  ['changed object validator in the same release', { etag: '"source-b"' }],
]) test(`${name} acquires the new facts instead of renewing old data`, async () => {
  const f = fixture();
  const first = await f.source.acquire(ANCHOR);
  f.set({ ...changes, clock: 22000000 });
  const next = await f.source.acquire({ ...ANCHOR, previousSample: previous(first) });
  assert.equal(f.calls.query, 2);
  assert.notEqual(next[0].id, first[0].id);
  assert.equal(next.source_receipt?.acquiredAt, 22000000);
  assert.equal(next.source_receipt?.assets[0].etag, changes.etag || '"source-a"');
});

test('failed source verification returns a source failure, without claiming fresh old rows or a hidden second read', async () => {
  const f = fixture();
  const first = await f.source.acquire(ANCHOR);
  f.set({ failMetadata: true, clock: 22000000 });
  const result = await f.source.acquire({ ...ANCHOR, previousSample: previous(first) });
  assert.equal(result.source_error, 'fetch_error');
  assert.equal(result.length, 0);
  assert.equal(result.source_receipt, undefined);
  assert.equal(f.calls.query, 1);
  assert.equal(first.source_receipt?.verifiedAt, 1000);
});

for (const [name, mutate] of [
  ['bare legacy sample', p => ({ records: p.records })],
  ['tampered records', p => ({ ...p, records: [{ ...p.records[0], name: 'Unproved changed facts' }] })],
  ['wrong query identity', p => ({ ...p, receipt: { ...p.receipt, queryHash: '0'.repeat(64) } })],
  ['weak validator', p => ({ ...p, receipt: { ...p.receipt, assets: [{ ...p.receipt.assets[0], etag: 'W/"weak"' }] } })],
]) test(`${name} cannot be declared unchanged`, async () => {
  const f = fixture();
  const first = await f.source.acquire(ANCHOR);
  const candidate = first.source_receipt ? mutate(previous(first)) : { records: first };
  f.set({ clock: 22000000 });
  const next = await f.source.acquire({ ...ANCHOR, previousSample: candidate });
  assert.equal(f.calls.query, 2);
  assert.equal(f.calls.verification, 0, 'invalid proof goes directly to ordinary cold acquisition');
  assert.notEqual(next[0].id, first[0].id);
});

test('another anchor cannot reuse a proved sample from a different window', async () => {
  const f = fixture();
  const first = await f.source.acquire(ANCHOR);
  await f.source.acquire({ ...ANCHOR, lat: ANCHOR.lat + .001, previousSample: previous(first) });
  assert.equal(f.calls.query, 2);
  assert.equal(f.calls.verification, 0);
});

test('a newly reverified complete empty manifest renews absence without any object HEAD or native read', async () => {
  let clock = 1000, unavailable = false, queries = 0;
  const source = createOvertureSource({ now: () => clock, releaseResolver: async () => RELEASE,
    assetResolver: async () => { if (unavailable) throw new Error('controlled_unavailable'); return []; },
    queryRows: async () => { queries++; throw new Error('no selected assets'); },
  });
  const first = await source.acquire(ANCHOR);
  clock = 22000000;
  const second = await source.acquire({ ...ANCHOR, previousSample: previous(first) });
  assert.equal(second.source_error, undefined);
  assert.deepEqual(second, []);
  assert.equal(second.source_receipt?.acquiredAt, 1000);
  assert.equal(second.source_receipt?.verifiedAt, 22000000);
  assert.equal(queries, 0);
  unavailable = true;
  const failed = await source.acquire({ ...ANCHOR, previousSample: previous(second) });
  assert.equal(failed.source_error, 'fetch_error');
  assert.equal(failed.source_receipt, undefined);
});
