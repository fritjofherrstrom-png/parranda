import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

// Mounted Planner + real React, fixture response: an evening plan for today
// that kept food and a view and left culture for tomorrow (engine caveat
// daytime_picks_left_for_tomorrow). The reader's pick says "tomorrow", not
// "not in this day", and "About this day" says the day is planned for tonight.
const stop = (id, label, covered, i) => ({ id, label, lat: 60.17 + i * 0.002, lng: 24.94, covered_preferences: covered });
const day = (evening) => ({ days: [{ experimental_agnostic_route_applied: true, primary_route: {
  id: '__agnostic_compose__', title: 'Published day', main_stops: [stop('a', 'Harbour bistro', ['food'], 0), stop('b', 'Lookout', ['scenic'], 1)],
  estimated_km: 1.2, map_path_points: [], legs: [], confidence: 'low',
  anchored_to_local_time: evening, ...(evening ? { deferred_preferences: ['museums'] } : {}),
  caveats: evening ? ['day_anchored_to_current_time', 'daytime_picks_left_for_tomorrow'] : [] }, alternatives: [] }],
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
const picks = (h) => [...(h.container.querySelector('ul[aria-label="Dina val i dagen"]')?.querySelectorAll('li') || [])]
  .map(li => li.textContent.trim());

test('an evening plan says which pick waits until tomorrow', async t => {
  const h = await composed(t, true);
  const shown = picks(h);
  assert.ok(shown.includes('Kultur · i morgon'), JSON.stringify(shown));
  assert.ok(!shown.some(text => text.includes('inte med')), JSON.stringify(shown));
  assert.match(h.container.textContent, /Planerad för kvällen\. Val som bara passar dagtid väntar till i morgon\./);
});

test('without that caveat a missing pick is still not in this day', async t => {
  const h = await composed(t, false);
  const shown = picks(h);
  assert.ok(shown.includes('Kultur · inte med'), JSON.stringify(shown));
  assert.doesNotMatch(h.container.textContent, /Planerad för kvällen/);
});
