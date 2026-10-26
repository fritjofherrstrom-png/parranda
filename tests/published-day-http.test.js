"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { isDeepStrictEqual } = require('node:util');
const { buildApp } = require('../server/app');
const { createPublishedDayStore } = require('../server/planner/published-day-store');

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const publication = () => ({
  language: 'en',
  intent: { selected_date: '2026-10-24', place_ref: 'n123456', preferences: ['culture'], day_rhythm: 'balanced' },
  result: { days: [{ date: '2026-10-24', primary_route: { main_stops: [
    { id: 'fixture-first', label: 'Fixture museum', lat: 55.6, lng: 13 },
    { id: 'fixture-second', label: 'Fixture café', lat: 55.601, lng: 13 },
  ] } }] },
});

function request(server, pathname, { method = 'GET', body, rawBody, headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const text = rawBody !== undefined ? rawBody : body === undefined ? null : JSON.stringify(body);
    const chunked = Object.keys(headers).some(key => key.toLowerCase() === 'transfer-encoding');
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method, signal,
      headers: { ...(text === null ? {} : { 'Content-Type': rawBody === undefined ? 'application/json' : 'text/plain',
        ...(chunked ? {} : { 'Content-Length': Buffer.byteLength(text) }) }), ...headers },
    }, res => {
      let response = '';
      res.on('data', chunk => { response += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        let parsed = null;
        try { parsed = response ? JSON.parse(response) : null; } catch { /* A baseline HTML404 is an HTTP result, not a parser setup error. */ }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Fixture HTTP request timed out')));
    req.end(text);
  });
}

async function setup(t, { storeOptions = {}, storeOverride } = {}) {
  const directory = await fs.mkdtemp(path.join(process.env.TMPDIR || process.env.RUNNER_TEMP || tmpdir(), 'published-day-http-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let now = NOW;
  const store = createPublishedDayStore({ directory, clock: () => now, ...storeOptions });
  const calls = { places: 0, resolver: 0, events: 0 };
  const app = buildApp({
    publishedDayStore: storeOverride || store,
    openDataLoader: async () => { calls.places++; return []; },
    placeResolver: async () => { calls.resolver++; return null; },
    eventSupply: async () => { calls.events++; return null; },
    placeSuggestions: null, placeSelectionStore: { read: () => null, issue: () => null },
    reviewedPlaceSource: null, sourceCatalog: null, weatherProvider: async () => null,
  });
  const server = http.createServer(app);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { directory, store, server, calls, setNow: value => { now = value; } };
}

test('the shared-day read API opens an existing server-owned disk record without source acquisition', { timeout: 10000 }, async t => {
  const h = await setup(t);
  const saved = await h.store.put(publication());
  assert.equal(saved.state, 'ready', 'precondition: a real complete disk record exists');
  const persisted = await h.store.read(saved.snapshot.ref);
  assert.equal(persisted.status, 200);
  const opened = await request(h.server, `/api/shared-days/${saved.snapshot.ref}`);
  assert.equal(opened.status, 200, 'the read API must return the already-published record, not404 or a new plan');
  assert.equal(isDeepStrictEqual(opened.body, persisted.body), true, 'the exact complete immutable envelope is returned');
  assert.equal(opened.headers['cache-control'], 'no-store');
  assert.equal(opened.headers['referrer-policy'], 'no-referrer');
  assert.match(opened.headers['x-robots-tag'], /noindex/);
  assert.deepEqual(h.calls, { places: 0, resolver: 0, events: 0 });
  assert.equal((await h.store.read(saved.snapshot.ref)).body.expires_at, saved.snapshot.expires_at, 'HTTP read does not renew storage age');
  assert.equal((await request(h.server, '/api/health')).status, 200, 'the independent health surface is unchanged');
});

test('the shared-day API refuses write methods and mixed input without reading or replacing its record', { timeout: 10000 }, async t => {
  let realStore;
  let reads = 0;
  const h = await setup(t, { storeOverride: { read: ref => { reads++; return realStore.read(ref); } } });
  realStore = h.store;
  const saved = await h.store.put(publication());
  assert.equal(saved.state, 'ready');
  const pathname = `/api/shared-days/${saved.snapshot.ref}`;
  const before = await h.store.read(saved.snapshot.ref);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const refused = await request(h.server, pathname, { method, body: { safeResponse: { days: [{ forged: true }] } } });
    assert.equal(refused.status, 405, 'the shared-day API must not accept publication or mutation methods');
    assert.equal(refused.body.error, 'day_snapshot_read_only');
    assert.equal(refused.headers.allow, 'GET, HEAD');
  }
  for (const suffix of ['?place=Elsewhere', '?lat=0&lng=0', '?restore=last', '?lang=sv']) {
    const refused = await request(h.server, pathname + suffix);
    assert.equal(refused.status, 400, 'a read reference is not a mixed planning input');
    assert.equal(refused.body.error, 'invalid_day_snapshot_request');
  }
  for (const body of [{}, { safeResponse: { forged: true } }, []]) {
    const refused = await request(h.server, pathname, { body });
    assert.equal(refused.status, 400, 'an explicit GET JSON body cannot supply a replacement');
  }
  assert.equal(reads, 0, 'refused intent never reaches persistence or source work');
  assert.equal(isDeepStrictEqual((await h.store.read(saved.snapshot.ref)).body, before.body), true);
  assert.equal((await fs.readdir(path.join(h.directory, 'published-days-v1'))).length, 1);
  assert.deepEqual(h.calls, { places: 0, resolver: 0, events: 0 });
  const head = await request(h.server, pathname, { method: 'HEAD' });
  assert.equal(head.status, 200, 'HEAD is an ordinary read without a response body');
  assert.equal(head.body, null);
});

test('the read API refuses a fifth outstanding read instead of queueing more disk work', { timeout: 10000 }, async t => {
  let release;
  let entered;
  const hold = new Promise(resolve => { release = resolve; });
  const fourEntered = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  let reads = 0;
  const unavailable = () => ({ status: 404, body: { error: 'day_snapshot_unavailable' } });
  const h = await setup(t, { storeOverride: { read: async () => {
    reads++;
    // The fifth call intentionally settles, so an absent admission gate gives
    // a scalar404-vs429 RED rather than an unrelated HTTP timeout.
    if (reads > 4) return unavailable();
    if (reads === 4) entered();
    await hold;
    return unavailable();
  } } });
  const pathname = `/api/shared-days/${'a'.repeat(48)}`;
  const waiting = Array.from({ length: 4 }, () => request(h.server, pathname));
  try {
    await fourEntered;
    const refused = await request(h.server, pathname);
    assert.equal(refused.status, 429, 'a full disk-read gate must reject at the door, not start another read');
    assert.equal(refused.body.error, 'day_snapshot_busy');
    assert.equal(reads, 4);
    assert.equal(refused.headers['retry-after'], '1');
  } finally {
    release();
    await Promise.allSettled(waiting);
  }
  assert.equal((await request(h.server, pathname)).status, 404, 'settled reads release their permits');
  assert.deepEqual(h.calls, { places: 0, resolver: 0, events: 0 });
});

test('cheap snapshot reads have their own bounded client budget and ignore untrusted forwarded identities', { timeout: 10000 }, async t => {
  const previous = process.env.PARRANDA_PUBLIC_CLIENT_IDENTITY;
  process.env.PARRANDA_PUBLIC_CLIENT_IDENTITY = 'direct';
  t.after(() => {
    if (previous === undefined) delete process.env.PARRANDA_PUBLIC_CLIENT_IDENTITY;
    else process.env.PARRANDA_PUBLIC_CLIENT_IDENTITY = previous;
  });
  let reads = 0;
  const h = await setup(t, { storeOverride: { read: async () => {
    reads++;
    return { status: 404, body: { error: 'day_snapshot_unavailable' } };
  } } });
  const pathname = `/api/shared-days/${'a'.repeat(48)}`;
  for (let index = 0; index < 120; index++) {
    const opened = await request(h.server, pathname, { headers: { 'X-Forwarded-For': `203.0.113.${index + 1}` } });
    assert.equal(opened.status, 404, 'the read budget is distinct from the smaller acquisition budget');
  }
  const refused = await request(h.server, pathname, { headers: { 'X-Forwarded-For': '198.51.100.2' } });
  assert.equal(refused.status, 429, 'forged forwarding headers must not evade the shared-day read budget');
  assert.equal(refused.body.error, 'day_snapshot_rate_limited');
  assert.ok(Number(refused.headers['retry-after']) > 0 && Number(refused.headers['retry-after']) <= 60);
  assert.equal(reads, 120, 'an over-budget request does not reach disk work');
  assert.equal((await request(h.server, '/api/health')).status, 200);
  assert.deepEqual(h.calls, { places: 0, resolver: 0, events: 0 });
});

// First-pass preservation controls: the reviewed store already enforces these
// boundaries; these tests prove its statuses survive the actual HTTP wrapper.
test('malformed references and a missing reference fail closed without listing or acquisition', { timeout: 10000 }, async t => {
  const h = await setup(t);
  for (const pathname of ['/api/shared-days', '/api/shared-days/', '/api/shared-days/short',
    `/api/shared-days/${'A'.repeat(48)}`, `/api/shared-days/${'a'.repeat(48)}%0A`,
    `/api/shared-days/${'%61'.repeat(48)}`, `/api/shared-days/${'a'.repeat(48)}/extra`]) {
    const refused = await request(h.server, pathname);
    assert.equal(refused.status, 400, 'invalid literal references are not decoded, repaired or listed');
    assert.equal(refused.body.error, 'invalid_day_snapshot_ref');
    assert.equal(refused.headers['cache-control'], 'no-store');
  }
  const missing = await request(h.server, `/api/shared-days/${'f'.repeat(48)}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'day_snapshot_unavailable');
  assert.deepEqual(h.calls, { places: 0, resolver: 0, events: 0 });
});

test('a recreated app and store read the same record, then expiry removes it without renewal or replanning', { timeout: 10000 }, async t => {
  const h = await setup(t, { storeOptions: { ttlMs: 1000 } });
  const saved = await h.store.put(publication());
  assert.equal(saved.state, 'ready');
  const pathname = `/api/shared-days/${saved.snapshot.ref}`;
  const restarted = await setup(t, { storeOverride: createPublishedDayStore({ directory: h.directory, clock: () => NOW, ttlMs: 1 }) });
  const opened = await request(restarted.server, pathname);
  assert.equal(opened.status, 200);
  assert.equal(opened.body.expires_at, saved.snapshot.expires_at, 'a factory change does not reinterpret the original expiry');
  h.setNow(NOW + 1000);
  const expired = await request(h.server, pathname);
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error, 'day_snapshot_expired');
  assert.equal((await request(restarted.server, pathname)).status, 404, 'physical expiry cleanup is visible to another app');
  assert.equal((await fs.readdir(path.join(h.directory, 'published-days-v1'))).length, 0);
  for (const app of [h, restarted]) assert.deepEqual(app.calls, { places: 0, resolver: 0, events: 0 });
});

test('corrupt, unsupported and oversized records remain unavailable over HTTP without false empty-day output', { timeout: 10000 }, async t => {
  const h = await setup(t);
  const saved = await h.store.put(publication());
  assert.equal(saved.state, 'ready');
  const pathname = `/api/shared-days/${saved.snapshot.ref}`;
  const record = path.join(h.directory, 'published-days-v1', `${saved.snapshot.ref}.json`);
  const original = await fs.readFile(record);
  const unknown = JSON.parse(original); unknown.version = 999;
  for (const corrupted of ['not JSON', JSON.stringify(unknown), Buffer.alloc(1024 * 1024 + 1, 120)]) {
    await fs.writeFile(record, corrupted);
    const refused = await request(h.server, pathname);
    assert.equal(refused.status, 404);
    assert.deepEqual(refused.body, { error: 'day_snapshot_unavailable' });
    assert.equal(refused.headers['referrer-policy'], 'no-referrer');
    assert.equal((await fs.stat(record)).isFile(), true, 'corruption is not mistaken for an expired deletable record');
  }
  await fs.writeFile(record, original);
  assert.equal((await request(h.server, pathname)).status, 200);
  assert.deepEqual(h.calls, { places: 0, resolver: 0, events: 0 });
});

test('a storage exception never exposes filesystem details or permanently occupies an HTTP read permit', { timeout: 10000 }, async t => {
  let fail = true;
  const h = await setup(t, { storeOverride: { read: async () => {
    if (fail) throw new Error('/synthetic/private/path: do not export');
    return { status: 404, body: { error: 'day_snapshot_unavailable' } };
  } } });
  const pathname = `/api/shared-days/${'a'.repeat(48)}`;
  for (let index = 0; index < 6; index++) {
    const refused = await request(h.server, pathname);
    assert.equal(refused.status, 404, 'a thrown read releases its permit before the next request');
    assert.deepEqual(refused.body, { error: 'day_snapshot_unavailable' });
  }
  fail = false;
  assert.equal((await request(h.server, pathname)).status, 404);
  assert.deepEqual(h.calls, { places: 0, resolver: 0, events: 0 });
});

test('an aborted HTTP client does not release its disk-read permit before the read actually settles', { timeout: 10000 }, async t => {
  let release;
  let firstEntered;
  let fourEntered;
  let firstClosed;
  const hold = new Promise(resolve => { release = resolve; });
  const one = new Promise(resolve => { firstEntered = resolve; });
  const four = new Promise(resolve => { fourEntered = resolve; });
  const closed = new Promise(resolve => { firstClosed = resolve; });
  t.after(() => release());
  let reads = 0;
  const h = await setup(t, { storeOverride: { read: async () => {
    reads++;
    if (reads === 1) firstEntered();
    if (reads === 4) fourEntered();
    if (reads <= 4) await hold;
    return { status: 404, body: { error: 'day_snapshot_unavailable' } };
  } } });
  h.server.once('request', (_request, response) => response.once('close', () => firstClosed()));
  const controller = new AbortController();
  const pathname = `/api/shared-days/${'a'.repeat(48)}`;
  const first = request(h.server, pathname, { signal: controller.signal }).then(() => 'unexpected-response', error => error.code);
  let others = [];
  try {
    await one;
    others = Array.from({ length: 3 }, () => request(h.server, pathname));
    await four;
    controller.abort();
    assert.equal(await first, 'ABORT_ERR', 'precondition: the first native HTTP client actually aborted');
    await closed;
    const refused = await request(h.server, pathname);
    assert.equal(refused.status, 429, 'a closed socket is not proof the underlying disk read finished');
    assert.equal(refused.body.error, 'day_snapshot_busy');
    assert.equal(reads, 4);
  } finally {
    release();
    await Promise.allSettled([first, ...others]);
  }
  assert.equal((await request(h.server, pathname)).status, 404, 'actual settlement restores capacity');
  assert.deepEqual(h.calls, { places: 0, resolver: 0, events: 0 });
});

test('non-JSON and chunked GET bodies are also refused before persistence admission', { timeout: 10000 }, async t => {
  let realStore;
  let reads = 0;
  const h = await setup(t, { storeOverride: { read: ref => { reads++; return realStore.read(ref); } } });
  realStore = h.store;
  const saved = await h.store.put(publication());
  assert.equal(saved.state, 'ready');
  const pathname = `/api/shared-days/${saved.snapshot.ref}`;
  for (const headers of [{}, { 'Content-Type': 'application/octet-stream' }, { 'Transfer-Encoding': 'chunked' }]) {
    const refused = await request(h.server, pathname, { rawBody: 'synthetic-untrusted-proposal', headers });
    assert.equal(refused.status, 400, 'an unparsed GET payload is still a payload, not an ordinary snapshot read');
    assert.equal(refused.body.error, 'invalid_day_snapshot_request');
  }
  assert.equal(reads, 0);
  assert.deepEqual(h.calls, { places: 0, resolver: 0, events: 0 });
});
