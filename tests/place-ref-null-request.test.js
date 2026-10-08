'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');

test('present null reference is invalid on actual Planner and Blitz, never a free-text request', async () => {
  let searches = 0;
  const placeResolver = async () => {
    searches++;
    return [{ label: 'Fixture Harbour', lat: 51.5, lng: 2.32, confidence: 'medium', osm_ref: 'node/12345', osm_class: 'place' }];
  };
  const app = buildApp({ placeResolver, openDataLoader: null, eventSupply: null, weatherProvider: async () => null });
  const server = app.listen(0);
  try {
    const planner = await requestJson(server, { path: '/api/route-recommendations', body: {
      place: 'Fixture Harbour', place_ref: null, dates: ['2026-10-08'],
      day_rhythm: 'balanced', experimental_agnostic_route_output: 1,
    } });
    assert.deepEqual(planner.body.agnostic_route_output_experiment.intake.blockers, ['place_ref_invalid']);
    const blitz = await requestJson(server, { path: '/api/blitz?anywhere_blitz=1', body: { place: 'Fixture Harbour', place_ref: null } });
    assert.deepEqual(blitz.body.intake.blockers, ['place_ref_invalid']);
    assert.equal(searches, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
