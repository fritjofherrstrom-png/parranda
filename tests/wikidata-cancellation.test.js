const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveDefaultOpenDataLoader } = require('../server/place-candidates/open-data-loader');
const { createWikidataSource } = require('../server/place-candidates/wikidata-source');
const { createPlannerLifecycle, lifecycleLoader } = require('../server/planner/cold-lifecycle');

const anchor = { lat: 48.123, lng: 8.456 };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const payload = { results: { bindings: [{
  item: { value: 'http://www.wikidata.org/entity/Q123' }, itemLabel: { value: 'Local Museum' },
  lat: { value: String(anchor.lat) }, lng: { value: String(anchor.lng) },
  classRoot: { value: 'http://www.wikidata.org/entity/Q33506' },
}] } };

function controlledLoader(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-wiki-cancel-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    if (String(url).startsWith('https://query.wikidata.org/')) {
      const body = deferred();
      calls.push({ body, signal: init.signal });
      // Deliberately allow a late body even after abort: storage must also guard ownership.
      return { ok: true, json: () => body.promise };
    }
    assert.match(String(url), /overpass/);
    return { ok: true, json: async () => ({ elements: [] }) };
  });
  const loader = resolveDefaultOpenDataLoader({
    PARRANDA_OPEN_DATA_LOADER: 'enabled', PARRANDA_WIKIDATA_SOURCE: 'enabled', PARRANDA_CACHE_DIR: dir,
  });
  t.after(async () => { calls.forEach(call => call.body.resolve(payload)); await tick(); });
  return { loader, calls, file: path.join(dir, 'wikidata', '48.123_8.456.json') };
}

test('Wikidata cancellation reaches fetch/body and a late body never becomes records', async () => {
  const controller = new AbortController();
  const body = deferred(); let providerSignal;
  const source = createWikidataSource({ fetcher: async (_url, init) => {
    providerSignal = init.signal;
    return { ok: true, json: () => body.promise };
  } });
  const result = source({ ...anchor, signal: controller.signal });
  await tick();
  controller.abort();
  body.resolve(payload);
  assert.deepEqual(await result, []);
  assert.equal(providerSignal.aborted, true);
});

test('a cancelled lifecycle cannot persist its sole Wikidata warm or consume its late rows', async t => {
  const { loader, calls, file } = controlledLoader(t);
  const jobs = createPlannerLifecycle();
  const hold = deferred();
  const started = await jobs.start(async context => {
    await lifecycleLoader(loader, context)(anchor);
    context.warming();
    await hold.promise;
    return { status: 200, body: { days: [] } };
  });
  const token = started.body.planner_lifecycle.token;
  t.after(() => { jobs.cancel(token); hold.resolve(); });
  assert.equal(calls.length, 1);
  jobs.cancel(token);
  calls[0].body.resolve(payload);
  hold.resolve();
  await tick();
  assert.equal(calls[0].signal.aborted, true, 'lifecycle cancellation must reach the actual provider signal');
  assert.equal(fs.existsSync(file), false, 'late sole-owner response must not reach disk');
  const next = new AbortController();
  t.after(() => next.abort());
  const records = await loader({ ...anchor, signal: next.signal });
  assert.equal(records.some(row => row.id === 'wikidata-Q123'), false, 'no canceled memory-cache result');
  assert.equal(calls.length, 2);
});

test('Wikidata keeps a shared producer while another consumer owns it, then caches its result', async t => {
  const { loader, calls, file } = controlledLoader(t);
  const first = new AbortController(); const second = new AbortController();
  t.after(() => { first.abort(); second.abort(); });
  await loader({ ...anchor, signal: first.signal });
  await loader({ ...anchor, signal: second.signal });
  first.abort();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, false, 'second consumer still owns the shared query');
  calls[0].body.resolve(payload);
  await tick();
  assert.equal(fs.existsSync(file), true);
  const records = await loader({ ...anchor, signal: second.signal });
  assert.equal(records.some(row => row.id === 'wikidata-Q123'), true);
  assert.equal(calls.length, 1);
});

test('Wikidata aborts after the last shared consumer leaves and a new owner does not inherit cancelled work', async t => {
  const { loader, calls, file } = controlledLoader(t);
  const first = new AbortController(); const second = new AbortController(); const replacement = new AbortController();
  t.after(() => { first.abort(); second.abort(); replacement.abort(); });
  await loader({ ...anchor, signal: first.signal });
  await loader({ ...anchor, signal: second.signal });
  first.abort(); second.abort();
  // The old body is still outstanding when the replacement arrives.
  await loader({ ...anchor, signal: replacement.signal });
  assert.equal(calls.length, 2, 'a replacement owns a fresh producer, never the cancelled promise');
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, false);
  calls[0].body.resolve(payload);
  await tick();
  assert.equal(fs.existsSync(file), false);
  await loader({ ...anchor, signal: replacement.signal });
  assert.equal(calls.length, 2, 'old completion cannot release the replacement producer');
  calls[1].body.resolve(payload);
  await tick();
  assert.equal(fs.existsSync(file), true);
});

test('an already-cancelled Wikidata request starts no provider work', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const source = createWikidataSource({ fetcher: async () => { calls++; return { ok: true, json: async () => payload }; } });
  assert.deepEqual(await source({ ...anchor, signal: controller.signal }), []);
  assert.equal(calls, 0);
});

test('a cancelled lifecycle joining legacy non-lifecycle warming cannot abort that other consumer', async t => {
  const { loader, calls, file } = controlledLoader(t);
  const controller = new AbortController();
  await loader(anchor);
  await loader({ ...anchor, signal: controller.signal });
  controller.abort();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, false);
  calls[0].body.resolve(payload);
  await tick();
  assert.equal(fs.existsSync(file), true);
});
