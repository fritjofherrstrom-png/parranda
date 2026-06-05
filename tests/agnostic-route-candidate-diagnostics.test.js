/**
 * #257 agnostic route-candidate diagnostics — unit + API (inspect-only).
 *
 * Observes whether trusted source-backed candidates form a route-candidate-like
 * proposal beside the actual route. Never mutates/selects/promotes the route.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { buildApp } = require("../server/app");
const { buildAgnosticRouteCandidateDiagnostics } = require("../server/planner/agnostic-route-candidate-diagnostics");
const {
  externalRecord,
  makeLoader,
  routeBody,
  primaryRouteShape,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;

// --- pure-helper fixtures --------------------------------------------------

function sel(role, id, over = {}) {
  return {
    role,
    candidate_id: id,
    label: over.label || id,
    candidate_status: over.candidate_status || "filled",
    planner_usable: over.planner_usable ?? true,
    origin: over.origin || "curated_catalog",
    confidence: over.confidence || "high",
    coordinates: "coordinates" in over ? over.coordinates : { lat: 41.9, lng: 12.49 },
    also_covers: over.also_covers || [],
    reasons: over.reasons || ["covers:scenic"],
  };
}
function combo(over = {}) {
  return {
    status: over.status || "ready",
    selected: over.selected || [sel("scenic_anchor", "v1"), sel("food_anchor", "r1", { coordinates: { lat: 41.901, lng: 12.491 } })],
    unresolved_roles: over.unresolved_roles || [],
    duplicate_role_coverage: over.duplicate_role_coverage || [],
    geometry_summary: over.geometry_summary || { coherence: "ok", max_pairwise_km: 0.5, candidate_count: 2, geocoded_count: 2 },
    quality_flags: over.quality_flags || [],
    reasons: over.reasons || ["status:ready"],
  };
}
function route(stopIds) {
  return { id: "primary-route-1", main_stops: stopIds.map((id) => ({ id })) };
}

// --- unit: fail-closed ------------------------------------------------------

test("unit: external not requested → unavailable, fail-closed, no candidate", () => {
  const out = buildAgnosticRouteCandidateDiagnostics({ city: "rome", externalRequested: false, candidateCombination: combo(), primaryRoute: route(["x"]) });
  assert.equal(out.status, "unavailable");
  assert.equal(out.candidate, null);
  assert.deepEqual(out.blockers, ["external_candidates_not_requested"]);
  assert.equal(out.route_mutation, false);
});

test("unit: loader status maps to explicit blockers", () => {
  const cases = {
    no_loader_configured: "no_trusted_loader",
    error_failed_closed: "loader_error",
    "loaded:0": "no_usable_trusted_records",
  };
  for (const [status, blocker] of Object.entries(cases)) {
    const out = buildAgnosticRouteCandidateDiagnostics({ city: "rome", externalRequested: true, sourceStatus: { status }, candidateCombination: combo(), primaryRoute: route(["x"]) });
    assert.equal(out.status, "unavailable", status);
    assert.deepEqual(out.blockers, [blocker], status);
  }
});

test("unit: a trusted external candidate outside the route → candidate_gap_detected", () => {
  const c = combo({ selected: [sel("swimming_coast_option", "ext-beach", { origin: "external_open", coordinates: { lat: 41.7, lng: 12.2 } })] });
  const out = buildAgnosticRouteCandidateDiagnostics({ city: "rome", externalRequested: true, sourceStatus: { status: "loaded:1" }, candidateCombination: c, primaryRoute: route(["garbatella", "testaccio"]) });
  assert.equal(out.status, "available");
  assert.equal(out.recommendation, "candidate_gap_detected");
  assert.ok(out.signals.includes("source_backed_gap_vs_route"));
  assert.ok(out.signals.includes("trusted_external_candidate_present"));
  assert.deepEqual(out.candidate.stop_ids, ["ext-beach"]);
  assert.equal(out.comparison_to_route_output.overlap_count, 0);
  assert.equal(out.candidate.output_contract, "diagnostic_candidate_not_route_json");
  assert.equal(out.candidate.order_confidence, "diagnostic_only");
});

test("unit: curated-only combination → inspect_only (no source-backed gap)", () => {
  const out = buildAgnosticRouteCandidateDiagnostics({ city: "rome", externalRequested: true, sourceStatus: { status: "loaded:3" }, candidateCombination: combo(), primaryRoute: route(["x"]) });
  assert.equal(out.recommendation, "inspect_only");
  assert.ok(!out.signals.includes("source_backed_gap_vs_route"));
});

test("unit: no primary route → partial + no_primary_route blocker", () => {
  const c = combo({ selected: [sel("food_anchor", "ext", { origin: "external_open" })] });
  const out = buildAgnosticRouteCandidateDiagnostics({ city: "x", externalRequested: true, sourceStatus: { status: "loaded:1" }, candidateCombination: c, primaryRoute: null });
  assert.equal(out.status, "partial");
  assert.ok(out.blockers.includes("no_primary_route"));
});

test("unit: deterministic + does not mutate inputs + label says diagnostic", () => {
  const c = combo();
  const r = route(["x"]);
  const snap = JSON.stringify({ c, r });
  const a = buildAgnosticRouteCandidateDiagnostics({ city: "rome", externalRequested: true, sourceStatus: { status: "loaded:2" }, candidateCombination: c, primaryRoute: r });
  const b = buildAgnosticRouteCandidateDiagnostics({ city: "rome", externalRequested: true, sourceStatus: { status: "loaded:2" }, candidateCombination: c, primaryRoute: r });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify({ c, r }), snap);
  assert.match(a.candidate.label, /diagnostic/i);
});

test("unit: serialized diagnostic contains no banned route-claim vocabulary", () => {
  const c = combo({ selected: [sel("swimming_coast_option", "ext-beach", { origin: "external_open" })] });
  const out = buildAgnosticRouteCandidateDiagnostics({ city: "rome", externalRequested: true, sourceStatus: { status: "loaded:1" }, candidateCombination: c, primaryRoute: route(["a"]) });
  const json = JSON.stringify(out).toLowerCase();
  for (const banned of ["walking_time", "travel_time", "eta", "duration", "opening_hours", "better route", "best route", "candidate wins", "route_ready"]) {
    assert.ok(!json.includes(banned), `must not contain "${banned}"`);
  }
});

// --- API harness -----------------------------------------------------------

async function post(server, query, body) {
  const { port } = server.address();
  const path = `/api/route-recommendations?lang=en${query ? `&${query}` : ""}`;
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(JSON.parse(d))); },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
async function withServer(openDataLoader, run) {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader }).listen(0);
  try { return await run(server); } finally { await new Promise((r) => server.close(r)); global.fetch = ORIGINAL_FETCH; }
}
const FLAG = "inspect_agnostic_route_candidate=1";

test("API: default route output omits agnostic_route_candidate", async () => {
  await withServer(null, async (server) => {
    const def = await post(server, "", routeBody("rome", ["scenic", "food"]));
    assert.equal(def.agnostic_route_candidate, undefined);
  });
});

test("API: all flag aliases attach the sidecar", async () => {
  await withServer(null, async (server) => {
    for (const q of ["inspect_agnostic_route_candidate=1", "inspectAgnosticRouteCandidate=1", "inspect=agnostic_route_candidate"]) {
      const r = await post(server, q, routeBody("rome", ["scenic", "food"]));
      assert.ok(r.agnostic_route_candidate, `alias ${q} should attach`);
    }
  });
});

test("API: sidecar-alone does NOT expose any other inspect sidecar", async () => {
  await withServer(null, async (server) => {
    const r = await post(server, FLAG, routeBody("rome", ["scenic", "food"]));
    assert.ok(r.agnostic_route_candidate);
    assert.equal(r.planner_roles, undefined);
    assert.equal(r.dayflow_honesty, undefined);
    assert.equal(r.candidate_combination, undefined);
    assert.equal(r.route_candidate_adapter, undefined);
    assert.equal(r.route_ab_scoring, undefined);
    assert.equal(r.route_output_diagnostics, undefined);
  });
});

test("API: no external opt-in → fail closed (unavailable), route unchanged", async () => {
  await withServer(makeLoader([externalRecord("ext-beach", "Beach", "beach", 41.7, 12.2, ["coast"])]), async (server) => {
    const def = await post(server, "", routeBody("rome", ["scenic", "food"]));
    const r = await post(server, FLAG, routeBody("rome", ["scenic", "food"]));
    assert.equal(r.agnostic_route_candidate.status, "unavailable");
    assert.deepEqual(r.agnostic_route_candidate.blockers, ["external_candidates_not_requested"]);
    assert.deepEqual(primaryRouteShape(r), primaryRouteShape(def));
  });
});

test("API: external requested but no loader → fail closed with no_trusted_loader", async () => {
  await withServer(null, async (server) => {
    const r = await post(server, `${FLAG}&include_external_candidates=1`, routeBody("rome", ["swimming"], { include_external_candidates: 1 }));
    assert.equal(r.agnostic_route_candidate.status, "unavailable");
    assert.ok(r.agnostic_route_candidate.blockers.includes("no_trusted_loader"));
  });
});

test("API: Athens swimming + trusted loader → source-backed gap beside an unchanged route", async () => {
  const loader = makeLoader([externalRecord("ath-beach", "Kavouri Beach", "beach", 37.82, 23.78, ["coast"])]);
  await withServer(loader, async (server) => {
    const body = routeBody("athens", ["swimming"], { include_external_candidates: 1 });
    const def = await post(server, "", body);
    const r = await post(server, `${FLAG}&include_external_candidates=1`, body);
    const arc = r.agnostic_route_candidate;
    assert.equal(arc.status, "available");
    assert.equal(arc.recommendation, "candidate_gap_detected");
    assert.ok(arc.candidate.stops.some((s) => s.origin === "external_open"));
    assert.equal(arc.comparison_to_route_output.overlap_count, 0);
    assert.equal(arc.route_mutation, false);
    // actual route is byte/shape stable
    assert.deepEqual(primaryRouteShape(r), primaryRouteShape(def));
  });
});

test("API: public payload cannot inject candidate / route / loader data", async () => {
  const INJ = "payload-injected-stop";
  await withServer(null, async (server) => {
    const r = await post(server, `${FLAG}&include_external_candidates=1`, routeBody("rome", ["scenic", "food"], {
      include_external_candidates: 1,
      agnostic_route_candidate: { candidate: { stop_ids: [INJ] }, status: "available" },
      route_output_diagnostics: { days: [{ primary_route: { stop_ids: [INJ] } }] },
      external_provider: { dataset: [{ id: INJ, name: "Fake", type: "beach", lat: 0, lng: 0, sources: [{ provider: "osm", family: "map", tier: "inferred" }, { provider: "wikidata", family: "open_knowledge", tier: "inferred" }] }] },
      openDataLoader: [{ id: INJ }],
      days: [{ primary_route: { id: INJ, main_stops: [{ id: INJ }] } }],
      primary_route: { id: INJ },
    }));
    const arc = r.agnostic_route_candidate;
    // no trusted loader configured → fail closed; payload dataset must not enter
    assert.notEqual(arc.status, "available");
    assert.ok(!JSON.stringify(arc).includes(INJ), "payload id must not reach the sidecar");
    const mainIds = (r.days?.[0]?.primary_route?.main_stops || []).map((s) => s.id);
    assert.ok(!mainIds.includes(INJ), "payload id must not reach main_stops");
  });
});

test("API: serialized sidecar contains no banned route-claim vocabulary", async () => {
  const loader = makeLoader([externalRecord("ath-beach", "Kavouri Beach", "beach", 37.82, 23.78, ["coast"])]);
  await withServer(loader, async (server) => {
    const r = await post(server, `${FLAG}&include_external_candidates=1`, routeBody("athens", ["swimming"], { include_external_candidates: 1 }));
    const json = JSON.stringify(r.agnostic_route_candidate).toLowerCase();
    for (const banned of ["walking_time", "travel_time", "eta", "duration", "opening_hours", "better route", "best route", "candidate wins", "route_ready"]) {
      assert.ok(!json.includes(banned), `must not contain "${banned}"`);
    }
  });
});
