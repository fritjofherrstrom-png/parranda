/**
 * Honest copy for a day the server published WITH limitations.
 *
 * The server decides whether a day is publishable; this only decides how to say
 * what is thin about it. Every phrase describes evidence we do or do not have —
 * never a promise, never an invented time, never an apology.
 *
 * The caps fall into two kinds, and each kind has its own place on the page:
 *
 *   - What the day CONTAINS: a shorter day, few places to choose between, kinds
 *     of stop that could not be found. These change how the reader should take
 *     the plan, so `limitationNote` gives them to the day header.
 *   - HOW the day was assembled: estimated walking, where the places came from,
 *     how the local time was known. Just as true, but they qualify the evidence
 *     rather than the plan, so `contextNote` states them beside that evidence
 *     (the map and its estimates) instead of competing with the day's headline.
 *     Nearly every source-backed day carries several of them; stacked under the
 *     title they read as a broken product rather than an honest one.
 */

// Ordered by how much the limitation actually changes what the reader sees.
// Only the leading one or two are shown.
//
// `capped_by_requested_intent_partial` is DELIBERATELY absent. The day header
// already names the exact intents by their own labels ("Views · partly") from
// stop-level covered_preferences. A vague second sentence next to a specific
// one is worse than no sentence, so that cap intentionally renders nothing here.
const DAY_SHAPE_LIMITATIONS = [
  "capped_by_thin_day",
  "capped_by_below_planner_candidate_threshold",
  "capped_by_unresolved_roles",
  "capped_by_remaining_day_short_route",
  "capped_by_role_order_fallback",
];

// Ordered the same way. A caller passes `statedElsewhere` for a cap that a more
// specific line on the page already says in full, so it is never said twice.
const CONTEXT_LIMITATIONS = [
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
    // The timezone was inferred from the coordinates (by the weather service)
    // rather than attested by the place resolver. Say what that means for the
    // reader — the clock the day is read against — not the mechanism.
    capped_by_derived_timezone: {
      sv: "lokal tid härleds från platsen",
      en: "local time is inferred from the location",
    },
    capped_by_partial_context: {
      sv: "en del dagskontext saknas",
      en: "some day context is missing",
    },
  };
}

function sentencesFor(keys, limitations, copy, t, max) {
  const seen = [];
  for (const key of keys) {
    if (Array.isArray(limitations) && limitations.includes(key) && copy[key]) seen.push(copy[key]);
    if (seen.length >= max) break;
  }
  // Short sentences, not a chain of clauses. The leading phrase already uses an
  // em dash, so stacking more of them reads as hedging rather than honesty.
  return seen.map((entry) => sentence(t(entry.sv, entry.en))).join(" ");
}

/**
 * The caveat sentence for WHAT a published-but-limited day contains.
 *
 * @param {string[]} limitations  qualifying caps from the server
 * @param {number} stopCount      real stops in the day, for concrete copy
 * @param {(sv: string, en: string) => string} t  the caller's language picker
 * @returns {string} one or two sentences, or "" when there is nothing honest to add
 */
export function limitationNote(limitations, stopCount, t) {
  return sentencesFor(DAY_SHAPE_LIMITATIONS, limitations, phrases(stopCount), t, MAX_SHOWN);
}

/**
 * The caveat sentences for HOW a published day was assembled.
 *
 * @param {string[]} limitations  qualifying caps from the server
 * @param {(sv: string, en: string) => string} t  the caller's language picker
 * @param {{ statedElsewhere?: string[] }} [options]  caps another line on the
 *        page already states in full; they are not repeated here
 * @returns {string} short sentences, or "" when there is nothing to add
 */
export function contextNote(limitations, t, { statedElsewhere = [] } = {}) {
  const skip = new Set(Array.isArray(statedElsewhere) ? statedElsewhere : []);
  const keys = CONTEXT_LIMITATIONS.filter((key) => !skip.has(key));
  return sentencesFor(keys, limitations, phrases(null), t, CONTEXT_LIMITATIONS.length);
}

function sentence(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}
