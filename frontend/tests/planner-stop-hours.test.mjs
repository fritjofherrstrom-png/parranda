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

for (const lang of ['sv', 'en']) test(`${lang} missing source hours are shown once inside the usable stop disclosure`, async t => {
  const h = await completed(t, lang);
  const route = h.container.querySelector(`section[aria-label="${lang === 'sv' ? 'Rutten' : 'The route'}"]`);
  assert.doesNotMatch(route.textContent, /Öppettider saknas|Opening hours unavailable/,
    'an unexpanded route keeps missing-hours text inside each place');
  const panel = await expandMuseum(h);
  assert.equal(route.textContent.match(lang === 'sv' ? /Öppettider saknas/g : /Opening hours unavailable/g)?.length, 1,
    'opening a place presents its unknown-hours fact once, without a duplicate badge');
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

const conditional = { status: 'unknown', all_day: false, windows: [], ordinary_status: 'known',
  ordinary_windows: [{ opens: '06:30', closes: '18:00' }], uncertainty: 'holiday_exceptions',
  date: DATE, timezone: 'Europe/Stockholm', source_url: 'https://museum.example/visit',
  observed_at: '2026-10-15T10:00:00.000Z' };

for (const lang of ['sv', 'en']) test(`${lang} conditional regular hours stay visibly unconfirmed and keep venue controls`, async t => {
  const h = await completed(t, lang, { website: conditional.source_url, selected_day_hours: conditional });
  const row = [...h.container.querySelectorAll('button[aria-controls]')].find(b => b.textContent.includes('Fixture Museum'));
  const label = lang === 'sv' ? /Ordinarie tider: 06:30–18:00 · Helgdagstider ej bekräftade/ : /Regular hours: 06:30–18:00 · Holiday hours unconfirmed/;
  assert.doesNotMatch(row.textContent, label, 'unconfirmed selected-day hours belong inside the stop disclosure');
  const panel = await expandMuseum(h);
  assert.match(panel.textContent, label);
  assert.doesNotMatch(panel.textContent, /Source hours for selected day|Källans tider för vald dag|Source reports closed|open now|öppet nu/i);
  assert.equal([...panel.querySelectorAll('a')].find(a => /Website|Webbplats/.test(a.textContent))?.getAttribute('href'), conditional.source_url);
  const replace = [...panel.querySelectorAll('button')].find(b => b.textContent.trim() === (lang === 'sv' ? 'Byt' : 'Replace'));
  assert.ok(replace);
  await h.act(() => replace.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  await h.clock.advance(400);
  assert.deepEqual(routes(h).at(-1).body.dates, [DATE]);
  assert.equal(routes(h).at(-1).body.day_edit.candidate_id, 'museum');
});

test('a day of unknown hours waits for a place disclosure and preserves conditional detail', async t => {
  const body = response({ selected_day_hours: conditional });
  body.days[0].primary_route.main_stops[1].type = 'gallery';
  const h2 = await mountPlanner({ url: 'http://localhost/anywhere?place=Fixture%20Town&lang=en' });
  t.after(() => h2.unmount());
  await h2.fetchMock.respond(routes(h2)[0], body);
  const route = h2.container.querySelector('section[aria-label="The route"]');
  assert.doesNotMatch(route.textContent, /Opening hours unavailable|Regular hours:|Holiday hours unconfirmed/);
  const panel = await expandMuseum(h2);
  assert.match(panel.textContent, /Regular hours: 06:30–18:00 · Holiday hours unconfirmed/);
  assert.equal(route.textContent.match(/Regular hours:/g)?.length, 1);
});

for (const lang of ['sv', 'en']) test(`${lang} restoring regular hours retains the unknown fact and saved day without recomposing`, async t => {
  const stored = buildSavedEntry({ place: 'Fixture Town', dateIso: DATE, savedAt: `${DATE}T10:00:00.000Z`,
    safeResponse: response({ selected_day_hours: conditional }),
    classification: { status: 'composed', hasStructure: false, placeLabel: 'Fixture Town' },
    inputs: { place: 'Fixture Town', mode: 'typed', selected: ['culture', 'views'], walkKey: 'balanced', dayOffset: 0 },
  });
  const h = await mountPlanner({ url: `http://localhost/anywhere?restore=last&lang=${lang}`, storage: { [LAST_KEY]: stored } });
  t.after(() => h.unmount());
  const panel = await expandMuseum(h);
  assert.match(panel.textContent, lang === 'sv' ? /Ordinarie tider: 06:30–18:00 · Helgdagstider ej bekräftade/ : /Regular hours: 06:30–18:00 · Holiday hours unconfirmed/);
  const restored = h.readStorage(LAST_KEY);
  assert.deepEqual(restored.safeResponse.days[0].primary_route.main_stops[0].selected_day_hours, conditional);
  assert.deepEqual(restored.inputs.selected, ['culture', 'views']);
  assert.equal(restored.inputs.place, 'Fixture Town');
  assert.equal(restored.dateIso, DATE);
  await h.clock.advance(500);
  assert.equal(routes(h).length, 0);
});

test('known selected-day hours keep their existing detail label', async t => {
  const h = await completed(t, 'en', { selected_day_hours: { status: 'known', all_day: false, windows: [{ opens: '10:00', closes: '17:00' }] } });
  const panel = await expandMuseum(h);
  assert.match(panel.textContent, /Source hours for selected day: 10:00–17:00/);
  assert.doesNotMatch(panel.textContent, /unconfirmed|Opening hours unavailable/);
});

test('an unsafe restored conditional fact falls back to unavailable hours', async t => {
  const stored = buildSavedEntry({ place: 'Fixture Town', dateIso: DATE, savedAt: `${DATE}T10:00:00.000Z`,
    safeResponse: response({ selected_day_hours: { ...conditional, source_url: 'javascript:alert(1)' } }),
    classification: { status: 'composed', hasStructure: false, placeLabel: 'Fixture Town' },
    inputs: { place: 'Fixture Town', mode: 'typed', selected: ['culture', 'views'], walkKey: 'balanced', dayOffset: 0 },
  });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?restore=last&lang=en', storage: { [LAST_KEY]: stored } });
  t.after(() => h.unmount());
  const panel = await expandMuseum(h);
  assert.match(panel.textContent, /Opening hours unavailable for the selected day/);
  assert.doesNotMatch(panel.textContent, /Regular hours|06:30|Source hours|javascript/);
});

for (const lang of ['sv', 'en']) test(`${lang} stop facts and controls stay compact without hiding source evidence`, async t => {
  const h = await completed(t, lang, { website: 'https://museum.example/visit', address: '8 Source Street',
    candidate_status: 'partial', partial_preferences: ['views'] });
  const panel = await expandMuseum(h);
  assert.match(panel.textContent, /8 Source Street/);
  assert.match(panel.textContent, lang === 'sv' ? /Matchar dina val: Kultur/ : /Matches your picks: Culture/);
  assert.match(panel.textContent, lang === 'sv' ? /Lösare träff för: Utsikt/ : /A looser match for: Views/);
  const group = panel.querySelector('[role="group"]');
  assert.ok(group, 'one compact action group owns keep, replace and remove');
  assert.deepEqual([...group.querySelectorAll('button')].map(b => b.textContent.trim()),
    lang === 'sv' ? ['Behåll den här', 'Byt', 'Ta bort'] : ['Keep this one', 'Replace', 'Remove']);
  assert.equal(group.querySelector('a'), null, 'external navigation is separate from day editing');
  for (const link of panel.querySelectorAll('a')) {
    assert.doesNotMatch(link.className, /bg-parranda-terracotta/, 'external links do not dominate the place facts');
  }
  const evidence = panel.querySelector('details');
  assert.ok(evidence, 'source information remains available through a real disclosure');
  assert.equal(evidence.open, false);
  assert.match(evidence.querySelector('summary').textContent, lang === 'sv' ? /Om platsinformationen/ : /About this place information/);
  assert.match(evidence.textContent, /Map source/);
  assert.match(evidence.textContent, lang === 'sv' ? /inte bekräftade ännu/ : /not yet confirmed/);
});

for (const lang of ['sv', 'en']) test(`${lang} selected source details add useful specificity without invented descriptions`, async t => {
  const h = await completed(t, lang, { place_details: { kind: 'art_museum', address: 'Source Street 12' },
    description: 'Unvalidated wonderful hidden gem' });
  const panel = await expandMuseum(h);
  assert.match(panel.textContent, lang === 'sv' ? /Konstmuseum/ : /Art museum/);
  assert.equal(panel.textContent.match(/Source Street 12/g)?.length, 1);
  assert.doesNotMatch(panel.textContent, /Unvalidated|wonderful|hidden gem/);
});
