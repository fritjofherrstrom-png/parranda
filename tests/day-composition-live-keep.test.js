'use strict';

// Actual source normalization + HTTP publisher. Transport, weather and clock
// are controlled; no live-provider acceptance or invented source health.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { resolveDefaultEventSupply, HELSINKI_LINKED_EVENTS_FEED } = require('../server/place-candidates/agnostic-event-supply');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const { rows } = require('./helpers/day-composition-fixtures');
const DATE = '2026-10-17';
const ROUTE = '/api/route-recommendations?lang=en&include_live_completion=1&include_live_route_upgrade=1';
const BODY = { lat: 60.17, lng: 24.94, dates: [DATE], preferences: ['culture', 'views'],
  preference_priority: ['culture', 'views'], day_rhythm: 'full', distance_mode: 'no_limit',
  experimental_agnostic_route_output: 1, include_external_candidates: 1, agnostic_engine_compose: true };
const RAW = { id: 'kept-concert', name: { en: 'Kept source concert' },
  start_time: `${DATE}T18:00:00Z`, end_time: `${DATE}T20:00:00Z`,
  location: { position: { coordinates: [24.941, 60.171] }, name: { en: 'Controlled venue' } },
  info_url: { en: 'https://example.org/kept-concert' }, data_source: 'controlled-transport',
  keywords: [{ name: { en: 'music' } }] };
const stops = body => body.days?.[0]?.primary_route?.main_stops || [];
const experiment = body => body.agnostic_route_output_experiment;

async function fixture(t) {
  const attempts = [];
  const originalFetch = global.fetch;
  global.fetch = async input => {
    const target = new URL(String(input));
    if (target.origin === 'https://api.hel.fi' && target.pathname === '/linkedevents/v1/event/') {
      return { ok: true, json: async () => ({ data: [structuredClone(RAW)] }) };
    }
    attempts.push(String(input));
    throw new Error('Unexpected external fetch in controlled Keep fixture');
  };
  t.after(() => { global.fetch = originalFetch; assert.deepEqual(attempts, []); });
  const records = [...rows('culture', 'museum', 4), ...rows('views', 'viewpoint', 1)]
    .map(record => ({ ...record, lat: record.lat + 4.57, lng: record.lng + 11.94 }));
  const eventSupply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: 'enabled',
    PARRANDA_EVENT_FEEDS: JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]),
    PARRANDA_REQUEST_TIME_EVENT_DISCOVERY: 'disabled' }, { requestTimeDiscovery: null, eventReader: null });
  const server = buildApp({ eventSupply, openDataLoader: async () => structuredClone(records),
    weatherProvider: async () => ({ condition: 'sun', timezone_resolution: {
      timezone: 'Europe/Helsinki', timezone_source: 'weather_provider_auto', utc_offset_seconds: 10800 } }),
    placeResolver: null, reviewedPlaceSource: null, sourceCatalog: null,
    clock: { now: () => '2026-10-16T08:00:00Z' },
  }).listen(0, '127.0.0.1');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const post = async (path, body) => {
    const reply = await requestJson(server, { path, body });
    assert.equal(reply.status, 200);
    return reply.body;
  };
  const cold = await post(ROUTE, BODY);
  if (cold.live_events.pending) {
    let completion;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setImmediate(resolve));
      const reply = await requestJson(server, { path: '/api/planner-live-completion', body: { token: cold.live_completion.token } });
      if (reply.status === 200) { completion = reply.body; break; }
    }
    assert.ok(completion, 'the real producer settles, not a fabricated terminal fixture');
    assert.equal(completion.live_events.acquisition.source_health.status, 'healthy');
  }
  const ordinary = await post(ROUTE, BODY);
  const event = stops(ordinary).find(stop => stop.is_live_event === true);
  assert.ok(event?.live_occurrence_id, 'the real source normalizer and publisher issue a selectable occurrence');
  const choice = { occurrence_id: event.live_occurrence_id, action: 'keep' };
  const kept = await post(ROUTE, { ...BODY, live_event_choices: [choice] });
  assert.equal(stops(kept).length, 6);
  assert.equal(experiment(kept).live_event_choices.honored_count, 1, 'the unchanged occurrence passes ordinary Keep gates');
  return { kept, choice, event, request: extra => post(ROUTE, { ...BODY, live_event_choices: [choice], ...extra }) };
}

for (const releaseRetention of [false, true]) test(`manual removal cannot silently drop an exact kept occurrence (${releaseRetention ? 'capped Adjust' : 'retained chain'})`, async t => {
  const f = await fixture(t);
  const candidate = stops(f.kept).find(stop => !stop.is_live_event);
  const retained = stops(f.kept).filter(stop => stop.id !== candidate.id).map(stop => stop.id);
  const day_edit = { version: 1, action: 'remove', candidate_id: candidate.id,
    retained_candidate_ids: retained, target_stop_count: 5, slot_index: 0,
    replacement_preference: null, removed_candidate_ids: [candidate.id],
    ...(releaseRetention ? { preserve_retained: false } : {}) };
  const changed = await f.request({ day_edit });
  const outcome = experiment(changed).day_edit;
  // Preserving the full contract is preferred. Existing eligibility/geometry
  // gates may instead refuse atomically; a false applied result is forbidden.
  if (outcome.status === 'refused') {
    assert.equal(outcome.reason, 'live_keep_not_preserved', 'refusal must name the composition limitation, not invent unavailable source facts');
    assert.equal(experiment(changed).promotion.promote, false);
    assert.equal(changed.days.length, 0, 'refusal cannot publish a half-applied replacement day');
    return;
  }
  assert.equal(outcome.status, 'applied');
  assert.equal(stops(changed).length, 5, 'the final count includes the kept occurrence');
  assert.equal(stops(changed).find(stop => stop.is_live_event)?.live_occurrence_id, f.choice.occurrence_id);
  assert.equal(experiment(changed).live_event_choices.honored_count, 1);
  assert.deepEqual(outcome.result_candidate_ids, stops(changed).map(stop => stop.id));
  assert.equal(outcome.actual_stop_count, 5);
  if (!releaseRetention) assert.deepEqual(outcome.result_candidate_ids, retained);
});

test('an occurrence Keep on another date cannot block a valid manual stable-stop removal', async t => {
  const f = await fixture(t);
  const stable = stops(f.kept).filter(stop => !stop.is_live_event);
  const candidate = stable[0], retained = stable.slice(1).map(stop => stop.id);
  const day_edit = { version: 1, action: 'remove', candidate_id: candidate.id,
    retained_candidate_ids: retained, target_stop_count: retained.length, slot_index: 0,
    replacement_preference: null, removed_candidate_ids: [candidate.id] };
  const changed = await f.request({ day_edit, live_event_choices: [{
    occurrence_id: f.choice.occurrence_id.replace(DATE, '2026-10-18'), action: 'keep',
  }] });
  assert.equal(experiment(changed).day_edit.status, 'applied');
  assert.equal(experiment(changed).promotion.promote, true);
  assert.deepEqual(stops(changed).map(stop => stop.id), retained);
  assert.equal(experiment(changed).live_event_choices.ignored_other_day_count, 1);
});

test('an already published eligible Live stop is not silently lost from manual retained IDs without an explicit Keep', async t => {
  const f = await fixture(t);
  const candidate = stops(f.kept).find(stop => !stop.is_live_event);
  const retained = stops(f.kept).filter(stop => stop.id !== candidate.id).map(stop => stop.id);
  const changed = await f.request({ live_event_choices: [], day_edit: {
    version: 1, action: 'remove', candidate_id: candidate.id, retained_candidate_ids: retained,
    target_stop_count: retained.length, slot_index: 0, replacement_preference: null,
    removed_candidate_ids: [candidate.id],
  } });
  const outcome = experiment(changed).day_edit;
  if (outcome.status === 'refused') {
    assert.equal(outcome.reason, 'retained_live_not_preserved');
    assert.equal(experiment(changed).promotion.promote, false);
    assert.equal(changed.days.length, 0);
  } else {
    assert.deepEqual(stops(changed).map(stop => stop.id), retained);
    assert.equal(outcome.actual_stop_count, retained.length);
    assert.deepEqual(outcome.result_candidate_ids, retained);
  }
});
