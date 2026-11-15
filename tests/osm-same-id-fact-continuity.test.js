'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { buildOverpassQuery, composeOpenDataLoaders, createOpenDataLoader } = require('../server/place-candidates/open-data-loader');
const { mapRecordToCandidate } = require('../server/place-candidates/external-open-provider');
const { resolveCandidateIdentity } = require('../server/candidates/entity-resolution');
const { evaluateCandidateEligibility } = require('../server/candidates/candidate-pool');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');

// Deliberately synthetic physical identities, not coordinates or evidence for a
// real city. Only acquisition is controlled; mapper/merge/gates/engine/HTTP
// promotion and final public days are the actual application implementation.
const ANCHOR = { lat: 0, lng: 0 };
const DATE = '2026-11-16';
const NOW = Date.parse('2026-11-15T09:00:00Z');
const REQUEST = { ...ANCHOR, requestedIntents: ['culture'], anchorMode: 'place', dayRhythm: 'calm' };
const ENDPOINT = 'https://fixture.invalid/overpass';
function element(id, lat, name, hours) {
  return { type: 'node', id, lat, lon: 0, tags: { name, tourism: 'museum', opening_hours: hours } };
}
const A = hours => element(704001, 0.001, 'Synthetic Alder Museum', hours);
const B = element(704002, 0.006, 'Synthetic Birch Museum', '24/7');
function directory(elements) {
  return elements.map((row, i) => ({
    id: `zz-directory-${i}`, name: row.tags.name, type: 'museum', lat: row.lat, lng: row.lon,
    tags: ['kultur', 'museum'],
    sources: [{ provider: 'synthetic-independent-directory', family: 'open_directory', tier: 'inferred',
      url: `https://directory.example.invalid/${row.id}` }],
  }));
}
function setup({ freshHours = 'off', oldHours = '24/7', addB = true, warm = true, widerObservedAt = null, cacheDir = null } = {}) {
  let clock = NOW;
  const calls = [];
  const cache = createSourceCache({ namespace: 'h4-synthetic', dir: cacheDir, ttlMs: 6000, now: () => clock });
  const query = buildOverpassQuery({ ...ANCHOR, radiusM: 1500, limit: 150, focusedIntents: ['culture'] });
  const seeds = warm ? [{ query, at: NOW, elements: [A(oldHours)] }] : [];
  if (Number.isFinite(widerObservedAt)) seeds.push({
    query: buildOverpassQuery({ ...ANCHOR, radiusM: 5000, limit: 150, focusedIntents: ['culture'] }),
    at: widerObservedAt, elements: [A(freshHours), ...(addB ? [B] : [])],
  });
  for (const seed of seeds.sort((a, b) => a.at - b.at)) {
    clock = seed.at;
    cache.set(`query-v2:${createHash('sha256').update(seed.query).digest('hex')}`,
      { elements: seed.elements, observedAt: seed.at });
  }
  clock = NOW + 1000;
  const osm = createOpenDataLoader({ cache, now: () => clock, staleIfErrorMs: 0, endpoint: ENDPOINT,
    fetcher: async (endpoint, options) => {
      const asked = decodeURIComponent(options.body.replace(/^data=/, ''));
      calls.push({ endpoint, radius: Number(asked.match(/around:(\d+)/)?.[1]) });
      assert.equal(endpoint, ENDPOINT);
      assert.ok(calls.length <= (warm ? 1 : 2), 'no extra acquisition lane');
      assert.equal(calls[0].radius, warm ? 5000 : 1500, 'narrow raw cache actually answered the first pass');
      return { ok: true, status: 200, json: async () => ({ elements: [A(freshHours), ...(addB ? [B] : [])] }) };
    } });
  let acquired;
  const composed = composeOpenDataLoaders(osm, null, { eager: true, load: async () => directory([A(oldHours), ...(addB ? [B] : [])]) });
  const loader = async request => { acquired = await composed(request); return acquired; };
  return { osm, loader, calls, cache, acquired: () => acquired, clock: () => clock };
}
function mergedCandidate(rows, id) {
  const candidates = rows.map(row => mapRecordToCandidate({ key: 'agnostic' }, row, DATE, 0));
  return resolveCandidateIdentity(candidates, { now: DATE }).candidates
    .find(row => row.id === id || row.merged_from?.some(part => part.id === id));
}
async function publish(t, options) {
  const h = setup(options);
  const server = buildApp({ openDataLoader: h.loader, sourceCatalog: null, reviewedPlaceSource: null,
    eventSupply: null, weatherProvider: async () => null, clock: () => new Date(h.clock()),
    placeResolver: async query => [{ label: query, ...ANCHOR, confidence: 'high', provenance: 'synthetic_resolver', timezone: 'UTC' }],
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const response = await requestJson(server, { path: '/api/route-recommendations?lang=en', body: {
    place: 'Synthetic fixture area', dates: [DATE], preferences: ['culture'], day_rhythm: 'calm',
    distance_mode: 'no_limit', start: { type: 'auto' }, end: { type: 'auto' }, home_base: { type: 'auto' },
    experimental_agnostic_route_output: 1, include_external_candidates: 1, agnostic_engine_compose: 1,
  } });
  assert.equal(response.status, 200);
  const experiment = response.body.agnostic_route_output_experiment;
  const stops = response.body.days?.[0]?.primary_route?.main_stops || [];
  const rows = h.acquired();
  const a = mergedCandidate(rows, 'osm-node-704001');
  assert.ok(a?.merged_from?.some(row => row.id === 'zz-directory-0'), 'actual independent directory identity merges');
  const { gates } = evaluateCandidateEligibility(a, { now: DATE });
  t.diagnostic(JSON.stringify({ calls: h.calls, loader: rows.loader_metadata,
    a: { id: a.id, hours: a.opening_hours, operational: a.operational_status, reasons: a.operational_reasons,
      families: a.sources?.map(s => s.family), may_influence_routes: gates.may_influence_routes },
    route_mutation: experiment.route_mutation, promotion: experiment.promotion,
    blockers: experiment.blockers, public_ids: stops.map(s => s.id) }));
  return { ...h, response, experiment, stops, rows, a };
}

test('positive control: independently corroborated all-open synthetic OSM identities reach the real HTTP day', async t => {
  const { experiment, stops } = await publish(t, { freshHours: '24/7' });
  assert.equal(experiment.route_mutation, true);
  assert.equal(experiment.promotion.promote, true);
  assert.deepEqual(stops.map(s => s.id).sort(), ['osm-node-704001', 'osm-node-704002']);
});

test('a completed fresh wider same-ID closure cannot publish the older cached open venue', async t => {
  const { stops, calls } = await publish(t, {});
  assert.deepEqual(calls.map(c => c.radius), [5000]);
  assert.equal(stops.some(s => s.id === 'osm-node-704001'), false,
    'completed same-ID off fact must survive loader selection and independent corroboration into the actual public day');
});

test('a same-ID correction survives even when the wider answer adds no richer supply', async () => {
  const h = setup({ addB: false });
  const rows = await h.osm(REQUEST);
  assert.equal(rows.loader_metadata.selection_reason, 'wider_supply_not_richer');
  assert.equal(rows.find(r => r.id === 'osm-node-704001').opening_hours, 'off');
  assert.equal(rows.find(r => r.id === 'osm-node-704001').operational_status, 'inactive');
  assert.deepEqual(h.calls.map(c => c.radius), [5000]);
});

test('an older cached wider closure cannot overwrite a newer narrow open observation', async () => {
  const h = setup({ widerObservedAt: NOW - 1000 });
  const rows = await h.osm(REQUEST);
  assert.equal(rows.find(r => r.id === 'osm-node-704001').opening_hours, '24/7');
  assert.equal(rows.find(r => r.id === 'osm-node-704001').operational_status, 'source_indicated_active');
  assert.equal(h.calls.length, 0, 'both raw answers reused without restamping their original observation');
});

test('a newer cached wider closure supersedes the older narrow open observation without another fetch', async () => {
  const h = setup({ widerObservedAt: NOW + 500 });
  const rows = await h.osm(REQUEST);
  assert.equal(rows.find(r => r.id === 'osm-node-704001').opening_hours, 'off');
  assert.equal(h.calls.length, 0);
});

test('equal source observation times do not use input order to erase an explicit closure', async () => {
  for (const [oldHours, freshHours] of [['24/7', 'off'], ['off', '24/7']]) {
    const h = setup({ oldHours, freshHours, widerObservedAt: NOW });
    const rows = await h.osm(REQUEST);
    assert.equal(rows.find(r => r.id === 'osm-node-704001').opening_hours, 'off');
    assert.equal(h.calls.length, 0);
  }
});

test('a newly acquired reopening is not held closed by the older cached same-ID row', async t => {
  const { experiment, stops } = await publish(t, { oldHours: 'off', freshHours: '24/7' });
  assert.equal(experiment.route_mutation, true);
  assert.equal(experiment.promotion.promote, true);
  assert.deepEqual(stops.map(s => s.id).sort(), ['osm-node-704001', 'osm-node-704002']);
});

test('raw observation order survives disk/restart and reselection without renewing either answer', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h4-facts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = setup({ cacheDir: dir });
  await h.osm(REQUEST);
  const before = fs.readdirSync(path.join(dir, 'h4-synthetic')).filter(name => name.startsWith('query-v2_'))
    .map(name => [name, fs.readFileSync(path.join(dir, 'h4-synthetic', name), 'utf8')]);
  assert.equal(before.length, 2, 'the actual old narrow and freshly acquired wider raw answers were persisted');
  const cache = createSourceCache({ namespace: 'h4-synthetic', dir, ttlMs: 6000, now: h.clock });
  const restarted = createOpenDataLoader({ cache, now: h.clock, endpoint: ENDPOINT,
    fetcher: () => assert.fail('restart/reselection must not acquire again') });
  const rows = await restarted({ ...REQUEST, availabilityWindow: { weekday: 0, startMinute: 0, endMinute: 1440 } });
  assert.equal(rows.find(r => r.id === 'osm-node-704001').opening_hours, 'off');
  for (const [name, original] of before) assert.equal(fs.readFileSync(path.join(dir, 'h4-synthetic', name), 'utf8'), original,
    'original local observation, raw facts and expiry stay byte-identical');
});

test('direct-closed control: independent directory corroboration cannot reopen an inactive OSM venue', async t => {
  const { stops } = await publish(t, { warm: false });
  assert.equal(stops.some(s => s.id === 'osm-node-704001'), false);
});
