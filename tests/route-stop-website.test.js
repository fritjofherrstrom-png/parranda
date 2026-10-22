"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildApp } = require('../server/app');

// Real intake, admission, composition and public formatter. Only trusted source
// acquisition, weather and the clock are controlled; no external calls.
const anchor = { lat: 48.5, lng: 8.5 };
const input = {
  ...anchor, dates: ['2026-10-18'], preferences: ['culture'], day_rhythm: 'balanced',
  distance_mode: 'no_limit', experimental_agnostic_route_output: 1,
  agnostic_engine_compose: 1, include_external_candidates: 1,
};
const records = websites => websites.map((website, i) => ({
  id: `website-museum-${i}`, name: `Source museum ${i}`, type: 'museum',
  lat: anchor.lat + i * .001, lng: anchor.lng + (i % 2) * .001,
  ...(website !== undefined ? { website } : {}),
  sources: [{ provider: 'map', family: 'map', tier: 'inferred', url: `https://map.example/${i}` }],
}));
const legacyRecords = websites => records(websites).map((row, i) => ({
  ...row, type: ['museum', 'cafe', 'restaurant'][i],
}));
const legacyInput = { agnostic_engine_compose: 0, preferences: ['culture', 'coffee', 'food'] };

async function request(t, supply, payload = {}) {
  const server = buildApp({
    openDataLoader: async () => supply,
    eventSupply: null, reviewedPlaceSource: null,
    clock: () => new Date('2026-10-17T08:00:00Z'),
    weatherProvider: async () => ({ timezone_resolution: { timezone: 'Europe/Berlin', timezone_source: 'weather_provider_auto' } }),
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/route-recommendations?lang=en`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, ...payload }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const stops = body.days?.[0]?.primary_route?.main_stops || [];
  assert.ok(stops.length >= 2, 'website handling must preserve the admitted visit candidates');
  return { body, stops };
}

test('real HTTP engine route preserves a source-owned venue website on the same stop, separately from attribution', async t => {
  const { body, stops } = await request(t, records([
    'https://museum-zero.example/visit', 'http://museum-one.example/hours', 'https://museum-two.example/',
  ]));
  assert.equal(body.agnostic_route_output_experiment.promotion.promote, true);
  const byId = new Map(stops.map(stop => [stop.id, stop]));
  assert.equal(byId.get('website-museum-0')?.website, 'https://museum-zero.example/visit');
  assert.equal(byId.get('website-museum-1')?.website, 'http://museum-one.example/hours');
  assert.equal(byId.get('website-museum-2')?.website, 'https://museum-two.example/');
  assert.equal(byId.get('website-museum-0').source.url, 'https://map.example/0');
  assert.equal(byId.get('website-museum-0').selected_day_hours, undefined, 'a website does not certify opening hours');
});

test('real HTTP route omits unsafe, credential-bearing, oversized and missing venue websites', async t => {
  for (const website of [
    'javascript:alert(1)', 'https://user:secret@museum.example/', '/relative-hours',
    `https://museum.example/${'a'.repeat(2049)}`, undefined, { url: 'https://museum.example/' },
  ]) {
    const { body, stops } = await request(t, records([website, 'https://museum-one.example/', 'https://museum-two.example/']));
    const stop = stops.find(row => row.id === 'website-museum-0');
    assert.ok(stop, 'unsafe or absent URL must not remove the otherwise admitted stop');
    assert.equal(Object.hasOwn(stop, 'website'), false, String(website));
    assert.equal(JSON.stringify(body).includes('user:secret'), false);
    assert.equal(JSON.stringify(body).includes('javascript:alert'), false);
  }
});

test('the public website length bound admits 2048 characters and omits 2049 characters', async t => {
  const longest = `https://museum.example/${'a'.repeat(2025)}`;
  assert.equal(longest.length, 2048);
  const { stops } = await request(t, records([longest, `${longest}a`, 'https://museum-two.example/']));
  assert.equal(stops.find(stop => stop.id === 'website-museum-0')?.website, longest);
  assert.equal(Object.hasOwn(stops.find(stop => stop.id === 'website-museum-1'), 'website'), false);
});

test('public website and candidate fields cannot supply a route-stop website', async t => {
  const { body, stops } = await request(t, records([undefined, undefined, undefined]), {
    website: 'https://public-website-injection.example/',
    sourceCandidates: [{ id: 'website-museum-0', website: 'https://public-website-injection.example/' }],
  });
  for (const stop of stops) assert.equal(Object.hasOwn(stop, 'website'), false);
  assert.equal(JSON.stringify(body).includes('public-website-injection'), false);
});

test('legacy synthesis without source websites keeps its public stop shape free of website fields', async t => {
  const { stops } = await request(t, legacyRecords([undefined, undefined, undefined]), legacyInput);
  for (const stop of stops) assert.equal(Object.hasOwn(stop, 'website'), false);
});

test('real HTTP legacy synthesis preserves a source website through the combination adapter', async t => {
  const { stops } = await request(t, legacyRecords([
    'https://museum-zero.example/visit', 'https://museum-one.example/', 'https://museum-two.example/',
  ]), legacyInput);
  for (const stop of stops) {
    const expected = {
      'website-museum-0': 'https://museum-zero.example/visit',
      'website-museum-1': 'https://museum-one.example/',
      'website-museum-2': 'https://museum-two.example/',
    };
    assert.equal(stop.website, expected[stop.id]);
  }
});
