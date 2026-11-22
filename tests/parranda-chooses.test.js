'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');
const { chooseDayInterests, freeRhythmDayProfile, normalizeIntentMode } = require('../server/planner/parranda-chooses');
const { externalRecord } = require('./helpers/planner-reservoir-compare');

// Controlled attributed/corroborated source fixtures, NOT live provider
// evidence. Clock, weather and supply are injected; nothing touches a network.
const DATE = '2026-10-22';
const TYPES = {
  restaurant: { tags: ['mat'], hours: 'Mo-Su 11:00-23:00' },
  cafe: { tags: ['fika'], hours: 'Mo-Su 07:00-18:00' },
  park: { tags: [], hours: null },
  museum: { tags: ['kultur'], hours: 'Mo-Su 10:00-17:00' },
  bar: { tags: ['nattliv'], hours: 'Mo-Su 16:00-24:00' },
  viewpoint: { tags: ['utsikt'], hours: null },
};
function supply(counts) {
  let offset = 0;
  return Object.entries(counts).flatMap(([type, count]) => Array.from({ length: count }, (_, i) => {
    offset += 1;
    const spec = TYPES[type];
    return {
      ...externalRecord(`${type}-${i}`, `Fixture ${type} ${i}`, type, 55.6 + (offset % 6) * 0.0012, 13 + Math.floor(offset / 6) * 0.0012, spec.tags),
      ...(spec.hours ? { opening_hours: spec.hours } : {}),
    };
  }));
}
// Europe/Stockholm is UTC+2 on this date.
const EVENING = () => new Date('2026-10-22T17:30:00Z'); // 19:30 local
const MORNING = () => new Date('2026-10-22T06:30:00Z'); // 08:30 local
const RAIN = async () => ({ condition: 'rain', precipitationProbabilityMax: 90, source: 'controlled', stale: false });
const SUN = async () => ({ condition: 'sun', pleasant: true, source: 'controlled', stale: false });

async function compose(rows, { preferences = [], intentMode = null, clock = MORNING, weatherProvider = SUN, dayRhythm = 'free', date = DATE, ...extra } = {}) {
  const output = await composeAgnosticRouteOutput({
    coords: { lat: 55.6, lng: 13 }, baselineResult: { days: [] },
    externalRequested: true, openDataLoader: async () => rows.map(row => ({ ...row })),
    date, todayIsoDate: DATE, timezone: 'Europe/Stockholm',
    trustedTimezone: 'Europe/Stockholm', clock, weatherProvider,
    synthesizeVia: 'engine', distanceMode: 'no_limit', dayRhythm, preferences, intentMode, ...extra,
  });
  const route = output.result.days[0]?.primary_route;
  const evidence = {
    intentMode, preferences, dayRhythm,
    parranda_chooses: output.experiment.parranda_chooses || null,
    stops: (route?.main_stops || []).map(stop => `${stop.type}:${stop.id}`),
    day_profile: route?.day_profile || null,
  };
  if (process.env.PARRANDA_CHOOSES_EVIDENCE_FILE) fs.appendFileSync(process.env.PARRANDA_CHOOSES_EVIDENCE_FILE, JSON.stringify(evidence) + '\n');
  return { ...output, route, choice: output.experiment.parranda_chooses };
}
const picks = (choice) => choice.auto_intents.map(entry => entry.intent);
const stopTypes = (route) => new Set((route?.main_stops || []).map(stop => stop.type));

test('the mode is opt-in: only the exact value enables it', () => {
  assert.equal(normalizeIntentMode('parranda_chooses'), 'parranda_chooses');
  assert.equal(normalizeIntentMode(' Parranda_Chooses '), 'parranda_chooses');
  for (const value of [undefined, null, '', 'free', 'surprise', 1, true, {}]) assert.equal(normalizeIntentMode(value), null);
});

test('the free rhythm density rule is shared, unchanged', () => {
  assert.equal(freeRhythmDayProfile({ candidateCount: 3 }), 'light');
  assert.equal(freeRhythmDayProfile({ candidateCount: 9, remainingMinutes: 180 }), 'light');
  assert.equal(freeRhythmDayProfile({ candidateCount: 5 }), 'variation');
  assert.equal(freeRhythmDayProfile({ candidateCount: 9, remainingMinutes: 300 }), 'variation');
  assert.equal(freeRhythmDayProfile({ candidateCount: 6, remainingMinutes: null }), 'peak');
});

test('rainy evening: Parranda chooses indoor, evening-fitting interests and says why', async () => {
  const rows = supply({ restaurant: 5, cafe: 5, park: 5, museum: 4, bar: 5, viewpoint: 4 });
  const { choice, route } = await compose(rows, { intentMode: 'parranda_chooses', clock: EVENING, weatherProvider: RAIN });
  assert.equal(choice.status, 'chosen');
  assert.deepEqual(picks(choice), ['food', 'nightlife']);
  for (const entry of choice.auto_intents) {
    assert.ok(entry.reasons.includes('rain_favors_indoor'), entry.intent);
    assert.ok(entry.reasons.includes('fits_evening'), entry.intent);
    assert.ok(entry.evidence.usable_count >= 2);
    assert.equal(entry.evidence.counted_up_to, 6);
  }
  assert.equal(choice.context.weather, 'rain');
  assert.equal(choice.context.time_band, 'evening');
  assert.equal(choice.context.pick_budget, 'variation', 'four and a half hours left keeps the day to two directions');
  const notChosen = Object.fromEntries(choice.not_chosen.map(entry => [entry.intent, entry.reason]));
  assert.equal(notChosen.green, 'daypart_passed');
  assert.equal(notChosen.fika, 'no_usable_places', 'every fixture café closes at 18:00 by its source hours');
  assert.equal(notChosen.views, 'rain_prefers_indoor', 'rain outweighs a matching evening for an exposed viewpoint');
  assert.ok(route, 'a composed day');
  assert.ok([...stopTypes(route)].every(type => ['restaurant', 'bar'].includes(type)), [...stopTypes(route)].join());
  assert.equal(choice.preferences, undefined, 'the internal preference list is not published twice');
});

test('morning with strong green and coffee supply: those lead the day', async () => {
  const rows = supply({ cafe: 6, park: 6, restaurant: 2, museum: 2 });
  const { choice, route } = await compose(rows, { intentMode: 'parranda_chooses', clock: MORNING, weatherProvider: SUN });
  assert.equal(choice.status, 'chosen');
  assert.deepEqual(picks(choice).slice(0, 2).sort(), ['fika', 'green']);
  const green = choice.auto_intents.find(entry => entry.intent === 'green');
  assert.ok(green.reasons.includes('fits_morning'));
  assert.ok(green.reasons.includes('pleasant_weather_favors_outdoor'));
  assert.ok(green.reasons.includes('strong_local_supply'));
  const fika = choice.auto_intents.find(entry => entry.intent === 'fika');
  assert.ok(fika.reasons.includes('open_in_window'), 'source-stated hours cover the window');
  assert.ok(route);
  const types = stopTypes(route);
  assert.ok(types.has('cafe') && types.has('park'), [...types].join());
});

test('thin supply: fewer picks than the day could carry, with an honest note', async () => {
  const rows = supply({ cafe: 4, park: 3, museum: 1, restaurant: 1 });
  const { choice, route } = await compose(rows, { intentMode: 'parranda_chooses', clock: MORNING, weatherProvider: SUN });
  assert.equal(choice.context.pick_budget, 'peak');
  assert.deepEqual(picks(choice).sort(), ['fika', 'green']);
  assert.equal(choice.status, 'thin_supply');
  assert.ok(choice.notes.includes('fewer_interests_thin_supply'));
  const notChosen = Object.fromEntries(choice.not_chosen.map(entry => [entry.intent, entry]));
  assert.equal(notChosen.culture.reason, 'too_few_usable_places');
  assert.equal(notChosen.culture.usable_count, 1);
  assert.ok(route);
  assert.ok([...stopTypes(route)].every(type => ['cafe', 'park'].includes(type)));
});

test('thin supply never narrows a place to fewer places than the varied day', async () => {
  // Two cafés far apart and three single other places: one direction with two
  // places would publish a smaller day than the varied one.
  const rows = [
    ...supply({ restaurant: 1, museum: 1, park: 1 }),
    { ...externalRecord('cafe-far-north', 'Fixture far cafe north', 'cafe', 55.64, 13, ['fika']), opening_hours: 'Mo-Su 07:00-18:00' },
    { ...externalRecord('cafe-far-south', 'Fixture far cafe south', 'cafe', 55.56, 13, ['fika']), opening_hours: 'Mo-Su 07:00-18:00' },
  ];
  const varied = await compose(rows, {});
  const { choice, route } = await compose(rows, { intentMode: 'parranda_chooses' });
  assert.equal(choice.status, 'thin_supply');
  assert.deepEqual(choice.auto_intents, []);
  assert.ok(choice.notes.includes('too_few_places_to_focus'));
  assert.ok(choice.notes.includes('varied_day_kept'));
  assert.equal(choice.not_chosen.find(entry => entry.intent === 'fika').reason, 'too_narrow_for_the_day');
  assert.deepEqual(route?.main_stops.map(stop => stop.id), varied.route?.main_stops.map(stop => stop.id));
});

test('no interest with enough places keeps the varied day and says so', async () => {
  const rows = supply({ cafe: 1, museum: 1, restaurant: 1 });
  const { choice } = await compose(rows, { intentMode: 'parranda_chooses' });
  assert.equal(choice.status, 'no_supported_interest');
  assert.deepEqual(choice.auto_intents, []);
  assert.ok(choice.notes.includes('varied_day_kept'));
});

test('missing weather and a future date degrade to fewer reasons, not to failure', async () => {
  const rows = supply({ cafe: 5, park: 5, restaurant: 5, museum: 5 });
  const { choice, route } = await compose(rows, {
    intentMode: 'parranda_chooses', date: '2026-10-24', weatherProvider: async () => null,
  });
  assert.equal(choice.status, 'chosen');
  assert.equal(choice.context.weather, 'unknown');
  assert.equal(choice.context.time_band, null);
  assert.ok(choice.notes.includes('weather_unknown'));
  assert.ok(choice.notes.includes('planned_without_current_time'));
  assert.ok(!picks(choice).includes('nightlife'), 'a bar is not chosen for a day planned without a current evening');
  assert.ok(choice.auto_intents.every(entry => !entry.reasons.some(reason => reason.startsWith('fits_') || reason.startsWith('rain'))));
  assert.ok(route);
});

test('explicit preferences are untouched by the mode', async () => {
  const rows = supply({ restaurant: 5, cafe: 5, park: 5, museum: 4, bar: 5, viewpoint: 4 });
  for (const preferences of [['culture'], ['food', 'views']]) {
    const plain = await compose(rows, { preferences, clock: EVENING, weatherProvider: RAIN });
    const withMode = await compose(rows, { preferences, intentMode: 'parranda_chooses', clock: EVENING, weatherProvider: RAIN });
    assert.deepEqual(withMode.result, plain.result, `same day for ${preferences.join('+')}`);
    assert.equal(withMode.choice.status, 'ignored_explicit_preferences');
    assert.deepEqual(withMode.choice.auto_intents, []);
    assert.equal(plain.choice, undefined, 'no block without the mode');
  }
});

test('without the mode, an empty-preference request is the same varied day as before', async () => {
  const rows = supply({ restaurant: 5, cafe: 5, park: 5, museum: 4, bar: 5, viewpoint: 4 });
  const varied = await compose(rows, { clock: MORNING, weatherProvider: SUN });
  assert.equal(varied.experiment.parranda_chooses, undefined);
  const garbage = await compose(rows, { intentMode: 'surprise', clock: MORNING, weatherProvider: SUN });
  assert.deepEqual(garbage.result, varied.result);
  assert.equal(garbage.experiment.parranda_chooses, undefined);
});

test('the mode composes a different day from the same pool than the free rhythm alone', async () => {
  const rows = supply({ restaurant: 5, cafe: 5, park: 5, museum: 4, bar: 5, viewpoint: 4 });
  const before = await compose(rows, { clock: EVENING, weatherProvider: RAIN });
  const after = await compose(rows, { intentMode: 'parranda_chooses', clock: EVENING, weatherProvider: RAIN });
  assert.ok(before.route && after.route);
  assert.notDeepEqual(after.route.main_stops.map(stop => stop.id), before.route.main_stops.map(stop => stop.id));
});

test('a focused day that cannot be composed falls back to the varied day, labelled', () => {
  // Pure check of the publication contract; composition fallback is covered
  // through the wrapper below.
  const { publishInterestChoice } = require('../server/planner/parranda-chooses');
  const choice = chooseDayInterests({
    survey: { roles: [{ role: 'coffee_fika_stop', candidates: [0, 1, 2].map(i => ({ candidate_id: `c${i}`, planner_usable: true, covered_preferences: ['coffee'] })) }] },
  });
  const published = publishInterestChoice(choice, { fellBack: 'focused_day_not_composed' });
  assert.equal(published.status, 'focus_fell_back_to_varied_day');
  assert.equal(published.fallback_reason, 'focused_day_not_composed');
  assert.ok(published.notes.includes('varied_day_kept'));
  assert.deepEqual(published.auto_intents.map(entry => entry.intent), ['fika']);
});
