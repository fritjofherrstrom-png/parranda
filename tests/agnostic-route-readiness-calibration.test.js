const assert = require("node:assert/strict");
const test = require("node:test");

const { calibrateAgnosticRouteReadiness } = require("../server/planner/agnostic-route-readiness-calibration");

function baseRoute(overrides = {}) {
  return {
    main_stops: [
      { id: "food-1", origin: "external_open" },
      { id: "cafe-1", origin: "external_open" },
      { id: "view-1", origin: "external_open" },
    ],
    unresolved_roles: [],
    caveats: ["experimental", "heuristic_walking_estimate"],
    routing_source: "heuristic",
    ...overrides,
  };
}

function readiness(overrides = {}) {
  return {
    real_place_count: 30,
    coordinate_coverage: 1,
    can_support_planner: true,
    by_provider: { external_provider: 30 },
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    time: {
      timezone_source: "resolver_attested",
      timezone_trust: "resolver_attested",
      time_band: "evening",
    },
    computed_signals: [{ type: "golden_hour" }],
    influence: {
      weather_fed_into_selection: true,
      time_fed_into_selection: true,
    },
    ...overrides,
  };
}

test("environment-not-wired is not treated as weak candidate supply", () => {
  const out = calibrateAgnosticRouteReadiness({
    routeMutation: false,
    eligibility: { blockers: ["no_trusted_loader"], caveats: [] },
    sourceStatus: { status: "no_loader_configured" },
  });

  assert.equal(out.status, "environment_not_wired");
  assert.equal(out.level, "unavailable");
  assert.ok(out.reasons.includes("environment_not_wired"));
  assert.ok(out.reasons.includes("no_trusted_loader"));
  assert.equal(out.reasons.includes("candidate_supply_blocked_route"), false);
});

test("dense produced route is medium at most and preserves conservative caps", () => {
  const out = calibrateAgnosticRouteReadiness({
    routeMutation: true,
    eligibility: { blockers: [], caveats: [] },
    candidateReadiness: readiness(),
    experimentalRoute: baseRoute(),
    sourceStatus: { status: "loaded:30" },
    walkingValidation: { valid: true, blockers: [], checks: { walking_source: "heuristic", fallback_used: false } },
    routeOrdering: { source: "trusted_candidate_pool+role_order+proximity_sequence" },
    context: context(),
    dayflowContextPresent: true,
  });

  assert.equal(out.status, "usable");
  assert.equal(out.level, "medium");
  assert.ok(out.reasons.includes("walking_validated"));
  assert.ok(out.reasons.includes("resolver_attested_timezone"));
  assert.ok(out.caps.includes("external_only_candidates"));
  assert.ok(out.caps.includes("heuristic_walking_estimate"));
});

test("weather-provider timezone is surfaced as derived and capped", () => {
  const out = calibrateAgnosticRouteReadiness({
    routeMutation: true,
    eligibility: { blockers: [], caveats: [] },
    candidateReadiness: readiness(),
    experimentalRoute: baseRoute(),
    sourceStatus: { status: "loaded:30" },
    walkingValidation: { valid: true, blockers: [], checks: { walking_source: "heuristic", fallback_used: false } },
    context: context({
      time: {
        timezone_source: "weather_provider_auto",
        timezone_trust: "derived_from_weather_provider",
        time_band: "evening",
      },
    }),
  });

  assert.ok(out.reasons.includes("weather_provider_auto_timezone"));
  assert.ok(out.caps.includes("derived_timezone"));
  assert.equal(out.inputs.timezone_trust, "derived_from_weather_provider");
});

test("missing timezone keeps a produced route thin and does not claim time influence", () => {
  const out = calibrateAgnosticRouteReadiness({
    routeMutation: true,
    eligibility: { blockers: [], caveats: [] },
    candidateReadiness: readiness(),
    experimentalRoute: baseRoute(),
    sourceStatus: { status: "loaded:30" },
    walkingValidation: { valid: true, blockers: [], checks: { walking_source: "heuristic", fallback_used: false } },
    context: context({
      time: { timezone_source: null, timezone_trust: "unavailable", time_band: null },
      influence: { weather_fed_into_selection: true, time_fed_into_selection: false },
      computed_signals: [],
    }),
  });

  assert.equal(out.status, "thin_usable");
  assert.equal(out.level, "low");
  assert.ok(out.reasons.includes("timezone_unavailable"));
  assert.ok(out.caps.includes("no_time_context"));
  assert.equal(out.inputs.time_fed_into_selection, false);
});

test("blocked candidate and geometry paths stay unavailable with exact reasons", () => {
  const candidate = calibrateAgnosticRouteReadiness({
    routeMutation: false,
    eligibility: { blockers: ["insufficient_geocoded_candidates"], caveats: [] },
    sourceStatus: { status: "loaded:1" },
  });
  assert.equal(candidate.status, "blocked");
  assert.equal(candidate.level, "unavailable");
  assert.ok(candidate.reasons.includes("candidate_supply_blocked_route"));

  const geometry = calibrateAgnosticRouteReadiness({
    routeMutation: false,
    eligibility: { blockers: ["weak_geometry"], caveats: [] },
    sourceStatus: { status: "loaded:3" },
  });
  assert.equal(geometry.status, "blocked");
  assert.ok(geometry.reasons.includes("geometry_coherence_blocked_route"));
});

test("walking failure and fallback are reflected without route-quality overclaims", () => {
  const blocked = calibrateAgnosticRouteReadiness({
    routeMutation: false,
    eligibility: { blockers: [], caveats: [] },
    sourceStatus: { status: "loaded:30" },
    walkingValidation: { valid: false, blockers: ["walking_budget_exceeded"], checks: { walking_source: "heuristic" } },
  });
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.reasons.includes("walking_validation_blocked_route"));

  const fallback = calibrateAgnosticRouteReadiness({
    routeMutation: true,
    eligibility: { blockers: [], caveats: [] },
    candidateReadiness: readiness(),
    experimentalRoute: baseRoute({ caveats: ["experimental", "walking_router_fallback_used"] }),
    sourceStatus: { status: "loaded:30" },
    walkingValidation: { valid: true, blockers: [], checks: { walking_source: "heuristic", fallback_used: true } },
    routeOrdering: { source: "trusted_candidate_pool+candidate_role_order", fallback_used: true },
    context: context(),
  });
  assert.equal(fallback.status, "thin_usable");
  assert.ok(fallback.caps.includes("walking_router_fallback_used"));
  assert.ok(fallback.caps.includes("route_ordering_fallback"));
});

test("serialized calibration avoids banned route-claim vocabulary", () => {
  const out = calibrateAgnosticRouteReadiness({
    routeMutation: true,
    eligibility: { blockers: [], caveats: [] },
    candidateReadiness: readiness(),
    experimentalRoute: baseRoute(),
    sourceStatus: { status: "loaded:30" },
    walkingValidation: { valid: true, blockers: [], checks: { walking_source: "heuristic" } },
    context: context(),
  });
  const blob = JSON.stringify(out).toLowerCase();
  for (const word of ["best route", "optimal", "fastest", "shortest", "eta", "live arrival", "opening hours", "open today"]) {
    assert.equal(blob.includes(word), false, `calibration must not claim ${word}`);
  }
});
