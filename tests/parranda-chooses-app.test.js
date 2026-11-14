'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { externalRecord, makeLoader, requestJson } = require('./helpers/planner-reservoir-compare');

// Full request path with injected supply, clock, weather and Live events.
// Controlled fixtures only; no network.
const DATE = '2026-10-22';
const BASE = { lat: 55.6, lng: 13 };
// 17:00 in Europe/Stockholm. Callable for trusted context, `.now()` for Live.
const clock = Object.assign(() => new Date('2026-10-22T15:00:00Z'), { now: () => '2026-10-22T15:00:00Z' });
const weatherProvider = async () => ({
  condition: 'sun', pleasant: true, source: 'controlled', stale: false,
  timezone_resolution: { timezone: 'Europe/Stockholm', source: 'provider_auto' },
});
const TYPES = [
  ['restaurant', ['mat'], 'Mo-Su 11:00-23:00'],
  ['cafe', ['fika'], 'Mo-Su 07:00-19:00'],
  ['park', [], null],
  ['museum', ['kultur'], 'Mo-Su 10:00-20:00'],
  ['viewpoint', ['utsikt'], null],
];
function rows() {
  return TYPES.flatMap(([type, tags, hours], typeIndex) => Array.from({ length: 5 }, (_, i) => ({
    ...externalRecord(`${type}-${i}`, `Fixture ${type} ${i}`, type,
      BASE.lat + (i % 3) * 0.0009 + typeIndex * 0.0003, BASE.lng + Math.floor(i / 3) * 0.0009, tags),
    ...(hours ? { opening_hours: hours } : {}),
  })));
}
function tonightEvent() {
  return {
    id: 'ev-tonight',
    title: 'Fixture concert',
    starts_at: '2026-10-22T17:30:00Z',
    ends_at: '2026-10-22T19:30:00Z',
    timezone: 'Europe/Stockholm',
    place: 'Fixture hall',
    source_label: 'Fixture feed',
    source_url: 'https://example.org/ev-tonight',
    license: 'CC-BY 4.0',
    cultural_tier: 'cultural',
    timing_relevance: 'tonight',
    salience_score: 8,
    route_eligible: true,
    lat: BASE.lat + 0.004,
    lng: BASE.lng + 0.002,
  };
}
function body(extra = {}) {
  return {
    city: 'fixture-unregistered-place',
    lat: BASE.lat,
    lng: BASE.lng,
    dates: [DATE],
    preferences: [],
    day_rhythm: 'free',
    distance_mode: 'no_limit',
    include_external_candidates: 1,
    experimental_agnostic_route_output: 1,
    agnostic_engine_compose: 1,
    ...extra,
  };
}
async function withApp(options, run) {
  const server = buildApp({
    openDataLoader: makeLoader(rows()), placeResolver: null, weatherProvider, clock,
    eventSupply: async () => ({ coverage: 'covered', feed: { id: 'fixture', label: 'Fixture feed' }, tonight: [tonightEvent()], this_week: [] }),
    ...options,
  }).listen(0);
  try {
    return await run(server);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
const post = (server, payload) => requestJson(server, { path: '/api/route-recommendations?lang=en', body: payload });

test('Parranda chooses over HTTP: interests with reasons, and tonight\'s eligible event is woven in', async () => {
  await withApp({}, async (server) => {
    const r = await post(server, body({ intent_mode: 'parranda_chooses' }));
    const experiment = r.body.agnostic_route_output_experiment;
    const choice = experiment.parranda_chooses;
    assert.equal(choice.mode, 'parranda_chooses');
    assert.equal(choice.status, 'chosen');
    assert.ok(choice.auto_intents.length >= 2 && choice.auto_intents.length <= 3);
    for (const entry of choice.auto_intents) {
      assert.ok(entry.reasons.length > 0);
      assert.ok(entry.evidence.usable_count >= 2);
    }
    const culture = choice.auto_intents.find(entry => entry.intent === 'culture');
    assert.ok(culture, JSON.stringify(choice.auto_intents.map(entry => entry.intent)));
    assert.ok(culture.reasons.includes('matches_live_event_today'));
    assert.equal(experiment.promotion.promote, true);
    const route = r.body.days[0].primary_route;
    assert.ok(route.main_stops.some(stop => stop.is_live_event === true && stop.event_id === 'ev-tonight'),
      'the eligible event is woven into the chosen day');
    assert.equal(choice.context.live_event, 'woven');
    // Public payload hygiene: counts and codes, never ids or labels.
    assert.doesNotMatch(JSON.stringify(choice), /Fixture|restaurant-|cafe-|park-/);
  });
});

test('over HTTP, explicit preferences and absent mode leave the response as it was', async () => {
  await withApp({}, async (server) => {
    const plain = await post(server, body({ preferences: ['culture'] }));
    const withMode = await post(server, body({ preferences: ['culture'], intent_mode: 'parranda_chooses' }));
    assert.equal(plain.body.agnostic_route_output_experiment.parranda_chooses, undefined);
    assert.equal(withMode.body.agnostic_route_output_experiment.parranda_chooses.status, 'ignored_explicit_preferences');
    assert.deepEqual(withMode.body.days, plain.body.days);

    const varied = await post(server, body());
    assert.equal(varied.body.agnostic_route_output_experiment.parranda_chooses, undefined);
  });
});
