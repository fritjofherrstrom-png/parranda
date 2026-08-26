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
 *     human verification, an exact operator-reviewed official source policy,
 *     OR provenance diversity — popularity alone never promotes. This is the
 *     anti-"review product" invariant.
 *
 * NOTE: this module is additive. It does NOT replace display-gates.js; Pulse
 * keeps using that for its event stream this release. The gate names here are a
 * superset:  may_show_in_pulse ≈ may_show, and may_influence_routes /
 * may_create_place_candidate / may_show_as_nearby match Pulse's names directly.
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
  "may_influence_routes",
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
  // Structural candidates (area_preset / structural_anchor) are route STRUCTURE,
  // not user places. They may still anchor/influence a route shape when trusted,
  // but they must never be offered to a user as a place/nearby/now suggestion.
  const isStructural = target.is_structural === true;
  const humanVerified = target.human_verified === true;
  const reviewedOfficialSource =
    target.operator_reviewed_source === true &&
    target.source_family === "official" &&
    target.source_tier === "official" &&
    target.source_policy === "reviewed_profile_bounded_refresh";
  const hasReliablePlaceTarget = resolvePlaceTarget(target, reasons);

  // Promotion gate: good enough to materialize or steer a route. Popularity is
  // intentionally absent here — only place verification, an exact server-owned
  // official source review, or cross-family corroboration can unlock it.
  const corroborated = humanVerified || reviewedOfficialSource || diversity >= 2;
  if (humanVerified) reasons.push("human_verified");
  if (reviewedOfficialSource) reasons.push("operator_reviewed_official_source");
  if (diversity >= 2) reasons.push("provenance_diversity_ok");

  // A place must clear a low existence bar to show; a context signal (weather)
  // shows on the strength of its own label, since it is not a place claim.
  const mayShow = isContext ? hasLabel : hasLabel && confidenceAtLeast(existence, "low");
  if (mayShow) reasons.push("eligible_to_show");

  // User-facing place gates: structural route scaffolding is excluded from all
  // of these, even when trusted.
  const userPlaceEligible = !isContext && !isStructural;

  const mayShowAsNearby =
    userPlaceEligible && hasReliablePlaceTarget && confidenceAtLeast(existence, "medium");

  const mayCreatePlaceCandidate =
    userPlaceEligible &&
    hasReliablePlaceTarget &&
    confidenceAtLeast(existence, "medium") &&
    corroborated;

  // Route-structure gates: structural candidates MAY participate here when
  // trusted (a structural_anchor carrying a route shape is exactly this case).
  const mayInfluenceRoutes =
    !isContext &&
    hasReliablePlaceTarget &&
    confidenceAtLeast(existence, "medium") &&
    corroborated;

  const mayAnchorRoute =
    !isContext &&
    hasReliablePlaceTarget &&
    confidenceAtLeast(existence, "high") &&
    corroborated;

  const maySuggestNow = mayShowAsNearby; // time-of-day gating arrives with Blitz step

  // Anything that can't be shown to a user is still inspectable for debugging.
  const mayShowInDebugOnly = !mayShow;
  if (isContext) reasons.push("context_not_a_place");
  if (isStructural) reasons.push("structural_route_only");
  if (!hasReliablePlaceTarget && !isContext) reasons.push("no_reliable_place_target");
  if (mayShow && !mayShowAsNearby && !isContext && !isStructural) {
    reasons.push("shown_but_not_route_eligible");
  }
  if (!corroborated && hasReliablePlaceTarget && confidenceAtLeast(existence, "medium")) {
    reasons.push("blocked_promotion_uncorroborated");
  }

  return {
    may_show: mayShow,
    may_suggest_now: maySuggestNow,
    may_show_as_nearby: mayShowAsNearby,
    may_influence_routes: mayInfluenceRoutes,
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
  const candidateKind = candidate.candidate_kind || "";

  // A generic normalized candidate id is NOT a reliable place target — a future
  // draft/source-backed/url-derived candidate carries an id but may be nowhere
  // real. Only an explicit known_place_id counts, OR the candidate's own id when
  // it is a verified, Parranda-owned catalog place.
  const verifiedCatalogPlace =
    candidate.city_pack_owned === true && trust.human_verified === true;
  const knownPlaceId =
    hasText(candidate.known_place_id)
      ? candidate.known_place_id
      : verifiedCatalogPlace && hasText(candidate.id)
        ? candidate.id
        : "";

  return {
    label: candidate.label || candidate.name || "",
    lat: candidate.lat,
    lng: candidate.lng,
    known_place_id: knownPlaceId,
    candidate_kind: candidateKind,
    is_structural:
      candidate.is_structural === true ||
      ["area_preset", "structural_anchor"].includes(candidateKind),
    human_verified: trust.human_verified === true,
    operator_reviewed_source: candidate.operator_reviewed_source === true,
    source_family: candidate.source_family || "",
    source_tier: trust.source_tier || "",
    source_policy: candidate.source_policy || "",
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
