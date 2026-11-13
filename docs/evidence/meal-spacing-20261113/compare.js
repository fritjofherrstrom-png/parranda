'use strict';
// Before/after evidence for "a second main meal needs its own place in the day".
// Every pair uses the same source pool, place, date, clock and weather: the
// fixture composer in tests/helpers/day-composition-fixtures.js (date
// 2026-10-22, clock 2026-10-16T08:00Z, sun, no walking limit). Only
// server/planner/day-composition-policy.js differs between the two runs.
//
//   node docs/evidence/meal-spacing-20261113/compare.js > after.jsonl
//   git show origin/main:server/planner/day-composition-policy.js > /tmp/p.js
//   (swap that file in, run again into before.jsonl, restore the branch file)
//   node docs/evidence/meal-spacing-20261113/compare.js --summary before.jsonl after.jsonl
const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '../../..');

function summarize(beforeFile, afterFile) {
  const read = file => fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const before = new Map(read(beforeFile).map(row => [row.key, row]));
  const after = read(afterFile);
  const totals = { days: 0, changed: 0, adjacent_before: 0, adjacent_after: 0, meals_before: 0, meals_after: 0,
    stops_changed: 0, coverage_lost: 0, km_before: 0, km_after: 0, labelled_before: 0, labelled_after: 0 };
  const changes = [];
  for (const row of after) {
    const base = before.get(row.key);
    if (!base || base.error || row.error) { changes.push({ key: row.key, error: base?.error || row.error || 'missing' }); continue; }
    totals.days += 1;
    totals.adjacent_before += base.adjacent ? 1 : 0; totals.adjacent_after += row.adjacent ? 1 : 0;
    totals.meals_before += base.meals; totals.meals_after += row.meals;
    totals.km_before += base.km || 0; totals.km_after += row.km || 0;
    totals.labelled_before += base.labelled ? 1 : 0; totals.labelled_after += row.labelled ? 1 : 0;
    if (base.stops !== row.stops) totals.stops_changed += 1;
    if (base.covered.some(intent => !row.covered.includes(intent))) totals.coverage_lost += 1;
    if (base.ids.join() !== row.ids.join()) {
      totals.changed += 1;
      changes.push({ key: row.key, before: base.ids.join(' > '), after: row.ids.join(' > '),
        meals: `${base.meals}->${row.meals}`, adjacent: `${base.adjacent}->${row.adjacent}`, km: `${base.km}->${row.km}` });
    }
  }
  totals.km_before = Number(totals.km_before.toFixed(1)); totals.km_after = Number(totals.km_after.toFixed(1));
  return { totals, changes };
}

if (process.argv[2] === '--summary') {
  process.stdout.write(JSON.stringify(summarize(process.argv[3], process.argv[4]), null, 1) + '\n');
  return;
}

const { record, compose } = require(path.join(ROOT, 'tests/helpers/day-composition-fixtures'));
const { isMeal, mealsSeparable } = require(path.join(ROOT, 'server/planner/day-composition-policy'));
const at = (id, type, dLat, dLng = 0) => ({ ...record(id, type), lat: 55.6 + dLat, lng: 13 + dLng });

// The small, hand-built control first.
const CONTROL = {
  clustered: () => [
    at('museum', 'museum', -0.003, 0.002), at('gallery-a', 'gallery', 0), at('gallery-b', 'gallery', 0.0016),
    at('gallery-c', 'gallery', 0.001, 0.004), at('garden', 'garden', 0.006, 0.003), at('park', 'park', 0.008, -0.002),
    at('cafe', 'cafe', 0.004), at('rest-a', 'restaurant', 0.01, 0.006), at('rest-b', 'restaurant', 0.0111, 0.006),
    at('rest-c', 'restaurant', 0.0105, 0.0075)],
  spread: () => [
    at('rest-a', 'restaurant', 0), at('gallery-a', 'gallery', 0.003), at('gallery-b', 'gallery', 0.006),
    at('garden', 'garden', 0.009), at('rest-b', 'restaurant', 0.012), at('museum', 'museum', 0.0045, 0.002),
    at('viewpoint', 'viewpoint', 0.0075, 0.002)],
  forced: () => [at('gallery-a', 'gallery', 0), at('gallery-b', 'gallery', 0.0016), at('gallery-c', 'gallery', 0.001, 0.004),
    at('gallery-d', 'gallery', 0.002, 0.002), at('rest-a', 'restaurant', 0.01, 0.006), at('rest-b', 'restaurant', 0.0111, 0.006)],
};

// Then seeded breadth: the same generator and seed for both runs.
function seeded(city) {
  let seed = 1000 + city * 7919;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const types = [['restaurant', 6], ['pizza', 2], ['museum', 3], ['gallery', 4], ['viewpoint', 2], ['park', 3], ['garden', 1], ['cafe', 4], ['bar', 3]];
  const clusterLat = (rnd() - 0.5) * 0.02, clusterLng = (rnd() - 0.5) * 0.03;
  const rows = [];
  for (const [type, max] of types) {
    const count = Math.floor(rnd() * (max + 1));
    for (let i = 0; i < count; i += 1) {
      const clustered = (type === 'restaurant' || type === 'pizza') && rnd() < 0.6;
      rows.push(at(`${type}-${city}-${i}`, type,
        clustered ? clusterLat + (rnd() - 0.5) * 0.002 : (rnd() - 0.5) * 0.025,
        clustered ? clusterLng + (rnd() - 0.5) * 0.003 : (rnd() - 0.5) * 0.035));
    }
  }
  return rows;
}

const PREFERENCES = [['culture', 'views', 'food'], ['food', 'culture'], ['food', 'fika', 'views'], ['food', 'nightlife'], ['food']];
const RHYTHMS = ['calm', 'balanced', 'full'];
const CITIES = Number(process.env.MEAL_SWEEP_CITIES || 60);

(async () => {
  const pools = [...Object.entries(CONTROL).map(([name, build]) => [name, build]),
    ...Array.from({ length: CITIES }, (_, city) => [`seeded-${city}`, () => seeded(city)])];
  for (const [pool, build] of pools) for (const preferences of PREFERENCES) for (const dayRhythm of RHYTHMS) {
    const key = `${pool}|${preferences.join('+')}|${dayRhythm}`;
    try {
      const day = await compose(build(), preferences, { dayRhythm });
      const stops = day.stops;
      process.stdout.write(JSON.stringify({ key, ids: stops.map(stop => stop.id), stops: stops.length,
        meals: stops.filter(isMeal).length, adjacent: stops.slice(1).some((stop, i) => isMeal(stop) && isMeal(stops[i])),
        km: day.route?.estimated_km ?? null, covered: [...new Set(stops.flatMap(stop => stop.covered_preferences || []))].sort(),
        labelled: stops.some(stop => stop.daypart),
        // Only the branch has the rule; main's run records null.
        separable: typeof mealsSeparable === 'function' ? mealsSeparable(stops) : null }) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ key, error: String(error?.message || error) }) + '\n');
    }
  }
})();
