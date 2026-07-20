import test from "node:test";
import assert from "node:assert/strict";

import {
  acceptedLiveEventQuery,
  boundedRoutePoints,
  buildLiveEventQueryPayload,
  trustedDayAnchor,
} from "../src/lib/live-event-query.mjs";

const response = {
  agnostic_route_output_experiment: {
    source_status: { anchor: { lat: 55.605, lng: 13.003 } },
    intake: { resolved: { lat: 1, lng: 2 } },
  },
};

test("around_place uses the trusted server anchor and preserves preferences", () => {
  assert.deepEqual(trustedDayAnchor(response), { lat: 55.605, lng: 13.003 });
  assert.deepEqual(
    buildLiveEventQueryPayload({
      scope: "around_place",
      time: "this_week",
      preferences: ["culture", "culture", "nightlife"],
      response,
    }),
    {
      scope: "around_place",
      time: "this_week",
      preferences: ["culture", "nightlife"],
      anchor: { lat: 55.605, lng: 13.003 },
    },
  );
});

test("near_route carries only bounded primary-route geometry", () => {
  const stops = Array.from({ length: 30 }, (_, index) => ({
    id: `s${index}`,
    lat: 55.6 + index * 0.001,
    lng: 13 + index * 0.001,
  }));
  const routePoints = boundedRoutePoints(stops);
  assert.equal(routePoints.length, 24);
  assert.deepEqual(routePoints[0], { lat: stops[0].lat, lng: stops[0].lng });
  assert.deepEqual(routePoints.at(-1), { lat: stops.at(-1).lat, lng: stops.at(-1).lng });

  const payload = buildLiveEventQueryPayload({ scope: "near_route", routeStops: stops });
  assert.equal(payload.route_points.length, 24);
  assert.equal("anchor" in payload, false);
  assert.equal(buildLiveEventQueryPayload({ scope: "near_route", routeStops: [stops[0]] }), null);
});

test("near_me accepts only separately supplied coordinates and does not mutate the day response", () => {
  const before = structuredClone(response);
  assert.equal(buildLiveEventQueryPayload({ scope: "near_me", response }), null);
  assert.deepEqual(
    buildLiveEventQueryPayload({
      scope: "near_me",
      response,
      nearMeCoords: { lat: "55.61", lng: "13.01" },
      preferences: ["market"],
    }),
    {
      scope: "near_me",
      time: "tonight",
      preferences: ["market"],
      anchor: { lat: 55.61, lng: 13.01 },
    },
  );
  assert.deepEqual(response, before, "building a Live query never changes the Planner response");
});

test("only the explicit non-mutating response contract is accepted", () => {
  const liveEvents = {
    tonight: [{ id: "event" }],
    this_week: [],
    acquisition: {
      source_health: {
        status: "healthy",
        result: "events_found",
        reasons: [],
        selected_source_count: 1,
        responding_source_count: 1,
        event_bearing_source_count: 1,
        empty_source_count: 0,
        failed_source_count: 0,
        unavailable_source_count: 0,
        raw_event_count: 1,
        normalized_event_count: 1,
        accepted_event_count: 1,
        surfaced_event_count: 1,
        rejected_event_count: 0,
      },
    },
  };
  assert.equal(
    acceptedLiveEventQuery({
      contract: "live_event_query_v1",
      route_mutation: false,
      day_anchor_mutation: false,
      live_events: liveEvents,
    }),
    liveEvents,
  );
  assert.equal(acceptedLiveEventQuery({ contract: "other", route_mutation: false, day_anchor_mutation: false, live_events: liveEvents }), null);
  assert.equal(acceptedLiveEventQuery({ contract: "live_event_query_v1", route_mutation: true, day_anchor_mutation: false, live_events: liveEvents }), null);
  assert.equal(acceptedLiveEventQuery({ contract: "live_event_query_v1", route_mutation: false, day_anchor_mutation: true, live_events: liveEvents }), null);
  assert.equal(
    acceptedLiveEventQuery({
      contract: "live_event_query_v1",
      route_mutation: false,
      day_anchor_mutation: false,
      live_events: { tonight: [], this_week: [], acquisition: { source_health: { status: "healthy" } } },
    }),
    null,
    "an incomplete source-health summary is not the v1 contract",
  );
});
