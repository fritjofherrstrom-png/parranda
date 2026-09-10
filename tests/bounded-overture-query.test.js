const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createBoundedOvertureQuery } = require('../server/place-candidates/bounded-overture-query');

function childFixture() {
  const child = new EventEmitter(); child.kills = []; child.sent = [];
  child.send = (value, cb) => { child.sent.push(value); cb?.(); };
  child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit('exit', null, signal)); };
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
  let child; let exited;
  const query = createBoundedOvertureQuery({ timeoutMs: 30, spawn: () => {
    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    return child;
  } });
  await assert.rejects(query('unused synthetic query'), /overture_timeout/);
  assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' });
});
