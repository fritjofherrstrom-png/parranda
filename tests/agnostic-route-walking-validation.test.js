/**
 * #261 — agnostic route walking-budget validation.
 *
 * Validates the SUPPLIED experimental stop order against walking distance / leg
 * count / budget, and on success returns an experimental any-place route with
 * honest walking distance/minute ESTIMATES. The validator itself never reorders,
 * never claims a live arrival time, and fails closed on any router / leg /
 * budget problem.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApp } = require("../server/app");
const {
  externalRecord,
  makeLoader,
  routeBody,
  requestJson,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

const {
  validateAgnosticWalkingOrder,
  resolveAgnosticWalkingBudget,
  DEFAULT_TOTAL_WALK_BUDGET_KM,
  DEFAULT_MAX_LEG_BUDGET_KM,
} = require("../server/planner/agnostic-route-walking-validation");

const ORIGINAL_FETCH = global.fetch;
const FLAG = "experimental_agnostic_route_output=1";
const DATE = "2026-05-25";

function fixtureNear(base) {
  const recs = [];
  const j = (i) => ({ lat: base.lat + (i % 5) * 0.0008, lng: base.lng + Math.floor(i / 5) * 0.0008 });
  for (let i = 0; i < 11; i += 1) {
    const c = j(i);
    recs.push(externalRecord(`food-${i}`, `Food ${i}`, "restaurant", c.lat, c.lng, ["mat"]));
  }
  for (let i = 0; i < 11; i += 1) {
    const c = j(i + 2);
    recs.push(externalRecord(`cafe-${i}`, `Cafe ${i}`, "cafe", c.lat, c.lng, ["fika"]));
  }
  for (let i = 0; i < 5; i += 1) {
    const c = j(i + 1);
    recs.push(externalRecord(`view-${i}`, `View ${i}`, "viewpoint", c.lat, c.lng, ["utsikt"]));
  }
  return recs;
}

function fixtureNeedsOrderingFallback() {
  return [
    externalRecord("view-a", "View A", "viewpoint", 41.9, 12.49, ["utsikt"]),
    externalRecord("food-c", "Food C", "restaurant", 41.92, 12.49, ["mat"]),
    externalRecord("cafe-b", "Cafe B", "cafe", 41.901, 12.49, ["fika"]),
  ];
}

function agnosticBody(extra = {}) {
  return {
    city: "atlantis-unknown-place",
    dates: [DATE],
    lat: 41.9,
    lng: 12.49,
    preferences: ["food", "coffee", "scenic"],
    include_external_candidates: 1,
    ...extra,
  };
}

// A router that returns one leg per gap with a fixed per-leg distance/minutes.
function routerPerLeg({ km = 0.2, minutes = 3, source = "heuristic", fallbackUsed = false } = {}) {
  return async (points) => {
    const legs = points.slice(1).map(() => ({ distance_km: km, estimated_walk_minutes: minutes }));
    return {
      source,
      estimatedKm: Number((km * legs.length).toFixed(1)),
      legs,
      pathPoints: points.map((p) => ({ lat: p.lat, lng: p.lng })),
      fallbackUsed,
    };
  };
}

function withServer(opts, run) {
  return async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp(opts).listen(0);
    try {
      await run(server);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  };
}

const STOPS3 = [
  { lat: 41.9, lng: 12.49, label: "A", id: "a" },
  { lat: 41.901, lng: 12.491, label: "B", id: "b" },
  { lat: 41.902, lng: 12.492, label: "C", id: "c" },
];

// =====================================================================
// Pure: validateAgnosticWalkingOrder
// =====================================================================

test("pure: valid ordered stops → valid with honest checks (no reorder)", async () => {
  const seen = [];
  const router = async (points, opts) => {
    seen.push(points.map((p) => `${p.lat},${p.lng}`));
    return routerPerLeg({ km: 0.2, minutes: 3 })(points, opts);
  };
  const out = await validateAgnosticWalkingOrder({ stops: STOPS3, walkingRouter: router });
  assert.equal(out.valid, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.checks.leg_count, 2);
  assert.equal(out.checks.stop_count, 3);
  assert.equal(out.checks.total_walk_km, 0.4);
  assert.equal(out.checks.total_estimated_walk_minutes, 6);
  assert.equal(out.checks.walking_source, "heuristic");
  // The router received the stops in the SUPPLIED order — no optimization.
  assert.deepEqual(seen[0], ["41.9,12.49", "41.901,12.491", "41.902,12.492"]);
});

test("pure: fewer than 2 stops → invalid_walking_coordinates", async () => {
  const out = await validateAgnosticWalkingOrder({ stops: [STOPS3[0]], walkingRouter: routerPerLeg() });
  assert.equal(out.valid, false);
  assert.deepEqual(out.blockers, ["invalid_walking_coordinates"]);
});

test("pure: a non-finite / out-of-range coordinate → invalid_walking_coordinates", async () => {
  const bad = [STOPS3[0], { lat: 999, lng: 12.49 }];
  const out = await validateAgnosticWalkingOrder({ stops: bad, walkingRouter: routerPerLeg() });
  assert.equal(out.valid, false);
  assert.deepEqual(out.blockers, ["invalid_walking_coordinates"]);
});

test("pure: router throws / returns no legs → walking_route_unavailable", async () => {
  const a = await validateAgnosticWalkingOrder({ stops: STOPS3, walkingRouter: async () => { throw new Error("down"); } });
  assert.deepEqual(a.blockers, ["walking_route_unavailable"]);
  const b = await validateAgnosticWalkingOrder({ stops: STOPS3, walkingRouter: async () => ({ source: "heuristic" }) });
  assert.deepEqual(b.blockers, ["walking_route_unavailable"]);
});

test("pure: wrong leg count → invalid_walking_leg_count", async () => {
  const router = async (points) => ({ source: "heuristic", estimatedKm: 0.1, legs: [{ distance_km: 0.1, estimated_walk_minutes: 2 }], pathPoints: points, fallbackUsed: false });
  const out = await validateAgnosticWalkingOrder({ stops: STOPS3, walkingRouter: router });
  assert.equal(out.valid, false);
  assert.deepEqual(out.blockers, ["invalid_walking_leg_count"]);
});

test("pure: non-finite leg distance/minutes → walking_validation_failed", async () => {
  const router = async (points) => ({ source: "heuristic", estimatedKm: 1, legs: points.slice(1).map(() => ({ distance_km: NaN, estimated_walk_minutes: 3 })), pathPoints: points, fallbackUsed: false });
  const out = await validateAgnosticWalkingOrder({ stops: STOPS3, walkingRouter: router });
  assert.equal(out.valid, false);
  assert.deepEqual(out.blockers, ["walking_validation_failed"]);
});

test("pure: negative leg distance/minutes or estimatedKm → walking_validation_failed", async () => {
  const negativeDistance = await validateAgnosticWalkingOrder({
    stops: STOPS3,
    walkingRouter: async (points) => ({ source: "heuristic", estimatedKm: 1, legs: points.slice(1).map(() => ({ distance_km: -0.1, estimated_walk_minutes: 3 })), pathPoints: points, fallbackUsed: false }),
  });
  assert.equal(negativeDistance.valid, false);
  assert.deepEqual(negativeDistance.blockers, ["walking_validation_failed"]);

  const negativeMinutes = await validateAgnosticWalkingOrder({
    stops: STOPS3,
    walkingRouter: async (points) => ({ source: "heuristic", estimatedKm: 1, legs: points.slice(1).map(() => ({ distance_km: 0.1, estimated_walk_minutes: -3 })), pathPoints: points, fallbackUsed: false }),
  });
  assert.equal(negativeMinutes.valid, false);
  assert.deepEqual(negativeMinutes.blockers, ["walking_validation_failed"]);

  const negativeTotal = await validateAgnosticWalkingOrder({
    stops: STOPS3,
    walkingRouter: async (points) => ({ source: "heuristic", estimatedKm: -1, legs: points.slice(1).map(() => ({ distance_km: 0.1, estimated_walk_minutes: 3 })), pathPoints: points, fallbackUsed: false }),
  });
  assert.equal(negativeTotal.valid, false);
  assert.deepEqual(negativeTotal.blockers, ["walking_validation_failed"]);
});

test("pure: missing, too-short, or invalid pathPoints → invalid_walking_path_points", async () => {
  const missing = await validateAgnosticWalkingOrder({
    stops: STOPS3,
    walkingRouter: async (points) => ({ source: "heuristic", estimatedKm: 0.2, legs: points.slice(1).map(() => ({ distance_km: 0.1, estimated_walk_minutes: 3 })), fallbackUsed: false }),
  });
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.blockers, ["invalid_walking_path_points"]);

  const tooShort = await validateAgnosticWalkingOrder({
    stops: STOPS3,
    walkingRouter: async (points) => ({ source: "heuristic", estimatedKm: 0.2, legs: points.slice(1).map(() => ({ distance_km: 0.1, estimated_walk_minutes: 3 })), pathPoints: points.slice(0, 1), fallbackUsed: false }),
  });
  assert.equal(tooShort.valid, false);
  assert.deepEqual(tooShort.blockers, ["invalid_walking_path_points"]);

  const invalidPoint = await validateAgnosticWalkingOrder({
    stops: STOPS3,
    walkingRouter: async (points) => ({ source: "heuristic", estimatedKm: 0.2, legs: points.slice(1).map(() => ({ distance_km: 0.1, estimated_walk_minutes: 3 })), pathPoints: [{ lat: 999, lng: 12 }, ...points.slice(1)], fallbackUsed: false }),
  });
  assert.equal(invalidPoint.valid, false);
  assert.deepEqual(invalidPoint.blockers, ["invalid_walking_path_points"]);
});

test("pure: total distance over the one-day cap → walking_budget_exceeded", async () => {
  const out = await validateAgnosticWalkingOrder({ stops: STOPS3, walkingRouter: routerPerLeg({ km: 50, minutes: 600 }) });
  assert.equal(out.valid, false);
  assert.deepEqual(out.blockers, ["walking_budget_exceeded"]);
  assert.ok(out.checks.total_walk_km > DEFAULT_TOTAL_WALK_BUDGET_KM);
});

test("pure: a single leg over the per-leg cap (total under cap) → walking_leg_budget_exceeded", async () => {
  // legs: 6.5 + 1.0 = 7.5 total (< 25), but max leg 6.5 > 6.
  const router = async (points) => ({ source: "heuristic", estimatedKm: 7.5, legs: [{ distance_km: 6.5, estimated_walk_minutes: 80 }, { distance_km: 1.0, estimated_walk_minutes: 12 }], pathPoints: points, fallbackUsed: false });
  const out = await validateAgnosticWalkingOrder({ stops: STOPS3, walkingRouter: router });
  assert.equal(out.valid, false);
  assert.deepEqual(out.blockers, ["walking_leg_budget_exceeded"]);
  assert.ok(out.checks.max_leg_km > DEFAULT_MAX_LEG_BUDGET_KM);
});

test("pure: default budgets are exposed in checks", async () => {
  const out = await validateAgnosticWalkingOrder({ stops: STOPS3, walkingRouter: routerPerLeg() });
  assert.equal(out.checks.total_budget_km, DEFAULT_TOTAL_WALK_BUDGET_KM);
  assert.equal(out.checks.max_leg_budget_km, DEFAULT_MAX_LEG_BUDGET_KM);
  assert.equal(out.checks.budget_source, "default_safety_budget");
  assert.equal(out.checks.target_walk_km, null);
});

test("pure: walking target gets bounded tolerance instead of the unrelated 25 km ceiling", async () => {
  const budget = resolveAgnosticWalkingBudget({ targetKm: 6 });
  assert.equal(budget.totalKm, 8.1);
  assert.equal(budget.targetKm, 6);
  assert.equal(budget.source, "walking_target_tolerance");

  const withinTolerance = await validateAgnosticWalkingOrder({
    stops: STOPS3,
    walkingRouter: async (points) => ({
      source: "heuristic",
      estimatedKm: 8,
      legs: [
        { distance_km: 4, estimated_walk_minutes: 48 },
        { distance_km: 4, estimated_walk_minutes: 48 },
      ],
      pathPoints: points,
      fallbackUsed: false,
    }),
    targetKm: 6,
  });
  assert.equal(withinTolerance.valid, true);
  assert.equal(withinTolerance.checks.total_budget_km, 8.1);

  const tooFarForProfile = await validateAgnosticWalkingOrder({
    stops: STOPS3,
    walkingRouter: async (points) => ({
      source: "heuristic",
      estimatedKm: 9.2,
      legs: [
        { distance_km: 4.6, estimated_walk_minutes: 55 },
        { distance_km: 4.6, estimated_walk_minutes: 55 },
      ],
      pathPoints: points,
      fallbackUsed: false,
    }),
    targetKm: 6,
  });
  assert.equal(tooFarForProfile.valid, false);
  assert.deepEqual(tooFarForProfile.blockers, ["walking_budget_exceeded"]);
  assert.equal(tooFarForProfile.checks.budget_source, "walking_target_tolerance");
});

test("pure: explicit total budget remains authoritative over a walking target", () => {
  const budget = resolveAgnosticWalkingBudget({
    targetKm: 6,
    budget: { totalKm: 12, maxLegKm: 4 },
  });
  assert.equal(budget.totalKm, 12);
  assert.equal(budget.maxLegKm, 4);
  assert.equal(budget.source, "explicit_budget");
});

// =====================================================================
// API: default unchanged + inspect inert
// =====================================================================

test(
  "api: default unchanged without the flag — no walking fields, no experiment block",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })) }, async (server) => {
    const r = await requestJson(server, { path: "/api/route-recommendations?lang=en", body: routeBody("rome", ["scenic", "food"]) });
    assert.equal(r.body.agnostic_route_output_experiment, undefined);
    assert.equal("walking_validation" in (r.body.agnostic_route_output_experiment || {}), false);
  }),
);

test(
  "api: inspect tokens never trigger mutation or walking validation",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })) }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&inspect=agnostic_route_candidate&include_external_candidates=1`, body: agnosticBody() });
    assert.equal(r.body.agnostic_route_output_experiment, undefined);
    assert.deepEqual(r.body.days, []);
  }),
);

// =====================================================================
// API: success path (capability)
// =====================================================================

test(
  "api: success — validated route exposes honest walking distance/minute metadata",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })) }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    const route = r.body.days[0].primary_route;
    assert.equal(exp.route_mutation, true);
    assert.equal(exp.walking_validation.valid, true);
    assert.equal(route.order_confidence, "walking_budget_validated");
    // food/coffee/scenic role order is daypart-incoherent (coffee should be
    // morning) → daypart sequencing applies and is walking-validated.
    assert.equal(route.order_source, "trusted_candidate_pool+daypart_rhythm+proximity_sequence");
    assert.equal(route.routing_source, "heuristic");
    assert.ok(Number.isFinite(route.estimated_km));
    assert.ok(Number.isFinite(route.estimated_walk_minutes));
    assert.equal(route.legs.length, route.main_stops.length - 1);
    assert.ok(Array.isArray(route.map_path_points) && route.map_path_points.length >= route.main_stops.length);
    // Old unvalidated caveats are gone.
    assert.equal(route.caveats.includes("walking_order_unvalidated"), false);
    assert.equal(route.caveats.includes("no_walking_time"), false);
    assert.ok(route.caveats.includes("heuristic_walking_estimate"), "heuristic estimate stays honest");
    // Sum of leg minutes equals the surfaced total.
    const summed = route.legs.reduce((s, l) => s + l.estimated_walk_minutes, 0);
    assert.equal(route.estimated_walk_minutes, summed);
  }),
);

test(
  "api: CAPABILITY — success changes the route from unvalidated to walking-budget-validated with metadata",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })) }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const route = r.body.days[0].primary_route;
    // A diagnostics-only PR would leave the route unvalidated with no walking
    // metadata — these assertions force a real route-output capability change.
    assert.notEqual(route.order_confidence, "unvalidated");
    assert.equal(route.order_confidence, "walking_budget_validated");
    assert.ok("estimated_km" in route && "estimated_walk_minutes" in route && "legs" in route);
  }),
);

// =====================================================================
// API: fail-closed (router error, budget, invalid result)
// =====================================================================

test(
  "api: router unavailable → fail closed, baseline unchanged, explicit blocker",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), walkingRouter: async () => { throw new Error("router down"); } }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.equal(exp.walking_validation.valid, false);
    assert.ok(exp.readiness_blockers.includes("walking_route_unavailable"));
    assert.deepEqual(r.body.days, [], "baseline untouched");
    assert.equal(exp.experimental_route, null);
  }),
);

test(
  "api: walking budget exceeded → fail closed with explicit blocker",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), walkingRouter: routerPerLeg({ km: 50, minutes: 600 }) }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.ok(exp.readiness_blockers.includes("walking_budget_exceeded"));
    assert.deepEqual(r.body.days, []);
  }),
);

test(
  "api: selected walking profile bounds validation below the generic safety ceiling",
  withServer({
    openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
    walkingRouter: async (points) => ({
      source: "heuristic",
      estimatedKm: 9.2,
      legs: points.slice(1).map(() => ({
        distance_km: Number((9.2 / (points.length - 1)).toFixed(2)),
        estimated_walk_minutes: 55,
      })),
      pathPoints: points,
      fallbackUsed: false,
    }),
  }, async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: agnosticBody({ walking_km_target: 6 }),
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.ok(exp.readiness_blockers.includes("walking_budget_exceeded"));
    assert.equal(exp.walking_validation.checks.target_walk_km, 6);
    assert.equal(exp.walking_validation.checks.total_budget_km, 8.1);
    assert.equal(exp.walking_validation.checks.budget_source, "walking_target_tolerance");
    assert.deepEqual(r.body.days, []);
  }),
);

test(
  "api: invalid walking result (wrong leg count) → fail closed",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), walkingRouter: async (points) => ({ source: "heuristic", estimatedKm: 0.1, legs: [{ distance_km: 0.1, estimated_walk_minutes: 2 }], pathPoints: points, fallbackUsed: false }) }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.ok(exp.readiness_blockers.includes("invalid_walking_leg_count"));
  }),
);

test(
  "api: invalid walking path points → fail closed",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), walkingRouter: async (points) => ({ source: "heuristic", estimatedKm: 0.2, legs: points.slice(1).map(() => ({ distance_km: 0.1, estimated_walk_minutes: 2 })), pathPoints: [], fallbackUsed: false }) }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.equal(exp.experimental_route, null);
    assert.ok(exp.readiness_blockers.includes("invalid_walking_path_points"));
    assert.deepEqual(r.body.days, []);
  }),
);

test(
  "api: daypart order failure falls back to original role order when role order validates",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const seen = [];
    // Role order (candidate-combination order) is scenic → food → coffee.
    // Daypart reorders to coffee → scenic → food (coffee moves to the morning).
    const daypartOrder = "41.901,12.49|41.9,12.49|41.92,12.49"; // cafe-b, view-a, food-c
    const originalRoleOrder = "41.9,12.49|41.92,12.49|41.901,12.49"; // view-a, food-c, cafe-b
    const fallbackRouter = async (points) => {
      const signature = points.map((p) => `${p.lat},${p.lng}`).join("|");
      seen.push(signature);
      if (signature === daypartOrder) {
        return {
          source: "heuristic",
          estimatedKm: 99,
          legs: points.slice(1).map(() => ({ distance_km: 99, estimated_walk_minutes: 999 })),
          pathPoints: points.map((p) => ({ lat: p.lat, lng: p.lng })),
          fallbackUsed: false,
        };
      }
      if (signature === originalRoleOrder) {
        return {
          source: "heuristic",
          estimatedKm: 0.8,
          legs: points.slice(1).map(() => ({ distance_km: 0.4, estimated_walk_minutes: 6 })),
          pathPoints: points.map((p) => ({ lat: p.lat, lng: p.lng })),
          fallbackUsed: false,
        };
      }
      throw new Error(`unexpected order ${signature}`);
    };

    const server = buildApp({ openDataLoader: makeLoader(fixtureNeedsOrderingFallback()), walkingRouter: fallbackRouter }).listen(0);
    try {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody({ preferences: ["scenic", "food", "coffee"] }),
      });
      const exp = r.body.agnostic_route_output_experiment;
      const route = r.body.days[0].primary_route;

      assert.equal(exp.route_mutation, true);
      assert.deepEqual(seen, [daypartOrder, originalRoleOrder]);
      assert.deepEqual(route.main_stops.map((stop) => stop.id), ["view-a", "food-c", "cafe-b"]);
      assert.equal(exp.route_ordering.fallback_used, true);
      assert.equal(exp.route_ordering.fallback_reason, "daypart_sequence_failed_walking_validation");
      assert.ok(exp.route_ordering.failed_sequence_validation, "failed daypart validation is preserved");
      assert.equal(exp.walking_validation.valid, true);
      assert.equal(route.route_ordering.fallback_used, true);
      assert.equal(route.order_source, "trusted_candidate_pool+candidate_role_order");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  },
);

// =====================================================================
// API: public trust boundary + produced order + no overclaims
// =====================================================================

test(
  "api: public payload cannot inject or override walking metadata",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })) }, async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: agnosticBody({
        estimated_km: 9999,
        estimated_walk_minutes: 9999,
        legs: [{ distance_km: 9999, estimated_walk_minutes: 9999 }],
        map_path_points: [{ lat: 0, lng: 0 }],
        order_confidence: "hacked",
        walking_validation: { valid: true, blockers: [], checks: {} },
      }),
    });
    const route = r.body.days[0].primary_route;
    assert.equal(route.order_confidence, "walking_budget_validated", "server validation result wins");
    assert.notEqual(route.estimated_km, 9999, "payload walking metadata is ignored");
    assert.notDeepEqual(route.map_path_points, [{ lat: 0, lng: 0 }]);
    assert.ok(route.legs.every((l) => l.distance_km !== 9999));
  }),
);

test(
  "api: public payload cannot inject or override route ordering metadata",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })) }, async (server) => {
    const evilIds = ["evil-a", "evil-b"];
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: agnosticBody({
        route_ordering: {
          applied: true,
          ordered_stop_ids: evilIds,
        },
        ordered_stop_ids: evilIds,
        stop_ids: evilIds,
      }),
    });
    const route = r.body.days[0].primary_route;
    const exp = r.body.agnostic_route_output_experiment;
    const blob = JSON.stringify({ route, exp });

    assert.equal(exp.route_mutation, true);
    assert.equal(blob.includes("evil-a"), false);
    assert.equal(blob.includes("evil-b"), false);
    assert.notDeepEqual(route.route_ordering && route.route_ordering.ordered_stop_ids, evilIds);
    assert.notDeepEqual(exp.route_ordering && exp.route_ordering.ordered_stop_ids, evilIds);
    assert.ok(route.main_stops.every((stop) => !evilIds.includes(stop.id)));
  }),
);

test(
  "api: walking validation receives the produced route order",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const seen = [];
    const capturingRouter = async (points, opts) => {
      seen.push(points.map((p) => `${p.lat},${p.lng}`));
      return routerPerLeg({ km: 0.2, minutes: 3 })(points, opts);
    };
    const server = buildApp({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), walkingRouter: capturingRouter }).listen(0);
    try {
      const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
      const route = r.body.days[0].primary_route;
      const routeOrder = route.main_stops.map((s) => `${s.lat},${s.lng}`);
      assert.deepEqual(seen[0], routeOrder, "router received stops in the produced route order");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  },
);

test(
  "api: validated route makes no opening-hours/optimal/fastest/shortest/live/ETA claims",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })) }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const route = r.body.days[0].primary_route;
    assert.equal("opening_hours" in route, false);
    assert.equal("eta" in route, false);
    assert.ok(Object.keys(route).every((k) => !k.toLowerCase().includes("eta")));
    const blob = JSON.stringify({ route, experiment: r.body.agnostic_route_output_experiment }).toLowerCase();
    for (const phrase of ["optimal", "fastest", "shortest", "better route", "best route", "live that fits", " eta "]) {
      assert.equal(blob.includes(phrase), false, `must not claim "${phrase}"`);
    }
  }),
);

// =====================================================================
// API: place-intake integration
// =====================================================================

test(
  "api: a resolved place flows into the validated walking route path",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), placeResolver: async () => [{ label: "Resolved Place", lat: 41.9, lng: 12.49, confidence: "high", provenance: "test_geocoder" }] }, async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: { city: "unknown-x", dates: [DATE], place: "Some Neighbourhood", preferences: ["food", "coffee", "scenic"], include_external_candidates: 1 },
    });
    const exp = r.body.agnostic_route_output_experiment;
    const route = r.body.days[0].primary_route;
    assert.equal(exp.intake.mode, "place");
    assert.equal(exp.walking_validation.valid, true);
    assert.equal(route.order_confidence, "walking_budget_validated");
    assert.ok(Number.isFinite(route.estimated_walk_minutes));
  }),
);
