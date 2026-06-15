const assert = require("node:assert/strict");
const test = require("node:test");

const { calibrateAgnosticRouteReadiness } = require("../server/planner/agnostic-route-readiness-calibration");

function baseRoute(overrides = {}) {
  return {
    main_stops: [
      { id: "food-1", origin: "trusted_curated" },
      { id: "cafe-1", origin: "trusted_curated" },
      { id: "view-1", origin: "trusted_curated" },
    ],
    unresolved_roles: [],
    caveats: ["experimental"],
    routing_source: "validated_walking_router",
    ...overrides,
  };
}

function readiness(overrides = {}) {
  return {
    real_place_count: 30,
    coordinate_coverage: 1,
    can_support_planner: true,
    by_provider: { official: 18, curated: 12 },
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

function producedInput(overrides = {}) {
  return {
    routeMutation: true,
    eligibility: { blockers: [], caveats: [] },
    candidateReadiness: readiness(),
    experimentalRoute: baseRoute(),
    sourceStatus: { status: "loaded:30" },
    walkingValidation: { valid: true, blockers: [], checks: { walking_source: "validated_walking_router", fallback_used: false } },
    routeOrdering: { source: "trusted_candidate_pool+daypart_rhythm+proximity_sequence", fallback_used: false },
    context: context(),
    dayflowContextPresent: true,
    ...overrides,
  };
}

function cappedBy(out) {
  return [...out.reasons, ...out.caps].filter((token) => token.startsWith("capped_by_"));
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

test("place resolver unavailable is environment-not-wired", () => {
  const out = calibrateAgnosticRouteReadiness({
    routeMutation: false,
    eligibility: { blockers: ["place_resolver_unavailable"], caveats: [] },
    sourceStatus: { status: "skipped" },
  });

  assert.equal(out.status, "environment_not_wired");
  assert.equal(out.level, "unavailable");
  assert.ok(out.reasons.includes("place_resolver_unavailable"));
});

test("external candidates not requested is not-applicable, not blocked", () => {
  const out = calibrateAgnosticRouteReadiness({
    routeMutation: false,
    eligibility: { blockers: ["external_candidates_not_requested"], caveats: [] },
    sourceStatus: { status: "skipped" },
  });

  assert.equal(out.status, "not_applicable");
  assert.equal(out.level, "unavailable");
  assert.ok(out.reasons.includes("external_candidates_not_requested"));
});

test("dense produced route with resolver timezone and no caps is usable", () => {
  const out = calibrateAgnosticRouteReadiness(producedInput());

  assert.equal(out.status, "usable");
  assert.equal(out.level, "medium");
  assert.ok(out.reasons.includes("walking_validated"));
  assert.ok(out.reasons.includes("resolver_attested_timezone"));
  assert.equal(out.level, "medium");
  assert.equal(out.level === "high", false);
  assert.deepEqual(cappedBy(out), []);
});

test("usable never coexists with capped_by tokens and thin_usable always has one", () => {
  const usable = calibrateAgnosticRouteReadiness(producedInput());
  assert.equal(usable.status, "usable");
  assert.deepEqual(cappedBy(usable), []);

  const thin = calibrateAgnosticRouteReadiness(
    producedInput({
      context: context({
        time: {
          timezone_source: "weather_provider_auto",
          timezone_trust: "derived_from_weather_provider",
          time_band: "evening",
        },
      }),
    }),
  );
  assert.equal(thin.status, "thin_usable");
  assert.ok(cappedBy(thin).length > 0);
});

test("#281 — a 2-stop day is capped thin even with strong sources and full context", () => {
  // Same strong inputs that otherwise produce `usable`, but only two stops
  // (e.g. a time-anchored evening day trimmed to food + bar). It must read
  // thin_usable, not usable.
  const thin = calibrateAgnosticRouteReadiness(
    producedInput({
      experimentalRoute: baseRoute({
        main_stops: [
          { id: "food-1", origin: "trusted_curated" },
          { id: "bar-1", origin: "trusted_curated" },
        ],
      }),
    }),
  );
  assert.equal(thin.status, "thin_usable");
  assert.equal(thin.level, "low");
  assert.ok(thin.caps.includes("capped_by_thin_day"));
  assert.ok(thin.reasons.includes("thin_day_few_stops"));

  // A three-stop day with the same strong inputs is NOT thin-capped.
  const full = calibrateAgnosticRouteReadiness(producedInput());
  assert.equal(full.status, "usable");
  assert.equal(full.caps.includes("capped_by_thin_day"), false);
});

test("weather-provider timezone is surfaced as derived and capped", () => {
  const out = calibrateAgnosticRouteReadiness(
    producedInput({
      context: context({
        time: {
          timezone_source: "weather_provider_auto",
          timezone_trust: "derived_from_weather_provider",
          time_band: "evening",
        },
      }),
    }),
  );

  assert.equal(out.status, "thin_usable");
  assert.ok(out.reasons.includes("weather_provider_auto_timezone"));
  assert.ok(out.caps.includes("capped_by_derived_timezone"));
  assert.equal(out.inputs.timezone_trust, "derived_from_weather_provider");
});

test("missing timezone keeps a produced route thin with partial-context cap", () => {
  const out = calibrateAgnosticRouteReadiness(
    producedInput({
      context: context({
        time: { timezone_source: null, timezone_trust: "unavailable", time_band: null },
        influence: { weather_fed_into_selection: true, time_fed_into_selection: false },
        computed_signals: [],
      }),
    }),
  );

  assert.equal(out.status, "thin_usable");
  assert.equal(out.level, "low");
  assert.ok(out.reasons.includes("timezone_unavailable"));
  assert.ok(out.caps.includes("capped_by_partial_context"));
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

  const fallback = calibrateAgnosticRouteReadiness(
    producedInput({
      experimentalRoute: baseRoute({ caveats: ["experimental", "walking_router_fallback_used"] }),
      walkingValidation: { valid: true, blockers: [], checks: { walking_source: "heuristic", fallback_used: true } },
      routeOrdering: { source: "trusted_candidate_pool+candidate_role_order", fallback_used: true },
    }),
  );
  assert.equal(fallback.status, "thin_usable");
  assert.ok(fallback.caps.includes("capped_by_heuristic_walking"));
  assert.ok(fallback.caps.includes("capped_by_role_order_fallback"));
});

test("external-only, unresolved roles, and below-threshold route caps are closed vocabulary", () => {
  const out = calibrateAgnosticRouteReadiness(
    producedInput({
      candidateReadiness: readiness({ can_support_planner: false }),
      experimentalRoute: baseRoute({
        main_stops: [
          { id: "food-1", origin: "external_open" },
          { id: "cafe-1", origin: "external_open" },
          { id: "view-1", origin: "external_open" },
        ],
        unresolved_roles: ["swim"],
      }),
    }),
  );

  assert.equal(out.status, "thin_usable");
  assert.ok(out.caps.includes("capped_by_external_only_sources"));
  assert.ok(out.caps.includes("capped_by_unresolved_roles"));
  assert.ok(out.caps.includes("capped_by_below_planner_candidate_threshold"));
});

test("calibration is deterministic and does not mutate evidence", () => {
  const input = producedInput({
    experimentalRoute: baseRoute({ main_stops: [{ id: "food-1", origin: "trusted_curated" }, { id: "cafe-1", origin: "trusted_curated" }, { id: "view-1", origin: "trusted_curated" }] }),
  });
  const before = JSON.stringify(input);
  const first = calibrateAgnosticRouteReadiness(input);
  const second = calibrateAgnosticRouteReadiness(input);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
});

test("serialized calibration avoids banned route-claim vocabulary", () => {
  const out = calibrateAgnosticRouteReadiness(producedInput());
  const blob = JSON.stringify(out).toLowerCase();
  for (const word of ["best route", "optimal", "fastest", "shortest", "eta", "live arrival", "opening hours", "open today"]) {
    assert.equal(blob.includes(word), false, `calibration must not claim ${word}`);
  }
});
