const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { externalRecord, makeLoader, requestJson } = require('./helpers/planner-reservoir-compare');

async function published(hours, extra = {}) {
  const records = Array.from({ length: 3 }, (_, i) => ({
    ...externalRecord(`hours-${i}`, `Source museum ${i}`, 'museum', 55.6 + i * .001, 13, ['museum']),
    ...(hours == null ? {} : { opening_hours: hours }),
  }));
  const server = buildApp({ openDataLoader: makeLoader(records), weatherProvider: async () => null,
    clock: () => new Date('2026-10-17T10:00:00Z'),
    placeResolver: async () => [{ label: 'Fixture place', lat: 55.6, lng: 13, confidence: 'high', provenance: 'fixture' }],
  }).listen(0);
  try {
    return await requestJson(server, { path: '/api/route-recommendations', body: {
      place: 'Fixture place', dates: ['2026-10-18'], preferences: ['culture'], day_rhythm: 'full',
      start: { type: 'auto' }, end: { type: 'auto' }, home_base: { type: 'auto' },
      distance_mode: 'no_limit', experimental_agnostic_route_output: 1,
      include_external_candidates: 1, agnostic_engine_compose: 1, ...extra,
    } });
  } finally { await new Promise(resolve => server.close(resolve)); }
}

test('a source schedule explicitly closed every weekday cannot publish visits when timezone is unknown', async () => {
  for (const hours of ['Mo-Su off', 'Mo-Fr closed; Sa,Su off']) {
    const response = await published(hours, { availability: { eligible: true }, timezone: 'Europe/Stockholm' });
    assert.equal(response.status, 200);
    assert.equal(response.body.agnostic_route_output_experiment.promotion.promote, false, hours);
    assert.equal(response.body.days?.[0]?.primary_route?.main_stops?.length ?? 0, 0, hours);
  }
});

test('missing timezone and unknown or incomplete schedules keep usable suggestions without open claims', async () => {
  for (const hours of [null, 'by appointment', 'Mo off', 'Mo-Su 21:00-02:00']) {
    const response = await published(hours);
    const stops = response.body.days?.[0]?.primary_route?.main_stops || [];
    assert.equal(response.status, 200);
    assert.equal(stops.length, 3, hours);
    assert.ok(stops.every(stop => stop.open_now === undefined && stop.selected_day_hours === undefined));
  }
});
