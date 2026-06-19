/**
 * Convergence wiring: the resolved unsupported-place path planned through the
 * route engine's own agnostic_compose, behind the env/flag gate, promoted only
 * when calibration clears the honest thin_usable/low bar.
 *
 * Proves the brief's acceptance behaviors:
 *   - registered-city behavior is unchanged (the engine flag is a no-op there);
 *   - an unsupported, strongly-resolved place enters agnostic_compose ONLY under
 *     the gate, and a healthy route is promoted (synthesized_via the engine);
 *   - a thin/insufficient supply does NOT promote — baseline returned, honest;
 *   - the engine path is opt-in: without the flag the legacy synthesizer runs.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApp } = require("../server/app");
const {
  externalRecord,
  makeLoader,
  requestJson,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;
const FLAG = "experimental_agnostic_route_output=1";
const ENGINE = "agnostic_engine_compose=1";
const DATE = "2026-05-25";

// Role-diverse, >=25 geocoded, tightly-clustered trusted fixture near an anchor.
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

test(
  "engine compose promotes a healthy any-place route through agnostic_compose",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody(),
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.synthesized_via, "agnostic_compose_engine", "synthesized through the engine, not the legacy composer");
    assert.equal(exp.route_mutation, true);
    assert.equal(exp.readiness_calibration.status, "thin_usable");
    assert.equal(exp.readiness_calibration.level, "low");
    assert.ok(exp.readiness_calibration.caps.includes("capped_by_external_only_sources"));
    // Promoted: the gate cleared and the engine route is the returned day route.
    assert.equal(exp.promotion.promote, true);
    assert.deepEqual(exp.promotion.blocked_caps, []);
    const route = r.body.days[0].primary_route;
    assert.ok(route, "promoted route is returned as the day route");
    assert.equal(route.routing_source, "agnostic_compose");
    assert.equal(route.confidence, "low");
    assert.ok(route.main_stops.length >= 2);
    // Stops are the trusted loader records, each honestly marked provisional.
    assert.ok(route.main_stops.every((s) => /^(food|cafe|view)-/.test(s.id)));
    assert.ok(route.main_stops.every((s) => s.provisional === true));
    // Engine geometry owns order; daypart is staged as a label, not the sequencer.
    assert.equal(exp.route_ordering.source, "engine_geometry");
    assert.ok(exp.route_ordering.reasons.includes("daypart_promotion_pending"));
  }),
);

test(
  "a thin / insufficient supply does NOT promote — baseline returned, honest diagnostic",
  withServer(makeLoader([
    externalRecord("food-0", "Food 0", "restaurant", 41.9, 12.49, ["mat"]),
    externalRecord("cafe-0", "Cafe 0", "cafe", 41.9008, 12.49, ["fika"]),
  ]), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody(),
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.ok(exp, "diagnostic experiment block is always present");
    assert.equal(exp.promotion.promote, false, "thin supply must not promote");
    // Baseline returned (unknown city → no route), NOT a promoted experimental day.
    assert.equal(r.body.days[0]?.primary_route ?? null, null);
  }),
);

test(
  "the engine path is opt-in: without the flag the legacy synthesizer still runs",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`, // no ENGINE flag
      body: agnosticBody(),
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.notEqual(exp.synthesized_via, "agnostic_compose_engine", "legacy path is not the engine composer");
    assert.equal(exp.promotion, undefined, "legacy path applies no promotion gate (prior behavior)");
    assert.equal(exp.route_mutation, true, "legacy path still returns its experimental route");
  }),
);

test(
  "a registered citypack is untouched even with the engine flag set",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: { city: "rome", dates: [DATE] },
    });
    // A recognized city never enters the agnostic path — no experiment, no gate.
    assert.equal(r.body.agnostic_route_output_experiment, undefined);
    assert.equal(r.body.city, "rome");
    assert.ok(Array.isArray(r.body.days));
  }),
);
