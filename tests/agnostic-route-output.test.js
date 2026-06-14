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
const { buildAgnosticCityContext } = require("../server/candidates/agnostic-context");
const { buildEligibleCandidatePool, buildProviderSpecs } = require("../server/candidates/candidate-pool");
const { evaluateCandidateGates, targetFromPlaceCandidate } = require("../server/candidates/gates");
const { ExternalOpenCandidateProvider } = require("../server/place-candidates/external-open-provider");
const { createOpenDataLoader } = require("../server/place-candidates/open-data-loader");

const ORIGINAL_FETCH = global.fetch;
const FLAG = "experimental_agnostic_route_output=1";
const DATE = "2026-05-25";
const SUN_AUTO_TZ = {
  condition: "sun",
  maxTemp: 24,
  minTemp: 14,
  apparentTempMax: 23,
  precipitationProbabilityMax: 5,
  precipitationSum: 0,
  windSpeedMax: 8,
  source: "test",
  stale: false,
  timezone_resolution: {
    timezone: "Europe/Rome",
    timezone_source: "weather_provider_auto",
    utc_offset_seconds: 7200,
  },
};

function eveningClock() {
  return new Date("2026-05-25T17:30:00Z");
}

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

function singleFamilyExternalRecord(id, name, type, lat, lng, tags = [], opts = {}) {
  return {
    id,
    name,
    type,
    lat,
    lng,
    tags,
    sources: [
      { provider: "osm", family: "map", tier: "inferred", url: `https://www.openstreetmap.org/node/${id}` },
    ],
    ...(opts.chain !== undefined ? { chain: opts.chain, brand: opts.brand || null } : {}),
  };
}

// Dense but single-family OSM-style fixture: source-backed and geocoded, yet not
// globally promotion-worthy. #270 may admit it only inside the explicit agnostic
// route-output experiment, with the original gate truth still visible.
function singleFamilyFixtureNear(base) {
  const recs = [];
  const j = (i) => ({ lat: base.lat + (i % 5) * 0.0008, lng: base.lng + Math.floor(i / 5) * 0.0008 });
  for (let i = 0; i < 10; i += 1) {
    const c = j(i);
    recs.push(singleFamilyExternalRecord(`osm-food-${i}`, `OSM Food ${i}`, "restaurant", c.lat, c.lng, ["mat"]));
  }
  for (let i = 0; i < 10; i += 1) {
    const c = j(i + 2);
    recs.push(singleFamilyExternalRecord(`osm-cafe-${i}`, `OSM Cafe ${i}`, "cafe", c.lat, c.lng, ["fika"]));
  }
  for (let i = 0; i < 5; i += 1) {
    const c = j(i + 1);
    recs.push(singleFamilyExternalRecord(`osm-view-${i}`, `OSM View ${i}`, "viewpoint", c.lat, c.lng, ["utsikt"]));
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
    source: "trusted_candidate_pool+daypart_rhythm+proximity_sequence",
    confidence: "walking_budget_candidate",
    original_stop_ids: ["r1", "c1"],
    ordered_stop_ids: ["c1", "r1"],
    reasons: ["daypart_sequence_applied", "requires_walking_budget_validation"],
  };
  const route = buildExperimentalPrimaryRoute({
    cityKey: "agnostic-area",
    adaptedBody: adaptedBody(),
    walkingValidation,
    routeOrdering,
  });

  assert.equal(route.order_source, "trusted_candidate_pool+daypart_rhythm+proximity_sequence");
  assert.equal(route.order_confidence, "walking_budget_validated");
  assert.equal(route.route_ordering.applied, true);
  assert.deepEqual(route.route_ordering.ordered_stop_ids, ["c1", "r1"]);
  assert.ok(route.caveats.includes("experimental_daypart_sequence"));
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

// --- #270: inferred external candidate guardrails --------------------------

test("unit: shared gates and default pool still reject single-family inferred external records", () => {
  const base = { lat: 41.9, lng: 12.49 };
  const city = buildAgnosticCityContext({ lat: base.lat, lng: base.lng, todayIsoDate: () => DATE });
  const provider = new ExternalOpenCandidateProvider(city, {
    dataset: [singleFamilyExternalRecord("osm-food-default", "OSM Food Default", "restaurant", base.lat, base.lng, ["mat"])],
    observedAt: DATE,
  });
  const [candidate] = provider.listCandidates();
  const gates = evaluateCandidateGates({ target: targetFromPlaceCandidate(candidate), derived: { existence_confidence: "low", provenance_diversity: 1 } });
  assert.equal(gates.may_show_as_nearby, false);
  assert.equal(gates.may_influence_routes, false);
  assert.ok(gates.reasons.includes("shown_but_not_route_eligible"));

  const providerSpecs = buildProviderSpecs({
    externalEnabled: true,
    externalOptions: { dataset: [singleFamilyExternalRecord("osm-food-pool", "OSM Food Pool", "restaurant", base.lat, base.lng, ["mat"])] },
    now: DATE,
  });
  const pool = buildEligibleCandidatePool(city, { include_external_candidates: 1, preferences: ["food"], origin: base }, { resolveNowContext: () => ({ date: DATE, hour: 13, weekday: null, now_iso: `${DATE}T13:00:00Z` }), resolveTimeBand: () => "midday", external_provider: { dataset: [] } });
  assert.equal(pool.pool.some((entry) => entry.candidate.id === "osm-food-pool"), false);

  const poolWithSpecs = buildEligibleCandidatePool(
    city,
    { include_external_candidates: 1, preferences: ["food"], origin: base },
    {
      resolveNowContext: () => ({ date: DATE, hour: 13, weekday: null, now_iso: `${DATE}T13:00:00Z` }),
      resolveTimeBand: () => "midday",
      external_provider: { dataset: [singleFamilyExternalRecord("osm-food-pool", "OSM Food Pool", "restaurant", base.lat, base.lng, ["mat"])] },
    },
  );
  assert.equal(poolWithSpecs.pool.some((entry) => entry.candidate.id === "osm-food-pool"), false, "default candidate pool must not admit uncorroborated inferred external records");
  assert.ok(providerSpecs.length >= 1, "provider specs are still buildable for external opt-in");
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
    assert.equal(withInertParams.body.readiness_calibration, undefined, "no top-level calibration on default path");
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
    assert.equal(exp.readiness_calibration.status, "thin_usable");
    assert.equal(exp.readiness_calibration.level, "low");
    assert.ok(exp.readiness_calibration.reasons.includes("walking_validated"));
    assert.ok(exp.readiness_calibration.caps.includes("capped_by_partial_context"));
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
  "api: experiment-only inferred external promotion can produce a capped route while preserving gate truth",
  withServer(makeLoader(singleFamilyFixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const withoutFlag = await requestJson(server, {
      path: "/api/route-recommendations?lang=en&include_external_candidates=1",
      body: agnosticBody(),
    });
    assert.equal(withoutFlag.body.agnostic_route_output_experiment, undefined);
    assert.deepEqual(withoutFlag.body.days, [], "default path must not admit single-family inferred records");

    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, true);
    assert.equal(exp.readiness_calibration.status, "thin_usable");
    assert.ok(exp.readiness_calibration.caps.includes("capped_by_external_only_sources"));
    // NOTE: true here is fixture-specific — this fixture has exactly 25 records and
    // DEFAULT_MIN_REAL_PLACES_FOR_PLANNER is 25. Live dense places often land at ~24
    // after dedupe and get `false` (a soft caveat, not a blocker). Do not read this
    // assertion as live behavior.
    assert.equal(exp.candidate_readiness.can_support_planner, true);
    assert.ok(exp.candidate_readiness.warnings.includes("low_trust_candidates_dominate"));
    const stops = r.body.days[0].primary_route.main_stops;
    assert.ok(stops.length >= 2);
    assert.ok(stops.every((stop) => stop.origin === "external_open"));
    assert.ok(stops.every((stop) => stop.confidence === "low"));
    assert.ok(
      exp.experimental_route.gate_diagnostics.some((diag) =>
        diag.reasons.includes("blocked_promotion_uncorroborated"),
      ),
      "experiment diagnostics must carry the true shared-gate rejection reason",
    );
  }),
);

test(
  "api: a corroborated candidate always wins its role over admitted inferred ones (status outranks fit)",
  withServer(
    makeLoader([
      // ONE corroborated food record (map + open_knowledge → diversity 2 → passes
      // shared gates as a real `filled` candidate)...
      externalRecord("food-corroborated", "Corroborated Food", "restaurant", 41.9001, 12.4901, ["mat"]),
      // ...among many single-family inferred records competing for the same role.
      ...singleFamilyFixtureNear({ lat: 41.9, lng: 12.49 }),
    ]),
    async (server) => {
      const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
      const exp = r.body.agnostic_route_output_experiment;
      assert.equal(exp.route_mutation, true);

      const stops = r.body.days[0].primary_route.main_stops;
      const foodStops = stops.filter((stop) => /food/i.test(stop.role || "") || /food/.test(stop.id || ""));
      assert.ok(foodStops.length >= 1, "a food-role stop must exist");
      assert.ok(
        foodStops.some((stop) => stop.id === "food-corroborated"),
        `the corroborated candidate must win the food role; got ${JSON.stringify(foodStops.map((s) => s.id))}`,
      );

      // The corroborated winner passed the shared gates — it must NOT carry an
      // experimental-admission diagnostic. Admitted inferred stops must.
      const diags = exp.experimental_route.gate_diagnostics;
      assert.ok(diags.every((diag) => diag.candidate_id !== "food-corroborated"),
        "a shared-gate-passing stop must not be labeled experimentally admitted");
      assert.ok(diags.length >= 1, "admitted inferred stops still carry diagnostics");
    },
  ),
);

// --- #272: generic local-feel preference (chain demotion + role-type preference)

// Malmö-shaped: brand-tagged chains sit geometrically tightest; non-chain local
// spots exist slightly farther out. Local feel must win over distance.
function malmoShapedFixture(base) {
  return [
    singleFamilyExternalRecord("chain-burger-1", "Chain Burger", "street-food", base.lat, base.lng, ["mat"], { chain: true, brand: "Chain Burger" }),
    singleFamilyExternalRecord("chain-burger-2", "Chain Burger", "street-food", base.lat + 0.0001, base.lng, ["mat"], { chain: true, brand: "Chain Burger" }),
    singleFamilyExternalRecord("chain-espresso", "Chain Espresso", "cafe", base.lat, base.lng + 0.0001, ["fika"], { chain: true, brand: "Chain Espresso" }),
    singleFamilyExternalRecord("local-rest-1", "Lokal Vinkällare", "restaurant", base.lat + 0.004, base.lng + 0.001, ["mat"]),
    singleFamilyExternalRecord("local-rest-2", "Lokal Källare", "restaurant", base.lat + 0.0045, base.lng + 0.0012, ["mat"]),
    singleFamilyExternalRecord("local-street", "Lokal Korv", "street-food", base.lat + 0.0042, base.lng + 0.0011, ["mat"]),
    singleFamilyExternalRecord("local-cafe", "Lokal Pâtisserie", "cafe", base.lat + 0.005, base.lng + 0.0013, ["fika"]),
  ];
}

test(
  "api: #272 non-chain local spots win roles over geometrically tighter chains",
  withServer(makeLoader(malmoShapedFixture({ lat: 55.605, lng: 13.0038 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: agnosticBody({ lat: 55.605, lng: 13.0038, preferences: ["food", "coffee"] }),
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, true);
    const stops = r.body.days[0].primary_route.main_stops;
    const byRole = Object.fromEntries(stops.map((s) => [s.role, s.id]));
    assert.ok(["local-rest-1", "local-rest-2"].includes(byRole.food_anchor),
      `food role must go to a non-chain restaurant, got ${byRole.food_anchor}`);
    assert.equal(byRole.coffee_fika_stop, "local-cafe",
      "coffee role must go to the non-chain cafe, not the tighter chain espresso");
    // No selected stop is a chain → no chain tokens on the route diagnostics.
    for (const diag of exp.experimental_route.gate_diagnostics) {
      assert.ok(!(diag.local_feel_reasons || []).includes("chain_candidate"),
        `selected stop ${diag.candidate_id} must not be a chain here`);
    }
  }),
);

test(
  "api: #272 sparse fallback — a chain still fills the role honestly when nothing local exists",
  withServer(
    makeLoader([
      singleFamilyExternalRecord("chain-burger-only", "Chain Burger", "street-food", 55.605, 13.0038, ["mat"], { chain: true, brand: "Chain Burger" }),
      singleFamilyExternalRecord("local-cafe", "Lokal Pâtisserie", "cafe", 55.6055, 13.004, ["fika"]),
    ]),
    async (server) => {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody({ lat: 55.605, lng: 13.0038, preferences: ["food", "coffee"] }),
      });
      const exp = r.body.agnostic_route_output_experiment;
      assert.equal(exp.route_mutation, true, "chains are a valid sparse fallback — never banned");
      const stops = r.body.days[0].primary_route.main_stops;
      const byRole = Object.fromEntries(stops.map((s) => [s.role, s.id]));
      assert.equal(byRole.food_anchor, "chain-burger-only");
      const chainDiag = exp.experimental_route.gate_diagnostics.find((d) => d.candidate_id === "chain-burger-only");
      assert.ok(chainDiag, "selected chain stop carries a diagnostic");
      assert.ok(chainDiag.local_feel_reasons.includes("chain_candidate"));
      assert.ok(chainDiag.local_feel_reasons.includes("chain_fallback_no_local_option"));
      assert.ok(chainDiag.local_feel_reasons.includes("secondary_type_for_role"));
    },
  ),
);

test(
  "api: #272 role-type preference — restaurant beats street-food for the food role; street-food wins alone",
  withServer(
    makeLoader([
      // Distinct distinctive-name tokens — entity-resolution must not merge these.
      singleFamilyExternalRecord("sf-1", "Snabbmat Expressen", "street-food", 55.605, 13.0038, ["mat"]),
      singleFamilyExternalRecord("rest-1", "Trattoria Bella Vista", "restaurant", 55.6053, 13.004, ["mat"]),
      singleFamilyExternalRecord("cafe-1", "Kafé Hörnan", "cafe", 55.6051, 13.0042, ["fika"]),
    ]),
    async (server) => {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody({ lat: 55.605, lng: 13.0038, preferences: ["food", "coffee"] }),
      });
      const stops = r.body.days[0].primary_route.main_stops;
      const byRole = Object.fromEntries(stops.map((s) => [s.role, s.id]));
      assert.equal(byRole.food_anchor, "rest-1", "primary type (restaurant) wins at equal trust");
    },
  ),
);

test(
  "api: #272 street-food fills the food role when no restaurant exists (secondary type, honest reason)",
  withServer(
    makeLoader([
      singleFamilyExternalRecord("sf-only", "Snabbmat Expressen", "street-food", 55.605, 13.0038, ["mat"]),
      singleFamilyExternalRecord("cafe-1", "Kafé Hörnan", "cafe", 55.6051, 13.0042, ["fika"]),
    ]),
    async (server) => {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody({ lat: 55.605, lng: 13.0038, preferences: ["food", "coffee"] }),
      });
      const exp = r.body.agnostic_route_output_experiment;
      assert.equal(exp.route_mutation, true);
      const byRole = Object.fromEntries(r.body.days[0].primary_route.main_stops.map((s) => [s.role, s.id]));
      assert.equal(byRole.food_anchor, "sf-only");
      const diag = exp.experimental_route.gate_diagnostics.find((d) => d.candidate_id === "sf-only");
      assert.ok(diag.local_feel_reasons.includes("secondary_type_for_role"));
      assert.ok(!diag.local_feel_reasons.includes("chain_candidate"), "non-chain street food is not a chain");
    },
  ),
);

test(
  "api: #272 a gate-passing external chain still surfaces local-feel diagnostics honestly",
  withServer(
    makeLoader([
      // A corroborated chain (map + open_knowledge → diversity 2 → passes shared
      // gates as a real `filled` candidate) carrying the OSM brand tag. Plus a
      // non-chain corroborated cafe for the other role.
      Object.assign(
        externalRecord("food-chain-corr", "Chain Burger", "street-food", 55.605, 13.0038, ["mat"]),
        { chain: true, brand: "Chain Burger" },
      ),
      externalRecord("cafe-local-corr", "Kafé Hörnan", "cafe", 55.6053, 13.004, ["fika"]),
    ]),
    async (server) => {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody({ lat: 55.605, lng: 13.0038, preferences: ["food", "coffee"] }),
      });
      const exp = r.body.agnostic_route_output_experiment;
      assert.equal(exp.route_mutation, true);
      const stops = r.body.days[0].primary_route.main_stops;
      const byRole = Object.fromEntries(stops.map((s) => [s.role, s.id]));
      assert.equal(byRole.food_anchor, "food-chain-corr",
        "the only food option is a corroborated chain — it must still fill the role");
      // The chain is gate-passing (no experimental_admission), but #272 still
      // surfaces local-feel honesty on the selected stop.
      const chainDiag = exp.experimental_route.gate_diagnostics.find((d) => d.candidate_id === "food-chain-corr");
      assert.ok(chainDiag, "a gate-passing chain stop still produces a local-feel diagnostic");
      assert.ok(!("policy" in chainDiag), "no admission policy on a gate-passing stop");
      assert.ok(chainDiag.local_feel_reasons.includes("chain_candidate"));
      assert.ok(chainDiag.local_feel_reasons.includes("secondary_type_for_role"));
      // The non-chain cafe has no local-feel signal → no diagnostic entry.
      assert.equal(exp.experimental_route.gate_diagnostics.find((d) => d.candidate_id === "cafe-local-corr"), undefined);
    },
  ),
);

test(
  "api: #273 a city park fills the scenic role (no viewpoint needed)",
  withServer(
    makeLoader([
      // No viewpoint anywhere (the flat-city case). A park, a square, a castle
      // are the scenic anchors — they must now fill scenic_anchor.
      singleFamilyExternalRecord("scenic-park", "Kungsparken", "park", 55.6053, 13.004, ["park", "green"]),
      singleFamilyExternalRecord("food-1", "Trattoria Bella Vista", "restaurant", 55.605, 13.0038, ["mat"]),
      singleFamilyExternalRecord("cafe-1", "Kafé Hörnan", "cafe", 55.6051, 13.0042, ["fika"]),
    ]),
    async (server) => {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody({ lat: 55.605, lng: 13.0038, preferences: ["food", "coffee", "scenic"] }),
      });
      const exp = r.body.agnostic_route_output_experiment;
      assert.equal(exp.route_mutation, true);
      const byRole = Object.fromEntries(r.body.days[0].primary_route.main_stops.map((s) => [s.role, s.id]));
      assert.equal(byRole.scenic_anchor, "scenic-park", "a park must fill the scenic role when no viewpoint exists");
      // The scenic role is now resolved (was always unresolved before #273).
      const unresolved = (exp.experimental_route.unresolved_roles || []).map((u) => u.role);
      assert.ok(!unresolved.includes("scenic_anchor"), "scenic_anchor should be resolved by the park");
      // Honest labeling: a park is an adjacent (secondary) scenic type vs the
      // canonical viewpoint — the diagnostic says so rather than overclaiming.
      const parkDiag = exp.experimental_route.gate_diagnostics.find((d) => d.candidate_id === "scenic-park");
      assert.ok(parkDiag, "the scenic park stop carries a diagnostic");
      assert.ok((parkDiag.local_feel_reasons || []).includes("secondary_type_for_role"),
        "a park honestly labels as a secondary scenic type (viewpoint is canonical)");
    },
  ),
);

test(
  "api: #273 a viewpoint still wins scenic over a park at equal trust (canonical type ranks first)",
  withServer(
    makeLoader([
      singleFamilyExternalRecord("scenic-park", "Stadsparken", "park", 55.6055, 13.0045, ["park", "green"]),
      singleFamilyExternalRecord("scenic-view", "Utsiktspunkten", "viewpoint", 55.6052, 13.0041, ["utsikt"]),
      singleFamilyExternalRecord("food-1", "Trattoria Bella Vista", "restaurant", 55.605, 13.0038, ["mat"]),
    ]),
    async (server) => {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody({ lat: 55.605, lng: 13.0038, preferences: ["food", "scenic"] }),
      });
      const byRole = Object.fromEntries(r.body.days[0].primary_route.main_stops.map((s) => [s.role, s.id]));
      assert.equal(byRole.scenic_anchor, "scenic-view", "viewpoint is the canonical scenic type and should rank first");
    },
  ),
);

test(
  "api: #272 default path leaks no chain/local-feel fields (flag off → byte-shape unchanged)",
  withServer(makeLoader(malmoShapedFixture({ lat: 55.605, lng: 13.0038 })), async (server) => {
    const r = await requestJson(server, {
      path: "/api/route-recommendations?lang=en&include_external_candidates=1",
      body: agnosticBody({ lat: 55.605, lng: 13.0038, preferences: ["food", "coffee"] }),
    });
    assert.equal(r.body.agnostic_route_output_experiment, undefined);
    assert.deepEqual(r.body.days, []);
    const blob = JSON.stringify(r.body);
    assert.ok(!blob.includes("local_feel"), "local_feel must not leak into default responses");
    assert.ok(!blob.includes("chain_candidate"), "chain tokens must not leak into default responses");
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
    assert.ok(exp.readiness_calibration, "route mutation carries readiness calibration");
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
    assert.equal(exp.readiness_calibration.status, "blocked");
    assert.equal(exp.readiness_calibration.level, "unavailable");
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
    assert.equal(exp.readiness_calibration.status, "blocked");
    assert.equal(exp.readiness_calibration.level, "unavailable");
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
    assert.equal(exp.readiness_calibration.status, "blocked");
    assert.equal(exp.readiness_calibration.level, "unavailable");
    assert.ok(exp.readiness_calibration.reasons.includes("candidate_supply_blocked_route"));
    assert.deepEqual(r.body.days, [], "baseline empty-days fallback is untouched");
    assert.equal(exp.experimental_route, null);
  }),
);

test(
  "api: real loader non-200 surfaces loader_error instead of genuine empty",
  withServer(createOpenDataLoader({ fetcher: async () => ({ ok: false, status: 429 }) }), async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.equal(exp.source_status.status, "error_failed_closed");
    assert.equal(exp.source_status.error, "http_non_200");
    assert.ok(exp.readiness_blockers.includes("loader_error"));
    assert.equal(exp.readiness_blockers.includes("no_usable_trusted_records"), false);
    assert.equal(exp.readiness_calibration.status, "blocked");
    assert.equal(exp.readiness_calibration.inputs.loader_status, "error_failed_closed");
    assert.deepEqual(r.body.days, [], "baseline empty-days fallback is untouched");
  }),
);

test(
  "api: real loader genuine empty remains no_usable_trusted_records",
  withServer(createOpenDataLoader({ fetcher: async () => ({ ok: true, json: async () => ({ elements: [] }) }) }), async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.equal(exp.source_status.status, "loaded:0");
    assert.equal(exp.source_status.error, null);
    assert.ok(exp.readiness_blockers.includes("no_usable_trusted_records"));
    assert.equal(exp.readiness_blockers.includes("loader_error"), false);
  }),
);

test(
  "api: external candidates not requested → no mutation, not applicable calibration",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody({ include_external_candidates: undefined }) });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.ok(exp.readiness_blockers.includes("external_candidates_not_requested"));
    assert.equal(exp.readiness_calibration.status, "not_applicable");
  }),
);

test(
  "api: no loader configured is environment-not-wired, not weak candidate supply",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({ openDataLoader: null }).listen(0);
    try {
      const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
      const calibration = r.body.agnostic_route_output_experiment.readiness_calibration;
      assert.equal(r.body.agnostic_route_output_experiment.route_mutation, false);
      assert.equal(calibration.status, "environment_not_wired");
      assert.equal(calibration.level, "unavailable");
      assert.ok(calibration.reasons.includes("no_trusted_loader"));
      assert.equal(calibration.reasons.includes("candidate_supply_blocked_route"), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  },
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
    assert.equal(exp.readiness_calibration.status, "blocked");
    assert.notEqual(exp.readiness_calibration.status, "usable");
    assert.deepEqual(r.body.days, []);
  }),
);

test(
  "api: public payload cannot inject readiness calibration",
  withServer(makeLoader([]), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: agnosticBody({
        readiness_calibration: {
          status: "usable",
          level: "medium",
          reasons: ["payload"],
          caps: [],
          inputs: { selected_stop_count: 99 },
        },
        confidence: "high",
        readiness: "ready",
        level: "medium",
        status: "usable",
        reasons: ["payload"],
        caps: [],
        inputs: { loader_status: "payload" },
      }),
    });
    const calibration = r.body.agnostic_route_output_experiment.readiness_calibration;
    assert.equal(calibration.status, "blocked");
    assert.equal(calibration.level, "unavailable");
    assert.equal(calibration.reasons.includes("payload"), false);
    assert.notEqual(calibration.inputs.loader_status, "payload");
  }),
);

test(
  "api: resolver-attested timezone route carries conservative medium calibration",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({
      openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
      weatherProvider: async () => ({ condition: "sun", maxTemp: 24, minTemp: 14, apparentTempMax: 23, precipitationProbabilityMax: 5, precipitationSum: 0, windSpeedMax: 8, source: "test", stale: false }),
      clock: eveningClock,
      placeResolver: async () => [{ label: "Resolver place", lat: 41.9, lng: 12.49, confidence: "high", provenance: "test_resolver", timezone: "Europe/Rome" }],
    }).listen(0);
    try {
      const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: { city: "unknown-place", dates: [DATE], place: "Resolver place", preferences: ["food", "coffee", "scenic"], include_external_candidates: 1 } });
      const calibration = r.body.agnostic_route_output_experiment.readiness_calibration;
      assert.equal(r.body.agnostic_route_output_experiment.route_mutation, true);
      assert.ok(["usable", "thin_usable"].includes(calibration.status));
      assert.ok(["medium", "low"].includes(calibration.level));
      assert.notEqual(calibration.level, "high");
      assert.ok(calibration.reasons.includes("walking_validated"));
      assert.ok(calibration.reasons.includes("resolver_attested_timezone"));
      assert.equal(calibration.inputs.timezone_source, "resolver_attested");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  },
);

test(
  "api: weather-provider-auto timezone is capped as derived context",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({
      openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
      weatherProvider: async () => SUN_AUTO_TZ,
      clock: eveningClock,
    }).listen(0);
    try {
      const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
      const calibration = r.body.agnostic_route_output_experiment.readiness_calibration;
      assert.equal(r.body.agnostic_route_output_experiment.route_mutation, true);
      assert.ok(calibration.reasons.includes("weather_provider_auto_timezone"));
      assert.equal(calibration.status, "thin_usable");
      assert.ok(calibration.caps.includes("capped_by_derived_timezone"));
      assert.equal(calibration.inputs.timezone_source, "weather_provider_auto");
      assert.equal(calibration.inputs.timezone_trust, "derived_from_weather_provider");
      assert.equal(calibration.inputs.time_fed_into_selection, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  },
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
    for (const phrase of ["better route", "best route", "optimal", "fastest", "shortest", "recommended over", "minutes away", "min walk", "live that fits", "eta", "opening hours", "open today"]) {
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
  assert.equal(experiment.readiness_calibration.status, "environment_not_wired");
  assert.equal(result, baseline, "baseline returned unchanged by reference when not eligible");
  assert.equal(typeof buildExperimentalDay, "function");
});
