const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');
const { resolveAgnosticIntake } = require('../server/planner/agnostic-place-intake');

// Controlled provider-shaped records, not observations of a live provider pair.
function city(id, name, namedetails, importance, lat = 50.85, lon = 4.35) {
  return {
    name, namedetails, display_name: `${name}, Fixture region ${id}`,
    lat: String(lat), lon: String(lon), importance,
    osm_type: 'relation', osm_id: id, category: 'boundary', type: 'administrative', addresstype: 'city',
    address: { city: name, state: `Fixture region ${id}` },
    boundingbox: [lat - .02, lat + .02, lon - .02, lon + .02].map(String),
  };
}

async function intake(query, rows, language = 'en') {
  return resolveAgnosticIntake({
    placeQuery: query, placeLanguage: language,
    placeResolver: createNominatimPlaceResolver({ minIntervalMs: 0,
      fetcher: async () => ({ ok: true, status: 200, json: async () => structuredClone(rows) }) }),
  });
}

test('each source-attested component of a bilingual primary name keeps its identity in every UI language', async () => {
  const primary = city(101, 'Brussel', {
    name: 'Bruxelles - Brussel', 'name:fr': 'Bruxelles', 'name:nl': 'Brussel', 'name:en': 'Brussels',
  }, .85);
  for (const query of ['Brussel', 'Bruxelles']) {
    const rival = city(102, query, { name: query }, .42, 51.5, 7.3);
    for (const language of ['nl', 'fr', 'en', 'sv']) {
      for (const rows of [[primary, rival], [rival, primary]]) {
        const result = await intake(query, rows, language);
        assert.deepEqual(result.anchor, { lat: 50.85, lng: 4.35 }, `${query}/${language}`);
        assert.deepEqual(result.intake.blockers, []);
      }
    }
  }
});

test('primary name components require exact source attestation, never a substring or invented word split', async () => {
  const primary = city(103, 'Norddal-Syddal', { name: 'Norddal-Syddal', 'name:sv': 'Syddal' }, .85);
  const rival = city(104, 'Syddal', { name: 'Syddal' }, .42, 51.5, 7.3);
  const result = await intake('Syddal', [primary, rival], 'sv');
  assert.equal(result.anchor, null, 'a lexical hyphen does not establish two local names');
  assert.deepEqual(result.intake.blockers, ['ambiguous_place']);
});

test('no translation language receives automatic precedence over a competing primary-name identity', async () => {
  for (const language of ['en', 'sv', 'fr', 'de']) {
    const translated = city(105, 'Shared', { name: 'Primärort', [`name:${language}`]: 'Shared' }, .85);
    const rival = city(106, 'Shared', { name: 'Shared' }, .42, 51.5, 7.3);
    const result = await intake('Shared', [translated, rival], language);
    assert.equal(result.anchor, null, `${language} cannot be inferred to be a local name`);
    assert.deepEqual(result.intake.blockers, ['ambiguous_place']);
  }
});

test('multiple translated identities stay ambiguous even when neither has the typed primary name', async () => {
  const leader = city(111, 'Shared', { name: 'Primärort', 'name:fr': 'Shared' }, .85);
  const rival = city(112, 'Shared', { name: 'Annan ort', 'name:en': 'Shared' }, .42, 51.5, 7.3);
  const result = await intake('Shared', [leader, rival], 'en');
  assert.equal(result.anchor, null);
  assert.deepEqual(result.intake.blockers, ['ambiguous_place']);
});

test('qualified translated names and a unique translated identity remain usable', async () => {
  const translated = city(107, 'Shared', { name: 'Primärort', 'name:en': 'Shared' }, .85);
  const rival = city(108, 'Shared', { name: 'Shared' }, .42, 51.5, 7.3);
  for (const [query, rows] of [
    ['Shared, Fixture region 107', [translated, rival]],
    ['Shared', [translated]],
  ]) {
    const result = await intake(query, rows);
    assert.deepEqual(result.anchor, { lat: 50.85, lng: 4.35 });
    assert.deepEqual(result.intake.blockers, []);
  }
});

test('a source-confirmed primary name plus administrative qualifier works with or without a comma', async () => {
  const rows = [
    city(115, 'Nordstad', { name: 'Nordstad' }, .85),
    city(116, 'Nordstad', { name: 'Nordstad' }, .42, 51.5, 7.3),
  ].map(row => ({ ...row, address: { ...row.address, country: 'Fixtureland' } }));
  for (const query of ['Nordstad Fixtureland', 'Nordstad, Fixtureland']) {
    const result = await intake(query, rows);
    assert.deepEqual(result.anchor, { lat: 50.85, lng: 4.35 }, `${query} contains a corroborated local name`);
  }
  const wrong = await intake('Nordstad, Elsewhere', rows);
  assert.equal(wrong.anchor, null, 'an explicit uncorroborated qualifier is never dropped');
});

test('bilingual separators never create a match missing from the provider name variants', async () => {
  const primary = city(109, 'Nordstad / Sydstad', { name: 'Nordstad / Sydstad' }, .85);
  const rival = city(110, 'Sydstad', { name: 'Sydstad' }, .42, 51.5, 7.3);
  const result = await intake('Sydstad', [primary, rival], 'en');
  assert.deepEqual(result.anchor, { lat: 51.5, lng: 7.3 }, 'only the exact named identity is eligible');
});

test('previous language-biased cache verdict cannot answer the corrected primary-name policy', async t => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'parranda-primary-name-cache-'));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  const endpoint = 'https://nominatim.openstreetmap.org/search';
  const endpointId = createHash('sha256').update(`${endpoint}|limit:5`).digest('hex').slice(0, 16);
  const queryId = createHash('sha256').update(JSON.stringify(['brussel', 'nl', null, 'place'])).digest('hex');
  const previous = createSourceCache({ namespace: 'place-resolver-nominatim-v6', dir: cacheDir });
  await previous.get(`v6:${endpointId}:${queryId}`, async () => ({ ok: true, candidates: [
    { label: 'Old ambiguous verdict', lat: 50.85, lng: 4.35, confidence: 'low' },
  ] }));
  const rows = [
    city(113, 'Brussel', { name: 'Bruxelles - Brussel', 'name:nl': 'Brussel' }, .85),
    city(114, 'Brussel', { name: 'Brussel' }, .42, 51.5, 7.3),
  ];
  let reads = 0;
  const options = { cacheDir, minIntervalMs: 0, fetcher: async () => {
    reads += 1;
    return { ok: true, status: 200, json: async () => rows };
  } };
  const resolver = createNominatimPlaceResolver(options);
  const corrected = await resolver('Brussel', { language: 'nl' });
  assert.equal(reads, 1, 'the old decision is not reused');
  assert.deepEqual(corrected.map(row => row.confidence), ['medium', 'low']);
  const restarted = createNominatimPlaceResolver({ ...options, fetcher: async () => { throw new Error('unexpected provider read'); } });
  assert.deepEqual(await restarted('Brussel', { language: 'nl' }), corrected, 'the corrected decision survives restart');
});
