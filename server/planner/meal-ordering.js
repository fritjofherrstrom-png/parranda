'use strict';

// Meal positions are planning intentions over already admitted places. They
// never establish opening hours, an arrival time or stronger source trust.
const { normalizeSelectedDayHoursFact } = require('../place-candidates/opening-hours');
const { resolveTimeBandFromHour } = require('../candidates/candidate-pool');
const { preferenceFit } = require('./preference-focus');
const minute = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };

function createMealOrderPolicy(stops, context) {
  const now = typeof context?.nowLocalIso === 'string'
    ? context.nowLocalIso.match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):[0-5]\d$/) : null;
  if (!now || context.date !== now[1]) return null;
  const band = resolveTimeBandFromHour(Number(now[2]));
  if (!['midday', 'evening'].includes(band)) return null;
  const current = Number(now[2]) * 60 + Number(now[3]);
  const meals = new Set(stops.filter(stop => preferenceFit(stop).coveredPreferences.includes('food')));
  if (!meals.size) return null;
  const hours = new Map([...meals].map(stop => [stop, normalizeSelectedDayHoursFact(stop.selectedDayHours ?? stop.selected_day_hours)]));
  const at = (stop, start, end) => {
    if (!meals.has(stop)) return false;
    const fact = hours.get(stop);
    if (!fact || fact.status === 'unknown') return true;
    if (fact.status === 'closed') return false;
    return fact.all_day || fact.windows.some(w => minute(w.opens) <= start && minute(w.closes) >= end);
  };
  const laterDinner = stop => {
    if (!meals.has(stop)) return false;
    const fact = hours.get(stop);
    if (!fact || fact.status === 'unknown') return true;
    if (fact.status === 'closed') return false;
    return fact.all_day || fact.windows.some(w => minute(w.opens) < 23 * 60 && minute(w.closes) > 18 * 60);
  };
  const dinnerWanted = context.fullDay === true && band === 'midday' && stops.length >= 3;
  const fitsNow = stop => at(stop, current, current + 1);
  return {
    scoreSet(candidate) {
      const firstMeals = candidate.filter(fitsNow);
      return [firstMeals.length ? 1 : 0,
        dinnerWanted && candidate.length >= 3 && firstMeals.some(first =>
          candidate.some(last => last !== first && laterDinner(last))) ? 1 : 0];
    },
    score(candidate) {
      const first = candidate[0], last = candidate.at(-1);
      return [fitsNow(first) ? 1 : 0,
        dinnerWanted && last !== first && laterDinner(last) ? 1 : 0,
        fitsNow(first) && hours.get(first)?.status === 'known' ? 1 : 0];
    },
    annotate(candidate) {
      const first = candidate[0], last = candidate.at(-1);
      return candidate.map(stop => {
        const planned = stop === first && fitsNow(stop) ? band
          : dinnerWanted && stop === last && laterDinner(stop) ? 'evening' : null;
        return planned ? { ...stop, plannedMealDaypart: planned } : stop;
      });
    },
  };
}

module.exports = { createMealOrderPolicy };
