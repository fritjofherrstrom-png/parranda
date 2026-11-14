import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

// Mounted Planner + real React, fixture response: an evening plan for today
// that keeps culture although its places' hours tonight are unconfirmed
// (engine caveat picks_unconfirmed_tonight). The header says so plainly, and
// "About this day" says the day is planned for the evening. No pick is moved.
const stop = (id, label, covered, i) => ({ id, label, lat: 60.17 + i * 0.002, lng: 24.94, covered_preferences: covered });
// The plan is for 1 October in Stockholm, with the place's timezone trusted.
const DATE = '2026-10-01';
const TRUSTED = { timezone: 'Europe/Stockholm', timezone_known: true, timezone_trust: 'resolver_attested' };
const day = (evening, time = TRUSTED) => ({ days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: {
  id: '__agnostic_compose__', title: 'Published day',
  main_stops: [stop('a', 'Harbour bistro', ['food'], 0), stop('b', 'Lookout', ['scenic'], 1), stop('c', 'City museum', ['museums'], 2)],
  estimated_km: 1.6, map_path_points: [], legs: [], confidence: 'low',
  anchored_to_local_time: evening, ...(evening ? { unconfirmed_tonight_preferences: ['museums'] } : {}),
  caveats: evening ? ['day_anchored_to_current_time', 'picks_unconfirmed_tonight'] : [] }, alternatives: [] }],
  agnostic_route_output_experiment: { promotion: { promote: true }, intake: { query: 'Testville' },
    source_status: { anchor: { lat: 60.17, lng: 24.94 } }, context: { time } } });

// 20:30 in Stockholm on the plan's date, unless a test reads it later.
async function composed(t, evening, { now = '2026-10-01T18:30:00Z', time = TRUSTED, lang = 'sv' } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Testville&prefs=food,culture,views&lang=${lang}`, props: { lang } });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day(evening, time));
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

// HOLD review on #683, 13 Nov 2026: "tonight" was the reader's relative day.
// After the place's midnight, or when its calendar day cannot be trusted, both
// lines name the plan's own date instead. Nothing is moved to another date.
test('after the place\'s midnight the evening lines name the plan\'s date, not tonight', async t => {
  const h = await composed(t, true, { now: '2026-10-01T22:30:00Z' }); // 00:30 on 2 October in Stockholm
  assert.ok(statusLines(h).includes('Kultur: öppettiderna på kvällen tors 1 okt är okända – kontrollera innan du går.'), JSON.stringify(statusLines(h)));
  assert.match(h.container.textContent, /Planerad för kvällen tors 1 okt\. För några av dina val är kvällens öppettider okända\./);
  assert.doesNotMatch(h.container.textContent, /i kväll/);
});

test('without a trusted place day the evening lines name the plan\'s date even in the evening', async t => {
  const h = await composed(t, true, { time: { timezone: 'Europe/Stockholm', timezone_known: false, timezone_trust: 'unavailable' } });
  assert.ok(statusLines(h).includes('Kultur: öppettiderna på kvällen tors 1 okt är okända – kontrollera innan du går.'), JSON.stringify(statusLines(h)));
  assert.doesNotMatch(h.container.textContent, /i kväll/);
});

test('in English the dated evening reads as the evening of that day', async t => {
  const h = await composed(t, true, { now: '2026-10-01T22:30:00Z', lang: 'en' });
  assert.ok(statusLines(h).includes('Culture: opening hours on the evening of Thu 1 Oct are unknown — check before you go.'), JSON.stringify(statusLines(h)));
  assert.match(h.container.textContent, /Planned for the evening of Thu 1 Oct\. For some of your picks, that evening's opening hours are unknown\./);
});
