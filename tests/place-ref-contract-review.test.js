'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const { createPlaceSelectionStore } = require('../server/place-candidates/place-selection');
const { resolveAgnosticIntake } = require('../server/planner/agnostic-place-intake');
const candidate = { label: 'Fixture Harbour', lat: 51.5, lng: 2.32, confidence: 'medium', osm_ref: 'relation/12345', osm_class: 'place', spatial_scope: { source: 'nominatim_bounds', kind: 'settlement', bounds: { south: 51.49, north: 51.51, west: 2.31, east: 2.33 } } };
function resolverFor(value = candidate) {
  const calls = { lookup: 0, search: 0 };
  const resolver = async () => { calls.search++; return [value]; };
  resolver.lookupRef = async ref => { calls.lookup++; assert.equal(ref, 'r12345'); return { status: 'resolved', candidate: value }; };
  return { resolver, calls };
}
async function withApp(options, run) {
  const server = buildApp({ openDataLoader: null, weatherProvider: async () => null, ...options }).listen(0);
  try { await run(server); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('signed venue receipts cannot bypass the linkable class gate for the same ref', async () => {
  const store = createPlaceSelectionStore();
  const { resolver, calls } = resolverFor();
  const receipt = store.issue({ ...candidate, osm_class: 'amenity' }, candidate.label);
  const result = await resolveAgnosticIntake({ placeRef: 'r12345', placeSelection: receipt, placeResolver: resolver, placeSelectionStore: store });
  assert.equal(result.anchor, null);
  assert.deepEqual(result.intake.blockers, ['place_ref_unsupported']);
  assert.equal(calls.lookup, 0);
});
test('older classless v1 receipts revalidate exact identity and never lend old geography', async () => {
  const store = createPlaceSelectionStore();
  const old = { ...candidate, lat: 1, lng: 2 }; delete old.osm_class;
  const receipt = store.issue(old, candidate.label);
  const { resolver, calls } = resolverFor();
  const result = await resolveAgnosticIntake({ placeRef: 'r12345', placeSelection: receipt, placeResolver: resolver, placeSelectionStore: store });
  assert.equal(calls.lookup, 1);
  assert.deepEqual(result.anchor, { lat: candidate.lat, lng: candidate.lng });
  assert.equal(result.intake.resolved.place_ref, 'r12345');
  assert.equal(store.read(result.intake.resolved.selection_id).osm_class, 'place');
  const unavailable = async () => []; unavailable.lookupRef = async () => ({ status: 'unavailable' });
  const failed = await resolveAgnosticIntake({ placeRef: 'r12345', placeSelection: receipt, placeResolver: unavailable, placeSelectionStore: store });
  assert.equal(failed.anchor, null);
  assert.deepEqual(failed.intake.blockers, ['place_ref_unavailable']);
  assert.ok(store.read(receipt, candidate.label));
  assert.equal(store.read(receipt, 'changed query'), null, 'legacy query binding remains intact');
});
test('actual Planner and Blitz reject raw coordinate attempts with ref before lossy parsing', async () => {
  const { resolver, calls } = resolverFor();
  await withApp({ placeResolver: resolver, eventSupply: null }, async server => {
    for (const fields of [{ lat: 999, lng: 13 }, { lat: 'broken' }, { lng: null }, { origin: { lat: 999, lng: 13 } }]) {
      for (const path of ['/api/route-recommendations', '/api/blitz?anywhere_blitz=1']) {
        const response = await requestJson(server, { path, body: { place_ref: 'r12345', dates: ['2026-10-08'], day_rhythm: 'balanced', experimental_agnostic_route_output: 1, ...fields } });
        const intake = response.body.intake || response.body.agnostic_route_output_experiment?.intake;
        assert.deepEqual(intake?.blockers, ['place_ref_conflict'], JSON.stringify({ path, fields, intake }));
      }
    }
    for (const path of ['/api/route-recommendations?lat=999&lng=13', '/api/blitz?anywhere_blitz=1&lat=999&lng=13']) {
      const response = await requestJson(server, { path, body: { place_ref: 'r12345', dates: ['2026-10-08'], day_rhythm: 'balanced', experimental_agnostic_route_output: 1 } });
      assert.deepEqual((response.body.intake || response.body.agnostic_route_output_experiment.intake).blockers, ['place_ref_conflict']);
    }
    for (const path of ['/api/route-recommendations', '/api/blitz?anywhere_blitz=1']) {
      const response = await requestJson(server, { path, body: { place_ref: 'r12345', explicitCoordinatesPresent: false, dates: ['2026-10-08'], day_rhythm: 'balanced', experimental_agnostic_route_output: 1, lat: 999 } });
      assert.deepEqual((response.body.intake || response.body.agnostic_route_output_experiment.intake).blockers, ['place_ref_conflict']);
      const clean = await requestJson(server, { path, body: { place_ref: 'r12345', explicitCoordinatesPresent: true, dates: ['2026-10-08'], day_rhythm: 'balanced', experimental_agnostic_route_output: 1 } });
      assert.equal((clean.body.intake || clean.body.agnostic_route_output_experiment.intake).status, 'resolved', 'public helper flag has no authority');
    }
  });
  assert.equal(calls.lookup, 2);
});
test('Live ref-only preserves drift, containment, regional scope and unrelated geometry lanes', async () => {
  let collected = 0;
  const { resolver, calls } = resolverFor();
  await withApp({ placeResolver: resolver, eventSupply: async () => { collected++; return { coverage: 'covered', tonight: [], this_week: [] }; } }, async server => {
    for (const anchor of [{ lat: 0, lng: 0 }, { lat: 51.512, lng: 2.32 }]) {
      const result = await requestJson(server, { path: '/api/live-events', body: { scope: 'around_place', place_ref: 'r12345', anchor } });
      assert.equal(result.status, 400);
      assert.equal(result.body.error, 'place_ref_conflict');
    }
    const legacy = await requestJson(server, { path: '/api/live-events', body: { scope: 'in_place', anchor: candidate, place_selection: 'invalid' } });
    assert.equal(legacy.body.error, 'in_place_requires_place_query', 'no-ref legacy error precedence is unchanged');
    const malformed = await requestJson(server, { path: '/api/live-events', body: { scope: 'in_place', place_ref: null, anchor: candidate, place_selection: 'invalid' } });
    assert.equal(malformed.body.error, 'place_ref_invalid');
    assert.equal(collected, 0);
    for (const body of [{ scope: 'near_me', anchor: candidate }, { scope: 'near_route', route_points: [candidate, { lat: 51.501, lng: 2.321 }] }]) {
      const result = await requestJson(server, { path: '/api/live-events', body: { ...body, place_ref: 'r12345' } });
      assert.equal(result.status, 200);
    }
    assert.equal(calls.lookup, 2, 'near-me and near-route never use the ref to legitimize geometry');
  });
  const regional = resolverFor({ ...candidate, spatial_scope: { ...candidate.spatial_scope, kind: 'region' } });
  await withApp({ placeResolver: regional.resolver, eventSupply: async () => { throw Error('scope must reject before collection'); } }, async server => {
    const result = await requestJson(server, { path: '/api/live-events', body: { scope: 'in_place', place_ref: 'r12345', anchor: candidate } });
    assert.equal(result.body.error, 'place_scope_unavailable');
  });
});
test('actual Live accepts ref-only and optional same-identity receipt without moving collection geometry', async () => {
  const { resolver, calls } = resolverFor();
  const store = createPlaceSelectionStore();
  const receipt = store.issue(candidate, candidate.label);
  const collected = [];
  await withApp({ placeResolver: resolver, placeSelectionStore: store, eventSupply: async input => { collected.push(input); return { coverage: 'covered', tonight: [], this_week: [] }; } }, async server => {
    for (const scope of ['around_place', 'in_place']) {
      for (const extra of [{}, { place_selection: receipt }]) {
        const anchor = { lat: 51.501, lng: 2.321 };
        const response = await requestJson(server, { path: '/api/live-events', body: { scope, anchor, place_ref: 'r12345', ...extra } });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.deepEqual(collected.at(-1).anchor, anchor);
        assert.equal(response.body.route_mutation, false);
        assert.equal(response.body.day_anchor_mutation, false);
        assert.equal(response.body.contract, 'live_event_query_v1');
      }
    }
  });
  assert.equal(collected.length, 4);
  assert.equal(calls.lookup, 2);
  assert.equal(calls.search, 0);
});
