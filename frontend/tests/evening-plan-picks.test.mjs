import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

// Mounted Planner + real React, fixture response: an evening plan for today
// that keeps culture although its places' hours tonight are unconfirmed
// (engine caveat picks_unconfirmed_tonight). The header says so plainly, and
// "About this day" says the day is planned for the evening. No pick is moved.
const stop = (id, label, covered, i) => ({ id, label, lat: 60.17 + i * 0.002, lng: 24.94, covered_preferences: covered });
const day = (evening) => ({ days: [{ experimental_agnostic_route_applied: true, primary_route: {
  id: '__agnostic_compose__', title: 'Published day',
  main_stops: [stop('a', 'Harbour bistro', ['food'], 0), stop('b', 'Lookout', ['scenic'], 1), stop('c', 'City museum', ['museums'], 2)],
  estimated_km: 1.6, map_path_points: [], legs: [], confidence: 'low',
  anchored_to_local_time: evening, ...(evening ? { unconfirmed_tonight_preferences: ['museums'] } : {}),
  caveats: evening ? ['day_anchored_to_current_time', 'picks_unconfirmed_tonight'] : [] }, alternatives: [] }],
  agnostic_route_output_experiment: { promotion: { promote: true }, intake: { query: 'Testville' },
    source_status: { anchor: { lat: 60.17, lng: 24.94 } } } });

async function composed(t, evening) {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&prefs=food,culture,views&lang=sv', props: { lang: 'sv' } });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day(evening));
  await h.clock.advance(50);
  return h;
}
const statusLines = (h) => [...h.container.querySelectorAll('p[role="status"]')].map(p => p.textContent.trim());

test('an evening plan keeps culture and says its hours tonight are unknown', async t => {
  const h = await composed(t, true);
  assert.ok(statusLines(h).includes('Kultur: öppettiderna i kväll är okända – kontrollera innan du går.'), JSON.stringify(statusLines(h)));
  assert.match(h.container.textContent, /Planerad för kvällen\. För några av dina val är öppettiderna i kväll okända\./);
  assert.doesNotMatch(h.container.textContent, /i morgon/, 'no pick is moved to tomorrow');
});

test('without that caveat the header says nothing about tonight', async t => {
  const h = await composed(t, false);
  assert.ok(!statusLines(h).some(line => line.includes('öppettiderna i kväll')), JSON.stringify(statusLines(h)));
  assert.doesNotMatch(h.container.textContent, /Planerad för kvällen/);
});
