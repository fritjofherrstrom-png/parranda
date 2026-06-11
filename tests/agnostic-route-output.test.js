/**
 * #259 — agnostic route-output experiment (flag-gated route mutation/synthesis).
 *
 * Proves the capability AND the guardrails:
 *   - default /api/route-recommendations is unchanged without the flag;
 *   - the explicit experiment flag is required to mutate/synthesize;
 *   - `inspect=` never mutates;
 *   - public payload data is never trusted (only the server loader is);
 *   - no named-city hardcoding (coordinate-driven; recognized citypacks untouched);
 *   - no fake ETA / walking-time / opening-hours / "better route" claims;
 *   - eligibility passes → a real experimental route; fails → honest blockers.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApp } = require("../server/app");
const {
  externalRecord,
  makeLoader,
  routeBody,
  primaryRouteShape,
  requestJson,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

const {
  evaluateEligibility,
  buildExperimentalPrimaryRoute,
  buildExperimentalDay,
  applyRouteMutation,
  buildExperimentBlock,
  composeAgnosticRouteOutput,
} = require("../server/planner/agnostic-route-output");

const ORIGINAL_FETCH = global.fetch;
const FLAG = "experimental_agnostic_route_output=1";
const DATE = "2026-05-25";

// A role-diverse, >=25 geocoded, tightly-clustered trusted fixture near an
// anchor — enough to fill multiple roles AND clear the planner readiness bar.
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

function withServer(openDataLoader, run) {
  return async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({ openDataLoader }).listen(0);
    try {
      await run(server);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  };
}

// --- pure unit fixtures -----------------------------------------------------

function adaptedBody(over = {}) {
  return {
    stops: over.stops || [
      { role: "food_anchor", candidate_id: "r1", label: "R1", origin: "external_open", confidence: "medium", coordinates: { lat: 41.9, lng: 12.49 } },
      { role: "coffee_fika_stop", candidate_id: "c1", label: "C1", origin: "external_open", confidence: "medium", coordinates: { lat: 41.901, lng: 12.491 } },
    ],
    target_roles: over.target_roles || ["food_anchor", "coffee_fika_stop"],
    unresolved_roles: over.unresolved_roles || [],
    geometry_summary: over.geometry_summary || { coherence: "strong", max_pairwise_km: 0.2 },
    trust_summary: over.trust_summary || { curated_count: 0, external_count: 2, low_confidence_count: 0 },
  };
}

// --- unit: eligibility ------------------------------------------------------

test("unit: external not requested → not eligible, explicit blocker", () => {
  const e = evaluateEligibility({ externalRequested: false, sourceStatus: { status: "skipped" }, adaptedBody: adaptedBody(), candidateReadiness: null });
  assert.equal(e.eligible, false);
  assert.ok(e.blockers.includes("external_candidates_not_requested"));
});

test("unit: trusted loader status maps to explicit blockers", () => {
  const cases = {
    no_loader_configured: "no_trusted_loader",
    error_failed_closed: "loader_error",
    "loaded:0": "no_usable_trusted_records",
  };
  for (const [status, blocker] of Object.entries(cases)) {
    const e = evaluateEligibility({ externalRequested: true, sourceStatus: { status }, adaptedBody: adaptedBody({ stops: [] }), candidateReadiness: null });
    assert.equal(e.eligible, false, status);
    assert.ok(e.blockers.includes(blocker), `${status} → ${blocker}`);
  }
});

test("unit: a single geocoded stop is not a route", () => {
  const e = evaluateEligibility({
    externalRequested: true,
    sourceStatus: { status: "loaded:1" },
    adaptedBody: adaptedBody({ stops: [{ role: "food_anchor", candidate_id: "r1", coordinates: { lat: 41.9, lng: 12.49 } }], geometry_summary: { coherence: "strong" } }),
    candidateReadiness: { can_support_planner: true },
  });
  assert.equal(e.eligible, false);
  assert.ok(e.blockers.includes("insufficient_geocoded_candidates"));
});

test("unit: weak / incomplete geometry blocks mutation", () => {
  const weak = evaluateEligibility({ externalRequested: true, sourceStatus: { status: "loaded:2" }, adaptedBody: adaptedBody({ geometry_summary: { coherence: "weak" } }), candidateReadiness: { can_support_planner: true } });
  assert.ok(weak.blockers.includes("weak_geometry"));
  const incomplete = evaluateEligibility({ externalRequested: true, sourceStatus: { status: "loaded:2" }, adaptedBody: adaptedBody({ geometry_summary: { coherence: "incomplete" } }), candidateReadiness: { can_support_planner: true } });
  assert.ok(incomplete.blockers.includes("incomplete_geometry"));
});

test("unit: viable trusted pair is eligible; thin readiness is a caveat, not a blocker", () => {
  const e = evaluateEligibility({ externalRequested: true, sourceStatus: { status: "loaded:2" }, adaptedBody: adaptedBody(), candidateReadiness: { can_support_planner: false, real_place_count: 2, coordinate_coverage: 1 } });
  assert.equal(e.eligible, true);
  assert.deepEqual(e.blockers, []);
  // #261: walking-order honesty moved downstream to walking validation, so it is
  // no longer pre-asserted as an eligibility caveat.
  assert.equal(e.caveats.includes("walking_order_unvalidated"), false);
  assert.ok(e.caveats.includes("below_planner_candidate_threshold"));
});

// --- unit: experimental route is honest ------------------------------------

test("unit: experimental route omits ETA/walking/opening-hours and marks order unvalidated", () => {
  const route = buildExperimentalPrimaryRoute({ cityKey: "agnostic-area", adaptedBody: adaptedBody() });
  assert.equal(route.experimental, true);
  assert.equal(route.experimental_agnostic_route, true);
  assert.equal(route.order_confidence, "unvalidated");
  assert.equal(route.order_source, "candidate_role_order");
  assert.equal(route.main_stops.length, 2);
  // No fabricated geometry/timing fields.
  for (const banned of ["estimated_km", "legs", "longest_leg_minutes", "average_leg_minutes", "walk_minutes", "duration_minutes", "opening_hours", "eta"]) {
    assert.equal(banned in route, false, `experimental route must not expose ${banned}`);
  }
  assert.ok(route.caveats.includes("walking_order_unvalidated"));
});

test("unit: experimental route can surface validated proximity ordering metadata", () => {
  const walkingValidation = {
    valid: true,
    result: {
      source: "heuristic",
      estimatedKm: 1.2,
      fallbackUsed: false,
      legs: [{ distance_km: 1.2, estimated_walk_minutes: 16 }],
      pathPoints: [
        { lat: 41.9, lng: 12.49 },
        { lat: 41.901, lng: 12.491 },
      ],
    },
  };
  const routeOrdering = {
    applied: true,
    changed: true,
    source: "trusted_candidate_pool+role_order+proximity_sequence",
    confidence: "walking_budget_candidate",
    original_stop_ids: ["r1", "c1"],
    ordered_stop_ids: ["c1", "r1"],
    reasons: ["proximity_sequence_applied", "requires_walking_budget_validation"],
  };
  const route = buildExperimentalPrimaryRoute({
    cityKey: "agnostic-area",
    adaptedBody: adaptedBody(),
    walkingValidation,
    routeOrdering,
  });

  assert.equal(route.order_source, "trusted_candidate_pool+role_order+proximity_sequence");
  assert.equal(route.order_confidence, "walking_budget_validated");
  assert.equal(route.route_ordering.applied, true);
  assert.deepEqual(route.route_ordering.ordered_stop_ids, ["c1", "r1"]);
  assert.ok(route.caveats.includes("experimental_proximity_sequence"));
});

// --- unit: mutation vs synthesis, original never mutated --------------------

test("unit: replace branch swaps days[0].primary_route, original untouched", () => {
  const baseline = { city: "rome", days: [{ date: DATE, primary_route: { id: "real-route", main_stops: [{ id: "x" }] }, dayflow_context: { keep: true } }], readiness: { ok: true } };
  const exp = buildExperimentalPrimaryRoute({ cityKey: "agnostic-area", adaptedBody: adaptedBody() });
  const mutated = applyRouteMutation({ baselineResult: baseline, primaryRoute: exp, date: DATE });
  assert.equal(mutated.days[0].primary_route.id, exp.id);
  assert.equal(mutated.days[0].experimental_agnostic_route_applied, true);
  assert.equal(mutated.days[0].dayflow_context.keep, true, "non-route day fields preserved");
  // Original object is not mutated.
  assert.equal(baseline.days[0].primary_route.id, "real-route");
  assert.equal(baseline.days[0].experimental_agnostic_route_applied, undefined);
});

test("unit: synthesize branch builds a minimal experimental day for empty baseline", () => {
  const baseline = { city: "atlantis", days: [], readiness: { unsupported: true } };
  const exp = buildExperimentalPrimaryRoute({ cityKey: "agnostic-area", adaptedBody: adaptedBody() });
  const mutated = applyRouteMutation({ baselineResult: baseline, primaryRoute: exp, date: DATE });
  assert.equal(mutated.days.length, 1);
  const day = mutated.days[0];
  assert.equal(day.experimental, true);
  assert.equal(day.experimental_agnostic_day, true);
  assert.equal(day.primary_route.id, exp.id);
  assert.deepEqual(day.alternatives, []);
  // Must NOT mimic a finalized planner day.
  assert.equal("date_signals" in day, false);
  assert.equal("dayflow_context" in day, false);
  assert.deepEqual(baseline.days, [], "original baseline days untouched");
});

test("unit: experiment block preserves baseline primary_route + readiness", () => {
  const baseline = { days: [{ primary_route: { id: "real-route" } }], readiness: { tag: "rich" } };
  const block = buildExperimentBlock({ routeMutation: true, eligibility: { blockers: [], caveats: ["walking_order_unvalidated"] }, baselineResult: baseline, candidateReadiness: { real_place_count: 30 }, experimentalRoute: { id: "exp" }, sourceStatus: { status: "loaded:30" } });
  assert.equal(block.baseline.had_primary_route, true);
  assert.equal(block.baseline.primary_route.id, "real-route");
  assert.deepEqual(block.baseline.readiness, { tag: "rich" });
  assert.equal(block.selected_variant, "experimental_agnostic");
  assert.equal(block.experimental_route.id, "exp");
});

// --- API: default unchanged -------------------------------------------------

test(
  "api: default /api/route-recommendations is unchanged without the flag (recognized city)",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const plain = await requestJson(server, { path: "/api/route-recommendations?lang=en", body: routeBody("rome", ["scenic", "food"]) });
    // Same recognized city, now carrying coords + external opt-in but NO flag:
    // those inputs must be inert on the default path.
    const withInertParams = await requestJson(server, {
      path: "/api/route-recommendations?lang=en&include_external_candidates=1",
      body: routeBody("rome", ["scenic", "food"], { lat: 41.9, lng: 12.49 }),
    });
    assert.equal(plain.status, 200);
    assert.equal(withInertParams.status, 200);
    assert.equal(plain.body.agnostic_route_output_experiment, undefined, "no experiment block by default");
    assert.equal(withInertParams.body.agnostic_route_output_experiment, undefined, "coords+external without the flag add no experiment block");
    assert.deepEqual(primaryRouteShape(withInertParams.body), primaryRouteShape(plain.body), "route shape unchanged");
    assert.deepEqual(Object.keys(withInertParams.body).sort(), Object.keys(plain.body).sort(), "no new default top-level fields");
  }),
);

test(
  "api: unknown city without the flag stays the honest empty fallback (no experiment block)",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, { path: "/api/route-recommendations?lang=en", body: agnosticBody() });
    assert.equal(r.body.agnostic_route_output_experiment, undefined);
    assert.deepEqual(r.body.days, []);
    assert.equal(r.body.city_fallback_used, true);
  }),
);

// --- API: explicit flag required + inspect never mutates --------------------

test(
  "api: the explicit experiment flag is required; inspect tokens never mutate",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const noFlag = await requestJson(server, { path: "/api/route-recommendations?lang=en&include_external_candidates=1", body: agnosticBody() });
    assert.equal(noFlag.body.agnostic_route_output_experiment, undefined);
    assert.deepEqual(noFlag.body.days, []);

    // inspect=agnostic_route_output / agnostic_route_candidate may be present
    // without ever authorizing a mutated/synthesized route.
    for (const token of ["agnostic_route_output", "agnostic_route_candidate"]) {
      const inspected = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&inspect=${token}&include_external_candidates=1`,
        body: agnosticBody(),
      });
      assert.equal(inspected.body.agnostic_route_output_experiment, undefined, `${token} must not add the experiment block`);
      assert.deepEqual(inspected.body.days, [], `${token} must not synthesize a day`);
    }

    const withFlag = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    assert.ok(withFlag.body.agnostic_route_output_experiment, "flag adds the experiment block");
    assert.equal(withFlag.body.agnostic_route_output_experiment.route_mutation, true);
  }),
);

// --- API: synthesis (unknown city) + mutation (no city / default route) -----

test(
  "api: synthesis — unknown city + flag + trusted records produces an experimental day",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, true);
    assert.equal(exp.selected_variant, "experimental_agnostic");
    assert.equal(exp.baseline.had_primary_route, false, "unknown city had no baseline route");
    const day = r.body.days[0];
    assert.equal(day.experimental_agnostic_day, true);
    assert.equal(day.primary_route.experimental, true);
    // #261: the candidate order is now walking-budget validated.
    assert.equal(day.primary_route.order_confidence, "walking_budget_validated");
    assert.ok(day.primary_route.main_stops.length >= 2);
    // Stops are the trusted loader records, not catalog/public data.
    assert.ok(day.primary_route.main_stops.every((s) => /^(food|cafe|view)-/.test(s.id)));
  }),
);

test(
  "api: mutation — no city sent + coords + flag replaces the baseline route, preserving it",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: { dates: [DATE], lat: 41.9, lng: 12.49, preferences: ["food", "coffee"], include_external_candidates: 1 },
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, true);
    // Clarification: for the no-city + coords case the top-level `city` may
    // remain the default baseline city — the baseline response shape is
    // preserved. The agnostic nature is surfaced through the experiment block
    // and the experimental route/day markers, not by relabeling top-level city.
    assert.equal(r.body.city, "rome");
    assert.equal(exp.baseline.had_primary_route, true, "no-city request fell back to the default city route");
    assert.ok(exp.baseline.primary_route && exp.baseline.primary_route.id, "baseline route preserved for comparison");
    assert.notEqual(exp.baseline.primary_route.id, r.body.days[0].primary_route.id, "returned route is the experimental one");
    assert.equal(r.body.days[0].experimental_agnostic_route_applied, true);
    assert.equal(r.body.days[0].primary_route.experimental, true);
  }),
);

// --- API: fail-closed → honest blockers, no mutation ------------------------

test(
  "api: missing coordinates with the experiment flag → no mutation, explicit blocker",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: {
        city: "atlantis-no-coordinates",
        dates: [DATE],
        preferences: ["food", "coffee"],
        include_external_candidates: 1,
      },
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.ok(exp, "explicit experiment flag should return exact blockers even without coords");
    assert.equal(exp.route_mutation, false);
    assert.equal(exp.selected_variant, "baseline");
    assert.equal(exp.eligibility.eligible, false);
    assert.ok(exp.readiness_blockers.includes("missing_or_invalid_coordinates"));
    assert.deepEqual(r.body.days, [], "baseline empty-days fallback is untouched");
    assert.equal(exp.experimental_route, null);
    assert.equal(r.body.city, "atlantis-no-coordinates");
    assert.equal(r.body.city_fallback_used, true);
  }),
);

test(
  "api: invalid coordinates with the experiment flag → no mutation, explicit blocker",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: {
        city: "atlantis-invalid-coordinates",
        dates: [DATE],
        lat: "not-a-number",
        lng: 12.49,
        preferences: ["food", "coffee"],
        include_external_candidates: 1,
      },
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.ok(exp, "explicit experiment flag should return exact blockers for invalid coords");
    assert.equal(exp.route_mutation, false);
    assert.equal(exp.selected_variant, "baseline");
    assert.equal(exp.eligibility.eligible, false);
    assert.ok(exp.readiness_blockers.includes("missing_or_invalid_coordinates"));
    assert.deepEqual(r.body.days, [], "baseline empty-days fallback is untouched");
    assert.equal(exp.experimental_route, null);
    assert.equal(r.body.city, "atlantis-invalid-coordinates");
    assert.equal(r.body.city_fallback_used, true);
  }),
);

test(
  "api: empty trusted loader → no mutation, explicit blockers, baseline intact",
  withServer(makeLoader([]), async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.equal(exp.selected_variant, "baseline");
    assert.ok(exp.readiness_blockers.includes("no_usable_trusted_records"));
    assert.deepEqual(r.body.days, [], "baseline empty-days fallback is untouched");
    assert.equal(exp.experimental_route, null);
  }),
);

test(
  "api: external candidates not requested → no mutation, explicit blocker",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody({ include_external_candidates: undefined }) });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.ok(exp.readiness_blockers.includes("external_candidates_not_requested"));
  }),
);

// --- API: public payload is never trusted ----------------------------------

test(
  "api: public payload.external_provider is ignored — only the server loader is trusted",
  withServer(makeLoader([]), async (server) => {
    // Server loader is empty; the request tries to inject its own "trusted"
    // records via the public payload. They must never become route stops.
    const injected = fixtureNear({ lat: 41.9, lng: 12.49 });
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: agnosticBody({ external_provider: { dataset: injected } }),
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false, "injected payload must not enable a route");
    assert.ok(exp.readiness_blockers.includes("no_usable_trusted_records"));
    assert.deepEqual(r.body.days, []);
  }),
);

// --- API: no named-city hardcoding -----------------------------------------

test(
  "api: capability is coordinate-driven — two different places both work",
  async () => {
    global.fetch = mockStableWeatherFetch();
    for (const base of [{ lat: 41.9, lng: 12.49 }, { lat: 55.6, lng: 13.0 }]) {
      const server = buildApp({ openDataLoader: makeLoader(fixtureNear(base)) }).listen(0);
      try {
        const r = await requestJson(server, {
          path: `/api/route-recommendations?lang=en&${FLAG}`,
          body: { city: "nowhere-pack", dates: [DATE], lat: base.lat, lng: base.lng, preferences: ["food", "coffee", "scenic"], include_external_candidates: 1 },
        });
        assert.equal(r.body.agnostic_route_output_experiment.route_mutation, true, `coords ${base.lat},${base.lng} should produce a route`);
        assert.ok(r.body.days[0].primary_route.main_stops.length >= 2);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
    global.fetch = ORIGINAL_FETCH;
  },
);

test(
  "api: recognized rich citypack + flag is NOT agnostic-gated — route stays the default",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const plain = await requestJson(server, { path: "/api/route-recommendations?lang=en", body: routeBody("rome", ["scenic", "food"]) });
    const flagged = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&include_external_candidates=1`,
      body: routeBody("rome", ["scenic", "food"], { lat: 41.9, lng: 12.49 }),
    });
    assert.equal(flagged.body.agnostic_route_output_experiment, undefined, "recognized city must not engage the experiment");
    assert.deepEqual(primaryRouteShape(flagged.body), primaryRouteShape(plain.body), "recognized-city route is unchanged");
  }),
);

// --- API: no fake ETA / walking / opening-hours / better-route --------------

test(
  "api: experimental route makes no ETA/walking/opening-hours/better-route claims",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const route = r.body.days[0].primary_route;
    // The validated route exposes existing route-result walking fields (`legs`,
    // `map_path_points`) but never an ETA field, opening hours, or legacy
    // route-engine quality fields.
    for (const banned of ["eta", "opening_hours", "longest_leg_minutes", "average_leg_minutes", "walk_minutes", "duration_minutes"]) {
      assert.equal(banned in route, false, `experimental route must not expose ${banned}`);
    }
    // No ETA wording anywhere in the route field names.
    assert.ok(Object.keys(route).every((key) => !key.toLowerCase().includes("eta")), "no field name implies ETA");
    // No leftover unvalidated/no-walking-time caveats.
    assert.equal(route.caveats.includes("walking_order_unvalidated"), false);
    assert.equal(route.caveats.includes("no_walking_time"), false);
    // Banned vocabulary scan: unambiguous quality/comparison CLAIMS.
    const blob = JSON.stringify({ route, experiment: r.body.agnostic_route_output_experiment }).toLowerCase();
    for (const phrase of ["better route", "best route", "optimal", "fastest", "shortest", "recommended over", "minutes away", "min walk", "live that fits"]) {
      assert.equal(blob.includes(phrase), false, `must not claim "${phrase}"`);
    }
  }),
);

// --- pure: composer fail-closed without a loader ----------------------------

test("unit: composer fails closed (no loader) and never mutates", async () => {
  const baseline = { city: "atlantis", days: [], readiness: { unsupported: true } };
  const { result, experiment } = await composeAgnosticRouteOutput({
    coords: { lat: 41.9, lng: 12.49 },
    baselineResult: baseline,
    externalRequested: true,
    openDataLoader: null,
    date: DATE,
  });
  assert.equal(experiment.route_mutation, false);
  assert.ok(experiment.readiness_blockers.includes("no_trusted_loader"));
  assert.equal(result, baseline, "baseline returned unchanged by reference when not eligible");
  assert.equal(typeof buildExperimentalDay, "function");
});
