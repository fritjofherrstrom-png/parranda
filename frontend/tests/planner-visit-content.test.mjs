import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../../server/cities/barcelona/catalog.js';
import { mountPlanner } from './helpers/planner-harness.mjs';
import { buildSavedEntry, LAST_KEY } from '../src/lib/anywhere-storage.mjs';
const DATE = '2026-11-17';
const item = catalog.allItems.find(row => row.id === 'museu-picasso');
const note = catalog.provenanceById[item.id].visit_content;
const routes = h => h.fetchMock.calls.filter(call => call.url.includes('route-recommendations'));
function answer(content = note) {
  return { days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', estimated_km: 1.2, map_path_points: [], legs: [], main_stops: [
      { id: item.id, label: item.name, type: item.kind, lat: item.lat, lng: item.lng, visit_content: content, origin: 'curated_catalog', source: { label: 'catalog' }, covered_preferences: ['culture'] },
      { id: 'garden', label: 'Fixture Garden', type: 'garden', lat: item.lat + .001, lng: item.lng, covered_preferences: ['green'] },
    ],
  }, alternatives: [] }], agnostic_route_output_experiment: { promotion: { promote: true },
    source_status: { anchor: { lat: item.lat, lng: item.lng } } },
    live_events: { selected_date: DATE, coverage: 'covered', pending: false, tonight: [], this_week: [],
      acquisition: { source_health: { status: 'healthy', result: 'empty' } } } };
}
for (const lang of ['sv', 'en']) test(`${lang} source-backed visit content is available after practical facts in its own disclosure`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(DATE + 'T10:00:00Z') });
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Fixture%20Town&lang=${lang}`, props: { lang } });
  t.after(() => h.unmount());
  await h.fetchMock.respond(routes(h)[0], answer());
  const row = [...h.container.querySelectorAll('button[aria-controls]')].find(b => b.textContent.includes(item.name));
  assert.ok(Boolean(row));
  const factualNote = lang === 'sv' ? /Picassos tidiga utveckling/ : /Picasso’s early work/;
  const category = row.querySelector('[data-stop-category]');
  assert.ok(category);
  assert.match(category.className, /\btype-data\b/, 'the kind is a meta fact line');
  assert.doesNotMatch(category.className, /\bbg-parranda-fill\b/, 'not a filled chip');
  assert.doesNotMatch(row.textContent, factualNote);
  await h.act(() => row.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  const panel = h.container.querySelector('#' + row.getAttribute('aria-controls'));
  const details = panel.querySelector('details');
  assert.ok(details);
  assert.equal(details.open, false);
  assert.match(details.querySelector('summary').textContent, lang === 'sv' ? /Mer om platsen/ : /More about this place/);
  assert.match(details.textContent, factualNote);
  assert.match(details.textContent, lang === 'sv' ? /Källa: Parrandas katalog/ : /Source: Parranda’s catalog/);
  assert.match(panel.textContent, lang === 'sv' ? /Öppettider saknas/ : /Opening hours unavailable/);
  const source = [...details.querySelectorAll('a')].find(a => a.getAttribute('href') === note.source_url);
  assert.ok(Boolean(source), 'the specific factual source is inspectable');
  assert.match(source.getAttribute('rel'), /noopener/);
  assert.equal(details.querySelector('time[datetime="2026-11-15"]')?.dateTime, note.checked_on);
  assert.doesNotMatch(panel.textContent, /open now|öppet nu|human.verified|människoverifierad/i);
  assert.equal(routes(h).length, 1, 'reading the note and source does not acquire or recompose');
});

test('the same place content survives a saved-day restore without another plan', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(DATE + 'T10:00:00Z') });
  const stored = buildSavedEntry({ place: 'Fixture Town', dateIso: DATE, savedAt: DATE + 'T10:00:00.000Z',
    safeResponse: answer(), classification: { status: 'composed', hasStructure: false, placeLabel: 'Fixture Town' },
    inputs: { place: 'Fixture Town', mode: 'typed', selected: ['culture', 'green'], walkKey: 'balanced', dayOffset: 0 } });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?restore=last&lang=en', storage: { [LAST_KEY]: stored } });
  t.after(() => h.unmount());
  assert.doesNotMatch(h.text(), /Picasso’s early work/);
  const row = [...h.container.querySelectorAll('button[aria-controls]')].find(b => b.textContent.includes(item.name));
  await h.act(() => row.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  const details = h.container.querySelector('#' + row.getAttribute('aria-controls') + ' details');
  assert.match(details.textContent, /Picasso’s early work/, 'the real saved source text remains available on demand');
  await h.clock.advance(500);
  assert.equal(routes(h).length, 0);
});
