'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const decision = require('../anywhere-render-decision');

function emptyPublished() {
  return { days: [{ date: '2026-10-17', manual_empty_day: true, primary_route: null, alternatives: [] }],
    agnostic_route_output_experiment: { manual_edit_published: true, promotion: { promote: false },
      day_edit: { version: 1, action: 'remove', status: 'applied', target_stop_count: 0,
        actual_stop_count: 0, result_candidate_ids: [] } } };
}

test('server-published intentional emptiness is distinct from a route and from source failure', () => {
  const response = emptyPublished();
  const cls = decision.classifyAnywhereResult(response, { place: 'Fixture Town' });
  assert.equal(cls.status, 'edited_empty');
  assert.equal(decision.isComposedStatus(cls.status), false, 'an empty choice must not promise a walking route');
  const safe = decision.safeResponseFor(response, cls);
  assert.equal(safe.days[0].date, '2026-10-17');
  assert.equal(safe.days[0].primary_route, null);
  assert.equal(safe.days[0].manual_empty_day, true);
});

for (const [name, alter] of [
  ['missing publisher marker', response => { delete response.agnostic_route_output_experiment.manual_edit_published; }],
  ['truthy publisher marker', response => { response.agnostic_route_output_experiment.manual_edit_published = 'true'; }],
  ['refused command', response => { response.agnostic_route_output_experiment.day_edit.status = 'refused'; }],
  ['a missing nonzero retained selection', response => { response.agnostic_route_output_experiment.day_edit.target_stop_count = 3; }],
  ['contradictory nonempty route', response => { response.days[0].primary_route = { main_stops: [{ id: 'venue' }] }; }],
]) test(`${name} cannot masquerade as intentional empty state`, () => {
  const response = emptyPublished(); alter(response);
  assert.notEqual(decision.classifyAnywhereResult(response).status, 'edited_empty');
});
