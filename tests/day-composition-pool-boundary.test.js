'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectAgnosticCandidateSet, buildAgnosticEvaluationPool } = require('../server/planner/agnostic-candidate-set');
const { selectBalancedDay } = require('../server/planner/day-composition-policy');
const { compose, record, rows } = require('./helpers/day-composition-fixtures');

function entry(id, type, score = 0) {
  const intent = { museum: 'museums', viewpoint: 'scenic', restaurant: 'food' }[type];
  return { score, item: { id, name: id, type, lat: 55.6, lng: 13,
    coveredPreferences: [intent], partialPreferences: [] } };
}

function extendedSupply(lastType) {
  return [...Array.from({ length: 12 }, (_, index) => entry(`museum-${index}`, 'museum', 13 - index)),
    entry('retained-last', lastType)];
}

function initialSelection(rankedCandidates, preferences) {
  return selectAgnosticCandidateSet({ rankedCandidates, requestedPreferences: preferences, desiredCount: 5 }).selected;
}

test('Views first retains the exact viewpoint reserved beyond the raw first twelve by the initial chooser', () => {
  const rankedCandidates = extendedSupply('viewpoint');
  const preferences = ['culture', 'views'];
  const selected = initialSelection(rankedCandidates, preferences);
  assert.ok(selected.some(stop => stop.id === 'retained-last'), 'the real first chooser reserves requested exact Views');
  const output = selectBalancedDay({ rankedCandidates, selected, preferences,
    preferencePriority: ['views', 'culture'] });
  assert.equal(output.length, 5);
  assert.ok(output.some(stop => stop.id === 'retained-last'), 'priority must use the same coverage-aware bounded pool');
  assert.ok(output.every(stop => rankedCandidates.some(entry => entry.item === stop)), 'selection never creates a candidate');
});

test('neutral Food selection retains its exact representative when retained supply extends beyond twelve', () => {
  const rankedCandidates = extendedSupply('restaurant');
  const preferences = ['culture', 'food'];
  const selected = initialSelection(rankedCandidates, preferences);
  assert.ok(selected.some(stop => stop.id === 'retained-last'));
  const output = selectBalancedDay({ rankedCandidates, selected, preferences });
  assert.equal(output.length, 5);
  assert.ok(output.some(stop => stop.id === 'retained-last'), 'neutral composition must preserve available requested Food');
});

test('a low-ranked pinned exact representative remains in the bounded priority selection', () => {
  const rankedCandidates = extendedSupply('viewpoint');
  const preferences = ['culture', 'views'];
  const selected = initialSelection(rankedCandidates, preferences);
  const output = selectBalancedDay({ rankedCandidates, selected, preferences,
    preferencePriority: ['culture', 'views'], pinnedIds: ['retained-last'] });
  assert.equal(output.length, 5);
  assert.ok(output.some(stop => stop.id === 'retained-last'), 'the admitted pin cannot disappear between the two choosers');
});

test('neutral selection inside the existing bound keeps its deterministic tie result', () => {
  const rankedCandidates = [entry('culture-0', 'museum'), entry('culture-1', 'museum'),
    entry('food-0', 'restaurant'), entry('food-1', 'restaurant'),
    entry('views-0', 'viewpoint'), entry('views-1', 'viewpoint')];
  const preferences = ['food', 'culture', 'views'];
  for (const supplied of [rankedCandidates, [...rankedCandidates].reverse()]) {
    const output = selectBalancedDay({ rankedCandidates: supplied, preferences,
      selected: rankedCandidates.slice(0, 5) });
    assert.deepEqual(output.map(stop => stop.id).sort(), ['culture-0', 'culture-1', 'food-0', 'food-1', 'views-0']);
  }
});

test('a retained extension keeps coverage inside twelve candidates even when a larger pool is requested', () => {
  const pool = buildAgnosticEvaluationPool({ rankedCandidates: extendedSupply('viewpoint'),
    requestedPreferences: ['culture', 'views'], poolLimit: 100 });
  assert.equal(pool.length, 12);
  assert.ok(pool.some(({ item }) => item.id === 'retained-last'));
  assert.ok(!pool.some(({ item }) => item.id === 'museum-11'), 'coverage reservation replaces a lower-ranked member, never enlarges search');
});

test('real composition still publishes an admitted off-intent pin after priority selection', async () => {
  const records = [...rows('culture', 'museum'), ...rows('view', 'viewpoint', 6, 6),
    record('pinned-food', 'restaurant', 12)];
  for (const preferencePriority of [[], ['views', 'culture']]) {
    const output = await compose(records, ['culture', 'views'], {
      dayRhythm: 'balanced', preferencePriority, pinnedStopIds: ['pinned-food'],
    });
    assert.ok(output.stops.some(stop => stop.id === 'pinned-food'), 'the existing full gated-pool pin reapplication remains authoritative');
    assert.equal(new Set(output.stops.map(stop => stop.id)).size, output.stops.length);
    assert.ok(output.stops.every(stop => records.some(record => record.id === stop.id)));
    assert.equal(output.experiment.walking_validation.valid, true);
  }
});
