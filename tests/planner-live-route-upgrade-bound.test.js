'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { retainComposition, createRouteUpgrade } = require('../server/planner/live-route-upgrade');

function dag(depth) {
  let graph = { value: 'x'.repeat(64) };
  for (let i = 0; i < depth; i++) graph = { left: graph, right: graph };
  return graph;
}

test('retention preserves DAG aliases without sharing mutable original objects', () => {
  const graph = dag(15);
  const snapshot = retainComposition({ records: [graph], context: { graph } });
  assert.ok(snapshot);
  assert.equal(snapshot.records[0], snapshot.context.graph);
  let original = graph, copy = snapshot.records[0];
  for (let i = 0; i < 15; i++) {
    assert.notEqual(copy, original);
    assert.equal(copy.left, copy.right);
    original = original.left;
    copy = copy.left;
  }
  original.value = 'changed';
  assert.equal(copy.value, 'x'.repeat(64));
  copy.value = 'snapshot';
  assert.equal(original.value, 'changed');
});

test('ordinary tree control retains separate equal objects', () => {
  const snapshot = retainComposition({ records: [{ x: 1 }, { x: 1 }], context: null });
  assert.deepEqual(snapshot.records, [{ x: 1 }, { x: 1 }]);
  assert.notEqual(snapshot.records[0], snapshot.records[1]);
});

test('self and indirect cycles fail closed rather than throwing or retaining a cycle', () => {
  const self = {}; self.self = self;
  const parent = {}, child = { parent }; parent.child = child;
  for (const graph of [self, parent]) {
    assert.equal(retainComposition({ records: [graph], context: null }), null);
  }
});

test('accessors fail closed without executing enumerable, private or symbol getters', () => {
  let reads = 0;
  for (const key of ['public', 'private', Symbol('private')]) {
    const context = {};
    Object.defineProperty(context, key, { enumerable: key === 'public', get() { reads++; throw Error('getter executed'); } });
    assert.equal(retainComposition({ records: [], context }), null);
  }
  assert.equal(reads, 0);
});

test('private descriptors, array length, Date metadata and cross-field aliases survive isolation', () => {
  const symbol = Symbol('private');
  const metadata = { ids: ['excluded'] };
  const rows = new Array(3);
  rows[0] = { id: 'original' };
  Object.defineProperty(rows, symbol, { value: metadata, enumerable: false, writable: false, configurable: false });
  Object.defineProperty(rows, 'loader_metadata', { value: metadata, enumerable: false, writable: true, configurable: true });
  const date = new Date('2026-06-28T12:00:00Z');
  Object.defineProperty(date, symbol, { value: metadata });
  const snapshot = retainComposition({ records: rows, context: { metadata, date } });
  assert.equal(snapshot.records.length, 3);
  assert.equal(1 in snapshot.records, false);
  assert.equal(snapshot.context.date.getTime(), date.getTime());
  assert.equal(snapshot.context.date[symbol], snapshot.context.metadata);
  for (const key of [symbol, 'loader_metadata']) {
    const descriptor = Object.getOwnPropertyDescriptor(snapshot.records, key);
    assert.equal(descriptor.value, snapshot.context.metadata);
    const originalDescriptor = Object.getOwnPropertyDescriptor(rows, key);
    for (const flag of ['enumerable', 'writable', 'configurable']) assert.equal(descriptor[flag], originalDescriptor[flag]);
  }
  metadata.ids.push('late'); date.setFullYear(2030);
  assert.deepEqual(snapshot.context.metadata.ids, ['excluded']);
  assert.equal(snapshot.context.date.getUTCFullYear(), 2026);
});

test('large strings and hidden metadata fail closed while a near-bound context is retained', () => {
  assert.ok(retainComposition({ records: [], context: { text: 'x'.repeat(2 * 1024 * 1024 - 1024) } }));
  for (const text of ['x'.repeat(2 * 1024 * 1024), '\u0000'.repeat(400000)]) {
    const records = [];
    Object.defineProperty(records, Symbol('private'), { value: { text } });
    assert.equal(retainComposition({ records, context: null }), null);
  }
});

test('deep bounded contexts clone iteratively without call-stack overflow', () => {
  let graph = {};
  for (let i = 0; i < 10000; i++) graph = { next: graph };
  const snapshot = retainComposition({ records: [], context: graph });
  assert.ok(snapshot);
  let copy = snapshot.context;
  for (let i = 0; i < 10000; i++) copy = copy.next;
  assert.deepEqual(copy, {});
});

test('wide nested contexts bound queued traversal before walking every child', t => {
  const width = 15000;
  let graph = {};
  for (let depth = 0; depth < 20; depth++) {
    const parent = { next: graph };
    for (let i = 0; i < width; i++) parent['metadata_' + i] = null;
    graph = parent;
  }
  const ownKeys = Reflect.ownKeys;
  let queuedKeys = 0;
  t.mock.method(Reflect, 'ownKeys', value => {
    const keys = ownKeys(value);
    queuedKeys += keys.length;
    return keys;
  });
  assert.equal(retainComposition({ records: [], context: graph }), null);
  // One reflection batch may cross the limit; it must be rejected before
  // another frame is queued. Do not defer debiting wide ancestor keys.
  assert.ok(queuedKeys <= 2 * 1024 * 1024 / 8 + width + 1,
    'queued traversal keys must be debited before descending');
});

test('authority capture fails closed for cyclic or accessor context without getter execution', () => {
  const args = {}; args.self = args;
  const base = { retained: { records: [], context: null }, structure: {}, initialLive: {}, published: { agnostic_route_output_experiment: { promotion: { promote: true } } }, publish: async () => ({}) };
  assert.equal(createRouteUpgrade({ ...base, args }), null);
  let reads = 0;
  const invalid = {};
  Object.defineProperty(invalid, 'hidden', { get() { reads++; return {}; } });
  assert.equal(createRouteUpgrade({ ...base, args: invalid }), null);
  assert.equal(reads, 0);
});
