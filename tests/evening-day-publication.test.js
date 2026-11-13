'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { buildApp } = require('../server/app');
const { externalRecord, makeLoader, requestJson } = require('./helpers/planner-reservoir-compare');
const { projectPublishedDay } = require('../server/planner/published-day-projection');

// HOLD review on #683, 13 Nov 2026: the evening plan names which picks' hours
// tonight are unconfirmed, but the public day projection dropped that list
// while keeping its caveat, so a shared or restored day said "some of your
// picks" and named none. The list is the engine's own, correlated with the
// caveat, the anchoring, the reader's picks and the stops that serve them.
const DATE = '2026-10-01';
const base = { lat: 55.6, lng: 13.0 };
const EVENING = '2026-10-01T18:30:00Z'; // 20:30 in Stockholm
const PREFERENCES = ['food', 'culture', 'views'];

const place = (id, type, tags, i) =>
  externalRecord(id, `Source ${id}`, type, base.lat + i * 0.0012, base.lng + (i % 2) * 0.0008, tags);
const records = () => [
  place('museum', 'museum', ['museum'], 0), place('gallery', 'gallery', ['gallery'], 1),
  place('restaurant', 'restaurant', ['restaurant'], 2), place('bistro', 'restaurant', ['restaurant'], 3),
  place('lookout', 'viewpoint', ['viewpoint'], 4), place('statue', 'monument', ['monument'], 5),
];
const intent = () => ({ dateIso: DATE, preferences: [...PREFERENCES], preferencePriority: [], dayRhythm: 'balanced',
  excludedCandidateIds: [], pinnedCandidateIds: [], liveEventChoices: [], dayEdit: null });
const privacy = () => ({ explicitCoordinatesPresent: false, customEndpointPresent: false, biasPresent: false,
  contextSelectionPresent: false, selectionPresent: false, requestedPlaceRefPresent: false,
  publicSourceUrls: new Set(records().flatMap(row => row.sources.map(source => source.url))) });

async function publication() {
  const server = buildApp({
    openDataLoader: makeLoader(records()), weatherProvider: async () => null, clock: () => new Date(EVENING),
    placeResolver: async () => [{ label: 'Fixture place', ...base, confidence: 'high', provenance: 'test_resolver',
      timezone: 'Europe/Stockholm', osm_class: 'place', osm_ref: 'relation/123456' }],
    placeSuggestions: null, reviewedPlaceSource: null, sourceCatalog: null, eventSupply: null,
    placeSelectionStore: { issue: () => null }, publishedDayStore: { read: async () => null },
  }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const response = await requestJson(server, { path: '/api/route-recommendations?lang=sv&experimental_agnostic_route_output=1&agnostic_engine_compose=1',
      body: { place: 'Fixture place', dates: [DATE], preferences: PREFERENCES, day_rhythm: 'balanced',
        include_external_candidates: 1 } });
    assert.equal(response.status, 200);
    return response.body;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
const route = published => published.days[0].primary_route;
const project = published => projectPublishedDay({ published, intent: intent(), privacy: privacy(), language: 'sv' });

test('the named unconfirmed evening picks survive projection, JSON, the recipient parser and a saved restore', async () => {
  const published = await publication();
  assert.deepEqual(route(published).unconfirmed_tonight_preferences, ['museums'], 'producer precondition');
  assert.ok(route(published).caveats.includes('picks_unconfirmed_tonight'));
  const projected = project(published);
  assert.ok(projected, 'the evening plan still shares');
  assert.deepEqual(route(projected.result).unconfirmed_tonight_preferences, ['museums']);
  const { parsePublishedDay } = await import('../frontend/src/lib/published-day.mjs');
  const { routeUnconfirmedTonightPicks } = await import('../frontend/src/lib/route-context-view.mjs');
  const now = Date.parse(EVENING), ref = 'c'.repeat(48);
  const envelope = JSON.parse(JSON.stringify({ version: 1, ref, created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60000).toISOString(), ...projected }));
  const parsed = parsePublishedDay(envelope, { ref, decision: require('../anywhere-render-decision'), now });
  assert.ok(parsed, 'the actual recipient accepts the envelope');
  const restored = JSON.parse(JSON.stringify(parsed.entry));
  assert.deepEqual(routeUnconfirmedTonightPicks(route(published)), ['culture']);
  assert.deepEqual(routeUnconfirmedTonightPicks(route(restored.safeResponse)), ['culture'],
    'a shared and restored day names the same pick as the live day');
});

test('an older shared day without the list stays readable and names no pick', async () => {
  const published = await publication();
  const projected = project(published);
  assert.ok(projected);
  delete route(projected.result).unconfirmed_tonight_preferences;
  const { parsePublishedDay } = await import('../frontend/src/lib/published-day.mjs');
  const { routeUnconfirmedTonightPicks } = await import('../frontend/src/lib/route-context-view.mjs');
  const now = Date.parse(EVENING), ref = 'd'.repeat(48);
  const parsed = parsePublishedDay({ version: 1, ref, created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60000).toISOString(), ...projected }, { ref, decision: require('../anywhere-render-decision'), now });
  assert.ok(parsed, 'records published before the field remain readable');
  assert.deepEqual(routeUnconfirmedTonightPicks(route(parsed.entry.safeResponse)), []);
});

test('the list is refused unless it is the engine\'s correlated, canonical evening fact', async () => {
  const cases = {
    'caveat without the list': r => { delete r.unconfirmed_tonight_preferences; },
    'list without the caveat': r => { r.caveats = r.caveats.filter(c => c !== 'picks_unconfirmed_tonight'); },
    'list without anchoring': r => { r.anchored_to_local_time = false; },
    'list without the anchored caveat': r => { r.caveats = r.caveats.filter(c => c !== 'day_anchored_to_current_time'); },
    'unknown token': r => { r.unconfirmed_tonight_preferences = ['opera']; },
    'empty list': r => { r.unconfirmed_tonight_preferences = []; },
    'duplicate': r => { r.unconfirmed_tonight_preferences = ['museums', 'museums']; },
    'unsorted': r => { r.unconfirmed_tonight_preferences = ['scenic', 'museums']; },
    'a pick the reader did not choose': r => { r.unconfirmed_tonight_preferences = ['bars']; },
    'a pick no stop serves': r => { r.unconfirmed_tonight_preferences = ['museums', 'second_hand']; },
    'not a list': r => { r.unconfirmed_tonight_preferences = 'museums'; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const published = await publication();
    mutate(route(published));
    assert.equal(project(published), null, name);
  }
});
