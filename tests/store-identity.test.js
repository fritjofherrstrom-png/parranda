const assert = require('node:assert/strict');
const test = require('node:test');
const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { createExternalOpenProvider } = require('../server/place-candidates/external-open-provider');
const { matchIdentity, resolveCandidateIdentity } = require('../server/candidates/entity-resolution');

function osm(tags = {}) {
  return mapOsmElement({ type: 'node', id: 1, lat: 55.6, lon: 13,
    tags: { name: 'Juniper Secondhand', shop: 'second_hand',
      alt_name: 'Juniper Reuse', website: 'https://juniper.example/stores/centre',
      'addr:street': 'Oak Street', 'addr:housenumber': '12', ...tags } });
}
function candidates(records) {
  return createExternalOpenProvider({ key: 'test-area' }, { dataset: records }).listCandidates();
}

test('source-owned OSM aliases survive loader and candidate mapping boundedly', () => {
  const raw = osm({ alt_name: 'Juniper Reuse;Juniper Reuse;Juniper Used Goods',
    official_name: 'Juniper Cooperative', old_name: 'Another Business' });
  assert.deepEqual(raw.source_name_aliases, ['Juniper Reuse', 'Juniper Used Goods', 'Juniper Cooperative']);
  const [candidate] = candidates([raw]);
  assert.deepEqual(candidate.source_name_aliases, raw.source_name_aliases);
  assert.equal(candidate.website, 'https://juniper.example/stores/centre');
  assert.deepEqual(candidate.source_address, { street: 'Oak Street', house_number: '12' });
  assert.equal(candidates([{ ...raw, source_name_aliases: ['x'.repeat(161), '\nInjected', 123] }])[0].source_name_aliases, undefined);
});

test('a shared name with incoming aliases cannot bridge conflicting entities in any order', () => {
  const [original, pivot] = pair();
  pivot.id = '00-pivot';
  const north = { ...original, id: 'north', label: 'Juniper North',
    source_name_aliases: [pivot.label], wikidata: 'Q11' };
  const south = { ...original, id: 'south', label: 'Juniper South',
    source_name_aliases: [pivot.label], wikidata: 'Q22' };
  for (const input of [[pivot,north,south],[pivot,south,north],
    [north,pivot,south],[north,south,pivot],[south,pivot,north],[south,north,pivot]]) {
    const result = resolveCandidateIdentity(input);
    assert.equal(result.summary.merged_count, 0, input.map(x => x.id).join(','));
    assert.equal(result.candidates.length, 3);
  }
});

test('alias ambiguity survives conventional merges and canonical switches in every order', () => {
  const permutations = (items) => items.length === 0 ? [[]] : items.flatMap((item, i) =>
    permutations(items.filter((_, j) => j !== i)).map((rest) => [item, ...rest]));
  for (const [pivotId, twinId] of [['00-pivot', 'zz-twin'], ['zz-pivot', '00-twin']]) {
    const pivot = { id: pivotId, label: 'Juniper Reuse', type: 'vintage-shop',
      source_name_aliases: ['Juniper North', 'Juniper South'],
      website: 'https://juniper.example/', source_address: { street: 'Oak', house_number: '12' },
      lat: 55.6, lng: 13, evidence: [] };
    const twin = { ...pivot, id: twinId, website: undefined, source_name_aliases: [] };
    const north = { ...pivot, id: 'north', label: 'Juniper North', source_name_aliases: [],
      wikidata: 'Q11', evidence: [{ claim_type: 'identity',
        source_ref: { provider_id: 'north', url: 'https://www.wikidata.org/wiki/Q11' } }] };
    const south = { ...north, id: 'south', label: 'Juniper South', wikidata: 'Q22',
      evidence: [{ claim_type: 'identity',
        source_ref: { provider_id: 'south', url: 'https://www.wikidata.org/wiki/Q22' } }] };
    for (const input of permutations([pivot, twin, north, south])) {
      const context = input.map((candidate) => candidate.id).join(',');
      const result = resolveCandidateIdentity(input);
      assert.ok(!result.merges.some((merge) => merge.confidence === 'source_alias_store_identity'), context);
      for (const candidate of result.candidates.filter((item) => item.label === pivot.label)) {
        assert.ok(!candidate.evidence.some((item) => /\/wiki\/Q(?:11|22)$/.test(item.source_ref?.url)), context);
      }
      if (input.indexOf(pivot) < input.indexOf(twin)) {
        assert.equal(result.summary.merged_count, 1, context);
        assert.equal(result.candidates.length, 3, context);
        assert.equal(result.merges.find((merge) => merge.decision === 'merged').confidence, 'geo_name', context);
      }
    }
  }
});

test('coordinate enrichment cannot unlock ambiguous aliases in any order or canonical identity', () => {
  const permutations = (items) => items.length === 0 ? [[]] : items.flatMap((item, i) =>
    permutations(items.filter((_, j) => j !== i)).map((rest) => [item, ...rest]));
  for (const [pivotId, twinId] of [['00-pivot', 'zz-twin'], ['zz-pivot', '00-twin']]) {
    const pivot = { id: pivotId, label: 'Juniper Reuse', type: 'vintage-shop', wikidata: 'Q11',
      source_name_aliases: ['Juniper North', 'Juniper South'], evidence: [],
      website: 'https://juniper.example/', source_address: { street: 'Oak', house_number: '12' } };
    const twin = { ...pivot, id: twinId, source_name_aliases: [], lat: 55.6, lng: 13 };
    const north = { ...twin, id: 'north', label: 'Juniper North', wikidata: undefined };
    const south = { ...north, id: 'south', label: 'Juniper South' };
    for (const input of permutations([pivot, twin, north, south])) {
      const context = input.map((candidate) => candidate.id).join(',');
      const result = resolveCandidateIdentity(input);
      assert.equal(result.summary.merged_count, 1, context);
      assert.deepEqual(result.candidates.map((candidate) => candidate.id).sort(),
        [pivotId < twinId ? pivotId : twinId, 'north', 'south'].sort(), context);
      assert.ok(!result.merges.some((merge) => merge.confidence === 'source_alias_store_identity'), context);
      const survivor = result.candidates.find((candidate) => candidate.wikidata === 'Q11');
      assert.equal(survivor.lat, 55.6, context);
      assert.equal(survivor.merged_from.length, 1, context);
    }
  }
});

test('a merged source-wide closed schedule remains a route veto even when canonical hours say open', () => {
  const { evaluateOperationalViability } = require('../server/place-candidates/operational-viability');
  const [a] = pair();
  a.id = '00-open';
  a.opening_hours = '24/7';
  const b = { ...a, id: 'zz-closed', opening_hours: 'off' };
  for (const input of [[a,b],[b,a]]) {
    const merged = resolveCandidateIdentity(input).candidates[0];
    assert.equal(evaluateOperationalViability({ candidate: merged }).route_eligible, false);
    assert.ok(merged.operational_reasons.includes('operational_schedule_explicitly_closed'));
  }
});

test('a generic primary name cannot borrow storefront corroboration through an alias', () => {
  const [a, b] = pair();
  a.label = 'Shop';
  for (const input of [[a,b],[b,a]]) {
    assert.equal(matchIdentity(...input).same, false);
    assert.equal(resolveCandidateIdentity(input).summary.merged_count, 0);
  }
});

function pair(overrides = {}) {
  const a = osm();
  const b = { id: 'directory-1', name: 'Juniper Reuse', type: 'vintage-shop',
    lat: 55.60002, lng: 13, website: a.website, source_address: a.source_address,
    sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred' }], ...overrides };
  return candidates([a, b]);
}

test('explicit current source alias plus website and full address corroborates nearby compatible stores', () => {
  const [a, b] = pair();
  const verdict = matchIdentity(a, b);
  assert.equal(verdict.same, true);
  assert.equal(verdict.confidence, 'source_alias_store_identity');
  const result = resolveCandidateIdentity([a, b]);
  assert.equal(result.summary.merged_count, 1);
  assert.deepEqual(new Set(result.candidates[0].evidence.map((e) => e.source_ref.source_family)),
    new Set(['map', 'open_directory']));

  // The root of a chain is not a store identity; independent exact address is required.
  assert.equal(matchIdentity(...pair({ website: 'https://juniper.example/', source_address: undefined })).same, false);
  const rootPair = pair({ website: 'https://juniper.example/' });
  rootPair[0].website = 'https://juniper.example/';
  assert.equal(matchIdentity(...rootPair).same, true);
  delete rootPair[1].source_address;
  assert.equal(matchIdentity(...rootPair).same, false);
  for (const changes of [
    { website: undefined, source_address: undefined },
    { source_address: undefined },
    { website: 'https://unrelated.example/stores/centre' },
    { source_address: { street: 'Oak Street', house_number: '14' } },
    { type: 'cafe' }, { type: 'unknown' }, { lat: 55.601 },
    { name: 'Juniper Reuse Annex' }, { name: 'Unrelated Business' },
    { website: 'https://user:password@juniper.example/stores/centre' },
    { website: 'https://juniper.example/stores/centre?store=other' },
  ]) assert.equal(matchIdentity(...pair(changes)).same, false, JSON.stringify(changes));
  const conflict = pair(); conflict[0].wikidata = 'Q11'; conflict[1].wikidata = 'Q22';
  assert.equal(matchIdentity(...conflict).same, false);
});

test('an alias matching conflicting co-located entities stays separate in every input order', () => {
  const [a, b] = pair();
  b.wikidata = 'Q11';
  const c = { ...b, id: 'directory-2', wikidata: 'Q22' };
  for (const input of [[a,b,c], [a,c,b], [b,a,c], [b,c,a], [c,a,b], [c,b,a]]) {
    const result = resolveCandidateIdentity(input);
    assert.equal(result.summary.merged_count, 0, input.map((r) => r.id).join(','));
    assert.equal(result.candidates.length, 3);
    assert.ok(result.merges.some((m) => m.decision === 'kept_separate_ambiguous'));
  }
});

test('an enriched alias does not lose the source schedule when the directory becomes canonical', () => {
  const { evaluateOpeningHoursForWindow } = require('../server/place-candidates/opening-hours');
  const [a, b] = pair();
  a.opening_hours = 'Mo-Su 09:00-10:00';
  const merged = resolveCandidateIdentity([a, b]).candidates[0];
  assert.equal(merged.id, 'directory-1');
  assert.equal(merged.opening_hours, a.opening_hours);
  assert.equal(evaluateOpeningHoursForWindow(merged.opening_hours,
    { weekday: 1, startMinute: 12 * 60, endMinute: 1440 }).eligible, false);
});

test('alias enrichment cannot turn source-declared inactivity into a live storefront', () => {
  const { evaluateOperationalViability } = require('../server/place-candidates/operational-viability');
  const [a, b] = pair();
  a.operational_status = 'inactive';
  a.operational_reasons = ['osm_lifecycle_disused'];
  const merged = resolveCandidateIdentity([a, b]).candidates[0];
  assert.equal(evaluateOperationalViability({ candidate: merged }).route_eligible, false);
  assert.ok(merged.operational_reasons.includes('osm_lifecycle_disused'));
});

test('conflicting source schedules do not gain corroboration through the new alias path', () => {
  const [a, b] = pair();
  a.opening_hours = 'Mo-Su 09:00-10:00';
  b.opening_hours = '24/7';
  assert.equal(matchIdentity(a, b).same, false);
});
