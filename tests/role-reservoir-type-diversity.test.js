'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { selectPlannerRoleCandidates } = require('../server/planner/role-selector');
const { admitExperimentalInferredExternalCandidate } = require('../server/planner/agnostic-route-output');
const { buildRegisteredCityCandidateFill } = require('../server/planner/registered-city-candidate-fill');
const { buildLocalDayAvailabilityWindow, buildSelectedDayHoursFact, evaluateOpeningHoursForWindow } =
  require('../server/place-candidates/opening-hours');

const DATE = '2026-11-25';
const ORIGIN = { lat: 59.3293, lng: 18.0686 };
const NAMES = ['Amber Room', 'Birch Cellar', 'Cobalt Corner', 'Dahlia Parlour',
  'Eider Collection', 'Fox Studio', 'Grove Hall', 'Harbour Stage', 'Iris Workshop', 'Juniper House'];

function item(index, kind = 'bar', extra = {}) {
  return {
    id: String.fromCharCode(97 + index) + '-place',
    name: NAMES[index], kind,
    lat: ORIGIN.lat + index * 0.00005,
    lng: ORIGIN.lng + index * 0.00005,
    tags: ['kultur'], time_fit: [],
    ...extra,
  };
}

function select(items, payload = {}, extraHelpers = {}, agnostic = true) {
  return selectPlannerRoleCandidates({
    key: 'type-options-test', label: 'Source-backed types', timezone: 'Europe/Stockholm',
    center: ORIGIN, catalog: { allItems: items, routeTemplates: [] },
    routing: { areaDefinitions: {} }, todayIsoDate: () => DATE,
  }, {
    date: DATE, origin: ORIGIN, preferences: ['culture'], limitPerRole: 6, ...payload,
  }, {
    resolveNowContext: () => ({ date: DATE, hour: 13, weekday: 3, now_iso: DATE + 'T12:00:00Z' }),
    resolveTimeBand: () => null,
    ...(agnostic ? { experimentalAdmitCandidate: admitExperimentalInferredExternalCandidate,
      agnosticTypeOptions: true } : {}),
    ...extraHelpers,
  });
}

function role(result, name = 'culture_stop') {
  const found = result.roles.find(candidate => candidate.role === name);
  assert.ok(found, 'the intended real role must exist');
  return found;
}

const ids = result => role(result).candidates.map(candidate => candidate.candidate_id);
const rich = () => [item(0), item(1), item(2), item(3), item(4, 'museum'),
  item(5, 'gallery'), item(6, 'market'), item(7, 'music'), item(8, 'shop')];

test('equal-rank source types reach the unchanged six-place reservoir', () => {
  const result = role(select(rich()));
  assert.equal(result.candidates.length, 6);
  assert.equal(new Set(result.candidates.map(candidate => candidate.type)).size, 6);
  assert.ok(result.candidates.every(candidate => candidate.covered_preferences.includes('museums')));
  assert.deepEqual(result.candidates.map(candidate => candidate.candidate_id),
    ['a-place', 'e-place', 'f-place', 'g-place', 'h-place', 'i-place']);
});

test('generic or missing source types do not gain a fictional diversity slot', () => {
  const entries = Array.from({ length: 6 }, (_, index) => item(index));
  entries.push(item(7, 'place'), item(8, null));
  assert.deepEqual(ids(select(entries)), entries.slice(0, 6).map(candidate => candidate.id));
});

test('different known selected-day windows do not become equal evidence for type novelty', () => {
  const entries = Array.from({ length: 6 }, (_, index) => item(index));
  entries.push(item(8, 'museum'));
  const window = buildLocalDayAvailabilityWindow({ requestedDate: DATE, nowLocalIso: '2026-11-24T13:00:00' });
  assert.ok(window);
  const result = role(select(entries, {}, {
    evaluateCandidateAvailability: ({ candidate }) => {
      const schedule = candidate.type === 'museum' ? 'We 18:00-23:00' : 'We 11:00-15:00';
      const fact = buildSelectedDayHoursFact(schedule, window);
      assert.equal(fact.status, 'known');
      assert.equal(fact.windows.length, 1);
      return { ...evaluateOpeningHoursForWindow(schedule, window), selected_day_hours: fact };
    },
  }));
  assert.equal(result.candidates.length, 6);
  assert.ok(!result.candidates.some(candidate => candidate.type === 'museum'),
    'different known selected-day windows must not be collapsed by the diversity stratum');
});

test('interleaved evidence groups keep their original cap quotas while gaining type options', () => {
  const entries = [item(0), item(1), item(2), item(3), item(4, 'museum'), item(5, 'music')];
  const lunchIds = new Set(['a-place', 'c-place', 'e-place']);
  const window = buildLocalDayAvailabilityWindow({ requestedDate: DATE, nowLocalIso: '2026-11-24T13:00:00' });
  const result = role(select(entries, { limitPerRole: 4 }, {
    evaluateCandidateAvailability: ({ candidate }) => {
      const schedule = lunchIds.has(candidate.id) ? 'We 11:00-15:00' : 'We 18:00-23:00';
      return { ...evaluateOpeningHoursForWindow(schedule, window),
        selected_day_hours: buildSelectedDayHoursFact(schedule, window) };
    },
  }));
  assert.deepEqual(result.candidates.map(candidate => candidate.candidate_id), ['a-place', 'b-place', 'e-place', 'f-place']);
  assert.equal(result.candidates.filter(candidate => lunchIds.has(candidate.candidate_id)).length, 2);
  assert.equal(result.candidates.filter(candidate => !lunchIds.has(candidate.candidate_id)).length, 2);
});

test('type representatives are deterministic under reversed source order', () => {
  assert.deepEqual(ids(select(rich())), ids(select(rich().reverse())));
});

test('type novelty cannot spend a slot from a higher fit-score group', () => {
  const near = Array.from({ length: 6 }, (_, index) => item(index));
  const far = item(8, 'museum', { lat: ORIGIN.lat + 0.04, lng: ORIGIN.lng });
  const result = role(select([...near, far]));
  assert.equal(result.candidates.length, 6);
  assert.deepEqual(result.candidates.map(candidate => candidate.candidate_id), near.map(candidate => candidate.id));
});

test('same-type deep pools preserve their existing stable prefix', () => {
  const entries = Array.from({ length: 9 }, (_, index) => item(index));
  assert.deepEqual(ids(select(entries)), entries.slice(0, 6).map(candidate => candidate.id));
});

test('a pool that fits the cap keeps its entire existing order', () => {
  const entries = [item(0), item(1), item(4, 'museum'), item(5, 'gallery')];
  assert.deepEqual(ids(select(entries)), entries.map(candidate => candidate.id));
});

test('one-slot selection stays an ordinary ranked choice, not a type preference', () => {
  assert.deepEqual(ids(select(rich(), { limitPerRole: 1 })), ['a-place']);
});

test('explicit pins retain the established prefix and below-cut rescue', () => {
  const entries = rich();
  const result = role(select(entries, { pinnedIds: ['h-place'] }));
  assert.deepEqual(result.candidates.map(candidate => candidate.candidate_id),
    ['a-place', 'b-place', 'c-place', 'd-place', 'e-place', 'f-place', 'h-place']);
});

test('non-agnostic roles do not acquire the new ranking policy from public flags', () => {
  const entries = rich().map(candidate => ({ ...candidate, tags: ['mat'] }));
  const result = role(select(entries, {
    preferences: ['food'], limitPerRole: 3, retain_type_diversity: true, agnosticTypeOptions: true,
  }, {}, false), 'food_anchor');
  assert.deepEqual(result.candidates.map(candidate => candidate.candidate_id), ['a-place', 'b-place', 'c-place']);
});

test('a novel inferred candidate does not replace the six gate-passing curated choices', () => {
  const entries = Array.from({ length: 6 }, (_, index) => item(index));
  const external = [{ id: 'novel-inferred', name: 'Independent Source Museum', type: 'museum',
    lat: ORIGIN.lat + 0.0004, lng: ORIGIN.lng + 0.0004, tags: ['kultur'],
    sources: [{ provider: 'osm', family: 'map', tier: 'inferred', url: 'https://www.openstreetmap.org/node/991234' }],
  }];
  const result = role(select(entries, { include_external_candidates: 1 }, {
    external_provider: { dataset: external },
  }));
  assert.deepEqual(result.candidates.map(candidate => candidate.candidate_id), entries.map(candidate => candidate.id));
});

test('registered preview fill keeps its original source choices despite the shared admission seam', () => {
  const records = Array.from({ length: 5 }, (_, index) => ({
    id: String.fromCharCode(97 + index) + '-place', name: NAMES[index],
    type: index === 4 ? 'gallery' : 'museum',
    lat: ORIGIN.lat + index * 0.00005, lng: ORIGIN.lng + index * 0.00005,
    tags: ['kultur'],
    sources: [{ provider: 'osm', family: 'map', tier: 'inferred',
      url: 'https://www.openstreetmap.org/node/' + (991230 + index) }],
  }));
  const result = buildRegisteredCityCandidateFill({
    cityConfig: {
      key: 'preview-test', label: 'Preview test', visibility: 'preview',
      timezone: 'Europe/Stockholm', center: ORIGIN,
      catalog: { allItems: [], routeTemplates: [] }, routing: { areaDefinitions: {} },
      todayIsoDate: () => DATE,
    },
    rolePayload: { date: DATE, origin: ORIGIN, preferences: ['culture'],
      include_external_candidates: 1, agnosticTypeOptions: true },
    roleOrigin: ORIGIN,
    helpers: {
      external_provider: { dataset: records },
      resolveNowContext: () => ({ date: DATE, hour: 13, weekday: 3, now_iso: DATE + 'T12:00:00Z' }),
      resolveTimeBand: () => null,
    },
    depth: true, catalogDensity: 'thin',
  });
  assert.equal(result.sidecar.used, true, 'the real registered fill path must be exercised');
  assert.deepEqual(result.cityConfig.sourceCandidates.map(candidate => candidate.id),
    ['a-place', 'b-place', 'c-place'], 'registered preview/default fill must remain unchanged');
  assert.ok(result.cityConfig.sourceCandidates.every(candidate => candidate.provisional === true));
});
