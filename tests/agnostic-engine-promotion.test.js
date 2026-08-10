/**
 * Convergence wiring: the resolved unsupported-place path planned through the
 * route engine's own agnostic_compose, behind the env/flag gate, promoted only
 * when calibration clears the honest thin_usable/low bar.
 *
 * Proves the brief's acceptance behaviors:
 *   - rich registered-city behavior is unchanged (the engine flag is a no-op there);
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

function broadIntentFixture(base) {
  const specs = [
    ["food", "restaurant", ["mat"], 0.004],
    ["coffee", "cafe", ["fika"], 0.001],
    ["view", "viewpoint", ["utsikt"], 0.002],
    ["museum", "museum", ["kultur"], 0.003],
    ["bar", "bar", ["bars", "nattliv"], 0.005],
  ];
  return specs.flatMap(([prefix, type, tags, dayArcOffset]) =>
    Array.from({ length: 5 }, (_, index) => {
      return externalRecord(
        `${prefix}-${index}`,
        `${prefix} ${index}`,
        type,
        base.lat + dayArcOffset + index * 0.00005,
        base.lng + (index % 2) * 0.00005,
        tags,
      );
    }),
  );
}

function mixedTrustSingleInterestFixture(base) {
  const records = [];
  const point = (i) => ({
    lat: base.lat + (i % 5) * 0.0007,
    lng: base.lng + Math.floor(i / 5) * 0.0007,
  });
  const singleFamily = (id, name, type, coords, tags) => ({
    ...externalRecord(id, name, type, coords.lat, coords.lng, tags),
    sources: [
      {
        provider: "osm",
        family: "map",
        tier: "inferred",
        url: `https://www.openstreetmap.org/node/${id}`,
      },
    ],
  });

  for (let i = 0; i < 10; i += 1) {
    records.push(singleFamily(`food-low-${i}`, `Food ${i}`, "restaurant", point(i), ["mat"]));
  }
  for (let i = 0; i < 5; i += 1) {
    const coords = point(i + 2);
    records.push(externalRecord(`view-safe-${i}`, `View ${i}`, "viewpoint", coords.lat, coords.lng, ["utsikt"]));
  }
  for (let i = 0; i < 5; i += 1) {
    records.push(singleFamily(`coffee-low-${i}`, `Coffee ${i}`, "cafe", point(i + 1), ["fika"]));
    records.push(singleFamily(`museum-low-${i}`, `Museum ${i}`, "museum", point(i + 3), ["kultur"]));
  }
  return records;
}

function greenFixtureNear(base) {
  return Array.from({ length: 25 }, (_, i) => {
    const lat = base.lat + (i % 5) * 0.0008;
    const lng = base.lng + Math.floor(i / 5) * 0.0008;
    return externalRecord(`park-${i}`, `Park ${i}`, "park", lat, lng, ["green", "park"]);
  });
}

function agnosticBody(extra = {}) {
  return {
    city: "atlantis-unknown-place",
    place: "Malmö",
    dates: [DATE],
    lat: 41.9,
    lng: 12.49,
    preferences: ["food", "coffee", "scenic"],
    walking_km_target: 6,
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
      body: agnosticBody({
        route_roles: ["payload_role"],
        covered_preferences: ["payload_preference"],
        fit_reasons: ["payload_reason"],
      }),
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
    // No place resolver runs in this harness, so no attested label exists — the
    // prose is neutral by contract (a typed place only names the route when the
    // resolver attests it; the attested-label path is unit-tested separately in
    // agnostic-route-output.test.js). It must NEVER fall back to the "Nearby"
    // geometry placeholder.
    assert.equal(route.title, "Plan for this place");
    assert.ok(!/Nearby/.test(route.title), "prose never uses the geometry placeholder as a place name");
    assert.match(route.summary, /this place/);
    assert.match(route.why_recommended, /this place/);
    assert.deepEqual(r.body.days[0].date_signals, [], "any-place route must not inherit fallback-city date signals");
    assert.equal(route.main_stops.length, 4, "a rich 6 km role reservoir is not artificially capped at three stops");
    // Stops are the trusted loader records, each honestly marked provisional.
    assert.ok(route.main_stops.every((s) => /^(food|cafe|view)-/.test(s.id)));
    assert.ok(route.main_stops.every((s) => s.provisional === true));
    assert.ok(route.main_stops.every((s) => Array.isArray(s.route_roles) && s.route_roles.length === 1));
    assert.ok(route.main_stops.every((s) => s.role === s.route_roles[0]));
    assert.ok(route.main_stops.every((s) => Array.isArray(s.covered_preferences)));
    assert.ok(route.main_stops.some((s) => s.covered_preferences.length > 0));
    assert.ok(route.main_stops.every((s) => Array.isArray(s.fit_reasons)));
    assert.deepEqual(
      [...new Set(route.main_stops.map((stop) => stop.role))].sort(),
      ["coffee_fika_stop", "food_anchor", "scenic_anchor"],
      "the selected role spine survives while reservoir depth adds a fourth stop",
    );
    const publicStops = JSON.stringify(route.main_stops);
    assert.equal(publicStops.includes("payload_role"), false, "public role metadata cannot enter trusted stops");
    assert.equal(publicStops.includes("payload_preference"), false, "public preference claims cannot enter trusted stops");
    assert.equal(publicStops.includes("payload_reason"), false, "public fit reasons cannot enter trusted stops");
    // Engine geometry owns order; daypart is staged as a label, not the sequencer.
    assert.equal(exp.route_ordering.source, "engine_geometry");
    assert.ok(exp.route_ordering.reasons.includes("daypart_promotion_pending"));
  }),
);

test(
  "green and walks can compose a source-backed park route through the shared reservoir",
  withServer(makeLoader(greenFixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["green"] }),
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, true);
    assert.equal(exp.promotion.promote, true, "safe support turns the green spine into a minimum complete day");
    const stops = r.body.days[0].primary_route.main_stops;
    assert.equal(stops.length, 3);
    assert.equal(
      stops.filter((stop) => stop.role === "green_walk_stop").length,
      2,
      "the requested green role remains the route spine",
    );
    assert.equal(
      stops.filter((stop) => stop.covered_preferences.includes("green")).length,
      2,
      "the supporting scenic role does not invent green preference coverage",
    );
    assert.ok(stops.every((stop) => stop.type === "park"));
    assert.ok(stops.every((stop) => stop.daypart === "midday"));
  }),
);

test(
  "day-value repair expands the agnostic set when a fifth stop adds requested coverage",
  withServer(makeLoader(broadIntentFixture({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({
        preferences: ["food", "coffee", "scenic", "museums", "bars"],
      }),
    });

    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, true);
    assert.equal(exp.promotion.promote, true);
    const stops = r.body.days[0].primary_route.main_stops;
    assert.equal(stops.length, 5, "the fixed four-stop budget expands only to retain real fifth-intent value");
    const covered = new Set(stops.flatMap((stop) => stop.covered_preferences));
    for (const preference of ["food", "coffee", "scenic", "museums", "bars"]) {
      assert.ok(covered.has(preference), `${preference} remains represented in the repaired route`);
    }
    assert.ok(stops.every((stop) => stop.provisional === true));
  }),
);

test(
  "single-interest route bounds requested low-trust depth and unrequested support",
  withServer(makeLoader(mixedTrustSingleInterestFixture({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["food"] }),
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, true);
    assert.equal(exp.promotion.promote, true);

    const stops = r.body.days[0].primary_route.main_stops;
    const support = stops.filter((stop) => !stop.covered_preferences.includes("food"));
    const lowTrustSupport = support.filter((stop) => stop.trust?.confidence === "low");
    const lowTrustRequested = stops.filter(
      (stop) => stop.covered_preferences.includes("food") && stop.trust?.confidence === "low",
    );
    assert.ok(
      support.some((stop) => stop.trust?.confidence === "medium"),
      "corroborated support is admitted before any experimental bridge",
    );
    assert.ok(lowTrustSupport.length <= 1, "at most one unrequested low-trust bridge may reach the route");
    assert.ok(
      lowTrustRequested.length <= 1,
      "one admitted candidate may represent the requested role but cannot multiply its depth",
    );
    assert.ok(
      stops.filter((stop) => stop.covered_preferences.includes("food")).length >= 1,
      "the requested role remains represented",
    );
  }),
);

test(
  "public payload cannot promote a short any-place day into the server-owned peak profile",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const baseline = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ walking_km_target: 4 }),
    });
    const injected = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({
        walking_km_target: 4,
        __agnosticDayProfile: "peak",
        dayProfile: "peak",
        day_profile: "peak",
      }),
    });
    const baselineExperiment = baseline.body.agnostic_route_output_experiment;
    const injectedExperiment = injected.body.agnostic_route_output_experiment;
    assert.equal(injectedExperiment.route_mutation, true);
    assert.deepEqual(
      injectedExperiment.experimental_route.main_stops.map((stop) => stop.id),
      baselineExperiment.experimental_route.main_stops.map((stop) => stop.id),
    );
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
  "a non-promoted no-city experiment returns no public fallback day",
  withServer(makeLoader([
    externalRecord("food-0", "Food 0", "restaurant", 41.9, 12.49, ["mat"]),
    externalRecord("cafe-0", "Cafe 0", "cafe", 41.9008, 12.49, ["fika"]),
  ]), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: {
        dates: [DATE],
        place: "Malmö",
        lat: 41.9,
        lng: 12.49,
        preferences: ["food", "coffee"],
        include_external_candidates: 1,
      },
    });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.promotion.promote, false);
    assert.equal(exp.baseline.had_primary_route, true, "only fallback route presence remains in experiment diagnostics");
    assert.deepEqual(r.body.days, [], "fallback Rome day must not survive at the public root");
    assert.equal(r.body.city, null);
    assert.equal(r.body.readiness, null);
    assert.equal(JSON.stringify(r.body.days).toLowerCase().includes("rome"), false);
  }),
);

test(
  "no-city default Planner behavior remains unchanged without the experiment flag",
  withServer(makeLoader([]), async (server) => {
    const r = await requestJson(server, {
      path: "/api/route-recommendations?lang=en",
      body: {
        dates: [DATE],
        preferences: ["food"],
        pulse_route_interrupt: { status: "applied", event: { id: "payload-event" } },
      },
    });
    assert.equal(r.body.agnostic_route_output_experiment, undefined);
    assert.equal(r.body.pulse_route_interrupt, undefined, "public payload cannot mint an interrupt");
    assert.equal(r.body.city, "rome");
    assert.ok(r.body.days[0]?.primary_route, "default Planner still owns the no-city fallback path");
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
  "a rich registered citypack is untouched even with the engine flag set",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: { city: "rome", dates: [DATE] },
    });
    // A rich recognized city never enters the supplemental fill or any-place path.
    assert.equal(r.body.agnostic_route_output_experiment, undefined);
    assert.equal(r.body.registered_city_candidate_fill, undefined);
    assert.equal(r.body.city, "rome");
    assert.ok(Array.isArray(r.body.days));
  }),
);

// EVENTS AS ROUTE STOPS (event-route-stop-weave): a genuine, walkable tonight-
// event becomes the promoted day's real LAST stop; a distant one stays an
// anchor with no walk claim. Full wiring through buildApp + injected supplies.
function eventSupplyWith(event) {
  return async () => ({ coverage: "covered", feed: { id: "test-feed", label: "Test feed" }, tonight: [event], this_week: [] });
}

function tonightEventAt(lng, extra = {}) {
  return {
    id: "ev-tonight",
    title: "Jazz by the quay",
    starts_at: `${DATE}T19:00:00Z`,
    ends_at: `${DATE}T21:00:00Z`,
    timezone: "Europe/Rome",
    place: "The Quay",
    source_label: "Test feed",
    source_url: "https://example.org/ev-tonight",
    license: "CC-BY 4.0",
    cultural_tier: "cultural",
    timing_relevance: "tonight",
    salience_score: 8,
    lat: 41.9,
    lng,
    ...extra,
  };
}

test("a walkable tonight-event is woven into the promoted route as its last stop", async () => {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({
    openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
    eventSupply: eventSupplyWith(tonightEventAt(12.5)), // ~0.8 km from the cluster
  }).listen(0);
  try {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody(),
    });
    assert.equal(r.body.agnostic_route_output_experiment.promotion.promote, true);
    const route = r.body.days[0].primary_route;
    const last = route.main_stops[route.main_stops.length - 1];
    assert.equal(last.is_live_event, true, "the tonight-event is the route's real last stop");
    assert.equal(last.event_id, "ev-tonight");
    assert.equal(last.daypart, "evening");
    assert.equal(last.timezone, "Europe/Rome");
    // The walk to it is measured, short, and in the legs.
    const lastLeg = route.legs[route.legs.length - 1];
    assert.equal(lastLeg.to_label, "Jazz by the quay");
    assert.ok(Number.isFinite(lastLeg.distance_km) && lastLeg.distance_km <= 2.5);
    assert.equal(route.live_event_stop.event_id, "ev-tonight");
    assert.equal(r.body.pulse_route_interrupt.status, "applied");
    assert.equal(r.body.pulse_route_interrupt.route_mutation, true);
    assert.equal(
      r.body.agnostic_route_output_experiment.constraint_negotiation.walking.estimated_km,
      route.estimated_km,
      "post-hoc negotiation describes the final event-extended route",
    );
    // The anchor card and the route agree.
    assert.equal(r.body.place_structure.district_day.evening_event.woven_into_route, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = ORIGINAL_FETCH;
  }
});

test("a route for another selected date never inherits today's live event", async () => {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({
    openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
    eventSupply: eventSupplyWith(tonightEventAt(12.5)),
  }).listen(0);
  try {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ dates: ["2026-05-26"] }),
    });
    const route = r.body.days[0].primary_route;
    assert.equal(route.main_stops.some((stop) => stop.is_live_event), false);
    assert.equal(route.live_event_stop, undefined);
    assert.equal(r.body.pulse_route_interrupt, undefined);
    assert.equal(r.body.place_structure.district_day.evening_event, undefined);
    assert.equal(r.body.live_events.tonight[0].id, "ev-tonight", "Pulse discovery remains independent of route use");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = ORIGINAL_FETCH;
  }
});

test("a distant tonight-event stays an anchor: no walk claimed, route unextended", async () => {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({
    openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
    eventSupply: eventSupplyWith(tonightEventAt(12.53)), // ~3 km away: valid, but outside auto-weave
  }).listen(0);
  try {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody(),
    });
    const route = r.body.days[0].primary_route;
    assert.ok(!route.main_stops.some((s) => s.is_live_event), "no event stop fabricated for a non-walkable event");
    assert.equal(route.live_event_stop, undefined);
    assert.equal(r.body.pulse_route_interrupt.status, "suggested");
    assert.equal(r.body.pulse_route_interrupt.route_mutation, false);
    assert.equal(r.body.pulse_route_interrupt.requires_user_action, true);
    const evening = r.body.place_structure.district_day.evening_event;
    assert.equal(evening.id, "ev-tonight", "the anchor itself remains — real, sourced, no walk claim");
    assert.ok(!evening.woven_into_route);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = ORIGINAL_FETCH;
  }
});
