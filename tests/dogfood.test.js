/**
 * #264 — env-gated `/dogfood` UI for the agnostic route experiment.
 *
 * Proves:
 *   - env off → 404; env on → 200 + experimental banner;
 *   - dogfood.js / dogfood-render.js are served as root assets;
 *   - the shared DogfoodRender helpers (the EXACT helpers used by the browser)
 *     produce the correct view structures for both success and blocker responses;
 *   - the rendered view contains no `eta` / `best route` / `optimal` / `fastest` /
 *     `shortest` wording, regardless of input;
 *   - no /api/* behavior is changed.
 *
 * All tests are deterministic and require no jsdom; the helpers under test are
 * the same code path the browser runs (`window.DogfoodRender` and `require()`
 * resolve to the SAME `dogfood-render.js` UMD module).
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");

const { buildApp, isDogfoodUiEnabled } = require("../server/app");
const Render = require("../dogfood-render");
const {
  externalRecord,
  makeLoader,
  requestJson,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;

function getHtml(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, (response) => {
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: data, headers: response.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

function withEnv(value, run) {
  const previous = process.env.PARRANDA_DOGFOOD_UI;
  return async () => {
    if (value === undefined) delete process.env.PARRANDA_DOGFOOD_UI;
    else process.env.PARRANDA_DOGFOOD_UI = value;
    try {
      await run();
    } finally {
      if (previous === undefined) delete process.env.PARRANDA_DOGFOOD_UI;
      else process.env.PARRANDA_DOGFOOD_UI = previous;
    }
  };
}

// === isDogfoodUiEnabled (explicit env objects — never ambient process.env) ===

test("env helper: disabled by default and for unrelated values", () => {
  assert.equal(isDogfoodUiEnabled({}), false);
  assert.equal(isDogfoodUiEnabled({ PARRANDA_DOGFOOD_UI: "" }), false);
  assert.equal(isDogfoodUiEnabled({ PARRANDA_DOGFOOD_UI: "no" }), false);
});

test("env helper: enabled via enabled / 1 / true / TRUE", () => {
  for (const v of ["enabled", "1", "true", "TRUE", " enabled "]) {
    assert.equal(isDogfoodUiEnabled({ PARRANDA_DOGFOOD_UI: v }), true, v);
  }
});

// === Server route gate =====================================================

test(
  "server: /dogfood is 404 when the env flag is off",
  withEnv(undefined, async () => {
    const server = buildApp({ openDataLoader: makeLoader([]) }).listen(0);
    try {
      const response = await getHtml(server, "/dogfood");
      assert.equal(response.status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }),
);

test(
  "server: /dogfood is 200 + experimental banner when enabled",
  withEnv("enabled", async () => {
    const server = buildApp({ openDataLoader: makeLoader([]) }).listen(0);
    try {
      const response = await getHtml(server, "/dogfood?lang=en");
      assert.equal(response.status, 200);
      assert.match(response.headers["content-type"] || "", /html/);
      assert.ok(response.body.includes("EXPERIMENTAL"), "experimental banner label present");
      assert.ok(response.body.includes("/dogfood.js"), "dogfood.js script tag present");
      assert.ok(response.body.includes("/dogfood-render.js"), "dogfood-render.js script tag present");
      assert.ok(response.body.includes("dogfoodMap"), "map container present");
      assert.ok(response.body.includes("__PARRANDA_I18N__"), "i18n bootstrap injected");
      // Honesty guard: the rendered HTML page itself must not contain comparative
      // route claims (the dogfood is an honesty surface).
      for (const banned of ["best route", "optimal", "fastest", "shortest"]) {
        const re = new RegExp("\\b" + banned.replace(/\s+/g, "\\s+") + "\\b", "i");
        assert.equal(re.test(response.body), false, `must not claim "${banned}"`);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }),
);

test(
  "server: dogfood assets are served as root assets",
  withEnv("enabled", async () => {
    const server = buildApp({ openDataLoader: makeLoader([]) }).listen(0);
    try {
      const r1 = await getHtml(server, "/dogfood.js");
      assert.equal(r1.status, 200);
      assert.ok(r1.body.includes("DogfoodRender"), "client glue references DogfoodRender");
      const r2 = await getHtml(server, "/dogfood-render.js");
      assert.equal(r2.status, 200);
      assert.ok(r2.body.includes("buildExperimentView"), "shared module exports buildExperimentView");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }),
);

test(
  "server: /api/* is untouched by the dogfood PR (default route call still works)",
  withEnv("enabled", async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({ openDataLoader: makeLoader([externalRecord("a-1", "A", "restaurant", 41.9, 12.49, ["mat"])]) }).listen(0);
    try {
      const r = await requestJson(server, {
        path: "/api/route-recommendations?lang=en",
        body: { city: "rome", dates: ["2026-05-25"], preferences: ["scenic"] },
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.agnostic_route_output_experiment, undefined, "default route call has no experiment block");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  }),
);

// === Shared DogfoodRender helpers ==========================================

const TINY_I18N = {
  lang: "en",
  strings: {
    "dogfood.banner.label": "EXPERIMENTAL",
    "dogfood.banner.title": "Experimental any-place route",
    "dogfood.banner.detail": "Uses trusted source-backed candidates.",
    "dogfood.blocker.external_candidates_not_requested": "External candidates not requested.",
    "dogfood.blocker.no_usable_trusted_records": "No usable trusted records.",
    "dogfood.blocker.place_resolver_unavailable": "No place resolver configured.",
    "dogfood.blocker.unknown": "Unknown blocker",
    "dogfood.caveat.experimental": "Experimental",
    "dogfood.caveat.heuristic_walking_estimate": "Heuristic walking estimate",
    "dogfood.intake.mode.place": "Place name (resolver)",
    "dogfood.intake.status.resolved": "Anchor resolved",
    "dogfood.context.status.available": "Available",
    "dogfood.diff.replaced": "Experimental route replaced baseline.",
    "dogfood.diff.synthesized": "Experimental day synthesized (no baseline route).",
    "dogfood.diff.baseline_kept": "Baseline returned unchanged.",
    "dogfood.walking.checks": "Walking validation",
  },
};

function successResponse(overrides = {}) {
  return {
    days: [{
      date: "2026-05-25",
      experimental_agnostic_day: true,
      primary_route: {
        id: "agnostic-experimental:agnostic-area:cafe-1+food-1",
        experimental: true,
        title: "Experimental any-place candidate route",
        summary: "Trusted source-backed candidates; walking-budget validated.",
        main_stops: [
          { id: "food-1", label: "Food One", role: "food_anchor", origin: "external_open", confidence: "medium", lat: 41.9, lng: 12.49 },
          { id: "cafe-1", label: "Cafe One", role: "coffee_fika_stop", origin: "external_open", confidence: "medium", lat: 41.901, lng: 12.491 },
        ],
        order_source: "trusted_candidate_pool+candidate_role_order",
        order_confidence: "walking_budget_validated",
        routing_source: "heuristic",
        estimated_km: 0.3,
        estimated_walk_minutes: 4,
        map_path_points: [{ lat: 41.9, lng: 12.49 }, { lat: 41.901, lng: 12.491 }],
        caveats: ["experimental", "heuristic_walking_estimate"],
      },
    }],
    agnostic_route_output_experiment: {
      experimental: true,
      route_mutation: true,
      selected_variant: "experimental_agnostic",
      eligibility: { eligible: true, blockers: [], caveats: [], checks: {} },
      baseline: { had_primary_route: false, primary_route: null, readiness: null },
      readiness_blockers: [],
      caveats: [],
      walking_validation: { valid: true, blockers: [], checks: { stop_count: 2, leg_count: 1, total_walk_km: 0.3, max_leg_km: 0.3, total_estimated_walk_minutes: 4, total_budget_km: 25, max_leg_budget_km: 6, walking_source: "heuristic", fallback_used: false } },
      context: {
        status: "available",
        time: { timezone: "Europe/Rome", timezone_known: true, status: "resolved", now: "2026-05-25T19:30:00", time_band: "evening" },
        weather: { status: "resolved", read: { kind: "outdoor_window", headline: "Pleasant window for outdoor stops.", reason: "Sun, dry, mild.", confidence: "medium" } },
        computed_signals: [{ type: "golden_hour", headline: "Golden hour nearby", source: "computed_pulse" }],
        live: { available: false, reason: "no_any_place_live_source" },
        influence: { weather_fed_into_selection: true, time_fed_into_selection: true, weather_fit_reasons: ["sun_favors_scenic"], time_fit_reasons: ["time_match:evening"] },
      },
      intake: {
        mode: "place",
        status: "resolved",
        query: "Trastevere",
        candidates_considered: 1,
        resolved: { label: "Trastevere, Rome", lat: 41.9, lng: 12.49, confidence: "medium", provenance: "nominatim_osm", attribution: "© OpenStreetMap contributors", license: "ODbL", timezone: null },
        blockers: [],
      },
      ...overrides,
    },
  };
}

function blockerResponse(blockers = ["no_usable_trusted_records"]) {
  return {
    days: [],
    agnostic_route_output_experiment: {
      experimental: true,
      route_mutation: false,
      selected_variant: "baseline",
      eligibility: { eligible: false, blockers: blockers.slice(), caveats: [], checks: {} },
      baseline: { had_primary_route: false, primary_route: null, readiness: null },
      readiness_blockers: blockers.slice(),
      caveats: [],
      context: { status: "skipped", reason: "external_candidates_not_requested", time: { timezone: null, timezone_known: false, status: "timezone_unavailable", now: null, time_band: null }, weather: { status: "skipped", read: null }, computed_signals: [], live: { available: false, reason: "no_any_place_live_source" }, influence: { weather_fed_into_selection: false, time_fed_into_selection: false, weather_fit_reasons: [], time_fit_reasons: [] } },
      intake: { mode: "place", status: "unresolved", query: "Trastevere", candidates_considered: 0, resolved: null, blockers: ["place_resolver_unavailable"] },
    },
  };
}

// --- pure: success view --------------------------------------------------

test("pure: a success response surfaces stops, walking estimate, caveats, intake attribution/license, and the trusted context", () => {
  const view = Render.buildExperimentView(successResponse(), TINY_I18N);
  assert.equal(view.hasExperiment, true);
  assert.equal(view.routeMutation, true);
  assert.equal(view.selectedVariant, "experimental_agnostic");
  // Stops (labels + roles + lat/lng for the map renderer)
  assert.equal(view.route.stops.length, 2);
  assert.equal(view.route.stops[0].label, "Food One");
  assert.equal(view.route.mapStops.length, 2);
  // Walking ESTIMATE fields are present and honest
  assert.equal(view.route.estimatedKm, 0.3);
  assert.equal(view.route.estimatedWalkMinutes, 4);
  assert.equal(view.route.orderConfidence, "walking_budget_validated");
  assert.equal(view.route.routingSource, "heuristic");
  // Caveats are mapped to captions (NOT just tokens)
  assert.ok(view.route.caveats.some((c) => c.token === "experimental" && c.caption === "Experimental"));
  assert.ok(view.route.caveats.some((c) => c.token === "heuristic_walking_estimate"));
  // Intake attribution + license surfaced
  assert.equal(view.intake.resolved.attribution, "© OpenStreetMap contributors");
  assert.equal(view.intake.resolved.license, "ODbL");
  assert.equal(view.intake.resolved.provenance, "nominatim_osm");
  // Context populated
  assert.equal(view.context.statusLabel, "Available");
  assert.equal(view.context.time.timeBand, "evening");
  assert.deepEqual(view.context.influence.weatherReasons, ["sun_favors_scenic"]);
  // Walking validation summary
  assert.equal(view.walking.valid, true);
  assert.equal(view.walking.totalWalkKm, 0.3);
  // Baseline diff is honest
  assert.equal(view.baselineDiff.key, "dogfood.diff.synthesized");
  // No blockers on success
  assert.deepEqual(view.blockers, []);
});

// --- pure: blocker view --------------------------------------------------

test("pure: a blocker response surfaces exact blockers and no fabricated route", () => {
  const view = Render.buildExperimentView(blockerResponse(["external_candidates_not_requested", "no_usable_trusted_records"]), TINY_I18N);
  assert.equal(view.routeMutation, false);
  assert.equal(view.route, null, "no fabricated route on blocker");
  // EVERY supplied blocker token surfaces with a human caption.
  const tokens = view.blockers.map((b) => b.token);
  assert.ok(tokens.includes("external_candidates_not_requested"));
  assert.ok(tokens.includes("no_usable_trusted_records"));
  // Intake blocker also surfaces (from the intake sub-block).
  assert.ok(tokens.includes("place_resolver_unavailable"));
  // Captions come from the supplied i18n (not the raw token).
  const caption = view.blockers.find((b) => b.token === "external_candidates_not_requested").caption;
  assert.equal(caption, "External candidates not requested.");
});

test("pure: an unknown blocker token still surfaces honestly with the raw token", () => {
  const view = Render.buildExperimentView(blockerResponse(["some_new_token_from_a_future_pr"]), TINY_I18N);
  const tile = view.blockers.find((b) => b.token === "some_new_token_from_a_future_pr");
  assert.ok(tile, "unknown token still tiled");
  assert.ok(tile.caption.includes("Unknown blocker"));
  assert.ok(tile.caption.includes("some_new_token_from_a_future_pr"));
});

// --- guard: no comparative wording, no ETA ------------------------------

test("guard: rendered view text contains no eta/best route/optimal/fastest/shortest (success path)", () => {
  const view = Render.buildExperimentView(successResponse(), TINY_I18N);
  const text = Render.flattenViewText(view);
  for (const banned of ["eta", "best route", "optimal", "fastest", "shortest"]) {
    const re = new RegExp("\\b" + banned.replace(/\s+/g, "\\s+") + "\\b", "i");
    assert.equal(re.test(text), false, `must not contain "${banned}" — got "${text.slice(0, 120)}"`);
  }
});

test("guard: rendered view text contains no eta/best route/optimal/fastest/shortest (blocker path)", () => {
  const view = Render.buildExperimentView(blockerResponse(), TINY_I18N);
  const text = Render.flattenViewText(view);
  for (const banned of ["eta", "best route", "optimal", "fastest", "shortest"]) {
    const re = new RegExp("\\b" + banned.replace(/\s+/g, "\\s+") + "\\b", "i");
    assert.equal(re.test(text), false, `must not contain "${banned}"`);
  }
});

test("guard: a server-side leak (route summary tries to say 'best route') is sanitized in the view", () => {
  const response = successResponse();
  response.days[0].primary_route.summary = "This is the best route for the day.";
  const view = Render.buildExperimentView(response, TINY_I18N);
  assert.equal(/\bbest route\b/i.test(Render.flattenViewText(view)), false);
  // The sanitizer must still leave the route renderable.
  assert.ok(view.route);
  assert.ok(view.route.summary.includes("[removed]"));
});

// --- baseline diff variants --------------------------------------------

test("pure: baseline diff labels each variant honestly", () => {
  // synthesized (no baseline route)
  let view = Render.buildExperimentView(successResponse(), TINY_I18N);
  assert.equal(view.baselineDiff.key, "dogfood.diff.synthesized");
  // replaced (baseline had a route)
  const replaced = successResponse({ baseline: { had_primary_route: true, primary_route: { id: "real" }, readiness: null } });
  view = Render.buildExperimentView(replaced, TINY_I18N);
  assert.equal(view.baselineDiff.key, "dogfood.diff.replaced");
  // baseline kept (no mutation)
  view = Render.buildExperimentView(blockerResponse(), TINY_I18N);
  assert.equal(view.baselineDiff.key, "dogfood.diff.baseline_kept");
});

// --- no-response edge cases --------------------------------------------

test("pure: a response with no experiment block produces a no-experiment view", () => {
  const view = Render.buildExperimentView({ days: [] }, TINY_I18N);
  assert.equal(view.hasExperiment, false);
  assert.equal(view.route, null);
  assert.deepEqual(view.blockers, []);
});
