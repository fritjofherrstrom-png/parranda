const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCandidateIdentity, wikidataIdOf } = require('../server/candidates/entity-resolution');

const permutations = items => items.length ? items.flatMap((item, i) =>
  permutations(items.filter((_, j) => i !== j)).map(rest => [item, ...rest])) : [[]];

function record(id, label, qid, offset = 0) {
  return { id, label, type: 'museum', lat: 46 + offset, lng: 8,
    evidence: [{ claim_type: 'existence', value: true, source_ref: qid
      ? { provider_id: 'wikidata', source_family: 'open_knowledge', url: `https://www.wikidata.org/wiki/${qid}` }
      : { provider_id: 'osm', source_family: 'map', url: `https://www.openstreetmap.org/node/${id}` } }],
  };
}

for (const label of ['Juniper Museum', 'Μουσείο Αλκυόνη', 'Музей Рассвет']) {
  test(`ambiguous ${label}: source order cannot choose which distinct entity gets map corroboration`, () => {
    const map = record('map-1', label, null);
    const one = record('knowledge-1', label, 'Q11', .0001);
    const two = record('knowledge-2', label, 'Q22', .0002);
    for (const input of permutations([map, one, two])) {
      const result = resolveCandidateIdentity(input);
      assert.equal(result.summary.merged_count, 0, input.map(c => c.id).join(','));
      assert.equal(result.candidates.length, 3);
      for (const entity of result.candidates.filter(c => wikidataIdOf(c))) {
        assert.ok(!entity.evidence.some(e => e.source_ref.source_family === 'map'));
      }
    }
  });
}

test('duplicate rows of one explicit entity still corroborate the unique map place', () => {
  const records = [record('map-1', 'Juniper Museum', null),
    record('knowledge-1', 'Juniper Museum', 'Q11', .0001),
    record('knowledge-duplicate', 'Juniper Museum', 'Q11', .0002)];
  for (const input of permutations(records)) {
    const result = resolveCandidateIdentity(input);
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(new Set(result.candidates[0].evidence.map(e => e.source_ref.source_family)),
      new Set(['map', 'open_knowledge']));
  }
});

test('an explicit map entity merges with its twin, despite an identically named neighbouring entity', () => {
  const map = record('map-1', 'Juniper Museum', 'Q11');
  map.evidence[0].source_ref.provider_id = 'osm';
  map.evidence[0].source_ref.source_family = 'map';
  const one = record('knowledge-1', 'Juniper Museum', 'Q11', .0001);
  const two = record('knowledge-2', 'Juniper Museum', 'Q22', .0002);
  for (const input of permutations([map, one, two])) {
    const result = resolveCandidateIdentity(input);
    assert.equal(result.candidates.length, 2);
    const first = result.candidates.find(c => wikidataIdOf(c) === 'Q11');
    const other = result.candidates.find(c => wikidataIdOf(c) === 'Q22');
    assert.deepEqual(new Set(first.evidence.map(e => e.source_ref.source_family)), new Set(['map', 'open_knowledge']));
    assert.ok(!other.evidence.some(e => e.source_ref.source_family === 'map'));
  }
});

test('a nearby unrelated category or far namesake does not block a unique identity merge', () => {
  for (const changes of [{ type: 'restaurant' }, { lat: 46.02 }]) {
    const map = record('map-1', 'Juniper Museum', null);
    const one = record('knowledge-1', 'Juniper Museum', 'Q11', .0001);
    const other = { ...record('knowledge-2', 'Juniper Museum', 'Q22', .0002), ...changes };
    for (const input of permutations([map, one, other])) {
      const result = resolveCandidateIdentity(input);
      assert.equal(result.candidates.length, 2);
      assert.equal(result.summary.merged_count, 1);
    }
  }
});

test('ambiguous identity survives deduplication of unknown-name twins and canonical switches', () => {
  for (const [mapId, twinId] of [['00-map', 'zz-twin'], ['zz-map', '00-twin']]) {
    const records = [record(mapId, 'Juniper Museum', null), record(twinId, 'Juniper Museum', null),
      record('knowledge-1', 'Juniper Museum', 'Q11', .0001),
      record('knowledge-2', 'Juniper Museum', 'Q22', .0002)];
    for (const input of permutations(records)) {
      const result = resolveCandidateIdentity(input);
      assert.equal(result.candidates.length, 3);
      assert.equal(result.summary.merged_count, 1);
      for (const entity of result.candidates.filter(c => wikidataIdOf(c))) {
        assert.ok(!entity.evidence.some(e => e.source_ref.source_family === 'map'));
      }
    }
  }
});

test('Planner and Blitz cannot promote a name-only match against conflicting source entities', () => {
  const { buildCandidateBlitzDecision } = require('../server/candidates/blitz-candidate-mode');
  const { selectPlannerRoleCandidates } = require('../server/planner/role-selector');
  const city = { key: 'identity-test', label: 'Identity fixture', timezone: 'UTC',
    center: { lat: 46, lng: 8 }, catalog: { allItems: [], routeTemplates: [] },
    routing: { areaDefinitions: {} }, todayIsoDate: () => '2026-10-08' };
  const payload = { candidate_mode: 1, include_external_candidates: 1, date: '2026-10-08',
    now: '2026-10-08T12:00:00Z', preferences: ['fika'], origin: city.center };
  const raw = (id, qid, offset = 0) => ({ id, name: 'Juniper Cafe', type: 'cafe',
    lat: 46 + offset, lng: 8, tags: ['coffee'], sources: [qid
      ? { provider: 'wikidata', family: 'open_knowledge', tier: 'inferred', url: `https://www.wikidata.org/wiki/${qid}` }
      : { provider: 'osm', family: 'map', tier: 'inferred', url: 'https://www.openstreetmap.org/node/1' }] });
  for (const ambiguous of [false, true]) {
    const records = [raw('map-1', null), raw('knowledge-1', 'Q11', .0001),
      raw('knowledge-2', ambiguous ? 'Q22' : 'Q11', .0002)];
    for (const dataset of permutations(records)) {
      const helpers = { external_provider: { dataset } };
      const planner = selectPlannerRoleCandidates(city, payload, helpers);
      const coffee = planner.roles.find(role => role.role === 'coffee_fika_stop');
      const blitz = buildCandidateBlitzDecision(city, payload, helpers);
      if (ambiguous) {
        assert.equal(coffee.candidates.length, 0, 'single-family identities must not borrow route promotion');
        assert.equal(blitz.inspect.eligible_count, 0, 'false corroboration must not become a next move');
      } else {
        assert.equal(coffee.candidates.length, 1, 'one safely corroborated cafe remains a Planner choice');
        assert.equal(blitz.inspect.eligible_count, 1);
        assert.equal(blitz.best_move.origin, 'external_open');
      }
    }
  }
});
