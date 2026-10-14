"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapOverpassResponse, composeOpenDataLoaders, createOpenDataLoader, createOvertureBackgroundSource } = require('../server/place-candidates/open-data-loader');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { SOURCE_COMPLETION, SOURCE_SNAPSHOT } = require('../server/place-candidates/background-source');
const { mapOvertureRow, createOvertureSource } = require('../server/place-candidates/overture-source');
const { createExternalOpenProvider } = require('../server/place-candidates/external-open-provider');
const { resolveCandidateIdentity } = require('../server/candidates/entity-resolution');
const { evaluateOpeningHoursForWindow } = require('../server/place-candidates/opening-hours');
const { readSourceNegativeFacts } = require('../server/place-candidates/source-negative-facts');
const { withoutExcludedCandidates } = require('../server/planner/excluded-candidates');

const anchor = { lat: 55.6, lng: 13 };
const thursday = { weekday: 4, startMinute: 0, endMinute: 1440 };
const hours = 'Th off; Fr-We 09:00-22:00';
const targetId = 'overture-00000000-0000-0000-0000-000000000001';
const request = { ...anchor, requestedIntents: ['museums', 'food', 'coffee'], dayRhythm: 'full', availabilityWindow: thursday };
function node(id, type, extra = {}) {
  return { type: 'node', id, lat: anchor.lat + (id === 1000001 ? .00001 : .002 + (id % 100) * .0001), lon: anchor.lng,
    tags: { name: id === 1000001 ? 'Juniper Museum' : `Fixture ${type} ${id}`,
      ...(type === 'museum' ? { tourism: type } : { amenity: type }),
      opening_hours: '24/7', wikidata: `Q${id}`, ...extra } };
}
function mapped({ window = thursday, target = {} } = {}) {
  const elements = [node(1000001, 'museum', { opening_hours: hours, ...target }),
    ...Array.from({ length: 18 }, (_, i) => node(2000000 + i, 'museum')),
    ...Array.from({ length: 19 }, (_, i) => node(3000000 + i, 'restaurant')),
    ...Array.from({ length: 19 }, (_, i) => node(4000000 + i, 'cafe'))];
  return mapOverpassResponse({ elements }, 25, { origin: anchor, requestedIntents: request.requestedIntents, availabilityWindow: window });
}
function twin(extra = {}) {
  return { ...mapOvertureRow({ id: targetId.slice('overture-'.length), name: 'Juniper Museum', lat: anchor.lat + .00001,
    lng: anchor.lng, confidence: .99, category: 'museum', category_hierarchy: ['museum'],
    licenses: ['CC0-1.0'], operating_status: 'open' }), ...extra };
}
function identity(rows, extras = [twin()]) {
  return resolveCandidateIdentity(createExternalOpenProvider({ key: 'agnostic' }, { dataset: [...rows, ...extras] }).listCandidates());
}
function closedTarget(rows, extras) {
  const result = identity(rows, extras);
  const target = result.candidates.find(candidate => candidate.id === targetId);
  assert.ok(target);
  assert.equal(evaluateOpeningHoursForWindow(target.opening_hours, thursday).eligible, false);
  assert.equal(result.candidates.some(candidate => candidate.id === 'osm-node-1000001'), false, 'fact-only witnesses are never positive candidates');
  return target;
}

test('fact-only closure does not add existence, consensus, human verification or positive rows', () => {
  const rows = mapped(), before = identity([], [twin()]).candidates[0];
  assert.equal(rows.length, 25);
  const target = closedTarget(rows);
  assert.deepEqual(target.evidence, before.evidence);
  assert.deepEqual(target.trust, before.trust);
  assert.equal(target.city_pack_owned, false);
  assert.equal(target.merged_from, undefined);
});

test('JSON roundtrip and public lookalike fields cannot mint the private negative-fact channel', () => {
  const rows = mapped(), facts = readSourceNegativeFacts(rows);
  assert.equal(facts.length, 1);
  const publicRows = JSON.parse(JSON.stringify(rows));
  publicRows.negativeFacts = facts;
  const hostileTwin = twin({ negativeFacts: facts, sourceNegativeFacts: facts, source_negative_facts: facts });
  for (const row of publicRows) row.negativeFacts = facts;
  const target = identity(publicRows, [hostileTwin]).candidates.find(candidate => candidate.id === targetId);
  assert.ok(target);
  assert.equal(target.opening_hours, undefined);
  assert.equal(readSourceNegativeFacts(publicRows).length, 0);
});

test('closure cannot veto a same-name venue with a distinct source-owned visit address', () => {
  const rows = mapped({ target: { 'addr:street': 'Museum Lane', 'addr:housenumber': '1' } });
  const target = identity(rows, [twin({ source_address: { street: 'Museum Lane', house_number: '2' } })]).candidates.find(candidate => candidate.id === targetId);
  assert.ok(target);
  assert.equal(target.opening_hours, undefined);
});

test('an addressless negative witness cannot choose between two distinct same-name physical sites', () => {
  const rows = mapped();
  const a = twin({ source_address: { street: 'Museum Lane', house_number: '1' } });
  const b = twin({ id: targetId.replace(/1$/, '2'), source_address: { street: 'Museum Lane', house_number: '2' } });
  for (const extras of [[a, b], [b, a]]) {
    const resolved = identity(rows, extras);
    for (const id of [a.id, b.id]) assert.equal(resolved.candidates.find(candidate => candidate.id === id)?.opening_hours, undefined);
  }
});

test('known selected-day closure is not a permanent veto on another open weekday', () => {
  const rows = mapped();
  const target = closedTarget(rows);
  assert.equal(evaluateOpeningHoursForWindow(target.opening_hours, { ...thursday, weekday: 5 }).eligible, true);
});

test('missing or unsupported hours do not fabricate a negative closure fact', () => {
  for (const opening_hours of ['', 'by appointment only']) {
    const rows = mapped({ target: { opening_hours } });
    assert.equal(readSourceNegativeFacts(rows).length, 0);
    const target = identity(rows).candidates.find(candidate => candidate.id === targetId);
    assert.ok(target);
    assert.notEqual(evaluateOpeningHoursForWindow(target.opening_hours, thursday).eligible, false);
  }
});

test('source-indicated inactive lifecycle survives selection without corroborating the directory', () => {
  const rows = mapped({ target: { opening_hours: '24/7', disused: 'yes' } });
  const target = identity(rows).candidates.find(candidate => candidate.id === targetId);
  assert.ok(target);
  assert.equal(target.operational_status, 'inactive');
  assert.deepEqual(target.evidence, identity([], [twin()]).candidates[0].evidence);
});

test('ordinary user exclusions cannot erase closure facts carried by remaining positive twins', async () => {
  const rows = mapped();
  const composed = composeOpenDataLoaders(async () => rows, async () => [twin()]);
  const filter = withoutExcludedCandidates(composed, rows.map(row => row.id));
  const filtered = await filter(request);
  assert.equal(filtered.length, 1);
  closedTarget(filtered, []);
});

test('original primary completion and nested snapshots retain closure without later cache producers', async () => {
  const rows = mapped();
  let finish;
  const originalJob = new Promise(resolve => { finish = resolve; });
  const pending = [];
  Object.defineProperty(pending, 'loader_status', { value: 'loaded:0' });
  Object.defineProperty(pending, SOURCE_COMPLETION, { value: originalJob });
  const composed = composeOpenDataLoaders(async () => pending, async () => [twin()]);
  const initial = await composed(request);
  assert.equal(initial.length, 1);
  assert.equal(typeof initial[SOURCE_SNAPSHOT], 'function');
  finish(rows);
  const completed = await initial[SOURCE_COMPLETION];
  closedTarget(completed, []);
  closedTarget(initial[SOURCE_SNAPSHOT](), []);
  assert.equal(completed.filter(row => row.id.startsWith('osm-')).length, 25);
});

test('early directory rescue keeps negative facts after every positive map carrier is excluded', async () => {
  const elements = [node(1000001, 'museum', { opening_hours: hours }),
    ...Array.from({ length: 18 }, (_, i) => node(2000000 + i, 'museum')),
    ...Array.from({ length: 19 }, (_, i) => node(3000000 + i, 'restaurant')),
    ...Array.from({ length: 19 }, (_, i) => node(4000000 + i, 'cafe'))];
  const eagerRequest = { ...request, requestedIntents: ['museums', 'food', 'coffee', 'bars'] };
  let finishWider, mapCalls = 0, directoryCalls = 0;
  const widerJob = new Promise(resolve => { finishWider = resolve; });
  const primary = createOpenDataLoader({ radiusKm: 1.5, cache: createSourceCache({ dir: null }),
    fetcher: async () => ++mapCalls === 1 ? { ok: true, json: async () => ({ elements }) } : widerJob });
  const directoryRows = Array.from({ length: 80 }, (_, i) => {
    const category = ['museum', 'restaurant', 'cafe'][i % 3];
    return mapOvertureRow({ id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
      name: i === 0 ? 'Juniper Museum' : `Unrelated Directory ${i}`,
      lat: anchor.lat + (i === 0 ? .00001 : .003 + i * .0001), lng: anchor.lng,
      confidence: .99, category, category_hierarchy: [category], licenses: ['CC0-1.0'], operating_status: 'open' });
  });
  const cache = createSourceCache({ dir: null });
  cache.set('55.600,13.000:negative-carrier-test', directoryRows);
  const selector = createOvertureSource({ queryRows: async () => { throw new Error('unexpected directory transport'); } });
  const directory = createOvertureBackgroundSource({ cache, source: {
    sampleKey: 'negative-carrier-test', select: selector.select,
    acquire: async () => { directoryCalls++; throw new Error('directory is already warm'); },
  } });
  const knowledgeRow = { id: 'wikidata-Q1000001', name: 'Juniper Museum', type: 'museum',
    lat: anchor.lat + .00001, lng: anchor.lng,
    sources: [{ provider: 'wikidata', family: 'open_knowledge', tier: 'inferred', url: 'https://www.wikidata.org/wiki/Q1000001' }] };
  const knowledge = { eager: false, readCached: () => [knowledgeRow], load: () => [knowledgeRow] };
  try {
    const composed = composeOpenDataLoaders(primary, knowledge, directory, null, { primaryWaitMs: 10 });
    const initial = await composed(eagerRequest);
    assert.equal(initial.loader_metadata.primary_collection, 'first_pass_while_expanding');
    const mapIds = initial.filter(row => row.id.startsWith('osm-')).map(row => row.id);
    assert.equal(mapIds.length, 25);
    closedTarget(initial, []);
    const remaining = await withoutExcludedCandidates(async () => initial, mapIds)(eagerRequest);
    assert.equal(remaining.length, 81, 'keep the existing 80 directory + one knowledge rows');
    assert.equal(readSourceNegativeFacts(remaining).length, 1,
      'already acquired negative facts must not depend on a surviving positive map record');
    closedTarget(remaining, []);
    assert.equal(mapCalls, 2, 'only the original first and wider transport');
    assert.equal(directoryCalls, 0);
  } finally {
    finishWider({ ok: true, json: async () => ({ elements: [] }) });
    await primary(eagerRequest);
  }
});
