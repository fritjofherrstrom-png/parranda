'use strict';

// Exercise the real HTTP publication boundary. Only sources and time are fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const { rows } = require('./helpers/day-composition-fixtures');

const DATE = '2026-10-17';
const NOW = '2026-10-16T08:00:00Z';
const ANCHOR = { lat: 56.6, lng: 14 };
const EVENING_EVENT = {
  id: 'publication-evening',
  source_provider_id: 'controlled-feed',
  title: 'Controlled evening concert',
  starts_at: `${DATE}T18:00:00Z`,
  ends_at: `${DATE}T20:00:00Z`,
  timezone: 'Europe/Stockholm',
  lat: 56.6007,
  lng: 14.0003,
  route_eligible: true,
  cultural_tier: 'cultural',
  source_url: 'https://example.org/publication-evening',
  source_label: 'Controlled fixture',
};

// Exact new discovery envelope for these fixed source facts. Source evidence
// remains unchanged; offering a choice is not final walking admission.
const SELECTABLE_EVENING_EVENT = { ...EVENING_EVENT,
  live_occurrence_id: 'live:2026-10-17:7f075a6bdc30b78ae99a437750b6aaae',
  live_choice_eligible: true, occurrence_date: DATE,
};

const originalFetch = global.fetch;
const networkAttempts = [];
test.before(() => {
  global.fetch = async input => {
    networkAttempts.push(String(input));
    throw new Error('External fetch forbidden by publication fixture');
  };
});
test.after(() => {
  global.fetch = originalFetch;
  assert.deepEqual(networkAttempts, [], 'fail-soft providers must not hide an external fetch attempt');
});

const stops = body => body.days?.[0]?.primary_route?.main_stops || [];
const stopIds = body => stops(body).map(stop => stop.id);
const experiment = body => body.agnostic_route_output_experiment;

async function fixture(t, options = {}) {
  const supply = rows('museum', 'museum', 8)
    .map(row => ({ ...row, lat: row.lat + 1, lng: row.lng + 1 }));
  let events = [];
  const server = buildApp({
    openDataLoader: async () => structuredClone(supply),
    eventSupply: async () => ({
      coverage: 'covered', selected_date: DATE, tonight: structuredClone(events), this_week: [],
    }),
    sourceCatalog: null,
    reviewedPlaceSource: null,
    placeResolver: null,
    weatherProvider: async () => ({
      condition: 'sun', maxTemp: 18,
      timezone_resolution: {
        timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200,
      },
    }),
    clock: Object.assign(() => new Date(NOW), { now: () => NOW }),
    ...options,
  }).listen(0, '127.0.0.1');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return {
    supply,
    setEvents: next => { events = structuredClone(next); },
    request: async (extra = {}) => {
      const reply = await requestJson(server, {
        path: '/api/route-recommendations?lang=en',
        body: {
          ...ANCHOR, dates: [DATE], preferences: ['culture'], day_rhythm: 'full',
          distance_mode: 'no_limit', experimental_agnostic_route_output: 1,
          include_external_candidates: 1, agnostic_engine_compose: true,
          ...extra,
        },
      });
      assert.equal(reply.status, 200, 'fixture reaches real application publication');
      return reply.body;
    },
  };
}

async function originalSixStopDay(f) {
  const body = await f.request();
  assert.equal(stops(body).length, 6, 'precondition: genuinely published six-stop engine day');
  assert.equal(experiment(body).promotion.promote, true);
  assert.equal(experiment(body).walking_validation.valid, true);
  assert.equal(experiment(body).context?.time?.now?.slice(0, 10), '2026-10-16',
    'the published composition must use the controlled clock, not the wall date');
  return stopIds(body);
}

function removeIntent(ids, extra = {}) {
  return {
    version: 1, action: 'remove', candidate_id: ids[0], retained_candidate_ids: ids.slice(1),
    target_stop_count: ids.length - 1, slot_index: 0, replacement_preference: null,
    removed_candidate_ids: [ids[0]], ...extra,
  };
}

function assertPublishedEdit(body, target) {
  const outcome = experiment(body).day_edit;
  assert.equal(outcome.status, 'applied', 'the edit must actually be applied, not merely computed');
  assert.equal(experiment(body).promotion.promote, true, 'the engine day must actually be published');
  assert.equal(stops(body).length, target, 'manual extent must hold for the final HTTP route');
  assert.equal(outcome.actual_stop_count, stops(body).length);
  assert.deepEqual(outcome.result_candidate_ids, stopIds(body), 'edit IDs must describe the published chain');
  assert.equal(experiment(body).walking_validation.valid, true);
}

test('HTTP manual remove retains exactly five IDs despite an eligible evening event', async t => {
  const f = await fixture(t);
  const ids = await originalSixStopDay(f);
  f.setEvents([EVENING_EVENT]);
  const body = await f.request({ day_edit: removeIntent(ids) });
  assert.equal(body.place_structure?.district_day?.evening_event?.id, EVENING_EVENT.id,
    'precondition: selected-date evening occurrence reaches the public boundary');
  assertPublishedEdit(body, 5);
  assert.deepEqual(stopIds(body), ids.slice(1), 'removal cannot refill or change the retained route');
  assert.notEqual(body.place_structure.district_day.evening_event.woven_into_route, true);
  assert.deepEqual(body.live_events.tonight, [SELECTABLE_EVENING_EVENT], 'Live evidence remains available separately');
  const ordinary = await f.request();
  assert.deepEqual(body.live_events, ordinary.live_events, 'manual edit leaves the complete Live sidecar unchanged');
});

test('HTTP capped Adjust cannot grow five stops through public event fallback', async t => {
  const f = await fixture(t);
  const ids = await originalSixStopDay(f);
  f.setEvents([EVENING_EVENT]);
  const body = await f.request({ day_edit: removeIntent(ids, { preserve_retained: false }) });
  assert.equal(body.place_structure?.district_day?.evening_event?.id, EVENING_EVENT.id);
  assertPublishedEdit(body, 5);
  assert.equal(experiment(body).day_edit.reason, 'recomposed_with_cap');
  assert.ok(stops(body).every(stop => stop.type === 'museum' && stop.id !== ids[0]));
  assert.equal(new Set(stopIds(body)).size, 5);
  assert.notEqual(body.place_structure.district_day.evening_event.woven_into_route, true);
  assert.deepEqual(body.live_events.tonight, [SELECTABLE_EVENING_EVENT]);
});

test('HTTP replace retains the other five IDs and exactly one relevant alternative, not a seventh event', async t => {
  const f = await fixture(t);
  const ids = await originalSixStopDay(f);
  const retained = ids.slice(1);
  f.setEvents([EVENING_EVENT]);
  const body = await f.request({ day_edit: removeIntent(ids, {
    action: 'replace', target_stop_count: ids.length, replacement_preference: 'culture',
  }) });
  assert.equal(body.place_structure?.district_day?.evening_event?.id, EVENING_EVENT.id);
  assertPublishedEdit(body, 6);
  const alternatives = stops(body).filter(stop => !retained.includes(stop.id));
  assert.equal(alternatives.length, 1, 'one real replacement, not replacement plus appended event');
  const replacement = alternatives[0];
  assert.notEqual(replacement.id, ids[0]);
  assert.equal(replacement.type, 'museum');
  assert.ok(f.supply.some(row => row.id === replacement.id), 'replacement comes from trusted fixture supply');
  assert.equal(experiment(body).day_edit.replacement_candidate_id, replacement.id);
  assert.deepEqual(stopIds(body).filter(id => id !== replacement.id), retained);
  assert.notEqual(body.place_structure.district_day.evening_event.woven_into_route, true);
  assert.deepEqual(body.live_events.tonight, [SELECTABLE_EVENING_EVENT]);
});

test('HTTP ordinary no-edit composition still weaves the eligible event and preserves its Live sidecar', async t => {
  const f = await fixture(t);
  await originalSixStopDay(f);
  f.setEvents([EVENING_EVENT]);
  const body = await f.request();
  assert.equal(experiment(body).promotion.promote, true);
  assert.equal(experiment(body).walking_validation.valid, true);
  assert.equal(stops(body).filter(stop => stop.is_live_event === true).length, 1);
  assert.equal(stops(body).at(-1).event_id, EVENING_EVENT.id);
  assert.equal(body.place_structure.district_day.evening_event.woven_into_route, true);
  assert.deepEqual(body.live_events.tonight, [SELECTABLE_EVENING_EVENT]);
  assert.equal(body.live_events.selected_date, DATE);
  assert.equal(body.live_events.coverage, 'covered');
  assert.equal(body.live_events.acquisition.source_health.status, 'unavailable',
    'fixture rows are not fabricated healthy source-acquisition evidence');
  assert.equal(experiment(body).day_edit, undefined);
});

for (const target of [1, 0]) {
  test(`HTTP deliberate ${target}-stop edit stays truthful with an eligible Live occurrence`, async t => {
    const f = await fixture(t);
    const ids = await originalSixStopDay(f);
    const retained = ids.slice(1, 1 + target);
    f.setEvents([EVENING_EVENT]);
    const body = await f.request({ day_edit: removeIntent(ids, {
      retained_candidate_ids: retained, target_stop_count: target,
      removed_candidate_ids: ids.filter(id => !retained.includes(id)),
    }) });
    const outcome = experiment(body).day_edit;
    assert.equal(outcome.status, 'applied');
    assert.equal(outcome.actual_stop_count, target);
    assert.deepEqual(outcome.result_candidate_ids, retained);
    assert.deepEqual(stopIds(body), retained);
    if (target) {
      assertPublishedEdit(body, target);
    } else {
      assert.equal(body.days[0].primary_route, null, 'an empty choice is not a fabricated walking route');
      assert.equal(body.days[0].manual_empty_day, true);
      assert.equal(experiment(body).manual_edit_published, true);
      assert.equal(experiment(body).promotion.promote, false);
    }
    assert.notEqual(body.place_structure?.district_day?.evening_event?.woven_into_route, true);
    assert.deepEqual(body.live_events.tonight, [SELECTABLE_EVENING_EVENT]);
  });
}

test('HTTP edited chain still refuses an independent walking failure instead of publishing Live filler', async t => {
  const { routeWalkingPath } = require('../server/walking-router');
  let failWalking = false;
  const f = await fixture(t, { walkingRouter: async (points, options) => {
    if (failWalking) throw new Error('controlled walking unavailable');
    return routeWalkingPath(points, options);
  } });
  const ids = await originalSixStopDay(f);
  f.setEvents([EVENING_EVENT]);
  failWalking = true;
  const body = await f.request({ day_edit: removeIntent(ids) });
  assert.equal(experiment(body).walking_validation.valid, false);
  assert.equal(experiment(body).day_edit.status, 'refused');
  assert.equal(experiment(body).day_edit.reason, 'walking_validation_failed');
  assert.equal(experiment(body).promotion.promote, false);
  assert.deepEqual(stopIds(body), []);
  assert.deepEqual(experiment(body).day_edit.result_candidate_ids, []);
  assert.deepEqual(body.live_events.tonight, [SELECTABLE_EVENING_EVENT]);
});

test('HTTP publication-withheld edit remains refused when retained places become known closed', async t => {
  const f = await fixture(t);
  const ids = await originalSixStopDay(f);
  for (const row of f.supply) if (ids.slice(1).includes(row.id)) row.opening_hours = 'Mo-Su off';
  f.setEvents([EVENING_EVENT]);
  const body = await f.request({ day_edit: removeIntent(ids) });
  assert.equal(experiment(body).promotion.promote, false);
  assert.equal(experiment(body).day_edit.status, 'refused', 'computed selection is not published application');
  assert.equal(experiment(body).day_edit.reason, 'publication_withheld');
  assert.deepEqual(experiment(body).day_edit.result_candidate_ids, []);
  assert.deepEqual(stopIds(body), []);
  assert.notEqual(experiment(body).manual_edit_published, true);
  assert.deepEqual(body.live_events.tonight, [SELECTABLE_EVENING_EVENT]);
});

for (const [label, changed, offersChoice] of [
  ['source-ineligible', { route_eligible: false }, false],
  ['other-date', { starts_at: '2026-10-18T18:00:00Z', ends_at: '2026-10-18T20:00:00Z' }, false],
  ['not-walkable', { lat: 57.6 }, true],
]) {
  test(`HTTP ordinary event weave still refuses a ${label} occurrence without erasing Live evidence`, async t => {
    const f = await fixture(t);
    const row = { ...EVENING_EVENT, ...changed };
    f.setEvents([row]);
    const body = await f.request();
    assert.equal(experiment(body).promotion.promote, true);
    assert.equal(stops(body).length, 6);
    assert.ok(stops(body).every(stop => stop.is_live_event !== true));
    assert.notEqual(body.place_structure?.district_day?.evening_event?.woven_into_route, true);
    assert.deepEqual(body.live_events.tonight, [offersChoice ? { ...SELECTABLE_EVENING_EVENT, ...changed } : row]);
  });
}

test('HTTP explicit Live removal remains authoritative and does not remove source evidence', async t => {
  const f = await fixture(t);
  f.setEvents([EVENING_EVENT]);
  const original = await f.request();
  const occurrence = stops(original).find(stop => stop.is_live_event === true);
  assert.ok(occurrence?.live_occurrence_id, 'precondition: genuine publication issues the occurrence identity');
  assert.equal(occurrence.live_choice_eligible, true);
  const body = await f.request({ live_event_choices: [{ occurrence_id: occurrence.live_occurrence_id, action: 'remove' }] });
  assert.equal(experiment(body).promotion.promote, true);
  assert.ok(stops(body).every(stop => stop.is_live_event !== true));
  assert.equal(body.place_structure.district_day.evening_event, null);
  assert.deepEqual(body.live_events, original.live_events);
});
