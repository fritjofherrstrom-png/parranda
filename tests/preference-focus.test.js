const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesPreferenceFocus, preferenceFit } = require('../server/planner/preference-focus');

test('all modern UI choices and pairs use canonical intent fit', () => {
  for (const [ui, canonical] of [['second_hand','second_hand'],['food','food'],['culture','museums'],
    ['views','scenic'],['fika','coffee'],['nightlife','bars'],['green','green']]) {
    assert.equal(matchesPreferenceFocus({ covered_preferences: [canonical] }, [ui]), true);
    assert.equal(matchesPreferenceFocus({ covered_preferences: ['swimming'] }, [ui]), false);
  }
  assert.equal(matchesPreferenceFocus({ covered_preferences: ['coffee'] }, ['second_hand','fika']), true);
  assert.equal(matchesPreferenceFocus({ covered_preferences: ['museums'] }, ['second_hand','fika']), false);
});

test('explicit fit outranks category guesses and partial fit stays partial', () => {
  assert.equal(matchesPreferenceFocus({ type: 'vintage-shop', covered_preferences: [], partial_preferences: [] }, ['second_hand']), false);
  const park = { type: 'park', partial_preferences: ['scenic'] };
  assert.equal(matchesPreferenceFocus(park, ['views']), true);
  assert.deepEqual(preferenceFit(park), { coveredPreferences: [], partialPreferences: ['scenic'] });
});

test('unassessed catalog types use the shared vocabulary without relabeling ordinary retail', () => {
  for (const type of ['vintage-shop','charity-shop','antiques-shop','thrift-shop'])
    assert.equal(matchesPreferenceFocus({ type }, ['second_hand']), true);
  assert.equal(matchesPreferenceFocus({ type: 'shop', tags: ['shopping'] }, ['second_hand']), false);
  assert.equal(matchesPreferenceFocus({ kind: 'cafe' }, ['fika']), true);
});

test('no preferences permits diversity and a named kept place remains an explicit choice', () => {
  const museum = { id: 'kept-museum', covered_preferences: ['museums'] };
  assert.equal(matchesPreferenceFocus(museum, []), true);
  assert.equal(matchesPreferenceFocus(museum, ['second_hand']), false);
  assert.equal(matchesPreferenceFocus(museum, ['second_hand'], ['kept-museum']), true);
});


test('focused rhythm expands proposals generically but keeps a short remaining day local', () => {
  const { resolveAgnosticCandidateReachPolicy } = require('../server/planner/candidate-reach-policy');
  for (const preference of ['second_hand','culture','fika']) {
    const input = { anchorMode:'coordinates', dayRhythm:'calm', preferences:[preference] };
    assert.equal(resolveAgnosticCandidateReachPolicy(input).max_origin_distance_km, 5);
    assert.equal(resolveAgnosticCandidateReachPolicy({ ...input,
      availabilityWindow:{startMinute:1300,endMinute:1440} }).max_origin_distance_km, 3);
  }
  assert.equal(resolveAgnosticCandidateReachPolicy({anchorMode:'coordinates'}).max_origin_distance_km, 3);
});
