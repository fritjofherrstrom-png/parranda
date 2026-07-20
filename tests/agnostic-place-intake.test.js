/**
 * #260 — agnostic place intake (freeform place query → trusted coordinate anchor).
 *
 * Proves the intake capability AND the trust boundary:
 *   - freeform `place` resolves (via an injected trusted resolver) to an anchor
 *     that feeds the existing #259 route-output path;
 *   - place resolution ALONE never produces a route — external opt-in + the
 *     trusted server loader are still required;
 *   - default behavior is unchanged; no flag → no resolver call;
 *   - explicit valid lat/lng wins (resolver never called);
 *   - every missing/unavailable/error/unresolved/ambiguous/low-confidence/
 *     invalid-coords outcome fails closed with an honest blocker;
 *   - the public payload can inject ONLY the query string — never trusted
 *     resolved coordinates/confidence/provenance/candidates/route candidates;
 *   - `city` is never treated as the place query; recognized citypacks untouched;
 *   - no named-city hardcoding; no live network; no fake ETA/walking claims.
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

const { resolveAgnosticIntake, parsePlaceQuery } = require("../server/planner/agnostic-place-intake");

const ORIGINAL_FETCH = global.fetch;
const FLAG = "experimental_agnostic_route_output=1";
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

// A trusted resolver that resolves any query to a fixed strong anchor.
function resolverTo(base, over = {}) {
  return async (query) => [
    { label: `Resolved ${query}`, lat: base.lat, lng: base.lng, confidence: "high", provenance: "test_geocoder", ...over },
  ];
}

function withServer({ openDataLoader = makeLoader([]), placeResolver = null }, run) {
  return async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({ openDataLoader, placeResolver }).listen(0);
    try {
      await run(server);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  };
}

function placeBody(extra = {}) {
  return {
    city: "atlantis-unknown-place",
    dates: [DATE],
    place: "Some Neighbourhood",
    preferences: ["food", "coffee", "scenic"],
    include_external_candidates: 1,
    ...extra,
  };
}

// =====================================================================
// Unit: parsePlaceQuery
// =====================================================================

test("unit: parsePlaceQuery reads place / place_query / location_query, never city", () => {
  assert.equal(parsePlaceQuery({ body: { place: " Trastevere " } }), "Trastevere");
  assert.equal(parsePlaceQuery({ body: { place_query: "Old Town" } }), "Old Town");
  assert.equal(parsePlaceQuery({ query: { location_query: "Söder" } }), "Söder");
  assert.equal(parsePlaceQuery({ body: { city: "Rome" } }), null, "city is never the place query");
  assert.equal(parsePlaceQuery({ body: { place: { label: "Injected", lat: 1, lng: 2 } } }), null, "place must be a string query, not injected resolution data");
  assert.equal(parsePlaceQuery({ body: {} }), null);
});

// =====================================================================
// Unit: resolveAgnosticIntake (pure, fail-closed branches)
// =====================================================================

test("unit: explicit valid coords win — resolver is never called", async () => {
  let called = false;
  const resolver = async () => {
    called = true;
    return [{ lat: 1, lng: 1, confidence: "high" }];
  };
  const { anchor, intake, placeContext } = await resolveAgnosticIntake({ coords: { lat: 41.9, lng: 12.49 }, placeQuery: "Trastevere", placeResolver: resolver });
  assert.equal(called, false);
  assert.deepEqual(anchor, { lat: 41.9, lng: 12.49 });
  assert.equal(intake.mode, "coordinates");
  assert.equal(intake.resolved.provenance, "explicit_request_coordinates");
  assert.equal(placeContext, null);
});

test("unit: no coords + no place → missing_or_invalid_coordinates", async () => {
  const { anchor, intake } = await resolveAgnosticIntake({ coords: null, placeQuery: null, placeResolver: async () => [] });
  assert.equal(anchor, null);
  assert.deepEqual(intake.blockers, ["missing_or_invalid_coordinates"]);
});

test("unit: place but no resolver configured → place_resolver_unavailable", async () => {
  const { anchor, intake } = await resolveAgnosticIntake({ placeQuery: "X", placeResolver: null });
  assert.equal(anchor, null);
  assert.deepEqual(intake.blockers, ["place_resolver_unavailable"]);
});

test("unit: resolver throws → place_resolver_error (fail-closed, no throw)", async () => {
  const { anchor, intake } = await resolveAgnosticIntake({ placeQuery: "X", placeResolver: async () => { throw new Error("boom"); } });
  assert.equal(anchor, null);
  assert.deepEqual(intake.blockers, ["place_resolver_error"]);
});

test("unit: resolver returns nothing → place_not_resolved", async () => {
  const { anchor, intake } = await resolveAgnosticIntake({ placeQuery: "X", placeResolver: async () => [] });
  assert.equal(anchor, null);
  assert.deepEqual(intake.blockers, ["place_not_resolved"]);
});

test("unit: only low-confidence candidates → fail closed (low_confidence_place_resolution)", async () => {
  const { anchor, intake } = await resolveAgnosticIntake({ placeQuery: "X", placeResolver: async () => [{ lat: 41.9, lng: 12.49, confidence: "low" }] });
  assert.equal(anchor, null);
  assert.deepEqual(intake.blockers, ["low_confidence_place_resolution"]);
});

test("unit: two strong candidates → ambiguous_place, candidates surfaced, no guess", async () => {
  const { anchor, intake } = await resolveAgnosticIntake({
    placeQuery: "Springfield",
    placeResolver: async () => [
      { label: "Springfield A", lat: 39.8, lng: -89.6, confidence: "high", provenance: "g" },
      { label: "Springfield B", lat: 42.1, lng: -72.5, confidence: "high", provenance: "g" },
    ],
  });
  assert.equal(anchor, null);
  assert.deepEqual(intake.blockers, ["ambiguous_place"]);
  assert.equal(intake.candidates.length, 2);
  assert.equal(intake.resolved, null);
});

test("unit: single strong candidate with invalid coords → invalid_resolved_coordinates", async () => {
  const { anchor, intake } = await resolveAgnosticIntake({ placeQuery: "X", placeResolver: async () => [{ lat: 999, lng: 12.49, confidence: "high" }] });
  assert.equal(anchor, null);
  assert.deepEqual(intake.blockers, ["invalid_resolved_coordinates"]);
});

test("unit: single strong valid candidate → trusted anchor with resolver provenance", async () => {
  const { anchor, intake } = await resolveAgnosticIntake({ placeQuery: "Trastevere", placeResolver: resolverTo({ lat: 41.9, lng: 12.49 }) });
  assert.deepEqual(anchor, { lat: 41.9, lng: 12.49 });
  assert.equal(intake.status, "resolved");
  assert.equal(intake.resolved.label, "Resolved Trastevere");
  assert.equal(intake.resolved.provenance, "test_geocoder");
});

test("unit: resolver admin context stays private and allowlisted beside public intake", async () => {
  const { anchor, intake, placeContext } = await resolveAgnosticIntake({
    placeQuery: "Stockholm",
    placeResolver: resolverTo({ lat: 59.3293, lng: 18.0686 }, {
      admin_context: {
        locality: "Stockholm",
        municipality: "Stockholms kommun",
        county: "Stockholms län",
        region: "Stockholms län",
        country: "Sverige",
        country_code: "SE",
        postcode: "111 29",
        secret: "must-not-leak",
      },
    }),
  });

  assert.deepEqual(anchor, { lat: 59.3293, lng: 18.0686 });
  assert.deepEqual(placeContext, {
    locality: "Stockholm",
    municipality: "Stockholms kommun",
    county: "Stockholms län",
    region: "Stockholms län",
    country: "Sverige",
    country_code: "se",
  });
  assert.equal("admin_context" in intake.resolved, false);
  assert.doesNotMatch(JSON.stringify(intake), /must-not-leak|postcode|secret/);
});

test("unit: resolver may return one trusted candidate object, not only an array", async () => {
  const { anchor, intake } = await resolveAgnosticIntake({
    placeQuery: "Trastevere",
    placeResolver: async () => ({ label: "Resolved object", lat: 41.9, lng: 12.49, confidence: "high", provenance: "test_geocoder" }),
  });
  assert.deepEqual(anchor, { lat: 41.9, lng: 12.49 });
  assert.equal(intake.candidates_considered, 1);
  assert.equal(intake.resolved.label, "Resolved object");
});

// =====================================================================
// API: default unchanged + no resolver call without the flag
// =====================================================================

test(
  "api: default unchanged without the flag; a place query alone changes nothing",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), placeResolver: () => { throw new Error("resolver must not be called without the flag"); } }, async (server) => {
    const plain = await requestJson(server, { path: "/api/route-recommendations?lang=en", body: routeBody("rome", ["scenic", "food"]) });
    const withPlace = await requestJson(server, { path: "/api/route-recommendations?lang=en", body: routeBody("rome", ["scenic", "food"], { place: "Trastevere" }) });
    assert.equal(plain.status, 200);
    assert.equal(withPlace.status, 200);
    assert.equal(plain.body.agnostic_route_output_experiment, undefined);
    assert.equal(withPlace.body.agnostic_route_output_experiment, undefined, "place without the flag adds no experiment block");
    assert.deepEqual(primaryRouteShape(withPlace.body), primaryRouteShape(plain.body));
    assert.deepEqual(Object.keys(withPlace.body).sort(), Object.keys(plain.body).sort(), "no new default fields");
  }),
);

// =====================================================================
// API: capability — place → anchor → #259 route
// =====================================================================

test(
  "api: place + flag + trusted resolver + external opt-in + loader → experimental route",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), placeResolver: resolverTo({ lat: 41.9, lng: 12.49 }) }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: placeBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, true);
    assert.equal(exp.intake.mode, "place");
    assert.equal(exp.intake.status, "resolved");
    assert.equal(exp.intake.resolved.provenance, "test_geocoder");
    const route = r.body.days[0].primary_route;
    assert.equal(route.experimental, true);
    assert.ok(route.main_stops.length >= 2);
    // Stops are the trusted loader records — never the resolver / public payload.
    assert.ok(route.main_stops.every((s) => /^(food|cafe|view)-/.test(s.id)));
  }),
);

// =====================================================================
// API: place resolution ALONE never produces a route
// =====================================================================

test(
  "api: place resolves but NO external opt-in → no route, blocker external_candidates_not_requested",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), placeResolver: resolverTo({ lat: 41.9, lng: 12.49 }) }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: placeBody({ include_external_candidates: undefined }) });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false, "place resolution alone must not produce a route");
    assert.equal(exp.intake.status, "resolved", "the anchor still resolved");
    assert.ok(exp.readiness_blockers.includes("external_candidates_not_requested"));
    assert.deepEqual(r.body.days, []);
  }),
);

test(
  "api: place resolves + external opt-in but EMPTY trusted loader → no route, no_usable_trusted_records",
  withServer({ openDataLoader: makeLoader([]), placeResolver: resolverTo({ lat: 41.9, lng: 12.49 }) }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: placeBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.equal(exp.intake.status, "resolved");
    assert.ok(exp.readiness_blockers.includes("no_usable_trusted_records"));
  }),
);

// =====================================================================
// API: explicit coords win → resolver not called
// =====================================================================

test(
  "api: explicit valid lat/lng wins — resolver not called, #259 path unchanged",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), placeResolver: () => { throw new Error("resolver must not be called when explicit coords are present"); } }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: placeBody({ lat: 41.9, lng: 12.49 }) });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, true);
    assert.equal(exp.intake.mode, "coordinates", "explicit coords path, not place");
    assert.equal(exp.intake.resolved.provenance, "explicit_request_coordinates");
  }),
);

// =====================================================================
// API: fail-closed blockers through the endpoint
// =====================================================================

test(
  "api: no resolver configured + place → place_resolver_unavailable, baseline intact",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), placeResolver: null }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: placeBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.equal(exp.intake.mode, "place");
    assert.ok(exp.readiness_blockers.includes("place_resolver_unavailable"));
    assert.deepEqual(r.body.days, []);
  }),
);

test(
  "api: ambiguous / low-confidence / resolver-error / unresolved / invalid-coords all fail closed",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const cases = [
      { resolver: async () => [{ label: "A", lat: 39.8, lng: -89.6, confidence: "high" }, { label: "B", lat: 42.1, lng: -72.5, confidence: "high" }], blocker: "ambiguous_place" },
      { resolver: async () => [{ lat: 41.9, lng: 12.49, confidence: "low" }], blocker: "low_confidence_place_resolution" },
      { resolver: async () => { throw new Error("boom"); }, blocker: "place_resolver_error" },
      { resolver: async () => [], blocker: "place_not_resolved" },
      { resolver: async () => [{ lat: 9999, lng: 12.49, confidence: "high" }], blocker: "invalid_resolved_coordinates" },
    ];
    for (const { resolver, blocker } of cases) {
      const server = buildApp({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), placeResolver: resolver }).listen(0);
      try {
        const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: placeBody() });
        const exp = r.body.agnostic_route_output_experiment;
        assert.equal(exp.route_mutation, false, blocker);
        assert.ok(exp.readiness_blockers.includes(blocker), `expected blocker ${blocker}, got ${JSON.stringify(exp.readiness_blockers)}`);
        assert.deepEqual(r.body.days, [], `${blocker}: baseline untouched`);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
    global.fetch = ORIGINAL_FETCH;
  },
);

// =====================================================================
// API: public payload cannot inject trusted resolution
// =====================================================================

test(
  "api: public payload cannot inject trusted resolved coords/confidence/provenance/candidates",
  withServer({ openDataLoader: makeLoader([]), placeResolver: null }, async (server) => {
    // No server resolver. The request tries to smuggle a "resolved" anchor and
    // candidates through the public payload. None of it may be trusted.
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: placeBody({
        resolved: { lat: 41.9, lng: 12.49, confidence: "high", provenance: "attacker" },
        confidence: "high",
        provenance: "attacker",
        candidates: [{ lat: 41.9, lng: 12.49, confidence: "high" }],
        external_provider: { dataset: fixtureNear({ lat: 41.9, lng: 12.49 }) },
      }),
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false, "no trusted resolver + payload injection must not produce a route");
    assert.ok(exp.readiness_blockers.includes("place_resolver_unavailable"));
    assert.equal(exp.intake.resolved, null, "no trusted resolution from the public payload");
    assert.deepEqual(r.body.days, []);
  }),
);

test(
  "api: trusted resolver output wins over any payload-injected resolution fields",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), placeResolver: resolverTo({ lat: 41.9, lng: 12.49 }) }, async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: placeBody({ resolved: { lat: 0, lng: 0, provenance: "attacker" }, provenance: "attacker", confidence: "low" }),
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.intake.resolved.provenance, "test_geocoder", "provenance comes from the server resolver, not the payload");
    assert.equal(exp.route_mutation, true);
  }),
);

// =====================================================================
// API: city is not the place query; recognized citypacks untouched
// =====================================================================

test(
  "api: `city` is never used as the freeform place query",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), placeResolver: () => { throw new Error("resolver must not be called for the city field"); } }, async (server) => {
    // An unknown `city` that looks like a place name, no `place` field.
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: { city: "Trastevere", dates: [DATE], preferences: ["food"], include_external_candidates: 1 } });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.equal(exp.intake.mode, "none", "city is not parsed as a place query");
    assert.ok(exp.readiness_blockers.includes("missing_or_invalid_coordinates"));
  }),
);

test(
  "api: recognized rich citypack + flag + place is NOT agnostic-gated — route unchanged",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), placeResolver: resolverTo({ lat: 41.9, lng: 12.49 }) }, async (server) => {
    const plain = await requestJson(server, { path: "/api/route-recommendations?lang=en", body: routeBody("rome", ["scenic", "food"]) });
    const flagged = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}&include_external_candidates=1`, body: routeBody("rome", ["scenic", "food"], { place: "Trastevere" }) });
    assert.equal(flagged.body.agnostic_route_output_experiment, undefined, "recognized city must not engage the experiment");
    assert.deepEqual(primaryRouteShape(flagged.body), primaryRouteShape(plain.body));
  }),
);

// =====================================================================
// API: no named-city hardcoding (two different resolved places)
// =====================================================================

test("api: coordinate-driven via place — two different resolved places both work", async () => {
  global.fetch = mockStableWeatherFetch();
  for (const base of [{ lat: 41.9, lng: 12.49 }, { lat: 55.6, lng: 13.0 }]) {
    const server = buildApp({ openDataLoader: makeLoader(fixtureNear(base)), placeResolver: resolverTo(base) }).listen(0);
    try {
      const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: placeBody({ place: `Place near ${base.lat}` }) });
      assert.equal(r.body.agnostic_route_output_experiment.route_mutation, true, `place near ${base.lat},${base.lng} should produce a route`);
      assert.ok(r.body.days[0].primary_route.main_stops.length >= 2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  global.fetch = ORIGINAL_FETCH;
});

// =====================================================================
// API: produced route still makes no ETA/walking/opening-hours claims
// =====================================================================

test(
  "api: place-anchored experimental route makes no ETA/walking/opening-hours/better-route claims",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), placeResolver: resolverTo({ lat: 41.9, lng: 12.49 }) }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: placeBody() });
    const route = r.body.days[0].primary_route;
    for (const banned of ["eta", "opening_hours", "longest_leg_minutes", "average_leg_minutes", "walk_minutes", "duration_minutes"]) {
      assert.equal(banned in route, false, `experimental route must not expose ${banned}`);
    }
    assert.ok(Object.keys(route).every((key) => !key.toLowerCase().includes("eta")), "no field name implies ETA");
    // #261: a place-anchored route is walking-budget validated, not unvalidated.
    assert.equal(route.order_confidence, "walking_budget_validated");
    const blob = JSON.stringify({ route, experiment: r.body.agnostic_route_output_experiment }).toLowerCase();
    for (const phrase of ["better route", "best route", "optimal", "fastest", "shortest", "recommended over", "minutes away", "min walk", "live that fits"]) {
      assert.equal(blob.includes(phrase), false, `must not claim "${phrase}"`);
    }
  }),
);
