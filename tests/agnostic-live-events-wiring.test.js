/**
 * live_events wiring — the agnostic (any-place) route response carries live events
 * near the trusted anchor ADDITIVELY, env-gated + injectable, honest about
 * coverage, and NEVER required (an uncovered anchor still returns a route).
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { buildApp } = require("../server/app");
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
