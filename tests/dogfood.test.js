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
const fs = require("node:fs");
const path = require("node:path");

const { buildApp, isDogfoodUiEnabled } = require("../server/app");
const Render = require("../dogfood-render");
const { translations } = require("../server/ui-i18n");
const {
  externalRecord,
  makeLoader,
  requestJson,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;
const DOGFOOD_CLIENT_SOURCE = fs.readFileSync(path.join(__dirname, "..", "dogfood.js"), "utf8");

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

test("client: Leaflet tooltips use a textContent DOM node, never a raw HTML string", () => {
  assert.match(
    DOGFOOD_CLIENT_SOURCE,
    /function buildSafeTooltipLabelNode\(label\) \{[\s\S]*?tooltip\.textContent = String\(label\);[\s\S]*?return tooltip;[\s\S]*?\}/,
    "tooltip helper must render labels through textContent",
  );
  assert.match(
    DOGFOOD_CLIENT_SOURCE,
    /marker\.bindTooltip\(buildSafeTooltipLabelNode\(label\), \{ direction: "top" \}\)/,
    "Leaflet receives a DOM node, not the raw source-backed label string",
  );
  assert.doesNotMatch(
    DOGFOOD_CLIENT_SOURCE,
    /marker\.bindTooltip\(label\s*,/,
    "raw labels must never be passed to Leaflet because string tooltips are treated as HTML",
  );
});

// === Shared DogfoodRender helpers ==========================================

const TINY_I18N = {
  lang: "en",
  strings: {
    "dogfood.banner.label": "EXPERIMENTAL",
    "dogfood.banner.title": "Experimental any-place route",
    "dogfood.banner.detail": "Uses trusted source-backed candidates.",
    "dogfood.blocker.external_candidates_not_requested": "External candidates not requested.",
    "dogfood.blocker.no_usable_trusted_records": "No usable trusted records.",
    "dogfood.blocker.incomplete_geometry": "Too few stops have usable coordinates.",
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
    "dogfood.calibration.heading": "Readiness verdict",
    "dogfood.calibration.level": "Level",
    "dogfood.calibration.status.usable": "Usable",
    "dogfood.calibration.status.thin_usable": "Thin usable",
    "dogfood.calibration.status.blocked": "Blocked",
    "dogfood.calibration.status.environment_not_wired": "Environment not wired",
    "dogfood.calibration.status.not_applicable": "Not applicable",
    "dogfood.calibration.guide.usable": "Usable for dogfood evaluation — not production-ready.",
    "dogfood.calibration.guide.thin_usable": "Usable for dogfood only with caps.",
    "dogfood.calibration.guide.blocked": "No experimental route was produced; inspect blockers.",
    "dogfood.calibration.guide.environment_not_wired": "Deployment is missing required source wiring, not a bad place verdict.",
    "dogfood.calibration.guide.not_applicable": "The experiment did not apply to this response.",
    "dogfood.calibration.reason.experimental_route_produced": "Experimental route was produced.",
    "dogfood.calibration.reason.walking_validated": "Walking-budget validation passed.",
    "dogfood.calibration.reason.daypart_ordering_validated": "Daypart rhythm ordering was validated.",
    "dogfood.calibration.reason.role_order_fallback_after_sequence_validation": "Role-order fallback after sequence validation.",
    "dogfood.calibration.reason.resolver_attested_timezone": "Timezone came from resolver metadata.",
    "dogfood.calibration.reason.weather_provider_auto_timezone": "Timezone was derived from weather provider metadata.",
    "dogfood.calibration.reason.timezone_unavailable": "Timezone was unavailable.",
    "dogfood.calibration.reason.weather_context_used": "Weather context influenced candidate choice.",
    "dogfood.calibration.reason.time_context_used": "Time context influenced candidate choice.",
    "dogfood.calibration.reason.heuristic_walking_estimate": "Walking is heuristic.",
    "dogfood.calibration.reason.walking_router_fallback_used": "Walking-router fallback was used.",
    "dogfood.calibration.reason.source_backed_external_candidates": "Stops came from source-backed external candidates.",
    "dogfood.calibration.reason.below_planner_candidate_threshold": "Candidate supply is below planner threshold.",
    "dogfood.calibration.reason.environment_not_wired": "Required deployment wiring is missing.",
    "dogfood.calibration.reason.not_applicable": "Calibration is not applicable.",
    "dogfood.calibration.reason.walking_validation_blocked_route": "Walking validation blocked the route.",
    "dogfood.calibration.reason.geometry_coherence_blocked_route": "Geometry coherence blocked the route.",
    "dogfood.calibration.reason.candidate_supply_blocked_route": "Candidate supply blocked the route.",
    "dogfood.calibration.reason.unknown": "Unknown readiness reason",
    "dogfood.calibration.cap.experimental_agnostic_route": "Experimental agnostic route only.",
    "dogfood.calibration.cap.capped_by_heuristic_walking": "Capped by heuristic walking.",
    "dogfood.calibration.cap.capped_by_role_order_fallback": "Capped by role-order fallback.",
    "dogfood.calibration.cap.capped_by_derived_timezone": "Capped by derived timezone.",
    "dogfood.calibration.cap.capped_by_partial_context": "Capped by partial context.",
    "dogfood.calibration.cap.capped_by_unresolved_roles": "Capped by unresolved roles.",
    "dogfood.calibration.cap.capped_by_external_only_sources": "Capped by external-only sources.",
    "dogfood.calibration.cap.capped_by_below_planner_candidate_threshold": "Capped by below-threshold candidates.",
    "dogfood.calibration.cap.unknown": "Unknown readiness cap",
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
          { id: "food-1", label: "Food One", role: "food_anchor", daypart: "afternoon", origin: "external_open", confidence: "medium", lat: 41.9, lng: 12.49 },
          { id: "cafe-1", label: "Cafe One", role: "coffee_fika_stop", daypart: "morning", origin: "external_open", confidence: "medium", lat: 41.901, lng: 12.491 },
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
      readiness_calibration: {
        status: "thin_usable",
        level: "low",
        summary: "The experimental agnostic route is usable for dogfood, but evidence or context is thin.",
        reasons: ["experimental_route_produced", "walking_validated", "weather_provider_auto_timezone"],
        caps: ["experimental_agnostic_route", "capped_by_derived_timezone", "capped_by_heuristic_walking"],
        inputs: { selected_stop_count: 2, loader_status: "loaded:2" },
      },
      caveats: [],
      walking_validation: { valid: true, blockers: [], checks: { stop_count: 2, leg_count: 1, total_walk_km: 0.3, max_leg_km: 0.3, total_estimated_walk_minutes: 4, total_budget_km: 25, max_leg_budget_km: 6, walking_source: "heuristic", fallback_used: false } },
      context: {
        status: "available",
        time: {
          timezone: "Europe/Rome",
          timezone_known: true,
          timezone_source: "weather_provider_auto",
          timezone_trust: "derived_from_weather_provider",
          status: "resolved",
          now: "2026-05-25T19:30:00",
          time_band: "evening",
        },
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
      readiness_calibration: {
        status: blockers.includes("external_candidates_not_requested") ? "not_applicable" : "blocked",
        level: "unavailable",
        summary: "No experimental route was produced.",
        // Blocked verdicts carry pass-through blockers as `blocker:<token>`
        // (blockerReasons in agnostic-route-readiness-calibration.js).
        reasons: blockers.includes("external_candidates_not_requested")
          ? blockers.slice()
          : blockers.map((token) => `blocker:${token}`),
        caps: ["experimental_agnostic_route"],
        inputs: { selected_stop_count: 0 },
      },
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
  // #275 — honest daypart label surfaced per stop
  assert.equal(view.route.stops[0].daypart, "afternoon");
  assert.equal(view.route.stops[1].daypart, "morning");
  assert.equal(view.route.mapStops.length, 2);
  // #275/#276 — daypart arc + anchoring fields surfaced honestly (defaults when absent)
  assert.deepEqual(view.route.daypartArc, []);
  assert.equal(view.route.anchoredToLocalTime, false);
  assert.deepEqual(view.route.trimmedDayparts, []);
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
  assert.equal(view.context.time.timezoneSource, "weather_provider_auto");
  assert.equal(view.context.time.timezoneTrust, "derived_from_weather_provider");
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


// --- pure: readiness calibration verdict ---------------------------------

test("pure: buildCalibrationSummary surfaces all five statuses with labels and guides", () => {
  for (const status of ["usable", "thin_usable", "blocked", "environment_not_wired", "not_applicable"]) {
    const summary = Render.buildCalibrationSummary({
      readiness_calibration: {
        status,
        level: status === "usable" ? "medium" : "unavailable",
        summary: "Usable for dogfood evaluation — not production-ready.",
        reasons: status === "environment_not_wired" ? ["environment_not_wired", "no_trusted_loader"] : ["experimental_route_produced"],
        caps: status === "thin_usable" ? ["experimental_agnostic_route", "capped_by_partial_context", "capped_by_derived_timezone"] : ["experimental_agnostic_route"],
        inputs: { selected_stop_count: 3 },
      },
    }, TINY_I18N);
    assert.equal(summary.status, status);
    assert.equal(summary.statusLabel, TINY_I18N.strings[`dogfood.calibration.status.${status}`]);
    assert.equal(summary.guide, TINY_I18N.strings[`dogfood.calibration.guide.${status}`]);
    assert.equal("inputs" in summary, false, "inputs stay JSON-only diagnostics, not view text");
  }
});

test("pure: buildExperimentView includes calibration, and missing readiness_calibration stays back-compatible", () => {
  const view = Render.buildExperimentView(successResponse(), TINY_I18N);
  assert.equal(view.calibration.status, "thin_usable");
  assert.equal(view.calibration.level, "low");
  assert.equal(view.calibration.reasons[0].caption, "Experimental route was produced.");
  assert.ok(view.calibration.caps.some((cap) => cap.token === "capped_by_derived_timezone"));

  const legacy = successResponse({ readiness_calibration: undefined });
  assert.equal(Render.buildExperimentView(legacy, TINY_I18N).calibration, null);
});

test("pure: unknown calibration reason and cap surface honest fallback with raw token", () => {
  const summary = Render.buildCalibrationSummary({
    readiness_calibration: {
      status: "thin_usable",
      level: "low",
      summary: "Experimental verdict.",
      reasons: ["future_reason_token"],
      caps: ["future_cap_token"],
      inputs: {},
    },
  }, TINY_I18N);
  assert.ok(summary.reasons[0].caption.includes("Unknown readiness reason"));
  assert.ok(summary.reasons[0].caption.includes("future_reason_token"));
  assert.ok(summary.caps[0].caption.includes("Unknown readiness cap"));
  assert.ok(summary.caps[0].caption.includes("future_cap_token"));
});

test("pure: blocked-verdict `blocker:`-prefixed reasons render the blocker caption, not the unknown fallback", () => {
  const view = Render.buildExperimentView(blockerResponse(["no_usable_trusted_records", "incomplete_geometry"]), TINY_I18N);
  const byToken = Object.fromEntries(view.calibration.reasons.map((tile) => [tile.token, tile.caption]));
  // Full prefixed token stays visible; caption comes from the blocker i18n map.
  assert.equal(byToken["blocker:no_usable_trusted_records"], TINY_I18N.strings["dogfood.blocker.no_usable_trusted_records"]);
  assert.equal(byToken["blocker:incomplete_geometry"], TINY_I18N.strings["dogfood.blocker.incomplete_geometry"]);
  for (const tile of view.calibration.reasons) {
    assert.ok(!tile.caption.includes("Unknown readiness reason"), `known blocker reason fell back: ${tile.token}`);
  }
  // A prefixed token we do not know still falls back honestly with the raw token.
  const unknown = Render.buildCalibrationSummary({
    readiness_calibration: { status: "blocked", level: "unavailable", summary: "x", reasons: ["blocker:some_future_blocker"], caps: [], inputs: {} },
  }, TINY_I18N);
  assert.ok(unknown.reasons[0].caption.includes("blocker:some_future_blocker"));
});

test("pure: an unknown future calibration status keeps its raw token as label instead of mislabeling as not_applicable", () => {
  const summary = Render.buildCalibrationSummary({
    readiness_calibration: { status: "future_status", level: "low", summary: "x", reasons: [], caps: [], inputs: {} },
  }, TINY_I18N);
  assert.equal(summary.status, "future_status");
  assert.equal(summary.statusLabel, "future_status");
  assert.notEqual(summary.statusLabel, TINY_I18N.strings["dogfood.calibration.status.not_applicable"]);
});

test("guard: rendered view text containing calibration has no eta/best route/optimal/fastest/shortest", () => {
  const response = successResponse({
    readiness_calibration: {
      status: "thin_usable",
      level: "low",
      summary: "This is the best route with eta-like claims.",
      reasons: ["experimental_route_produced", "walking_validated"],
      caps: ["experimental_agnostic_route", "capped_by_partial_context"],
      inputs: { selected_stop_count: 2 },
    },
  });
  const text = Render.flattenViewText(Render.buildExperimentView(response, TINY_I18N));
  for (const banned of ["eta", "best route", "optimal", "fastest", "shortest"]) {
    const re = new RegExp("\\b" + banned.replace(/\s+/g, "\\s+") + "\\b", "i");
    assert.equal(re.test(text), false, `must not contain "${banned}"`);
  }
});

test("i18n: calibration maps reference keys present in both sv and en", () => {
  const keys = new Set([
    "dogfood.calibration.heading",
    "dogfood.calibration.level",
    ...Object.values(Render.CALIBRATION_STATUS_KEYS),
    ...Object.values(Render.CALIBRATION_REASON_KEYS),
    ...Object.values(Render.CALIBRATION_CAP_KEYS),
    "dogfood.calibration.reason.unknown",
    "dogfood.calibration.cap.unknown",
  ]);
  for (const status of Object.keys(Render.CALIBRATION_STATUS_KEYS)) {
    keys.add(`dogfood.calibration.guide.${status}`);
  }
  for (const lang of ["sv", "en"]) {
    for (const key of keys) {
      assert.equal(typeof translations[lang][key], "string", `${lang} missing ${key}`);
      assert.ok(translations[lang][key].length > 0, `${lang} empty ${key}`);
    }
  }
});

test("pure: an anchored route surfaces daypart arc + trimmed dayparts in the view (#276)", () => {
  const response = successResponse();
  response.days[0].primary_route.daypart_arc = ["afternoon", "evening"];
  response.days[0].primary_route.current_local_time_band = "afternoon";
  response.days[0].primary_route.anchored_to_local_time = true;
  response.days[0].primary_route.trimmed_dayparts = ["morning", "midday"];
  response.days[0].primary_route.caveats = ["experimental", "day_anchored_to_current_time"];
  const view = Render.buildExperimentView(response, TINY_I18N);
  assert.deepEqual(view.route.daypartArc, ["afternoon", "evening"]);
  assert.equal(view.route.currentLocalTimeBand, "afternoon");
  assert.equal(view.route.anchoredToLocalTime, true);
  assert.deepEqual(view.route.trimmedDayparts, ["morning", "midday"]);
  assert.ok(view.route.caveats.some((c) => c.token === "day_anchored_to_current_time"));
});

test("i18n: every caveat caption (incl. #275 daypart) exists in both sv and en", () => {
  const keys = Object.values(Render.CAVEAT_KEYS);
  assert.ok(keys.includes("dogfood.caveat.daypart_arc_precedes_local_time"));
  assert.ok(keys.includes("dogfood.caveat.experimental_daypart_sequence"));
  assert.ok(keys.includes("dogfood.caveat.day_anchored_to_current_time"));
  for (const lang of ["sv", "en"]) {
    for (const key of keys) {
      assert.equal(typeof translations[lang][key], "string", `${lang} missing ${key}`);
      assert.ok(translations[lang][key].length > 0, `${lang} empty ${key}`);
    }
  }
});

test("client: renderCalibration exists, is invoked first, and avoids innerHTML", () => {
  assert.match(DOGFOOD_CLIENT_SOURCE, /function renderCalibration\(view\) \{[\s\S]*?textContent[\s\S]*?el\(/, "renderCalibration must build text via el/textContent");
  assert.match(DOGFOOD_CLIENT_SOURCE, /renderCalibration\(view\);[\s\S]*?renderSummary\(view\);/, "calibration renders before summary/route/blockers");
  const body = DOGFOOD_CLIENT_SOURCE.match(/function renderCalibration\(view\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(body, /innerHTML\s*=/, "calibration renderer must not use innerHTML");
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
