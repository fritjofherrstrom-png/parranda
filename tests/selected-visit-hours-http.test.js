'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildApp } = require('../server/app');
const { createOperatorVisitEnricher } = require('../server/place-candidates/operator-visit-evidence');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { externalRecord, makeLoader } = require('./helpers/planner-reservoir-compare');

const owner = {
  ...externalRecord('selected-seasonal', 'Gustavianum', 'museum', 59.85794448852539, 17.63179588317871, ['museum']),
  website: 'https://www.uu.se/gustavianum',
};
const records = [owner, ...Array.from({ length: 2 }, (_, i) => ({
  ...externalRecord(`selected-known-${i}`, `Other museum ${i}`, 'museum', owner.lat + (i + 1) * .001, owner.lng, ['museum']),
  website: `https://other-museum-${i}.example/`,
}))];
const fixtureDir = path.join(__dirname, 'fixtures/selected-place-visit-hours');
const entry = fs.readFileSync(path.join(fixtureDir, 'gustavianum-entry.html'), 'utf8');
const detail = fs.readFileSync(path.join(fixtureDir, 'gustavianum-hours.html'), 'utf8');
const detailUrl = 'https://www.uu.se/gustavianum/besok-oss/oppettider';
const payload = {
  place: 'Fixture selected visits', dates: ['2026-10-19'], preferences: ['culture'], day_rhythm: 'full',
  start: { type: 'auto' }, end: { type: 'auto' }, home_base: { type: 'auto' },
  distance_mode: 'no_limit', experimental_agnostic_route_output: 1,
  include_external_candidates: 1, agnostic_engine_compose: 1,
};

async function fixture(t, { ownerBody = entry, detailBody = detail } = {}) {
  const requests = [];
  let collections = 0;
  const raw = makeLoader(records);
  const loader = async (...args) => { collections++; return raw(...args); };
  loader.enrich = createOperatorVisitEnricher({
    cache: createSourceCache(), hoursCache: createSourceCache(),
    now: () => Date.parse('2026-10-18T08:00:00Z'),
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    fetcher: async url => {
      requests.push(url);
      let body;
      if (url === owner.website) body = ownerBody;
      else if (url === detailUrl) body = detailBody;
      else {
        const row = records.slice(1).find(value => value.website === url);
        assert.ok(row, 'only an existing selected website or its explicit hours link may be fetched');
        body = `<script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org', '@type': 'Museum', name: row.name, url: row.website,
          geo: { latitude: row.lat, longitude: row.lng }, openingHours: 'Mo-Su 10:00-17:00',
        })}</script>`;
      }
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
    },
  });
  const server = buildApp({
    openDataLoader: loader, weatherProvider: async () => null,
    clock: () => new Date('2026-10-18T08:00:00Z'),
    placeResolver: async () => [{ label: 'Fixture selected visits', lat: owner.lat, lng: owner.lng,
      timezone: 'Europe/Stockholm', confidence: 'high', provenance: 'fixture' }],
  }).listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { requests, get collections() { return collections; }, request: async extra => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/route-recommendations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'respond-async' },
      body: JSON.stringify({ ...payload, ...extra }),
    });
    return { status: response.status, body: await response.json() };
  } };
}

test('real HTTP applies the recorded seasonal Monday closure to the frozen day and broader context', async t => {
  const f = await fixture(t);
  const response = await f.request();
  assert.equal(response.status, 200);
  const day = response.body.days[0];
  assert.equal(day.date, '2026-10-19');
  assert.deepEqual(day.primary_route.main_stops.map(stop => stop.id).sort(), ['selected-known-0', 'selected-known-1']);
  const contextStop = response.body.place_structure.district_day.areas.flatMap(area => area.stops)
    .find(stop => stop.id === owner.id);
  assert.equal(contextStop.selected_day_hours?.status, 'closed');
  assert.equal(contextStop.selected_day_hours.date, '2026-10-19');
  assert.equal(contextStop.selected_day_hours.timezone, 'Europe/Stockholm');
  assert.equal(contextStop.selected_day_hours.source_url, detailUrl);
  assert.equal(response.body.agnostic_route_output_experiment.walking_validation.valid, true);
  assert.equal(f.collections, 1, 'one acquisition supplies the original composition and its hours replay');
  assert.deepEqual(f.requests.filter(url => url.startsWith('https://www.uu.se/')), [owner.website, detailUrl]);
});

test('a seasonal closed day cached for Monday cannot close Tuesday or a Monday in summer', async t => {
  const f = await fixture(t);
  const monday = await f.request();
  assert.equal(monday.body.days[0].primary_route.main_stops.some(stop => stop.id === owner.id), false);
  const tuesday = await f.request({ dates: ['2026-10-20'] });
  assert.equal(tuesday.status, 200);
  assert.equal(tuesday.body.days[0].primary_route.main_stops.some(stop => stop.id === owner.id), true);
  const summerMonday = await f.request({ dates: ['2027-06-21'] });
  assert.equal(summerMonday.status, 200);
  const summerStop = summerMonday.body.days[0].primary_route.main_stops.find(stop => stop.id === owner.id);
  assert.ok(summerStop, 'the winter Monday closure must not leak into another source season');
  assert.notEqual(summerStop.selected_day_hours?.status, 'closed');
});

test('unmatched owner or wrong-service hours preserve the usable day without inventing a schedule', async t => {
  for (const ownerBody of [
    entry.replaceAll('Gustavianum', 'Another institution'),
    entry.replace('<h2>Öppettider</h2>', '<h2>Caféets öppettider</h2>'),
  ]) {
    const f = await fixture(t, { ownerBody });
    const response = await f.request();
    assert.equal(response.status, 200);
    const stop = response.body.days[0].primary_route.main_stops.find(value => value.id === owner.id);
    assert.ok(stop, 'unknown visit facts cannot prohibit an otherwise usable route');
    assert.equal(stop.selected_day_hours, undefined);
    assert.equal(stop.open_now, undefined);
    assert.equal(f.requests.includes(detailUrl), false, 'wrong identity/service cannot initiate a visit-page read');
  }
});
