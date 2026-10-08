const test = require('node:test');
const assert = require('node:assert/strict');
const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { mapRecordToCandidate } = require('../server/place-candidates/external-open-provider');
const { resolveCandidateIdentity, matchIdentity } = require('../server/candidates/entity-resolution');
const { buildApp } = require('../server/app');
const { requestJson, mockStableWeatherFetch } = require('./helpers/planner-reservoir-compare');

// Minimal public OSM snapshot, fetched 2026-10-08. The operator confirms that
// these are two exhibition buildings: https://www.uu.se/evolutionsmuseet/kontakt
// This is offline source replay, not real-provider/runtime acceptance.
const observed = [
  { type: 'node', id: 719696838, lat: 59.8501782, lon: 17.6262391,
    tags: { name: 'Evolutionsmuseet Zoologi', tourism: 'museum', wikidata: 'Q10492852',
      'addr:street': 'Villavägen', 'addr:housenumber': '9',
      website: 'https://www.evolutionsmuseet.uu.se/', opening_hours: 'Mo off; Tu-Su 12:00-16:00' } },
  { type: 'node', id: 719696844, lat: 59.8492511, lon: 17.6220804,
    tags: { name: 'Evolutionsmuseet Paleontologi', tourism: 'museum', wikidata: 'Q10492852',
      'addr:street': 'Norbyvägen', 'addr:housenumber': '22',
      website: 'https://www.evolutionsmuseet.uu.se/', opening_hours: 'Mo off; Tu-Su 12:00-16:00' } },
  { type: 'node', id: 413649352, lat: 59.859478, lon: 17.6318367,
    tags: { name: 'Ofvandahls', amenity: 'cafe', wikidata: 'Q10607913',
      website: 'https://www.ofvandahls.se/', opening_hours: 'Mo-Fr 07:30-18:00; Sa-Su 09:00-18:00' } },
];
const map = records => records.map((record, i) =>
  mapRecordToCandidate({ key: 'visit-address-fixture' }, record, '2026-10-08T14:00:00Z', i));
const permutations = items => items.length ? items.flatMap((item, i) =>
  permutations(items.filter((_, j) => i !== j)).map(rest => [item, ...rest])) : [[]];

test('a shared institution id cannot collapse observed separate exhibition addresses', () => {
  const sites = map(observed.slice(0, 2).map(mapOsmElement));
  for (const input of permutations(sites)) {
    assert.equal(matchIdentity(...input).same, false);
    const resolved = resolveCandidateIdentity(input);
    assert.equal(resolved.candidates.length, 2);
    assert.equal(resolved.summary.merged_count, 0);
    assert.deepEqual(new Set(resolved.candidates.map(c => c.id)),
      new Set(['osm-node-719696838', 'osm-node-719696844']));
  }
});

function branches() {
  return ['West', 'East'].map((branch, i) => ({
    id: branch, label: `Juniper ${branch}`, type: 'museum', wikidata: 'Q11',
    lat: 46 + i * .001, lng: 8,
    source_address: { street: 'Oak Street', house_number: String(i + 1) },
    evidence: [{ claim_type: 'existence', value: true,
      source_ref: { provider_id: 'osm', source_family: 'map', url: `https://www.openstreetmap.org/node/${i + 1}` } }],
  }));
}

test('addressless institution rows cannot bridge distinct sites or lend them official evidence in any order', () => {
  const umbrella = { id: '00-institution', label: 'Juniper Museum', type: 'museum',
    wikidata: 'Q11', lat: 46, lng: 8,
    evidence: [{ claim_type: 'existence', value: true,
      source_ref: { provider_id: 'official', source_family: 'official', url: 'https://museum.example/institution' } }],
  };
  const twin = { ...umbrella, id: 'zz-institution' };
  for (const input of permutations([...branches(), umbrella, twin])) {
    const context = input.map(c => c.id).join(',');
    const resolved = resolveCandidateIdentity(input);
    assert.equal(resolved.candidates.length, 3, context);
    for (const branch of resolved.candidates.filter(c => c.source_address)) {
      assert.ok(!branch.evidence.some(e => e.source_ref.source_family === 'official'), context);
      assert.equal(branch.merged_from, undefined, context);
    }
  }
});

test('identical nearby names with conflicting full addresses remain separate without a shared id', () => {
  const [west, east] = branches().map(c => ({ ...c, label: 'Juniper Museum', wikidata: undefined }));
  east.lat = west.lat + .00001;
  assert.equal(resolveCandidateIdentity([west, east]).candidates.length, 2);
});

test('a richer canonical twin preserves its site address before the shared institution id reaches another branch', () => {
  const sites = branches().map(c => ({ ...c, evidence: [...c.evidence,
    { claim_type: 'existence', value: true,
      source_ref: { provider_id: 'wikidata', source_family: 'open_knowledge', url: 'https://www.wikidata.org/wiki/Q11' } }],
  }));
  const official = { id: '00-official-west', label: 'Juniper West', type: 'museum', lat: 46, lng: 8,
    evidence: ['existence', 'name', 'category'].map(claim_type => ({ claim_type, value: true,
      source_ref: { provider_id: 'official', source_family: 'official', url: 'https://museum.example/west' } })),
  };
  for (const input of permutations([sites[0], official, sites[1]])) {
    const context = input.map(c => c.id).join(',');
    const resolved = resolveCandidateIdentity(input);
    assert.equal(resolved.candidates.length, 2, context);
    const west = resolved.candidates.find(c => c.label === 'Juniper West');
    assert.deepEqual(west.source_address, { street: 'Oak Street', house_number: '1' }, context);
    assert.ok(!resolved.candidates.find(c => c.label === 'Juniper East').evidence
      .some(e => e.source_ref.source_family === 'official'), context);
  }
});

test('matching normalized full addresses retain hard-id corroboration across different names', () => {
  const [a, b] = branches();
  b.source_address = { street: '  OAK   STREET ', house_number: ' 1 ' };
  assert.equal(resolveCandidateIdentity([a, b]).candidates.length, 1);
});

test('unknown or malformed addresses do not invent a site conflict', () => {
  const [a, b] = branches();
  for (const address of [undefined, { street: 'Oak Street' },
    { street: '', house_number: '2' }, { street: 'Bad\nStreet', house_number: '2' }]) {
    assert.equal(matchIdentity(a, { ...b, source_address: address }).same, true);
  }
});

test('the real Planner retains both observed museum choices in a three-stop focused day', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: async () => observed.map(mapOsmElement),
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 16,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
    clock: () => new Date('2026-10-08T12:00:00Z'),
  }).listen(0);
  try {
    const { buildAnywherePayload } = await import('../frontend/src/lib/anywhere-payload.mjs');
    const body = buildAnywherePayload({ coords: { lat: 59.8586126, lng: 17.6387436 },
      dates: ['2026-10-09'], preferences: ['fika', 'culture'], dayRhythm: 'full' });
    const response = await requestJson(server, { path: '/api/route-recommendations?lang=sv', body });
    assert.equal(response.status, 200);
    const stops = response.body.days[0]?.primary_route?.main_stops || [];
    assert.deepEqual(new Set(stops.map(s => s.id)),
      new Set(['osm-node-719696838', 'osm-node-719696844', 'osm-node-413649352']));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    global.fetch = originalFetch;
  }
});
