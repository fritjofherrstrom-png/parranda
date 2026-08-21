/**
 * Agnostic route promotion gate (v2 — graded).
 *
 * Decides whether an agnostic-composed route is honest enough to be PROMOTED —
 * i.e. returned as the actual Planner route for a resolved, non-citypack place —
 * versus withheld with the baseline returned.
 *
 * v1 asked one question ("is every readiness cap on a six-item allowlist?") and
 * answered it with a boolean. That conflated two different verdicts:
 *
 *   PRODUCT INVALIDITY   the day would be untrue — withhold it
 *   PRODUCT LIMITATION   the day is real and useful, but smaller or less
 *                        certain than ideal — publish it, labelled
 *
 * Almost every cap calibration emits is the second kind. A two-stop walk
 * between two real, open, walk-validated places is a limited day, not a false
 * one, and withholding it is strictly less honest than showing it and saying
 * it is short. So the policy inverts: caps describe limitations by default, and
 * only a named, structural condition can disqualify a route.
 *
 * The disqualifying conditions are deliberately few:
 *
 *   - no calibration at all
 *   - a weak place anchor            (never publish invented geography)
 *   - a status/level that means no usable route was produced
 *   - an unvalidated walking contract
 *   - a REQUESTED intent left unmet  (see below)
 *
 * The last one is what keeps Planner intent primary. Relaxing the gate must not
 * let "I want dinner" quietly become a day with no dinner.
 *
 * The line is drawn at coverage, not at perfection. A day that covers some of
 * what was asked and reports the rest as missing is a limited answer to the
 * right question — and it is never silent, because preference coverage is
 * already a public part of the response. A day that covers NONE of the
 * requested intents is not that day at all, and is refused. Refusing every
 * partial cover would simply reinstate the over-refusal this change exists to
 * remove: multi-preference requests are the norm, and a place with great food
 * and no viewpoint should still get its food.
 *
 * Pure / side-effect free.
 */

const { intentsForRole } = require("./role-selector");

// A status/level pair outside these means calibration never saw a usable route
// (blocked, not_applicable, unavailable). Unchanged from v1.
const PROMOTABLE_STATUSES = new Set(["thin_usable", "usable"]);
const PROMOTABLE_LEVELS = new Set(["low", "medium"]);

// Retained for callers and tests that describe the v1 vocabulary. These are the
// caps that were promotable BEFORE grading; they are now simply the subset of
// limitations that happen to be the least severe.
const ALLOWED_CAPS = new Set([
  "capped_by_external_only_sources",
  "capped_by_derived_timezone",
  "capped_by_partial_context",
  "capped_by_heuristic_walking",
  "capped_by_remaining_day_short_route",
  "capped_by_stale_candidate_cache",
]);

const REQUESTED_INTENT_UNMET_CAP = "capped_by_requested_intent_unmet";
const REQUESTED_INTENT_PARTIAL_CAP = "capped_by_requested_intent_partial";

/**
 * @param {object} params
 * @param {object|null} params.calibration       calibrateAgnosticRouteReadiness() result
 * @param {boolean} params.strongAnchor          place anchor resolved confidently
 * @param {Array} params.unresolvedRoles         experimental_route.unresolved_roles
 * @param {Array<string>} params.requestedIntents canonical intents the user asked for
 * @param {object|null} params.preferenceCoverage constraint_negotiation.preference_coverage
 * @returns {{
 *   readiness: "promotable"|"promotable_limited"|"non_promotable",
 *   promote: boolean,
 *   qualifying_caps: string[],
 *   disqualifying_caps: string[],
 *   unmet_requested_intents: string[],
 *   reasons: string[],
 *   blocked_caps: string[]
 * }}
 */
function classifyPromotionReadiness({
  calibration = null,
  strongAnchor = false,
  unresolvedRoles = [],
  requestedIntents = [],
  preferenceCoverage = null,
} = {}) {
  if (!calibration || typeof calibration !== "object") {
    return verdict({ reasons: ["no_calibration"], disqualifying: ["capped_by_non_promotable"] });
  }

  const status = calibration.status || null;
  const level = calibration.level || null;
  // Only `capped_by_*` tokens are real limitations; the always-present
  // `experimental_agnostic_route` marker is not one.
  const caps = (Array.isArray(calibration.caps) ? calibration.caps : [])
    .filter((cap) => String(cap).startsWith("capped_by_"))
    .slice();

  const reasons = [];
  const disqualifying = [];

  if (!strongAnchor) {
    reasons.push("anchor_not_strong");
    disqualifying.push("capped_by_non_promotable");
  }
  if (!PROMOTABLE_STATUSES.has(status)) {
    reasons.push(`status_not_promotable:${status || "none"}`);
    disqualifying.push("capped_by_non_promotable");
  }
  if (!PROMOTABLE_LEVELS.has(level)) {
    reasons.push(`level_not_promotable:${level || "none"}`);
    disqualifying.push("capped_by_non_promotable");
  }
  // A route that never passed walking validation is not a limited day, it is an
  // unsound one. Calibration normally withholds routeMutation in that case; this
  // is an explicit second guard so grading can never leak an unwalked order.
  if (calibration.inputs && calibration.inputs.walking_valid === false) {
    reasons.push("walking_contract_unvalidated");
    disqualifying.push("capped_by_non_promotable");
  }

  const intent = requestedIntentVerdict({ preferenceCoverage, unresolvedRoles, requestedIntents });
  if (intent.unmet.length > 0) {
    for (const name of intent.unmet) reasons.push(`requested_intent_unmet:${name}`);
    if (intent.coveredNone) {
      // The day answers none of what was asked. That is a different day, not a
      // thinner one.
      reasons.push("no_requested_intent_covered");
      disqualifying.push(REQUESTED_INTENT_UNMET_CAP);
    } else {
      // Partially covered: a real answer with an honest gap. Preference
      // coverage already states the gap publicly.
      caps.push(REQUESTED_INTENT_PARTIAL_CAP);
    }
  }

  if (disqualifying.length > 0) {
    return verdict({
      reasons,
      disqualifying: unique(disqualifying),
      qualifying: caps,
      unmetRequested: intent.unmet,
    });
  }

  // Everything calibration flagged is a limitation on a real day.
  return verdict({
    reasons: [...reasons, caps.length ? "promoted_with_limitations" : "promoted_unlimited"],
    qualifying: caps,
    unmetRequested: intent.unmet,
    promote: true,
  });
}

/**
 * What the user asked for versus what the day covers.
 *
 * The engine path publishes a first-class preference coverage verdict; the
 * in-module synthesizer path does not, so unresolved roles are the fallback.
 */
function requestedIntentVerdict({ preferenceCoverage, unresolvedRoles, requestedIntents }) {
  const coverage = preferenceCoverage && typeof preferenceCoverage === "object" ? preferenceCoverage : null;
  const requestedFromCoverage = list(coverage && coverage.requested_preferences);
  if (requestedFromCoverage.length > 0) {
    const covered = list(coverage.covered_preferences).concat(list(coverage.partial_preferences));
    const missing = list(coverage.missing_preferences);
    return { unmet: missing, coveredNone: missing.length > 0 && covered.length === 0 };
  }
  const unmet = unmetRequestedIntents(unresolvedRoles, requestedIntents);
  const requested = list(requestedIntents);
  return { unmet, coveredNone: unmet.length > 0 && unmet.length >= requested.length };
}

function list(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
}

function unmetRequestedIntents(unresolvedRoles, requestedIntents) {
  const requested = new Set(
    (Array.isArray(requestedIntents) ? requestedIntents : [])
      .map((intent) => String(intent || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (requested.size === 0) return [];
  const unmet = [];
  for (const entry of Array.isArray(unresolvedRoles) ? unresolvedRoles : []) {
    const role = typeof entry === "string" ? entry : entry && entry.role;
    for (const intent of intentsForRole(role)) {
      if (requested.has(intent) && !unmet.includes(intent)) unmet.push(intent);
    }
  }
  return unmet;
}

function verdict({ reasons = [], qualifying = [], disqualifying = [], unmetRequested = [], promote = false }) {
  const qualifyingCaps = unique(qualifying);
  const disqualifyingCaps = unique(disqualifying);
  const readiness = !promote
    ? "non_promotable"
    : qualifyingCaps.length > 0
      ? "promotable_limited"
      : "promotable";
  return {
    readiness,
    promote,
    qualifying_caps: promote ? qualifyingCaps : [],
    disqualifying_caps: disqualifyingCaps,
    unmet_requested_intents: unique(unmetRequested),
    reasons: unique(reasons),
    // v1 field name, kept so existing readers and diagnostics keep working.
    blocked_caps: disqualifyingCaps,
  };
}

function unique(values) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * v1 signature, preserved. Callers that only need the boolean keep working;
 * `promote` now means "publishable", including publishable-with-limitations.
 */
function evaluateAgnosticPromotion(params = {}) {
  return classifyPromotionReadiness(params);
}

module.exports = {
  ALLOWED_CAPS,
  PROMOTABLE_STATUSES,
  PROMOTABLE_LEVELS,
  REQUESTED_INTENT_UNMET_CAP,
  REQUESTED_INTENT_PARTIAL_CAP,
  classifyPromotionReadiness,
  evaluateAgnosticPromotion,
};
