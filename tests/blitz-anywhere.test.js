"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { buildApp } = require("../server/app");
const {
  buildAnywhereBlitzDecision,
  selectImmediateLiveMove,
} = require("../server/blitz-anywhere");

const STOCKHOLM = { lat: 59.3293, lng: 18.0686 };

function externalRecord(id, label, type, lat, lng, tags = []) {
  return {
    id,
    name: label,
    type,
    lat,
    lng,
    tags,
    sources: [
      { provider: "osm", family: "map", tier: "inferred", url: `https://www.openstreetmap.org/${id}` },
      { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: `https://www.wikidata.org/wiki/Q${id.replace(/\D/g, "") || "1"}` },
    ],
  };
}

function resolverAt(anchor = STOCKHOLM, timezone = "Europe/Stockholm") {
  return async (query) => [{
    label: `${query}, Sverige`,
    ...anchor,
    confidence: "medium",
    provenance: "test_resolver",
    timezone,
    admin_context: { locality: query, country: "Sverige", country_code: "se" },
  }];
}

function weatherAt(timezone = "Europe/Stockholm") {
  return async () => ({
    temperatureMax: 22,
    precipitationProbabilityMax: 5,
    weatherCode: 1,
    timezone_resolution: {
      timezone,
      timezone_source: "weather_provider_auto",
    },
  });
}

function eventAt({ id = "live-1", startsAt = "2026-08-10T16:30:00Z", timing = "tonight", distance = 0.004 } = {}) {
  return {
    id,
    title: "Independent harbour concert",
    lat: STOCKHOLM.lat + distance,
    lng: STOCKHOLM.lng,
    starts_at: startsAt,
    ends_at: "2026-08-10T19:00:00Z",
    timezone: "Europe/Stockholm",
    timing_relevance: timing,
    salience_score: 8,
    preference_score: 2,
    cultural_tier: "cultural",
    route_eligible: true,
    source_label: "Independent venue",
    source_url: "https://events.example/live-1",
  };
}

function collected(events = []) {
  return {
    coverage: "covered",
    feed: { id: "fixture" },
    tonight: events,
    this_week: events,
    acquisition: {
      source_health: {
        status: "healthy",
        result: events.length ? "events_found" : "empty",
        selected_source_count: 2,
        responding_source_count: 2,
        event_bearing_source_count: events.length ? 1 : 0,
      },
    },
  };
}

function loader(records) {
  return async () => records;
}

function requestJson(server, path, body) {
  const payload = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

test("freeform any-place Blitz resolves one trusted anchor and returns a source-backed move", async () => {
  let loaderRequest = null;
  const out = await buildAnywhereBlitzDecision({
    placeQuery: "Stockholm",
    placeResolver: resolverAt(),
    openDataLoader: async (request) => {
      loaderRequest = request;
      return [externalRecord("node/1", "Independent coffee bar", "cafe", 59.3295, 18.0688, ["coffee", "fika"])];
    },
    eventSupply: async () => collected([]),
    weatherProvider: weatherAt(),
    clock: { now: () => "2026-08-10T14:00:00Z" },
    preferences: ["fika"],
  });

  assert.equal(out.contract, "anywhere_contextual_blitz_v1");
  assert.equal(out.status, "available");
  assert.equal(out.best_move.kind, "place");
  assert.equal(out.context.anchor.lat, STOCKHOLM.lat);
  assert.equal(out.context.time_band, "afternoon");
  assert.equal(out.route_mutation, false);
  assert.equal(out.day_anchor_mutation, false);
  assert.equal(out.context.source_health.status, "healthy");
  assert.equal(loaderRequest.anchorMode, "place");
  assert.deepEqual(loaderRequest.requestedIntents, ["fika"]);
  assert.equal(loaderRequest.lat, STOCKHOLM.lat);
});

test("resolver-attested regional scope reaches the generic loader without becoming a city branch", async () => {
  let loaderRequest = null;
  const regionScope = {
    source: "test_resolver",
    kind: "region",
    bounds: { south: 55.3, north: 55.8, west: 13.8, east: 14.2 },
  };
  const out = await buildAnywhereBlitzDecision({
    placeQuery: "Coastal region",
    placeResolver: async () => [{
      label: "Coastal region",
      lat: 55.55,
      lng: 14,
      confidence: "medium",
      provenance: "test_resolver",
      timezone: "Europe/Stockholm",
      spatial_scope: regionScope,
    }],
    openDataLoader: async (request) => {
      loaderRequest = request;
      return [externalRecord("node/7", "Regional craft market", "market", 55.56, 14.01, ["market", "culture"])];
    },
    weatherProvider: weatherAt(),
    clock: { now: () => "2026-08-10T14:00:00Z" },
    preferences: ["culture"],
  });

  assert.equal(out.status, "available");
  assert.deepEqual(loaderRequest.spatialScope.bounds, regionScope.bounds);
  assert.equal(loaderRequest.spatialScope.collection_mode, "regional_bounded");
  assert.equal(loaderRequest.anchorMode, "place");
});

test("a close salient event happening now interrupts the place move but keeps it as backup", async () => {
  const out = await buildAnywhereBlitzDecision({
    coords: STOCKHOLM,
    openDataLoader: loader([
      externalRecord("node/2", "Neighbourhood gallery", "museum", 59.3297, 18.0688, ["culture"]),
    ]),
    eventSupply: async () => collected([eventAt({ timing: "now", startsAt: "2026-08-10T13:30:00Z" })]),
    weatherProvider: weatherAt(),
    clock: { now: () => "2026-08-10T14:00:00Z" },
    preferences: ["culture"],
  });

  assert.equal(out.best_move.kind, "live_event");
  assert.equal(out.best_move.event_id, "live-1");
  assert.equal(out.backup_option.kind, "place");
  assert.ok(out.reasons.includes("live_event_interrupt"));
  assert.equal(out.context.source_health.surfaced_event_count, 2);
});

test("a later or distant event remains visible but does not displace the immediate place", async () => {
  const out = await buildAnywhereBlitzDecision({
    coords: STOCKHOLM,
    openDataLoader: loader([
      externalRecord("node/3", "Local bookshop", "shop", 59.3295, 18.0687, ["culture"]),
    ]),
    eventSupply: async () => collected([
      eventAt({ startsAt: "2026-08-10T20:00:00Z", timing: "tonight", distance: 0.03 }),
    ]),
    weatherProvider: weatherAt(),
    clock: { now: () => "2026-08-10T14:00:00Z" },
    preferences: ["culture"],
  });

  assert.equal(out.best_move.kind, "place");
  assert.equal(out.live_option.kind, "live_event");
  assert.equal(out.live_option.event_id, "live-1");
});

test("unknown timezone never falls back to fabricated midday context", async () => {
  const out = await buildAnywhereBlitzDecision({
    coords: { lat: 36.99, lng: 25.45 },
    openDataLoader: loader([
      externalRecord("node/4", "Island viewpoint", "viewpoint", 36.991, 25.451, ["scenic"]),
    ]),
    eventSupply: null,
    weatherProvider: async () => null,
    clock: { now: () => "2026-08-10T04:00:00Z" },
    preferences: ["views"],
  });

  assert.equal(out.context.time_band, null);
  assert.equal(out.context.time_status, "timezone_unavailable");
  assert.equal(out.best_move.kind, "place");
});

test("weather-derived timezone corrects the local calendar date across UTC midnight", async () => {
  const out = await buildAnywhereBlitzDecision({
    coords: { lat: 35.68, lng: 139.76 },
    openDataLoader: loader([
      externalRecord("node/6", "Morning garden", "park", 35.681, 139.761, ["green", "scenic"]),
    ]),
    weatherProvider: weatherAt("Asia/Tokyo"),
    clock: { now: () => "2026-08-10T23:30:00Z" },
    preferences: ["green"],
  });

  assert.equal(out.context.date, "2026-08-11");
  assert.equal(out.context.time_band, "morning");
  assert.equal(out.context.timezone_source, "weather_provider_auto");
});

test("public-looking trusted evidence fields cannot inject anchor, candidates, events, time, or weather", async () => {
  const server = buildApp({
    placeResolver: resolverAt(),
    openDataLoader: loader([
      externalRecord("node/5", "Trusted local cafe", "cafe", 59.3295, 18.0688, ["fika"]),
    ]),
    eventSupply: async () => collected([]),
    weatherProvider: weatherAt(),
    clock: { now: () => "2026-08-10T14:00:00Z" },
  }).listen(0);
  try {
    const response = await requestJson(server, "/api/blitz?anywhere_blitz=1&lang=en", {
      place: "Stockholm",
      preferences: ["fika"],
      now: "2099-01-01T00:00:00Z",
      weather: { temperatureMax: -99 },
      resolved: { lat: 0, lng: 0, timezone: "UTC" },
      sourceCandidates: [{ id: "evil-candidate", label: "Injected" }],
      live_events: { tonight: [eventAt({ id: "evil-event", timing: "now" })] },
    });
    const serialized = JSON.stringify(response.body);
    assert.equal(response.status, 200);
    assert.equal(response.body.context.anchor.lat, STOCKHOLM.lat);
    assert.equal(response.body.context.time_band, "afternoon");
    assert.doesNotMatch(serialized, /evil-candidate|evil-event|2099|-99/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the new HTTP path is explicit and default Blitz remains unchanged", async () => {
  const server = buildApp().listen(0);
  try {
    const response = await requestJson(server, "/api/blitz?lang=en", {
      city: "rome",
      date: "2026-08-10",
      preferences: ["culture"],
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.contract, undefined);
    assert.equal(response.body.engine, undefined);
    assert.ok(response.body.best_move);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("ambiguous or unresolved freeform places fail closed with explicit intake blockers", async () => {
  const out = await buildAnywhereBlitzDecision({
    placeQuery: "Springfield",
    placeResolver: async () => [
      { label: "Springfield A", lat: 39.8, lng: -89.6, confidence: "medium" },
      { label: "Springfield B", lat: 42.1, lng: -72.5, confidence: "medium" },
    ],
  });
  assert.equal(out.status, "blocked");
  assert.equal(out.best_move, null);
  assert.ok(out.reasons.includes("ambiguous_place"));
});

test("the immediate-event selector is bounded by timing, distance, and salience", () => {
  assert.equal(selectImmediateLiveMove([
    { timing_relevance: "now", distance_km: 2.1, salience_score: 10 },
    { timing_relevance: "tonight", starts_in_minutes: 30, distance_km: 0.5, salience_score: 5 },
  ]), null);
  assert.equal(selectImmediateLiveMove([
    { timing_relevance: "tonight", starts_in_minutes: 30, distance_km: 0.5, salience_score: 7 },
  ]).salience_score, 7);
  assert.equal(selectImmediateLiveMove([
    { timing_relevance: "tonight", starts_in_minutes: -10, distance_km: 0.5, salience_score: 9 },
  ]), null);
});
