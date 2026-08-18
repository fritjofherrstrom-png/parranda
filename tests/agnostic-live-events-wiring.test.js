/**
 * live_events wiring — the agnostic (any-place) route response carries live events
 * near the trusted anchor ADDITIVELY, env-gated + injectable, honest about
 * coverage, and NEVER required (an uncovered anchor still returns a route).
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { buildApp } = require("../server/app");
const { resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
const { mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;
const FLAG = "experimental_agnostic_route_output=1&include_external_candidates=1";

function post(server, body) {
  const { port } = server.address();
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(JSON.parse(d)));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function withServer(eventSupply, run) {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ eventSupply }).listen(0);
  try {
    await run(server);
  } finally {
    await new Promise((r) => server.close(r));
    global.fetch = ORIGINAL_FETCH;
  }
}

const HELSINKI_BODY = { lat: 60.17, lng: 24.94, dates: ["2026-06-28"], preferences: ["food"], include_external_candidates: 1 };

test("a covered anchor carries live_events (tonight + this_week) on the agnostic response", async () => {
  const supply = async ({ anchor, preferences }) => {
    assert.ok(anchor && Number.isFinite(anchor.lat), "supply receives the trusted anchor");
    assert.deepEqual(preferences, ["food"], "planner preferences reach ranking but not source trust");
    return {
      coverage: "covered",
      feed: { id: "linkedevents-helsinki", label: "Helsinki Linked Events", license: "CC-BY 4.0" },
      feeds: [
        { id: "linkedevents-helsinki", family: "municipal_open", status: "ok", event_rows: 2 },
        { id: "ticketmaster-global", family: "global_commercial", status: "empty", event_rows: 0 },
      ],
      acquisition: {
        mode: "bounded_multi_source",
        radius_m: 3000,
        selected_source_count: 2,
        source_health: { status: "healthy", result: "events_found" },
      },
      tonight: [{ id: "t1", title: "Tonight gig", starts_at: "2026-06-28T19:00:00Z", source_url: "https://x/t1" }],
      this_week: [{ id: "w1", title: "Thursday concert", starts_at: "2026-07-01T18:00:00Z", source_url: "https://x/w1" }],
    };
  };
  await withServer(supply, async (server) => {
    const res = await post(server, HELSINKI_BODY);
    assert.ok(res.agnostic_route_output_experiment, "agnostic path ran");
    assert.ok(res.live_events, "live_events attached");
    assert.equal(res.live_events.coverage, "covered");
    assert.equal(res.live_events.feed.id, "linkedevents-helsinki");
    assert.equal(res.live_events.feeds.length, 2);
    assert.equal(res.live_events.acquisition.mode, "bounded_multi_source");
    assert.equal(res.live_events.acquisition.source_health.status, "healthy");
    assert.equal(res.live_events.tonight[0].id, "t1");
    assert.equal(res.live_events.this_week[0].id, "w1");
  });
});

test("an uncovered anchor carries honest absence — coverage uncovered, no fabricated events, route intact", async () => {
  const supply = async () => ({ coverage: "uncovered", feed: null, tonight: [], this_week: [] });
  await withServer(supply, async (server) => {
    const res = await post(server, { lat: 41.9, lng: 12.5, dates: ["2026-06-28"], preferences: ["food"], include_external_candidates: 1 });
    assert.ok(res.agnostic_route_output_experiment, "route still composed");
    assert.ok(res.live_events, "live_events present");
    assert.equal(res.live_events.coverage, "uncovered");
    assert.deepEqual(res.live_events.tonight, []);
    assert.deepEqual(res.live_events.this_week, []);
  });
});

test("no event supply configured (default-off) → no live_events, route unchanged", async () => {
  await withServer(null, async (server) => {
    const res = await post(server, HELSINKI_BODY);
    assert.ok(res.agnostic_route_output_experiment, "route composed");
    assert.equal(res.live_events, undefined, "live events are strictly additive and off by default");
  });
});

test("a throwing event supply never breaks the route (fail-soft)", async () => {
  const supply = async () => {
    throw new Error("feed down");
  };
  await withServer(supply, async (server) => {
    const res = await post(server, HELSINKI_BODY);
    assert.ok(res.agnostic_route_output_experiment, "route still returned");
    assert.equal(res.live_events, undefined, "a feed error degrades to no live_events, never a 500");
  });
});

test("trusted live events remain available when route composition is blocked", async () => {
  const supply = async () => ({
    coverage: "covered",
    feed: { id: "municipal-calendar", label: "Municipal calendar" },
    feeds: [{ id: "municipal-calendar", status: "ok", event_rows: 1 }],
    tonight: [{ id: "event-1", title: "Harbour concert", starts_at: "2026-06-28T19:00:00Z" }],
    this_week: [],
  });
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: null, eventSupply: supply }).listen(0);
  try {
    const res = await post(server, HELSINKI_BODY);
    assert.equal(res.agnostic_route_output_experiment.route_mutation, false);
    assert.ok(res.agnostic_route_output_experiment.readiness_blockers.includes("no_trusted_loader"));
    assert.equal(res.live_events.coverage, "covered");
    assert.equal(res.live_events.tonight[0].id, "event-1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = ORIGINAL_FETCH;
  }
});

test("a resolved but route-blocked place still records independent Live source demand", async () => {
  let demand = null;
  const sourceCatalog = {
    listApprovedEventFeedsForAnchor: async () => [],
    getDiscoveryHealthForAnchor: async () => null,
    recordScoutDemand: async (value) => {
      demand = value;
      return { status: "recorded", target_status: "pending" };
    },
  };
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    sourceCatalog,
    eventCache: { peek: () => null, warm: () => {} },
  });
  const placeResolver = async () => [{
    label: "Northport, Testland",
    lat: 58.1,
    lng: 12.2,
    confidence: "medium",
    provenance: "trusted_test_resolver",
    admin_context: { locality: "Northport", country: "Testland", country_code: "se" },
    spatial_scope: {
      source: "trusted_test_bounds",
      kind: "city",
      bounds: { west: 12.0, south: 57.95, east: 12.4, north: 58.25 },
    },
  }];
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: null, eventSupply: supply, placeResolver }).listen(0);
  try {
    const res = await post(server, {
      place: "Northport",
      dates: ["2026-06-28"],
      preferences: ["culture"],
      include_external_candidates: 1,
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(res.agnostic_route_output_experiment.route_mutation, false);
    assert.ok(res.agnostic_route_output_experiment.readiness_blockers.includes("no_trusted_loader"));
    assert.equal(res.live_events.coverage, "uncovered");
    assert.equal(res.live_events.acquisition.discovery_health.status, "pending");
    assert.deepEqual(demand.anchor, { lat: 58.1, lng: 12.2 });
    assert.equal(demand.placeLabel, "Northport, Testland");
    assert.equal(demand.placeContext.locality, "Northport");
    assert.equal(demand.spatialScope.collection_mode, "regional_bounded");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = ORIGINAL_FETCH;
  }
});

test("resolved place context reaches only the trusted event supply seam", async () => {
  let suppliedContext = null;
  let suppliedLabel = null;
  let suppliedScope = null;
  let suppliedVenueResolver = "not-called";
  const eventSupply = async ({ placeContext, placeLabel, spatialScope, venueResolver }) => {
    suppliedContext = placeContext;
    suppliedLabel = placeLabel;
    suppliedScope = spatialScope;
    suppliedVenueResolver = venueResolver;
    return { coverage: "uncovered", feed: null, tonight: [], this_week: [] };
  };
  const placeResolver = async () => [{
    label: "Stockholm, Sverige",
    lat: 59.3293,
    lng: 18.0686,
    confidence: "medium",
    provenance: "trusted_test_resolver",
    admin_context: {
      locality: "Stockholm",
      municipality: "Stockholms kommun",
      country: "Sverige",
      country_code: "se",
    },
    spatial_scope: {
      source: "test_resolver_bounds",
      kind: "city",
      bounds: { west: 17.8, south: 59.1, east: 18.3, north: 59.5 },
    },
  }];
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: null, eventSupply, placeResolver }).listen(0);
  try {
    const res = await post(server, {
      place: "Stockholm",
      place_context: { locality: "Injected", country_code: "xx" },
      place_label: "Injected Label",
      spatial_scope: { kind: "region", bounds: { west: 0, south: 0, east: 1, north: 1 } },
      venueResolver: { results: [{ lat: 0, lng: 0 }] },
      venue_resolution: { resolved_count: 999 },
      dates: ["2026-06-28"],
      preferences: ["culture"],
      include_external_candidates: 1,
    });
    assert.deepEqual(suppliedContext, {
      locality: "Stockholm",
      municipality: "Stockholms kommun",
      country: "Sverige",
      country_code: "se",
    });
    assert.equal(suppliedLabel, "Stockholm, Sverige");
    assert.deepEqual(suppliedScope, {
      source: "test_resolver_bounds",
      kind: "settlement",
      bounds: { west: 17.8, south: 59.1, east: 18.3, north: 59.5 },
      width_km: 28.38,
      height_km: 44.48,
      diagonal_km: 52.76,
      collection_mode: "regional_bounded",
    });
    assert.equal(suppliedVenueResolver, undefined, "public payload cannot inject the trusted venue resolver seam");
    assert.equal("admin_context" in res.agnostic_route_output_experiment.intake.resolved, false);
    assert.doesNotMatch(JSON.stringify(res), /Injected|"xx"|resolved_count":999/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = ORIGINAL_FETCH;
  }
});

test("coordinate reverse context reaches Live while public context fields remain untrusted", async () => {
  let supplied = null;
  const eventSupply = async (input) => {
    supplied = input;
    return { coverage: "uncovered", feed: null, tonight: [], this_week: [] };
  };
  const placeResolver = async () => { throw new Error("place search must not run for coordinates"); };
  placeResolver.resolveCoordinates = async () => ({
    label: "Cannes",
    provenance: "trusted_reverse_fixture",
    admin_context: {
      locality: "Cannes",
      region: "Provence-Alpes-Côte d’Azur",
      country: "France",
      country_code: "fr",
    },
    spatial_scope: {
      source: "trusted_reverse_fixture",
      kind: "municipality",
      bounds: { south: 43.5, north: 43.6, west: 6.95, east: 7.08 },
    },
  });
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: null, eventSupply, placeResolver }).listen(0);
  try {
    const res = await post(server, {
      lat: 43.5528,
      lng: 7.0174,
      place: "Injected place",
      place_context: { locality: "Injected", country_code: "xx" },
      spatial_scope: { kind: "region", bounds: { west: 0, south: 0, east: 1, north: 1 } },
      dates: ["2026-06-28"],
      preferences: ["markets"],
      include_external_candidates: 1,
    });

    assert.deepEqual(supplied.anchor, { lat: 43.5528, lng: 7.0174 });
    assert.deepEqual(supplied.placeContext, {
      locality: "Cannes",
      region: "Provence-Alpes-Côte d’Azur",
      country: "France",
      country_code: "fr",
    });
    assert.equal(supplied.placeLabel, "Cannes");
    assert.equal(supplied.spatialScope.kind, "municipality");
    assert.equal(res.agnostic_route_output_experiment.intake.resolved.provenance, "explicit_request_coordinates");
    assert.equal(res.agnostic_route_output_experiment.intake.resolved.context_provenance, "trusted_reverse_fixture");
    assert.equal(res.agnostic_route_output_experiment.intake.query, "Injected place");
    assert.notEqual(res.agnostic_route_output_experiment.intake.resolved.label, "Injected place");
    assert.doesNotMatch(JSON.stringify(res), /"xx"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = ORIGINAL_FETCH;
  }
});
