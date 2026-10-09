import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mountPlanner } from './helpers/planner-harness.mjs';

const require = createRequire(import.meta.url);
const { resolveAgnosticIntake } = require('../../server/planner/agnostic-place-intake.js');
const { createPlaceSelectionStore } = require('../../server/place-candidates/place-selection.js');

const LAST = 'parranda:anywhere:last';
const calls = h => h.fetchMock.calls.filter(c => c.url.startsWith('/api/route-recommendations'));
const button = (h, text) => [...h.container.querySelectorAll('button')].find(b => b.textContent.includes(text));
const click = (h, element) => h.act(() => element.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true })));
const day = (label = 'Previous place', ref = 'r100', receipt = 'previous-receipt') => ({
  days: [{ date: '2026-10-09', experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', main_stops: [
      { id: 'a', label: 'Place a', lat: 41.9, lng: 12.49, type: 'museum' },
      { id: 'b', label: 'Place b', lat: 41.901, lng: 12.49, type: 'restaurant' },
    ], estimated_km: 1.2, legs: [], map_route_points: [], map_path_points: [], confidence: 'low',
  }, alternatives: [] }],
  agnostic_route_output_experiment: { intake: { status: 'resolved', resolved: {
    label, lat: 41.9, lng: 12.49, place_ref: ref, selection_id: receipt,
  } }, promotion: { promote: true, readiness: 'promotable' } },
});
const failure = (kind, candidates = []) => ({ days: [], agnostic_route_output_experiment: {
  intake: { status: 'unresolved', resolved: null, blockers: [kind], candidates }, source_status: { status: 'no_anchor' },
} });
async function previousDay() {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Previous&lang=en' });
  try {
    await h.clock.advance(500); await h.fetchMock.respond(calls(h)[0], day()); await h.clock.advance(50);
    const saved = h.readStorage(LAST); assert.equal(saved.classification.status, 'composed'); return saved;
  } finally { await h.unmount(); }
}
const copyCases = [
  ['place_ref_not_found', /reference could not be found/i, /platsreferensen kunde inte hittas/i, /right now|later|just nu|senare/],
  ['place_ref_unavailable', /could not be checked right now/i, /kunde inte kontrolleras just nu/i, /could not be found|kunde inte hittas/],
  ['place_ref_unsupported', /geographic type.*not supported/i, /geografisk identitet.*inte stöds/i, /spelling|stavning/],
  ['place_ref_conflict', /conflicts.*place choices/i, /platsval.*inte överens/i, /spelling|stavning/],
];
for (const [kind, en, sv, misleading] of copyCases) for (const lang of ['en', 'sv']) {
  test(`${kind} in ${lang} explains the reference failure without borrowing a saved or unverified name`, async () => {
    const saved = await previousDay();
    for (const storage of [{}, { [LAST]: saved }]) for (const display of ['', '&place=Unverified']) {
      const h = await mountPlanner({ url: `http://localhost/anywhere?place_ref=r999&lang=${lang}${display}`, props: { lang }, storage });
      try {
        const status = h.container.querySelector('p[role="status"].sr-only');
        await h.clock.advance(500); await h.fetchMock.respond(calls(h)[0], failure(kind)); await h.clock.advance(50);
        assert.equal(h.container.querySelector('p[role="status"].sr-only'), status, 'the mounted status survives');
        assert.match(status.textContent, lang === 'en' ? en : sv);
        assert.doesNotMatch(status.textContent, misleading);
        assert.doesNotMatch(status.textContent, /Previous|Unverified|r999|place_ref_|“”|””|spelling|stavning/);
        assert.equal(h.container.querySelector('h1').textContent, lang === 'en' ? 'Your day' : 'Din dag');
        assert.deepEqual(h.readStorage(LAST), storage[LAST] ?? null);
        assert.doesNotMatch(h.text(), /Saved day|Sparad dag/);
        assert.equal(calls(h).length, 1, 'no automatic replacement compose');
      } finally { await h.unmount(); }
    }
  });
}

test('missing exact ref offers explicit replacements without exposing geolocation narrowing', async () => {
  const saved = await previousDay();
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Unverified&place_ref=r999&lang=en', storage: { [LAST]: saved } });
  let mounted = true;
  try {
    h.document.addEventListener('click', event => event.preventDefault());
    let locationCalls = 0;
    Object.defineProperty(h.window.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition() { locationCalls++; } } });
    await h.clock.advance(500);
    const address = h.window.location.search;
    const status = h.container.querySelector('p[role="status"].sr-only');
    await h.fetchMock.respond(calls(h)[0], failure('place_ref_not_found', [{ label: 'Chosen replacement', selection_id: 'replacement-receipt', place_ref: 'r200' }]));
    await h.clock.advance(50);
    assert.equal(Boolean(button(h, 'Use my location')), false, 'ref replacements must not offer narrowing');
    assert.equal(locationCalls, 0);
    assert.equal(status.textContent, '', 'choices retain their own status');
    assert.ok([...h.container.querySelectorAll('[role="status"]')].some(n => n.textContent === 'Which place do you mean?'));
    assert.equal(h.window.location.search, address);
    assert.deepEqual(h.readStorage(LAST), saved);
    assert.equal(calls(h).length, 1);

    await click(h, button(h, 'Chosen replacement'));
    const chosen = calls(h)[1];
    assert.equal(chosen.body.place_ref, 'r200');
    assert.equal(chosen.body.place_selection, 'replacement-receipt');
    await h.fetchMock.respond(chosen, day('Chosen replacement', 'r200', 'replacement-receipt')); await h.clock.advance(50);
    const stored = h.readStorage(LAST);
    assert.equal(stored.inputs.placeLabel, 'Chosen replacement');
    assert.equal(stored.inputs.placeRef, 'r200');
    assert.equal(stored.inputs.placeSelection, 'replacement-receipt');
    const addressAfter = new URLSearchParams(h.window.location.search);
    assert.equal(addressAfter.get('place_ref'), 'r200');
    assert.equal(addressAfter.get('place'), 'Chosen replacement');
    const copied = [];
    Object.defineProperty(h.window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => copied.push(text) } });
    await click(h, [...h.container.querySelectorAll('button')].find(b => /^Share/.test(b.getAttribute('aria-label') || b.textContent)));
    await h.clock.advance(10);
    assert.equal(new URL(copied[0]).searchParams.get('place_ref'), 'r200');
    const reloadUrl = `http://localhost/anywhere${h.window.location.search}`;
    await h.unmount();
    mounted = false;
    const again = await mountPlanner({ url: reloadUrl });
    try { await again.clock.advance(500); assert.equal(calls(again)[0].body.place_ref, 'r200'); assert.equal(calls(again)[0].body.place_selection, undefined); }
    finally { await again.unmount(); }
  } finally { if (mounted) await h.unmount(); }
});

test('explicit venue replacement without a durable ref keeps its real server receipt valid', async t => {
  const store = createPlaceSelectionStore({ secret: Buffer.alloc(32, 7) });
  const venue = { label: 'Harbour Museum, City, Country', lat: 51.5, lng: 2.32, confidence: 'medium', osm_ref: 'way/200', osm_class: 'tourism' };
  const resolver = Object.assign(async () => [venue], { lookupRef: async () => ({ status: 'not_found' }) });
  const missing = await resolveAgnosticIntake({ placeQuery: 'Harbour', placeRef: 'r999', placeResolver: resolver, placeSelectionStore: store });
  assert.equal(missing.intake.candidates[0].place_ref, undefined);
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Harbour&place_ref=r999&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(calls(h)[0], { days: [], agnostic_route_output_experiment: { intake: missing.intake } });
  await h.clock.advance(50);
  assert.equal(calls(h).length, 1, 'no replacement until explicit choice');
  await click(h, button(h, venue.label));
  const chosen = calls(h)[1];
  assert.equal(chosen.body.place_ref, undefined, 'old ref is removed only on choice');
  const resolved = await resolveAgnosticIntake({ placeQuery: chosen.body.place_query, placeRef: chosen.body.place_ref, placeSelection: chosen.body.place_selection, placeResolver: resolver, placeSelectionStore: store });
  assert.deepEqual(resolved.anchor, { lat: venue.lat, lng: venue.lng }, 'offered receipt validates against its query');
  assert.equal(resolved.intake.resolved.label, venue.label);
  const response = day(venue.label, undefined, chosen.body.place_selection);
  response.agnostic_route_output_experiment.intake = resolved.intake;
  await h.fetchMock.respond(chosen, response); await h.clock.advance(50);
  const stored = h.readStorage(LAST);
  assert.equal(stored.inputs.place, 'Harbour', 'receipt-bound query is kept');
  assert.equal(stored.inputs.placeLabel, venue.label);
  assert.equal(stored.inputs.placeRef, null);
  assert.equal(stored.inputs.placeSelection, chosen.body.place_selection);
  assert.equal(new URLSearchParams(h.window.location.search).get('place_ref'), null);
  await click(h, button(h, 'Adjust')); await click(h, button(h, 'Tomorrow')); await h.clock.advance(500);
  const adjusted = calls(h).at(-1).body;
  const afterAdjust = await resolveAgnosticIntake({ placeQuery: adjusted.place_query, placeSelection: adjusted.place_selection, placeResolver: resolver, placeSelectionStore: store });
  assert.deepEqual(afterAdjust.anchor, resolved.anchor, 'later adjustments retain the offered venue');
});
