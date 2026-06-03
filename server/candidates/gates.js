/**
 * Candidate Intelligence Spine — Universal eligibility gates v1.
 *
 * Generalizes the Pulse display-gate idea (pulse-sources/display-gates.js,
 * which is event-only) into a candidate-level primitive. Gates decide WHAT a
 * candidate is ALLOWED to do — never how it ranks. Ranking is Fit's job.
 *
 * This is where the hard product boundaries live:
 *   - weather/context can influence and explain, but cannot become a place
 *   - a source-url-only event cannot become a place/route target
 *   - weak candidates remain inspectable but hidden from users
 *   - PROMOTION (anchor/create) requires a reliable place target plus either
 *     human verification OR provenance diversity — popularity alone never
 *     promotes. This is the anti-"review product" invariant.
 *
 * NOTE: this module is additive. It does NOT replace display-gates.js; Pulse
 * keeps using that for its event stream this release. The gate names here are a
 * superset:  may_show_in_pulse ≈ may_show, may_influence_routes ≈
 * may_influence_route, may_create_place_candidate / may_show_as_nearby match.
 *
 * Pure given (target, derived, context).
 *
 * @param {object} params
 * @param {object} params.target    Light place descriptor (see targetFromPlaceCandidate).
 * @param {object} params.derived   Output of reduceEvidence().
 * @param {object} [params.context] Reserved (time/weather). Unused in v1 gates.
 * @returns {object} gate decisions + reasons
 */

const { confidenceAtLeast } = require("./confidence");

const GATE_KEYS = [
  "may_show",
  "may_suggest_now",
  "may_show_as_nearby",
  "may_influence_route",
  "may_create_place_candidate",
  "may_anchor_route",
  "may_show_in_debug_only",
];

function evaluateCandidateGates({ target = {}, derived = {}, context = {} } = {}) {
  const reasons = [];

  const existence = derived.existence_confidence || "needs_review";
  const diversity = Number.isFinite(derived.provenance_diversity)
    ? derived.provenance_diversity
    : 0;
  const hasLabel = hasText(target.label);
  const isContext = target.is_context === true;
  const humanVerified = target.human_verified === true;
  const hasReliablePlaceTarget = resolvePlaceTarget(target, reasons);

  // Promotion gate: good enough to materialize or steer a route. Popularity is
  // intentionally absent here — only verification or cross-family corroboration
  // (diversity >= 2) can unlock it.
  const corroborated = humanVerified || diversity >= 2;
  if (humanVerified) reasons.push("human_verified");
  if (diversity >= 2) reasons.push("provenance_diversity_ok");

  // A place must clear a low existence bar to show; a context signal (weather)
  // shows on the strength of its own label, since it is not a place claim.
  const mayShow = isContext ? hasLabel : hasLabel && confidenceAtLeast(existence, "low");
  if (mayShow) reasons.push("eligible_to_show");

  const mayShowAsNearby =
    !isContext && hasReliablePlaceTarget && confidenceAtLeast(existence, "medium");

  const mayInfluenceRoute =
    !isContext &&
    hasReliablePlaceTarget &&
    confidenceAtLeast(existence, "medium") &&
    corroborated;

  const mayCreatePlaceCandidate = mayInfluenceRoute;

  const mayAnchorRoute =
    !isContext &&
    hasReliablePlaceTarget &&
    confidenceAtLeast(existence, "high") &&
    corroborated;

  const maySuggestNow = mayShowAsNearby; // time-of-day gating arrives with Blitz step

  // Anything that can't be shown to a user is still inspectable for debugging.
  const mayShowInDebugOnly = !mayShow;
  if (isContext) reasons.push("context_not_a_place");
  if (!hasReliablePlaceTarget && !isContext) reasons.push("no_reliable_place_target");
  if (mayShow && !mayShowAsNearby && !isContext) reasons.push("shown_but_not_route_eligible");
  if (!corroborated && hasReliablePlaceTarget && confidenceAtLeast(existence, "medium")) {
    reasons.push("blocked_promotion_uncorroborated");
  }

  return {
    may_show: mayShow,
    may_suggest_now: maySuggestNow,
    may_show_as_nearby: mayShowAsNearby,
    may_influence_route: mayInfluenceRoute,
    may_create_place_candidate: mayCreatePlaceCandidate,
    may_anchor_route: mayAnchorRoute,
    may_show_in_debug_only: mayShowInDebugOnly,
    reasons,
  };
}

function resolvePlaceTarget(target, reasons) {
  if (hasCoordinates(target)) {
    reasons.push("has_coordinates");
    return true;
  }
  if (hasText(target.known_place_id)) {
    reasons.push("has_known_place");
    return true;
  }
  // A source URL or a bare title is NOT a place target.
  return false;
}

/**
 * Build the light gate target descriptor from a normalized place candidate.
 */
function targetFromPlaceCandidate(candidate = {}) {
  const trust = candidate.trust || {};
  return {
    label: candidate.label || candidate.name || "",
    lat: candidate.lat,
    lng: candidate.lng,
    known_place_id: candidate.known_place_id || candidate.id || "",
    candidate_kind: candidate.candidate_kind || "",
    human_verified: trust.human_verified === true,
    is_context: false,
  };
}

/**
 * Build a gate target descriptor for a context-like signal (weather, etc.).
 * These can show/explain but structurally cannot become places or route stops.
 */
function targetFromContextSignal(signal = {}) {
  return {
    label: signal.label || signal.title || "",
    is_context: true,
    human_verified: false,
  };
}

function hasCoordinates(value = {}) {
  return Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  GATE_KEYS,
  evaluateCandidateGates,
  targetFromPlaceCandidate,
  targetFromContextSignal,
};
