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
