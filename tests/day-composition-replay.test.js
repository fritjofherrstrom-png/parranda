'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compose, record, rows } = require('./helpers/day-composition-fixtures');

const originalFetch = global.fetch;
test.before(() => { global.fetch = async () => { throw new Error('unexpected network'); }; });
test.after(() => { global.fetch = originalFetch; });

function remove(retained) {
  return { version: 1, action: 'remove', candidate_id: 'shop-0',
    retained_candidate_ids: retained, target_stop_count: retained.length,
    slot_index: 0, replacement_preference: null, removed_candidate_ids: ['shop-0'] };
}

function replayOptions(retained, extra = {}) {
  return { retainedContext: retained.context,
    openDataLoader: async () => structuredClone(retained.records),
    weatherProvider: async () => { assert.fail('retained replay must not reacquire weather'); },
    clock: () => { assert.fail('retained replay must use its original trusted time'); },
    ...extra,
  };
}

test('retained-context replay delivers the current explicit priority to the engine, not the old ranking', async () => {
  const records = [...rows('culture', 'museum'), ...rows('view', 'viewpoint')];
  let retained;
  const first = await compose(records, ['culture', 'views'], {
    preferencePriority: ['culture', 'views'],
    onRetainComposition: value => { retained = structuredClone(value); },
  });
  assert.equal(retained.records.length, records.length);
  const replay = await compose([], ['culture', 'views'], replayOptions(retained, { preferencePriority: ['views', 'culture'] }));
  const fresh = await compose(records, ['culture', 'views'], { preferencePriority: ['views', 'culture'] });
  assert.equal(replay.stops.length, 6);
  assert.deepEqual(replay.stops.map(stop => stop.id), fresh.stops.map(stop => stop.id));
  assert.ok(first.stops.filter(stop => stop.type === 'museum').length >
    replay.stops.filter(stop => stop.type === 'museum').length);
});

for (const count of [0, 1, 5]) {
  test(`retained replay preserves a deliberate ${count}-stop removal and its cap during later Adjust`, async () => {
    const records = [...rows('shop', 'vintage-shop', 8), ...rows('culture', 'museum', 8)];
    const retainedIds = rows('shop', 'vintage-shop', count + 1).slice(1).map(record => record.id);
    const dayEdit = remove(retainedIds);
    let retained;
    const first = await compose(records, ['second_hand'], {
      dayEdit, onRetainComposition: value => { retained = structuredClone(value); },
    });
    const replay = await compose([], ['second_hand'], replayOptions(retained, { dayEdit }));
    assert.deepEqual(replay.stops.map(stop => stop.id), first.stops.map(stop => stop.id));
    assert.equal(replay.stops.length, count);
    assert.equal(replay.experiment.day_edit.status, 'applied');
    assert.equal(replay.experiment.route_mutation, true);
    assert.equal(replay.result.days[0].manual_empty_day === true, count === 0);
    const adjusted = await compose([], ['culture'], replayOptions(retained, {
      dayEdit: { ...dayEdit, preserve_retained: false }, preferencePriority: ['culture'],
    }));
    assert.equal(adjusted.stops.length, count);
    assert.ok(adjusted.stops.every(stop => stop.type === 'museum' && stop.id !== 'shop-0'));
    assert.equal(adjusted.experiment.day_edit.status, 'applied');
    assert.equal(adjusted.experiment.day_edit.reason, 'recomposed_with_cap');
  });
}

test('retained replay re-runs the independent walking gate for the edited chain', async () => {
  const records = [...rows('shop', 'vintage-shop', 3), record('old-food', 'pizza'), record('new-food', 'restaurant')];
  const dayEdit = { ...remove(['shop-0', 'shop-1', 'shop-2']), action: 'replace',
    candidate_id: 'old-food', removed_candidate_ids: ['old-food'], target_stop_count: 4,
    replacement_preference: 'food' };
  let retained;
  const first = await compose(records, ['food', 'second_hand'], {
    dayEdit, onRetainComposition: value => { retained = structuredClone(value); },
  });
  let validations = 0;
  const replay = await compose([], ['food', 'second_hand'], replayOptions(retained, {
    dayEdit, baselineResult: first.result,
    walkingRouter: async () => { validations += 1; throw new Error('walking unavailable'); },
  }));
  assert.equal(validations, 1);
  assert.equal(replay.experiment.route_mutation, false);
  assert.equal(replay.experiment.day_edit.status, 'refused');
  assert.equal(replay.experiment.day_edit.reason, 'walking_validation_failed');
  assert.equal(replay.result, first.result, 'replayed baseline is retained without claiming the edit was applied');
});
