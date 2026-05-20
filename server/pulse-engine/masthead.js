/**
 * Masthead selection — picks the strongest useful signal to drive the
 * Pulse page header (headline + subhead).
 *
 * The engine produces ranked `signals[]`. The city page used to source
 * its headline from a separate legacy code path (`buildCityPulseHeadline`
 * in editorial-calendar.js), which meant the masthead and the cards
 * could disagree about what was important right now. This module closes
 * that gap by choosing one signal to lead the page and exposing it as
 * a stable `masthead` object on the API response.
 *
 * Selection rules:
 *   1. Prefer the first ranked signal whose type belongs to the
 *      "useful as headline" set (live, golden hour, evening window,
 *      crowd warning). These types carry "right now" weight.
 *   2. Otherwise the highest-ranked renderable signal regardless of type.
 *   3. Otherwise fall back to the legacy headline/subhead (which is now
 *      the season-aware copy from #102).
 *
 * `moments[]` is intentionally never consulted here — the whole point
 * of this layer is to stop the masthead from surfacing evergreen
 * recurring-moment notes as a live signal.
 */

const PREFERRED_TYPES_FOR_HEADLINE = new Set([
  "live_event_nearby",
  "golden_hour",
  "evening_window",
  "crowd_warning",
]);

/**
 * @param {Object} input
 * @param {import("./types").PulseSignal[]} [input.signals]
 * @param {Object} [input.fallback]   { headline, subhead } from legacy shell
 * @param {string} [input.lang]
 * @returns {{
 *   headline: string,
 *   subhead: string,
 *   source: "signal" | "fallback",
 *   signal_id: string|null,
 *   signal_type: string|null,
 *   signal_label: string|null,
 * }}
 */
function buildMasthead({ signals, fallback, lang: _lang } = {}) {
  const list = Array.isArray(signals) ? signals : [];
  const fallbackHeadline = normalizeMastheadText(fallback?.headline);
  const fallbackSubhead = normalizeMastheadText(fallback?.subhead);
  const selected = pickMastheadSignal(list);

  if (selected) {
    const headline = normalizeMastheadText(selected.title);
    const subhead =
      normalizeMastheadText(selected.reason) ||
      normalizeMastheadText(selected.why_it_matters) ||
      normalizeMastheadText(selected.blurb) ||
      fallbackSubhead;

    return {
      headline,
      subhead,
      source: "signal",
      signal_id: selected.id || null,
      signal_type: selected.type || null,
      signal_label: selected.signal_label || null,
    };
  }

  return {
    headline: fallbackHeadline,
    subhead: fallbackSubhead,
    source: "fallback",
    signal_id: null,
    signal_type: null,
    signal_label: null,
  };
}

function pickMastheadSignal(signals) {
  if (signals.length === 0) return null;

  const renderableSignals = signals.filter(hasMastheadHeadline);

  if (renderableSignals.length === 0) return null;

  const preferred = renderableSignals.find(
    (signal) => signal && PREFERRED_TYPES_FOR_HEADLINE.has(signal.type),
  );

  return preferred || renderableSignals[0] || null;
}

function hasMastheadHeadline(signal) {
  return Boolean(normalizeMastheadText(signal?.title));
}

function normalizeMastheadText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  buildMasthead,
  PREFERRED_TYPES_FOR_HEADLINE,
};
