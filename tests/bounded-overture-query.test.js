const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBoundedOvertureQuery } = require('../server/place-candidates/bounded-overture-query');

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
test('child error, malformed response and spawn failure fail closed without leaking a slot', async () => {
  await assert.rejects(createBoundedOvertureQuery({ spawn: () => { throw new Error('spawn refused'); } })('sql'), /spawn refused/);
  const child = childFixture();
  const result = createBoundedOvertureQuery({ spawn: () => child })('sql');
  child.emit('message', { rows: Array(601).fill({}) });
  await assert.rejects(result, /overture_query_failed/);
  assert.deepEqual(child.kills, ['SIGKILL']);
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

test('real child uses bounded temporary disk and parent removes its private directory', async t => {
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

test('an unusable extension cache falls back without disabling the bounded query', async () => {
  const query = createBoundedOvertureQuery({ cacheDir: '/dev/null', timeoutMs: 10000 });
  assert.deepEqual(await query('SELECT 1 AS id'), [{ id: 1 }]);
});
