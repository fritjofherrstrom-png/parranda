'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateRecommendations } = require('../server/route-engine');
const { buildAgnosticEngineCityConfig } = require('../server/planner/agnostic-engine-compose');
const { anchor, record, rows } = require('./helpers/day-composition-fixtures');

const originalFetch = global.fetch;
test.before(() => { global.fetch = async () => { throw new Error('unexpected network'); }; });
test.after(() => { global.fetch = originalFetch; });

function remove(retained, extra = {}) {
  return { version: 1, action: 'remove', candidate_id: 'shop-0',
    retained_candidate_ids: retained, target_stop_count: retained.length,
    slot_index: 0, replacement_preference: null, removed_candidate_ids: ['shop-0'], ...extra };
}

async function direct(records, { dayEdit, preferences = ['second_hand'], preferencePriority = [], ...options } = {}) {
  // Explicitly admitted engine-reservoir fixtures. Source eligibility is tested
  // at the composition seam, not replaced by this pure direct-engine control.
  const sourceCandidates = records.map(record => ({ ...record, label: record.name,
    candidate_kind: 'draft_place', city_pack_owned: false,
    trust: { source_tier: 'inferred', confidence: 'needs_review', human_verified: false },
    source: { kind: 'open_geo_source', label: 'OpenStreetMap' },
  }));
  const cityConfig = buildAgnosticEngineCityConfig({ anchor, sourceCandidates,
    timezone: 'Europe/Stockholm', todayIsoDate: '2026-10-16', dayProfile: 'peak', dayEdit, preferencePriority });
  return generateRecommendations({ cityConfigOverride: cityConfig, dates: ['2026-10-22'],
    start: { type: 'auto' }, end: { type: 'auto' }, walkingKmTarget: 6,
    distanceMode: 'no_limit', dayRhythm: 'full', preferences, ...options });
}

test('direct engine publishes a deliberate zero-stop edit as a truthful manual empty day, not an empty route', async () => {
  const result = await direct(rows('shop', 'vintage-shop', 8), { dayEdit: remove([]) });
  const day = result.days[0];
  assert.equal(day.primary_route, null);
  assert.equal(day.manual_empty_day, true);
  assert.equal(day.day_edit?.status, 'applied');
  assert.equal(day.day_edit.actual_stop_count, 0);
  assert.deepEqual(day.day_edit.result_candidate_ids, []);
  assert.deepEqual(day.alternatives, []);
});

test('direct engine exposes a refused replacement as a refused day, never a successful empty route', async () => {
  const result = await direct(rows('shop', 'vintage-shop', 4), {
    preferences: ['food', 'second_hand'],
    dayEdit: { ...remove(['shop-1', 'shop-2']), action: 'replace', candidate_id: 'old-food',
      removed_candidate_ids: ['old-food'], target_stop_count: 3, replacement_preference: 'food' },
  });
  const day = result.days[0];
  assert.equal(day.primary_route, null);
  assert.equal(day.day_edit?.status, 'refused');
  assert.equal(day.day_edit.reason, 'no_safe_replacement');
  assert.equal(day.manual_empty_day, undefined);
  assert.deepEqual(day.alternatives, []);
});

for (const count of [1, 6]) {
  test(`direct generateRecommendations preserves exactly ${count} edited identities through final ranking and walking truth`, async () => {
    const retained = rows('shop', 'vintage-shop', count + 1).slice(1).map(record => record.id);
    const result = await direct(rows('shop', 'vintage-shop', 9), { dayEdit: remove(retained) });
    const route = result.days[0].primary_route;
    assert.ok(route);
    assert.deepEqual(route.main_stops.map(stop => stop.id), retained);
    assert.equal(route.day_edit.status, 'applied');
    assert.equal(route.day_edit.actual_stop_count, count);
    assert.deepEqual(route.day_edit.result_candidate_ids, retained);
    assert.ok(route.main_stops.every(stop => stop.provisional && !stop.trust.human_verified));
    assert.ok(result.days[0].alternatives.every(alternative =>
      alternative.main_stops.length === count && alternative.main_stops.every(stop => retained.includes(stop.id))));
  });
}

for (const count of [0, 1]) {
  test(`direct Adjust recomposition retains the manual ${count}-stop cap over a rich new interest pool`, async () => {
    const retained = count ? ['shop-1'] : [];
    const result = await direct([...rows('shop', 'vintage-shop', 8), ...rows('culture', 'museum', 8)], {
      dayEdit: remove(retained, { preserve_retained: false }), preferences: ['culture'],
    });
    const day = result.days[0];
    assert.equal(day.primary_route?.main_stops.length || 0, count);
    const outcome = day.primary_route?.day_edit || day.day_edit;
    assert.equal(outcome.status, 'applied');
    assert.equal(outcome.reason, 'recomposed_with_cap');
    assert.equal(outcome.actual_stop_count, count);
    assert.ok((day.primary_route?.main_stops || []).every(stop => stop.type === 'museum'));
  });
}

test('direct six-stop replacement preserves five other identities and exactly one same-interest alternative', async () => {
  const retained = rows('shop', 'vintage-shop', 6).slice(1).map(record => record.id);
  const result = await direct([...rows('shop', 'vintage-shop', 8), record('old-food', 'pizza'),
    record('new-food', 'restaurant'), record('unrequested-park', 'park')], {
    preferences: ['food', 'second_hand'],
    dayEdit: { ...remove(retained), action: 'replace', candidate_id: 'old-food',
      removed_candidate_ids: ['old-food'], target_stop_count: 6, slot_index: 2, replacement_preference: 'food' },
  });
  const route = result.days[0].primary_route;
  assert.equal(route.main_stops.length, 6);
  assert.equal(route.main_stops[2].id, 'new-food');
  assert.deepEqual(route.main_stops.filter(stop => stop.id !== 'new-food').map(stop => stop.id), retained);
  assert.equal(route.day_edit.status, 'applied');
  assert.equal(route.day_edit.replacement_candidate_id, 'new-food');
});

test('direct engine obeys reversed interest priority rather than dropping it at the wrapper boundary', async () => {
  const records = [...rows('culture', 'museum'), ...rows('view', 'viewpoint')];
  const culture = await direct(records, { preferences: ['culture', 'views'], preferencePriority: ['culture', 'views'] });
  const views = await direct(records, { preferences: ['culture', 'views'], preferencePriority: ['views', 'culture'] });
  const stops = result => result.days[0].primary_route.main_stops;
  assert.equal(stops(culture).length, 6);
  assert.equal(stops(views).length, 6);
  assert.ok(stops(culture).filter(stop => stop.type === 'museum').length >
    stops(views).filter(stop => stop.type === 'museum').length);
});
