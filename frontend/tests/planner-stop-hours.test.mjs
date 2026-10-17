/** Mounted Planner evidence presentation; controlled transport, no provider requests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';
import { buildSavedEntry, LAST_KEY } from '../src/lib/anywhere-storage.mjs';

const DATE = '2026-10-16';
const routes = h => h.fetchMock.calls.filter(call => call.url.includes('route-recommendations'));
const museum = { id: 'museum', label: 'Fixture Museum', type: 'museum', lat: 59.333, lng: 18.065,
  commitment_eligible: true, covered_preferences: ['culture'],
  source: { label: 'Map source', url: 'https://www.openstreetmap.org/node/42' } };
const park = { id: 'park', label: 'Fixture Park', type: 'park', lat: 59.334, lng: 18.066,
  commitment_eligible: true, covered_preferences: ['views'] };
function response(extra = {}) {
  return { days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', title: 'Fixture day', main_stops: [{ ...museum, ...extra }, park],
    estimated_km: 1, map_path_points: [], legs: [],
  }, alternatives: [] }], agnostic_route_output_experiment: {
    promotion: { promote: true }, source_status: { anchor: { lat: 59.3326, lng: 18.0649 } },
  }, live_events: { coverage: 'covered', selected_date: DATE, pending: false, tonight: [], this_week: [],
    acquisition: { source_health: { status: 'healthy', result: 'empty' } } } };
}
async function completed(t, lang, extra) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-16T10:00:00Z') });
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Fixture%20Town&lang=${lang}` });
  t.after(() => h.unmount());
  await h.fetchMock.respond(routes(h)[0], response(extra));
  return h;
}
async function expandMuseum(h) {
  const row = [...h.container.querySelectorAll('button[aria-controls]')]
    .find(button => button.textContent.includes('Fixture Museum'));
  assert.ok(row, 'the unknown-hours place remains on the published route');
  await h.act(() => row.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  return h.container.querySelector(`#${row.getAttribute('aria-controls')}`);
}

for (const lang of ['sv', 'en']) test(`${lang} missing source hours are visible before expanding a usable stop`, async t => {
  const h = await completed(t, lang);
  const route = h.container.querySelector(`section[aria-label="${lang === 'sv' ? 'Rutten' : 'The route'}"]`);
  assert.match(route.textContent, lang === 'sv' ? /Öppettider saknas/ : /Opening hours unavailable/);
  const panel = await expandMuseum(h);
  assert.equal([...panel.querySelectorAll('a')].filter(a => /Website|Webbplats/.test(a.textContent)).length, 0,
    'an absent website does not turn source attribution into a website action');
});

for (const lang of ['sv', 'en']) test(`${lang} unknown hours retain the place, website and existing replacement action`, async t => {
  const website = 'https://museum.example/visit';
  const h = await completed(t, lang, { website });
  assert.equal([...h.container.querySelectorAll('a')].filter(a => a.getAttribute('href') === website).length, 0,
    'the website stays inside the deliberate stop disclosure');
  const panel = await expandMuseum(h);
  const link = [...panel.querySelectorAll('a')].find(a => a.textContent.includes(lang === 'sv' ? 'Webbplats' : 'Website'));
  assert.ok(link, 'the venue website is a deliberate action inside the existing detail panel');
  assert.equal(link.getAttribute('href'), website);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel'), /noopener/);
  assert.match(link.getAttribute('rel'), /noreferrer/);
  assert.doesNotMatch(panel.textContent, /official|officiell|open now|öppet nu/i);
  const replace = [...panel.querySelectorAll('button')].find(b => b.textContent.trim() === (lang === 'sv' ? 'Byt' : 'Replace'));
  assert.ok(replace, 'unknown hours do not remove the existing replacement action');
  await h.act(() => replace.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  await h.clock.advance(400);
  const edit = routes(h).at(-1).body;
  assert.equal(routes(h).length, 2, 'one replacement emits one compose');
  assert.equal(edit.day_edit.action, 'replace');
  assert.equal(edit.day_edit.candidate_id, 'museum');
  assert.deepEqual(edit.dates, [DATE], 'the selected day is retained');
});

test('unsafe or absent website never becomes an attribution link in the stop panel', async t => {
  const h = await completed(t, 'en', { website: 'https://user:secret@museum.example/' });
  const panel = await expandMuseum(h);
  assert.equal([...panel.querySelectorAll('a')].filter(a => /Website/.test(a.textContent)).length, 0);
  assert.equal([...panel.querySelectorAll('a')].filter(a => /openstreetmap\.org/.test(a.getAttribute('href'))).length, 0);
});

for (const lang of ['sv', 'en']) test(`${lang} restored source-closed day stays visible and never reads as unknown hours`, async t => {
  const stored = buildSavedEntry({ place: 'Fixture Town', dateIso: DATE, savedAt: `${DATE}T10:00:00.000Z`,
    safeResponse: response({ selected_day_hours: { status: 'closed', all_day: false, windows: [] } }),
    classification: { status: 'composed', hasStructure: false, placeLabel: 'Fixture Town' },
    inputs: { place: 'Fixture Town', mode: 'typed', selected: ['culture', 'views'], walkKey: 'balanced', dayOffset: 0 },
  });
  const h = await mountPlanner({ url: `http://localhost/anywhere?restore=last&lang=${lang}`, storage: { [LAST_KEY]: stored } });
  t.after(() => h.unmount());
  assert.match(h.container.querySelector(`section[aria-label="${lang === 'sv' ? 'Rutten' : 'The route'}"]`).textContent,
    lang === 'sv' ? /Källan anger stängt för vald dag/ : /Source reports closed for selected day/,
    'the saved closed-day fact is visible before expanding the stop');
  const panel = await expandMuseum(h);
  assert.match(panel.textContent, lang === 'sv' ? /Källan anger stängt för vald dag/ : /Source reports closed for selected day/);
  assert.doesNotMatch(panel.textContent, /Hours unknown|Opening hours unavailable|Öppettider (?:okända|saknas)|Källtider saknas/);
  await h.clock.advance(500);
  assert.equal(routes(h).length, 0, 'presenting the saved fact does not recompose or block the saved day');
});
