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

const {
  isPromotableSignal,
  isWeakLivePlaceholderSignal,
  isPlaceholderSignalText,
} = require("./signal-quality");

const PREFERRED_TYPES_FOR_HEADLINE = new Set([
  "live_event_nearby",
  "golden_hour",
  "evening_window",
  "crowd_warning",
]);

const MAX_MASTHEAD_HEADLINE_LENGTH = 86;

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
function buildMasthead({ signals, fallback, lang = "sv" } = {}) {
  const list = Array.isArray(signals) ? signals : [];
  const fallbackHeadline = normalizeMastheadText(fallback?.headline);
  const fallbackSubhead = normalizeMastheadText(fallback?.subhead);
  const cleanFallback = sanitizeMastheadFallback(fallbackHeadline, fallbackSubhead, lang);
  const selected = pickMastheadSignal(list);

  if (selected) {
    const headline = buildMastheadHeadline(selected, lang);
    const subhead =
      normalizeMastheadText(selected.reason) ||
      normalizeMastheadText(selected.why_it_matters) ||
      normalizeMastheadText(selected.blurb) ||
      cleanFallback.subhead;

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
    headline: cleanFallback.headline,
    subhead: cleanFallback.subhead,
    source: "fallback",
    signal_id: null,
    signal_type: null,
    signal_label: null,
  };
}

function sanitizeMastheadFallback(headline, subhead, lang) {
  if (!isPlaceholderSignalText(headline)) {
    return { headline, subhead };
  }

  const isEnglish = normalizeLanguageCode(lang) === "en";
  return {
    headline: isEnglish ? "No strong signals right now" : "Inga starka signaler just nu",
    subhead: isEnglish
      ? "Parranda only shows live signals that are clear enough to be useful."
      : "Parranda visar bara livesignaler som är tydliga nog att vara användbara.",
  };
}

function pickMastheadSignal(signals) {
  if (signals.length === 0) return null;

  const renderableSignals = signals.filter(hasMastheadHeadline);

  if (renderableSignals.length === 0) return null;

  // Keep administrative/civic-notice signals (council/committee meetings, tagged
  // `cultural_salience: "administrative"` by the ranker) out of the masthead
  // when any non-administrative signal can headline — a council meeting should
  // never be the city's "live experience" headline if a real happening exists.
  // If administrative notices are all there is, fall back to them rather than
  // leaving the page blank.
  const nonAdministrative = renderableSignals.filter(
    (signal) => signal && signal.cultural_salience !== "administrative",
  );
  const pool = nonAdministrative.length ? nonAdministrative : renderableSignals;

  const preferred = pool.find(
    (signal) => signal && PREFERRED_TYPES_FOR_HEADLINE.has(signal.type),
  );

  return preferred || pool[0] || null;
}

function hasMastheadHeadline(signal) {
  if (isWeakLivePlaceholderSignal(signal) || !isPromotableSignal(signal)) {
    return false;
  }

  return Boolean(
    normalizeMastheadText(signal?.title) ||
      normalizeMastheadText(signal?.safe_headline) ||
      normalizeMastheadText(signal?.kindLabel) ||
      normalizeMastheadText(signal?.signal_label),
  );
}

function normalizeMastheadText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildMastheadHeadline(signal, lang) {
  if (signal?.type === "live_event_nearby") {
    const providerTitle = normalizeMastheadText(signal.title);
    // Prefer the generator-built `safe_headline` ("Konsert på Centre
    // Civic Example" / "Concert in Barcelona") — a real human sentence
    // in the UI language. Fall back to `kindLabel` or `signal_label` if
    // the safe headline is missing. Never use `signal.kind` here: that
    // is a chip-shape "{kind} · {source}" string and promoting it into
    // the page H1 leaks the source label ("Open Data BCN") into the
    // headline, which it should never own.
    const saferEventLabel =
      normalizeMastheadText(signal.safe_headline) ||
      normalizeMastheadText(signal.kindLabel) ||
      normalizeMastheadText(signal.signal_label);

    if (
      saferEventLabel &&
      (isForeignSourceTitle(signal, lang) ||
        providerTitle.length > MAX_MASTHEAD_HEADLINE_LENGTH)
    ) {
      return saferEventLabel;
    }
  }

  return compactMastheadText(normalizeMastheadText(signal?.title));
}

function isForeignSourceTitle(signal, lang) {
  const sourceLanguage = normalizeLanguageCode(signal?.source_language);
  const uiLanguage = normalizeLanguageCode(lang);
  return Boolean(sourceLanguage && uiLanguage && sourceLanguage !== uiLanguage);
}

function normalizeLanguageCode(lang) {
  const code = String(lang || "").trim().toLowerCase().slice(0, 2);
  return code || "";
}

function compactMastheadText(value) {
  if (value.length <= MAX_MASTHEAD_HEADLINE_LENGTH) {
    return value;
  }
  const clipped = value.slice(0, MAX_MASTHEAD_HEADLINE_LENGTH);
  const boundary = Math.max(
    clipped.lastIndexOf(" "),
    clipped.lastIndexOf("–"),
    clipped.lastIndexOf("-"),
  );
  return `${clipped.slice(0, boundary >= 48 ? boundary : MAX_MASTHEAD_HEADLINE_LENGTH).trim()}...`;
}

module.exports = {
  buildMasthead,
  PREFERRED_TYPES_FOR_HEADLINE,
  MAX_MASTHEAD_HEADLINE_LENGTH,
};
