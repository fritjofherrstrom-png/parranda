"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOvertureSource } = require('../server/place-candidates/overture-source');
const { createOvertureBackgroundSource, composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { SOURCE_COMPLETION, SOURCE_SNAPSHOT } = require('../server/place-candidates/background-source');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');
const { mapRecordToCandidate } = require('../server/place-candidates/external-open-provider');
const { resolveCandidateIdentity } = require('../server/candidates/entity-resolution');
const { evaluateCandidateEligibility } = require('../server/candidates/candidate-pool');
const anchor = { lat: 55.6, lng: 13 };
const names = ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir'];
function record(id, name, lat, family) {
  return { id, name, type: 'cafe', lat, lng: 13, opening_hours: 'Mo-Su 09:00-22:00',
    sources: [{ provider: family === 'map' ? 'osm' : 'overture', family, tier: 'inferred', url: `https://source.example/${id}` }] };
}
function sample() {
  const primary = names.map((name, i) => record(`map-${i}`, `${name} cafe`, 55.605 + i * .001, 'map'));
  const directory = [...Array.from({ length: 80 }, (_, i) => record(`directory-near-${i}`, `Nearby${i}`, 55.60001 + i * .00001, 'open_directory')),
    ...primary.map((row, i) => record(`directory-match-${i}`, row.name, row.lat, 'open_directory'))];
  return { primary, directory };
}
function setup({ primary, directory, acquire = async () => directory, warm = true }) {
  const selector = createOvertureSource({ queryRows: async () => { throw Error('Query not expected'); } });
  const cache = createSourceCache();
  if (warm) cache.set('55.600,13.000:test', directory);
  const source = createOvertureBackgroundSource({ source: { acquire, select: selector.select, sampleKey: 'test' }, cache });
  return { loader: composeOpenDataLoaders(async () => primary, null, source), cache };
}
const map = row => mapRecordToCandidate({ key: 'agnostic' }, row, '2026-10-14', 0);
const gatesFor = (rows, id) => {
  const c = resolveCandidateIdentity(rows.map(map), { now: '2026-10-14' }).candidates
    .find(c => c.id === id || c.merged_from?.some(row => row.id === id));
  return evaluateCandidateEligibility(c, { now: '2026-10-14' });
};
test('existing exact corroboration survives the directory cut and supports real Balanced/Full depth', async () => {
  const rows = sample(), { loader } = setup(rows);
  for (const [dayRhythm, count] of [['balanced', 5], ['full', 6]]) {
    const acquired = await loader({ ...anchor, requestedIntents: ['coffee'], dayRhythm });
    assert.equal(acquired.filter(r => r.id.startsWith('directory-')).length, 80, 'unchanged selected-directory budget');
    assert.ok(names.every((_, i) => acquired.some(r => r.id === `directory-match-${i}`)), 'already-acquired supporting identities survive');
    assert.equal(gatesFor(acquired, 'map-0').gates.may_influence_routes, true);
    const output = await composeAgnosticRouteOutput({ coords: anchor, baselineResult: { days: [] },
      externalRequested: true, openDataLoader: loader, date: '2026-10-22', todayIsoDate: '2026-10-14',
      trustedTimezone: 'Europe/Stockholm', timezone: 'Europe/Stockholm', clock: () => new Date('2026-10-14T08:00:00Z'),
      synthesizeVia: 'engine', distanceMode: 'no_limit', dayRhythm, preferences: ['coffee'],
      weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false }),
    });
    const route = output.result.days[0]?.primary_route;
    assert.equal(route?.main_stops.length, count);
    assert.ok(route.main_stops.every(s => names.some(name => (s.label || s.name) === `${name} cafe`) && s.covered_preferences.includes('coffee')));
    assert.equal(route.trust_summary.human_verified, false);
  }
});
test('cold completion uses its retained directory sample, preserves its cut, and never reacquires', async () => {
  const rows = sample(); let release, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const { loader, cache } = setup({ ...rows, warm: false, acquire: () => { calls++; return pending; } });
  const initial = await loader({ ...anchor, requestedIntents: ['coffee'], dayRhythm: 'full' });
  assert.ok(initial[SOURCE_COMPLETION]);
  release(rows.directory);
  const completed = await initial[SOURCE_COMPLETION];
  cache.set('55.600,13.000:test', [record('different-job', 'Other source sample', 55.6, 'open_directory')]);
  const snapshot = initial[SOURCE_SNAPSHOT]();
  assert.equal(calls, 1);
  assert.equal(completed.filter(r => r.id.startsWith('directory-')).length, 80);
  assert.ok(names.every((_, i) => completed.some(r => r.id === `directory-match-${i}`)));
  assert.deepEqual(snapshot.map(r => r.id), completed.map(r => r.id), 'a later cache value cannot replace the retained acquisition');
});
test('a nested completion replaces the primary source selection instead of unioning two directory cuts', async () => {
  const rows = sample(); let release, complete = false;
  const completion = new Promise(resolve => { release = resolve; });
  const pendingPrimary = async () => {
    const initial = rows.primary.slice(0, 3);
    Object.defineProperty(initial, SOURCE_COMPLETION, { value: completion });
    Object.defineProperty(initial, SOURCE_SNAPSHOT, { value: () => complete ? rows.primary : null });
    return initial;
  };
  const selector = createOvertureSource({ queryRows: async () => [] }), cache = createSourceCache();
  cache.set('55.600,13.000:test', rows.directory);
  const directory = createOvertureBackgroundSource({ source: { acquire: async () => rows.directory, select: selector.select, sampleKey: 'test' }, cache });
  const inner = composeOpenDataLoaders(pendingPrimary, null, directory);
  const outer = composeOpenDataLoaders(inner);
  const initial = await outer({ ...anchor, requestedIntents: ['coffee'], dayRhythm: 'full' });
  assert.equal(initial.filter(r => r.id.startsWith('directory-')).length, 80);
  complete = true; release(rows.primary);
  const final = await initial[SOURCE_COMPLETION];
  assert.equal(final.filter(r => r.id.startsWith('directory-')).length, 80, 'one current directory selection, not old80 plus replacement rows');
  assert.ok(names.every((_, i) => final.some(r => r.id === `directory-match-${i}`)));
  assert.equal(initial[SOURCE_SNAPSHOT]().filter(r => r.id.startsWith('directory-')).length, 80);
});
test('a plain primary completion can supply corroboration even without a private snapshot function', async () => {
  const rows = sample(); let release;
  const completion = new Promise(resolve => { release = resolve; });
  const initialPrimary = [];
  Object.defineProperty(initialPrimary, SOURCE_COMPLETION, { value: completion });
  const selector = createOvertureSource({ queryRows: async () => [] }), cache = createSourceCache();
  cache.set('55.600,13.000:test', rows.directory);
  const directory = createOvertureBackgroundSource({ source: { acquire: async () => rows.directory, select: selector.select, sampleKey: 'test' }, cache });
  const loader = composeOpenDataLoaders(async () => initialPrimary, null, directory);
  const initial = await loader({ ...anchor, requestedIntents: ['coffee'], dayRhythm: 'full' });
  release(rows.primary);
  const final = await initial[SOURCE_COMPLETION];
  assert.equal(final.filter(r => r.id.startsWith('directory-')).length, 80);
  assert.ok(names.every((_, i) => final.some(r => r.id === `directory-match-${i}`)));
});
test('a failed directory acquisition retains failed health instead of appearing verified empty', async () => {
  const { loader } = setup({ primary: [], directory: [], warm: false, acquire: async () => { throw Error('private provider details'); } });
  const initial = await loader({ ...anchor, requestedIntents: ['coffee'], dayRhythm: 'full' });
  const completed = initial[SOURCE_COMPLETION] ? await initial[SOURCE_COMPLETION] : initial;
  assert.equal(completed.loader_status, 'error_failed_closed');
  assert.equal(completed.loader_error, 'fetch_error');
});
test('conflicting full-universe identities do not gain corroboration by selecting one convenient directory twin', async () => {
  const rows = sample();
  const duplicate = { ...rows.primary[0], id: 'other-entity', source_address: { street: 'Other street', house_number: '2' } };
  rows.primary[0] = { ...rows.primary[0], source_address: { street: 'First street', house_number: '1' } };
  rows.directory.find(r => r.id === 'directory-match-0').lat = 55.600005;
  rows.primary[0].lat = 55.600005;
  duplicate.lat = 55.60001;
  rows.directory.push({ ...duplicate, sources: [{ provider: 'overture', family: 'open_directory', tier: 'inferred', url: 'https://source.example/other' }] });
  const { loader } = setup(rows);
  const acquired = await loader({ ...anchor, requestedIntents: ['coffee'], dayRhythm: 'full' });
  assert.equal(gatesFor(acquired, 'map-0').gates.may_influence_routes, false, 'no manufactured safe twin from ambiguous input');
});
