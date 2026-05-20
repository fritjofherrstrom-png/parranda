/**
 * Rome editorial generator.
 *
 * Wraps the existing editorial-calendar.js so its hand-curated items
 * flow through the pulse-engine pipeline as RawSignals. The data
 * (editorialPulseItems, recurringPulseMoments, getDateSignals, Natale
 * builder) stays in editorial-calendar.js; this generator is purely
 * an adapter from that data shape to the engine's RawSignal[] shape.
 *
 * Notes:
 *  - The legacy shell properties (headline, subhead, moments, wildcards)
 *    are still produced by getCityPulse() and consumed by the API route
 *    directly. The generator only emits signals.
 *  - Editorial signals carry `source.kind: "editorial"` and never get a
 *    UI source badge — they look like cards, not citations.
 */

const editorialCalendar = require("../../../editorial-calendar");

function romeEditorialGenerator(context) {
  const lang = context?.lang || "sv";
  const date = context?.date;
  if (!date) return [];

  const pulse = editorialCalendar.getCityPulse(date, { lang });
  const items = Array.isArray(pulse?.items) ? pulse.items : [];

  return items
    .map((item) => editorialItemToRawSignal(item, context))
    .filter(Boolean);
}

romeEditorialGenerator.generatorId = "rome-editorial";

function editorialItemToRawSignal(item, context) {
  if (!item || !item.title) return null;
  const signalType = item.signal_type || "local_timing_advice";

  return {
    id: item.id,
    type: signalType,
    level: item.level || "city",
    title: item.title,
    area: item.where || undefined,
    where: item.where || undefined,
    when: item.when || undefined,
    blurb: item.blurb || item.note || undefined,
    reason: item.why_it_matters || "",
    why_it_matters: item.why_it_matters || "",
    kind: item.kind || undefined,
    kindLabel: item.kindLabel || item.kind || undefined,
    matches_vibes: Array.isArray(item.matches_vibes) ? item.matches_vibes : undefined,
    route_hints: item.route_hints || undefined,
    linked_wildcard_id: item.linked_wildcard_id || undefined,
    place_query: item.place_query || undefined,
    score: typeof item.priority === "number" ? item.priority : 0,
    source: { kind: "editorial" },
    trust_level: "editorial",
    freshness: "evergreen",
  };
}

module.exports = romeEditorialGenerator;
