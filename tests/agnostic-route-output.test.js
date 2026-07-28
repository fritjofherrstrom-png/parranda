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
  buildAgnosticPublicResult,
  buildExperimentBlock,
  composeAgnosticRouteOutput,
  scrubAgnosticAppliedDay,
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

// 10:00Z = 12:00 Europe/Rome → "midday" band (SUN_AUTO_TZ resolves Rome, +2h).
function middayClock() {
  return new Date("2026-05-25T10:00:00Z");
}

// 21:30Z = 23:30 Europe/Rome on the selected date.
function lateEveningClock() {
  return new Date("2026-05-25T21:30:00Z");
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
    ...(typeof opts.opening_hours === "string" ? { opening_hours: opts.opening_hours } : {}),
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

function openingHoursFixtureNear(base) {
  const recs = [];
  const point = (i) => ({
    lat: base.lat + (i % 5) * 0.0005,
    lng: base.lng + Math.floor(i / 5) * 0.0005,
  });
  for (let i = 0; i < 5; i += 1) {
    const c = point(i);
    recs.push(singleFamilyExternalRecord(`closed-food-${i}`, `Closed Food ${i}`, "restaurant", c.lat, c.lng, ["mat"], {
      opening_hours: "Mo 09:00-18:00",
    }));
  }
  for (let i = 0; i < 5; i += 1) {
    const c = point(i + 5);
    recs.push(singleFamilyExternalRecord(`late-food-${i}`, `Late Food ${i}`, "restaurant", c.lat, c.lng, ["mat"], {
      opening_hours: "Mo 18:00-02:00",
    }));
  }
  for (let i = 0; i < 5; i += 1) {
    const c = point(i + 10);
    recs.push(singleFamilyExternalRecord(`closed-cafe-${i}`, `Closed Cafe ${i}`, "cafe", c.lat, c.lng, ["fika"], {
      opening_hours: "Mo 07:00-17:00",
    }));
  }
  for (let i = 0; i < 5; i += 1) {
    const c = point(i + 15);
    recs.push(singleFamilyExternalRecord(`unknown-cafe-${i}`, `Unknown Cafe ${i}`, "cafe", c.lat, c.lng, ["fika"], {
      opening_hours: "sunrise-sunset",
    }));
  }
  for (let i = 0; i < 5; i += 1) {
    const c = point(i + 20);
    recs.push(singleFamilyExternalRecord(`late-bar-${i}`, `Late Bar ${i}`, "bar", c.lat, c.lng, ["bar"], {
      opening_hours: "Mo 18:00-02:00",
    }));
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

test("unit: candidate pipeline diagnostics distinguish raw readiness from role-selected stops", () => {
  const e = evaluateEligibility({
    externalRequested: true,
    sourceStatus: { status: "loaded:25" },
    adaptedBody: adaptedBody(),
    candidateReadiness: {
      can_support_planner: true,
      real_place_count: 25,
      coordinate_ready_real_place_count: 25,
      coordinate_coverage: 1,
    },
    plannerRoles: {
      pipeline_summary: {
        identity_resolved_candidate_count: 25,
        eligible_pool_candidate_count: 7,
        rejected_candidate_count: 18,
        availability_evaluated_candidate_count: 6,
        availability_excluded_candidate_count: 3,
        availability_unresolved_candidate_count: 1,
        role_relevant_candidate_count: 4,
        role_surface_candidate_count: 3,
      },
    },
    candidateCombination: { selected: [{ candidate_id: "a" }, { candidate_id: "b" }] },
    engineSourceCandidates: [
      { id: "a", lat: 41.9, lng: 12.49 },
      { id: "b", lat: 41.91, lng: 12.5 },
    ],
  });

  assert.deepEqual(e.checks.candidate_pipeline, {
    coordinate_ready_real_place_count: 25,
    identity_resolved_candidate_count: 25,
    eligible_pool_candidate_count: 7,
    rejected_candidate_count: 18,
    availability_evaluated_candidate_count: 6,
    availability_excluded_candidate_count: 3,
    availability_unresolved_candidate_count: 1,
    role_relevant_candidate_count: 4,
    role_surface_candidate_count: 3,
    combination_selected_candidate_count: 2,
    combination_geocoded_stop_count: 2,
    engine_reservoir_geocoded_stop_count: 2,
  });
  assert.equal(e.eligible, true, "diagnostic counts never change the existing eligibility verdict");
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

// --- unit: #275 daypart honesty -------------------------------------------

test("unit: stops carry honest daypart labels and the arc reflects the role order", () => {
  const route = buildExperimentalPrimaryRoute({
    cityKey: "agnostic-area",
    adaptedBody: adaptedBody(),
    walkingValidation: {
      valid: true,
      result: {
        source: "heuristic",
        estimatedKm: 0.3,
        legs: [{ estimated_walk_minutes: 4 }],
        pathPoints: [{ lat: 41.9, lng: 12.49 }, { lat: 41.901, lng: 12.491 }],
      },
    },
    routeOrdering: { applied: true, source: "trusted_candidate_pool+daypart_rhythm+proximity_sequence" },
  });
  // adaptedBody() stops are food_anchor + coffee_fika_stop → afternoon + morning.
  assert.deepEqual(route.main_stops.map((s) => s.daypart), ["afternoon", "morning"]);
  assert.deepEqual(route.daypart_arc, ["afternoon", "morning"]);
});

test("unit: daypart_arc_precedes_local_time caveat fires only when the arc leads before the trusted band", () => {
  const wv = {
    valid: true,
    result: {
      source: "heuristic",
      estimatedKm: 0.5,
      legs: [{ estimated_walk_minutes: 5 }, { estimated_walk_minutes: 6 }],
      pathPoints: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0, lng: 0.002 }],
    },
  };
  const morningArc = adaptedBody({
    stops: [
      { role: "coffee_fika_stop", candidate_id: "c", label: "C", origin: "external_open", confidence: "low", coordinates: { lat: 0, lng: 0 } },
      { role: "scenic_anchor", candidate_id: "s", label: "S", origin: "external_open", confidence: "low", coordinates: { lat: 0, lng: 0.001 } },
      { role: "food_anchor", candidate_id: "f", label: "F", origin: "external_open", confidence: "low", coordinates: { lat: 0, lng: 0.002 } },
    ],
  });
  const ro = { applied: true, source: "trusted_candidate_pool+daypart_rhythm+proximity_sequence" };

  const atEvening = buildExperimentalPrimaryRoute({ cityKey: "x", adaptedBody: morningArc, walkingValidation: wv, routeOrdering: ro, currentTimeBand: "evening" });
  assert.ok(atEvening.caveats.includes("daypart_arc_precedes_local_time"), "evening request leading with morning → caveat");
  assert.equal(atEvening.current_local_time_band, "evening");

  const atMorning = buildExperimentalPrimaryRoute({ cityKey: "x", adaptedBody: morningArc, walkingValidation: wv, routeOrdering: ro, currentTimeBand: "morning" });
  assert.equal(atMorning.caveats.includes("daypart_arc_precedes_local_time"), false, "morning request aligns → no caveat");

  const tzUnknown = buildExperimentalPrimaryRoute({ cityKey: "x", adaptedBody: morningArc, walkingValidation: wv, routeOrdering: ro, currentTimeBand: null });
  assert.equal(tzUnknown.caveats.includes("daypart_arc_precedes_local_time"), false, "tz unknown → positional arc, no caveat");
  assert.equal(tzUnknown.current_local_time_band, null, "no fabricated band when tz unknown");

  const atNight = buildExperimentalPrimaryRoute({ cityKey: "x", adaptedBody: morningArc, walkingValidation: wv, routeOrdering: ro, currentTimeBand: "late" });
  assert.equal(atNight.caveats.includes("daypart_arc_precedes_local_time"), false, "night reads as the coming day → no caveat");
});

test("unit: #276 an anchored route reports the trim and never also 'precedes' the local time", () => {
  const wv = {
    valid: true,
    result: { source: "heuristic", estimatedKm: 0.4, legs: [{ estimated_walk_minutes: 5 }], pathPoints: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }] },
  };
  // The morning/midday stops were already trimmed by the caller; the route here
  // only carries afternoon + evening and is flagged anchored.
  const anchoredBody = adaptedBody({
    stops: [
      { role: "food_anchor", candidate_id: "f", label: "F", origin: "external_open", confidence: "low", coordinates: { lat: 0, lng: 0 } },
      { role: "evening_bar_option", candidate_id: "b", label: "B", origin: "external_open", confidence: "low", coordinates: { lat: 0, lng: 0.001 } },
    ],
  });
  const ro = { applied: true, source: "trusted_candidate_pool+daypart_rhythm+proximity_sequence" };
  const route = buildExperimentalPrimaryRoute({
    cityKey: "x",
    adaptedBody: anchoredBody,
    walkingValidation: wv,
    routeOrdering: ro,
    currentTimeBand: "afternoon",
    anchoredToLocalTime: true,
    trimmedDayparts: ["morning", "midday"],
  });
  assert.deepEqual(route.daypart_arc, ["afternoon", "evening"]);
  assert.equal(route.anchored_to_local_time, true);
  assert.deepEqual(route.trimmed_dayparts, ["morning", "midday"]);
  assert.ok(route.caveats.includes("day_anchored_to_current_time"));
  assert.equal(route.caveats.includes("daypart_arc_precedes_local_time"), false, "anchored cannot also precede");
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

test("unit: engaged any-place root never exposes a fallback city's public truth", () => {
  const baseline = {
    city: "rome",
    days: [{ primary_route: { id: "rome-route", main_stops: [{ id: "rome-stop" }] } }],
    resolved_home_base: { label: "Rome" },
    resolved_start: { label: "Rome" },
    resolved_end: { label: "Rome" },
    readiness: { status: "ready" },
  };
  const blocked = buildAgnosticPublicResult({ result: baseline, routeApplied: false });

  assert.equal(blocked.city, null);
  assert.deepEqual(blocked.days, []);
  assert.equal(blocked.resolved_home_base, null);
  assert.equal(blocked.resolved_start, null);
  assert.equal(blocked.resolved_end, null);
  assert.equal(blocked.readiness, null);
  assert.equal(baseline.city, "rome", "comparison baseline remains untouched");
  assert.equal(baseline.days[0].primary_route.id, "rome-route");
});

test("unit: experiment block preserves baseline primary_route + readiness", () => {
  const baseline = { days: [{ primary_route: { id: "real-route" } }], readiness: { tag: "rich" } };
  const block = buildExperimentBlock({
    routeMutation: true,
    eligibility: { blockers: [], caveats: ["walking_order_unvalidated"] },
    baselineResult: baseline,
    candidateReadiness: { real_place_count: 30 },
    experimentalRoute: { id: "exp" },
    sourceStatus: { status: "loaded:30" },
    requestedDate: DATE,
  });
  assert.equal(block.baseline.had_primary_route, true);
  assert.equal(block.baseline.primary_route.id, "real-route");
  assert.deepEqual(block.baseline.readiness, { tag: "rich" });
  assert.equal(block.selected_variant, "experimental_agnostic");
  assert.equal(block.experimental_route.id, "exp");
  assert.equal(block.readiness_calibration.inputs.requested_date, DATE);
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

// --- API: #277 culture role -------------------------------------------------

test(
  "api: a requested museums preference fills a daytime culture stop (was silently dropped)",
  withServer(
    makeLoader([
      singleFamilyExternalRecord("cafe-1", "Kafé Hörnan", "cafe", 41.9, 12.49, ["fika"]),
      singleFamilyExternalRecord("museum-1", "Stadsmuseet", "museum", 41.901, 12.491, ["kultur", "museum"]),
      singleFamilyExternalRecord("food-1", "Trattoria Bella Vista", "restaurant", 41.902, 12.492, ["mat"]),
    ]),
    async (server) => {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody({ preferences: ["coffee", "museums", "food"] }),
      });
      const exp = r.body.agnostic_route_output_experiment;
      assert.equal(exp.route_mutation, true);
      const byRole = Object.fromEntries(r.body.days[0].primary_route.main_stops.map((s) => [s.role, s.id]));
      assert.equal(byRole.culture_stop, "museum-1", "the museum fills a culture role instead of vanishing");
      assert.ok(exp.experimental_route.target_roles.includes("culture_stop"));
      // Honest daypart: museums are a daytime (midday) stop, before the food anchor.
      const stops = r.body.days[0].primary_route.main_stops;
      const cultureIdx = stops.findIndex((s) => s.role === "culture_stop");
      const foodIdx = stops.findIndex((s) => s.role === "food_anchor");
      assert.equal(stops[cultureIdx].daypart, "midday");
      assert.ok(cultureIdx < foodIdx, "the museum (midday) comes before the food anchor (afternoon)");
    },
  ),
);

test(
  "api: a request without a museums preference produces no culture role (default behaviour unchanged)",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const target = r.body.agnostic_route_output_experiment.experimental_route.target_roles || [];
    assert.equal(target.includes("culture_stop"), false, "culture role only appears when museums is requested");
  }),
);

// --- API: #278 market role --------------------------------------------------

test(
  "api: a requested markets preference fills a daytime market stop (was silently dropped)",
  withServer(
    makeLoader([
      singleFamilyExternalRecord("cafe-1", "Kafé Hörnan", "cafe", 41.9, 12.49, ["fika"]),
      singleFamilyExternalRecord("market-1", "Mercato Centrale", "market", 41.901, 12.491, ["market"]),
      singleFamilyExternalRecord("food-1", "Trattoria Bella Vista", "restaurant", 41.902, 12.492, ["mat"]),
    ]),
    async (server) => {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody({ preferences: ["coffee", "markets", "food"] }),
      });
      const exp = r.body.agnostic_route_output_experiment;
      assert.equal(exp.route_mutation, true);
      const byRole = Object.fromEntries(r.body.days[0].primary_route.main_stops.map((s) => [s.role, s.id]));
      assert.equal(byRole.market_stop, "market-1", "the market fills a market role instead of vanishing");
      assert.ok(exp.experimental_route.target_roles.includes("market_stop"));
      // Honest daypart: markets are a daytime (midday) stop, before the food anchor.
      const stops = r.body.days[0].primary_route.main_stops;
      const marketIdx = stops.findIndex((s) => s.role === "market_stop");
      const foodIdx = stops.findIndex((s) => s.role === "food_anchor");
      assert.equal(stops[marketIdx].daypart, "midday");
      assert.ok(marketIdx < foodIdx, "the market (midday) comes before the food anchor (afternoon)");
    },
  ),
);

test(
  "api: a request without a markets preference produces no market role (default behaviour unchanged)",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const target = r.body.agnostic_route_output_experiment.experimental_route.target_roles || [];
    assert.equal(target.includes("market_stop"), false, "market role only appears when markets is requested");
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
    const pipeline = exp.eligibility.checks.candidate_pipeline;
    for (const [field, value] of Object.entries(pipeline)) {
      assert.equal(Number.isInteger(value), true, `${field} is an explicit stage count`);
    }
    assert.ok(pipeline.identity_resolved_candidate_count >= pipeline.eligible_pool_candidate_count);
    assert.ok(pipeline.eligible_pool_candidate_count >= pipeline.role_relevant_candidate_count);
    assert.ok(pipeline.role_relevant_candidate_count >= pipeline.role_surface_candidate_count);
    assert.ok(pipeline.role_surface_candidate_count >= pipeline.combination_selected_candidate_count);
    assert.equal(
      pipeline.combination_selected_candidate_count,
      pipeline.combination_geocoded_stop_count,
      "the fixture's selected route candidates all carry coordinates",
    );
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
  "api: a broad local reservoir does not auto-compose its chain-only food match",
  withServer(
    makeLoader([
      singleFamilyExternalRecord("chain-food", "Chain Food", "street-food", 59.3293, 18.0686, ["mat"], { chain: true, brand: "Chain Food" }),
      singleFamilyExternalRecord("local-cafe", "Konditori Aurora", "cafe", 59.3302, 18.0694, ["fika"]),
      singleFamilyExternalRecord("local-view", "Utsiktsplats Höjden", "viewpoint", 59.331, 18.0702, ["utsikt"]),
      singleFamilyExternalRecord("local-park", "Parkallén", "park", 59.3318, 18.071, ["park", "green"]),
      singleFamilyExternalRecord("local-museum", "Stadsmuseet", "museum", 59.3326, 18.0718, ["kultur", "museum"]),
    ]),
    async (server) => {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody({
          lat: 59.3293,
          lng: 18.0686,
          preferences: ["food", "coffee", "scenic", "museums"],
        }),
      });
      const exp = r.body.agnostic_route_output_experiment;
      assert.equal(exp.route_mutation, true);
      const stopIds = r.body.days[0].primary_route.main_stops.map((stop) => stop.id);
      assert.equal(stopIds.includes("chain-food"), false, "a chain must not pad an otherwise broad local day");
      assert.ok(stopIds.includes("local-cafe"), "the honest adjacent local option remains available");
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
    // The fallback route remains available for experiment comparison, but no
    // fallback-city identity or readiness may survive in the public root.
    assert.equal(r.body.city, null);
    assert.equal(r.body.readiness, null);
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
      body: agnosticBody({
        external_provider: { dataset: injected },
        opening_hours: "payload_opening_hours",
        availability: { eligible: true, status: "available" },
        selected_day_hours: {
          status: "known",
          all_day: true,
          windows: [],
          marker: "payload_selected_day_hours",
        },
        evaluateCandidateAvailability: "payload_evaluator",
      }),
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false, "injected payload must not enable a route");
    assert.ok(exp.readiness_blockers.includes("no_usable_trusted_records"));
    assert.equal(exp.readiness_calibration.status, "blocked");
    assert.notEqual(exp.readiness_calibration.status, "usable");
    assert.deepEqual(r.body.days, []);
    assert.equal(JSON.stringify(r.body).includes("payload_opening_hours"), false);
    assert.equal(JSON.stringify(r.body).includes("payload_selected_day_hours"), false);
    assert.equal(JSON.stringify(r.body).includes("payload_evaluator"), false);
  }),
);

test(
  "api: trusted loader context comes from resolved intake and normalized planner preferences, never payload control fields",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const calls = [];
    const loader = async (request) => {
      calls.push(structuredClone(request));
      const records = fixtureNear({ lat: 41.9, lng: 12.49 }).map((record) => ({ ...record }));
      Object.defineProperty(records, "loader_status", { value: `loaded:${records.length}`, configurable: true });
      Object.defineProperty(records, "loader_metadata", {
        value: {
          base_radius_km: 1.5,
          selected_radius_km: 5,
          attempted_radius_km: 5,
          expansion_applied: true,
          expansion_trigger: "requested_intent_gap",
          selection_reason: "richer_wider_supply",
          anchor_mode: request.anchorMode,
          requested_intents: ["food", "scenic"],
          initial_profile: { record_count: 8, category_count: 2, requested_intent_count: 2, requested_intents_covered: ["food"], requested_intents_partial: [], requested_intents_missing: ["scenic"] },
          selected_profile: { record_count: records.length, category_count: 3, requested_intent_count: 2, requested_intents_covered: ["food", "scenic"], requested_intents_partial: [], requested_intents_missing: [] },
        },
        configurable: true,
      });
      return records;
    };
    const server = buildApp({ openDataLoader: loader }).listen(0);
    try {
      const response = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody({
          preferences: ["food", "views"],
          requestedIntents: ["swimming"],
          anchorMode: "place",
          loader_metadata: { selected_radius_km: 999 },
        }),
      });
      assert.ok(calls.length >= 1);
      assert.ok(calls.every((call) => call.anchorMode === "coordinates"));
      assert.ok(calls.every((call) => JSON.stringify(call.requestedIntents) === JSON.stringify(["food", "views"])));
      const collection = response.body.agnostic_route_output_experiment.source_status.collection;
      assert.equal(collection.anchor_mode, "coordinates");
      assert.equal(collection.selected_radius_km, 5);
      assert.deepEqual(collection.requested_intents, ["food", "scenic"]);
      assert.equal(response.body.loader_metadata, undefined);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  },
);

test("api: only resolver-attested spatial scope can reach regional collection", async () => {
  global.fetch = mockStableWeatherFetch();
  const calls = [];
  const trustedScope = {
    source: "test_resolver",
    kind: "region",
    bounds: { south: 55.3, north: 55.9, west: 14, east: 14.3 },
  };
  const loader = async (request) => {
    calls.push(structuredClone(request));
    const records = fixtureNear({ lat: 55.6, lng: 14.15 });
    Object.defineProperty(records, "loader_status", { value: `loaded:${records.length}`, configurable: true });
    Object.defineProperty(records, "loader_metadata", {
      value: {
        base_radius_km: 1.5,
        selected_radius_km: 3,
        expansion_applied: true,
        expansion_trigger: "regional_scope_gap",
        selection_reason: "richer_regional_cluster",
        anchor_mode: request.anchorMode,
        requested_intents: ["food", "scenic"],
        spatial_scope: {
          source: "test_resolver",
          kind: "region",
          collection_mode: "regional_bounded",
          diagonal_km: 69,
        },
        regional_scout: {
          attempted: true,
          status: `loaded:${records.length}`,
          reason: "richer_regional_cluster",
          selected_anchor: "scope_axis_low",
          selected_anchor_coords: { lat: 55.45, lng: 14.15 },
          cluster_count: 3,
          clusters: [],
        },
      },
      configurable: true,
    });
    return records;
  };
  const server = buildApp({
    openDataLoader: loader,
    placeResolver: async () => [{
      label: "Resolved region",
      lat: 55.6,
      lng: 14.15,
      confidence: "medium",
      provenance: "test_resolver",
      spatial_scope: trustedScope,
    }],
  }).listen(0);
  try {
    const response = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: agnosticBody({
        lat: undefined,
        lng: undefined,
        place: "A region",
        preferences: ["food", "views"],
        spatialScope: { bounds: { south: -90, north: 90, west: -180, east: 180 } },
        spatial_scope: { collection_mode: "regional_bounded", bounds: { south: 0, north: 1, west: 0, east: 1 } },
      }),
    });

    assert.ok(calls.length >= 1);
    assert.ok(calls.every((call) => call.anchorMode === "place"));
    assert.ok(calls.every((call) => call.spatialScope?.bounds?.south === 55.3));
    const collection = response.body.agnostic_route_output_experiment.source_status.collection;
    assert.equal(collection.spatial_scope.collection_mode, "regional_bounded");
    assert.equal(collection.regional_scout.selected_anchor, "scope_axis_low");
    assert.equal("selected_anchor_coords" in collection.regional_scout, false);
    assert.equal(JSON.stringify(response.body).includes('"south":-90'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = ORIGINAL_FETCH;
  }
});

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

test(
  "api: trusted local opening hours exclude proven-closed candidates and fail open on unresolved schedules",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({
      openDataLoader: makeLoader(openingHoursFixtureNear({ lat: 41.9, lng: 12.49 })),
      weatherProvider: async () => ({
        condition: "sun",
        maxTemp: 24,
        minTemp: 14,
        apparentTempMax: 23,
        precipitationProbabilityMax: 5,
        precipitationSum: 0,
        windSpeedMax: 8,
        source: "test",
        stale: false,
      }),
      clock: lateEveningClock,
      placeResolver: async () => [{
        label: "Resolver place",
        lat: 41.9,
        lng: 12.49,
        confidence: "high",
        provenance: "test_resolver",
        timezone: "Europe/Rome",
      }],
    }).listen(0);
    try {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: {
          city: "unknown-place",
          dates: [DATE],
          place: "Resolver place",
          preferences: ["food", "coffee", "bars"],
          include_external_candidates: 1,
        },
      });
      const experiment = r.body.agnostic_route_output_experiment;
      const route = r.body.days[0].primary_route;
      const stopIds = route.main_stops.map((stop) => stop.id);

      assert.equal(experiment.route_mutation, true);
      assert.ok(stopIds.some((id) => id.startsWith("late-")), "late-local candidates remain eligible");
      assert.ok(stopIds.some((id) => id.startsWith("unknown-cafe-")), "unresolved schedules fail open");
      assert.equal(stopIds.some((id) => id.startsWith("closed-")), false, "proven-closed candidates never reach the route");
      const stopsWithSelectedDayHours = route.main_stops.filter((stop) => stop.selected_day_hours);
      assert.ok(stopsWithSelectedDayHours.length > 0, "supported source hours reach selected route stops");
      assert.ok(stopsWithSelectedDayHours.every((stop) => stop.selected_day_hours.status === "known"));
      assert.ok(
        stopsWithSelectedDayHours.every((stop) =>
          stop.selected_day_hours.windows.every((window) => /^\d{2}:\d{2}$/.test(window.opens) && /^\d{2}:\d{2}$/.test(window.closes)),
        ),
      );
      assert.equal(
        route.main_stops.some((stop) => stop.id.startsWith("unknown-cafe-") && stop.selected_day_hours),
        false,
        "unresolved schedules stay off the public stop contract",
      );
      assert.equal(experiment.context.time.timezone_source, "resolver_attested");
      assert.equal(experiment.context.influence.opening_hours_fed_into_selection, true);
      assert.ok(experiment.context.influence.opening_hours_excluded_candidate_count > 0);
      assert.ok(experiment.context.influence.opening_hours_unresolved_candidate_count > 0);
      assert.equal("opening_hours" in route, false, "raw opening-hours fields stay off the public route");
      assert.equal(JSON.stringify(r.body).includes("Mo 09:00-18:00"), false, "raw schedule values stay internal");
      assert.equal(JSON.stringify(r.body).includes("raw_schedule"), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  },
);

// --- API: #276 time-anchored selection (proves ctx.timeBand reaches the route)

test(
  "api: a today-dated request at midday anchors the day to now and drops the morning",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({
      openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
      weatherProvider: async () => SUN_AUTO_TZ,
      clock: middayClock,
    }).listen(0);
    try {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: { city: "unknown-place", dates: [DATE], lat: 41.9, lng: 12.49, preferences: ["food", "coffee", "scenic"], include_external_candidates: 1 },
      });
      const route = r.body.days[0].primary_route;
      // ctx.timeBand (midday) reached the route AND drove anchoring.
      assert.equal(route.current_local_time_band, "midday");
      assert.equal(route.anchored_to_local_time, true);
      assert.ok(route.trimmed_dayparts.includes("morning"), "the already-past morning coffee is dropped");
      assert.equal(route.daypart_arc[0], "midday", "the day now starts at the current band");
      assert.ok(route.caveats.includes("day_anchored_to_current_time"));
      assert.equal(route.caveats.includes("daypart_arc_precedes_local_time"), false);
      assert.ok(route.main_stops.length >= 2, "conservative floor: a real day still has >=2 stops");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  },
);

test(
  "api: a future-dated request keeps the full day arc and never claims it precedes now",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({
      openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
      weatherProvider: async () => SUN_AUTO_TZ,
      clock: middayClock,
    }).listen(0);
    try {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: { city: "unknown-place", dates: ["2026-05-30"], lat: 41.9, lng: 12.49, preferences: ["food", "coffee", "scenic"], include_external_candidates: 1 },
      });
      const route = r.body.days[0].primary_route;
      assert.equal(route.anchored_to_local_time, false, "a future plan is not trimmed");
      assert.deepEqual(route.trimmed_dayparts, []);
      assert.equal(route.current_local_time_band, null, "the current band is irrelevant to a future day");
      assert.equal(route.caveats.includes("daypart_arc_precedes_local_time"), false, "a future morning is not 'past'");
      assert.equal(route.caveats.includes("day_anchored_to_current_time"), false);
      assert.ok(route.daypart_arc.includes("morning"), "the full arc is kept");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  },
);

test("engine compose anchors a today route before geometry and exposes the shared time truth", async () => {
  global.fetch = mockStableWeatherFetch();
  try {
    const { result } = await composeAgnosticRouteOutput({
      coords: { lat: 41.9, lng: 12.49 },
      baselineResult: { city: "rome", days: [{ date: DATE, primary_route: null, alternatives: [] }] },
      externalRequested: true,
      openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
      preferences: ["food", "coffee", "scenic"],
      date: DATE,
      todayIsoDate: DATE,
      synthesizeVia: "engine",
      weatherProvider: async () => SUN_AUTO_TZ,
      clock: middayClock,
      placeLabel: "Rome",
      lang: "en",
    });
    const route = result.days[0].primary_route;
    assert.ok(route);
    assert.equal(route.current_local_time_band, "midday");
    assert.equal(route.anchored_to_local_time, true);
    assert.ok(route.trimmed_dayparts.includes("morning"));
    assert.equal(route.daypart_arc[0], "midday");
    assert.ok(route.caveats.includes("day_anchored_to_current_time"));
    assert.equal(route.caveats.includes("daypart_arc_precedes_local_time"), false);
  } finally {
    global.fetch = ORIGINAL_FETCH;
  }
});

test("engine compose keeps a viable full-day arc with an explicit caveat when evening anchoring would be too thin", async () => {
  global.fetch = mockStableWeatherFetch();
  try {
    const { result } = await composeAgnosticRouteOutput({
      coords: { lat: 41.9, lng: 12.49 },
      baselineResult: { city: "rome", days: [{ date: DATE, primary_route: null, alternatives: [] }] },
      externalRequested: true,
      openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
      preferences: ["food", "coffee", "scenic"],
      date: DATE,
      todayIsoDate: DATE,
      synthesizeVia: "engine",
      weatherProvider: async () => SUN_AUTO_TZ,
      clock: eveningClock,
      placeLabel: "Rome",
      lang: "en",
    });
    const route = result.days[0].primary_route;
    assert.ok(route, "the viable full-day route remains available");
    assert.equal(route.current_local_time_band, "evening");
    assert.equal(route.anchored_to_local_time, false);
    assert.deepEqual(route.trimmed_dayparts, []);
    assert.ok(route.caveats.includes("daypart_arc_precedes_local_time"));
    assert.equal(route.caveats.includes("day_anchored_to_current_time"), false);
  } finally {
    global.fetch = ORIGINAL_FETCH;
  }
});

test("engine compose does not apply current-time truth to a future date", async () => {
  global.fetch = mockStableWeatherFetch();
  try {
    const { result } = await composeAgnosticRouteOutput({
      coords: { lat: 41.9, lng: 12.49 },
      baselineResult: { city: "rome", days: [{ date: "2026-05-30", primary_route: null, alternatives: [] }] },
      externalRequested: true,
      openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
      preferences: ["food", "coffee", "scenic"],
      date: "2026-05-30",
      todayIsoDate: DATE,
      synthesizeVia: "engine",
      weatherProvider: async () => SUN_AUTO_TZ,
      clock: middayClock,
      placeLabel: "Rome",
      lang: "en",
    });
    const route = result.days[0].primary_route;
    assert.ok(route);
    assert.equal(route.current_local_time_band, null);
    assert.equal(route.anchored_to_local_time, false);
    assert.deepEqual(route.trimmed_dayparts, []);
    assert.equal(route.caveats.includes("daypart_arc_precedes_local_time"), false);
  } finally {
    global.fetch = ORIGINAL_FETCH;
  }
});

// --- API: no named-city hardcoding -----------------------------------------

test(
  "api: capability is coordinate-driven across central and peripheral anchors",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const anchors = [
      { lat: 41.9, lng: 12.49 },
      { lat: 55.6, lng: 13.0 },
      { lat: 59.367, lng: 17.886 },
      { lat: 35.174, lng: 33.364 },
    ];
    for (const base of anchors) {
      const server = buildApp({ openDataLoader: makeLoader(fixtureNear(base)) }).listen(0);
      try {
        const r = await requestJson(server, {
          path: `/api/route-recommendations?lang=en&${FLAG}&agnostic_engine_compose=1`,
          body: { city: "nowhere-pack", dates: [DATE], lat: base.lat, lng: base.lng, preferences: ["food", "coffee", "scenic"], include_external_candidates: 1 },
        });
        assert.equal(r.body.agnostic_route_output_experiment.route_mutation, true, `coords ${base.lat},${base.lng} should produce a route`);
        const route = r.body.days[0].primary_route;
        assert.ok(route.main_stops.length >= 2);
        assert.deepEqual(route.map_path_points[0], base, "the route path must begin at the explicit anchor");
        assert.deepEqual(route.map_path_points.at(-1), base, "the route path must return to the explicit anchor");
        const firstStop = route.main_stops[0];
        assert.ok(
          Math.abs(firstStop.lat - base.lat) < 0.02 && Math.abs(firstStop.lng - base.lng) < 0.02,
          `first stop must stay local to anchor ${base.lat},${base.lng}`,
        );
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

test("unit: wider discovery cannot turn a remote cluster into a near-me walking route", async () => {
  const origin = { lat: 41.9, lng: 12.49 };
  const remote = fixtureNear({ lat: 41.95, lng: 12.55 });
  const baseline = { city: "atlantis", days: [], readiness: { unsupported: true } };

  const exact = await composeAgnosticRouteOutput({
    coords: origin,
    baselineResult: baseline,
    externalRequested: true,
    openDataLoader: makeLoader(remote),
    preferences: ["food", "coffee", "scenic"],
    date: DATE,
    anchorMode: "coordinates",
  });
  assert.equal(exact.experiment.route_mutation, false);
  assert.ok(exact.experiment.readiness_blockers.includes("candidate_cluster_outside_origin_reach"));
  assert.equal(exact.experiment.readiness_blockers.includes("incomplete_geometry"), false);

  const area = await composeAgnosticRouteOutput({
    coords: origin,
    baselineResult: baseline,
    externalRequested: true,
    openDataLoader: makeLoader(remote),
    preferences: ["food", "coffee", "scenic"],
    date: DATE,
    anchorMode: "place",
  });
  assert.equal(area.experiment.route_mutation, false, "missing scope cannot silently grant regional reach");
  assert.ok(area.experiment.readiness_blockers.includes("candidate_cluster_outside_origin_reach"));

  const settlement = await composeAgnosticRouteOutput({
    coords: origin,
    baselineResult: baseline,
    externalRequested: true,
    openDataLoader: makeLoader(remote),
    preferences: ["food", "coffee", "scenic"],
    date: DATE,
    anchorMode: "place",
    spatialScope: {
      kind: "settlement",
      bounds: { south: 41.6, north: 42.2, west: 12.3, east: 12.7 },
    },
  });
  assert.equal(settlement.experiment.route_mutation, false);
  assert.ok(settlement.experiment.readiness_blockers.includes("candidate_cluster_outside_origin_reach"));
  assert.deepEqual(
    settlement.experiment.eligibility.checks.candidate_reach_policy,
    {
      policy: "local_place_anchor",
      max_origin_distance_km: 3,
      scope_kind: "settlement",
    },
  );
  assert.equal(
    settlement.experiment.eligibility.checks.candidate_pipeline.reach_eligible_candidate_count,
    0,
  );
  assert.equal(
    settlement.experiment.eligibility.checks.candidate_pipeline.reach_excluded_candidate_count,
    settlement.experiment.eligibility.checks.candidate_pipeline.eligible_pool_candidate_count,
  );

  const mixed = fixtureNear(origin).map((candidate) =>
    candidate.id.startsWith("view-")
      ? { ...candidate, lat: candidate.lat + 0.05, lng: candidate.lng + 0.06 }
      : candidate,
  );
  const localDay = await composeAgnosticRouteOutput({
    coords: origin,
    baselineResult: baseline,
    externalRequested: true,
    openDataLoader: makeLoader(mixed),
    preferences: ["food", "coffee", "scenic"],
    date: DATE,
    anchorMode: "place",
    spatialScope: {
      kind: "settlement",
      bounds: { south: 41.6, north: 42.2, west: 12.3, east: 12.7 },
    },
  });
  assert.equal(localDay.experiment.route_mutation, true, "missing scenic stays unresolved instead of relocating the day");
  assert.equal(
    localDay.experiment.experimental_route.main_stops.some((stop) => stop.id.startsWith("view-")),
    false,
  );
  assert.ok(
    localDay.experiment.experimental_route.unresolved_roles.some((entry) => entry.role === "scenic_anchor"),
  );

  const region = await composeAgnosticRouteOutput({
    coords: origin,
    baselineResult: baseline,
    externalRequested: true,
    openDataLoader: makeLoader(remote),
    preferences: ["food", "coffee", "scenic"],
    date: DATE,
    anchorMode: "place",
    spatialScope: {
      kind: "region",
      bounds: { south: 41.6, north: 42.2, west: 12.3, east: 12.7 },
    },
  });
  assert.equal(region.experiment.route_mutation, true, "a broad regional anchor may use a coherent farther cluster");
  assert.equal("candidate_reach_policy" in region.experiment.eligibility.checks, false);
});

test("unit: engine composer scrubs fallback-city signals and placeholder route prose", async () => {
  const baseline = {
    city: "rome",
    days: [
      {
        date: DATE,
        primary_route: null,
        alternatives: [],
        date_signals: [{ title: "Sommarkväll i Rom", note: "Fallback city signal" }],
      },
    ],
    readiness: { unsupported: true },
  };
  const { result, experiment } = await composeAgnosticRouteOutput({
    coords: { lat: 55.6, lng: 13.0 },
    baselineResult: baseline,
    externalRequested: true,
    openDataLoader: makeLoader(fixtureNear({ lat: 55.6, lng: 13.0 })),
    preferences: ["food", "coffee", "scenic"],
    date: DATE,
    todayIsoDate: DATE,
    synthesizeVia: "engine",
    placeLabel: "Malmö",
    lang: "sv",
  });

  const day = result.days[0];
  const route = day.primary_route;
  assert.ok(route, "engine compose should return a promoted experimental route");
  assert.deepEqual(day.date_signals, [], "fallback city date_signals must be scrubbed from agnostic output");
  assert.equal(route.title, "Plan för Malmö");
  assert.match(route.summary, /Malmö/);
  assert.match(route.why_recommended, /Malmö/);
  const publicBlob = JSON.stringify({ day, experiment }).toLowerCase();
  assert.equal(publicBlob.includes("sommarkväll i rom"), false);
  assert.equal(publicBlob.includes("nearby loop"), false);
  assert.equal(publicBlob.includes("experimental route"), false);
  assert.equal(baseline.days[0].date_signals[0].title, "Sommarkväll i Rom", "baseline object remains untouched");
});

test("unit: the REPLACE branch scrubs every fallback-city day field, not just date_signals", async () => {
  // Baseline HAS a primary_route → applyRouteMutation replaces only the route and
  // keeps the other day fields, which belong to the fallback city (Rome). All of
  // them must be scrubbed from the promoted any-place (Malmö) day.
  const baseline = {
    city: "rome",
    days: [
      {
        date: DATE,
        primary_route: { title: "Rome baseline route", main_stops: [{ id: "rome-1" }] },
        alternatives: [{ title: "Ostiense to Trastevere", main_stops: [{ id: "rome-alt-1" }] }],
        date_signals: [{ title: "Sommarkväll i Rom" }],
        live_events: { tonight: [{ title: "Rome exhibition tonight" }], this_week: [] },
        // Rome's weather read — would render as the WRONG city's "Dagens läsning"
        // on a Malmö day if it survived (the engine-compose path produces none).
        dayflow_context: { weather: { headline: "Stark värme i Rom – känns som 36°", apparent_temp_max: 36 } },
      },
    ],
    readiness: { unsupported: true },
  };
  const { result } = await composeAgnosticRouteOutput({
    coords: { lat: 55.6, lng: 13.0 },
    baselineResult: baseline,
    externalRequested: true,
    openDataLoader: makeLoader(fixtureNear({ lat: 55.6, lng: 13.0 })),
    preferences: ["food", "coffee", "scenic"],
    date: DATE,
    todayIsoDate: DATE,
    synthesizeVia: "engine",
    // A full resolver display name — prose must use just the primary locality.
    placeLabel: "Malmö, Malmö kommun, Skåne län, Sverige",
    lang: "sv",
  });

  const day = result.days[0];
  assert.ok(day.primary_route, "the Malmö engine route replaced the baseline route");
  assert.equal(day.primary_route.title, "Plan för Malmö", "label trimmed to the primary locality, not the whole admin chain");
  assert.deepEqual(day.date_signals, [], "fallback date_signals scrubbed");
  assert.deepEqual(day.alternatives, [], "fallback-city alternatives scrubbed");
  assert.equal("live_events" in day, false, "fallback-city per-day live_events removed (the anchor's events ride the top-level sidecar)");
  assert.equal("dayflow_context" in day, false, "fallback-city weather read removed (engine produced none → honest absence, never Rome's weather)");

  const publicBlob = JSON.stringify(result).toLowerCase();
  for (const leak of ["rome baseline route", "ostiense to trastevere", "rome-alt-1", "sommarkväll i rom", "rome exhibition", "värme i rom"]) {
    assert.equal(publicBlob.includes(leak), false, `fallback-city text "${leak}" must not survive in the public blob`);
  }
  // The baseline object itself is never mutated.
  assert.equal(baseline.days[0].alternatives[0].title, "Ostiense to Trastevere");
  assert.ok(baseline.days[0].live_events);
  assert.ok(baseline.days[0].dayflow_context, "baseline dayflow_context untouched");
});

test("unit: scrubAgnosticAppliedDay deletes a fallback dayflow but keeps a genuine engine one", () => {
  // No engine dayflow → the fallback city's weather read is DELETED (honest
  // absence), never left to render as the wrong city's "Dagens läsning".
  const leaked = { days: [{ dayflow_context: { weather: { headline: "Rome heat" } }, alternatives: [{ title: "Rome alt" }], live_events: { tonight: [] }, date_signals: [{ title: "Rome signal" }] }] };
  scrubAgnosticAppliedDay(leaked, { primary_route: {} });
  assert.equal("dayflow_context" in leaked.days[0], false, "fallback dayflow deleted when the engine produced none");
  assert.deepEqual(leaked.days[0].alternatives, []);
  assert.equal("live_events" in leaked.days[0], false);
  assert.deepEqual(leaked.days[0].date_signals, []);

  // Genuine engine-produced dayflow → survives verbatim.
  const engineFlow = { weather: { headline: "Källstödd väderläsning" } };
  const withEngine = { days: [{ dayflow_context: { weather: { headline: "Rome heat" } } }] };
  scrubAgnosticAppliedDay(withEngine, { primary_route: {}, dayflow_context: engineFlow });
  assert.deepEqual(withEngine.days[0].dayflow_context, engineFlow, "the engine's own dayflow read is preserved");
});

test("unit: only a resolver-attested label drives prose; no label → neutral, never fabricated", async () => {
  const baseline = { city: "atlantis", days: [{ date: DATE, primary_route: null, alternatives: [] }], readiness: { unsupported: true } };
  const { result } = await composeAgnosticRouteOutput({
    coords: { lat: 55.6, lng: 13.0 },
    baselineResult: baseline,
    externalRequested: true,
    openDataLoader: makeLoader(fixtureNear({ lat: 55.6, lng: 13.0 })),
    preferences: ["food", "coffee", "scenic"],
    date: DATE,
    todayIsoDate: DATE,
    synthesizeVia: "engine",
    placeLabel: null, // explicit coords / unresolved place → no attested label
    lang: "en",
  });
  const route = result.days[0].primary_route;
  assert.ok(route, "still composes a route from the trusted candidates");
  assert.equal(route.title, "Plan for this place", "neutral fallback, never an unverified place name");
});
