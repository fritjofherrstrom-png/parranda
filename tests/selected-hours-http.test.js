const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/app');
const { createOperatorVisitEnricher } = require('../server/place-candidates/operator-visit-evidence');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { externalRecord, makeLoader } = require('./helpers/planner-reservoir-compare');

const records = Array.from({ length: 3 }, (_, i) => ({
  ...externalRecord(`selected-${i}`, `Selected museum ${i}`, 'museum', 55.6 + i * .001, 13, ['museum']),
  website: `https://museum-${i}.example/`,
}));
function page(record, hours) {
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org',
    '@type': 'Museum', name: record.name, url: record.website,
    geo: { '@type': 'GeoCoordinates', latitude: record.lat, longitude: record.lng }, openingHours: hours,
  })}</script>`;
}
const payload = {
  place: 'Fixture place', dates: ['2026-10-18'], preferences: ['culture'], day_rhythm: 'full',
  start: { type: 'auto' }, end: { type: 'auto' }, home_base: { type: 'auto' },
  distance_mode: 'no_limit', experimental_agnostic_route_output: 1,
  include_external_candidates: 1, agnostic_engine_compose: 1,
};

async function fixture(t, { closed = false, failed = false } = {}) {
  const requests = [];
  let collections = 0;
  const raw = makeLoader(records);
  const loader = async (...args) => { collections++; return raw(...args); };
  loader.enrich = createOperatorVisitEnricher({
    cache: createSourceCache(), hoursCache: createSourceCache(),
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    fetcher: async url => {
      requests.push(url);
      const row = records.find(r => r.website === url);
      assert.ok(row, 'only the trusted selected record may choose a URL');
      return new Response(failed ? 'Unavailable' : page(row, closed && row.id === 'selected-0' ? 'Mo-Su off' : 'Mo-Su 10:00-17:00'),
        { status: failed ? 503 : 200, headers: { 'Content-Type': 'text/html' } });
    },
  });
  const server = buildApp({ openDataLoader: loader, weatherProvider: async () => null,
    clock: () => new Date('2026-10-17T10:00:00Z'),
    placeResolver: async () => [{ label: 'Fixture place', lat: 55.6, lng: 13, timezone: 'Europe/Stockholm', confidence: 'high', provenance: 'fixture' }],
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

test('real HTTP enriches only the selected source identities and publishes their selected-day facts without reacquiring supply', async t => {
  const f = await fixture(t);
  const response = await f.request({ website: 'https://attacker.example/', opening_hours: '24/7' });
  assert.equal(response.status, 200);
  const route = response.body.days[0].primary_route;
  assert.equal(route.main_stops.length, 3);
  for (const stop of route.main_stops) {
    assert.deepEqual(stop.selected_day_hours?.windows, [{ opens: '10:00', closes: '17:00' }], stop.id);
    assert.equal(stop.selected_day_hours?.all_day, false);
    assert.equal(stop.open_now, undefined);
    assert.equal(stop.website, records.find(r => r.id === stop.id).website);
    assert.equal(stop.selected_day_hours?.date, '2026-10-18');
    assert.equal(stop.selected_day_hours?.timezone, 'Europe/Stockholm');
    assert.equal(stop.selected_day_hours?.source_url, stop.website);
    assert.match(stop.selected_day_hours?.observed_at || '', /^\d{4}-\d{2}-\d{2}T/);
  }
  assert.equal(f.requests.length, 3);
  assert.equal(new Set(f.requests).size, 3);
  assert.equal(f.collections, 1, 'one frozen acquisition snapshot serves both compositions');
  assert.equal(response.body.agnostic_route_output_experiment.walking_validation.valid, true);
});

test('newly observed explicit closure is applied before publication through the normal gates', async t => {
  const f = await fixture(t, { closed: true });
  const response = await f.request();
  assert.equal(response.status, 200);
  const stops = response.body.days[0].primary_route.main_stops;
  assert.equal(stops.some(stop => stop.id === 'selected-0'), false);
  assert.equal(stops.length, 2, 'the source-closed stop cannot survive to fill intensity');
  assert.ok(stops.every(stop => stop.selected_day_hours?.status === 'known'));
  assert.equal(f.collections, 1);
  assert.equal(f.requests.length, 3, 'recomposition cannot restart website checks');
});

test('failed selected-hour checks retain the usable day with no invented source hours and no retry', async t => {
  const f = await fixture(t, { failed: true });
  const response = await f.request();
  const stops = response.body.days[0].primary_route.main_stops;
  assert.equal(stops.length, 3);
  assert.ok(stops.every(stop => stop.selected_day_hours === undefined && stop.open_now === undefined));
  assert.equal(f.requests.length, 3);
  assert.equal(f.collections, 1);
});

test('excluded identities cannot trigger selected-website reads or reappear during hours replay', async t => {
  const f = await fixture(t);
  const response = await f.request({ excluded_candidate_ids: ['selected-0'] });
  const stops = response.body.days[0].primary_route.main_stops;
  assert.deepEqual(stops.map(s => s.id).sort(), ['selected-1', 'selected-2']);
  assert.deepEqual(f.requests.sort(), ['https://museum-1.example/', 'https://museum-2.example/']);
  assert.ok(stops.every(s => s.selected_day_hours?.status === 'known'));
});

test('a new selected date reuses only weekly source evidence and rebuilds the date-bound published fact', async t => {
  const f = await fixture(t);
  const first = await f.request();
  const second = await f.request({ dates: ['2026-10-19'] });
  assert.equal(second.status, 200);
  const stops = second.body.days[0].primary_route.main_stops;
  assert.equal(stops.length, 3);
  for (const stop of stops) {
    assert.equal(stop.selected_day_hours.date, '2026-10-19');
    assert.equal(stop.selected_day_hours.timezone, 'Europe/Stockholm');
    assert.equal(stop.selected_day_hours.observed_at,
      first.body.days[0].primary_route.main_stops.find(old => old.id === stop.id).selected_day_hours.observed_at);
  }
  assert.equal(f.requests.length, 3, 'fresh weekly evidence does not trigger another provider acquisition');
  assert.equal(f.collections, 2, 'each user intent still owns its own frozen supply snapshot');
});
