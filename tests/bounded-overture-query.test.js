const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBoundedOvertureQuery } = require('../server/place-candidates/bounded-overture-query');

// The real DuckDB child installs the httpfs extension from DuckDB's extension
// repository before every query, so the two tests that run it need live
// network. They run only on explicit opt-in; the rest of this file is offline.
const NEEDS_EXTENSION_DOWNLOAD = process.env.PARRANDA_TEST_LIVE_NETWORK !== 'enabled'
  && 'set PARRANDA_TEST_LIVE_NETWORK=enabled: the DuckDB child downloads the httpfs extension';

function childFixture() {
  const child = new EventEmitter(); child.kills = []; child.sent = [];
  child.send = (value, cb) => { child.sent.push(value); cb?.(); };
  child.kill = signal => { child.kills.push(signal); queueMicrotask(() => {
    child.emit('exit', null, signal);
    child.emit('close', null, signal);
  }); };
  return child;
}
test('native acquisition terminates on deadline, refuses concurrent work, then recovers its slot', async () => {
  const first = childFixture(); const second = childFixture(); let spawned = 0;
  const query = createBoundedOvertureQuery({ timeoutMs: 15, spawn: () => ++spawned === 1 ? first : second });
  const timedOut = query('SELECT bounded');
  await assert.rejects(query('SELECT other'), /overture_busy/);
  await assert.rejects(timedOut, /overture_timeout/);
  assert.deepEqual(first.kills, ['SIGKILL']);
  const next = query('SELECT recovery');
  second.emit('message', { rows: [{ id: 'real' }] });
  assert.deepEqual(await next, [{ id: 'real' }]);
  assert.equal(spawned, 2);
});
test('lifecycle cancellation kills the native child and recovers its slot after exit', async () => {
  const first = childFixture();
  const second = childFixture();
  let spawned = 0;
  const query = createBoundedOvertureQuery({
    timeoutMs: 1000,
    spawn: () => ++spawned === 1 ? first : second,
  });
  const controller = new AbortController();
  const cancelled = query('SELECT cancelled', { signal: controller.signal });

  controller.abort();
  await assert.rejects(cancelled, /overture_cancelled/);
  assert.deepEqual(first.kills, ['SIGKILL']);
  await new Promise(resolve => setImmediate(resolve));

  const recovered = query('SELECT recovered');
  second.emit('message', { rows: [{ id: 'recovered' }] });
  assert.deepEqual(await recovered, [{ id: 'recovered' }]);
  assert.equal(spawned, 2);
});
test('child error, malformed response and spawn failure fail closed without leaking a slot', async () => {
  await assert.rejects(createBoundedOvertureQuery({ spawn: () => { throw new Error('spawn refused'); } })('sql'), /spawn refused/);
  const child = childFixture();
  const result = createBoundedOvertureQuery({ spawn: () => child })('sql');
  child.emit('message', { rows: Array(601).fill({}) });
  await assert.rejects(result, /overture_query_failed/);
  assert.deepEqual(child.kills, ['SIGKILL']);
});

test('validated native prefetch binds object identities to rows without publishing them as candidate fields', async () => {
  const asset = 's3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/part-00001-fixture.zstd.parquet';
  const child = childFixture();
  const query = createBoundedOvertureQuery({ spawn: () => child });
  const plan = { paths: [asset], window: { lat: 40, lng: 12, radiusKm: 5 } };
  const result = query(`SELECT * FROM read_parquet(['${asset}'])`, { prefetch: plan });
  child.emit('message', { rows: [{ id: 'real' }], sourceAssets: [{ path: asset, etag: '"v1"', length: 100 }] });
  const rows = await result;
  assert.deepEqual(child.sent[0].prefetch, plan);
  assert.deepEqual(rows.source_assets, [{ path: asset, etag: '"v1"', length: 100 }]);
  assert.equal(JSON.stringify(rows), '[{"id":"real"}]');
});

test('malformed native plans never spawn and mismatched object receipts fail closed', async () => {
  let spawned = 0;
  const query = createBoundedOvertureQuery({ timeoutMs: 15, spawn: () => { spawned++; return childFixture(); } });
  const valid = 's3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/part-00001-fixture.zstd.parquet';
  for (const plan of [
    { paths: [valid + '?redirect=1'], window: { lat: 40, lng: 12, radiusKm: 5 } },
    { paths: [valid], window: { lat: 40, lng: 12, radiusKm: 6 } },
    { paths: [valid, valid], window: { lat: 40, lng: 12, radiusKm: 5 } },
  ]) await assert.rejects(query('unused', { prefetch: plan }), /invalid_overture/);
  assert.equal(spawned, 0);
  const child = childFixture();
  const result = createBoundedOvertureQuery({ spawn: () => child })(`SELECT * FROM read_parquet(['${valid}'])`, { prefetch: { paths: [valid], window: { lat: 40, lng: 12, radiusKm: 5 } } });
  child.emit('message', { rows: [{ id: 'wrong object' }], sourceAssets: [{ path: valid.replace('00001', '00002'), etag: '"v1"', length: 100 }] });
  await assert.rejects(result, /overture_query_failed/);
});

test('IPC byte cap includes pinned source identity metadata as well as candidate rows', async () => {
  const asset = 's3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/part-00001-fixture.zstd.parquet';
  const child = childFixture();
  const result = createBoundedOvertureQuery({ spawn: () => child })(`SELECT * FROM read_parquet(['${asset}'])`, { prefetch: { paths: [asset], window: { lat: 40, lng: 12, radiusKm: 5 } } });
  child.emit('message', { rows: [{ value: 'a'.repeat(2 * 1024 * 1024 - 40) }], sourceAssets: [{ path: asset, etag: '"v1"', length: 100 }] });
  await assert.rejects(result, /overture_query_failed/);
});

test('deadline kills an actual operating-system child, not only an abandoned promise', async () => {
  const { spawn } = require('node:child_process');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-overture-timeout-'));
  let child; let exited;
  const query = createBoundedOvertureQuery({ timeoutMs: 30, tempRoot, spawn: () => {
    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    return child;
  } });
  await assert.rejects(query('unused synthetic query'), /overture_timeout/);
  assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' });
  for (let i = 0; i < 20 && fs.readdirSync(tempRoot).length; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(fs.readdirSync(tempRoot), []);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('lifecycle cancellation kills an actual operating-system child and removes its temp directory', async t => {
  const { spawn } = require('node:child_process');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-overture-cancel-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  let child;
  let exited;
  const query = createBoundedOvertureQuery({ timeoutMs: 10000, tempRoot, spawn: () => {
    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    return child;
  } });
  const controller = new AbortController();
  const result = query('unused synthetic query', { signal: controller.signal });
  controller.abort();

  await assert.rejects(result, /overture_cancelled/);
  assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' });
  for (let i = 0; i < 20 && fs.readdirSync(tempRoot).length; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(fs.readdirSync(tempRoot), []);
});

test('a stale child event cannot release the slot owned by a newer child', async () => {
  function controlledChild() {
    const child = new EventEmitter();
    child.send = (_value, callback) => callback?.();
    child.kill = () => true;
    return child;
  }
  const first = controlledChild();
  const second = controlledChild();
  const third = controlledChild();
  let spawned = 0;
  const query = createBoundedOvertureQuery({
    timeoutMs: 1000,
    spawn: () => [first, second, third][spawned++],
  });

  const firstResult = query('SELECT first');
  first.emit('message', { rows: [{ id: 'first' }] });
  assert.deepEqual(await firstResult, [{ id: 'first' }]);
  await assert.rejects(query('SELECT too_early'), /overture_busy/);

  first.emit('error', new Error('late ipc error'));
  await assert.rejects(query('SELECT still_too_early'), /overture_busy/);
  first.emit('close', null, 'SIGKILL');

  const secondResult = query('SELECT second');
  first.emit('exit', null, 'SIGKILL');
  await assert.rejects(query('SELECT stale_release'), /overture_busy/);
  second.emit('message', { rows: [{ id: 'second' }] });
  second.emit('close', null, 'SIGKILL');
  assert.deepEqual(await secondResult, [{ id: 'second' }]);
  assert.equal(spawned, 2);
});

test('real child uses bounded temporary disk and parent removes its private directory', { skip: NEEDS_EXTENSION_DOWNLOAD }, async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-overture-test-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const query = createBoundedOvertureQuery({ timeoutMs: 10000, tempRoot });
  const [settings] = await query(`SELECT
    current_setting('temp_directory') AS temp_directory,
    current_setting('max_temp_directory_size') AS max_temp_directory_size`);
  assert.match(settings.temp_directory, /parranda-overture-query-/);
  assert.equal(settings.max_temp_directory_size, '64.0 MiB');
  for (let i = 0; i < 20 && fs.readdirSync(tempRoot).length; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(fs.readdirSync(tempRoot), []);
});

test('an unusable extension cache falls back without disabling the bounded query', { skip: NEEDS_EXTENSION_DOWNLOAD }, async () => {
  const query = createBoundedOvertureQuery({ cacheDir: '/dev/null', timeoutMs: 10000 });
  assert.deepEqual(await query('SELECT 1 AS id'), [{ id: 1 }]);
});

// Actual Pi catalogue acquisition completed at55.5s; the old45s watchdog
// killed valid transfer. Replay the boundary without live network or sleeping.
test('measured55.5s native acquisition can complete, with a hard75s watchdog', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
  const child=childFixture();const result=createBoundedOvertureQuery({spawn:()=>child})('controlled transfer');
  const observed=result.then(rows=>({rows}),error=>({error:error.message}));
  t.mock.timers.tick(55500);child.emit('message',{rows:[{id:'complete-source-row'}]});
  assert.deepEqual(await observed,{rows:[{id:'complete-source-row'}]});
  await new Promise(setImmediate);
  const late=childFixture(),timeout=createBoundedOvertureQuery({spawn:()=>late})('never finishes');
  const rejected=assert.rejects(timeout,/overture_timeout/);t.mock.timers.tick(75000);await rejected;
  assert.deepEqual(late.kills,['SIGKILL']);
});
