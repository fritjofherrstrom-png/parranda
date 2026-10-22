'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const { rows, compose } = require('./helpers/day-composition-fixtures');
const { mapPlannerReservoirToSourceCandidates } = require('../server/planner/agnostic-engine-compose');

const ANCHOR = { lat: 56.6, lng: 14 };
const DATE = '2026-10-17';
const NOW = '2026-10-16T08:00:00Z';
const INTERESTS = ['food', 'culture', 'views', 'fika', 'nightlife', 'green', 'second_hand'];
const CANONICAL_INTERESTS = [...INTERESTS].sort();
const TYPES = { food: 'restaurant', culture: 'museum', views: 'viewpoint', fika: 'cafe',
  nightlife: 'bar', green: 'park', second_hand: 'vintage-shop' };
const GREEN_FIRST = ['green', 'second_hand', 'nightlife', 'fika', 'views', 'culture', 'food'];
const FOOD_FIRST = [...GREEN_FIRST].reverse();
const originalFetch = global.fetch;
const networkAttempts = [];

test.before(() => {
  global.fetch = async url => {
    networkAttempts.push(String(url));
    throw new Error('external fetch forbidden by reservoir priority fixtures');
  };
});
test.after(() => {
  global.fetch = originalFetch;
  assert.deepEqual(networkAttempts, [], 'controlled source and clock must not use external fetch');
});

function richSupply() {
  return INTERESTS.flatMap(interest => rows(interest, TYPES[interest])
    .map(row => ({ ...row, lat: row.lat + 1, lng: row.lng + 1 })));
}

const stops = body => body.days?.[0]?.primary_route?.main_stops || [];
const experiment = body => body.agnostic_route_output_experiment;
const ids = body => stops(body).map(stop => stop.id);

function evidence(label, payload) {
  const directory = process.env.PARRANDA_RESERVOIR_EVIDENCE_DIR;
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${label}.json`), JSON.stringify(payload, null, 2));
}

async function fixture(t, supply = richSupply(), overrides = {}) {
  const server = buildApp({
    openDataLoader: async () => structuredClone(supply),
    eventSupply: async () => ({ coverage: 'covered', selected_date: DATE, tonight: [], this_week: [] }),
    sourceCatalog: null,
    reviewedPlaceSource: null,
    placeResolver: null,
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 18,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto',
        utc_offset_seconds: 7200 } }),
    clock: Object.assign(() => new Date(NOW), { now: () => NOW }),
    ...overrides,
  }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return async (label, extra = {}) => {
    const body = { ...ANCHOR, dates: [DATE], preferences: INTERESTS, day_rhythm: 'full',
      distance_mode: 'no_limit', experimental_agnostic_route_output: 1,
      include_external_candidates: 1, agnostic_engine_compose: true, ...extra };
    const response = await requestJson(server, {
      path: '/api/route-recommendations?lang=en', body,
    });
    evidence(label, { source_count: supply.length, request: body, response });
    assert.equal(response.status, 200, 'fixture must reach real HTTP publication');
    return response.body;
  };
}

function assertPublished(body, count = 6) {
  assert.equal(experiment(body)?.promotion?.promote, true, 'real finalizer must publish the route');
  assert.equal(experiment(body)?.walking_validation?.valid, true, 'independent walking gate passes');
  assert.equal(experiment(body)?.context?.time?.now?.slice(0, 10), '2026-10-16',
    'the published composition must use the controlled clock, not the wall date');
  assert.equal(stops(body).length, count);
  assert.equal(new Set(ids(body)).size, count, 'published stops have distinct physical identities');
}

test('rich seven-interest HTTP day keeps rank-1 Green instead of rank-7 Food', async t => {
  const supply = richSupply();
  assert.equal(supply.length, 42);
  const request = await fixture(t, supply);
  const body = await request('seven-green-first', { preference_priority: GREEN_FIRST });
  const pinControl = await request('seven-green-pin-control', {
    preference_priority: GREEN_FIRST, pinned_candidate_ids: ['green-0'],
  });
  assertPublished(body);
  assertPublished(pinControl);
  assert.ok(ids(pinControl).includes('green-0'), 'same Green supply already passes all admission and walking gates');
  assert.ok(stops(body).some(stop => stop.type === 'park'),
    `rank-1 Green was lost before scoring: ${ids(body)}`);
  assert.ok(stops(body).every(stop => stop.type !== 'restaurant'),
    'six slots cannot cover seven equal-evidence interests: rank-7 Food yields to rank-1 Green');
});

test('reversing seven-interest HTTP priority restores rank-1 Food without changing supply or extent', async t => {
  const request = await fixture(t);
  const green = await request('seven-green-reversal', { preference_priority: GREEN_FIRST });
  const food = await request('seven-food-reversal', { preference_priority: FOOD_FIRST });
  assertPublished(green);
  assertPublished(food);
  assert.ok(stops(food).some(stop => stop.type === 'restaurant'));
  assert.ok(stops(food).every(stop => stop.type !== 'park'), 'rank-7 Green yields on the same rich pool');
  assert.notDeepEqual([...ids(green)].sort(), [...ids(food)].sort(),
    'priority must affect content, not merely reorder the same six visits');
});

for (const [label, reorder, priority, present, absent] of [
  ['rank-1-source-last', supply => [...supply.filter(row => row.type !== 'park'),
    ...supply.filter(row => row.type === 'park')], GREEN_FIRST, 'park', 'restaurant'],
  ['reordered-source-rows', supply => [...supply.filter((_, index) => index % 2).reverse(),
    ...supply.filter((_, index) => !(index % 2)).reverse()], GREEN_FIRST, 'park', 'restaurant'],
  ['another-leading-interest', supply => [...supply].reverse(),
    ['second_hand', 'green', 'nightlife', 'fika', 'views', 'food', 'culture'], 'vintage-shop', 'museum'],
]) {
  test(`seven-interest HTTP priority remains separate from canonical interest order: ${label}`, async t => {
    const supply = reorder(richSupply());
    if (label === 'rank-1-source-last') assert.ok(supply.slice(-6).every(row => row.type === 'park'));
    const before = structuredClone(supply);
    const request = await fixture(t, supply);
    const body = await request(label, { preferences: CANONICAL_INTERESTS, preference_priority: priority });
    assertPublished(body);
    assert.ok(stops(body).some(stop => stop.type === present));
    assert.ok(stops(body).some(stop => stop.type === 'park'), 'high-ranked Green remains reachable after source reordering');
    assert.ok(stops(body).every(stop => stop.type !== absent), 'explicit rank 7 yields, not alphabetic selection order');
    assert.deepEqual(supply, before, 'user-specific selection must not replace or mutate the shared source sample');
  });
}

test('neutral seven-interest HTTP requests preserve the legacy spine, never infer priority from selected-set order', async t => {
  const request = await fixture(t);
  const expected = ['culture-0', 'fika-0', 'food-0', 'nightlife-0', 'second_hand-0', 'views-0'];
  const cases = [
    ['neutral-absent', {}],
    ['neutral-empty', { preference_priority: [] }],
    ['neutral-reversed-selection', { preferences: [...INTERESTS].reverse() }],
  ];
  for (const [label, options] of cases) {
    const body = await request(label, options);
    assertPublished(body);
    assert.deepEqual([...ids(body)].sort(), expected);
  }
});

for (const [label, priority, present, absent] of [
  ['green', GREEN_FIRST, 'park', 'restaurant'],
  ['food', FOOD_FIRST, 'restaurant', 'park'],
]) {
  test(`actual composition finalizer honors ${label}-first on the identical rich seven-interest source pool`, async () => {
    const output = await compose(richSupply(), INTERESTS, {
      coords: ANCHOR, date: DATE, preferencePriority: priority,
    });
    const body = { ...output.result, agnostic_route_output_experiment: output.experiment };
    evidence(`finalizer-${label}-first`, { source_count: 42, preferencePriority: priority, output });
    assert.equal(output.experiment.route_mutation, true, 'composition installs the actual finalized day');
    assert.equal(output.experiment.walking_validation.valid, true);
    assert.equal(stops(body).length, 6);
    assert.ok(output.stops.some(stop => stop.type === present));
    assert.ok(output.stops.every(stop => stop.type !== absent));
  });
}

test('seven-interest priority preserves lower-ranked pins and excludes known-closed or explicitly excluded Green venues', async t => {
  const supply = richSupply();
  supply.find(row => row.id === 'green-0').opening_hours = 'Mo-Su off';
  const request = await fixture(t, supply);
  const body = await request('seven-pin-closure-exclusion', {
    preference_priority: GREEN_FIRST,
    pinned_candidate_ids: ['food-0', 'green-5', 'green-0'],
    excluded_candidate_ids: ['green-1'],
  });
  assertPublished(body);
  assert.ok(ids(body).includes('food-0'), 'an explicit pin outranks content priority');
  assert.ok(ids(body).includes('green-5'), 'admitted non-winning identity remains pinnable');
  assert.ok(ids(body).every(id => !['green-0', 'green-1'].includes(id)));
  assert.equal(experiment(body).pinned_candidates.honored_count, 2);
  assert.equal(experiment(body).pinned_candidates.unhonored_count, 1);
});

test('rank-1 Green cannot revive a fully known-closed interest to achieve coverage', async t => {
  const supply = richSupply().map(row => row.type === 'park'
    ? { ...row, opening_hours: 'Mo-Su off' } : row);
  const request = await fixture(t, supply);
  const body = await request('seven-green-closed', { preference_priority: GREEN_FIRST });
  assertPublished(body);
  assert.ok(stops(body).every(stop => stop.type !== 'park'));
  assert.ok(stops(body).some(stop => stop.type === 'restaurant'), 'safe lower-priority supply remains usable');
  assertGreenShortfall(body);
});

function assertGreenShortfall(body) {
  const coverage = experiment(body).constraint_negotiation.preference_coverage;
  assert.ok(!coverage.covered_preferences.includes('green'), 'unavailable exact Green fit must not be fabricated');
  assert.ok([...coverage.partial_preferences, ...coverage.missing_preferences].includes('green'),
    'publication must truthfully disclose partial or missing Green supply');
  assert.ok(experiment(body).constraint_negotiation.tradeoffs.some(reason => /green/.test(reason)));
}

test('rank-1 Green outside walking reach is not upgraded and its shortfall remains explicit', async t => {
  const supply = richSupply().map(row => row.type === 'park'
    ? { ...row, lat: row.lat + 0.2 } : row);
  const request = await fixture(t, supply);
  const body = await request('seven-green-outside-reach', {
    preferences: CANONICAL_INTERESTS, preference_priority: GREEN_FIRST,
  });
  assertPublished(body);
  assert.ok(stops(body).every(stop => stop.type !== 'park'), 'priority is not authority to relax walking reach');
  assertGreenShortfall(body);
});

test('seven-interest priority cannot override independent walking refusal of an explicitly retained chain', async t => {
  let validations = 0;
  const request = await fixture(t, richSupply(), {
    walkingRouter: async () => { validations += 1; throw new Error('controlled walking refusal'); },
  });
  const body = await request('seven-walking-refused', {
    preference_priority: GREEN_FIRST,
    day_edit: { version: 1, action: 'remove', candidate_id: 'nightlife-0',
      retained_candidate_ids: ['fika-0', 'second_hand-0', 'views-0', 'culture-0', 'green-0'],
      target_stop_count: 5, slot_index: 5, replacement_preference: null,
      removed_candidate_ids: ['nightlife-0'] },
  });
  assert.ok(validations > 0, 'actual finalizer must run independent walking validation');
  assert.equal(experiment(body).walking_validation.valid, false);
  assert.equal(experiment(body).promotion.promote, false);
  assert.equal(experiment(body).day_edit.reason, 'walking_validation_failed');
  assert.equal(stops(body).length, 0);
});

// Unit-level reservoir controls use explicitly admitted role records. Public
// tests above separately exercise real source eligibility and final publication.
function admittedRoles() {
  const specs = [
    ['scenic_anchor', 'views', 'scenic', 'anchor'],
    ['food_anchor', 'food', 'food', 'anchor'],
    ['coffee_fika_stop', 'fika', 'coffee', 'stop'],
    ['evening_bar_option', 'nightlife', 'bars', 'option'],
    ['vintage_second_hand_option', 'second_hand', 'second_hand', 'option'],
    ['culture_stop', 'culture', 'museums', 'stop'],
    ['green_walk_stop', 'green', 'green', 'stop'],
  ];
  const records = richSupply();
  const roles = specs.map(([role, interest, intent, slot]) => ({
    role, requested: true, slot,
    candidates: records.filter(record => record.type === TYPES[interest]).map(record => ({
      candidate_id: record.id, label: record.name, type: record.type,
      coordinates: { lat: record.lat, lng: record.lng },
      candidate_status: 'usable', planner_usable: true, origin: 'external_open', confidence: 'medium',
      covered_preferences: [intent], partial_preferences: [], availability: { eligible: true },
      provenance: { source_tier: 'inferred', human_verified: false, attribution: record.sources },
    })),
  }));
  return {
    plannerRoles: { requested_preferences: specs.map(([, , intent]) => intent), roles },
    selected: roles.slice(0, 6).map(entry => ({ role: entry.role, ...entry.candidates[0] })),
  };
}

for (const limit of [8, 12]) {
  test(`bounded ${limit}-candidate rhythm reservoir offers missing exact coverage before repeated selected-role depth`, () => {
    const input = admittedRoles();
    const before = structuredClone(input);
    const result = mapPlannerReservoirToSourceCandidates({ ...input,
      dayRhythm: 'full', includeCapacityFrontier: false, limit });
    assert.equal(result.length, limit);
    assert.equal(new Set(result.map(candidate => candidate.id)).size, limit);
    assert.ok(result.some(candidate => candidate.id === 'green-0'),
      'an eligible requested role must reach priority scoring before role-depth fill');
    const admitted = new Set(input.plannerRoles.roles.flatMap(role => role.candidates.map(candidate => candidate.candidate_id)));
    assert.ok(result.every(candidate => admitted.has(candidate.id)));
    assert.deepEqual(input, before, 'projection must not mutate the admitted role reservoir');
  });
}

test('legacy distance reservoir keeps its smaller depth and original neutral selected-role behavior', () => {
  const result = mapPlannerReservoirToSourceCandidates({ ...admittedRoles(), includeCapacityFrontier: false });
  assert.deepEqual(result.map(candidate => candidate.id),
    ['views-0', 'food-0', 'fika-0', 'nightlife-0', 'second_hand-0', 'culture-0', 'views-1', 'food-1']);
});

test('advancing safe coverage preserves the existing deferred experimental-support bridge accounting', () => {
  const input = admittedRoles();
  for (const role of input.plannerRoles.roles) role.candidates = role.candidates.slice(0, 1);
  const market = { ...structuredClone(input.plannerRoles.roles.at(-1).candidates[0]),
    candidate_id: 'existing-market-support', label: 'Existing market', type: 'market',
    covered_preferences: ['markets'], confidence: 'low', experimental_admission: { allowed: true } };
  input.plannerRoles.requested_preferences.push('markets');
  input.plannerRoles.roles.push({ role: 'market_stop', requested: true, slot: 'stop', candidates: [market] });
  const result = mapPlannerReservoirToSourceCandidates({ ...input, dayRhythm: 'full', includeCapacityFrontier: false });
  assert.equal(result.length, 8, 'moving the same safe support earlier must not remove a previously allowed bridge');
  assert.ok(result.some(candidate => candidate.id === 'green-0'));
  assert.equal(result.find(candidate => candidate.id === market.candidate_id)?.trust.confidence, 'low');
});

for (const [label, change] of [
  ['empty authoritative fit', candidate => { candidate.covered_preferences = []; }],
  ['closed availability', candidate => { candidate.availability.eligible = false; }],
  ['experimental support', candidate => { candidate.experimental_admission = { allowed: true }; }],
  ['not planner usable', candidate => { candidate.planner_usable = false; }],
]) {
  test(`early coverage does not invent admission for ${label}`, () => {
    const input = admittedRoles();
    input.plannerRoles.roles.at(-1).candidates.forEach(change);
    const result = mapPlannerReservoirToSourceCandidates({ ...input, dayRhythm: 'full', includeCapacityFrontier: false });
    assert.equal(result.length, 12);
    assert.ok(result.every(candidate => candidate.role !== 'green_walk_stop'));
  });
}
