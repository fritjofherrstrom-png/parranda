'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const { matchesPreferenceFocus } = require('../server/planner/preference-focus');

// Actual server-owned catalog and real HTTP/composition/publication. Rome is
// the reported reproduction, not a production rule. All external seams/clock
// are controlled; no assertion relies on a network response or today's date.
const DATE = '2026-10-27';
async function fixture(t) {
  const server = buildApp({
    openDataLoader: async () => [], sourceCatalog: null, reviewedPlaceSource: null, placeResolver: null,
    eventSupply: async () => ({ coverage: 'covered', selected_date: DATE, tonight: [], this_week: [] }),
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 18,
      timezone_resolution: { timezone: 'Europe/Rome', timezone_source: 'weather_provider_auto', utc_offset_seconds: 3600 } }),
    clock: Object.assign(() => new Date('2026-10-27T01:20:00Z'), { now: () => '2026-10-27T01:20:00Z' }),
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return extra => requestJson(server, { path: '/api/route-recommendations?lang=en', body: {
    lat: 41.8933203, lng: 12.4829321, dates: [DATE], preferences: ['culture'], day_rhythm: 'balanced',
    distance_mode: 'no_limit', experimental_agnostic_route_output: 1, include_external_candidates: 1,
    agnostic_engine_compose: true, ...extra,
  } });
}
const stops = b => b.days?.[0]?.primary_route?.main_stops || [];
function edit(ids, action = 'remove', preference = 'culture') {
  return { version: 1, action, candidate_id: ids[0], retained_candidate_ids: ids.slice(1),
    target_stop_count: ids.length - (action === 'remove' ? 1 : 0), slot_index: 0,
    replacement_preference: action === 'replace' ? preference : null, removed_candidate_ids: [ids[0]] };
}

for (const action of ['remove', 'replace']) test(`HTTP ${action} publishes explicit retained stops after requested preferences change`, async t => {
  const request = await fixture(t);
  const original = await request({});
  assert.equal(original.status, 200);
  const ids = stops(original.body).map(s => s.id);
  assert.equal(ids.length, 5, 'precondition: actual five-stop catalog day was published');
  const unchanged = await request({ day_edit: edit(ids, action), excluded_candidate_ids: [ids[0]] });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.agnostic_route_output_experiment.day_edit.status, 'applied');
  assert.ok(stops(unchanged.body).every(s => matchesPreferenceFocus(s, ['culture'])),
    'same-identity assessed Culture facts now survive the original role reassignment');
  // Same-identity role assessments now correctly retain Culture. Change the
  // requested interest so this still exercises a genuine soft-fit exception
  // for explicit retained identities, without removing any source facts.
  const preferences = ['views'];
  const result = await request({ preferences, day_edit: edit(ids, action, 'views'), excluded_candidate_ids: [ids[0]] });
  assert.equal(result.status, 200);
  const experiment = result.body.agnostic_route_output_experiment;
  const diagnostic = experiment.experimental_route.main_stops;
  assert.ok(diagnostic.some(s => ids.slice(1).includes(s.id) && !matchesPreferenceFocus(s, preferences)),
    'discriminating precondition: a retained identity has no requested Views match');
  assert.equal(experiment.day_edit.status, 'applied', JSON.stringify(experiment.promotion));
  assert.equal(experiment.promotion.promote, true);
  assert.equal(experiment.walking_validation.valid, true);
  assert.equal(stops(result.body).length, action === 'remove' ? 4 : 5);
  assert.deepEqual(stops(result.body).filter(s => ids.slice(1).includes(s.id)).map(s => s.id), ids.slice(1));
  assert.ok(!stops(result.body).some(s => s.id === ids[0]));
  const retained = stops(result.body).find(s => !matchesPreferenceFocus(s, preferences));
  assert.deepEqual(retained.covered_preferences, [], 'manual retention cannot invent preference evidence');
  if (action === 'replace') {
    const replacement = stops(result.body).find(s => !ids.includes(s.id));
    assert.ok(replacement && matchesPreferenceFocus(replacement, preferences), 'the new stop still needs requested relevance');
  }
});
