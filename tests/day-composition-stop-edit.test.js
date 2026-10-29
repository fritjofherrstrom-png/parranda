'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compose, record, rows } = require('./helpers/day-composition-fixtures');

const originalFetch = global.fetch;
test.before(() => { global.fetch = async () => { throw new Error('unexpected network'); }; });
test.after(() => { global.fetch = originalFetch; });

function edit(action, candidateId, retained, extra = {}) {
  return { version: 1, action, candidate_id: candidateId,
    retained_candidate_ids: retained, target_stop_count: retained.length + (action === 'replace' ? 1 : 0),
    slot_index: 0, replacement_preference: null, removed_candidate_ids: [candidateId], ...extra };
}

test('remove keeps exactly the five requested eligible identities and never backfills a Full day', async () => {
  const records = rows('shop', 'vintage-shop', 8);
  const retained = records.slice(1, 6).map(record => record.id);
  const dayEdit = edit('remove', records[0].id, retained);
  const output = await compose(records, ['second_hand'], { dayEdit });
  assert.deepEqual(output.stops.map(stop => stop.id).sort(), [...retained].sort());
  assert.equal(output.experiment.day_edit?.status, 'applied');
  assert.equal(output.experiment.day_edit.actual_stop_count, 5);
  assert.deepEqual(output.experiment.day_edit.retained_candidate_ids.slice().sort(), [...retained].sort());
});

test('remove 6 to 5 then Adjust changes content without losing the persistent cap or resurrecting a removed ID', async () => {
  const records = [...rows('shop', 'vintage-shop', 8), ...rows('culture', 'museum', 8)];
  const retained = records.slice(1, 6).map(record => record.id);
  const dayEdit = edit('remove', 'shop-0', retained);
  const removed = await compose(records, ['second_hand'], { dayEdit });
  assert.equal(removed.stops.length, 5);
  const adjusted = await compose(records, ['culture'], { dayRhythm: 'full',
    preferencePriority: ['culture'], dayEdit: { ...dayEdit, preserve_retained: false } });
  assert.equal(adjusted.stops.length, 5);
  assert.ok(adjusted.stops.every(stop => stop.type === 'museum'));
  assert.ok(adjusted.stops.every(stop => stop.id !== 'shop-0'));
  assert.equal(adjusted.experiment.day_edit.status, 'applied');
});

for (const count of [1, 0]) {
  test(`deliberate removal to ${count} stops does not restore the old day or invent supply`, async () => {
    const records = rows('shop', 'vintage-shop', count + 1);
    const retained = records.slice(1).map(record => record.id);
    const dayEdit = edit('remove', records[0].id, retained);
    // The ordinary exclusion adapter can legitimately leave just one / zero
    // trusted records. Do not repair these counts by inventing a source pair.
    const output = await compose(records.slice(1), ['second_hand'], { dayEdit,
      baselineResult: { days: [{ primary_route: { id: 'old', main_stops: [{ id: 'old-venue' }] } }] } });
    assert.deepEqual(output.stops.map(stop => stop.id), retained);
    assert.equal(output.experiment.day_edit?.status, 'applied');
    assert.equal(output.experiment.day_edit.actual_stop_count, count);
    assert.equal(output.experiment.eligibility.checks.engine_reservoir_geocoded_stop_count || 0, count);
    assert.equal(output.experiment.route_mutation, true);
    if (!count) assert.equal(output.result.days[0].primary_route, null);
  });
}

test('replace keeps the other stops and adds one same-interest alternative near the old slot, not necessarily pizza', async () => {
  const retainedRows = rows('shop', 'vintage-shop', 3);
  const records = [...retainedRows, record('old-pizza', 'pizza'), record('new-meal', 'taverna'),
    record('unrequested-park', 'park')];
  const retained = retainedRows.map(record => record.id);
  const dayEdit = edit('replace', 'old-pizza', retained, { slot_index: 1, replacement_preference: 'food' });
  const output = await compose(records, ['food', 'second_hand'], { dayEdit });
  assert.equal(output.stops.length, 4);
  assert.ok(retained.every(id => output.stops.some(stop => stop.id === id)));
  assert.equal(output.stops.filter(stop => !retained.includes(stop.id)).length, 1);
  assert.equal(output.stops[1].id, 'new-meal');
  assert.equal(output.experiment.day_edit?.status, 'applied');
  assert.equal(output.experiment.day_edit.replacement_candidate_id, 'new-meal');
});

test('replace refuses rather than pretending an unrelated stop or shorter day is a replacement', async () => {
  const retainedRows = rows('shop', 'vintage-shop', 3);
  const records = [...retainedRows, record('old-pizza', 'pizza'), record('unrequested-park', 'park'),
    record('closed-food', 'restaurant', 1, { opening_hours: 'Mo-Su off' })];
  const dayEdit = edit('replace', 'old-pizza', retainedRows.map(record => record.id),
    { replacement_preference: 'food' });
  const output = await compose(records, ['food', 'second_hand'], { dayEdit });
  assert.equal(output.experiment.day_edit?.status, 'refused');
  assert.equal(output.experiment.day_edit.reason, 'no_safe_replacement');
  assert.equal(output.experiment.route_mutation, false);
  assert.equal(output.stops.length, 0);
});

test('remove rescues retained identities from ranking cuts but never revives closed or client-invented places', async () => {
  const records = rows('shop', 'vintage-shop', 9);
  records[6].opening_hours = 'Mo-Su off';
  const retained = ['shop-7', 'shop-6', 'shop-5', 'client-made-up'];
  const output = await compose(records, ['second_hand'], { dayEdit: edit('remove', 'shop-0', retained) });
  assert.deepEqual(output.stops.map(stop => stop.id).sort(), ['shop-5', 'shop-7']);
  assert.equal(output.experiment.day_edit.status, 'applied');
  assert.deepEqual(output.experiment.day_edit.unavailable_retained_candidate_ids.slice().sort(), ['client-made-up', 'shop-6']);
});

test('precomposition refusal still returns an authoritative edit outcome', async () => {
  const output = await compose([], ['food'], { dayEdit: edit('replace', 'old-food', [], { replacement_preference: 'food' }) });
  assert.equal(output.experiment.day_edit?.status, 'refused');
  assert.equal(output.experiment.day_edit.reason, 'composition_unavailable');
});

test('manual replacement runs the independent walking gate and reports its refusal', async () => {
  const records = [...rows('shop', 'vintage-shop', 3), record('old-food', 'pizza'), record('new-food', 'restaurant')];
  let validations = 0;
  const output = await compose(records, ['food', 'second_hand'], {
    dayEdit: edit('replace', 'old-food', ['shop-0', 'shop-1', 'shop-2'], { replacement_preference: 'food' }),
    walkingRouter: async () => { validations += 1; throw new Error('walking unavailable'); },
  });
  assert.ok(validations > 0, 'edited public chain must pass the existing independent walking gate');
  assert.equal(output.experiment.day_edit?.status, 'refused');
  assert.equal(output.experiment.day_edit.reason, 'walking_validation_failed');
  assert.equal(output.experiment.route_mutation, false);
});

test('malformed direct edit is refused instead of turning into an automatic Full request', async () => {
  let loads = 0;
  const output = await compose([], ['food'], { dayEdit: { action: 'remove', target_stop_count: 99 },
    openDataLoader: async () => { loads += 1; return rows('meal', 'restaurant'); } });
  assert.equal(loads, 0);
  assert.equal(output.experiment.day_edit?.status, 'refused');
  assert.equal(output.experiment.day_edit.reason, 'invalid_day_edit');
});

test('manual walking validation measures exactly the published stop chain and supplies its public metrics', async () => {
  const { routeWalkingPath } = require('../server/walking-router');
  const records = [...rows('shop', 'vintage-shop', 3), record('old-food', 'pizza'), record('new-food', 'restaurant')];
  const measured = [];
  const output = await compose(records, ['food', 'second_hand'], {
    anchorMode: 'place',
    dayEdit: edit('replace', 'old-food', ['shop-0', 'shop-1', 'shop-2'], { replacement_preference: 'food' }),
    walkingRouter: async (points, options) => {
      const result = await routeWalkingPath(points, options);
      measured.push({ points: structuredClone(points), result });
      return result;
    },
  });
  assert.equal(measured.length, 1);
  assert.deepEqual(measured[0].points, output.route.map_route_points.map(({ lat, lng, label }) => ({ lat, lng, label })));
  assert.deepEqual(measured[0].points.map(point => point.label), output.stops.map(stop => stop.label));
  assert.deepEqual(output.route.legs, measured[0].result.legs);
  assert.deepEqual(output.route.map_path_points, measured[0].result.pathPoints);
  assert.equal(output.route.estimated_km, measured[0].result.estimatedKm);
  assert.equal(output.experiment.walking_validation.valid, true);
  assert.equal(output.experiment.eligibility.checks.geometry_validation, 'engine_walk_validated');
  assert.equal(output.experiment.day_edit.status, 'applied');
});

for (const source of [null, 'osrm']) test(`a deferred walking result preserves ${source ?? 'unknown'} geometry provenance`, async () => {
  const { routeWalkingPath } = require('../server/walking-router');
  const records = rows('shop', 'vintage-shop', 5);
  let measured;
  const output = await compose(records, ['second_hand'], {
    anchorMode: 'place', dayEdit: edit('remove', 'shop-0', ['shop-1', 'shop-2', 'shop-3']),
    walkingRouter: async (points, options) => {
      measured = await routeWalkingPath(points, options);
      if (source) measured.source = source;
      else delete measured.source;
      return measured;
    },
  });
  assert.equal(output.experiment.day_edit.status, 'applied');
  assert.equal(output.route.geometry_source, source);
  assert.deepEqual(output.route.map_path_points, measured.pathPoints);
});

test('remove refuses the actual final chain when an independently measured leg exceeds the safety cap', async () => {
  const { routeWalkingPath } = require('../server/walking-router');
  const records = rows('shop', 'vintage-shop', 5);
  const dayEdit = edit('remove', 'shop-0', ['shop-1', 'shop-2', 'shop-3']);
  const safe = await compose(records, ['second_hand'], { dayEdit, anchorMode: 'place' });
  let measured;
  const refused = await compose(records, ['second_hand'], {
    dayEdit, anchorMode: 'place', baselineResult: safe.result,
    walkingRouter: async (points, options) => {
      measured = points;
      const result = await routeWalkingPath(points, options);
      result.legs[0] = { ...result.legs[0], distance_km: 6.1, estimated_walk_minutes: 73 };
      result.estimatedKm = result.legs.reduce((sum, leg) => sum + leg.distance_km, 0);
      return result;
    },
  });
  assert.deepEqual(measured, safe.route.map_route_points.map(({ lat, lng, label }) => ({ lat, lng, label })));
  assert.equal(refused.experiment.walking_validation.valid, false);
  assert.deepEqual(refused.experiment.walking_validation.blockers, ['walking_leg_budget_exceeded']);
  assert.equal(refused.experiment.day_edit.status, 'refused');
  assert.equal(refused.experiment.day_edit.reason, 'walking_validation_failed');
  assert.equal(refused.experiment.route_mutation, false);
  assert.equal(refused.result, safe.result, 'a retained baseline is not advertised as a successful edit');
});

test('one-stop removal still fails closed when its published anchor walk cannot be validated', async () => {
  let validations = 0;
  const output = await compose(rows('shop', 'vintage-shop', 3), ['second_hand'], {
    dayEdit: edit('remove', 'shop-0', ['shop-1']),
    walkingRouter: async () => { validations += 1; throw new Error('walking unavailable'); },
  });
  assert.equal(validations, 1);
  assert.equal(output.experiment.day_edit.status, 'refused');
  assert.equal(output.experiment.route_mutation, false);
  assert.equal(output.experiment.walking_validation.valid, false);
});

test('an edit conflicting with an explicit pin is refused, not silently re-run after shedding that pin', async () => {
  const output = await compose(rows('shop', 'vintage-shop', 5), ['second_hand'], {
    dayEdit: edit('remove', 'shop-0', ['shop-1', 'shop-2']),
    pinnedStopIds: ['shop-0'], distanceMode: 'soft_target', walkingKmTarget: 4,
  });
  assert.equal(output.experiment.day_edit?.status, 'refused');
  assert.equal(output.experiment.day_edit.reason, 'pin_conflict');
  assert.equal(output.experiment.route_mutation, false);
});

test('a later successful one-stop edit does not inherit a stale manual-empty-day marker', async () => {
  const records = rows('shop', 'vintage-shop', 4);
  const empty = await compose(records, ['second_hand'], { dayEdit: edit('remove', 'shop-0', []) });
  assert.equal(empty.result.days[0].manual_empty_day, true);
  const next = await compose(records, ['second_hand'], {
    baselineResult: empty.result, dayEdit: edit('remove', 'shop-0', ['shop-1']),
  });
  assert.equal(next.stops.length, 1);
  assert.equal(next.experiment.day_edit.status, 'applied');
  assert.equal(next.result.days[0].manual_empty_day, undefined);
});

module.exports = { edit };
