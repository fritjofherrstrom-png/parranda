"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AROUND_PLACE_RADIUS_M,
  MAX_ROUTE_POINTS,
  NEAR_ME_RADIUS_M,
  NEARBY_SETTLEMENT_RADIUS_M,
  ROUTE_CORRIDOR_RADIUS_M,
  eventMatchesLiveScope,
  filterEventsForLiveScope,
  normalizeLiveEventQuery,
  shapeCollectedLiveEvents,
  unavailableLiveEvents,
} = require("../server/place-candidates/live-event-query");

test("around_place and near_me normalize into bounded event-only scopes", () => {
  const around = normalizeLiveEventQuery({
    scope: "around_place",
    anchor: { lat: "55.605", lng: "13.003" },
    time: "this_week",
    preferences: ["culture", "culture", "nightlife", 42],
  });
  assert.equal(around.error, undefined);
  assert.equal(around.value.collection_radius_m, AROUND_PLACE_RADIUS_M);
  assert.deepEqual(around.value.preferences, ["culture", "nightlife"]);
  assert.deepEqual(around.public, {
    scope: "around_place",
    time: "this_week",
    radius_m: AROUND_PLACE_RADIUS_M,
    route_point_count: 0,
    preferences: ["culture", "nightlife"],
  });

  const nearMe = normalizeLiveEventQuery({ scope: "near_me", lat: 55.605, lng: 13.003 });
  assert.equal(nearMe.value.collection_radius_m, NEAR_ME_RADIUS_M);
  assert.equal(nearMe.value.scope.kind, "near_me");
});

test("near_route is a bounded corridor, not an arbitrary radial place query", () => {
  const normalized = normalizeLiveEventQuery({
    scope: "near_route",
    time: "tonight",
    route_points: [
      { lat: 55.60, lng: 13.00 },
      { lat: 55.61, lng: 13.02 },
      { lat: 55.62, lng: 13.04 },
    ],
  });
  assert.equal(normalized.error, undefined);
  assert.equal(normalized.value.scope.radius_m, ROUTE_CORRIDOR_RADIUS_M);
  assert.equal(normalized.value.source_anchors.length, 3);
  assert.ok(normalized.value.collection_radius_m > ROUTE_CORRIDOR_RADIUS_M);
  assert.ok(normalized.value.collection_radius_m <= 10000);
  assert.equal(eventMatchesLiveScope({ lat: 55.605, lng: 13.01 }, normalized.value.scope), true);
  assert.equal(eventMatchesLiveScope({ lat: 55.68, lng: 13.15 }, normalized.value.scope), false);
});

test("near_route remains bounded across the international date line", () => {
  const normalized = normalizeLiveEventQuery({
    scope: "near_route",
    route_points: [
      { lat: -16.5, lng: 179.98 },
      { lat: -16.5, lng: -179.98 },
    ],
  });
  assert.equal(normalized.error, undefined);
  assert.ok(Math.abs(normalized.value.collection_anchor.lng) > 179, "spherical center stays at the date line");
  assert.ok(normalized.value.collection_radius_m < 10000);
  assert.equal(eventMatchesLiveScope({ lat: -16.5, lng: 180 }, normalized.value.scope), true);
});

test("invalid, oversized and over-wide public scopes fail closed", () => {
  assert.equal(normalizeLiveEventQuery({ scope: "everywhere", lat: 1, lng: 2 }).error, "invalid_live_event_scope");
  assert.equal(normalizeLiveEventQuery({ scope: "near_me", lat: 95, lng: 2 }).error, "invalid_live_event_anchor");
  assert.equal(normalizeLiveEventQuery({ scope: "near_me", lat: "", lng: "" }).error, "invalid_live_event_anchor");
  assert.equal(normalizeLiveEventQuery({ scope: "near_route", route_points: [{ lat: 1, lng: 2 }] }).error, "near_route_requires_route_points");
  assert.equal(
    normalizeLiveEventQuery({
      scope: "near_route",
      route_points: Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_, index) => ({ lat: 55.6, lng: 13 + index / 1000 })),
    }).error,
    "too_many_route_points",
  );
  assert.equal(
    normalizeLiveEventQuery({
      scope: "near_route",
      route_points: [{ lat: 55.6, lng: 13 }, { lat: 56, lng: 14 }],
    }).error,
    "route_scope_too_large",
  );
});

test("public preferences are deduplicated and bounded without truncating arbitrary tokens", () => {
  const normalized = normalizeLiveEventQuery({
    scope: "around_place",
    lat: 55.6,
    lng: 13,
    preferences: ["culture", "culture", "x".repeat(65), ...Array.from({ length: 20 }, (_, index) => `intent-${index}`)],
  });
  assert.equal(normalized.error, undefined);
  assert.equal(normalized.value.preferences.length, 12);
  assert.equal(normalized.value.preferences[0], "culture");
  assert.equal(normalized.value.preferences.includes("x".repeat(65)), false);
});

test("shared live-event shaping preserves health, hides internal pools and applies scope defensively", () => {
  const scope = {
    kind: "around_place",
    anchor: { lat: 55.605, lng: 13.003 },
    radius_m: AROUND_PLACE_RADIUS_M,
  };
  const collected = {
    coverage: "covered",
    feed: { id: "municipal" },
    feeds: [{ id: "municipal", status: "ok" }],
    acquisition: { source_health: { status: "partial", result: "events_found" } },
    tonight: [
      { id: "near", lat: 55.606, lng: 13.004 },
      { id: "far", lat: 55.7, lng: 13.2 },
    ],
    this_week: [],
    browse: {
      contract: "live_event_browse_v1",
      max_rows_per_bucket: 24,
      tonight: {
        ranked_event_count: 4,
        highlight_count: 2,
        more_count: 2,
        hidden_count: 0,
        more: [
          { id: "browse-near", lat: 55.607, lng: 13.005 },
          { id: "browse-far", lat: 55.7, lng: 13.2 },
        ],
      },
      this_week: { ranked_event_count: 0, highlight_count: 0, more_count: 0, hidden_count: 0, more: [] },
    },
    _rankable_events: { tonight: [{ id: "internal" }], this_week: [] },
  };
  const shaped = shapeCollectedLiveEvents(collected, { scope });
  assert.deepEqual(shaped.tonight.map((event) => event.id), ["near"]);
  assert.deepEqual(shaped.browse.tonight.more.map((event) => event.id), ["browse-near"]);
  assert.equal(shaped.browse.tonight.more_count, 1);
  assert.equal(shaped.browse.tonight.hidden_count, 1, "scope-filtered rows remain honestly counted as hidden");
  assert.equal(shaped.acquisition.source_health.status, "partial");
  assert.equal(shaped.acquisition.source_health.surfaced_event_count, 1);
  assert.equal("_rankable_events" in shaped, false);
});

test("Live preserves every compact source-discovery state instead of collapsing to no sources", () => {
  const statuses = [
    "pending",
    "observing",
    "review_required",
    "healthy_empty",
    "search_failed",
    "environment_not_wired",
    "unavailable",
  ];

  for (const status of statuses) {
    const shaped = shapeCollectedLiveEvents({
      coverage: "uncovered",
      tonight: [],
      this_week: [],
      acquisition: {
        source_health: { status: "unavailable", reasons: ["no_approved_sources"] },
        discovery_health: {
          contract: "source_discovery_health_v1",
          status,
          search: { status: status === "search_failed" ? "failed" : "not_configured" },
          scout: { status: "not_run" },
          qualification: { status: "not_run" },
          reasons: [`source_discovery_${status}`],
          raw_endpoint: "https://secret.invalid/search",
        },
      },
    });

    assert.equal(shaped.acquisition.discovery_health.status, status);
    assert.equal(shaped.acquisition.discovery_health.raw_endpoint, undefined);
  }
});

test("source-scoped Pulse evidence is only eligible around the resolved place", () => {
  const event = {
    id: "source-scoped",
    lat: null,
    lng: null,
    geographic_relevance: "source_scope",
    source_scope_verified: true,
    route_eligible: false,
  };
  assert.equal(eventMatchesLiveScope(event, { kind: "around_place", radius_m: 3000 }), true);
  assert.equal(eventMatchesLiveScope(event, {
    kind: "near_me",
    anchor: { lat: 55.6, lng: 13 },
    radius_m: 2000,
  }), false);
  assert.equal(eventMatchesLiveScope(event, {
    kind: "near_route",
    points: [{ lat: 55.6, lng: 13 }, { lat: 55.61, lng: 13.01 }],
    radius_m: 1200,
  }), false);
});

test("a trusted nearby fallback is local-first and labels distance only when local is empty", () => {
  const scope = {
    kind: "around_place",
    anchor: { lat: 55.685, lng: 14.225 },
    radius_m: AROUND_PLACE_RADIUS_M,
    trusted_nearby_fallback_m: NEARBY_SETTLEMENT_RADIUS_M,
  };
  const local = { id: "local", lat: 55.69, lng: 14.23 };
  const regional = { id: "regional", lat: 55.5566, lng: 14.35 };
  const localFirst = filterEventsForLiveScope([local, regional], scope);
  assert.deepEqual(localFirst.map((event) => event.id), ["local"]);

  const fallback = filterEventsForLiveScope([regional], scope);
  assert.equal(fallback[0].id, "regional");
  assert.equal(fallback[0].live_proximity, "nearby");
  assert.ok(fallback[0].anchor_distance_km > 10);

  const unlocatedRegional = {
    id: "source-scoped-only",
    geographic_relevance: "source_scope",
    source_scope_verified: true,
  };
  assert.deepEqual(
    filterEventsForLiveScope([unlocatedRegional], scope),
    [],
    "a regional fallback cannot claim nearby without coordinates and a measurable distance",
  );
});

test("unavailable source health uses compact allowlisted reasons", () => {
  const disabled = unavailableLiveEvents("event_supply_not_configured");
  assert.equal(disabled.coverage, "unavailable");
  assert.equal(disabled.browse.contract, "live_event_browse_v1");
  assert.deepEqual(disabled.browse.tonight.more, []);
  assert.equal(disabled.acquisition.source_health.status, "unavailable");
  assert.deepEqual(disabled.acquisition.source_health.reasons, ["event_supply_not_configured"]);
  const unknown = unavailableLiveEvents("https://secret.example/token=abc", "failed");
  assert.deepEqual(unknown.acquisition.source_health.reasons, ["event_supply_failed"]);
});
