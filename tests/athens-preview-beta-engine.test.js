// Preview-beta engine activation: a registered PREVIEW citypack (Athens) opens
// its planner through the engine-backed source-backed supplement automatically —
// no manual query flags — so the day is visibly fuller, while curated stays the
// higher-trust spine and rich citypacks (Rome/Barcelona) are untouched.
const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApp } = require("../server/app");
const {
  externalRecord,
  makeLoader,
  requestJson,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

const originalFetch = global.fetch;
test.before(() => {
  global.fetch = mockStableWeatherFetch();
});
test.after(() => {
  global.fetch = originalFetch;
});

function withServer(openDataLoader, run) {
  return async () => {
    const server = buildApp({ openDataLoader }).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      await run(server);
    } finally {
      server.close();
    }
  };
}

const athensBody = (extra = {}) => ({
  city: "athens",
  dates: ["2026-06-20"],
  start: { type: "auto" },
  end: { type: "auto" },
  walking_km_target: 8,
  preferences: ["mat", "fika", "utsikt"],
  ...extra,
});

function primaryStops(body) {
  return (body && body.days && body.days[0] && body.days[0].primary_route && body.days[0].primary_route.main_stops) || [];
}

test(
  "Athens preview planner auto-activates the source-backed supplement WITHOUT manual flags",
  withServer(null, async (server) => {
    // No experiment / engine-compose / external flags, no loader.
    const res = await requestJson(server, { path: "/api/route-recommendations?lang=en", body: athensBody() });
    const stops = primaryStops(res.body);
    const sourceBacked = stops.filter((s) => s.provisional === true);

    assert.ok(res.body.preview_engine, "preview_engine status is present without any flags");
    assert.equal(res.body.preview_engine.preview_engine_mode, true);
    assert.equal(res.body.preview_engine.planner_mode, "preview_beta_engine");
    assert.equal(res.body.preview_engine.field_test_status, "fuller_preview_day");
    assert.equal(res.body.preview_engine.visible_change, "source_backed_stops_in_primary_route");
    // Visibly fuller: source-backed stops are now in the day, marked honestly.
    assert.ok(sourceBacked.length > 0, "expected source-backed stops in the Athens day");
    assert.equal(res.body.preview_engine.active, true);
    assert.equal(res.body.preview_engine.route_stop_count, stops.length);
    assert.equal(res.body.preview_engine.curated_stop_count, stops.length - sourceBacked.length);
    assert.equal(res.body.preview_engine.source_backed_stop_count, sourceBacked.length);
    assert.deepEqual(
      res.body.preview_engine.source_backed_stop_ids,
      sourceBacked.map((s) => s.id),
    );
    assert.ok(
      res.body.preview_engine.still_thin.includes("provisional_source_candidates_unverified"),
      "field-test status must admit provisional stops are still unverified",
    );
    assert.ok(
      res.body.preview_engine.still_thin.includes("pulse_live_context_only"),
      "Pulse/live must stay explicitly context-only until route consumption is deliberate",
    );
    assert.ok(
      res.body.preview_engine.still_thin.includes("blitz_candidate_spine_separate"),
      "Blitz candidate mode remains a separate lane, not a silent planner mutation",
    );
    assert.equal(res.body.preview_engine.surface_contract.planner, "preview_beta_engine_primary_route");
    assert.equal(res.body.preview_engine.surface_contract.pulse_live.route_mutation, false);
    assert.equal(res.body.preview_engine.surface_contract.pulse_live.status, "context_only_not_route_mutating");
    assert.ok(
      res.body.preview_engine.surface_contract.pulse_live.active_source_count >= 1,
      "Athens has at least one active Pulse/source provider configured",
    );
    assert.equal(res.body.preview_engine.surface_contract.blitz.route_mutation, false);
    assert.equal(res.body.preview_engine.surface_contract.blitz.status, "separate_candidate_spine_endpoint");
    // Curated spine preserved: verified Athens items are still in the route.
    assert.ok(stops.some((s) => !s.provisional), "curated spine stops must remain");
    // No geography leak + honest trust on supplemental stops.
    stops.forEach((s) => assert.ok(String(s.id).startsWith("athens-"), `stop ${s.id} is not an Athens place`));
    sourceBacked.forEach((s) => {
      assert.equal(s.provisional, true);
      assert.equal(s.trust.source_tier, "inferred");
      assert.equal(s.trust.human_verified, false);
    });
  }),
);

test(
  "Athens fallback is honest when no trusted loader supplies the fill",
  withServer(null, async (server) => {
    const res = await requestJson(server, { path: "/api/route-recommendations?lang=en", body: athensBody() });
    // The loader added nothing (none configured) — the status says so, never silent.
    assert.equal(res.body.preview_engine.loader_fill_reason, "no_trusted_external_provider");
    assert.equal(res.body.preview_engine.loader_supplemental_count, 0);
    assert.ok(res.body.preview_engine.still_thin.includes("trusted_external_loader_not_configured"));
  }),
);

test(
  "Rome (rich citypack) never activates preview-beta and is unchanged",
  withServer(makeLoader([externalRecord("rome-ext-1", "Rome Ext", "cafe", 41.9, 12.49, ["coffee"])]), async (server) => {
    const res = await requestJson(server, {
      path: "/api/route-recommendations?lang=en",
      body: { city: "rome", dates: ["2026-06-20"], start: { type: "auto" }, end: { type: "auto" }, walking_km_target: 8, preferences: ["mat"] },
    });
    assert.equal(res.body.preview_engine, undefined, "no preview-beta status for a rich citypack");
    assert.ok(primaryStops(res.body).every((s) => !s.provisional), "Rome route must have no provisional stops");
  }),
);

test(
  "Barcelona (beta visibility, rich) never activates preview-beta",
  withServer(makeLoader([externalRecord("bcn-ext-1", "BCN Ext", "cafe", 41.39, 2.16, ["coffee"])]), async (server) => {
    const res = await requestJson(server, {
      path: "/api/route-recommendations?lang=en",
      body: { city: "barcelona", dates: ["2026-06-20"], start: { type: "auto" }, end: { type: "auto" }, walking_km_target: 8, preferences: ["mat"] },
    });
    assert.equal(res.body.preview_engine, undefined);
    assert.ok(primaryStops(res.body).every((s) => !s.provisional));
  }),
);

test(
  "public payload cannot inject source-backed candidates into the Athens preview route",
  withServer(null, async (server) => {
    // A malicious payload tries to smuggle a source candidate / fabricated places.
    const res = await requestJson(server, {
      path: "/api/route-recommendations?lang=en",
      body: athensBody({
        sourceCandidates: [{ id: "evil-injected", label: "Injected", lat: 37.97, lng: 23.72, provisional: true }],
        source_candidates: [{ id: "evil-2", label: "Injected2", lat: 37.97, lng: 23.72 }],
      }),
    });
    const stops = primaryStops(res.body);
    assert.ok(
      stops.every((s) => String(s.id).startsWith("athens-")),
      "no payload-injected candidate may reach the route — every stop is a trusted Athens place",
    );
    assert.ok(!stops.some((s) => s.id === "evil-injected" || s.id === "evil-2"));
  }),
);
