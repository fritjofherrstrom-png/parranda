'use strict';

// Place identity on screen: offered places read as a short name plus context in
// the reader's language, areas before bare points. Reordering by own name was
// rejected: it fixes "Gamla stan" but puts Lisbon, Iowa before Lisboa (see
// place-ref tests). No live geocoder calls.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');
const { createPlaceSuggestions, mapFeature } = require('../server/place-candidates/place-suggestions');
const { resolveAgnosticIntake } = require('../server/planner/agnostic-place-intake');
const { captures } = require('./fixtures/photon-suggestion-language-20261017.json');
// Enter order and refs recorded from staging 166609c (human-paced, 2026-10-18).
const recorded = require('./fixtures/staging-place-choices-20261018.json');

const json = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });

// Shape of the "Gamla stan" ambiguity seen on staging 166609c (2026-10-17):
// Vyborg's old town matched only through its Swedish name and led by importance.
const COORDS = { 1: ['60.71', '28.74'], 2: ['59.325', '18.071'], 3: ['60.394', '25.663'], 4: ['56.663', '16.364'] };
const row = (id, name, importance, address, extra = {}) => ({
  osm_type: 'relation', osm_id: id, lat: COORDS[id][0], lon: COORDS[id][1], class: 'place', type: 'quarter',
  importance, name,
  display_name: [name, ...Object.values(address)].join(', '),
  address, namedetails: { name, ...extra }, ...extra.row,
});
const GAMLA_STAN = [
  row(1, 'Старый город', 0.52, { suburb: 'Центральный микрорайон', city: 'Выборг', state: 'Ленинградская область', postcode: '188807', country: 'Russia', country_code: 'ru' }, { 'name:sv': 'Gamla stan' }),
  row(2, 'Gamla stan', 0.51, { city: 'Stockholm', county: 'Stockholms län', country: 'Sweden', country_code: 'se' }),
  row(3, 'Vanha Porvoo', 0.50, { city: 'Porvoo', state: 'Uusimaa', country: 'Finland', country_code: 'fi' }, { 'name:sv': 'Gamla stan' }),
  row(4, 'Gamla stan', 0.49, { city: 'Kalmar', county: 'Kalmar län', country: 'Sweden', country_code: 'se' }),
];

test('Enter offers places by short name and context, in the resolver order', async () => {
  const resolver = createNominatimPlaceResolver({
    minIntervalMs: 0, sleep: async () => {}, timeoutMs: 50,
    fetcher: async () => json(GAMLA_STAN),
  });
  const { anchor, intake } = await resolveAgnosticIntake({ placeQuery: 'Gamla stan', placeResolver: resolver, placeLanguage: 'en' });
  assert.equal(anchor, null);
  assert.deepEqual(intake.blockers, ['ambiguous_place']);
  const choices = intake.candidates;
  assert.ok(choices.length >= 2, 'precondition: the recorded shape stays ambiguous');
  assert.deepEqual(choices.map(choice => `${choice.title} | ${choice.context}`), [
    'Старый город | Выборг · Ленинградская область · Russia',
    'Gamla stan | Stockholm · Sweden',
    'Vanha Porvoo | Porvoo · Uusimaa · Finland',
    'Gamla stan | Kalmar · Sweden',
  ]);
  for (const choice of choices) {
    assert.ok(choice.label.includes(choice.title), 'the full provider label still carries identity');
    assert.ok(!/\d{5,}/.test(choice.context), 'no postcode in the visible context');
  }
});

test('a choice without structured context keeps its full label as the visible text', async () => {
  const { intake } = await resolveAgnosticIntake({
    placeQuery: 'Springfield',
    placeResolver: async () => [
      { label: 'Springfield Township, Ohio, United States', name: 'Springfield Township', lat: 41, lng: -81, confidence: 'medium' },
      { label: 'Springfield, Illinois, United States', name: 'Springfield', lat: 39.8, lng: -89.6, confidence: 'medium', admin_context: { region: 'Illinois', country: 'United States' } },
      { label: 'Springfield, Massachusetts, United States', name: 'Springfield', lat: 42.1, lng: -72.5, confidence: 'medium', admin_context: { region: 'Massachusetts', country: 'United States' } },
      { label: 'East Springfield, New York', lat: 42.8, lng: -74.8, confidence: 'medium' },
    ],
  });
  assert.deepEqual(intake.candidates.map(choice => choice.title),
    [undefined, 'Springfield', 'Springfield', undefined]);
  assert.deepEqual(intake.candidates.map(choice => choice.context),
    [undefined, 'Illinois · United States', 'Massachusetts · United States', undefined]);
  assert.equal(intake.candidates[3].label, 'East Springfield, New York', 'no admin context: the full label stays visible');
});

test('suggestion context names the country in the reader language; the query keeps the source name', async () => {
  const suggestions = createPlaceSuggestions({ minIntervalMs: 0, fetcher: async () => json(captures.default.response) });
  const en = await suggestions('Göteborg', { language: 'en' });
  const sv = await suggestions('Göteborg', { language: 'sv' });
  assert.equal(en.choices[0].title, 'Göteborg', 'place names stay source-owned');
  assert.match(en.choices[0].context, /Sweden$/);
  assert.match(sv.choices[0].context, /Sverige$/);
  assert.equal(en.choices[0].query, sv.choices[0].query, 'the receipt query is language-independent');
  assert.match(en.choices[0].query, /Sverige$/);
});

test('an unknown country code or language falls back to the source country name', () => {
  const feature = code => ({ geometry: { type: 'Point', coordinates: [10, 50] }, properties: {
    name: 'Somewhere', type: 'city', osm_type: 'N', osm_id: 1, osm_key: 'place', osm_value: 'town',
    state: 'Region', country: 'Source Country', countrycode: code } });
  assert.match(mapFeature(feature('xx'), 'en').context, /Source Country$/);
  assert.match(mapFeature(feature(''), 'en').context, /Source Country$/);
  assert.match(mapFeature(feature('de'), null).context, /Source Country$/);
  assert.match(mapFeature(feature('de'), 'en').context, /Germany$/);
});

test('recorded staging ambiguities: mapped areas come before bare points, otherwise resolver order', async () => {
  const OSM = { n: 'node', w: 'way', r: 'relation' };
  const expected = {
    'Gamla stan': ['r5695398', 'r6422394', 'n3024933246', 'n10929256189'],
    Lisbon: ['r5400890', 'r129082', 'r181625', 'r183306'],
    Haga: ['r192737', 'r187475', 'r4847039'],
    'Möllevången': ['r3050065', 'r4055466', 'n260205013'],
    Springfield: ['r126326', 'r1181618', 'r141244', 'r182868', 'r186721'],
  };
  assert.equal(recorded.build_sha.slice(0, 7), '166609c');
  for (const { query, intake: recordedIntake } of recorded.cases) {
    const resolved = recordedIntake.candidates.map(({ label, place_ref }, index) => ({
      label, lat: 50 + index, lng: 10 + index, confidence: 'medium', provenance: 'nominatim_osm',
      osm_ref: `${OSM[place_ref[0]]}/${place_ref.slice(1)}`, osm_class: 'place',
    }));
    const { intake } = await resolveAgnosticIntake({ placeQuery: query, placeResolver: async () => resolved });
    assert.deepEqual(intake.blockers, ['ambiguous_place'], query);
    assert.deepEqual(intake.candidates.map(choice => choice.place_ref), expected[query], query);
  }
});
