"use strict";

/**
 * A finished Live refresh in which sources FAILED is an answer, not "still
 * loading". The failed result is never cacheable, and before this contract it
 * was simply discarded: every later read started another warm and answered
 * `pending` again. A failing source therefore looked like an endless refresh
 * in the Planner and the Live sheet. Deterministic fixtures only — these are
 * not provider or Pi acceptance.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { buildApp } = require("../server/app");
const {
  FAILED_REFRESH_HOLD_MS,
  isFailedEventRefresh,
  resolveDefaultEventSupply,
} = require("../server/place-candidates/agnostic-event-supply");

const ORIGINAL_FETCH = global.fetch;
const NOW = "2026-09-24T10:00:00Z";
const SELECTED_DATE = "2026-09-25";
const ANCHOR = { lat: 59.325, lng: 18.071 };

// Same reviewed row shape and adapter as the localized public events API in
// config/reviewed-event-feeds.json, on fixture hosts.
const FEED = Object.freeze({
  id: "fixture-localized-api",
  label: "Fixture calendar",
  adapter: "localized_events_api",
  endpoint: "https://events.example/api/public-v1/events/",
  bbox: [17.6, 59.15, 18.45, 59.6],
  timezone: "Europe/Stockholm",
  source_language: "sv",
  source_tier: "official",
  confidence: "medium",
  source_family: "official_tourism_open_api",
  source_identity: "events.example",
  page_size: 20,
  status: "active",
  runtime_policy: "bounded_refresh",
});
const SECOND_FEED = Object.freeze({
  ...FEED,
  id: "fixture-second-api",
  label: "Second fixture calendar",
  endpoint: "https://second.example/api/public-v1/events/",
  source_identity: "second.example",
});

const EVENT_ROW = Object.freeze({
  id: "fixture-concert",
  title: { sv: "Fixture-konsert" },
  external_website_url: "https://organizer.example/fixture-concert",
  venue_name: "Fixture-scenen",
  address: "Exempelgatan 1, Stockholm",
  location: { latitude: 59.326, longitude: 18.072 },
  start_date: SELECTED_DATE,
  end_date: SELECTED_DATE,
  start_time: "19:00:00",
  end_time: "21:00:00",
  categories: [{ title: "Konsert", slug: "konsert", subcategories: [] }],
});

function supplyEnv(feeds = [FEED]) {
  return { PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_EVENT_FEEDS: JSON.stringify(feeds) };
}

function jsonResponse(url, payload) {
  return { ok: true, status: 200, url: String(url), text: async () => JSON.stringify(payload) };
}

function httpError(url, status) {
  return { ok: false, status, url: String(url), text: async () => "" };
}

// Read until the background refresh has produced an answer (bounded).
async function settle(read, attempts = 60) {
  let out = await read();
  for (let attempt = 0; attempt < attempts && out.pending === true; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    out = await read();
  }
  return out;
}

const request = Object.freeze({
  anchor: ANCHOR,
  now: NOW,
  selectedDate: SELECTED_DATE,
  preferences: ["culture"],
});

test("a failed refresh is answered as a source failure, not as another pending", async (t) => {
  let fetches = 0;
  global.fetch = async (url) => {
    fetches += 1;
    return httpError(url, 403);
  };
  t.after(() => { global.fetch = ORIGINAL_FETCH; });
  const supply = resolveDefaultEventSupply(supplyEnv());

  const cold = await supply(request);
  assert.equal(cold.pending, true, "the first read honestly starts collection");

  const answered = await settle(() => supply(request));
  assert.notEqual(answered.pending, true, "a finished failure must not read as still loading");
  const health = answered.acquisition.source_health;
  assert.equal(health.status, "unavailable");
  assert.equal(health.selected_source_count, 1);
  assert.equal(health.responding_source_count, 0);
  assert.equal(health.failed_source_count, 1);
  assert.ok(health.reasons.includes("all_sources_unavailable"));
  assert.ok(!health.reasons.includes("background_refresh_pending"));
  assert.deepEqual(answered.tonight, []);
  assert.deepEqual(answered.this_week, []);
  assert.equal(answered.selected_date, SELECTED_DATE);
  assert.equal(answered.feeds[0].status, "failed");
  assert.equal(answered.feeds[0].reason, "source_http_403");

  const again = await supply(request);
  assert.notEqual(again.pending, true);
  assert.equal(fetches, 1, "reads during the hold report the failure without refetching");
});

test("after the bounded hold a read retries once and a recovered source replaces the failure", async (t) => {
  let clockMs = 0;
  let failing = true;
  let fetches = 0;
  global.fetch = async (url) => {
    fetches += 1;
    return failing ? httpError(url, 503) : jsonResponse(url, { count: 1, results: [EVENT_ROW] });
  };
  t.after(() => { global.fetch = ORIGINAL_FETCH; });
  const supply = resolveDefaultEventSupply(supplyEnv(), { failedRefreshClock: () => clockMs });

  const failed = await settle(() => supply(request));
  assert.equal(failed.acquisition.source_health.status, "unavailable");
  assert.equal(fetches, 1);

  clockMs += FAILED_REFRESH_HOLD_MS - 1;
  const held = await supply(request);
  assert.equal(held.acquisition.source_health.status, "unavailable", "still inside the hold");
  assert.equal(fetches, 1);

  failing = false;
  clockMs += 1;
  const retry = await supply(request);
  assert.equal(retry.pending, true, "an expired hold is retried, not frozen");
  const recovered = await settle(() => supply(request));
  assert.equal(recovered.acquisition.source_health.status, "healthy");
  assert.deepEqual(recovered.tonight.map((event) => event.id), ["fixture-concert"]);
  assert.equal(fetches, 2, "exactly one provider retry after the hold");

  clockMs += FAILED_REFRESH_HOLD_MS * 10;
  const cached = await supply(request);
  assert.deepEqual(cached.tonight.map((event) => event.id), ["fixture-concert"], "success is not replaced by the old failure");
  assert.equal(fetches, 2);
});

test("a partial refresh with nothing accepted reports which share of sources failed", async (t) => {
  global.fetch = async (url) => (String(url).includes("second.example")
    ? httpError(url, 500)
    : jsonResponse(url, { count: 0, results: [] }));
  t.after(() => { global.fetch = ORIGINAL_FETCH; });
  const supply = resolveDefaultEventSupply(supplyEnv([FEED, SECOND_FEED]));

  const answered = await settle(() => supply(request));
  assert.notEqual(answered.pending, true);
  const health = answered.acquisition.source_health;
  assert.equal(health.status, "partial");
  assert.equal(health.result, "empty", "the responding source answered empty");
  assert.equal(health.selected_source_count, 2);
  assert.equal(health.responding_source_count, 1);
  assert.equal(health.failed_source_count, 1);
  assert.deepEqual(
    answered.feeds.map((feed) => `${feed.id}:${feed.status}`).sort(),
    ["fixture-localized-api:empty", "fixture-second-api:failed"],
  );
});

test("a collection that throws is held as every planned source failed", async () => {
  let collections = 0;
  const supply = resolveDefaultEventSupply(supplyEnv([FEED, SECOND_FEED]), {
    collectEvents: async () => {
      collections += 1;
      throw new Error("adapter bug");
    },
  });

  const answered = await settle(() => supply(request));
  assert.notEqual(answered.pending, true);
  const health = answered.acquisition.source_health;
  assert.equal(health.status, "unavailable");
  assert.equal(health.selected_source_count, 2);
  assert.equal(health.failed_source_count, 2);
  assert.deepEqual(answered.feeds.map((feed) => feed.reason), ["source_collect_failed", "source_collect_failed"]);
  assert.equal(collections, 1);
});

test("a held failure belongs to its own date and anchor only", async (t) => {
  global.fetch = async (url) => httpError(url, 403);
  t.after(() => { global.fetch = ORIGINAL_FETCH; });
  const supply = resolveDefaultEventSupply(supplyEnv());

  await settle(() => supply(request));
  assert.equal((await supply({ ...request, selectedDate: "2026-09-26" })).pending, true);
  assert.equal((await supply({ ...request, anchor: { lat: 59.4, lng: 18.2 } })).pending, true);
});

test("only failed covered refreshes are held; cacheable and uncovered outcomes are not", () => {
  const covered = (status, result) => ({ coverage: "covered", acquisition: { source_health: { status, result } } });
  assert.equal(isFailedEventRefresh(covered("unavailable", "unknown")), true);
  assert.equal(isFailedEventRefresh(covered("partial", "empty")), true);
  assert.equal(isFailedEventRefresh(covered("partial", "events_found")), false, "shown events are cached");
  assert.equal(isFailedEventRefresh(covered("healthy", "empty")), false, "a responding empty calendar is cached");
  assert.equal(isFailedEventRefresh(covered("healthy", "events_found")), false);
  assert.equal(isFailedEventRefresh({ coverage: "uncovered" }), false);
  assert.equal(isFailedEventRefresh({ coverage: "covered" }), false, "no health, no claim");
  assert.equal(isFailedEventRefresh(null), false);
});

function postJson(server, path, body) {
  const payload = JSON.stringify(body);
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    }, (response) => {
      let raw = "";
      response.on("data", (chunk) => (raw += chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(raw) }));
    });
    outgoing.on("error", reject);
    outgoing.write(payload);
    outgoing.end();
  });
}

test("the Live API answers a failed source as failed on the read after the refresh", async (t) => {
  // Only the provider host fails; the local test server itself must stay reachable.
  global.fetch = async (url) => httpError(url, 403);
  t.after(() => { global.fetch = ORIGINAL_FETCH; });
  const eventSupply = resolveDefaultEventSupply(supplyEnv());
  const server = buildApp({ eventSupply, clock: { now: () => NOW } }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const body = {
    scope: "around_place",
    anchor: ANCHOR,
    time: "tonight",
    selected_date: SELECTED_DATE,
    preferences: ["culture"],
  };

  const cold = await postJson(server, "/api/live-events?lang=sv", body);
  assert.equal(cold.body.live_events.pending, true);
  const answered = await settle(async () => (await postJson(server, "/api/live-events?lang=sv", body)).body.live_events);
  assert.equal(answered.pending, undefined);
  assert.equal(answered.coverage, "covered");
  assert.equal(answered.acquisition.source_health.status, "unavailable");
  assert.equal(answered.acquisition.source_health.responding_source_count, 0);
  assert.equal(answered.acquisition.source_health.selected_source_count, 1);
  assert.equal(answered.selected_date, SELECTED_DATE);
});
