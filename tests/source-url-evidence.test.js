'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createWikidataSource, mapWikidataBinding, WIKIDATA_CACHE_NAMESPACE } = require('../server/place-candidates/wikidata-source');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { resolveDefaultOpenDataLoader } = require('../server/place-candidates/open-data-loader');
const { createBackgroundSource, SOURCE_COMPLETION, SOURCE_SNAPSHOT } = require('../server/place-candidates/background-source');

const helperPath = path.join(__dirname, '../server/place-candidates/source-url-evidence.js');
// The baseline has no helper. Still reach the real factory and the intended
// missing-evidence assertion, rather than treating MODULE_NOT_FOUND as RED.
const evidence = fs.existsSync(helperPath) ? require(helperPath) : null;
const collect = records => evidence ? evidence.publicSourceUrlsForRecords(records) : new Set();
const anchor = { lat: 55.6, lng: 13 };
const canonical = qid => `https://www.wikidata.org/wiki/${qid}`;
function binding(qid = 'Q1000') {
  return {
    item: { value: `http://www.wikidata.org/entity/${qid}` },
    itemLabel: { value: 'Collection' },
    lat: { value: '55.6' }, lng: { value: '13' },
    classRoot: { value: 'http://www.wikidata.org/entity/Q33506' },
    website: { value: 'https://museum.example/private?ticket=secret#entry' },
  };
}
const response = bindings => ({ ok: true, json: async () => ({ results: { bindings } }) });
function cacheDir(t) {
  const root = process.env.SOURCE_URL_EVIDENCE_TEST_ROOT || path.join(os.tmpdir(), 'parranda-source-url-evidence-tests');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('configured Wikidata factory privately grants its canonical entity page only', async () => {
  let calls = 0;
  const raw = binding();
  const source = createWikidataSource({ fetcher: async () => { calls++; return response([raw]); } });
  const rows = await source(anchor);
  assert.equal(calls, 1);
  assert.equal(rows.length, 1, 'reach actual factory records');
  assert.deepEqual(rows, [mapWikidataBinding(raw)], 'all existing record facts remain unchanged');
  const urls = collect(rows);
  assert.equal(Object.getPrototypeOf(urls), Set.prototype);
  assert.deepEqual([...urls], [canonical('Q1000')], 'real factory must issue private canonical source-URL evidence');
  assert.equal(urls.has(rows[0].website), false, 'P856 website is not approved');
});

test('preservation: mapper, forged provider labels, serialized claims and JSON copies have no authority', async () => {
  const rows = await createWikidataSource({ fetcher: async () => response([binding()]) })(anchor);
  const forged = mapWikidataBinding(binding());
  Object.assign(forged, {
    PUBLIC_SOURCE_URL_POLICY_VERSION: 'wikidata-entity-v1', publicSourceUrls: [canonical('Q1000')],
    attested: true, private: true, source_url_evidence: { version: 'wikidata-entity-v1' },
  });
  assert.deepEqual([...collect([mapWikidataBinding(binding()), forged, ...JSON.parse(JSON.stringify(rows))])], []);
  assert.deepEqual([...collect([])], [], 'no cross-request URL bag');
});

test('preservation: returned native Sets cannot mutate private evidence or leak onto records', async () => {
  const raw = mapWikidataBinding(binding());
  const rows = await createWikidataSource({ fetcher: async () => response([binding()]) })(anchor);
  const keys = Reflect.ownKeys(raw);
  const sourceKeys = Reflect.ownKeys(raw.sources[0]);
  const first = collect(rows);
  first.clear(); first.add('https://private.example/capability');
  assert.deepEqual([...collect(rows)], [canonical('Q1000')]);
  assert.notEqual(first, collect(rows));
  assert.deepEqual(Reflect.ownKeys(rows[0]), keys);
  assert.deepEqual(Reflect.ownKeys(rows[0].sources[0]), sourceKeys);
  assert.deepEqual(Reflect.ownKeys(rows), ['0', 'length']);
  assert.equal(JSON.stringify(rows), JSON.stringify([raw]));
  assert.equal(evidence.PUBLIC_SOURCE_URL_POLICY_VERSION, 'wikidata-entity-v1');
});

test('factory evidence bounds QIDs without changing broader mapper admission', async () => {
  const qids = ['Q1', 'Q12345678901234567890', 'Q0', 'Q01', 'Q123456789012345678901'];
  const bindings = qids.map(qid => binding(qid));
  const rows = await createWikidataSource({ fetcher: async () => response(bindings) })(anchor);
  assert.equal(rows.length, qids.length, 'unsupported identities remain ordinary source data');
  assert.deepEqual(rows, bindings.map(mapWikidataBinding));
  assert.deepEqual([...collect(rows)], qids.slice(0, 2).map(canonical), 'only exact bounded positive QIDs gain evidence');
});

test('closed issuer requires exact correlated ID and actual Wikidata atom, without URL repair', () => {
  const badUrls = [
    `${canonical('Q1000')}?token=private`, `${canonical('Q1000')}#secret`,
    'https://user:password@www.wikidata.org/wiki/Q1000',
    'https://www.wikidata.org.evil.example/wiki/Q1000', 'https://wikidata.org/wiki/Q1000',
    'http://www.wikidata.org/wiki/Q1000', 'https://WWW.WIKIDATA.ORG/wiki/Q1000',
    ` ${canonical('Q1000')}`, `${canonical('Q1000')} `, `${canonical('Q1000')}/`,
    'https://www.wikidata.org/wiki/%511000', canonical('Q1001'),
    'https://en.wikipedia.org/wiki/Collection', 'https://museum.example/',
  ];
  const rows = badUrls.map(url => {
    const row = mapWikidataBinding(binding()); row.sources[0].url = url; return row;
  });
  for (const id of [canonical('Q1000'), 'wikidata-Q1000\n', 'wikidata-q1000', 'wikidata-Q1000 ', 'Q1000']) {
    const row = mapWikidataBinding(binding()); row.id = id;
    if (id === 'wikidata-Q1000\n') row.sources[0].url += '\n';
    rows.push(row);
  }
  const wrongAtom = mapWikidataBinding(binding()); wrongAtom.sources[0].family = 'map'; rows.push(wrongAtom);
  for (const provider of ['osm', 'napi', 'overture', 'wikipedia', 'Wikidata']) {
    const row = mapWikidataBinding(binding()); row.sources[0].provider = provider; rows.push(row);
  }
  const before = JSON.stringify(rows);
  assert.equal(evidence.attestWikidataRecords(rows), rows, 'issuer returns original array');
  assert.equal(JSON.stringify(rows), before, 'invalid source facts are not repaired or removed');
  assert.deepEqual([...collect(rows)], [], 'unsupported URL, ID or source atom must never gain authority');
});

test('actual default loader revalidates its Wikidata cache on disk restart without provider or cache renewal', async t => {
  const dir = cacheDir(t);
  const rows = [mapWikidataBinding(binding())];
  const cache = createSourceCache({ namespace: WIKIDATA_CACHE_NAMESPACE, dir });
  cache.set('55.600,13.000', rows);
  assert.deepEqual([...collect(rows)], [], 'persisted source facts begin without private evidence');
  const file = path.join(dir, WIKIDATA_CACHE_NAMESPACE, '55.600_13.000.json');
  const before = fs.readFileSync(file, 'utf8');
  const mtime = fs.statSync(file).mtimeMs;
  let wikiCalls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('wikidata.org')) { wikiCalls++; throw new Error('forbidden reacquisition'); }
    assert.ok(String(url).includes('overpass'), 'controlled primary only');
    return { ok: true, json: async () => ({ elements: [] }) };
  });
  const env = { PARRANDA_OPEN_DATA_LOADER: 'enabled', PARRANDA_WIKIDATA_SOURCE: 'enabled', PARRANDA_CACHE_DIR: dir };
  const loader = resolveDefaultOpenDataLoader(env);
  const restored = await loader(anchor);
  assert.equal(wikiCalls, 0);
  assert.deepEqual(restored, rows, 'cache migration preserves original facts and absent observation');
  assert.deepEqual([...collect(restored)], [canonical('Q1000')], 'real configured cache must locally remint evidence after JSON');
  const warm = await loader(anchor);
  assert.equal(warm[0], restored[0], 'memory retains actual record identity');
  assert.deepEqual([...collect(warm)], [canonical('Q1000')]);
  const restarted = await resolveDefaultOpenDataLoader(env)(anchor);
  assert.notEqual(restarted[0], restored[0], 'new loader reparses persisted records');
  assert.deepEqual([...collect(restarted)], [canonical('Q1000')]);
  assert.equal(wikiCalls, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.statSync(file).mtimeMs, mtime, 'private proof is not a new acquisition or TTL renewal');
});

test('namespace-owned real cache get remints on memory and disk without changing expiry or source facts', async t => {
  const dir = cacheDir(t);
  let writes = 0;
  const countedFs = { ...fs, writeFileSync(...args) { writes++; return fs.writeFileSync(...args); } };
  const options = { namespace: WIKIDATA_CACHE_NAMESPACE, dir, now: () => 1000, ttlMs: 5000, fs: countedFs };
  const rawCache = createSourceCache(options);
  const original = [mapWikidataBinding(binding())];
  original[0].observedAt = '2020-01-01T00:00:00Z';
  original[0].attestation = { policy: 'future-fake', urls: ['https://private.example/'] };
  Object.defineProperty(original, 'source_error', { value: 'original_failure' });
  Object.defineProperty(original, 'loader_metadata', { value: { observedAt: null, cache: { served_stale: true } } });
  rawCache.set('memory', original);
  const file = path.join(dir, WIKIDATA_CACHE_NAMESPACE, 'memory.json');
  const before = fs.readFileSync(file, 'utf8'); const mtime = fs.statSync(file).mtimeMs;
  const facade = evidence.createWikidataAttestingCache(rawCache, WIKIDATA_CACHE_NAMESPACE);
  const noProducer = () => assert.fail('cached read must not reacquire');
  assert.deepEqual([...collect(original)], []);
  const memory = await facade.get('memory', noProducer);
  assert.equal(memory, original);
  assert.equal(memory.source_error, 'original_failure');
  assert.equal(memory.loader_metadata, original.loader_metadata);
  assert.deepEqual([...collect(memory)], [canonical('Q1000')], 'memory get must remint');
  const restarted = evidence.createWikidataAttestingCache(createSourceCache(options), WIKIDATA_CACHE_NAMESPACE);
  const disk = await restarted.get('memory', noProducer);
  assert.notEqual(disk[0], memory[0]);
  assert.deepEqual(disk, JSON.parse(before).value);
  assert.deepEqual([...collect(disk)], [canonical('Q1000')], 'cold get must remint, not trust cached claims');
  const coldPeek = evidence.createWikidataAttestingCache(createSourceCache(options), WIKIDATA_CACHE_NAMESPACE).peek('memory');
  assert.notEqual(coldPeek[0], disk[0]);
  assert.deepEqual([...collect(coldPeek)], [canonical('Q1000')], 'cold peek also remints');
  assert.equal(writes, 1, 'only the intentional initial acquisition store writes');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  assert.equal(rawCache.inspect('memory').expiresAt, 6000);
});

test('preservation: wrong namespaces and public cache flags cannot authorize records', async () => {
  for (const [namespace, expected] of [['osm', 'osm'], ['osm', WIKIDATA_CACHE_NAMESPACE], [WIKIDATA_CACHE_NAMESPACE, 'osm']]) {
    const cache = createSourceCache({ namespace });
    const rows = [mapWikidataBinding(binding())];
    rows[0].source_url_evidence = { policy: 'wikidata-entity-v1', urls: [canonical('Q1000')] };
    rows[0].attested = true;
    cache.set('key', rows);
    const facade = evidence.createWikidataAttestingCache(cache, expected);
    assert.equal(facade, cache);
    assert.equal(facade.peek('key'), rows);
    assert.equal(await facade.get('key', () => assert.fail('no acquisition')), rows);
    assert.deepEqual([...collect(rows)], []);
  }
});

test('preservation: cache facade forwards original producer, options, health, expiry and errors', async () => {
  let clock = 1000;
  const raw = createSourceCache({ namespace: WIKIDATA_CACHE_NAMESPACE, now: () => clock, ttlMs: 20 });
  const wrapped = evidence.createWikidataAttestingCache(raw, WIKIDATA_CACHE_NAMESPACE);
  for (const name of ['inspect', 'set', 'clear', 'warm', 'namespace', 'ttlMs', 'fileBacked']) assert.equal(wrapped[name], raw[name]);
  const rows = [mapWikidataBinding(binding())];
  const controller = new AbortController();
  let calls = 0; let stores = 0;
  const producer = async () => { calls++; return rows; };
  const opts = { signal: controller.signal, shouldStore(value) { stores++; assert.equal(value, rows); return false; } };
  const get = raw.get;
  raw.get = function (...args) {
    assert.equal(this, raw); assert.deepEqual(args, ['key', producer, opts]);
    return get.apply(this, args);
  };
  assert.equal(await wrapped.get('key', producer, opts), rows);
  assert.equal(calls, 1); assert.equal(stores, 1); assert.equal(raw.peek('key'), null);
  raw.get = get;
  raw.set('stale', rows); clock = 1021;
  const failed = [];
  Object.defineProperty(failed, 'source_error', { value: 'original_failure' });
  const stale = await wrapped.get('stale', async () => failed, {
    shouldStore: () => false, staleIfErrorMs: 5,
    onStale(value, info) { assert.equal(value, rows); assert.equal(info.refreshValue, failed); return value; },
  });
  assert.equal(stale, rows); assert.equal(raw.inspect('stale').expiresAt, 1020);
  const failure = new Error('original rejection');
  await assert.rejects(wrapped.get('failed', () => Promise.reject(failure)), error => error === failure);
  controller.abort();
  await assert.rejects(wrapped.get('aborted', () => assert.fail('no abandoned producer'), { signal: controller.signal }), { name: 'AbortError' });
});

test('preservation: background readCached remints and original completion never substitutes a newer cache entry', async () => {
  const raw = createSourceCache({ namespace: WIKIDATA_CACHE_NAMESPACE });
  const wrapped = evidence.createWikidataAttestingCache(raw, WIKIDATA_CACHE_NAMESPACE);
  const held = [mapWikidataBinding(binding('Q900'))]; raw.set('held', held);
  const body = deferred(); let calls = 0; let producerSignal;
  const factory = createWikidataSource({ fetcher: async (_url, init) => {
    calls++; producerSignal = init.signal;
    return { ok: true, json: () => body.promise };
  } });
  const source = createBackgroundSource({ cache: wrapped, keyFor: value => value.key,
    load: factory, eager: false, waitForCompletion: false, shouldStore: value => value.length > 0 });
  assert.equal(source.eager, false); assert.equal(source.waitForCompletion, false);
  assert.equal(source.readCached({ key: 'held' }), held);
  assert.deepEqual([...collect(held)], [canonical('Q900')]);
  const a = new AbortController(); const b = new AbortController();
  const first = source.load({ ...anchor, key: 'job' }, { signal: a.signal });
  const shared = source.load({ ...anchor, key: 'job' }, { signal: b.signal });
  assert.equal(first[SOURCE_COMPLETION], shared[SOURCE_COMPLETION]);
  assert.equal(first[SOURCE_SNAPSHOT](), null);
  a.abort(); assert.equal(producerSignal.aborted, false, 'remaining original consumer owns producer');
  raw.set('job', [mapWikidataBinding(binding('Q901'))]);
  body.resolve({ results: { bindings: [binding()] } });
  const original = await first[SOURCE_COMPLETION];
  assert.equal(first[SOURCE_SNAPSHOT](), original);
  assert.deepEqual([...collect(original)], [canonical('Q1000')]);
  raw.set('job', [mapWikidataBinding(binding('Q902'))]);
  assert.equal(first[SOURCE_SNAPSHOT](), original, 'snapshot stays bound to original producer');
  assert.deepEqual([...collect(source.readCached({ key: 'job' }))], [canonical('Q902')]);
  assert.deepEqual([...collect(original)], [canonical('Q1000')]);
  assert.equal(calls, 1);
});

test('preservation: actual default loader fresh completion retains private record identity', async t => {
  const dir = cacheDir(t); const body = deferred(); const started = deferred(); let wikiCalls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('wikidata.org')) {
      wikiCalls++; started.resolve(); return { ok: true, json: () => body.promise };
    }
    assert.ok(String(url).includes('overpass'));
    return { ok: true, json: async () => ({ elements: [] }) };
  });
  const loader = resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: 'enabled', PARRANDA_WIKIDATA_SOURCE: 'enabled', PARRANDA_CACHE_DIR: dir });
  const loading = loader(anchor);
  await started.promise;
  const initial = await loading;
  assert.equal(initial.length, 0);
  assert.ok(initial[SOURCE_COMPLETION], 'empty primary retains the original optional acquisition');
  assert.deepEqual([...collect(initial)], []);
  body.resolve({ results: { bindings: [binding()] } });
  const completed = await initial[SOURCE_COMPLETION];
  assert.deepEqual([...collect(completed)], [canonical('Q1000')]);
  assert.equal(initial[SOURCE_SNAPSHOT]()[0], completed[0]);
  assert.deepEqual([...collect(initial[SOURCE_SNAPSHOT]())], [canonical('Q1000')]);
  assert.deepEqual([...collect(await loader(anchor))], [canonical('Q1000')]);
  assert.equal(wikiCalls, 1);
});

test('proof protocol refuses getters, proxies and hostile array behavior without executing them', () => {
  let executions = 0;
  const getter = value => ({ configurable: true, get() { executions++; return value; } });
  const proxy = value => new Proxy(value, {
    get(target, key) { executions++; return Reflect.get(target, key); },
    getOwnPropertyDescriptor(target, key) { executions++; return Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { executions++; return Reflect.getPrototypeOf(target); },
    ownKeys(target) { executions++; return Reflect.ownKeys(target); },
  });
  const raw = () => mapWikidataBinding(binding());
  const withId = raw(); Object.defineProperty(withId, 'id', getter(withId.id));
  const withSources = raw(); Object.defineProperty(withSources, 'sources', getter(withSources.sources));
  const withUrl = raw(); Object.defineProperty(withUrl.sources[0], 'url', getter(canonical('Q1000')));
  const withProvider = raw(); Object.defineProperty(withProvider.sources[0], 'provider', getter('wikidata'));
  const index = [raw()]; Object.defineProperty(index, '0', getter(index[0]));
  const iterator = [raw()]; Object.defineProperty(iterator, Symbol.iterator, getter(Array.prototype[Symbol.iterator]));
  const sourceIndex = raw(); Object.defineProperty(sourceIndex.sources, '0', getter(sourceIndex.sources[0]));
  const sourceProxy = raw(); sourceProxy.sources = proxy(sourceProxy.sources);
  const atomProxy = raw(); atomProxy.sources[0] = proxy(atomProxy.sources[0]);
  const revoked = Proxy.revocable(raw(), {}); revoked.revoke();
  const cases = [[withId], [withSources], [withUrl], [withProvider], index, iterator, [sourceIndex],
    [sourceProxy], [atomProxy], [proxy(raw())], proxy([raw()]), [revoked.proxy]];
  for (let i = 0; i < cases.length; i++) {
    const rows = cases[i];
    assert.equal(evidence.attestWikidataRecords(rows), rows);
    assert.equal(executions, 0, `issuer must not execute hostile case ${i}`);
    assert.deepEqual([...collect(rows)], [], `hostile case ${i} has no evidence`);
    assert.equal(executions, 0, `reader must not execute hostile case ${i}`);
  }
});

test('cache facade discovery never executes getters or proxy traps and preserves optional metadata', () => {
  let executions = 0;
  const cache = createSourceCache({ namespace: WIKIDATA_CACHE_NAMESPACE });
  Object.defineProperty(cache, 'optionalMetadata', { get() { executions++; return 'opaque'; } });
  const facade = evidence.createWikidataAttestingCache(cache, WIKIDATA_CACHE_NAMESPACE);
  assert.equal(executions, 0, 'wrapping must not evaluate metadata accessors');
  assert.equal(facade.optionalMetadata, 'opaque', 'metadata remains available when deliberately requested');
  assert.equal(executions, 1);
  executions = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'namespace', { get() { executions++; return WIKIDATA_CACHE_NAMESPACE; } });
  const proxy = new Proxy(cache, {
    get() { executions++; }, ownKeys() { executions++; return []; },
    getOwnPropertyDescriptor() { executions++; }, getPrototypeOf() { executions++; return null; },
  });
  assert.equal(evidence.createWikidataAttestingCache(accessor, WIKIDATA_CACHE_NAMESPACE), accessor);
  assert.equal(evidence.createWikidataAttestingCache(proxy, WIKIDATA_CACHE_NAMESPACE), proxy);
  assert.equal(executions, 0, 'known hostile cache inputs never execute');
});

test('reader cannot transfer a private witness to changed identity or a replaced source atom', async () => {
  for (const mutate of [
    row => { row.id = 'wikidata-Q1001'; },
    row => { row.sources[0].url = `${canonical('Q1000')}?token=secret`; },
    row => { row.sources[0].provider = 'osm'; },
    row => { row.sources[0] = { ...row.sources[0] }; },
    row => { row.sources = [{ ...row.sources[0] }]; },
    row => { row.id = 'wikidata-Q1001'; row.sources[0].url = canonical('Q1001'); },
  ]) {
    const rows = await createWikidataSource({ fetcher: async () => response([binding()]) })(anchor);
    assert.deepEqual([...collect(rows)], [canonical('Q1000')]);
    mutate(rows[0]);
    assert.deepEqual([...collect(rows)], [], 'changed data must not inherit previously issued authority');
  }
});

test('cache return proof does not invoke a shadowed Promise then accessor', async () => {
  const rows = [mapWikidataBinding(binding())];
  const result = Promise.resolve(rows);
  let executions = 0;
  Object.defineProperty(result, 'then', { get() { executions++; return Promise.prototype.then; } });
  const raw = createSourceCache({ namespace: WIKIDATA_CACHE_NAMESPACE });
  raw.get = () => result;
  const facade = evidence.createWikidataAttestingCache(raw, WIKIDATA_CACHE_NAMESPACE);
  const returned = facade.get('key', () => assert.fail('no acquisition'));
  assert.equal(executions, 0, 'new proof protocol must not read arbitrary Promise properties');
  assert.equal(await returned, rows);
  assert.deepEqual([...collect(rows)], [canonical('Q1000')]);
});

test('cache facade preserves the original Promise without re-assimilating a hostile returned array', async () => {
  const rows = [mapWikidataBinding(binding())];
  const original = Promise.resolve(rows);
  let executions = 0;
  Object.defineProperty(rows, 'then', { get() { executions++; return undefined; } });
  const cache = createSourceCache({ namespace: WIKIDATA_CACHE_NAMESPACE });
  cache.get = () => original;
  const facade = evidence.createWikidataAttestingCache(cache, WIKIDATA_CACHE_NAMESPACE);
  const returned = facade.get('key', () => assert.fail('no acquisition'));
  assert.equal(returned, original, 'proof must not replace the existing acquisition Promise');
  assert.equal(await returned, rows);
  assert.equal(executions, 0, 'proof must not cause additional thenable assimilation');
  assert.deepEqual([...collect(rows)], [canonical('Q1000')]);
});

test('preservation: bounded protocol handles mixed contexts without truncation or partial hostile-array authority', async () => {
  const rows = await createWikidataSource({ limit: 60,
    fetcher: async () => response(Array.from({ length: 60 }, (_, i) => binding(`Q${i + 1}`))) })(anchor);
  assert.equal(collect(rows).size, 60);
  const others = Array.from({ length: 80 }, (_, i) => ({ id: `osm-${i}`, sources: [{ provider: 'osm', url: `https://osm.example/${i}` }] }));
  assert.equal(collect([...others, ...rows]).size, 60, 'combined contexts are not capped at Wikidata source limit');
  const overSourceBound = Array.from({ length: 61 }, () => mapWikidataBinding(binding()));
  assert.equal(evidence.attestWikidataRecords(overSourceBound), overSourceBound);
  assert.deepEqual([...collect(overSourceBound)], []);
  assert.deepEqual([...collect([...rows, ...Array(5000).fill(null)])], [], 'oversized contexts refuse wholly');
  let calls = 0;
  const hostile = [rows[0], null];
  Object.defineProperty(hostile, '1', { get() { calls++; return rows[1]; } });
  assert.equal(evidence.attestWikidataRecords(hostile), hostile);
  assert.deepEqual([...collect(hostile)], [], 'do not accumulate partial authority before a bad slot');
  assert.equal(calls, 0);
  const primitiveRows = [null, undefined, true, 12, 'wikidata-Q1000', {}, ...rows];
  assert.equal(collect(primitiveRows).size, 60);
  for (const invalid of [null, undefined, {}, 'records', 12]) {
    assert.equal(evidence.attestWikidataRecords(invalid), invalid);
    assert.deepEqual([...collect(invalid)], []);
  }
});

test('preservation: hostile cached rows pass through get and peek without proof-side execution', async () => {
  let executions = 0;
  const row = mapWikidataBinding(binding());
  Object.defineProperty(row, 'id', { get() { executions++; return 'wikidata-Q1000'; } });
  const rows = [row];
  const cache = createSourceCache({ namespace: WIKIDATA_CACHE_NAMESPACE });
  cache.set('key', rows);
  const wrapped = evidence.createWikidataAttestingCache(cache, WIKIDATA_CACHE_NAMESPACE);
  assert.equal(wrapped.peek('key'), rows);
  assert.equal(await wrapped.get('key', () => assert.fail('no acquisition')), rows);
  assert.deepEqual([...collect(rows)], []);
  assert.equal(executions, 0);
  const returns = [new Proxy({}, { get() { executions++; } }), Object.defineProperty({}, 'then', { get() { executions++; } })];
  for (const result of returns) {
    cache.get = () => result;
    assert.equal(wrapped.get('key'), result, 'unsupported result protocol passes through without minting');
  }
  assert.equal(executions, 0);
});

test('preservation: fresh factory failure and late body abort do not issue evidence or change JSON', async () => {
  for (const fetcher of [async () => ({ ok: false }), async () => { throw new Error('offline'); },
    async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } })]) {
    const rows = await createWikidataSource({ fetcher })(anchor);
    assert.equal(JSON.stringify(rows), '[]'); assert.deepEqual([...collect(rows)], []);
  }
  const body = deferred(); const started = deferred(); const controller = new AbortController(); let calls = 0;
  const source = createWikidataSource({ fetcher: async () => {
    calls++; started.resolve(); return { ok: true, json: () => body.promise };
  } });
  const loading = source({ ...anchor, signal: controller.signal }); await started.promise;
  controller.abort(); body.resolve({ results: { bindings: [binding()] } });
  const rows = await loading;
  assert.equal(JSON.stringify(rows), '[]'); assert.deepEqual([...collect(rows)], []);
  assert.deepEqual(await source({ ...anchor, signal: controller.signal }), []);
  assert.equal(calls, 1);
});

test('preservation: a genuinely new process remints both persisted cache read paths without acquisition or writes', t => {
  const dir = cacheDir(t);
  const cache = createSourceCache({ namespace: WIKIDATA_CACHE_NAMESPACE, dir });
  cache.set('cold', [mapWikidataBinding(binding())]);
  const file = path.join(dir, WIKIDATA_CACHE_NAMESPACE, 'cold.json');
  const bytes = fs.readFileSync(file, 'utf8'); const mtime = fs.statSync(file).mtimeMs;
  const program = `
    'use strict';
    const fs = require('node:fs');
    const { createSourceCache } = require(${JSON.stringify(require.resolve('../server/place-candidates/source-cache'))});
    const { createWikidataAttestingCache, publicSourceUrlsForRecords } = require(${JSON.stringify(helperPath)});
    const namespace = ${JSON.stringify(WIKIDATA_CACHE_NAMESPACE)};
    let writes = 0; let producers = 0; let fetches = 0;
    globalThis.fetch = () => { fetches++; throw new Error('no provider permitted'); };
    const readOnlyFs = { ...fs, writeFileSync() { writes++; throw new Error('no write permitted'); } };
    const options = { namespace, dir: process.argv[1], fs: readOnlyFs };
    (async () => {
      const getCache = createSourceCache(options);
      const before = publicSourceUrlsForRecords(getCache.peek('cold'));
      const get = await createWikidataAttestingCache(getCache, namespace).get('cold', () => { producers++; return []; });
      const peek = createWikidataAttestingCache(createSourceCache(options), namespace).peek('cold');
      console.log(JSON.stringify({ before: [...before], get: [...publicSourceUrlsForRecords(get)],
        peek: [...publicSourceUrlsForRecords(peek)], writes, producers, fetches,
        facts: get, distinct: get[0] !== peek[0] }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const output = execFileSync(process.execPath, ['--require', require.resolve('./helpers/no-live-network'), '-e', program, dir], { encoding: 'utf8' });
  const receipt = JSON.parse(output);
  assert.deepEqual(receipt, { before: [], get: [canonical('Q1000')], peek: [canonical('Q1000')],
    writes: 0, producers: 0, fetches: 0, facts: [mapWikidataBinding(binding())], distinct: true });
  assert.equal(fs.readFileSync(file, 'utf8'), bytes); assert.equal(fs.statSync(file).mtimeMs, mtime);
});

test('preservation: real cache rejects unsupported destinations unchanged and remints current canonical evidence only', async t => {
  const dir = cacheDir(t);
  const rows = [mapWikidataBinding(binding())];
  for (const url of [`${canonical('Q1000')}?ticket=private`, `${canonical('Q1000')}#private`,
    'https://user@www.wikidata.org/wiki/Q1000', 'https://www.wikidata.org.evil/wiki/Q1000',
    ` ${canonical('Q1000')}`, canonical('Q1001')]) {
    const row = mapWikidataBinding(binding()); row.sources[0].url = url;
    row.attested = true; row.publicSourceUrls = [url]; row.policy = 'wikidata-entity-v1';
    rows.push(row);
  }
  const wrongId = mapWikidataBinding(binding('Q123456789012345678901')); rows.push(wrongId);
  const wrongSource = mapWikidataBinding(binding()); wrongSource.sources[0].provider = 'osm'; rows.push(wrongSource);
  const raw = createSourceCache({ namespace: WIKIDATA_CACHE_NAMESPACE, dir }); raw.set('guarded', rows);
  for (const read of ['get', 'peek']) {
    const cache = evidence.createWikidataAttestingCache(createSourceCache({ namespace: WIKIDATA_CACHE_NAMESPACE, dir }), WIKIDATA_CACHE_NAMESPACE);
    const returned = read === 'get' ? await cache.get('guarded', () => assert.fail('no producer')) : cache.peek('guarded');
    assert.deepEqual(returned, rows);
    assert.deepEqual([...collect(returned)], [canonical('Q1000')]);
    for (const row of returned.slice(1)) assert.deepEqual([...collect([row])], []);
  }
});

test('preservation: background last-consumer abort retains original failure health and never stores late rows', async () => {
  const raw = createSourceCache({ namespace: WIKIDATA_CACHE_NAMESPACE });
  const cache = evidence.createWikidataAttestingCache(raw, WIKIDATA_CACHE_NAMESPACE);
  const body = deferred(); const controller = new AbortController(); let producerSignal;
  const factory = createWikidataSource({ fetcher: async (_url, init) => {
    producerSignal = init.signal; return { ok: true, json: () => body.promise };
  } });
  const source = createBackgroundSource({ cache, keyFor: () => 'aborted', load: factory,
    shouldStore: value => value.length > 0 });
  const pending = source.load(anchor, { signal: controller.signal });
  controller.abort(); assert.equal(producerSignal.aborted, true);
  body.resolve({ results: { bindings: [binding()] } });
  const completed = await pending[SOURCE_COMPLETION];
  assert.deepEqual(completed, []); assert.deepEqual([...collect(completed)], []);
  assert.equal(raw.peek('aborted'), null); assert.equal(pending[SOURCE_SNAPSHOT](), completed);
  const failure = new Error('original failure');
  const failedSource = createBackgroundSource({ cache, keyFor: () => 'failed', load: () => Promise.reject(failure) });
  const failed = await failedSource.load(anchor)[SOURCE_COMPLETION];
  assert.equal(failed.source_error, 'fetch_error');
  assert.equal(JSON.stringify(failed), '[]'); assert.deepEqual([...collect(failed)], []);
});
