/**
 * Honest copy for a day the server published WITH limitations.
 *
 * The server decides whether a day is publishable; this only decides how to say
 * what is thin about it. Every phrase describes evidence we do or do not have —
 * never a promise, never an invented time, never an apology.
 */

// Ordered by how much the limitation actually changes what the reader sees.
// Only the leading one or two are shown; a stack of caveats reads as a broken
// product rather than an honest one.
const LIMITATION_ORDER = [
  "capped_by_thin_day",
  "capped_by_below_planner_candidate_threshold",
  "capped_by_unresolved_roles",
  "capped_by_remaining_day_short_route",
  "capped_by_role_order_fallback",
  "capped_by_heuristic_walking",
  "capped_by_external_only_sources",
  "capped_by_stale_candidate_cache",
  "capped_by_derived_timezone",
  "capped_by_partial_context",
];

const MAX_SHOWN = 2;

function phrases(stopCount) {
  const stops = Number.isFinite(stopCount) && stopCount > 0 ? stopCount : null;
  return {
    capped_by_thin_day: stops
      ? {
          sv: `En kortare dag — ${stops} ${stops === 1 ? "stopp" : "stopp"} håller vi för`,
          en: `A shorter day — ${stops} ${stops === 1 ? "stop" : "stops"} we can stand behind`,
        }
      : { sv: "En kortare dag än vanligt", en: "A shorter day than usual" },
    capped_by_below_planner_candidate_threshold: {
      sv: "få platser att välja mellan här",
      en: "few places to choose between here",
    },
    capped_by_unresolved_roles: {
      sv: "vissa typer av stopp hittade vi inte",
      en: "some kinds of stop we could not find",
    },
    capped_by_remaining_day_short_route: {
      sv: "kort rutt för det som är kvar av dagen",
      en: "a short route for what is left of today",
    },
    capped_by_role_order_fallback: {
      sv: "ordningen följer typ av stopp",
      en: "ordered by kind of stop",
    },
    capped_by_heuristic_walking: {
      sv: "gångavstånden är uppskattade",
      en: "walking distances are estimates",
    },
    capped_by_external_only_sources: {
      sv: "platserna kommer från externa källor",
      en: "places come from external sources",
    },
    capped_by_stale_candidate_cache: {
      sv: "platserna kommer från en något äldre cache",
      en: "places come from a slightly older cache",
    },
    capped_by_derived_timezone: {
      sv: "lokal tid är härledd",
      en: "local time is derived",
    },
    capped_by_partial_context: {
      sv: "en del dagskontext saknas",
      en: "some day context is missing",
    },
  };
}

/**
 * Build the caveat sentence for a published-but-limited day.
 *
 * @param {string[]} limitations  qualifying caps from the server
 * @param {number} stopCount      real stops in the day, for concrete copy
 * @param {(sv: string, en: string) => string} t  the caller's language picker
 * @returns {string} one sentence, or "" when there is nothing honest to add
 */
export function limitationNote(limitations, stopCount, t) {
  const copy = phrases(stopCount);
  const seen = [];
  for (const key of LIMITATION_ORDER) {
    if (Array.isArray(limitations) && limitations.includes(key) && copy[key]) seen.push(copy[key]);
    if (seen.length >= MAX_SHOWN) break;
  }
  if (seen.length === 0) return "";
  // Short sentences, not a chain of clauses. The leading phrase already uses an
  // em dash, so stacking more of them reads as hedging rather than honesty.
  return seen
    .map((entry) => sentence(t(entry.sv, entry.en)))
    .join(" ");
}

function sentence(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}
