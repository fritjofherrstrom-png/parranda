'use strict';

/** Real local HTTP and application. Sources/clock are injected, not live providers. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const { rows } = require('./helpers/day-composition-fixtures');
const FIXTURE_ANCHOR = { lat: 56.6, lng: 14 };

async function fixtureServer(t, rows = []) {
  let sourceLoads = 0;
  const server = buildApp({
    openDataLoader: async () => { sourceLoads += 1; return rows; },
    eventSupply: async () => [],
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 18,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
    clock: () => new Date('2026-10-16T08:00:00Z'),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return { server, sourceLoads: () => sourceLoads };
}

async function payload(options = {}) {
  const { buildAnywherePayload } = await import('../frontend/src/lib/anywhere-payload.mjs');
  return buildAnywherePayload({ coords: FIXTURE_ANCHOR, dates: ['2026-10-17'],
    preferences: ['culture', 'food'], dayRhythm: 'full', ...options });
}

test('explicit malformed day_edit is refused before acquiring place supply', async t => {
  const fixture = await fixtureServer(t);
  const body = { ...await payload(), day_edit: { version: 1, action: 'remove', target_stop_count: 99 } };
  const reply = await requestJson(fixture.server, { path: '/api/route-recommendations?lang=en', body });
  assert.equal(reply.status, 400, 'an invalid explicit edit must not become a normal full recompose');
  assert.equal(reply.body.error, 'invalid_day_edit');
  assert.equal(fixture.sourceLoads(), 0, 'invalid edit cannot spend provider work');
});

test('HTTP opposite priorities change the published content weight on identical eligible supply', async t => {
  const supply = [...rows('museum', 'museum'), ...rows('shop', 'vintage-shop')]
    .map(record => ({ ...record, lat: record.lat + 1, lng: record.lng + 1 }));
  const fixture = await fixtureServer(t, supply);
  const published = [];
  for (const preferencePriority of [['culture', 'second_hand'], ['second_hand', 'culture']]) {
    const body = await payload({ preferences: ['culture', 'second_hand'], preferencePriority });
    assert.deepEqual(body.preference_priority, preferencePriority, 'the real frontend builder carries explicit intent');
    const reply = await requestJson(fixture.server, { path: '/api/route-recommendations?lang=en', body });
    assert.equal(reply.status, 200);
    const stops = reply.body.days[0]?.primary_route?.main_stops;
    assert.ok(Array.isArray(stops) && stops.length === 6, 'precondition: rich admitted supply publishes a Full day');
    assert.equal(reply.body.agnostic_route_output_experiment.promotion.promote, true);
    published.push(stops.map(stop => stop.type));
  }
  const museums = stops => stops.filter(type => type === 'museum').length;
  assert.ok(museums(published[0]) > museums(published[1]), 'reversing priority must change content, not merely badge order');
  assert.ok(museums(published[0]) > 3, 'culture can dominate a rich two-interest day');
  assert.ok(museums(published[1]) < 3, 'second hand can dominate the same pool instead');
});

test('HTTP remove publishes one fewer verified retained stop and does not silently refill Full', async t => {
  const supply = rows('museum', 'museum', 8).map(record => ({ ...record, lat: record.lat + 1, lng: record.lng + 1 }));
  const fixture = await fixtureServer(t, supply);
  const original = await requestJson(fixture.server, { path: '/api/route-recommendations?lang=en', body: await payload({ preferences: ['culture'] }) });
  const originalIds = original.body.days[0]?.primary_route?.main_stops.map(stop => stop.id);
  assert.equal(originalIds?.length, 6, 'precondition: this genuine application result has six stops');
  const dayEdit = { version: 1, action: 'remove', candidate_id: originalIds[0],
    retained_candidate_ids: originalIds.slice(1), target_stop_count: 5, slot_index: 0,
    replacement_preference: null, removed_candidate_ids: [originalIds[0]] };
  const body = await payload({ preferences: ['culture'], dayEdit });
  assert.equal(body.excluded_candidate_ids, undefined, 'the edit itself must carry subtraction, even without a duplicate ledger');
  const reply = await requestJson(fixture.server, { path: '/api/route-recommendations?lang=en', body });
  assert.equal(reply.status, 200);
  const stops = reply.body.days[0]?.primary_route?.main_stops;
  assert.equal(stops?.length, 5, 'manual removal is not a normal Full regeneration');
  assert.deepEqual(new Set(stops.map(stop => stop.id)), new Set(originalIds.slice(1)));
  const experiment = reply.body.agnostic_route_output_experiment;
  assert.equal(experiment.day_edit.status, 'applied');
  assert.equal(experiment.day_edit.actual_stop_count, stops.length);
  assert.deepEqual(experiment.day_edit.result_candidate_ids, stops.map(stop => stop.id));
  assert.equal(experiment.excluded_candidates.requested_count, 1);
  assert.equal(experiment.walking_validation.valid, true);
});

for (const targetCount of [1, 0]) test(`HTTP intentional ${targetCount}-stop removal is published without faking a normal day`, async t => {
  const supply = rows('museum', 'museum', 8).map(record => ({ ...record, lat: record.lat + 1, lng: record.lng + 1 }));
  const fixture = await fixtureServer(t, supply);
  const original = await requestJson(fixture.server, { path: '/api/route-recommendations?lang=en', body: await payload({ preferences: ['culture'] }) });
  const ids = original.body.days[0].primary_route.main_stops.map(stop => stop.id);
  const retained = ids.slice(1, 1 + targetCount);
  const dayEdit = { version: 1, action: 'remove', candidate_id: ids[0], retained_candidate_ids: retained,
    target_stop_count: targetCount, slot_index: 0, replacement_preference: null,
    removed_candidate_ids: ids.filter(id => !retained.includes(id)) };
  const reply = await requestJson(fixture.server, { path: '/api/route-recommendations?lang=en', body: await payload({ preferences: ['culture'], dayEdit }) });
  assert.equal(reply.status, 200);
  const day = reply.body.days?.[0];
  assert.ok(day, 'an intentional edited state must not be replaced by the empty baseline');
  assert.equal(reply.body.agnostic_route_output_experiment.day_edit.status, 'applied');
  if (targetCount) {
    assert.deepEqual(day.primary_route.main_stops.map(stop => stop.id), retained);
    assert.equal(reply.body.agnostic_route_output_experiment.walking_validation.valid, true);
  } else {
    assert.equal(day.primary_route, null);
    assert.equal(day.manual_empty_day, true);
    assert.notEqual(day.experimental_agnostic_route_applied, true, 'an empty choice is not a composed walking route');
    assert.equal(reply.body.agnostic_route_output_experiment.manual_edit_published, true);
    assert.equal(reply.body.agnostic_route_output_experiment.promotion.promote, false, 'do not mint readiness for an empty list');
  }
});

test('HTTP a new stable pin can enter a shortened day without restoring removed visits or filling its cap', async t => {
  const supply = rows('museum', 'museum', 8).map(record => ({ ...record, lat: record.lat + 1, lng: record.lng + 1 }));
  const fixture = await fixtureServer(t, supply);
  const original = await requestJson(fixture.server, { path: '/api/route-recommendations?lang=en', body: await payload({ preferences: ['culture'] }) });
  const originalIds = original.body.days[0].primary_route.main_stops.map(stop => stop.id);
  assert.equal(originalIds.length, 6);
  const retained = [originalIds[0], originalIds[2]];
  const outsider = supply.find(record => !originalIds.includes(record.id));
  assert.ok(outsider, 'precondition: a real admitted alternative exists outside the published route');
  const dayEdit = { version: 1, action: 'remove', candidate_id: originalIds[1],
    retained_candidate_ids: retained, target_stop_count: 2, slot_index: 1,
    replacement_preference: null, removed_candidate_ids: originalIds.filter(id => !retained.includes(id)) };
  const removed = await requestJson(fixture.server, { path: '/api/route-recommendations?lang=en',
    body: await payload({ preferences: ['culture'], pinnedCandidateIds: [retained[0]], dayEdit }) });
  assert.equal(removed.body.agnostic_route_output_experiment.day_edit.status, 'applied');
  assert.deepEqual(new Set(removed.body.days[0].primary_route.main_stops.map(stop => stop.id)), new Set(retained));
  const added = await requestJson(fixture.server, { path: '/api/route-recommendations?lang=en',
    body: await payload({ preferences: ['culture'], pinnedCandidateIds: [retained[0], outsider.id],
      dayEdit: { ...dayEdit, preserve_retained: false } }) });
  assert.equal(added.status, 200);
  const experiment = added.body.agnostic_route_output_experiment;
  assert.equal(experiment.day_edit.status, 'applied');
  const stops = added.body.days[0].primary_route.main_stops;
  assert.equal(stops.length, 2);
  assert.deepEqual(new Set(stops.map(stop => stop.id)), new Set([retained[0], outsider.id]));
  assert.ok(!stops.some(stop => dayEdit.removed_candidate_ids.includes(stop.id)));
  assert.equal(experiment.walking_validation.valid, true);
});

test('a computed edit withheld by publication cannot be reported as applied', async t => {
  const supply = rows('museum', 'museum', 8).map(record => ({ ...record, lat: record.lat + 1, lng: record.lng + 1 }));
  const fixture = await fixtureServer(t, supply);
  const original = await requestJson(fixture.server, { path: '/api/route-recommendations?lang=en', body: await payload({ preferences: ['culture'] }) });
  const ids = original.body.days[0].primary_route.main_stops.map(stop => stop.id);
  const retained = ids.slice(1);
  for (const record of supply) if (retained.includes(record.id)) record.opening_hours = 'Mo-Su off';
  const dayEdit = { version: 1, action: 'remove', candidate_id: ids[0], retained_candidate_ids: retained,
    target_stop_count: 5, slot_index: 0, replacement_preference: null, removed_candidate_ids: [ids[0]] };
  const reply = await requestJson(fixture.server, { path: '/api/route-recommendations?lang=en', body: await payload({ preferences: ['culture'], dayEdit }) });
  assert.equal(reply.status, 200);
  const experiment = reply.body.agnostic_route_output_experiment;
  assert.equal(experiment.promotion.promote, false);
  assert.equal(experiment.day_edit.status, 'refused', 'internal selection is not the published result');
  assert.equal(experiment.day_edit.reason, 'publication_withheld');
  assert.notEqual(experiment.manual_edit_published, true);
  assert.deepEqual(experiment.day_edit.result_candidate_ids, []);
});
