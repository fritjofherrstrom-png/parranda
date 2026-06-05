/**
 * Agnostic route-output EXPERIMENT (#259) — flag-gated route mutation/synthesis.
 *
 * This is the first step from observability to capability on
 * /api/route-recommendations: behind an explicit experiment flag, a
 * coordinate-only / non-citypack ("any-place") request can RETURN an
 * experimental route built from trusted source-backed candidates — or, when
 * strict eligibility fails, honest blockers and no route.
 *
 * Hard rules:
 *   - Mutation/synthesis happens ONLY when the caller passes the explicit
 *     experiment flag (gated in app.js, NEVER by `inspect=`).
 *   - The baseline result object is never mutated in place: we deep-clone first.
 *   - Trusted candidates come ONLY from the server-injected openDataLoader. The
 *     public request payload can never inject candidates (fail-closed).
 *   - No named-city or narrow-intent branching: the agnostic context is built
 *     purely from coordinates.
 *   - The experimental route is honest: candidate role order with
 *     `order_confidence: "unvalidated"`, and NO eta / walking time / duration /
 *     opening-hours / "better route" claims.
 *
 * Pure except for the awaited trusted loader. Deterministic given its inputs.
 */

const { buildAgnosticCityContext } = require("../candidates/agnostic-context");
const { buildProviderSpecs } = require("../candidates/candidate-pool");
const { selectPlannerRoleCandidates } = require("./role-selector");
const { summarizeDayflowHonesty } = require("./dayflow-honesty");
const { buildCandidateCombinationInspect } = require("./candidate-combination-inspect");
const { buildRouteCandidateFromCandidateCombination } = require("./candidate-combination-route-adapter");
const { assessCityCandidateReadiness } = require("../place-candidates/readiness");

// A route needs at least an ordered pair of geocoded, stable-id stops. Fewer
// than this is honestly "not a route".
const MIN_VIABLE_GEOCODED_STOPS = 2;
// Geometry coherence that is honest enough to present an (unvalidated) order.
const ACCEPTABLE_COHERENCE = new Set(["strong", "ok"]);

// Loader status → explicit, honest blocker. Mirrors the #257 diagnostic mapping
// so HTTP and diagnostics never drift.
const LOADER_BLOCKERS = Object.freeze({
  no_loader_configured: "no_trusted_loader",
  no_anchor: "no_anchor_for_trusted_fetch",
  error_failed_closed: "loader_error",
  "loaded:0": "no_usable_trusted_records",
  skipped: "external_candidates_not_requested",
});

/**
 * Resolve trusted server-side candidate records. The public payload is never
 * consulted here — only the injected openDataLoader. Fail-closed: any
 * missing/empty/error state becomes an explicit status, never a throw.
 */
async function resolveTrustedHelpers({ externalRequested, openDataLoader, anchor }) {
  const baseStatus = {
    status: "skipped",
    external_candidates_requested: Boolean(externalRequested),
    anchor: anchor || null,
  };
  if (!externalRequested) {
    return { helpers: {}, sourceStatus: baseStatus };
  }
  if (typeof openDataLoader !== "function") {
    return { helpers: {}, sourceStatus: { ...baseStatus, status: "no_loader_configured" } };
  }
  if (!anchor) {
    return { helpers: {}, sourceStatus: { ...baseStatus, status: "no_anchor" } };
  }
  try {
    const records = await openDataLoader(anchor);
    if (!Array.isArray(records) || records.length === 0) {
      return { helpers: {}, sourceStatus: { ...baseStatus, status: "loaded:0" } };
    }
    return {
      helpers: { external_provider: { dataset: records } },
      sourceStatus: { ...baseStatus, status: `loaded:${records.length}` },
    };
  } catch (_error) {
    return { helpers: {}, sourceStatus: { ...baseStatus, status: "error_failed_closed" } };
  }
}

function safeAssessReadiness(cityConfig, options) {
  try {
    return assessCityCandidateReadiness(cityConfig, options);
  } catch (_error) {
    return null;
  }
}

/**
 * Decide whether a trusted candidate combination is eligible to BECOME the
 * returned route. Hard blockers prevent mutation; caveats accompany a produced
 * route. Readiness (#place-candidates/readiness thresholds) is surfaced as an
 * honest caveat, not a hard block — the produced route is always experimental.
 */
function evaluateEligibility({ externalRequested, sourceStatus, adaptedBody, candidateReadiness }) {
  const blockers = [];
  const caveats = ["walking_order_unvalidated"];
  const checks = {};

  checks.external_candidates_requested = Boolean(externalRequested);
  if (!externalRequested) {
    blockers.push("external_candidates_not_requested");
  }

  const loaderStatus = (sourceStatus && sourceStatus.status) || "skipped";
  checks.trusted_loader_status = loaderStatus;
  const loaderBlocker = LOADER_BLOCKERS[loaderStatus];
  // Avoid a duplicate "external_candidates_not_requested" when we already added
  // it above (loaderStatus stays "skipped" when external wasn't requested).
  if (externalRequested && loaderBlocker) {
    blockers.push(loaderBlocker);
  }

  const stops = Array.isArray(adaptedBody?.stops) ? adaptedBody.stops : [];
  const geocodedStops = stops.filter(
    (stop) =>
      stop &&
      stop.candidate_id &&
      stop.coordinates &&
      Number.isFinite(stop.coordinates.lat) &&
      Number.isFinite(stop.coordinates.lng),
  );
  const geocodedCount = geocodedStops.length;
  const coherence = (adaptedBody?.geometry_summary && adaptedBody.geometry_summary.coherence) || "incomplete";
  checks.geocoded_stop_count = geocodedCount;
  checks.geometry_coherence = coherence;
  if (geocodedCount < MIN_VIABLE_GEOCODED_STOPS) {
    blockers.push("insufficient_geocoded_candidates");
  }
  if (!ACCEPTABLE_COHERENCE.has(coherence)) {
    blockers.push(coherence === "incomplete" ? "incomplete_geometry" : "weak_geometry");
  }

  // Readiness reuse — honest SOFT caveat. A real, coherent trusted pair still
  // produces an (experimental) route, but we never hide that the place is below
  // the planner-candidate readiness bar.
  checks.can_support_planner = candidateReadiness ? Boolean(candidateReadiness.can_support_planner) : null;
  checks.real_place_count = candidateReadiness ? candidateReadiness.real_place_count ?? null : null;
  checks.coordinate_coverage = candidateReadiness ? candidateReadiness.coordinate_coverage ?? null : null;
  if (candidateReadiness && candidateReadiness.can_support_planner === false) {
    caveats.push("below_planner_candidate_threshold");
  }

  return {
    eligible: blockers.length === 0,
    blockers: dedupe(blockers),
    caveats: dedupe(caveats),
    checks,
  };
}

/**
 * Build the experimental primary_route from the adapted candidate body. It is
 * deliberately a DISTINCT, clearly-experimental shape: it omits estimated_km,
 * legs, walking minutes, and opening hours so it can never be mistaken for a
 * validated route.
 */
function buildExperimentalPrimaryRoute({ cityKey, adaptedBody }) {
  const stops = (Array.isArray(adaptedBody?.stops) ? adaptedBody.stops : []).map((stop) => ({
    id: stop.candidate_id || null,
    label: stop.label || null,
    role: stop.role || null,
    origin: stop.origin || null,
    confidence: stop.confidence || null,
    lat: stop.coordinates && Number.isFinite(stop.coordinates.lat) ? stop.coordinates.lat : null,
    lng: stop.coordinates && Number.isFinite(stop.coordinates.lng) ? stop.coordinates.lng : null,
  }));
  const stopIds = stops.map((stop) => stop.id).filter(Boolean);

  return {
    id: `agnostic-experimental:${cityKey || "agnostic"}:${[...stopIds].sort().join("+") || "empty"}`,
    experimental: true,
    experimental_agnostic_route: true,
    source: "trusted_candidate_pool",
    // Neutral, honest title — no city name, no "better/best/optimal/fastest".
    title: "Experimental any-place candidate route",
    summary:
      "Experimental route composed from trusted source-backed candidates. Stop order is unvalidated; no walking time, ETA, or opening hours are implied.",
    main_stops: stops,
    target_roles: Array.isArray(adaptedBody?.target_roles) ? adaptedBody.target_roles : [],
    unresolved_roles: Array.isArray(adaptedBody?.unresolved_roles) ? adaptedBody.unresolved_roles : [],
    geometry_summary: adaptedBody?.geometry_summary || null,
    trust_summary: adaptedBody?.trust_summary || null,
    order_source: "candidate_role_order",
    order_confidence: "unvalidated",
    routing_source: "none",
    caveats: ["walking_order_unvalidated", "no_eta", "no_walking_time", "no_opening_hours", "experimental"],
  };
}

/**
 * A minimal, clearly-experimental day for an unknown/non-citypack place whose
 * baseline returned `days: []`. It intentionally does NOT mimic a finalized
 * Planner day: no date_signals, no dayflow_context, no alternatives.
 */
function buildExperimentalDay({ date, primaryRoute }) {
  return {
    date: date || null,
    experimental: true,
    experimental_agnostic_day: true,
    source: "agnostic_route_output_experiment",
    note: "Experimental any-place candidate day — not a finalized Parranda planner day.",
    primary_route: primaryRoute,
    alternatives: [],
  };
}

/**
 * Deep-clone the baseline result, then either replace days[0].primary_route or
 * synthesize a minimal experimental first day. The original is never mutated.
 */
function applyRouteMutation({ baselineResult, primaryRoute, date }) {
  const clone = deepClone(baselineResult);
  const days = Array.isArray(clone.days) ? clone.days : [];

  if (days[0] && days[0].primary_route) {
    days[0].primary_route = primaryRoute;
    days[0].experimental_agnostic_route_applied = true;
    clone.days = days;
  } else {
    clone.days = [buildExperimentalDay({ date, primaryRoute }), ...days.slice(1)];
  }
  return clone;
}

function buildExperimentBlock({
  routeMutation,
  eligibility,
  baselineResult,
  candidateReadiness,
  experimentalRoute,
  sourceStatus,
}) {
  const baselineDay = baselineResult && Array.isArray(baselineResult.days) ? baselineResult.days[0] : null;
  return {
    experimental: true,
    route_mutation: routeMutation,
    selected_variant: routeMutation ? "experimental_agnostic" : "baseline",
    source: "trusted_candidate_pool",
    source_status: sourceStatus || null,
    eligibility,
    baseline: {
      had_primary_route: Boolean(baselineDay && baselineDay.primary_route),
      primary_route: (baselineDay && baselineDay.primary_route) || null,
      readiness: (baselineResult && baselineResult.readiness) || null,
    },
    candidate_readiness: candidateReadiness || null,
    experimental_route: routeMutation ? experimentalRoute : null,
    readiness_blockers: eligibility.blockers,
    caveats: eligibility.caveats,
  };
}

function buildBlockedAgnosticRouteOutputExperiment({ baselineResult, blocker, sourceStatus = null }) {
  return buildExperimentBlock({
    routeMutation: false,
    eligibility: {
      eligible: false,
      blockers: [blocker],
      caveats: [],
      checks: {},
    },
    baselineResult,
    candidateReadiness: null,
    experimentalRoute: null,
    sourceStatus,
  });
}

/**
 * Compose the agnostic route-output experiment.
 *
 * @returns {Promise<{ result: object, experiment: object }>} `result` is the
 *   baseline (unchanged) when not eligible, or a deep-cloned mutated/synthesized
 *   result when eligible. `experiment` is the top-level diagnostics block.
 */
async function composeAgnosticRouteOutput({
  coords,
  baselineResult,
  externalRequested = false,
  openDataLoader = null,
  preferences = [],
  lens = null,
  weather = null,
  date = null,
  todayIsoDate = null,
  timezone = "UTC",
}) {
  const agnosticContext = buildAgnosticCityContext({
    lat: coords.lat,
    lng: coords.lng,
    timezone: timezone || "UTC",
    todayIsoDate: typeof todayIsoDate === "function" ? todayIsoDate : todayIsoDate || undefined,
  });
  const origin = { lat: coords.lat, lng: coords.lng };
  const effectiveDate = date || agnosticContext.todayIsoDate();

  const { helpers, sourceStatus } = await resolveTrustedHelpers({
    externalRequested,
    openDataLoader,
    anchor: origin,
  });

  const rolePayload = {
    city: agnosticContext.key,
    date: effectiveDate,
    preferences: Array.isArray(preferences) ? preferences : [],
    lens: lens || null,
    weather: weather || null,
    origin,
    // Signal the engine's external opt-in so the source-backed provider runs.
    include_external_candidates: externalRequested ? 1 : undefined,
    candidate_sources: externalRequested ? "open" : undefined,
  };

  const plannerRoles = selectPlannerRoleCandidates(agnosticContext, rolePayload, helpers);
  const dayflowHonesty = summarizeDayflowHonesty(plannerRoles);
  const candidateCombination = buildCandidateCombinationInspect({
    plannerRoles,
    dayflowHonesty,
    route: null,
    options: { origin },
  });
  const adapted = buildRouteCandidateFromCandidateCombination({
    city: agnosticContext.key,
    candidateCombination,
  });
  const adaptedBody = adapted && adapted.body ? adapted.body : {};

  const providerSpecs = buildProviderSpecs({
    externalEnabled: Boolean(externalRequested),
    externalOptions: helpers.external_provider || null,
    now: effectiveDate,
  });
  const candidateReadiness = safeAssessReadiness(agnosticContext, { providerSpecs });

  const eligibility = evaluateEligibility({
    externalRequested,
    sourceStatus,
    adaptedBody,
    candidateReadiness,
  });

  if (!eligibility.eligible) {
    return {
      result: baselineResult,
      experiment: buildExperimentBlock({
        routeMutation: false,
        eligibility,
        baselineResult,
        candidateReadiness,
        experimentalRoute: null,
        sourceStatus,
      }),
    };
  }

  const experimentalRoute = buildExperimentalPrimaryRoute({ cityKey: agnosticContext.key, adaptedBody });
  const mutated = applyRouteMutation({ baselineResult, primaryRoute: experimentalRoute, date: effectiveDate });

  return {
    result: mutated,
    experiment: buildExperimentBlock({
      routeMutation: true,
      eligibility,
      baselineResult,
      candidateReadiness,
      experimentalRoute,
      sourceStatus,
    }),
  };
}

function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function dedupe(list) {
  return [...new Set(list)];
}

module.exports = {
  composeAgnosticRouteOutput,
  resolveTrustedHelpers,
  evaluateEligibility,
  buildExperimentalPrimaryRoute,
  buildExperimentalDay,
  applyRouteMutation,
  buildExperimentBlock,
  buildBlockedAgnosticRouteOutputExperiment,
  MIN_VIABLE_GEOCODED_STOPS,
};
