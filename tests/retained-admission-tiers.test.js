'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compose, record, rows } = require('./helpers/day-composition-fixtures');

const originalFetch = global.fetch;
test.before(() => { global.fetch = async () => { throw new Error('unexpected network'); }; });
test.after(() => { global.fetch = originalFetch; });

function inferredMuseum(id, index) {
  const candidate = record(id, 'museum', index);
  return { ...candidate, sources: candidate.sources.slice(0, 1) };
}

for (const stillPinned of [true, false]) test(`a published inferred ${stillPinned ? 'Keep' : 'retained stop'} survives a newly corroborated same-role peer during replacement`, async () => {
  // Controlled source fixtures, not a claim of real-provider acceptance. The
  // initial publication proves the lower-tier place was genuinely usable.
  const museums = Array.from({ length: 9 }, (_, index) => inferredMuseum(`culture-${index}`, index));
  const keptId = museums.at(-1).id;
  const records = [...museums, ...rows('meal', 'restaurant', 3), ...rows('view', 'viewpoint', 3)];
  const first = await compose(records, ['culture', 'food', 'views'], {
    dayRhythm: 'balanced', pinnedStopIds: [keptId],
  });
  assert.ok(first.stops.some(stop => stop.id === keptId), 'precondition: real composer published the kept inferred place');
  const target = first.stops.find(stop => stop.type === 'restaurant');
  assert.ok(target, 'precondition: published day has a food slot to replace');
  const retained = first.stops.filter(stop => stop.id !== target.id).map(stop => stop.id);
  const nextRecords = [...records.filter(candidate => candidate.id !== target.id),
    record('new-corroborated-museum', 'museum', 1)];
  const output = await compose(nextRecords, ['culture', 'food', 'views'], {
    dayRhythm: 'balanced', pinnedStopIds: stillPinned ? [keptId] : [],
    dayEdit: { version: 1, action: 'replace', candidate_id: target.id,
      retained_candidate_ids: retained, target_stop_count: first.stops.length,
      slot_index: first.stops.findIndex(stop => stop.id === target.id),
      replacement_preference: 'food', removed_candidate_ids: [target.id] },
  });
  assert.equal(output.experiment.day_edit?.status, 'applied',
    `an individually admitted Keep must not disappear at a relative best-tier cut: ${output.experiment.day_edit?.reason}`);
  assert.equal(output.stops.length, first.stops.length);
  assert.ok(retained.every(id => output.stops.some(stop => stop.id === id)));
  assert.ok(!output.stops.some(stop => stop.id === target.id));
  assert.ok(output.stops.some(stop => stop.id === output.experiment.day_edit.replacement_candidate_id && stop.type === 'restaurant'));
  const kept = output.stops.find(stop => stop.id === keptId);
  const originalKept = first.stops.find(stop => stop.id === keptId);
  assert.equal(originalKept.trust.confidence, 'low', 'precondition: the previously published stop is still lower-trust');
  assert.deepEqual(kept.trust, originalKept.trust, 'retention must not upgrade trust or confidence');
  assert.deepEqual(kept.source, originalKept.source, 'retention must preserve the source facts');
  assert.equal(kept.provisional, true, 'retention must preserve the provisional label');
  assert.equal(output.route.uses_provisional_sources, true, 'retention must not erase source uncertainty');
});

test('a real closure still refuses a previously published inferred Keep in a mixed-tier role', async () => {
  const kept = inferredMuseum('kept-culture', 1);
  const records = [kept, ...rows('meal', 'restaurant', 3), ...rows('view', 'viewpoint', 3)];
  const first = await compose(records, ['culture', 'food', 'views'], {
    dayRhythm: 'balanced', pinnedStopIds: [kept.id],
  });
  assert.ok(first.stops.some(stop => stop.id === kept.id), 'precondition: the original Keep was published');
  const target = first.stops.find(stop => stop.type === 'restaurant');
  assert.ok(target);
  const retained = first.stops.filter(stop => stop.id !== target.id).map(stop => stop.id);
  const changed = records.filter(candidate => candidate.id !== target.id).map(candidate =>
    candidate.id === kept.id ? { ...candidate, opening_hours: 'Mo-Su off' } : candidate);
  const output = await compose([...changed, record('new-corroborated-culture', 'museum', 2)],
    ['culture', 'food', 'views'], {
      dayRhythm: 'balanced', pinnedStopIds: [kept.id],
      dayEdit: { version: 1, action: 'replace', candidate_id: target.id,
        retained_candidate_ids: retained, target_stop_count: first.stops.length,
        slot_index: first.stops.findIndex(stop => stop.id === target.id),
        replacement_preference: 'food', removed_candidate_ids: [target.id] },
    });
  assert.equal(output.experiment.day_edit?.status, 'refused');
  assert.equal(output.experiment.route_mutation, false);
  assert.equal(output.stops.length, 0, 'a retained ID must never revive a closed place');
});
