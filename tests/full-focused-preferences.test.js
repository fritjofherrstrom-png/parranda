'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');
const { externalRecord } = require('./helpers/planner-reservoir-compare');

// Controlled attributed/corroborated source fixtures, NOT live provider evidence.
const date = '2026-10-22';
function supply(type = 'vintage-shop', count = 6) {
  return Array.from({ length: count }, (_, i) => ({
    ...externalRecord(`${type}-${i}`, `Fixture ${type} ${i}`, type, 55.6 + i * 0.001, 13, []),
    opening_hours: 'Mo-Su 09:00-20:00',
  }));
}
async function compose(rows, preferences, dayRhythm = 'full', extra = {}) {
  const output = await composeAgnosticRouteOutput({
    coords: { lat: 55.6, lng: 13 }, baselineResult: { days: [] },
    externalRequested: true, openDataLoader: async () => rows,
    date, todayIsoDate: '2026-10-14', timezone: 'Europe/Stockholm',
    trustedTimezone: 'Europe/Stockholm', clock: () => new Date('2026-10-14T07:00:00Z'),
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false }),
    synthesizeVia: 'engine', distanceMode: 'no_limit', dayRhythm, preferences, ...extra,
  });
  const route = output.result.days[0]?.primary_route;
  const evidence = { preferences, dayRhythm, pipeline: output.experiment.eligibility.checks.candidate_pipeline,
    blockers: output.experiment.eligibility.blockers, route };
  console.log('focused evidence', JSON.stringify(evidence));
  if (process.env.FOCUSED_EVIDENCE_FILE) fs.appendFileSync(process.env.FOCUSED_EVIDENCE_FILE, JSON.stringify(evidence) + '\n');
  return { ...output, route };
}

test('Full with two interests can spend its density on a rich requested interest rather than the preference count', async () => {
  const rows = [...supply(), ...supply('museum', 1)];
  const { route, experiment } = await compose(rows, ['second_hand', 'culture']);
  assert.ok(route);
  assert.equal(experiment.eligibility.checks.candidate_pipeline.eligible_pool_candidate_count, 7);
  assert.equal(route.main_stops.length, 6, 'six feasible source-backed visits fit the Full profile, including repeated requested activity');
  assert.ok(route.main_stops.some(stop => stop.type === 'museum'));
  assert.ok(route.main_stops.every(stop => ['vintage-shop', 'museum'].includes(stop.type)));
  assert.ok(route.main_stops.every(stop => stop.provisional === true));
});

test('Full and calm use identical rich single-interest pools without inventing filler', async () => {
  for (const [intent, type] of [['second_hand', 'vintage-shop'], ['culture', 'museum']]) {
    const rows = supply(type);
    const calm = await compose(rows, [intent], 'calm');
    const full = await compose(rows, [intent]);
    assert.equal(calm.route.main_stops.length, 4);
    assert.equal(full.route.main_stops.length, 6);
    assert.equal(calm.route.day_profile, 'light');
    assert.equal(full.route.day_profile, 'peak');
    assert.ok(full.route.main_stops.every(stop => stop.type === type && stop.provisional));
    assert.deepEqual(full.route.trust_summary, calm.route.trust_summary);
    assert.ok(full.route.main_stops.every(stop => stop.selected_day_hours.windows[0].closes === '20:00'));
    assert.ok(full.route.legs.every(leg => Number.isFinite(leg.estimated_walk_minutes)));
  }
});

test('two requested interests retain calm/full density differences on the same uneven pool', async () => {
  const rows = [...supply(), ...supply('museum', 1)];
  const calm = await compose(rows, ['second_hand', 'culture'], 'calm');
  const full = await compose(rows, ['second_hand', 'culture']);
  assert.equal(calm.route.main_stops.length, 4);
  assert.equal(full.route.main_stops.length, 6);
  for (const { route } of [calm, full]) {
    assert.ok(route.main_stops.some(stop => stop.type === 'museum'));
    assert.ok(route.main_stops.some(stop => stop.type === 'vintage-shop'));
  }
});

test('thin and closed source pools cannot be filled to Full density', async () => {
  for (const preferences of [['second_hand'], ['culture'], ['second_hand', 'culture']]) {
    const type = preferences.includes('second_hand') ? 'vintage-shop' : 'museum';
    const rows = supply(type, 2);
    const thin = await compose(rows, preferences);
    assert.equal(thin.route.main_stops.length, 2);
    const closed = await compose(rows.map(row => ({ ...row, opening_hours: 'Mo-Su off' })), preferences);
    assert.equal(closed.route, undefined);
    assert.ok(closed.experiment.eligibility.blockers.includes('insufficient_geocoded_candidates'));
    assert.equal(closed.experiment.eligibility.checks.candidate_pipeline.availability_excluded_candidate_count, 2);
  }
});

test('Full may use admitted single-family depth but never upgrades its trust or publishes unattributed filler', async () => {
  for (const preferences of [['second_hand'], ['culture'], ['second_hand', 'culture']]) {
    const rows = [...supply(), ...supply('museum')].map(row => ({ ...row, sources: row.sources.slice(0, 1) }));
    const { route } = await compose(rows, preferences);
    assert.ok(route);
    assert.equal(route.main_stops.length, 6);
    assert.ok(route.main_stops.every(stop => stop.trust?.confidence === 'low' &&
      stop.provenance?.attribution?.length === 1 && stop.provenance?.corroborated_by_external === false));
    assert.equal(route.trust_summary.human_verified, false);
    const rejected = await compose(rows.map(row => ({ ...row, sources: [] })), preferences);
    assert.equal(rejected.route, undefined);
  }
});

test('Full preserves pins and loader-side excludes without weakening availability', async () => {
  const { withoutExcludedCandidates } = require('../server/planner/excluded-candidates');
  const rows = [...supply(), ...supply('museum', 1)];
  const excludedRows = await withoutExcludedCandidates(async () => rows, ['vintage-shop-0'])();
  const pinned = await compose(excludedRows, ['second_hand', 'culture'], 'full', { pinnedStopIds: ['vintage-shop-5'] });
  assert.ok(pinned.route.main_stops.some(stop => stop.id === 'vintage-shop-5'));
  assert.ok(pinned.route.main_stops.every(stop => stop.id !== 'vintage-shop-0'));
  const closedRows = rows.map(row => row.id === 'vintage-shop-5' ? { ...row, opening_hours: 'Mo-Su off' } : row);
  const closed = await compose(closedRows, ['second_hand', 'culture'], 'full', { pinnedStopIds: ['vintage-shop-5'] });
  assert.ok(closed.route.main_stops.every(stop => stop.id !== 'vintage-shop-5'));
});
