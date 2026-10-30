const test = require('node:test');
const assert = require('node:assert/strict');
const { selectPlannerRoleCandidates } = require('../server/planner/role-selector');
const { buildCandidateCombination } = require('../server/planner/candidate-combination');
const {
  mapAdmittedSelectionToSourceCandidates,
  mapPlannerReservoirToSourceCandidates,
  buildWalkingFitReservoirs,
} = require('../server/planner/agnostic-engine-compose');
const { composeAgnosticRouteOutput, admitExperimentalInferredExternalCandidate } = require('../server/planner/agnostic-route-output');

const anchor = { lat: 44.8176, lng: 20.4633 };
const date = '2026-10-24';
const city = { key: 'coverage-fixture', label: 'Coverage fixture', timezone: 'Europe/Belgrade',
  center: anchor, catalog: { allItems: [], routeTemplates: [] }, routing: { areaDefinitions: {} },
  todayIsoDate: () => date };

function rows(type = 'park', tags = [], count = 3) {
  return Array.from({ length: count }, (_, i) => ({ id: `place-${i}`, name: `Место ${i}`, type, tags,
    lat: anchor.lat + .001 * (i + 1), lng: anchor.lng + .001 * (i + 1),
    sources: ['map', 'open_knowledge'].map(family => ({ provider: family, family, tier: 'inferred',
      url: `https://source.example/${i}` })) }));
}

function rolesFor(records, preferences = ['green', 'views']) {
  return selectPlannerRoleCandidates(city, { date, preferences, include_external_candidates: 1, limitPerRole: 6 }, {
    experimentalAdmitCandidate: admitExperimentalInferredExternalCandidate,
    external_provider: { dataset: records },
  });
}

function fit(candidate, covered, partial, missing = []) {
  assert.deepEqual([...candidate.covered_preferences].sort(), [...covered].sort(), `${candidate.id}: exact`);
  assert.deepEqual([...candidate.partial_preferences].sort(), [...partial].sort(), `${candidate.id}: partial`);
  assert.deepEqual([...candidate.missing_preferences].sort(), [...missing].sort(), `${candidate.id}: missing`);
}

async function compose(records, preferences) {
  const result = await composeAgnosticRouteOutput({ coords: anchor,
    baselineResult: { city: 'agnostic', days: [{ date, primary_route: null, alternatives: [] }] },
    externalRequested: true, openDataLoader: async () => records, preferences, date,
    todayIsoDate: '2026-10-23', synthesizeVia: 'engine', dayRhythm: 'balanced', distanceMode: 'no_limit',
    trustedTimezone: 'Europe/Belgrade', clock: () => new Date('2026-10-23T08:00:00Z'),
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false }),
  });
  const route = result.result.days[0].primary_route;
  assert.ok(route, 'real engine publishes a route');
  assert.equal(route.main_stops.length, 2, 'coverage does not increase the two-place output');
  assert.equal(new Set(route.main_stops.map(stop => stop.id)).size, route.main_stops.length);
  return route;
}

for (const scenario of [
  { name: 'plain parks retain Green and weak Views', type: 'park', tags: [], preferences: ['green', 'views'], covered: ['green'], partial: ['scenic'] },
  { name: 'panorama parks retain exact Green and Views', type: 'park', tags: ['panorama'], preferences: ['green', 'views'], covered: ['green', 'scenic'], partial: [] },
  { name: 'cafés retain exact Fika and partial Food', type: 'cafe', tags: [], preferences: ['food', 'fika'], covered: ['coffee'], partial: ['food'] },
]) {
  test(`real composition: ${scenario.name} for each published unique identity`, async () => {
    const route = await compose(rows(scenario.type, scenario.tags, 2), scenario.preferences);
    for (const stop of route.main_stops) {
      fit(stop, scenario.covered, scenario.partial);
      assert.equal(stop.provisional, true, 'the source-backed stop remains provisional');
    }
  });
}

test('selected and reservoir-depth identities retain all admitted assessed role facts', () => {
  const plannerRoles = rolesFor(rows());
  const combination = buildCandidateCombination(plannerRoles);
  const selected = mapAdmittedSelectionToSourceCandidates({ selected: combination.selected, plannerRoles,
    requestedIntents: plannerRoles.requested_preferences });
  const reservoir = mapPlannerReservoirToSourceCandidates({ selected: combination.selected, plannerRoles, dayRhythm: 'balanced' });
  assert.equal(new Set(reservoir.map(candidate => candidate.id)).size, 3);
  assert.ok(reservoir.some(candidate => !candidate.reservoir_selected), 'exercise depth after selected identity dedupe');
  for (const candidate of [...selected, ...reservoir]) fit(candidate, ['green'], ['scenic']);
});

test('unavailable, fallback and nonadmitted secondary roles cannot grant fit via also_covers', () => {
  for (const rejected of [
    { availability: { eligible: false } },
    { candidate_status: 'fallback', planner_usable: false },
    { planner_usable: false, experimental_admission: { allowed: false } },
  ]) {
    const plannerRoles = rolesFor(rows('park', [], 2));
    const secondary = plannerRoles.roles.find(entry => entry.role === 'green_walk_stop');
    secondary.candidates = secondary.candidates.map(candidate => ({ ...candidate, ...rejected }));
    const primary = plannerRoles.roles.find(entry => entry.role === 'scenic_anchor').candidates[0];
    assert.ok(primary.also_covers.some(entry => entry.role === 'green_walk_stop'), 'stale descriptive role metadata is present');
    const mapped = mapAdmittedSelectionToSourceCandidates({ selected: [{ role: 'scenic_anchor', candidate_id: primary.candidate_id }],
      plannerRoles, requestedIntents: plannerRoles.requested_preferences });
    assert.equal(mapped.length, 1);
    fit(mapped[0], [], ['scenic'], ['green']);
  }
});

test('requested filtering keeps a single Views preference partial without adding Green', async () => {
  const route = await compose(rows('park', [], 2), ['views']);
  for (const stop of route.main_stops) fit(stop, [], ['scenic']);
  const plannerRoles = rolesFor(rows('park', [], 2), ['views']);
  const combination = buildCandidateCombination(plannerRoles);
  const mapped = mapPlannerReservoirToSourceCandidates({ selected: combination.selected, plannerRoles, dayRhythm: 'balanced' });
  for (const candidate of mapped) fit(candidate, [], ['scenic']);
});

test('capacity-frontier and walking replacements retain safe same-ID role assessments', () => {
  for (const path of ['frontier', 'walking']) {
    const plannerRoles = rolesFor(rows());
    const scenic = plannerRoles.roles.find(entry => entry.role === 'scenic_anchor');
    const green = plannerRoles.roles.find(entry => entry.role === 'green_walk_stop');
    const tailId = scenic.candidates.at(-1).candidate_id;
    const tail = [{ ...scenic.candidates.at(-1), role: scenic.role }, { ...green.candidates.find(candidate => candidate.candidate_id === tailId), role: green.role }];
    for (const entry of plannerRoles.roles) entry.candidates = entry.candidates.filter(candidate => candidate.candidate_id !== tailId);
    const primary = scenic.candidates[0];
    const selected = [{ role: scenic.role, candidate_id: primary.candidate_id }];
    if (path === 'frontier') plannerRoles.capacity_frontier_candidates = tail;
    else plannerRoles.walking_fit_candidates = tail;
    const reservoir = mapPlannerReservoirToSourceCandidates({ selected, plannerRoles, dayRhythm: 'balanced',
      includeCapacityFrontier: path === 'frontier', walkingKmTarget: 6 });
    const published = path === 'frontier' ? reservoir : buildWalkingFitReservoirs({ sourceCandidates: reservoir,
      plannerRoles, origin: anchor, walkingKmTarget: 6 }).flat();
    const replacement = published.find(candidate => candidate.id === tailId);
    assert.ok(replacement, `${path} adds the already admitted tail identity`);
    fit(replacement, ['green'], ['scenic']);
  }
});
