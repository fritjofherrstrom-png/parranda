'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { writeMapInteractionTrace } = require('./helpers/map-interaction-trace');

test('map observation retains successful trace output', async () => {
  const trace = { events: [{ kind: 'click' }], tooltip: 'Rome a', markers: ['1. Rome a'] };
  const output = [];
  await writeMapInteractionTrace({ evaluate: async () => trace }, 'Rome', (...args) => output.push(args));
  assert.deepEqual(output, [['[map-interaction-trace]', 'Rome', JSON.stringify(trace)]]);
});

test('closed-page diagnostic rejection never becomes a teardown failure', async () => {
  let cleanup = 0;
  const output = [];
  const originalFailure = new Error('original popup timeout');
  const page = { evaluate: async () => { throw new Error('page closed'); } };
  async function interactionWithTeardown() {
    try { throw originalFailure; }
    finally {
      try { await writeMapInteractionTrace(page, 'Rome', (...args) => output.push(args)); }
      finally { cleanup++; }
    }
  }
  await assert.rejects(interactionWithTeardown, error => error === originalFailure);
  assert.equal(cleanup, 1);
  assert.deepEqual(output, [['[map-interaction-trace-unavailable]', 'Rome', 'Error']]);
  await assert.doesNotReject(() => writeMapInteractionTrace(page, 'Rome', () => {}));
});

test('unavailable diagnostic logger cannot add a test failure', async () => {
  await assert.doesNotReject(() => writeMapInteractionTrace(
    { evaluate: async () => ({ events: [], tooltip: null, markers: [] }) },
    'Rome', () => { throw new Error('logger unavailable'); },
  ));
});

test('optional DOM capture failure preserves the successful trace', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-map-capture-'));
  const previous = process.env.PARRANDA_MAP_DIAGNOSTICS_DIR;
  const trace = { events: [], tooltip: null, markers: [] };
  const output = [];
  process.env.PARRANDA_MAP_DIAGNOSTICS_DIR = dir;
  try {
    await writeMapInteractionTrace({ evaluate: async () => trace,
      content: async () => { throw new TypeError('capture unavailable'); },
      screenshot: async () => {},
    }, 'Rome', (...args) => output.push(args));
    assert.deepEqual(output, [['[map-interaction-trace]', 'Rome', JSON.stringify(trace)]]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'Rome.capture-error.json'))), { error: 'TypeError' });
  } finally {
    if (previous === undefined) delete process.env.PARRANDA_MAP_DIAGNOSTICS_DIR;
    else process.env.PARRANDA_MAP_DIAGNOSTICS_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
