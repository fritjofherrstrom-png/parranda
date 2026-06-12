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
 *   - The experimental route is honest: candidate role order can seed a small
 *     proximity sequence, but only inside this flag-gated experiment and only
 *     when the produced order passes walking-budget validation. It still
 *     surfaces walking distance/minute ESTIMATES — never a live arrival time,
 *     opening hours, or "better/optimal/fastest/shortest" claims.
 *
 * Pure except for the awaited trusted loader + injectable walking router.
 * Deterministic given its inputs.
 */

const { buildAgnosticCityContext } = require("../candidates/agnostic-context");
const { buildProviderSpecs } = require("../candidates/candidate-pool");
const { selectPlannerRoleCandidates } = require("./role-selector");
const { summarizeDayflowHonesty } = require("./dayflow-honesty");
const { buildCandidateCombinationInspect } = require("./candidate-combination-inspect");
const { buildRouteCandidateFromCandidateCombination } = require("./candidate-combination-route-adapter");
const { assessCityCandidateReadiness } = require("../place-candidates/readiness");
const { validateAgnosticWalkingOrder } = require("./agnostic-route-walking-validation");
const { buildAgnosticRouteOrdering } = require("./agnostic-route-ordering");
const { resolveAgnosticContext, collectInfluenceReasons } = require("./agnostic-route-context");
const { buildDayflowContext } = require("./dayflow-context");
const { calibrateAgnosticRouteReadiness } = require("./agnostic-route-readiness-calibration");

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
    const loaderStatus = typeof records?.loader_status === "string" ? records.loader_status : null;
    const loaderError = records?.loader_error || null;
    if (loaderStatus === "error_failed_closed") {
      return {
        helpers: {},
        sourceStatus: { ...baseStatus, status: "error_failed_closed", error: loaderError },
      };
    }
    if (!Array.isArray(records) || records.length === 0) {
      return { helpers: {}, sourceStatus: { ...baseStatus, status: "loaded:0", error: loaderError } };
    }
    return {
      helpers: { external_provider: { dataset: records } },
      sourceStatus: { ...baseStatus, status: `loaded:${records.length}`, error: loaderError },
    };
  } catch (_error) {
    return { helpers: {}, sourceStatus: { ...baseStatus, status: "error_failed_closed", error: "fetch_error" } };
  }
}

function safeAssessReadiness(cityConfig, options) {
  try {
    return assessCityCandidateReadiness(cityConfig, options);
  } catch (_error) {
    return null;
  }
}

function admitExperimentalInferredExternalCandidate({ candidate, derived, gates } = {}) {
  const hasCoords = Number.isFinite(candidate?.lat) && Number.isFinite(candidate?.lng);
  const attribution = collectCandidateAttribution(candidate);
  const sourceTier = String(candidate?.trust?.source_tier || "").toLowerCase();
  const external = candidate?.candidate_origin === "external_open" || candidate?.city_pack_owned === false;
  const sourceBacked = attribution.length > 0;
  if (!external || sourceTier !== "inferred" || !hasCoords || !hasText(candidate?.label) || !sourceBacked) {
    return { allowed: false };
  }
  const gateReasons = Array.isArray(gates?.reasons) ? gates.reasons : [];
  const reasons = dedupe([
    "experimental_inferred_external_admission",
    "source_backed_external_candidate",
    "has_coordinates",
    ...gateReasons,
  ]);
  if (candidate?.trust?.human_verified !== true && Number(derived?.provenance_diversity || 0) < 2) {
    reasons.push("blocked_promotion_uncorroborated");
  }
  if (String(derived?.existence_confidence || "") === "low") {
    reasons.push("low_existence_confidence");
  }
  return {
    allowed: true,
    policy: "experimental_inferred_external",
    reasons: dedupe(reasons),
    gate_reasons: gateReasons,
  };
}

function collectCandidateAttribution(candidate) {
  const evidence = Array.isArray(candidate?.evidence) ? candidate.evidence : [];
  return evidence
    .map((item) => item && item.source_ref)
    .filter((ref) => ref && (hasText(ref.provider_id) || hasText(ref.url) || hasText(ref.label)));
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Decide whether a trusted candidate combination is eligible to BECOME the
 * returned route. Hard blockers prevent mutation; caveats accompany a produced
 * route. Readiness (#place-candidates/readiness thresholds) is surfaced as an
 * honest caveat, not a hard block — the produced route is always experimental.
 */
function evaluateEligibility({ externalRequested, sourceStatus, adaptedBody, candidateReadiness }) {
  const blockers = [];
  // Walking-order honesty is decided downstream by the #261 walking-budget
  // validation step — not pre-asserted here.
  const caveats = [];
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
 * Build the experimental primary_route from the adapted candidate body. It stays
 * clearly experimental. Without #261 walking validation it omits geometry/timing;
 * after validation it uses the existing route-result walking fields (`legs`,
 * `map_path_points`) while still avoiding opening-hours/live-arrival claims.
 */
function buildExperimentalPrimaryRoute({ cityKey, adaptedBody, walkingValidation = null, routeOrdering = null }) {
  const inputStops = Array.isArray(adaptedBody?.stops) ? adaptedBody.stops : [];
  const stops = inputStops.map((stop) => ({
    id: stop.candidate_id || null,
    label: stop.label || null,
    role: stop.role || null,
    origin: stop.origin || null,
    confidence: stop.confidence || null,
    lat: stop.coordinates && Number.isFinite(stop.coordinates.lat) ? stop.coordinates.lat : null,
    lng: stop.coordinates && Number.isFinite(stop.coordinates.lng) ? stop.coordinates.lng : null,
  }));
  const stopIds = stops.map((stop) => stop.id).filter(Boolean);
  const gateDiagnostics = inputStops
    .map((stop) => buildGateDiagnostic(stop))
    .filter(Boolean);

  const base = {
    id: `agnostic-experimental:${cityKey || "agnostic"}:${[...stopIds].sort().join("+") || "empty"}`,
    experimental: true,
    experimental_agnostic_route: true,
    source: "trusted_candidate_pool",
    // Neutral, honest title — no city name, no "better/best/optimal/fastest".
    title: "Experimental any-place candidate route",
    // Order is whatever trusted candidate order the caller supplied: candidate
    // role order by default, or the flag-gated proximity sequence after it has
    // passed walking-budget validation. Validation itself never reorders.
    main_stops: stops,
    target_roles: Array.isArray(adaptedBody?.target_roles) ? adaptedBody.target_roles : [],
    unresolved_roles: Array.isArray(adaptedBody?.unresolved_roles) ? adaptedBody.unresolved_roles : [],
    geometry_summary: adaptedBody?.geometry_summary || null,
    trust_summary: adaptedBody?.trust_summary || null,
    gate_diagnostics: gateDiagnostics,
    route_ordering: sanitizeRouteOrdering(routeOrdering),
  };

  // #261/#265 — when the supplied candidate order passed walking-budget
  // validation, surface honest walking distance/minute ESTIMATES (heuristic or
  // OSRM, never a live arrival time). The supplied order may be original role
  // order or the #265 proximity sequence; validation checked it, it did not
  // optimize it.
  if (walkingValidation && walkingValidation.valid && walkingValidation.result) {
    const wr = walkingValidation.result;
    const totalWalkMinutes = (Array.isArray(wr.legs) ? wr.legs : []).reduce(
      (sum, leg) => sum + (Number.isFinite(leg && leg.estimated_walk_minutes) ? leg.estimated_walk_minutes : 0),
      0,
    );
    const caveats = ["experimental"];
    if (wr.source !== "osrm" || wr.fallbackUsed) caveats.push("heuristic_walking_estimate");
    if (wr.fallbackUsed) caveats.push("walking_router_fallback_used");
    if (routeOrdering && routeOrdering.applied) caveats.push("experimental_proximity_sequence");
    return {
      ...base,
      summary:
        "Experimental route composed from trusted source-backed candidates. The stop order has been validated against a walking budget; walking distances and minutes are estimates, not a live arrival time.",
      order_source:
        routeOrdering && routeOrdering.applied
          ? routeOrdering.source || "trusted_candidate_pool+role_order+proximity_sequence"
          : "trusted_candidate_pool+candidate_role_order",
      order_confidence: "walking_budget_validated",
      routing_source: wr.source || "heuristic",
      estimated_km: wr.estimatedKm,
      estimated_walk_minutes: totalWalkMinutes,
      legs: wr.legs,
      map_path_points: wr.pathPoints,
      caveats,
    };
  }

  // Fallback (no validation supplied): the pre-#261 unvalidated shape.
  return {
    ...base,
    summary:
      "Experimental route composed from trusted source-backed candidates. Stop order is unvalidated; no walking time or opening hours are implied.",
    order_source: "candidate_role_order",
    order_confidence: "unvalidated",
    routing_source: "none",
    caveats: ["walking_order_unvalidated", "no_walking_time", "no_opening_hours", "experimental"],
  };
}

function sanitizeRouteOrdering(ordering) {
  if (!ordering || typeof ordering !== "object") return null;
  return {
    applied: Boolean(ordering.applied),
    changed: Boolean(ordering.changed),
    source: ordering.source || null,
    confidence: ordering.confidence || null,
    original_stop_ids: Array.isArray(ordering.original_stop_ids) ? ordering.original_stop_ids : [],
    ordered_stop_ids: Array.isArray(ordering.ordered_stop_ids) ? ordering.ordered_stop_ids : [],
    reasons: Array.isArray(ordering.reasons) ? ordering.reasons : [],
    fallback_used: Boolean(ordering.fallback_used),
    fallback_reason: ordering.fallback_reason || null,
    failed_sequence_validation: ordering.failed_sequence_validation || null,
  };
}

function buildGateDiagnostic(stop) {
  const admission = stop?.experimental_admission;
  if (!admission || admission.allowed !== true) return null;
  return {
    candidate_id: stop.candidate_id || null,
    role: stop.role || null,
    policy: admission.policy || "experimental_inferred_external",
    reasons: Array.isArray(admission.reasons) ? admission.reasons : [],
    gate_reasons: Array.isArray(admission.gate_reasons) ? admission.gate_reasons : [],
    // #272 — local-feel honesty on the selected stop (chain_candidate,
    // secondary_type_for_role, chain_fallback_no_local_option).
    ...(Array.isArray(stop.local_feel_reasons) && stop.local_feel_reasons.length
      ? { local_feel_reasons: stop.local_feel_reasons }
      : {}),
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
  walkingValidation = null,
  routeOrdering = null,
  context = null,
  dayflowContextPresent = false,
}) {
  const baselineDay = baselineResult && Array.isArray(baselineResult.days) ? baselineResult.days[0] : null;
  const block = {
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
  block.readiness_calibration = calibrateAgnosticRouteReadiness({
    routeMutation,
    eligibility,
    candidateReadiness,
    experimentalRoute,
    sourceStatus,
    walkingValidation,
    routeOrdering,
    context,
    dayflowContextPresent,
  });
  return block;
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
  date = null,
  todayIsoDate = null,
  timezone = "UTC",
  lang = "en",
  walkingRouter = null,
  walkingConfig = null,
  walkingBudget = null,
  // #262 — trusted context seams. Public payload weather is NEVER trusted; the
  // weather/time context comes only from these server-injected sources.
  weatherProvider = null,
  clock = null,
  trustedTimezone = null,
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

  // #262 / correction #5 — only resolve trusted context (which may fetch weather)
  // when we will actually run trusted candidate selection. When a hard blocker is
  // already known (no external opt-in, or the loader skipped/empty/errored), skip
  // the weather call; context is never an eligibility substitute.
  const loaderStatus = (sourceStatus && sourceStatus.status) || "skipped";
  const willRunTrustedSelection =
    Boolean(externalRequested) && typeof loaderStatus === "string" && loaderStatus.startsWith("loaded:") && loaderStatus !== "loaded:0";
  const ctx = willRunTrustedSelection
    ? await resolveAgnosticContext({
        coords,
        date: effectiveDate,
        trustedTimezone,
        weatherProvider,
        clock,
        lang,
        cityLabel: agnosticContext.label,
      })
    : null;

  const rolePayload = {
    city: agnosticContext.key,
    date: effectiveDate,
    preferences: Array.isArray(preferences) ? preferences : [],
    lens: lens || null,
    // Trusted weather only — payload weather is never consulted.
    weather: ctx ? ctx.weather || null : null,
    origin,
    // Trusted time only, in the candidate-pool's expected payload format
    // (`hour` number + ISO `now`), and only when the timezone is known.
    ...(ctx && ctx.timezoneKnown ? { hour: ctx.hour, now: ctx.now } : {}),
    // Signal the engine's external opt-in so the source-backed provider runs.
    include_external_candidates: externalRequested ? 1 : undefined,
    candidate_sources: externalRequested ? "open" : undefined,
  };

  // #262 — time-of-day may influence selection ONLY when a trusted timezone is
  // known. Otherwise, explicitly disable the candidate-pool's fallback now/time
  // context so it never synthesizes a midday band that would tilt scoring. This
  // applies only to this flag-gated agnostic path (default citypack/blitz flows
  // never pass through here, so their time behavior is untouched).
  const trustedTimeKnown = Boolean(ctx && ctx.timezoneKnown);
  const selectionHelpers = trustedTimeKnown
    ? { ...helpers, experimentalAdmitCandidate: admitExperimentalInferredExternalCandidate }
    : {
        ...helpers,
        experimentalAdmitCandidate: admitExperimentalInferredExternalCandidate,
        resolveNowContext: (cfg, pl) => ({
          date: (pl && pl.date) || cfg.todayIsoDate(),
          hour: null,
          weekday: null,
          now_iso: null,
        }),
        resolveTimeBand: () => null,
      };

  const plannerRoles = selectPlannerRoleCandidates(agnosticContext, rolePayload, selectionHelpers);
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

  // #262 — the trusted-context surface (or a cheap "skipped" marker when a hard
  // blocker meant no trusted selection ran). When context ran, explain how it
  // influenced composition via the SELECTED candidates' weather/time fit reasons.
  const contextBlock = ctx ? ctx.contextBlock : buildSkippedContextBlock({ loaderStatus, externalRequested });
  if (ctx) {
    const influence = collectInfluenceReasons(plannerRoles, candidateCombination);
    contextBlock.influence.weather_fit_reasons = influence.weather;
    contextBlock.influence.time_fit_reasons = influence.time;
  }

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
    const experiment = buildExperimentBlock({
      routeMutation: false,
      eligibility,
      baselineResult,
      candidateReadiness,
      experimentalRoute: null,
      sourceStatus,
      context: contextBlock,
    });
    experiment.context = contextBlock;
    return { result: baselineResult, experiment };
  }

  // The route candidate arrives in role order. For the flag-gated experiment we
  // may apply a conservative proximity sequence, then validate that produced
  // order against walking budgets before any mutation. If the sequence fails
  // but the original role order validates, fall back to the original order.
  const orderingAttempt = buildAgnosticRouteOrdering({ adaptedBody });
  let finalAdaptedBody = orderingAttempt.adaptedBody;
  let routeOrdering = orderingAttempt.ordering;
  let walking = await validateAgnosticWalkingOrder({
    stops: toWalkingStops(finalAdaptedBody),
    walkingRouter,
    walkingConfig: walkingConfig || {},
    budget: walkingBudget || {},
  });

  if (!walking.valid && routeOrdering && routeOrdering.applied) {
    const failedSequenceValidation = { valid: walking.valid, blockers: walking.blockers, checks: walking.checks };
    const originalWalking = await validateAgnosticWalkingOrder({
      stops: toWalkingStops(adaptedBody),
      walkingRouter,
      walkingConfig: walkingConfig || {},
      budget: walkingBudget || {},
    });
    if (originalWalking.valid) {
      finalAdaptedBody = adaptedBody;
      walking = originalWalking;
      routeOrdering = {
        ...routeOrdering,
        applied: false,
        changed: false,
        source: "trusted_candidate_pool+candidate_role_order",
        confidence: "role_order_fallback",
        ordered_stop_ids: routeOrdering.original_stop_ids,
        fallback_used: true,
        fallback_reason: "proximity_sequence_failed_walking_validation",
        failed_sequence_validation: failedSequenceValidation,
        reasons: dedupe([...(routeOrdering.reasons || []), "fallback_to_candidate_role_order"]),
      };
    } else {
      walking = {
        ...originalWalking,
        blockers: dedupe([...(walking.blockers || []), ...(originalWalking.blockers || [])]),
      };
      routeOrdering = {
        ...routeOrdering,
        failed_sequence_validation: failedSequenceValidation,
      };
    }
  }

  const walkingSummary = { valid: walking.valid, blockers: walking.blockers, checks: walking.checks };

  if (!walking.valid) {
    // Trusted candidates were eligible, but their existing order failed walking
    // validation → no route. Baseline unchanged; explicit walking blockers.
    const walkingFailedEligibility = {
      ...eligibility,
      eligible: false,
      blockers: dedupe([...eligibility.blockers, ...walking.blockers]),
    };
    const experiment = buildExperimentBlock({
      routeMutation: false,
      eligibility: walkingFailedEligibility,
      baselineResult,
      candidateReadiness,
      experimentalRoute: null,
      sourceStatus,
      walkingValidation: walkingSummary,
      routeOrdering: sanitizeRouteOrdering(routeOrdering),
      context: contextBlock,
    });
    experiment.walking_validation = walkingSummary;
    experiment.route_ordering = sanitizeRouteOrdering(routeOrdering);
    experiment.context = contextBlock;
    return { result: baselineResult, experiment };
  }

  const experimentalRoute = buildExperimentalPrimaryRoute({
    cityKey: agnosticContext.key,
    adaptedBody: finalAdaptedBody,
    walkingValidation: walking,
    routeOrdering,
  });
  const mutated = applyRouteMutation({ baselineResult, primaryRoute: experimentalRoute, date: effectiveDate });

  // #262 — attach an honest day-level dayflow read when the trusted weather is
  // dayflow-relevant (buildDayflowContext returns null on boring weather). Live
  // is always empty for any-place context (no trusted live source).
  if (ctx && ctx.weather && mutated.days && mutated.days[0]) {
    const dayflow = buildDayflowContext({
      weather: ctx.weather,
      liveEvents: [],
      primaryRoute: experimentalRoute,
      date: effectiveDate,
      cityConfig: agnosticContext,
      lang,
    });
    if (dayflow) {
      mutated.days[0].dayflow_context = dayflow;
    }
  }
  const dayflowContextPresent = Boolean(mutated.days && mutated.days[0] && mutated.days[0].dayflow_context);

  const experiment = buildExperimentBlock({
    routeMutation: true,
    eligibility,
    baselineResult,
    candidateReadiness,
    experimentalRoute,
    sourceStatus,
    walkingValidation: walkingSummary,
    routeOrdering: sanitizeRouteOrdering(routeOrdering),
    context: contextBlock,
    dayflowContextPresent,
  });
  experiment.walking_validation = walkingSummary;
  experiment.route_ordering = sanitizeRouteOrdering(routeOrdering);
  experiment.context = contextBlock;
  return {
    result: mutated,
    experiment,
  };
}

function toWalkingStops(adaptedBody) {
  return (Array.isArray(adaptedBody?.stops) ? adaptedBody.stops : []).map((stop) => ({
    lat: stop.coordinates && Number.isFinite(stop.coordinates.lat) ? stop.coordinates.lat : null,
    lng: stop.coordinates && Number.isFinite(stop.coordinates.lng) ? stop.coordinates.lng : null,
    label: stop.label || null,
    id: stop.candidate_id || null,
  }));
}

// A cheap context marker for paths where a hard blocker meant we never ran
// trusted selection (so no weather/time was fetched). Honest about the skip.
function buildSkippedContextBlock({ loaderStatus, externalRequested }) {
  const reason = !externalRequested
    ? "external_candidates_not_requested"
    : LOADER_BLOCKERS[loaderStatus] || "context_not_resolved";
  return {
    status: "skipped",
    reason,
    time: {
      timezone: null,
      timezone_known: false,
      timezone_source: null,
      timezone_trust: "unavailable",
      status: "timezone_unavailable",
      now: null,
      time_band: null,
    },
    weather: { status: "skipped", read: null },
    computed_signals: [],
    live: { available: false, reason: "no_any_place_live_source" },
    influence: { weather_fed_into_selection: false, time_fed_into_selection: false, weather_fit_reasons: [], time_fit_reasons: [] },
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
