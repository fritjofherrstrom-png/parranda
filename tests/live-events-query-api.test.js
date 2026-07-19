"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildApp } = require("../server/app");
const {
  HELSINKI_LINKED_EVENTS_FEED,
  resolveDefaultEventSupply,
} = require("../server/place-candidates/agnostic-event-supply");
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

function assertCompleteSourceHealth(health) {
  const countFields = [
    "selected_source_count",
    "responding_source_count",
    "event_bearing_source_count",
    "empty_source_count",
    "failed_source_count",
    "unavailable_source_count",
    "raw_event_count",
    "normalized_event_count",
    "accepted_event_count",
    "surfaced_event_count",
    "rejected_event_count",
  ];
  assert.equal(typeof health.status, "string");
  assert.equal(typeof health.result, "string");
  assert.ok(Array.isArray(health.reasons));
  for (const field of countFields) assert.equal(Number.isInteger(health[field]), true, `${field} is explicit`);
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
    assert.equal(response.body.contract, "live_event_query_v1");
    assert.equal(response.body.query.scope, "around_place");
    assert.equal(response.body.query.time, "tonight");
    assert.deepEqual(response.body.query.preferences, ["nightlife"]);
    assert.equal(response.body.route_mutation, false);
    assert.equal(response.body.day_anchor_mutation, false);
    assert.deepEqual(response.body.live_events.tonight.map((event) => event.id), ["near"]);
    assert.equal(response.body.live_events.feed.id, "municipal-calendar");
    assert.equal(response.body.live_events.acquisition.source_health.status, "healthy");
    assertCompleteSourceHealth(response.body.live_events.acquisition.source_health);
    assert.ok(Array.isArray(response.body.live_events.tonight));
    assert.ok(Array.isArray(response.body.live_events.this_week));
    assert.deepEqual(response.body.live_events.this_week.map((event) => event.id), ["week"]);
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
  let suppliedAnchor = null;
  await withServer({ eventSupply: async ({ anchor }) => { suppliedAnchor = anchor; return collectedEvents(); } }, async (server) => {
    const response = await postJson(server, "/api/live-events", {
      scope: "near_me",
      lat: 55.605,
      lng: 13.003,
      time: "tonight",
      route_mutation: true,
      day_anchor_mutation: true,
      days: [{ primary_route: { id: "payload-route" } }],
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.query.scope, "near_me");
    assert.equal(response.body.query.radius_m, 2000);
    assert.equal(response.body.day_anchor_mutation, false);
    assert.equal(response.body.route_mutation, false);
    assert.equal("days" in response.body, false);
    assert.deepEqual(suppliedAnchor, { lat: 55.605, lng: 13.003 });
  });
});

test("one trusted event pool stays isolated across around_place, near_route and near_me", async () => {
  const supply = async () => collectedEvents({
    tonight: [
      { id: "place-only", lat: 55.605, lng: 13.003 },
      { id: "route-only", lat: 55.64, lng: 13.06 },
      { id: "me-only", lat: 55.69, lng: 13.15 },
    ],
    this_week: [],
  });
  await withServer({ eventSupply: supply }, async (server) => {
    const aroundPlace = await postJson(server, "/api/live-events", {
      scope: "around_place",
      anchor: { lat: 55.605, lng: 13.003 },
    });
    const nearRoute = await postJson(server, "/api/live-events", {
      scope: "near_route",
      route_points: [{ lat: 55.635, lng: 13.055 }, { lat: 55.645, lng: 13.065 }],
    });
    const nearMe = await postJson(server, "/api/live-events", {
      scope: "near_me",
      anchor: { lat: 55.69, lng: 13.15 },
    });
    assert.deepEqual(aroundPlace.body.live_events.tonight.map((event) => event.id), ["place-only"]);
    assert.deepEqual(nearRoute.body.live_events.tonight.map((event) => event.id), ["route-only"]);
    assert.deepEqual(nearMe.body.live_events.tonight.map((event) => event.id), ["me-only"]);
  });
});

test("partial provider failure preserves events and a complete honest source-health contract", async () => {
  const partial = collectedEvents({
    acquisition: {
      mode: "bounded_multi_source",
      source_health: {
        status: "partial",
        result: "events_found",
        selected_source_count: 2,
        responding_source_count: 1,
        event_bearing_source_count: 1,
        failed_source_count: 1,
        accepted_event_count: 2,
        reasons: ["source_failures_present"],
      },
    },
  });
  await withServer({ eventSupply: async () => partial }, async (server) => {
    const response = await postJson(server, "/api/live-events", {
      scope: "around_place",
      anchor: { lat: 55.605, lng: 13.003 },
    });
    const health = response.body.live_events.acquisition.source_health;
    assert.equal(health.status, "partial");
    assert.equal(health.result, "events_found");
    assert.equal(health.failed_source_count, 1);
    assert.equal(health.surfaced_event_count, 2);
    assert.deepEqual(health.reasons, ["source_failures_present"]);
    assertCompleteSourceHealth(health);
    assert.equal(response.body.live_events.tonight.length, 1);
    assert.equal(response.body.live_events.this_week.length, 1);
  });
});

test("cold cache is explicit, then one warm pool reranks preferences without provider refetch", async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-live-query-cache-"));
  let fetchCount = 0;
  const event = (id, title, keyword) => ({
    id,
    name: { en: title },
    start_time: "2026-06-28T18:00:00Z",
    end_time: "2026-06-28T20:00:00Z",
    location: { position: { coordinates: [24.94, 60.17] }, name: { en: `Venue ${id}` } },
    info_url: { en: `https://example.org/${id}` },
    data_source: "fixture",
    keywords: [{ name: { en: keyword } }],
  });
  global.fetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      json: async () => ({
        data: [
          event("a-concert", "Jazz concert", "music"),
          event("z-loppis", "Harbour loppis", "second hand"),
        ],
      }),
    };
  };

  try {
    const eventSupply = resolveDefaultEventSupply({
      PARRANDA_AGNOSTIC_EVENTS: "enabled",
      PARRANDA_EVENT_FEEDS: JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]),
      PARRANDA_CACHE_DIR: cacheDir,
    });
    await withServer({ eventSupply, clock: { now: () => "2026-06-28T12:00:00Z" } }, async (server) => {
      const request = {
        scope: "around_place",
        anchor: { lat: 60.17, lng: 24.94 },
        time: "tonight",
        preferences: ["culture"],
      };
      const cold = await postJson(server, "/api/live-events", request);
      assert.equal(cold.body.live_events.pending, true);
      assert.equal(cold.body.live_events.acquisition.source_health.status, "pending");
      assertCompleteSourceHealth(cold.body.live_events.acquisition.source_health);

      let culture = cold;
      for (let attempt = 0; attempt < 50 && culture.body.live_events.pending; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        culture = await postJson(server, "/api/live-events", request);
      }
      assert.equal(culture.body.live_events.pending, undefined);
      assert.equal(culture.body.live_events.tonight[0].id, "a-concert");

      const secondHand = await postJson(server, "/api/live-events", {
        ...request,
        preferences: ["second_hand"],
      });
      assert.equal(secondHand.body.live_events.tonight[0].id, "z-loppis");
      assert.equal(fetchCount, 1, "preference changes rerank the trusted warm pool without recollection");
    });
  } finally {
    global.fetch = ORIGINAL_FETCH;
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
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
