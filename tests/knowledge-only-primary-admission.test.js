'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { composeAgnosticRouteOutput, admitExperimentalInferredExternalCandidate } = require('../server/planner/agnostic-route-output');
const { mapWikidataResponse } = require('../server/place-candidates/wikidata-source');
const { mapRecordToCandidate } = require('../server/place-candidates/external-open-provider');
const { externalRecord } = require('./helpers/planner-reservoir-compare');
const historical = require('./fixtures/wikidata-historical-visit-records.json');

async function compose(rows, pins = []) {
  const output = await composeAgnosticRouteOutput({
    coords: { lat: 51.5074456, lng: -.1277653 }, baselineResult: { days: [] }, externalRequested: true,
    openDataLoader: async () => structuredClone(rows), date: '2026-10-16', todayIsoDate: '2026-10-15',
    trustedTimezone: 'Europe/London', timezone: 'Europe/London', clock: () => new Date('2026-10-15T08:00:00Z'),
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false }),
    synthesizeVia: 'engine', distanceMode: 'no_limit', dayRhythm: 'full', preferences: ['culture'], pinnedStopIds: pins,
  });
  return output.result.days[0]?.primary_route?.main_stops || [];
}

test('real source records for defunct visits cannot become automatic or pinned stops through knowledge-only admission', async () => {
  const records = mapWikidataResponse(historical, 25);
  assert.equal(records.length, 2);
  assert.ok(records.every(row => row.sources[0].family === 'open_knowledge'));
  assert.ok(records.every(row => !row.operational_status), 'real records lack whole-entity dissolution despite the visits no longer existing');
  const candidate = mapRecordToCandidate({ key: 'fixture' }, records[0], '2026-10-15', 0);
  const admission = admitExperimentalInferredExternalCandidate({ candidate, derived: { provenance_diversity: 1 } });
  for (const pins of [[], records.map(row => row.id)]) {
    assert.deepEqual(await compose(records, pins), []);
  }
  assert.equal(admission.allowed, false, 'an encyclopedia entry and coordinates are not current visit evidence');
});

test('the knowledge boundary is generic, and duplicate knowledge providers or a website seed cannot manufacture corroboration', async () => {
  const records = mapWikidataResponse(historical, 25).map((row,i) => ({ ...row, id: `renamed-${i}`, name: `Collection ${i}`,
    sources: [...row.sources, { provider: 'encyclopedia-copy', family: 'open_knowledge', tier: 'inferred', url: 'https://encyclopedia.example/entry' }],
    website: 'https://operator.example/' }));
  assert.deepEqual(await compose(records, records.map(row => row.id)), []);
});

test('popularity and sentiment are not independent place evidence, even for pinned historical records', async () => {
  for (const signal of [{ popularity: { count: 1 } }, { popularity: { rating: 5 } }, { consensus: { count: 10, rating: 5 } }]) {
    const records = mapWikidataResponse(historical, 25).map(row => ({ ...row, ...signal }));
    for (const pins of [[], records.map(row => row.id)]) {
      assert.deepEqual(await compose(records, pins), [], JSON.stringify(signal));
    }
  }
});

test('unclassified and non-place source families cannot manufacture place corroboration through the ordinary gates', async () => {
  for (const family of [undefined, '', 'unclassified', 'computed', 'environmental']) {
    const records = mapWikidataResponse(historical, 25).map(row => ({ ...row,
      sources: [...row.sources, { ...row.sources[0], provider: 'encyclopedia-copy', family }],
    }));
    const candidate = mapRecordToCandidate({ key: 'fixture' }, records[0], '2026-10-15', 0);
    assert.ok(candidate.evidence.every(item => item.source_ref.source_family === 'open_knowledge'));
    assert.deepEqual(await compose(records, records.map(row => row.id)), []);
    assert.equal(mapRecordToCandidate({ key: 'fixture' }, { ...records[0], sources: records[0].sources.slice(1) }, '2026-10-15', 0), null,
      'a record with no classified source must not fall back to synthesized official/map evidence');
  }
});

test('single-family map/directory depth and real independent corroboration remain available', async () => {
  for (const family of ['map','open_directory','corroborated']) {
    const records = Array.from({length:8}, (_,i) => {
      const r = externalRecord(`current-${i}`,`Current museum ${i}`,'museum',51.507+i*.001,-.127);
      if (family === 'map') r.sources = r.sources.slice(0,1);
      if (family === 'open_directory') r.sources = [{ provider:'overture',family:'open_directory',tier:'inferred',url:'https://docs.overturemaps.org/guides/places/' }];
      return r;
    });
    const stops = await compose(records);
    assert.equal(stops.length,6,family);
    assert.ok(stops.every(stop=>stop.type==='museum'));
  }
});
