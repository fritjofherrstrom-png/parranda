'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWikidataSource, buildWikidataQuery, mapWikidataBinding } = require('../server/place-candidates/wikidata-source');
const { resolveDefaultOpenDataLoader, mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { mapRecordToCandidate } = require('../server/place-candidates/external-open-provider');
const { resolveCandidateIdentity } = require('../server/candidates/entity-resolution');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');

const anchor = { lat: 55.6, lng: 13 };
const boolean = value => ({ type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#boolean', value });
function binding(index, ceased) {
  return {
    item: { value: `http://www.wikidata.org/entity/Q${1000 + index}` },
    itemLabel: { value: index === 0 ? 'Former collection' : `Collection ${index}` },
    lat: { value: String(anchor.lat + index * .001) }, lng: { value: String(anchor.lng) },
    classRoot: { value: 'http://www.wikidata.org/entity/Q33506' },
    ...(ceased === undefined ? {} : { ceased: boolean(ceased) }),
  };
}
const response = bindings => ({ ok: true, json: async () => ({ results: { bindings } }) });

test('Wikidata queries elapsed, best-rank Gregorian dissolution with explicit precision in the same bounded request', () => {
  const query = buildWikidataQuery({ ...anchor, radiusKm: 1.5, limit: 25, labelLangs: ['en'] });
  assert.match(query, /SELECT[^\n]*\?ceased/);
  assert.match(query, /p:P576/);
  assert.match(query, /wikibase:BestRank/);
  assert.match(query, /wikibase:timePrecision/);
  assert.match(query, /wikibase:timeCalendarModel wd:Q1985727/);
  assert.match(query, /NOW\(\)/);
  assert.match(query, /MONTH\(/);
  assert.match(query, /DAY\(/);
  assert.match(query, /AS \?ceased/);
  assert.match(query, /LIMIT 25/);
});

test('only a source-owned true cessation marker vetoes; false, missing or malformed facts do not invent active status', () => {
  for (const value of ['true', '1']) {
    const record = mapWikidataBinding(binding(0, value));
    assert.equal(record.operational_status, 'inactive');
    assert.deepEqual(record.operational_reasons, ['wikidata_dissolved']);
    assert.equal(record.human_verified, false);
    assert.equal(record.sources[0].tier, 'inferred');
  }
  for (const ceased of [undefined, boolean('false'), boolean('0'), boolean('yes'),
    { type: 'literal', value: 'true' }, { type: 'uri', value: 'true' }]) {
    const raw = binding(0); if (ceased) raw.ceased = ceased;
    const record = mapWikidataBinding(raw);
    assert.equal(record.operational_status, undefined);
    assert.equal(record.operational_reasons, undefined);
    assert.equal(record.opening_hours, undefined);
  }
});

test('real Wikidata source -> identity -> automatic rhythm never revives a ceased place, even with corroboration or an explicit pin', async () => {
  const source = createWikidataSource({ fetcher: async () => response([
    binding(0, 'true'), ...Array.from({ length: 7 }, (_, i) => binding(i + 1, 'false')),
  ]) });
  const rows = await source(anchor);
  const duplicate = mapOsmElement({ type: 'node', id: 1, lat: anchor.lat, lon: anchor.lng,
    tags: { name: 'Former collection', tourism: 'museum', website: 'https://collection.example/' } });
  // Knowledge-only records are not current visit evidence. Corroborate the
  // usable controls with independent map rows; closure must still veto the
  // same two-family shape for the former collection, even when pinned.
  const currentMapRows = rows.slice(1).map((row, i) => mapOsmElement({ type: 'node', id: i + 2,
    lat: row.lat, lon: row.lng, tags: { name: row.name, tourism: 'museum' } }));
  const candidates = [duplicate, rows[0]].map((record, i) => mapRecordToCandidate({ key: 'fixture' }, record, '2026-10-15T08:00:00Z', i));
  for (const ordered of [candidates, [...candidates].reverse()]) {
    const merged = resolveCandidateIdentity(ordered, { now: '2026-10-15T08:00:00Z' });
    assert.equal(merged.candidates.length, 1);
    assert.equal(merged.candidates[0].operational_status, 'inactive', 'positive second-family/website cannot erase dissolution');
    assert.ok(merged.candidates[0].operational_reasons.includes('wikidata_dissolved'));
  }
  const counts = [];
  for (const dayRhythm of ['calm', 'balanced', 'full']) {
    const output = await composeAgnosticRouteOutput({
      coords: anchor, baselineResult: { days: [] }, externalRequested: true,
      openDataLoader: async () => structuredClone([duplicate, ...rows, ...currentMapRows]),
      date: '2026-10-22', todayIsoDate: '2026-10-15', trustedTimezone: 'Europe/Stockholm', timezone: 'Europe/Stockholm',
      clock: () => new Date('2026-10-15T08:00:00Z'),
      weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false }),
      synthesizeVia: 'engine', distanceMode: 'no_limit', dayRhythm, preferences: ['culture'],
      pinnedStopIds: [rows[0].id, duplicate.id],
    });
    const route = output.result.days[0]?.primary_route;
    const stops = route?.main_stops || [];
    assert.ok(stops.every(stop => (stop.label || stop.name) !== 'Former collection' && stop.id !== rows[0].id && stop.id !== duplicate.id));
    assert.ok(stops.every(stop => stop.type === 'museum' && stop.provisional === true));
    assert.equal(route.trust_summary.human_verified, false);
    counts.push(stops.length);
  }
  assert.deepEqual(counts, [4, 5, 6], 'remaining source-backed fixture records, not a known-closed stop, supply the requested density');
});

test('normal loader never reuses legacy Wikidata rows stripped of lifecycle facts, including on provider failure', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-wiki-lifecycle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = '55.600,13.000';
  const old = createSourceCache({ namespace: 'wikidata', dir });
  old.set(key, [mapWikidataBinding(binding(0))]);
  const oldFile = path.join(dir, 'wikidata', '55.600_13.000.json');
  const before = fs.readFileSync(oldFile, 'utf8');
  let wikiCalls = 0;
  let healthy = false;
  t.mock.method(global, 'fetch', async url => {
    if (String(url).includes('wikidata.org')) { wikiCalls++; return healthy ? response([binding(0, 'true')]) : { ok: false, status: 503 }; }
    return { ok: true, json: async () => ({ elements: [] }) };
  });
  const env = { PARRANDA_OPEN_DATA_LOADER: 'enabled', PARRANDA_WIKIDATA_SOURCE: 'enabled', PARRANDA_CACHE_DIR: dir };
  const failed = await resolveDefaultOpenDataLoader(env)(anchor);
  assert.equal(failed.some(row => row.id === 'wikidata-Q1000'), false, 'provider failure cannot fall back to the old stripped row');
  assert.equal(wikiCalls, 1);
  healthy = true;
  const refreshedLoader = resolveDefaultOpenDataLoader(env);
  await refreshedLoader(anchor);
  await new Promise(resolve => setImmediate(resolve));
  const fresh = await refreshedLoader(anchor);
  assert.equal(fresh.find(row => row.id === 'wikidata-Q1000')?.operational_status, 'inactive');
  const callsAfterWarm = wikiCalls;
  const cached = await resolveDefaultOpenDataLoader(env)(anchor);
  assert.equal(cached.find(row => row.id === 'wikidata-Q1000')?.operational_status, 'inactive');
  assert.equal(wikiCalls, callsAfterWarm, 'new namespace preserves the negative fact on disk across loader instances');
  assert.equal(fs.readFileSync(oldFile, 'utf8'), before, 'legacy cache is preserved, never deleted or rewritten');
});
