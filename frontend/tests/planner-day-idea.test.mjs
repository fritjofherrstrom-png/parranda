import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';

const DATE = '2026-11-16';
const routes = h => h.fetchMock.calls.filter(call => call.url.includes('route-recommendations'));
const stops = [
  { id: 'art', label: 'Fixture Art Collection', type: 'museum', place_details: { kind: 'art_museum' }, lat: 48, lng: 8, covered_preferences: ['culture'] },
  { id: 'garden', label: 'Fixture Botanical Garden', type: 'garden', place_details: { kind: 'botanical_garden' }, lat: 48.001, lng: 8, covered_preferences: ['green'] },
  { id: 'cafe', label: 'Fixture Bakery', type: 'cafe', place_details: { kind: 'bakery' }, lat: 48.002, lng: 8, covered_preferences: ['fika'] },
];
function answer(mainStops = stops) {
  return { days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', main_stops: mainStops, estimated_km: 1.2, map_path_points: [], legs: [],
  }, alternatives: [] }], agnostic_route_output_experiment: {
    promotion: { promote: true }, source_status: { anchor: { lat: 48, lng: 8 } },
  }, live_events: { coverage: 'covered', selected_date: DATE, pending: false, tonight: [], this_week: [],
    acquisition: { source_health: { status: 'healthy', result: 'empty' } } } };
}

for (const lang of ['sv', 'en']) test(`${lang} the day has a readable idea from the actual published places, not its requested picks`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-16T10:00:00Z') });
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Fixture%20Town&lang=${lang}`, props: { lang } });
  t.after(() => h.unmount());
  const request = routes(h)[0];
  await h.fetchMock.respond(request, answer());
  const idea = h.container.querySelector('[data-day-idea]');
  assert.ok(Boolean(idea), 'a completed day explains its character without opening every stop');
  assert.match(idea.textContent, lang === 'sv' ? /Konst, grönt och fika/ : /Art, green spaces and a café break/);
  assert.match(idea.textContent, /Fixture Art Collection/);
  assert.match(idea.textContent, /Fixture Bakery/);
  assert.doesNotMatch(idea.textContent, /hidden gem|gömda pärlor|open now|öppet nu|bästa|best/i);
  assert.deepEqual([...h.container.querySelectorAll('button[aria-controls]')]
    .filter(button => stops.some(stop => button.textContent.includes(stop.label)))
    .map(button => stops.find(stop => button.textContent.includes(stop.label)).id), ['art', 'garden', 'cafe'],
    'the introduction does not reorder or replace the published stops');
  await h.clock.advance(500);
  assert.equal(routes(h).length, 1, 'explaining the existing day must not acquire or recompose');
});
