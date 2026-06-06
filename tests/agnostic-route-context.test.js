/**
 * #262 — trusted time + weather context for the agnostic route experiment.
 *
 * Proves: trusted weather/time INFLUENCE candidate composition (via the existing
 * fit-scorer inputs) and are SURFACED honestly under
 * `agnostic_route_output_experiment.context` + `days[0].dayflow_context`; the
 * public payload weather is never trusted; time is timezone-gated; context fails
 * soft and never satisfies eligibility/walking on its own; no live scraping,
 * no ETA / opening-hours / "best/optimal/fastest/shortest" claims.
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
  resolveAgnosticContext,
  collectInfluenceReasons,
} = require("../server/planner/agnostic-route-context");

const ORIGINAL_FETCH = global.fetch;
const FLAG = "experimental_agnostic_route_output=1";
const DATE = "2026-05-25";

const RAIN = { condition: "rain", maxTemp: 14, minTemp: 9, apparentTempMax: 13, precipitationProbabilityMax: 85, precipitationSum: 4, windSpeedMax: 10, source: "test", stale: false };
const SUN = { condition: "sun", maxTemp: 24, minTemp: 14, apparentTempMax: 23, precipitationProbabilityMax: 5, precipitationSum: 0, windSpeedMax: 8, source: "test", stale: false };

// 19:30 Europe/Rome — evening, golden-hour-eligible (May).
function eveningClock() {
  return new Date("2026-05-25T17:30:00Z");
}

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

// Same fixture, but every record declares time_fit:["midday"] — so a fallback
// midday band (hour 13) WOULD produce time_match:midday unless time is disabled.
function fixtureMiddayNear(base) {
  return fixtureNear(base).map((rec) => ({ ...rec, time_fit: ["midday"] }));
}

function agnosticBody(extra = {}) {
  return { city: "atlantis-unknown-place", dates: [DATE], lat: 41.9, lng: 12.49, preferences: ["food", "coffee", "scenic"], include_external_candidates: 1, ...extra };
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

// =====================================================================
// Pure: resolveAgnosticContext
// =====================================================================

test("pure: trusted weather is read; live is always unavailable", async () => {
  const ctx = await resolveAgnosticContext({ coords: { lat: 41.9, lng: 12.49 }, date: DATE, weatherProvider: async () => RAIN });
  assert.equal(ctx.contextBlock.weather.status, "resolved");
  assert.equal(ctx.contextBlock.weather.read.kind, "rain");
  assert.equal(ctx.contextBlock.live.available, false);
  assert.equal(ctx.contextBlock.live.reason, "no_any_place_live_source");
});

test("pure: weather provider error → fail-soft unavailable, never throws", async () => {
  const ctx = await resolveAgnosticContext({ coords: { lat: 41.9, lng: 12.49 }, date: DATE, weatherProvider: async () => { throw new Error("wx down"); } });
  assert.equal(ctx.weather, null);
  assert.equal(ctx.contextBlock.weather.status, "unavailable");
  assert.equal(ctx.contextBlock.weather.read, null);
});

test("pure: timezone unknown → no time signals, timezone_unavailable", async () => {
  const ctx = await resolveAgnosticContext({ coords: { lat: 41.9, lng: 12.49 }, date: DATE, weatherProvider: async () => SUN, trustedTimezone: null });
  assert.equal(ctx.timezoneKnown, false);
  assert.equal(ctx.contextBlock.time.status, "timezone_unavailable");
  assert.equal(ctx.contextBlock.time.time_band, null);
  assert.deepEqual(ctx.contextBlock.computed_signals, []);
});

// Blocker 2 — honest top-level context.status.
test("pure: top-level status is honest about availability", async () => {
  const unavailable = await resolveAgnosticContext({ coords: { lat: 41.9, lng: 12.49 }, date: DATE, weatherProvider: async () => { throw new Error("x"); }, trustedTimezone: null });
  assert.equal(unavailable.contextBlock.status, "unavailable", "no weather + no tz → unavailable");

  const partial = await resolveAgnosticContext({ coords: { lat: 41.9, lng: 12.49 }, date: DATE, weatherProvider: async () => SUN, trustedTimezone: null });
  assert.equal(partial.contextBlock.status, "partial", "weather only → partial");

  const available = await resolveAgnosticContext({ coords: { lat: 41.9, lng: 12.49 }, date: DATE, weatherProvider: async () => SUN, trustedTimezone: "Europe/Rome", clock: eveningClock });
  assert.equal(available.contextBlock.status, "available", "weather + trusted tz → available");
});

test("pure: timezone known → time band + ISO now + computed signals", async () => {
  const ctx = await resolveAgnosticContext({ coords: { lat: 41.9, lng: 12.49 }, date: DATE, weatherProvider: async () => SUN, trustedTimezone: "Europe/Rome", clock: eveningClock });
  assert.equal(ctx.timezoneKnown, true);
  assert.equal(ctx.contextBlock.time.status, "resolved");
  assert.equal(ctx.contextBlock.time.time_band, "evening");
  assert.match(ctx.contextBlock.time.now, /^2026-05-25T19:30:00$/);
  assert.ok(ctx.contextBlock.computed_signals.length >= 1, "computed signals present when tz known");
  assert.ok(ctx.contextBlock.computed_signals.every((s) => s.source === "computed_pulse"));
});

test("pure: an invalid timezone is treated as unknown (no lookup)", async () => {
  const ctx = await resolveAgnosticContext({ coords: { lat: 41.9, lng: 12.49 }, date: DATE, weatherProvider: async () => SUN, trustedTimezone: "Not/AZone", clock: eveningClock });
  assert.equal(ctx.timezoneKnown, false);
  assert.equal(ctx.contextBlock.time.status, "timezone_unavailable");
});

test("pure: collectInfluenceReasons matches selected ids → weather/time reasons", () => {
  const plannerRoles = { roles: [
    { candidates: [{ candidate_id: "v1", weather_reasons: ["rain_penalizes_exposed"], time_reasons: ["time_match:evening"] }] },
    { candidates: [{ candidate_id: "r1", weather_reasons: ["rain_favors_indoor"], time_reasons: [] }] },
    { candidates: [{ candidate_id: "unused", weather_reasons: ["sun_favors_scenic"], time_reasons: [] }] },
  ] };
  const combination = { selected: [{ candidate_id: "v1" }, { candidate_id: "r1" }] };
  const out = collectInfluenceReasons(plannerRoles, combination);
  assert.deepEqual(out.weather, ["rain_favors_indoor", "rain_penalizes_exposed"]);
  assert.deepEqual(out.time, ["time_match:evening"]);
});

// =====================================================================
// API: default unchanged + inspect inert
// =====================================================================

test(
  "api: default unchanged without the flag — no context, no dayflow",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), weatherProvider: async () => SUN }, async (server) => {
    const r = await requestJson(server, { path: "/api/route-recommendations?lang=en", body: routeBody("rome", ["scenic", "food"]) });
    assert.equal(r.body.agnostic_route_output_experiment, undefined, "no experiment / context without the flag");
  }),
);

test(
  "api: inspect tokens never trigger context or mutation",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), weatherProvider: async () => SUN }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&inspect=agnostic_route_candidate&include_external_candidates=1`, body: agnosticBody() });
    assert.equal(r.body.agnostic_route_output_experiment, undefined);
    assert.deepEqual(r.body.days, []);
  }),
);

// =====================================================================
// API: influence + trust boundary (corrections #4)
// =====================================================================

test(
  "api: trusted weather influences composition — rain vs sun differ measurably",
  async () => {
    global.fetch = mockStableWeatherFetch();
    const loader = makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 }));
    const run = async (weather) => {
      const server = buildApp({ openDataLoader: loader, weatherProvider: async () => weather }).listen(0);
      try {
        const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
        return r.body.agnostic_route_output_experiment.context;
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    };
    const rain = await run(RAIN);
    const sun = await run(SUN);
    global.fetch = ORIGINAL_FETCH;
    // Trusted weather reached candidate scoring and is honestly explained.
    assert.ok(rain.influence.weather_fit_reasons.some((r) => r.startsWith("rain_")), `rain reasons: ${JSON.stringify(rain.influence.weather_fit_reasons)}`);
    assert.ok(sun.influence.weather_fit_reasons.includes("sun_favors_scenic"), `sun reasons: ${JSON.stringify(sun.influence.weather_fit_reasons)}`);
    assert.notDeepEqual(rain.influence.weather_fit_reasons, sun.influence.weather_fit_reasons, "measurable fit-reason delta");
    assert.equal(rain.weather.read.kind, "rain");
    assert.equal(rain.influence.weather_fed_into_selection, true);
  },
);

test(
  "api: public payload weather is ignored — only the trusted provider reaches scoring",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), weatherProvider: async () => SUN }, async (server) => {
    // Payload says rain; trusted provider says sun. Sun must win.
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody({ weather: RAIN }) });
    const ctx = r.body.agnostic_route_output_experiment.context;
    assert.equal(ctx.weather.read.kind, "outdoor_window", "trusted sun read, not payload rain");
    assert.ok(ctx.influence.weather_fit_reasons.includes("sun_favors_scenic"));
    assert.equal(ctx.influence.weather_fit_reasons.some((x) => x.startsWith("rain_")), false, "payload rain never reached scoring");
  }),
);

// =====================================================================
// API: timezone-gated time + dayflow attach
// =====================================================================

test(
  "api: a resolver-supplied timezone + fixed clock → time context + dayflow_context",
  withServer({
    openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })),
    weatherProvider: async () => RAIN,
    clock: eveningClock,
    placeResolver: async () => [{ label: "R", lat: 41.9, lng: 12.49, confidence: "high", provenance: "tz_geo", timezone: "Europe/Rome" }],
  }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: { city: "unknown-x", dates: [DATE], place: "Trastevere", preferences: ["food", "coffee", "scenic"], include_external_candidates: 1 } });
    const ctx = r.body.agnostic_route_output_experiment.context;
    assert.equal(ctx.time.status, "resolved");
    assert.equal(ctx.time.timezone, "Europe/Rome");
    assert.equal(ctx.time.time_band, "evening");
    assert.ok(ctx.computed_signals.length >= 1);
    assert.equal(ctx.influence.time_fed_into_selection, true);
    // Dayflow read attached (rain → indoor lean).
    assert.ok(r.body.days[0].dayflow_context, "dayflow_context attached");
    assert.equal(r.body.days[0].dayflow_context.lean, "indoor");
  }),
);

test(
  "api: explicit coordinates (no resolver tz) → timezone_unavailable, route still produced",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), weatherProvider: async () => RAIN, clock: eveningClock }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const ctx = r.body.agnostic_route_output_experiment.context;
    assert.equal(r.body.agnostic_route_output_experiment.route_mutation, true);
    assert.equal(ctx.time.status, "timezone_unavailable");
    assert.deepEqual(ctx.computed_signals, []);
    assert.equal(ctx.influence.time_fed_into_selection, false);
  }),
);

// =====================================================================
// API: fail-soft + context never substitutes for eligibility/walking
// =====================================================================

test(
  "api: weather provider throws → route still produced, context unavailable, no dayflow",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), weatherProvider: async () => { throw new Error("wx down"); } }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    assert.equal(r.body.agnostic_route_output_experiment.route_mutation, true);
    assert.equal(r.body.agnostic_route_output_experiment.context.weather.status, "unavailable");
    assert.equal((r.body.days[0] || {}).dayflow_context, undefined);
  }),
);

test(
  "api: context does NOT substitute for trusted candidates — empty loader still blocks, no weather call",
  async () => {
    global.fetch = mockStableWeatherFetch();
    let weatherCalled = false;
    const server = buildApp({ openDataLoader: makeLoader([]), weatherProvider: async () => { weatherCalled = true; return SUN; } }).listen(0);
    try {
      const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
      const exp = r.body.agnostic_route_output_experiment;
      assert.equal(exp.route_mutation, false);
      assert.ok(exp.readiness_blockers.includes("no_usable_trusted_records"));
      assert.equal(exp.context.status, "skipped", "no trusted selection → context skipped");
      assert.equal(weatherCalled, false, "no wasted weather call before a known hard blocker");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  },
);

test(
  "api: no external opt-in → context skipped, weather not called (correction #5)",
  async () => {
    global.fetch = mockStableWeatherFetch();
    let weatherCalled = false;
    const server = buildApp({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), weatherProvider: async () => { weatherCalled = true; return SUN; } }).listen(0);
    try {
      const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody({ include_external_candidates: undefined }) });
      const exp = r.body.agnostic_route_output_experiment;
      assert.equal(exp.route_mutation, false);
      assert.ok(exp.readiness_blockers.includes("external_candidates_not_requested"));
      assert.equal(exp.context.status, "skipped");
      assert.equal(weatherCalled, false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  },
);

// =====================================================================
// API: no live promotion + no overclaims
// =====================================================================

test(
  "api: live context is unavailable and never becomes a route stop; no overclaim/ETA",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), weatherProvider: async () => RAIN }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    const route = r.body.days[0].primary_route;
    assert.equal(exp.context.live.available, false);
    // All stops originate from the trusted loader, never from a live signal.
    assert.ok(route.main_stops.every((s) => /^(food|cafe|view)-/.test(s.id)));
    // Carry the #261 honesty guards.
    assert.equal("opening_hours" in route, false);
    assert.equal("eta" in route, false);
  }),
);

// Blocker 1 — no fallback midday time influence when the timezone is unknown.
test(
  "api: timezone-unknown explicit coords do NOT get fallback midday time influence",
  withServer({ openDataLoader: makeLoader(fixtureMiddayNear({ lat: 41.9, lng: 12.49 })), weatherProvider: async () => RAIN, clock: eveningClock }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const ctx = r.body.agnostic_route_output_experiment.context;
    assert.equal(r.body.agnostic_route_output_experiment.route_mutation, true, "route still returns");
    assert.equal(ctx.time.status, "timezone_unavailable");
    assert.equal(ctx.influence.time_fed_into_selection, false);
    assert.deepEqual(ctx.influence.time_fit_reasons, [], "no time_match:midday from fallback time");
    // Even though every candidate declares time_fit:["midday"], the unknown-tz
    // path must not synthesize a midday band that tilts selection.
    assert.equal(ctx.influence.time_fit_reasons.includes("time_match:midday"), false);
  }),
);

// Blocker 3 — scoped overclaim check on the agnostic context + experimental route.
test(
  "api: agnostic context + experimental route make no comparative route claims",
  withServer({ openDataLoader: makeLoader(fixtureNear({ lat: 41.9, lng: 12.49 })), weatherProvider: async () => RAIN }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: agnosticBody() });
    const exp = r.body.agnostic_route_output_experiment;
    // Scope to ONLY the #262 surface: the experiment context + the experimental
    // primary route (not the whole baseline response, to avoid legacy-copy brittleness).
    const scoped = JSON.stringify({ context: exp.context, primary_route: r.body.days[0].primary_route }).toLowerCase();
    for (const word of ["best", "optimal", "fastest", "shortest"]) {
      assert.equal(scoped.includes(word), false, `agnostic context/route must not claim "${word}"`);
    }
    // The sanitized weather reason still reads honestly.
    assert.match(exp.context.weather.read.reason, /works more reliably/);
  }),
);
