'use strict';

// Controlled source transport and clock, real normalizer, HTTP handlers and
// composition/publisher. No public-provider or physical-device acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { resolveDefaultEventSupply, HELSINKI_LINKED_EVENTS_FEED } = require('../server/place-candidates/agnostic-event-supply');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const { rows } = require('./helpers/day-composition-fixtures');
const NOW = '2026-10-16T08:00:00Z';
const DATE = '2026-10-17';
const PATH = '/api/route-recommendations?lang=en&include_live_completion=1';
const BODY = { lat: 60.17, lng: 24.94, dates: [DATE], preferences: ['culture', 'views'],
  day_rhythm: 'full', distance_mode: 'no_limit', experimental_agnostic_route_output: true,
  include_external_candidates: true, agnostic_engine_compose: true };
const routeStops = body => body.days?.[0]?.primary_route?.main_stops || [];
const allEvents = live => [...(live?.tonight || []), ...(live?.browse?.tonight?.more || [])];

async function fixture(t) {
  let raw = ['first', 'second'].map((id, index) => ({ id: `choice-${id}`, name: { en: `Source concert ${id}` },
    start_time: `${DATE}T${18 + index}:00:00Z`, end_time: `${DATE}T${20 + index}:00:00Z`,
    location: { position: { coordinates: [24.941 + index * .001, 60.171] }, name: { en: 'Source venue' } },
    info_url: { en: `https://example.org/concert-${id}` }, data_source: 'controlled-transport',
    keywords: [{ name: { en: 'music' } }] }));
  const fetchBefore = global.fetch, unexpected = [];
  global.fetch = async input => {
    const url = new URL(String(input));
    if (url.origin === 'https://api.hel.fi' && url.pathname === '/linkedevents/v1/event/')
      return { ok: true, json: async () => ({ data: structuredClone(raw) }) };
    unexpected.push(String(input)); throw new Error('Unexpected source request');
  };
  t.after(() => { global.fetch = fetchBefore; assert.deepEqual(unexpected, []); });
  const records = [...rows('culture', 'museum', 7), ...rows('views', 'viewpoint', 2)]
    .map(record => ({ ...record, lat: record.lat + 4.57, lng: record.lng + 11.94 }));
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: 'enabled',
    PARRANDA_EVENT_FEEDS: JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]),
    PARRANDA_REQUEST_TIME_EVENT_DISCOVERY: 'disabled' }, { requestTimeDiscovery: null, eventReader: null });
  const server = buildApp({ eventSupply: supply, openDataLoader: async () => structuredClone(records),
    placeResolver: null, reviewedPlaceSource: null, sourceCatalog: null,
    weatherProvider: async () => ({ condition: 'sun', timezone_resolution: {
      timezone: 'Europe/Helsinki', timezone_source: 'weather_provider_auto', utc_offset_seconds: 10800 } }),
    // The composer reads the clock as a function; an object with only now()
    // let the composition fall back to the wall clock (same fix as #623).
    clock: Object.assign(() => new Date(NOW), { now: () => NOW }),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const post = async extra => {
    const out = await requestJson(server, { path: PATH, body: { ...BODY, ...extra } });
    assert.equal(out.status, 200); return out.body;
  };
  const cold = await post({});
  if (cold.live_events.pending) {
    let terminal;
    for (let index = 0; index < 20; index++) {
      await new Promise(resolve => setImmediate(resolve));
      const out = await requestJson(server, { path: '/api/planner-live-completion', body: { token: cold.live_completion.token } });
      if (out.status === 200) { terminal = out.body; break; }
    }
    assert.ok(terminal, 'the real controlled source producer completes');
    assert.equal(terminal.live_events.acquisition.source_health.status, 'healthy');
  }
  const initial = await post({});
  assert.equal(initial.agnostic_route_output_experiment.context?.time?.now?.slice(0, 10), '2026-10-16',
    'the composition must use the controlled clock, not the wall date');
  const chosen = allEvents(initial.live_events).find(event => event.title === 'Source concert second');
  assert.ok(chosen, 'the source normalizer supplies the alternative event in discovery');
  return { initial, chosen, post };
}

test('discovery exposes a server-issued exact eligible occurrence, not only an event title', async t => {
  const f = await fixture(t);
  assert.match(f.chosen.live_occurrence_id || '', /^live:2026-10-17:[a-f0-9]{32}$/);
  assert.equal(f.chosen.live_choice_eligible, true);
  assert.equal(f.chosen.occurrence_date, DATE);
});

for (const [rhythm, count] of [['calm', 4], ['balanced', 5], ['full', 6]]) {
  test(`selected occurrence belongs within ${rhythm}'s ${count} total stops`, async t => {
    const f = await fixture(t);
    assert.ok(f.chosen.live_occurrence_id);
    const selected = await f.post({ day_rhythm: rhythm, live_event_choices: [{
      occurrence_id: f.chosen.live_occurrence_id, action: 'keep',
    }] });
    const stops = routeStops(selected);
    assert.equal(stops.length, count, 'the chosen event is counted inside the day, never appended above its extent');
    assert.equal(stops.filter(stop => stop.is_live_event).length, 1);
    assert.equal(stops.at(-1).live_occurrence_id, f.chosen.live_occurrence_id);
    assert.equal(selected.agnostic_route_output_experiment.live_event_choices.honored_count, 1);
    assert.equal(selected.agnostic_route_output_experiment.walking_validation.valid, true);
  });
}

for (const action of ['remove', 'replace']) {
  test(`${action} succeeds atomically while preserving the exact selected live occurrence`, async t => {
    const f = await fixture(t);
    assert.ok(f.chosen.live_occurrence_id);
    const choices = [{ occurrence_id: f.chosen.live_occurrence_id, action: 'keep' }];
    const selected = await f.post({ live_event_choices: choices });
    const before = routeStops(selected), removed = before.find(stop => !stop.is_live_event);
    const retained = before.filter(stop => stop.id !== removed.id).map(stop => stop.id);
    const target = before.length - (action === 'remove' ? 1 : 0);
    const result = await f.post({ live_event_choices: choices, day_edit: { version: 1, action,
      candidate_id: removed.id, retained_candidate_ids: retained, target_stop_count: target,
      slot_index: 0, replacement_preference: action === 'replace' ? 'culture' : null,
      removed_candidate_ids: [removed.id] } });
    const final = routeStops(result), outcome = result.agnostic_route_output_experiment.day_edit;
    assert.equal(outcome.status, 'applied', 'a refusal does not satisfy positive mixed-day acceptance');
    assert.equal(final.length, target);
    assert.equal(final.at(-1).live_occurrence_id, f.chosen.live_occurrence_id);
    assert.ok(!final.some(stop => stop.id === removed.id));
    assert.deepEqual(final.filter(stop => retained.includes(stop.id)).map(stop => stop.id), retained);
    assert.deepEqual(outcome.result_candidate_ids, final.map(stop => stop.id));
    assert.equal(outcome.actual_stop_count, target);
    assert.equal(result.agnostic_route_output_experiment.walking_validation.valid, true);
  });
}

test('a forged unavailable occurrence cannot publish a different event as successful selection', async t => {
  const f = await fixture(t);
  const result = await f.post({ live_event_choices: [{ occurrence_id: `live:${DATE}:${'0'.repeat(32)}`, action: 'keep' }] });
  assert.equal(routeStops(result).length, 0, 'selection is atomic even when ordinary stable supply could compose');
  assert.equal(result.agnostic_route_output_experiment.promotion.promote, false);
  assert.equal(result.agnostic_route_output_experiment.live_event_choices.honored_count, 0);
  assert.equal(result.agnostic_route_output_experiment.live_event_choices.unhonored.length, 1);
});

test('an explicit live selection never sheds stable pins to make room', async t => {
  const f = await fixture(t);
  const stable = routeStops(f.initial).filter(stop => !stop.is_live_event);
  assert.equal(stable.length, 6);
  const selected = await f.post({ pinned_candidate_ids: stable.map(stop => stop.id), live_event_choices: [{
    occurrence_id: f.chosen.live_occurrence_id, action: 'keep',
  }] });
  assert.equal(routeStops(selected).length, 0, 'the old day must be held when all six pinned places and the event cannot fit');
  assert.equal(selected.agnostic_route_output_experiment.promotion.promote, false);
});

test('a strict retained Live identity is never silently dropped by another event choice', async t => {
  const f = await fixture(t);
  const before = routeStops(f.initial), oldLive = before.find(stop => stop.is_live_event);
  const removed = before.find(stop => !stop.is_live_event);
  const retained = before.filter(stop => stop.id !== removed.id).map(stop => stop.id);
  const edit = { version: 1, action: 'remove', candidate_id: removed.id,
    retained_candidate_ids: retained, target_stop_count: retained.length,
    slot_index: 0, replacement_preference: null, removed_candidate_ids: [removed.id] };
  const shortened = await f.post({ day_edit: edit });
  assert.equal(shortened.agnostic_route_output_experiment.day_edit.status, 'applied');
  const changed = await f.post({ day_edit: edit, live_event_choices: [{
    occurrence_id: oldLive.live_occurrence_id, action: 'replace',
  }] });
  assert.equal(changed.agnostic_route_output_experiment.day_edit.status, 'refused');
  assert.equal(changed.agnostic_route_output_experiment.day_edit.reason, 'retained_live_not_preserved');
  assert.equal(routeStops(changed).length, 0, 'the UI retains the earlier answer rather than publishing a half-applied edit');
});

test('a new explicit occurrence can replan within an already shortened cap', async t => {
  const f = await fixture(t);
  const first = allEvents(f.initial.live_events).find(event => event.title === 'Source concert first');
  const choices = [{ occurrence_id: f.chosen.live_occurrence_id, action: 'keep' }];
  const selected = await f.post({ live_event_choices: choices });
  const before = routeStops(selected), removed = before.find(stop => !stop.is_live_event);
  const retained = before.filter(stop => stop.id !== removed.id).map(stop => stop.id);
  const edit = { version: 1, action: 'remove', candidate_id: removed.id,
    retained_candidate_ids: retained, target_stop_count: retained.length,
    slot_index: 0, replacement_preference: null, removed_candidate_ids: [removed.id] };
  const changed = await f.post({ live_event_choices: [{ occurrence_id: first.live_occurrence_id, action: 'keep' }],
    day_edit: { ...edit, preserve_retained: false } });
  assert.equal(changed.agnostic_route_output_experiment.day_edit.status, 'applied');
  assert.equal(routeStops(changed).length, 5);
  assert.equal(routeStops(changed).at(-1).live_occurrence_id, first.live_occurrence_id);
  assert.ok(!routeStops(changed).some(stop => stop.id === removed.id));
});
