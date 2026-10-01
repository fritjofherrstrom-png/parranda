"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { buildApp } = require('../server/app');
const { createOperatorVisitEnricher } = require('../server/place-candidates/operator-visit-evidence');
const { composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');
const { createSourceCache } = require('../server/place-candidates/source-cache');

function request(server, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: server.address().port,
      path: '/api/route-recommendations?lang=en', method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Prefer: 'respond-async' },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

test('independently supported operator storefronts reach a focused full day through the reviewed-source bridge', async () => {
  const names = ['Juniper', 'Willow', 'Hazel', 'Rowan'];
  const rows = names.map((name, i) => ({
    id: 'map-' + i, name: name + ' Reuse', type: 'vintage-shop', tags: ['second_hand'],
    lat: 55.6 + i * 0.0007, lng: 13,
    website: `https://${name.toLowerCase()}.example/`,
    source_address: { street: 'Oak Street', house_number: String(i + 1) },
    sources: [{ provider: 'osm', family: 'map', tier: 'inferred', url: `https://www.openstreetmap.org/node/${i + 1}` }],
  }));
  let requests = 0;
  const loader = async () => rows;
  loader.enrich = createOperatorVisitEnricher({
    cache: createSourceCache(),
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    fetcher: async url => {
      requests++;
      const row = rows.find(row => row.website === url);
      return new Response(`<meta property="og:site_name" content="${row.name}"><meta name="description" content="Second hand stores"><main><div>Store Opening hours Monday-Friday 11-19 Saturday 11-17 Sunday 12-16<p>Oak Street ${row.source_address.house_number}</p></div></main>`, { headers: { 'Content-Type': 'text/html' } });
    },
  });
  const server = buildApp({
    openDataLoader: composeOpenDataLoaders(loader, async () => []),
    reviewedPlaceSource: null, eventSupply: null,
    clock: () => new Date('2026-10-01T09:00:00Z'),
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 18, timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
  }).listen(0);
  try {
    const result = await request(server, {
      lat: 55.6, lng: 13, dates: ['2026-10-08'], preferences: ['second_hand'],
      day_rhythm: 'full', distance_mode: 'no_limit', experimental_agnostic_route_output: 1,
      include_external_candidates: 1, agnostic_engine_compose: 1,
    });
    assert.equal(result.status, 200);
    const stops = result.body.days?.[0]?.primary_route?.main_stops || [];
    assert.equal(stops.length, 4, 'Actual current hours and two source families support all four stops without relaxing admission');
    assert.equal(requests, 4);
    assert.ok(stops.every(stop => stop.covered_preferences.includes('second_hand')));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
