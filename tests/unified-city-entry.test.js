'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { buildApp } = require('../server/app');
function get(server, path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path }, res => {
      let body = ''; res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body }));
    }).on('error', reject);
  });
}
async function setup(t) {
  const server = buildApp({ openDataLoader: null, eventSupply: null, placeResolver: null, reviewedPlaceSource: null }).listen(0);
  t.after(() => { server.close(); server.closeAllConnections(); });
  return path => get(server, path);
}
for (const [key, label] of [['rome', 'Rome'], ['barcelona', 'Barcelona'], ['athens', 'Athens']]) {
  test(`${key} bookmarks open the common planner instead of the old shell`, async t => {
    const request = await setup(t);
    for (const path of [`/${key}`, `/${key}/plan`, `/${key}?planner=open`]) {
      const result = await request(path);
      assert.equal(result.status, 302);
      const url = new URL(result.location, 'http://localhost');
      assert.equal(url.pathname, '/anywhere');
      assert.equal(url.searchParams.get('place'), label);
      assert.equal(url.searchParams.has('city'), false);
      assert.equal(url.searchParams.get('lang'), 'en');
    }
  });
}
test('legacy city query canonicalization keeps day inputs and server-owned label', async t => {
  const request = await setup(t);
  const result = await request('/anywhere?city=rome&place=Spoofed&prefs=fika&day=1&rhythm=calm&lang=sv');
  assert.equal(result.status, 302);
  const url = new URL(result.location, 'http://localhost');
  assert.equal(url.searchParams.get('place'), 'Rom');
  assert.equal(url.searchParams.get('prefs'), 'fika');
  assert.equal(url.searchParams.get('day'), '1');
  assert.equal(url.searchParams.get('rhythm'), 'calm');
  assert.equal(url.searchParams.has('city'), false);
});
test('explicit coordinates in a legacy city URL remain the exact anchor', async t => {
  const request = await setup(t);
  const result = await request('/anywhere?city=rome&place=Rome&lat=48.5&lng=8.5&lang=en');
  assert.equal(result.status, 302);
  const url = new URL(result.location, 'http://localhost');
  assert.equal(url.searchParams.get('lat'), '48.5');
  assert.equal(url.searchParams.get('lng'), '8.5');
  assert.equal(url.searchParams.has('place'), false);
  assert.equal(url.searchParams.has('city'), false);
});
test('unknown paths do not become city entries and ordinary freeform intake still renders', async t => {
  const request = await setup(t);
  assert.equal((await request('/unknown-city')).status, 404);
  assert.equal((await request('/rome/missing.js')).status, 404);
  assert.equal((await request('/anywhere?place=Lyon')).status, 200);
});
test('old city paths preserve an explicit GPS handoff', async t => {
  const request = await setup(t);
  const result = await request('/rome?anchor=near&prefs=fika&lang=sv');
  assert.equal(result.status, 302);
  const url = new URL(result.location, 'http://localhost');
  assert.equal(url.searchParams.get('anchor'), 'near');
  assert.equal(url.searchParams.get('prefs'), 'fika');
  assert.equal(url.searchParams.has('place'), false);
});

// Real API composition from the same modern UI payload. Sources/resolver are
// injected; catalog data and all composition/eligibility gates are real.
for (const [label, anchor] of [
  ['Rome', { lat: 41.889, lng: 12.47 }],
  ['Barcelona', { lat: 41.3786, lng: 2.1618 }],
  ['Athens', { lat: 37.9755, lng: 23.729 }],
  ['Stockholm', { lat: 59.3293, lng: 18.0686 }],
]) test(`${label} enters shared composition through the modern place payload`, async t => {
  const { buildAnywherePayload } = await import('../frontend/src/lib/anywhere-payload.mjs');
  const { externalRecord, requestJson } = require('./helpers/planner-reservoir-compare');
  const rows = label === 'Stockholm' ? [
    externalRecord('fixture-cafe', 'Source cafe', 'cafe', anchor.lat, anchor.lng),
    externalRecord('fixture-food', 'Source restaurant', 'restaurant', anchor.lat + .001, anchor.lng + .001),
    externalRecord('fixture-coffee', 'Source coffee', 'cafe', anchor.lat + .002, anchor.lng + .002),
  ] : [];
  const server = buildApp({ openDataLoader: async () => rows, reviewedPlaceSource: null, eventSupply: null,
    weatherProvider: async () => null,
    placeResolver: async query => {
      assert.equal(query, label);
      return [{ ...anchor, label, confidence: 'medium', provenance: 'fixture_resolver' }];
    } }).listen(0);
  t.after(() => { server.close(); server.closeAllConnections(); });
  const payload = buildAnywherePayload({ place: label, dates: ['2026-10-08'], preferences: ['food', 'fika'] });
  const { status, body } = await requestJson(server, { path: '/api/route-recommendations?lang=en', body: payload });
  assert.equal(status, 200);
  assert.equal(body.agnostic_route_output_experiment.intake.mode, 'place');
  assert.equal(body.agnostic_route_output_experiment.intake.query, label);
  assert.equal(body.agnostic_route_output_experiment.synthesized_via, 'agnostic_compose_engine');
  assert.equal(body.agnostic_route_output_experiment.promotion.promote, true);
  const stops = body.days[0].primary_route.main_stops;
  assert.ok(stops.length >= 2);
  if (label !== 'Stockholm') assert.ok(stops.some(stop => stop.origin === 'curated_catalog'));
  assert.ok(stops.every(stop => [...stop.covered_preferences, ...stop.partial_preferences].some(p => ['food', 'coffee'].includes(p))));
});
