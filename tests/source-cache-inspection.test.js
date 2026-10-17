'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSourceCache } = require('../server/place-candidates/source-cache');

test('inspection retains expired evidence without renewing, hydrating or writing it', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-cache-inspect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let time = 1000;
  const first = createSourceCache({ dir, namespace: 'sample', ttlMs: 100, now: () => time });
  await first.get('anchor', async () => ['old']);
  const target = path.join(dir, 'sample', 'anchor.json');
  const before = fs.readFileSync(target, 'utf8');
  time = 1100;
  const restarted = createSourceCache({ dir, namespace: 'sample', ttlMs: 100, now: () => time });
  assert.deepEqual(restarted.inspect('anchor'), { value: ['old'], expiresAt: 1100 });
  assert.equal(restarted.peek('anchor'), null);
  assert.equal(fs.readFileSync(target, 'utf8'), before);
  fs.rmSync(target);
  assert.equal(restarted.inspect('anchor'), null, 'inspection must not hydrate an expired disk entry');
  const missing = createSourceCache({ dir: path.join(dir, 'absent'), namespace: 'sample' });
  assert.equal(missing.inspect('anchor'), null);
  assert.equal(fs.existsSync(path.join(dir, 'absent')), false, 'inspection must not create a namespace');
});

test('a fresh invalid cached value cannot bypass the requesting source validator', async () => {
  const cache = createSourceCache();
  cache.set('anchor', { version: 0 });
  let calls = 0;
  const value = await cache.get('anchor', async () => { calls++; return { version: 1 }; }, {
    validateCached: value => value?.version === 1,
  });
  assert.deepEqual(value, { version: 1 });
  assert.equal(calls, 1);
  assert.deepEqual(await cache.get('anchor', () => { throw new Error('fresh hit reacquired'); }, {
    validateCached: value => value?.version === 1,
  }), { version: 1 });
});

test('validator failures cannot launder invalid stale values through stale fallback', async () => {
  let time = 1000;
  const cache = createSourceCache({ ttlMs: 100, now: () => time });
  cache.set('anchor', { version: 0 });
  time = 1200;
  await assert.rejects(cache.get('anchor', async () => { throw new Error('failed refresh'); }, {
    validateCached: () => { throw new Error('invalid source shape'); },
    staleIfErrorMs: 500,
  }), /failed refresh/);
});
