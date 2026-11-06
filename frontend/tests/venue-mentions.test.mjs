import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mountPlanner } from './helpers/planner-harness.mjs';
const require = createRequire(import.meta.url);
const { reviewedVenueMentionsForPlace } = require('../../server/place-candidates/venue-mentions');
const DATE = '2026-11-06';
const place = { id: 'roscioli-salumeria', city: 'rome', label: 'Roscioli Salumeria con Cucina',
  lat: 41.894501, lng: 12.473962, type: 'restaurant', source: { kind: 'city_catalog', id: 'rome-catalog' } };
const mentions = reviewedVenueMentionsForPlace(place);
function response(rows = mentions) {
  return { days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', main_stops: [
      { ...place, commitment_eligible: true, covered_preferences: ['food'], website: 'https://www.roscioli.com/salumeria',
        source: { label: 'Catalog source' }, provenance: { venue_mentions: structuredClone(rows) } },
      { id: 'fixture-park', label: 'Fixture Park', type: 'park', lat: 41.895, lng: 12.474,
        commitment_eligible: true, covered_preferences: ['views'] },
    ], estimated_km: 1, map_path_points: [], legs: [],
  }, alternatives: [] }], agnostic_route_output_experiment: { promotion: { promote: true },
    source_status: { anchor: { lat: place.lat, lng: place.lng } } },
    live_events: { coverage: 'covered', selected_date: DATE, pending: false, tonight: [], this_week: [],
      acquisition: { source_health: { status: 'healthy', result: 'empty' } } } };
}
const routeCalls = h => h.fetchMock.calls.filter(call => call.url.includes('route-recommendations'));
async function expand(h) {
  const control = [...h.container.querySelectorAll('button[aria-controls]')].find(button => button.textContent.includes(place.label));
  assert.ok(control, 'the real venue is on the controlled Planner result');
  await h.act(() => control.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  return h.container.querySelector(`#${control.getAttribute('aria-controls')}`);
}

for (const lang of ['sv', 'en']) test(`${lang} the ordinary stop disclosure renders reviewed articles separately from venue/source facts`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${DATE}T10:00:00Z`) });
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Roma&lang=${lang}` });
  t.after(() => h.unmount());
  await h.fetchMock.respond(routeCalls(h)[0], response());
  const panel = await expand(h);
  assert.match(panel.textContent, lang === 'sv' ? /Nämnd i/ : /Mentioned in/,
    'reviewed articles must render in the real ordinary stop detail');
  for (const row of mentions) {
    const link = [...panel.querySelectorAll('a')].find(a => a.getAttribute('href') === row.article_url);
    assert.ok(link, 'the exact reviewed article is linked');
    assert.match(link.textContent, new RegExp(row.publisher));
    assert.equal(link.getAttribute('target'), '_blank');
    assert.match(link.getAttribute('rel'), /noopener/);
    assert.match(link.getAttribute('rel'), /noreferrer/);
    assert.ok(panel.textContent.includes(row.article_title));
  }
  assert.doesNotMatch(panel.textContent, /Rekommenderas av|Recommended by|oberoende rekommendationer|independent recommendations/);
  assert.ok([...panel.querySelectorAll('a')].some(a => a.getAttribute('href') === 'https://www.roscioli.com/salumeria'), 'venue website stays separate');
  assert.match(panel.textContent, /Catalog source/);
});

for (const lang of ['sv', 'en']) test(`${lang} actual remembered JSON restores exact article links and dates without recomposition`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${DATE}T10:00:00Z`) });
  const { LAST_KEY } = await import('../src/lib/anywhere-storage.mjs');
  const first = await mountPlanner({ url: `http://localhost/anywhere?place=Roma&lang=${lang}` });
  let active = true;
  t.after(() => active ? first.unmount() : undefined);
  await first.fetchMock.respond(routeCalls(first)[0], response());
  const saved = JSON.parse(first.window.localStorage.getItem(LAST_KEY));
  assert.ok(saved?.safeResponse, 'the ordinary mounted app persists the completed answer');
  const stored = saved.safeResponse.days[0].primary_route.main_stops[0].provenance.venue_mentions;
  assert.deepEqual(stored, mentions, 'the actual storage write retains every source field');
  await first.unmount(); active = false;
  const restored = await mountPlanner({ url: `http://localhost/anywhere?restore=last&lang=${lang}`, storage: { [LAST_KEY]: saved } });
  t.after(() => restored.unmount());
  const panel = await expand(restored);
  assert.ok(panel.querySelector('[data-venue-mentions]'));
  assert.deepEqual([...panel.querySelectorAll('[data-venue-mentions] a')].map(link => link.getAttribute('href')), mentions.map(row => row.article_url));
  const dates = [...panel.querySelectorAll('[data-venue-mentions] time')].map(time => time.getAttribute('datetime'));
  assert.ok(dates.includes('2026-10-12') && dates.includes('2025-04-22'));
  assert.ok(panel.textContent.includes(lang === 'sv' ? 'inte verifierade' : 'not been verified'));
  assert.equal(routeCalls(restored).length, 0, 'restoring and inspecting the saved references never requests a new day');
});

for (const [name, invalid] of [
  ['absent', []], ['null', null],
  ['other branch', mentions.map((row, index) => index ? row : { ...row, venue_binding: { ...row.venue_binding, label: 'Other branch' } })],
  ['unsafe article destination', mentions.map((row, index) => index ? row : { ...row, article_url: 'https://user:secret@example.com/article' })],
  ['too many references', Array.from({ length: 9 }, () => mentions[0])],
]) test(`${name} metadata leaves a usable stop with no credibility placeholder`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${DATE}T10:00:00Z`) });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Roma&lang=sv' });
  t.after(() => h.unmount());
  await h.fetchMock.respond(routeCalls(h)[0], response(invalid));
  const panel = await expand(h);
  assert.ok(!panel.querySelector('[data-venue-mentions]'));
  assert.doesNotMatch(panel.textContent, /Nämnd i|Inte omnämnd|saknar rekommendationer/i);
  assert.ok([...panel.querySelectorAll('button')].some(button => button.textContent.trim() === 'Byt'));
});
