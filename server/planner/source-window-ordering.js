'use strict';

const { normalizeSelectedDayHoursFact } = require('../place-candidates/opening-hours');
const minute = clock => { const [hour, min] = clock.split(':').map(Number); return hour * 60 + min; };

// An ordering preference over already admitted, selected-day source facts.
// It proves neither arrival feasibility nor open-now status. A split window
// only yields an edge when ALL of its openings are on the same side.
function createSourceWindowOrderPolicy(stops) {
  const spans = new Map();
  for (const stop of stops) {
    const raw = stop.selectedDayHours ?? stop.selected_day_hours;
    const fact = normalizeSelectedDayHoursFact(raw);
    if (fact?.status !== 'known' || fact.all_day || !Array.isArray(raw?.windows) ||
        raw.windows.length !== fact.windows.length || !fact.windows.length || fact.windows.length >= 4) continue;
    // The shared normalizer drops unsupported windows and caps to four.
    // Earlier stages may already have capped a fact, so even an exact four
    // cannot prove completeness. Partial evidence supplies no ordering edge.
    spans.set(stop, { first: Math.min(...fact.windows.map(w => minute(w.opens))),
      last: Math.max(...fact.windows.map(w => minute(w.closes))) });
  }
  const edges = [];
  for (const [before, a] of spans) for (const [after, b] of spans) {
    if (before !== after && a.last <= b.first) edges.push([before, after]);
  }
  if (!edges.length) return null;
  return {
    score(candidate) {
      const positions = new Map(candidate.map((stop, index) => [stop, index]));
      return -edges.filter(([before, after]) => positions.get(before) > positions.get(after)).length;
    },
  };
}

module.exports = { createSourceWindowOrderPolicy };
