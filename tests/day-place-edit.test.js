'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compose, rows, record } = require('./helpers/day-composition-fixtures');
const { normalizeDayEdit } = require('../shared/planner-intent.mjs');
const added = (retained, extra = {}) => ({ version: 1, action: 'add', candidate_id: 'chosen',
  retained_candidate_ids: retained, target_stop_count: retained.length + 1, slot_index: Math.min(5, retained.length),
  replacement_preference: null, removed_candidate_ids: [], ...extra });

test('exact add outside ordinary interests preserves every retained identity and adds no filler', async () => {
  const records = [...rows('museum', 'museum'), record('chosen', 'restaurant', 8), record('other-food', 'restaurant', 9)];
  const retained = ['museum-0', 'museum-2', 'museum-4'];
  const output = await compose(records, ['culture'], { dayEdit: added(retained), pinnedStopIds: ['museum-2', 'chosen'] });
  assert.equal(output.experiment.day_edit?.status, 'applied');
  assert.deepEqual(output.stops.filter(s => s.id !== 'chosen').map(s => s.id), retained);
  assert.equal(output.stops.length, 4);
  assert.ok(output.stops.some(s => s.id === 'chosen'));
  assert.ok(!output.stops.some(s => s.id === 'other-food'));
  assert.equal(output.experiment.day_edit.reason, 'added');
});
test('exact replacement chooses the requested place even when another scores better', async () => {
  const records = [...rows('museum', 'museum'), record('old-food', 'restaurant'), record('other-food', 'restaurant'), record('chosen', 'restaurant', 9)];
  const command = { ...added(['museum-0', 'museum-2']), action: 'replace', candidate_id: 'old-food',
    replacement_candidate_id: 'chosen', removed_candidate_ids: ['old-food'], slot_index: 1 };
  const output = await compose(records, ['culture'], { dayEdit: command });
  assert.equal(output.experiment.day_edit?.status, 'applied');
  assert.deepEqual(output.stops.map(s => s.id), ['museum-0', 'chosen', 'museum-2']);
  assert.equal(output.experiment.day_edit.replacement_candidate_id, 'chosen');
  const conflict = await compose(records, ['culture'], { dayEdit: command, pinnedStopIds: ['old-food'] });
  assert.equal(conflict.experiment.day_edit.status, 'refused');
});
for (const [name, chosen] of [['absent', null], ['closed', record('chosen', 'restaurant', 8, { opening_hours: 'Mo-Su off' })],
  ['far away', record('chosen', 'restaurant', 8, { lat: 40, lng: 1 })]]) {
  test(`exact add refuses ${name} choice without substituting another restaurant`, async () => {
    const output = await compose([...rows('museum', 'museum'), record('other-food', 'restaurant'), ...(chosen ? [chosen] : [])], ['culture'], { dayEdit: added(['museum-0', 'museum-1']) });
    assert.equal(output.experiment.day_edit?.status, 'refused');
    assert.equal(output.experiment.route_mutation, false);
  });
}
test('add refuses unavailable retained identities including frozen Live', async () => {
  for (const id of ['missing', 'live-event-expired']) {
    const output = await compose([...rows('museum', 'museum'), record('chosen', 'restaurant')], ['culture'], { dayEdit: added(['museum-0', id]) });
    assert.equal(output.experiment.day_edit?.status, 'refused');
    assert.equal(output.experiment.route_mutation, false);
  }
});
test('new input remains bounded and legacy edit keeps its exact canonical shape', () => {
  assert.ok(normalizeDayEdit(added(['a', 'b'])));
  assert.equal(normalizeDayEdit(added(['a', 'b', 'c', 'd', 'e', 'f'])), null);
  assert.equal(normalizeDayEdit(added(['a'], { removed_candidate_ids: ['chosen'] })), null);
  const legacy = { ...added(['a']), action: 'replace', candidate_id: 'old', removed_candidate_ids: ['old'] };
  assert.deepEqual(normalizeDayEdit(legacy), legacy);
  assert.equal(normalizeDayEdit({ ...legacy, replacement_candidate_id: 'old' }), null);
});
test('new edit still measures and refuses the final walking chain', async () => {
  const output = await compose([...rows('museum', 'museum'), record('chosen', 'restaurant')], ['culture'], {
    anchorMode: 'place', dayEdit: added(['museum-0', 'museum-1']),
    walkingRouter: async () => ({ valid: false, blockers: ['fixture_walk_refusal'], checks: {} }),
  });
  assert.equal(output.experiment.day_edit?.status, 'refused');
  assert.equal(output.experiment.route_mutation, false);
});

test('an exact addition preserves a deliberately winding retained order before final walking validation', async () => {
  const records = [...rows('museum', 'museum', 5).map((row, i) => ({ ...row, lat: 55.6 + i * .003 })), record('chosen', 'restaurant', 2)];
  const retained = ['museum-0', 'museum-4', 'museum-1', 'museum-3'];
  const output = await compose(records, ['culture'], { dayEdit: added(retained), anchorMode: 'place' });
  assert.equal(output.experiment.day_edit.status, 'applied');
  assert.deepEqual(output.stops.filter(stop => stop.id !== 'chosen').map(stop => stop.id), retained,
    'an optimized preview must not silently reverse or reorder the day it promises to retain');
});
