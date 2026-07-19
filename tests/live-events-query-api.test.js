"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { buildApp } = require("../server/app");
const { mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;

function postJson(server, path, body) {
  const payload = JSON.stringify(body);
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (response) => {
      let raw = "";
      response.on("data", (chunk) => (raw += chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(raw) }));
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

async function withServer(options, run) {
  const server = buildApp(options).listen(0);
  try {
    await run(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function collectedEvents(overrides = {}) {
  return {
    coverage: "covered",
    feed: { id: "municipal-calendar", label: "Municipal calendar" },
    feeds: [{ id: "municipal-calendar", label: "Municipal calendar", status: "ok", event_rows: 2 }],
    acquisition: {
      mode: "bounded_multi_source",
      radius_m: 3000,
      source_health: {
        status: "healthy",
        result: "events_found",
        selected_source_count: 1,
        responding_source_count: 1,
        event_bearing_source_count: 1,
      },
    },
    tonight: [{ id: "near", title: "Harbour concert", lat: 55.606, lng: 13.004 }],
    this_week: [{ id: "week", title: "Market this week", lat: 55.607, lng: 13.005 }],
    ...overrides,
  };
}

test("around_place query reuses trusted supply, preference ranking and source health", async () => {
  let captured = null;
  let loaderCalls = 0;
  let resolverCalls = 0;
  const eventSupply = async (input) => {
    captured = input;
    return collectedEvents({
      tonight: [
        { id: "near", title: "Harbour concert", lat: 55.606, lng: 13.004 },
        { id: "far", title: "Far concert", lat: 55.75, lng: 13.25 },
      ],
    });
  };

  await withServer({
    eventSupply,
    openDataLoader: async () => { loaderCalls += 1; return []; },
    placeResolver: async () => { resolverCalls += 1; return null; },
    clock: { now: () => "2026-07-19T18:00:00Z" },
  }, async (server) => {
    const response = await postJson(server, "/api/live-events", {
      scope: "around_place",
      anchor: { lat: 55.605, lng: 13.003 },
      time: "tonight",
      preferences: ["nightlife"],
      eventSupply: { feeds: [{ id: "evil" }] },
      feeds: [{ id: "evil" }],
      live_events: { tonight: [{ id: "evil" }] },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.query.scope, "around_place");
    assert.equal(response.body.query.time, "tonight");
    assert.deepEqual(response.body.query.preferences, ["nightlife"]);
    assert.equal(response.body.route_mutation, false);
    assert.equal(response.body.day_anchor_mutation, false);
    assert.deepEqual(response.body.live_events.tonight.map((event) => event.id), ["near"]);
    assert.equal(response.body.live_events.feed.id, "municipal-calendar");
    assert.equal(response.body.live_events.acquisition.source_health.status, "healthy");
    assert.doesNotMatch(JSON.stringify(response.body), /evil/);
    assert.equal("days" in response.body, false, "an events query never composes or returns a route");
  });

  assert.deepEqual(captured.preferences, ["nightlife"]);
  assert.equal(captured.scope.kind, "around_place");
  assert.equal(captured.radiusM, 3000);
  assert.equal(loaderCalls, 0, "event exploration never calls the place candidate loader");
  assert.equal(resolverCalls, 0, "public event coordinates never ask the place resolver to attest them");
});

test("near_route passes bounded discovery points and removes events outside the corridor", async () => {
  let captured = null;
  const supply = async (input) => {
    captured = input;
    return collectedEvents({
      tonight: [
        { id: "on-route", lat: 55.605, lng: 13.01 },
        { id: "off-route", lat: 55.68, lng: 13.15 },
      ],
      this_week: [],
    });
  };
  const routePoints = [
    { lat: 55.6, lng: 13 },
    { lat: 55.61, lng: 13.02 },
    { lat: 55.62, lng: 13.04 },
  ];

  await withServer({ eventSupply: supply }, async (server) => {
    const response = await postJson(server, "/api/live-events", {
      scope: "near_route",
      route_points: routePoints,
      preferences: ["culture"],
      time: "this_week",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.query.scope, "near_route");
    assert.equal(response.body.query.route_point_count, 3);
    assert.deepEqual(response.body.live_events.tonight.map((event) => event.id), ["on-route"]);
    assert.equal(response.body.live_events.acquisition.source_health.surfaced_event_count, 1);
  });

  assert.deepEqual(captured.sourceAnchors, routePoints);
  assert.equal(captured.scope.kind, "near_route");
  assert.ok(captured.radiusM > captured.scope.radius_m, "collection circle covers the full bounded corridor");
  assert.ok(captured.radiusM <= 10000);
});

test("near_me stays an event scope and never becomes a day-anchor mutation", async () => {
  await withServer({ eventSupply: async () => collectedEvents() }, async (server) => {
    const response = await postJson(server, "/api/live-events", {
      scope: "near_me",
      lat: 55.605,
      lng: 13.003,
      time: "tonight",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.query.scope, "near_me");
    assert.equal(response.body.query.radius_m, 2000);
    assert.equal(response.body.day_anchor_mutation, false);
    assert.equal(response.body.route_mutation, false);
  });
});

test("disabled, throwing and malformed supply outcomes remain distinct and fail soft", async () => {
  await withServer({ eventSupply: null }, async (server) => {
    const response = await postJson(server, "/api/live-events", { scope: "around_place", lat: 55.6, lng: 13 });
    assert.equal(response.status, 200);
    assert.equal(response.body.live_events.coverage, "unavailable");
    assert.equal(response.body.live_events.acquisition.source_health.status, "unavailable");
    assert.deepEqual(response.body.live_events.acquisition.source_health.reasons, ["event_supply_not_configured"]);
  });

  await withServer({ eventSupply: async () => { throw new Error("https://private.example/token=secret"); } }, async (server) => {
    const response = await postJson(server, "/api/live-events", { scope: "around_place", lat: 55.6, lng: 13 });
    assert.equal(response.status, 200);
    assert.equal(response.body.live_events.acquisition.source_health.status, "failed");
    assert.deepEqual(response.body.live_events.acquisition.source_health.reasons, ["event_supply_failed"]);
    assert.doesNotMatch(JSON.stringify(response.body), /private|secret/);
  });

  await withServer({ eventSupply: async () => ({ coverage: "certainly_live" }) }, async (server) => {
    const response = await postJson(server, "/api/live-events", { scope: "around_place", lat: 55.6, lng: 13 });
    assert.equal(response.body.live_events.acquisition.source_health.status, "failed");
    assert.deepEqual(response.body.live_events.acquisition.source_health.reasons, ["event_supply_invalid_result"]);
  });
});

test("invalid public geometry is rejected before trusted supply runs", async () => {
  let calls = 0;
  await withServer({ eventSupply: async () => { calls += 1; return collectedEvents(); } }, async (server) => {
    const invalidAnchor = await postJson(server, "/api/live-events", { scope: "near_me", lat: 999, lng: 13 });
    assert.equal(invalidAnchor.status, 400);
    assert.equal(invalidAnchor.body.error, "invalid_live_event_anchor");

    const missingRoute = await postJson(server, "/api/live-events", { scope: "near_route", route_points: [] });
    assert.equal(missingRoute.status, 400);
    assert.equal(missingRoute.body.error, "near_route_requires_route_points");
  });
  assert.equal(calls, 0);
});

test("compose and re-query expose one shared live_events contract", async () => {
  const supply = async ({ preferences }) => {
    assert.deepEqual(preferences, ["culture"]);
    return collectedEvents();
  };
  global.fetch = mockStableWeatherFetch();
  try {
    await withServer({ eventSupply: supply, openDataLoader: null }, async (server) => {
      const query = await postJson(server, "/api/live-events", {
        scope: "around_place",
        anchor: { lat: 55.605, lng: 13.003 },
        preferences: ["culture"],
      });
      const compose = await postJson(
        server,
        "/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&include_external_candidates=1",
        {
          lat: 55.605,
          lng: 13.003,
          dates: ["2026-07-19"],
          preferences: ["culture"],
          include_external_candidates: 1,
        },
      );
      assert.equal(compose.status, 200);
      assert.deepEqual(query.body.live_events, compose.body.live_events);
    });
  } finally {
    global.fetch = ORIGINAL_FETCH;
  }
});
