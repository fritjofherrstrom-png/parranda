'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { buildApp } = require('../server/app');
const { requestJson } = require('./helpers/planner-reservoir-compare');
const barcelona = require('../server/cities/barcelona/catalog');
const { projectPublishedDay } = require('../server/planner/published-day-projection');
const DATE = '2026-11-17';
const ID = 'museu-picasso';

// Genuine bundled catalog, real app/composer/engine/publisher. Resolution and
// clock are controlled; this is not a native provider/geocoding acceptance.
async function day(t) {
  const item = barcelona.allItems.find(row => row.id === ID);
  assert.ok(item && Number.isFinite(item.lat) && Number.isFinite(item.lng));
  const server = buildApp({ openDataLoader: async () => [], sourceCatalog: null, reviewedPlaceSource: null,
    eventSupply: null, weatherProvider: async () => null, placeSuggestions: null,
    clock: () => new Date('2026-11-15T10:00:00Z'),
    placeResolver: async () => [{ label: 'Barcelona, Catalunya', lat: item.lat, lng: item.lng,
      confidence: 'high', provenance: 'controlled_catalog_anchor', timezone: 'Europe/Madrid', osm_class: 'place', osm_ref: 'relation/123456' }],
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const response = await requestJson(server, { path: '/api/route-recommendations?lang=en', body: {
    place: 'Barcelona', dates: [DATE], preferences: ['culture'], day_rhythm: 'balanced', distance_mode: 'no_limit',
    pinned_candidate_ids: [ID], experimental_agnostic_route_output: 1, include_external_candidates: 1, agnostic_engine_compose: 1,
  } });
  assert.equal(response.status, 200);
  assert.equal(response.body.agnostic_route_output_experiment.promotion.promote, true, 'real catalog day must actually publish');
  const stop = response.body.days[0].primary_route.main_stops.find(s => s.id === ID);
  assert.ok(stop, 'the source-bound catalog place reached the actual public route');
  return { published: response.body, stop };
}

test('verified catalog identity supports the specific art intent rather than guessing from its name', () => {
  const { cityConfigs } = require('../server/cities');
  const { buildCuratedCatalogPlaceCandidates } = require('../server/place-candidates/curated-catalog-provider');
  const { matchCandidateToIntent } = require('../server/candidates/intent-vocabulary');
  const candidate = buildCuratedCatalogPlaceCandidates(cityConfigs.barcelona).find(row => row.id === ID);
  assert.equal(matchCandidateToIntent(candidate, 'art_museums').level, 'strong',
    'the source-verified art collection must make specific art selection possible');
  assert.notEqual(matchCandidateToIntent({ ...candidate, place_details: null, label: 'Famous Art Museum' }, 'art_museums').level, 'strong',
    'neither the display name nor a generic museum creates a factual art subtype');
});

test('visit notes stay bound to the exact catalog place and replace untrusted input', () => {
  const { visitContentForStop, hydrateVisitContent } = require('../server/place-candidates/visit-content');
  const item = barcelona.allItems.find(row => row.id === ID);
  const stop = { id: item.id, type: item.kind, lat: item.lat, lng: item.lng };
  const note = visitContentForStop(stop);
  assert.ok(note);
  for (const changed of [{ id: 'synthetic-unapproved-id' }, { type: 'park' }, { is_live_event: true }]) {
    assert.equal(visitContentForStop({ ...stop, ...changed }), null);
  }
  const other = barcelona.allItems.find(row => row.id !== ID && row.lat !== item.lat);
  assert.equal(visitContentForStop({ ...stop, lat: other.lat, lng: other.lng }), null);
  const route = { main_stops: [{ ...stop, visit_content: { source_url: 'https://unapproved.invalid/note' } },
    { ...stop, id: 'synthetic-unapproved-id', visit_content: note }] };
  hydrateVisitContent(route);
  assert.deepEqual(route.main_stops[0].visit_content, note);
  assert.ok(!Object.hasOwn(route.main_stops[1], 'visit_content'));
  note.text.en = 'Changed caller copy';
  assert.notEqual(visitContentForStop(stop).text.en, note.text.en);
});

test('a real catalog visit note reaches final HTTP stops and the exact-day portable result', async t => {
  const { published, stop } = await day(t);
  assert.ok(stop.visit_content, 'the interesting source-backed place content must reach the actual published stop');
  assert.match(stop.visit_content.text.en, /Picasso.*early|early.*Picasso/);
  assert.match(stop.visit_content.text.sv, /Picasso/);
  assert.equal(stop.visit_content.checked_on, '2026-11-15');
  assert.equal(stop.visit_content.source_url, 'https://museupicassobcn.cat/index.php/en/museum/presentation');
  const projection = projectPublishedDay({ published, language: 'en', intent: {
    dateIso: DATE, preferences: ['culture'], preferencePriority: [], dayRhythm: 'balanced',
    excludedCandidateIds: [], pinnedCandidateIds: [ID], liveEventChoices: [], dayEdit: null,
  }, privacy: { explicitCoordinatesPresent: false, customEndpointPresent: false, biasPresent: false,
    contextSelectionPresent: false, selectionPresent: false, requestedPlaceRefPresent: false, publicSourceUrls: new Set() } });
  if (!projection) assert.doesNotThrow(() => require('../server/planner/published-day-fields').budget({ publicSourceUrls: new Set() }).copy('Result', published), 'diagnose the exact closed-publication boundary');
  assert.ok(projection, 'the field must survive real portable publication, not disappear during sharing');
  assert.deepEqual(projection.result.days[0].primary_route.main_stops.find(s => s.id === ID).visit_content, stop.visit_content);
  assert.equal(stop.trust.human_verified, true, 'display content does not mint new trust');
  const { budget } = require('../server/planner/published-day-fields');
  assert.throws(() => budget({ publicSourceUrls: new Set() }).copy('Stop', {
    ...stop, visit_content: { ...stop.visit_content, text: { ...stop.visit_content.text, en: 'Invented content' } },
  }), /correlated Stop/, 'a reviewed page cannot attest changed prose');
  assert.throws(() => budget({ publicSourceUrls: new Set() }).copy('Stop', {
    ...stop, website: stop.visit_content.source_url,
  }), /URL|url/, 'the note policy must not authorize an unrelated website field');
});
