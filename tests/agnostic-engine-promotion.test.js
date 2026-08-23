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
  "the deployed enabled env value activates engine compose and scrubs fallback-city truth",
  withServer(makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), async (server) => {
    const previous = process.env.PARRANDA_AGNOSTIC_ENGINE_COMPOSE;
    process.env.PARRANDA_AGNOSTIC_ENGINE_COMPOSE = "enabled";
    try {
      const r = await requestJson(server, {
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        body: agnosticBody(),
      });
      const exp = r.body.agnostic_route_output_experiment;
      const day = r.body.days[0];

      assert.equal(exp.synthesized_via, "agnostic_compose_engine");
      assert.equal(exp.promotion.promote, true);
      assert.equal(day.primary_route.routing_source, "agnostic_compose");
      assert.deepEqual(day.date_signals, []);
      assert.deepEqual(day.alternatives, []);
      assert.equal("live_events" in day, false);
      assert.equal(JSON.stringify(day).toLowerCase().includes("rome"), false);
    } finally {
      if (previous === undefined) delete process.env.PARRANDA_AGNOSTIC_ENGINE_COMPOSE;
      else process.env.PARRANDA_AGNOSTIC_ENGINE_COMPOSE = previous;
    }
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
  "day-value repair normalizes UI aliases before retaining fifth-intent coverage",
  withServer(makeLoader(broadIntentFixture({ lat: 41.9, lng: 12.49 })), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({
        preferences: ["food", "fika", "views", "culture", "nightlife"],
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
  "a minimal supply that still answers the request is published as a limited day",
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
    // Two real, walk-validated stops covering the requested food and coffee is
    // a short day, not a false one. Only the missing scenic intent is thin.
    assert.equal(exp.promotion.promote, true, "a minimal but valid day must publish");
    assert.equal(exp.promotion.readiness, "promotable_limited");
    assert.ok(exp.promotion.qualifying_caps.includes("capped_by_thin_day"));
    assert.deepEqual(exp.promotion.unmet_requested_intents, ["scenic"]);
    assert.equal((r.body.days[0]?.primary_route?.main_stops ?? []).length, 2);
  }),
);

test(
  "a promoted limited day carries no fallback-city truth at the public root",
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
    assert.equal(exp.promotion.promote, true);
    assert.equal(exp.baseline.had_primary_route, true, "only fallback route presence remains in experiment diagnostics");
    // The published day is the composed one, scrubbed of the fallback city it
    // was carried on. Publishing more days must never publish more Rome.
    assert.equal(r.body.days.length, 1);
    assert.equal(r.body.days[0].experimental_agnostic_route_applied, true);
    assert.deepEqual(r.body.days[0].alternatives, []);
    assert.deepEqual(r.body.days[0].date_signals, []);
    assert.equal(r.body.city, null);
    assert.equal(r.body.readiness, null);
    assert.equal(JSON.stringify(r.body).toLowerCase().includes("rome"), false);
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

// --------------------------------------------------------------------------
// NEGATIVE CONTROLS for the graded gate. Publishing limited days must not
// become publishing every day.
// --------------------------------------------------------------------------

test(
  "a day that answers none of the request is still withheld",
  withServer(makeLoader([
    externalRecord("food-0", "Food 0", "restaurant", 41.9, 12.49, ["mat"]),
    externalRecord("cafe-0", "Cafe 0", "cafe", 41.9008, 12.49, ["fika"]),
  ]), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      // Only museums requested; the supply has none.
      body: agnosticBody({ preferences: ["museums"] }),
    });
    const exp = r.body.agnostic_route_output_experiment;

    assert.equal(exp.promotion.promote, false, "a day covering no requested intent must not publish");
    assert.equal(exp.promotion.readiness, "non_promotable");
    assert.ok(exp.promotion.disqualifying_caps.includes("capped_by_requested_intent_unmet"));
    assert.deepEqual(r.body.days, [], "nothing is published");
  }),
);

test(
  "a supply too thin to compose a route is still withheld",
  withServer(makeLoader([
    externalRecord("food-0", "Food 0", "restaurant", 41.9, 12.49, ["mat"]),
  ]), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["food"] }),
    });
    const exp = r.body.agnostic_route_output_experiment;

    // The engine itself refuses below two coherent stops; grading never
    // resurrects a route that was never composed.
    assert.equal(exp.promotion.promote, false, "a route that does not exist must not publish");
    assert.deepEqual(r.body.days[0]?.primary_route ?? null, null);
  }),
);

// --------------------------------------------------------------------------
// Slice 03 — "Not this", the commitment ledger's first verb.
//
// The composed day and the candidate panel derive from SEPARATE loader calls.
// A dismissal has to reach both, or the user removes a place from their day and
// keeps staring at it in the list underneath.
// --------------------------------------------------------------------------

function ledgerLoader() {
  return makeLoader([
    externalRecord("food-0", "Food 0", "restaurant", 41.9, 12.49, ["mat"]),
    externalRecord("cafe-0", "Cafe 0", "cafe", 41.9008, 12.49, ["fika"]),
    externalRecord("museum-0", "Museum 0", "museum", 41.9012, 12.4906, ["kultur"]),
  ]);
}

test(
  "a dismissed place leaves both the composed day and the candidate panel",
  withServer(ledgerLoader(), async (server) => {
    const body = agnosticBody({ preferences: ["food", "coffee"], excluded_candidate_ids: ["cafe-0"] });
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body,
    });

    const serialized = JSON.stringify(r.body);
    assert.equal(serialized.includes("Cafe 0"), false, "the dismissed place must not appear anywhere");
    assert.equal(serialized.includes("cafe-0"), false, "not by id either");

    // The rest of the day is untouched and still real.
    assert.ok(serialized.includes("Food 0"));
    // And the request is honestly echoed as a count, never as the ids.
    assert.deepEqual(r.body.agnostic_route_output_experiment.excluded_candidates, { requested_count: 1 });
  }),
);

test(
  "dismissing everything yields an honest absent day, never a substitute",
  withServer(ledgerLoader(), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({
        preferences: ["food", "coffee"],
        excluded_candidate_ids: ["food-0", "cafe-0", "museum-0"],
      }),
    });

    // Supply shrinks, and the SAME honesty gates report it. Nothing is invented
    // to fill the gap the user created.
    assert.equal(r.body.agnostic_route_output_experiment.promotion.promote, false);
    assert.deepEqual(r.body.days, []);
  }),
);

test(
  "a request with no ledger is unchanged",
  withServer(ledgerLoader(), async (server) => {
    const withField = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["food", "coffee"], excluded_candidate_ids: [] }),
    });
    const without = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["food", "coffee"] }),
    });

    const stops = (r) => (r.body.days?.[0]?.primary_route?.main_stops ?? []).map((s) => s.id);
    assert.deepEqual(stops(withField), stops(without));
    assert.deepEqual(
      withField.body.agnostic_route_output_experiment.excluded_candidates,
      { requested_count: 0 },
    );
  }),
);

test(
  "a malformed ledger is ignored rather than trusted",
  withServer(ledgerLoader(), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({
        preferences: ["food", "coffee"],
        excluded_candidate_ids: ["../etc/passwd", "cafe 0", "<script>", { id: "cafe-0" }],
      }),
    });

    // None of those are ids we issued, so nothing is dismissed and the day stands.
    assert.equal(r.body.agnostic_route_output_experiment.excluded_candidates.requested_count, 0);
    assert.ok(JSON.stringify(r.body).includes("Cafe 0"));
  }),
);

// --------------------------------------------------------------------------
// Slice 04 — "Keep this one", the ledger's second verb.
//
// The point of these is that the pin bites on the LIVE engine-compose path.
// Slice 01 taught that a constraint wired to a diagnostic sidecar looks correct
// and does nothing, so every assertion here reads main_stops.
// --------------------------------------------------------------------------

function pinLoader() {
  return makeLoader([
    externalRecord("food-0", "Food 0", "restaurant", 41.9, 12.49, ["mat"]),
    externalRecord("cafe-0", "Cafe 0", "cafe", 41.9008, 12.49, ["fika"]),
    externalRecord("museum-0", "Museum 0", "museum", 41.9012, 12.4906, ["kultur"]),
    externalRecord("museum-1", "Museum 1", "museum", 41.9016, 12.4911, ["kultur"]),
    externalRecord("park-0", "Park 0", "park", 41.902, 12.4915, ["gront"]),
  ]);
}

// A pool deep enough that the per-role ranking cut actually bites. Every point
// is distinct, so nothing is lost to identity dedup and the only bound left on
// a role's options is the ranking itself.
function deepPinLoader() {
  const base = { lat: 41.9, lng: 12.49 };
  const recs = [];
  let n = 0;
  const pt = () => {
    const c = { lat: base.lat + n * 0.00035, lng: base.lng + (n % 3) * 0.00035 };
    n += 1;
    return c;
  };
  for (let i = 0; i < 8; i += 1) {
    const c = pt();
    recs.push(externalRecord(`food-${i}`, `Food ${i}`, "restaurant", c.lat, c.lng, ["mat"]));
  }
  for (let i = 0; i < 4; i += 1) {
    const c = pt();
    recs.push(externalRecord(`cafe-${i}`, `Cafe ${i}`, "cafe", c.lat, c.lng, ["fika"]));
  }
  for (let i = 0; i < 4; i += 1) {
    const c = pt();
    recs.push(externalRecord(`view-${i}`, `View ${i}`, "viewpoint", c.lat, c.lng, ["utsikt"]));
  }
  return makeLoader(recs);
}

const stopIdsOf = (r) => (r.body.days?.[0]?.primary_route?.main_stops ?? []).map((s) => s.id);

test(
  "a pinned candidate is kept in the composed day",
  withServer(pinLoader(), async (server) => {
    const plain = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["food", "coffee"] }),
    });
    const unpinned = stopIdsOf(plain);

    // Pick something the unpinned day did NOT choose, so the assertion means
    // something rather than restating the default.
    const outsider = ["park-0", "museum-1", "museum-0"].find((id) => !unpinned.includes(id));
    assert.ok(outsider, "need a candidate the default day leaves out");

    const pinned = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["food", "coffee"], pinned_candidate_ids: [outsider] }),
    });

    assert.ok(stopIdsOf(pinned).includes(outsider), `${outsider} must appear once pinned`);
    assert.equal(
      pinned.body.agnostic_route_output_experiment.pinned_candidates.honored_count,
      1,
    );
  }),
);

test(
  "a pin names a candidate; it does not dictate what the rest of the day is",
  withServer(pinLoader(), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["food", "coffee"], pinned_candidate_ids: ["park-0"] }),
    });

    const ids = stopIdsOf(r);
    assert.ok(ids.includes("park-0"));
    // The day still composes around it rather than collapsing to the pin alone.
    assert.ok(ids.length >= 2, "the rest of the day is still composed");
  }),
);

test(
  "a pin can never elevate a candidate the server never loaded",
  withServer(pinLoader(), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({
        preferences: ["food", "coffee"],
        pinned_candidate_ids: ["not-a-real-place", "osm-way-999999"],
      }),
    });

    // Selection-only: there is nothing in the pool to force, so nothing appears.
    assert.equal(JSON.stringify(r.body).includes("not-a-real-place"), false);
    const summary = r.body.agnostic_route_output_experiment.pinned_candidates;
    assert.equal(summary.requested_count, 2);
    assert.equal(summary.honored_count, 0);
    // Reported, never silently dropped.
    assert.equal(summary.unhonored_count, 2);
  }),
);

test(
  "an excluded candidate cannot be resurrected by pinning it",
  withServer(pinLoader(), async (server) => {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({
        preferences: ["food", "coffee"],
        excluded_candidate_ids: ["cafe-0"],
        pinned_candidate_ids: ["cafe-0"],
      }),
    });

    // Exclusion removes it from the pool; pinning only selects within the pool.
    // The subtractive verb wins, which is the fail-closed direction.
    assert.equal(stopIdsOf(r).includes("cafe-0"), false);
    assert.equal(r.body.agnostic_route_output_experiment.pinned_candidates.honored_count, 0);
  }),
);

test(
  "no pin leaves the request byte-identical",
  withServer(pinLoader(), async (server) => {
    const withField = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["food", "coffee"], pinned_candidate_ids: [] }),
    });
    const without = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["food", "coffee"] }),
    });

    assert.deepEqual(stopIdsOf(withField), stopIdsOf(without));
  }),
);

test(
  "a pin the day genuinely cannot reach is reported, never silently dropped",
  withServer(makeLoader([
    externalRecord("food-0", "Food 0", "restaurant", 41.9, 12.49, ["mat"]),
    externalRecord("cafe-0", "Cafe 0", "cafe", 41.9008, 12.49, ["fika"]),
    externalRecord("museum-0", "Museum 0", "museum", 41.9012, 12.4906, ["kultur"]),
    externalRecord("park-9", "Park 9", "park", 41.9068, 12.4977, ["gront"]),
    // Far from the cluster and off-intent: the scorer has every reason to drop
    // it, which is exactly why it must still be kept when pinned.
    externalRecord("far-0", "Far 0", "viewpoint", 41.9250, 12.5180, ["utsikt"]),
  ]), async (server) => {
    const plain = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["food", "coffee"] }),
    });
    assert.equal(stopIdsOf(plain).includes("far-0"), false, "the scorer leaves it out on its own");

    const pinned = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}&${ENGINE}`,
      body: agnosticBody({ preferences: ["food", "coffee"], pinned_candidate_ids: ["far-0"] }),
    });

    // Out of walking reach, so the reach policy removes it from the reservoir
    // before composition. A pin cannot reach past that gate — and the point is
    // that the refusal is REPORTED rather than silently swallowed.
    assert.equal(stopIdsOf(pinned).includes("far-0"), false);
    const summary = pinned.body.agnostic_route_output_experiment.pinned_candidates;
    assert.equal(summary.requested_count, 1);
    assert.equal(summary.honored_count, 0);
    assert.equal(summary.unhonored_count, 1, "an infeasible pin gets an honest verdict");
  }),
);

test(
  "a pin survives the per-role ranking cut in a deep pool",
  withServer(deepPinLoader(), async (server) => {
    // The failure this locks down was found on staging and reproduced here:
    // the candidate was loaded, gated and RANKED for its role, but two better-
    // scoring places filled the role's top-N and the cut removed it before any
    // downstream stage could hoist it. The pin then read as unhonoured against
    // a pool that contained it.
    const plain = await requestJson(server, {
      path: `/api/route-recommendations?${FLAG}&${ENGINE}`,
      method: "POST",
      body: agnosticBody(),
    });
    const outsider = "food-6";
    assert.ok(
      !stopIdsOf(plain).includes(outsider),
      "precondition: the default day does not choose it, so the assertion means something",
    );

    const pinned = await requestJson(server, {
      path: `/api/route-recommendations?${FLAG}&${ENGINE}`,
      method: "POST",
      body: agnosticBody({ pinned_candidate_ids: [outsider] }),
    });
    assert.ok(stopIdsOf(pinned).includes(outsider), `${outsider} must be kept once pinned`);
    assert.equal(
      pinned.body.agnostic_route_output_experiment.pinned_candidates.honored_count,
      1,
    );
    // The day is still composed AROUND it — the pin names one stop, it does not
    // become the day.
    assert.ok(stopIdsOf(pinned).length > 1, "the rest of the day still composes");
  }),
);

test(
  "a deep pool with no pin is unchanged by the rescue",
  withServer(deepPinLoader(), async (server) => {
    const a = await requestJson(server, {
      path: `/api/route-recommendations?${FLAG}&${ENGINE}`,
      method: "POST",
      body: agnosticBody(),
    });
    const b = await requestJson(server, {
      path: `/api/route-recommendations?${FLAG}&${ENGINE}`,
      method: "POST",
      body: agnosticBody({ pinned_candidate_ids: [] }),
    });
    assert.deepEqual(stopIdsOf(a), stopIdsOf(b), "an empty pin list is a no-op");
  }),
);
