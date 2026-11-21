'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createOpenDataLoader, composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PLACE = { lat: 41.9, lng: 12.5, dayRhythm: 'balanced', anchorMode: 'place' };
const ELEMENTS = [{ type: 'node', id: 301, lat: PLACE.lat, lon: PLACE.lng,
  tags: { name: 'Fixture museum', tourism: 'museum' } }];
const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };
const directory = anchor => Array.from({ length: 15 }, (_, i) => ({
  id: `directory-${i}`, name: `Directory fixture ${i}`, type: ['museum', 'restaurant', 'park'][i % 3],
  lat: anchor.lat + i * 0.0001, lng: anchor.lng,
  sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred' }],
}));

test('an expired first pass is already labelled stale while its wider query remains outstanding', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000_000_000 });
  const request = { ...PLACE, availabilityWindow: { weekday: 6, startMinute: 600, endMinute: 1440 } };
  const queryTexts = [];
  const probe = createOpenDataLoader({ endpoint: 'https://fixture.invalid/overpass', fetcher: async (_url, init) => {
    queryTexts.push(decodeURIComponent(init.body.replace(/^data=/, '')));
    return { ok: true, json: async () => ({ elements: ELEMENTS }) };
  } });
  await probe(request);
  assert.ok(queryTexts.length > 1, 'precondition: this thin first pass really needs expansion');
  // Controlled raw-source fixture only: no selected/granncache entry can hide
  // the progressive path. Capture the query from the real loader, not a guessed key.
  const cache = createSourceCache({ namespace: 'overpass' });
  cache.set(`query-v2:${createHash('sha256').update(queryTexts[0]).digest('hex')}`, { elements: ELEMENTS });
  t.mock.timers.tick(7 * HOUR);
  let calls = 0, releaseBody;
  const osm = createOpenDataLoader({ cache, endpoint: 'https://fixture.invalid/overpass', staleIfErrorMs: 7 * DAY,
    fetcher: async () => {
      calls += 1;
      if (calls === 1) return { ok: true, json: async () => { throw new SyntaxError('controlled malformed JSON'); } };
      return { ok: true, json: () => new Promise(resolve => { releaseBody = resolve; }) };
    } });
  t.after(async () => { if (releaseBody) { releaseBody({ elements: [] }); await flush(); } });
  const composed = composeOpenDataLoaders(osm, null, { eager: true, load: directory }, null,
    { primaryWaitMs: 100, silentGraceMs: 10, silentPauseMs: 1000 });
  let published;
  composed(request).then(value => { published = value; });
  await flush();
  assert.equal(calls, 2, 'precondition: first refresh failed and the wider query actually started');
  assert.equal(typeof releaseBody, 'function', 'precondition: its actual response body is still outstanding');
  t.mock.timers.tick(100);
  await flush();
  assert.ok(published, 'the composition answers at its existing wait bound');
  assert.equal(published.loader_metadata.primary_collection, 'first_pass_while_expanding');
  assert.ok(published.some(row => row.id === 'osm-node-301'), 'the original map row is retained');
  assert.deepEqual(published.loader_metadata.cache, {
    served_stale: true, stale_age_seconds: 3600, refresh_reason: 'parse_error',
  }, 'progressive publication must not launder an expired map answer into fresh evidence');
  const progress = osm.readProgress(PLACE, request);
  assert.equal(progress.loader_error, 'stale_cache_refresh_failed');
  assert.deepEqual(progress.loader_metadata.cache, published.loader_metadata.cache);
});

test('the primary snapshot stays stale while its regional scout remains outstanding', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000_000_000 });
  const primary = { lat: 55.6, lng: 14.15 };
  const request = { ...primary, requestedIntents: ['food', 'views'], anchorMode: 'place', spatialScope: {
    source: 'test_resolver', kind: 'region', bounds: { south: 55.3, north: 55.9, west: 14.0, east: 14.3 },
  } };
  const elements = Array.from({ length: 3 }, (_, i) => ({
    type: 'node', id: 401 + i, lat: primary.lat + i * 0.0001, lon: primary.lng,
    tags: { name: `Regional fixture ${i}`, amenity: 'cafe' },
  }));
  const queries = [];
  const probe = createOpenDataLoader({ endpoint: 'https://fixture.invalid/overpass', fetcher: async (_url, init) => {
    queries.push(decodeURIComponent(init.body.replace(/^data=/, '')));
    return { ok: true, json: async () => ({ elements }) };
  } });
  const reference = await probe(request);
  assert.equal(reference.loader_metadata.regional_scout.attempted, true, 'precondition: the real loader scouts this fixture');
  const scoutQuery = queries.at(-1);
  const primaryQueries = queries.slice(0, -1);
  assert.ok(primaryQueries.length > 0 && !primaryQueries.includes(scoutQuery));
  const cache = createSourceCache({ namespace: 'overpass' });
  for (const query of primaryQueries) cache.set(`query-v2:${createHash('sha256').update(query).digest('hex')}`, { elements });
  t.mock.timers.tick(7 * HOUR);
  let calls = 0, releaseBody;
  const osm = createOpenDataLoader({ cache, endpoint: 'https://fixture.invalid/overpass', staleIfErrorMs: 7 * DAY,
    fetcher: async (_url, init) => {
      calls += 1;
      const query = decodeURIComponent(init.body.replace(/^data=/, ''));
      if (query !== scoutQuery) return { ok: true, json: async () => { throw new SyntaxError('controlled malformed JSON'); } };
      return { ok: true, json: () => new Promise(resolve => { releaseBody = resolve; }) };
    } });
  t.after(async () => { if (releaseBody) { releaseBody({ elements: [] }); await flush(); } });
  const composed = composeOpenDataLoaders(osm, null, { eager: true, load: directory }, null,
    { primaryWaitMs: 100, silentGraceMs: 10, silentPauseMs: 1000 });
  let published;
  composed(request).then(value => { published = value; });
  await flush();
  assert.equal(calls, primaryQueries.length + 1);
  assert.equal(typeof releaseBody, 'function', 'precondition: the scout body is still outstanding');
  const progress = osm.readProgress(primary, request);
  assert.equal(progress.loader_metadata.selection_reason, 'regional_scout_outstanding');
  t.mock.timers.tick(100);
  await flush();
  assert.ok(published?.some(row => row.id === 'osm-node-401'));
  assert.equal(published.loader_metadata.primary_collection, 'first_pass_while_expanding');
  assert.deepEqual(published.loader_metadata.cache, {
    served_stale: true, stale_age_seconds: 3600, refresh_reason: 'parse_error',
  }, 'regional-scout progress must carry the same source-owned stale evidence');
  assert.equal(progress.loader_error, 'stale_cache_refresh_failed');
  assert.deepEqual(progress.loader_metadata.cache, published.loader_metadata.cache);
});
