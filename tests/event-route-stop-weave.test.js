"use strict";

/**
 * Events as WALKING-VALIDATED route stops — the evening anchor becomes the
 * day's real last stop only when every honesty gate passes: agnostic day only,
 * walking re-validated in supplied order, short evening hop, truthful geometry
 * (a loop's closing leg is replaced — the evening ends at the event). Every
 * failed gate returns the inputs unchanged by reference.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { weaveEveningEventRouteStop, MAX_EVENT_LEG_KM } = require("../server/candidates/event-route-stop-weave");

// ~0.9 km east of stop C (at 41.9,12.51): a genuine evening hop.
const NEAR_EVENT = {
  id: "ev-tonight",
  title: "Jazz på kajen",
  starts_at: "2026-07-12T19:00:00Z",
  ends_at: "2026-07-12T21:00:00Z",
  starts_on: "2026-07-12",
  ends_on: "2026-07-12",
  occurrence_date: "2026-07-12",
  time_window: {
    kind: "daily",
    starts_on: "2026-07-01",
    ends_on: "2026-07-31",
    local_start: "21:00",
    local_end: "23:00",
    timezone: "Europe/Stockholm",
  },
  timezone: "Europe/Stockholm",
  source_label: "Open feed",
  source_url: "https://example.org/ev-tonight",
  license: "CC-BY 4.0",
  lat: 41.9,
  lng: 12.521,
};

function loopRoute() {
  return {
    route_shape: "loop",
    start_label: "Nearby",
    end_label: "Nearby",
    estimated_km: 4.3,
    longest_leg_km: 1.9,
    average_leg_minutes: 13,
    daypart_arc: ["midday", "midday", "afternoon"],
    main_stops: [
      { id: "a", label: "A", lat: 41.905, lng: 12.49, daypart: "midday" },
      { id: "b", label: "B", lat: 41.9, lng: 12.5, daypart: "midday" },
      { id: "c", label: "C", lat: 41.9, lng: 12.51, daypart: "afternoon" },
    ],
    legs: [
      { from_label: "Nearby", to_label: "A", distance_km: 0.2, estimated_walk_minutes: 2 },
      { from_label: "A", to_label: "B", distance_km: 1.9, estimated_walk_minutes: 23 },
      { from_label: "B", to_label: "C", distance_km: 1.1, estimated_walk_minutes: 13 },
      { from_label: "C", to_label: "Nearby", distance_km: 1.1, estimated_walk_minutes: 13 },
    ],
    map_path_points: [
      { lat: 41.904, lng: 12.489 },
      { lat: 41.905, lng: 12.49 },
      { lat: 41.9, lng: 12.5 },
      { lat: 41.9, lng: 12.51 },
      { lat: 41.904, lng: 12.489 },
    ],
    map_route_points: [
      { label: "Nearby", lat: 41.904, lng: 12.489, role: "start" },
      { label: "A", lat: 41.905, lng: 12.49, role: "first-stop" },
      { label: "B", lat: 41.9, lng: 12.5, role: "stop" },
      { label: "C", lat: 41.9, lng: 12.51, role: "stop" },
      { label: "Nearby", lat: 41.904, lng: 12.489, role: "end" },
    ],
  };
}

function agnosticResult(route = loopRoute()) {
  return { days: [{ date: "2026-07-12", experimental_agnostic_route_applied: true, primary_route: route }] };
}

function structureWith(event) {
  return {
    provenance: "agnostic_anchor",
    district_day: { areas: [], evening_event: event },
  };
}

test("a walkable evening event becomes the route's real last stop with truthful geometry", async () => {
  const result = agnosticResult();
  const placeStructure = structureWith(NEAR_EVENT);
  const woven = await weaveEveningEventRouteStop({ result, placeStructure });

  assert.equal(woven.applied, true, `blockers: ${woven.blockers}`);
  assert.equal(woven.interrupt.contract, "pulse_route_interrupt_v1");
  assert.equal(woven.interrupt.status, "applied");
  assert.equal(woven.interrupt.route_mutation, true);
  assert.equal(woven.interrupt.requires_user_action, false);
  const route = woven.result.days[0].primary_route;

  // The event is the LAST stop, marked, sourced, timed — never a stable place.
  const last = route.main_stops[route.main_stops.length - 1];
  assert.equal(route.main_stops.length, 4);
  assert.equal(last.is_live_event, true);
  assert.equal(last.event_id, "ev-tonight");
  assert.equal(last.daypart, "evening");
  assert.equal(last.starts_at, NEAR_EVENT.starts_at);
  assert.equal(last.starts_on, "2026-07-12");
  assert.equal(last.occurrence_date, "2026-07-12");
  assert.deepEqual(last.time_window, NEAR_EVENT.time_window);
  assert.equal(last.timezone, "Europe/Stockholm");
  assert.equal(last.source.url, NEAR_EVENT.source_url);

  // Order preserved: the existing stops are an identical prefix.
  assert.deepEqual(route.main_stops.slice(0, 3).map((s) => s.id), ["a", "b", "c"]);

  // The evening ends at the event: the closing anchor leg is REPLACED by a
  // measured stop→event leg, the loop opens, the line ends at the event.
  const lastLeg = route.legs[route.legs.length - 1];
  assert.equal(lastLeg.from_label, "C");
  assert.equal(lastLeg.to_label, "Jazz på kajen");
  assert.ok(Number.isFinite(lastLeg.distance_km) && lastLeg.distance_km > 0 && lastLeg.distance_km <= MAX_EVENT_LEG_KM);
  assert.ok(!route.legs.some((l) => l.to_label === "Nearby"), "the closing walk back to start is no longer claimed");
  assert.equal(route.route_shape, "open");
  const lastPathPoint = route.map_path_points[route.map_path_points.length - 1];
  assert.deepEqual(lastPathPoint, { lat: NEAR_EVENT.lat, lng: NEAR_EVENT.lng });
  const lastRoutePoint = route.map_route_points[route.map_route_points.length - 1];
  assert.equal(lastRoutePoint.role, "evening_event");

  // Walking truth recomputed from the FINAL legs (not fabricated).
  const legSum = route.legs.reduce((s, l) => s + l.distance_km, 0);
  assert.ok(Math.abs(route.estimated_km - legSum) < 0.11, `estimated_km ${route.estimated_km} ≈ leg sum ${legSum}`);
  assert.equal(route.daypart_arc[route.daypart_arc.length - 1], "evening");
  assert.equal(route.live_event_stop.event_id, "ev-tonight");

  // The anchor card and the route now AGREE.
  assert.equal(woven.placeStructure.district_day.evening_event.woven_into_route, true);
  assert.ok(Number.isFinite(woven.placeStructure.district_day.evening_event.route_leg_km));

  // Inputs untouched (clone-on-apply).
  assert.equal(result.days[0].primary_route.main_stops.length, 3);
  assert.ok(!placeStructure.district_day.evening_event.woven_into_route);
});

test("an event beyond the evening-hop bound stays an anchor — route unchanged by reference", async () => {
  const result = agnosticResult();
  // ~3 km east of C: a valid walk by the router's general budget, but NOT an
  // honest evening hop — the tighter event gate must refuse it.
  const far = { ...NEAR_EVENT, lat: 41.9, lng: 12.546 };
  const placeStructure = structureWith(far);
  const woven = await weaveEveningEventRouteStop({ result, placeStructure });
  assert.equal(woven.applied, false);
  assert.ok(woven.blockers.includes("event_leg_too_long"), `blockers: ${woven.blockers}`);
  assert.equal(woven.result, result, "unchanged input returned by reference");
  assert.equal(woven.placeStructure, placeStructure);
  assert.equal(woven.interrupt.status, "suggested");
  assert.equal(woven.interrupt.route_mutation, false);
  assert.equal(woven.interrupt.route_anchor_unchanged, true);
  assert.equal(woven.interrupt.requires_user_action, true);
  assert.equal(woven.interrupt.action, "consider_recomposing_around_event");
  assert.ok(woven.interrupt.walking_impact.leg_km > MAX_EVENT_LEG_KM);
  assert.equal(woven.interrupt.event.source_url, NEAR_EVENT.source_url);
});

test("an event the walking validator itself refuses (over leg budget) also stays an anchor", async () => {
  const result = agnosticResult();
  const veryFar = { ...NEAR_EVENT, lat: 41.9, lng: 12.58 }; // ~5.8 km crow-flies east of C
  const woven = await weaveEveningEventRouteStop({ result, placeStructure: structureWith(veryFar) });
  assert.equal(woven.applied, false);
  assert.ok(woven.blockers.includes("walking_validation_failed"), `blockers: ${woven.blockers}`);
  assert.equal(woven.result, result);
  assert.equal(woven.interrupt, undefined, "unvalidated geometry never becomes a route suggestion");
});

test("a non-agnostic (fallback) day NEVER receives the typed place's event", async () => {
  const result = { days: [{ date: "2026-07-12", primary_route: loopRoute() }] }; // no agnostic markers
  const woven = await weaveEveningEventRouteStop({ result, placeStructure: structureWith(NEAR_EVENT) });
  assert.equal(woven.applied, false);
  assert.ok(woven.blockers.includes("day_not_agnostic"));
  assert.equal(woven.result, result);
});

test("a selected-day occurrence cannot be woven into a different route date", async () => {
  const event = { ...NEAR_EVENT, occurrence_date: "2026-07-13" };
  const woven = await weaveEveningEventRouteStop({
    result: agnosticResult(),
    placeStructure: structureWith(event),
  });
  assert.equal(woven.applied, false);
  assert.ok(woven.blockers.includes("event_date_mismatch"));
});

test("no geocoded evening event, coordless stops, or missing route → unchanged", async () => {
  const noEvent = await weaveEveningEventRouteStop({ result: agnosticResult(), placeStructure: structureWith(null) });
  assert.equal(noEvent.applied, false);

  const coordless = loopRoute();
  coordless.main_stops[1] = { id: "b", label: "B" };
  const partial = await weaveEveningEventRouteStop({
    result: agnosticResult(coordless),
    placeStructure: structureWith(NEAR_EVENT),
  });
  assert.equal(partial.applied, false);
  assert.ok(partial.blockers.includes("route_stops_incomplete"));

  const noRoute = await weaveEveningEventRouteStop({
    result: { days: [{ experimental_agnostic_day: true, primary_route: null }] },
    placeStructure: structureWith(NEAR_EVENT),
  });
  assert.equal(noRoute.applied, false);
});

test("the same event already in the route is not woven twice", async () => {
  const route = loopRoute();
  route.main_stops.push({ id: "live-event-ev-tonight", label: "Jazz på kajen", lat: 41.9, lng: 12.521, event_id: "ev-tonight", is_live_event: true });
  const woven = await weaveEveningEventRouteStop({
    result: agnosticResult(route),
    placeStructure: structureWith(NEAR_EVENT),
  });
  assert.equal(woven.applied, false);
  assert.ok(woven.blockers.includes("event_already_in_route"));
});

// ---------------------------------------------------------------------------
// The requested walking target. The weave is an automatic extension nobody
// asked for, so it may not carry the published day past the requested band.
// ---------------------------------------------------------------------------

// ~2.4 km (heuristic) east of stop C: inside the evening-hop limit.
const EDGE_EVENT = { ...NEAR_EVENT, lng: 12.5335 };

// A 6.8 km open day that ends at C: no closing leg for the event to replace.
function openRoute() {
  return {
    route_shape: "open",
    estimated_km: 6.8,
    main_stops: [
      { id: "a", label: "A", lat: 41.905, lng: 12.45, daypart: "midday" },
      { id: "b", label: "B", lat: 41.9, lng: 12.48, daypart: "midday" },
      { id: "c", label: "C", lat: 41.9, lng: 12.51, daypart: "afternoon" },
    ],
    legs: [
      { from_label: "Nearby", to_label: "A", distance_km: 0.7, estimated_walk_minutes: 8 },
      { from_label: "A", to_label: "B", distance_km: 3.1, estimated_walk_minutes: 37 },
      { from_label: "B", to_label: "C", distance_km: 3.0, estimated_walk_minutes: 36 },
    ],
  };
}

// A 6.8 km loop whose 3.4 km walk back to the start the event replaces.
function longLoopRoute() {
  const route = loopRoute();
  route.estimated_km = 6.8;
  route.legs = [
    { from_label: "Nearby", to_label: "A", distance_km: 0.3, estimated_walk_minutes: 4 },
    { from_label: "A", to_label: "B", distance_km: 1.9, estimated_walk_minutes: 23 },
    { from_label: "B", to_label: "C", distance_km: 1.2, estimated_walk_minutes: 14 },
    { from_label: "C", to_label: "Nearby", distance_km: 3.4, estimated_walk_minutes: 41 },
  ];
  return route;
}

test("an event that would carry the day past the requested walking band stays a suggestion", async () => {
  const result = agnosticResult(openRoute());
  const placeStructure = structureWith(EDGE_EVENT);
  const woven = await weaveEveningEventRouteStop({ result, placeStructure, walkingKmTarget: 6 });

  // 6.8 + 2.4 = 9.2 km against a "~6 km" request: the band's ceiling is 7.08.
  assert.equal(woven.applied, false);
  assert.deepEqual(woven.blockers, ["event_exceeds_walking_target"]);
  assert.equal(woven.result, result, "the route is returned unchanged, by reference");
  assert.equal(woven.placeStructure, placeStructure, "the anchor card stays, without a walk claim");

  // The event is still offered, with what taking it would cost.
  const interrupt = woven.interrupt;
  assert.equal(interrupt.status, "suggested");
  assert.equal(interrupt.route_mutation, false);
  assert.equal(interrupt.requires_user_action, true);
  assert.deepEqual(interrupt.reasons, ["exceeds_requested_walking_target"]);
  assert.equal(interrupt.walking_impact.leg_km, 2.4);
  assert.equal(interrupt.walking_impact.base_estimated_km, 6.8);
  assert.equal(interrupt.walking_impact.removed_closing_leg_km, 0);
  assert.equal(interrupt.walking_impact.estimated_km, 9.2);
  assert.equal(interrupt.walking_impact.walking_target_km, 6);
  assert.equal(interrupt.walking_impact.walking_target_status, "longer_than_requested_band");
});

test("the same event is woven when the extended day fits the requested band", async () => {
  // A "~9 km" request has room for it (ceiling 10.62).
  const woven = await weaveEveningEventRouteStop({
    result: agnosticResult(openRoute()),
    placeStructure: structureWith(EDGE_EVENT),
    walkingKmTarget: 9,
  });
  assert.equal(woven.applied, true, `blockers: ${woven.blockers}`);
  const route = woven.result.days[0].primary_route;
  assert.equal(route.estimated_km, 9.2);
  assert.equal(woven.interrupt.status, "applied");
  assert.equal(woven.interrupt.walking_impact.walking_target_status, "within_requested_band");
});

test("the woven stop records the day before the weave, so the extra distance is attributable", async () => {
  const woven = await weaveEveningEventRouteStop({
    result: agnosticResult(openRoute()),
    placeStructure: structureWith(EDGE_EVENT),
    walkingKmTarget: 9,
  });
  const route = woven.result.days[0].primary_route;
  assert.deepEqual(route.live_event_stop, {
    event_id: "ev-tonight",
    leg_km: 2.4,
    leg_minutes: 29,
    base_estimated_km: 6.8,
    removed_closing_leg_km: 0,
  });
  // Nothing was replaced on an open day: the whole leg is added distance.
  const stop = route.live_event_stop;
  assert.equal(Number((stop.base_estimated_km - stop.removed_closing_leg_km + stop.leg_km).toFixed(1)), route.estimated_km);
});

test("a loop whose closing walk the event replaces is unaffected by the target", async () => {
  const woven = await weaveEveningEventRouteStop({
    result: agnosticResult(longLoopRoute()),
    placeStructure: structureWith(EDGE_EVENT),
    walkingKmTarget: 6,
  });
  // 6.8 - 3.4 (the walk back is no longer claimed) + 2.4 = 5.8 km.
  assert.equal(woven.applied, true, `blockers: ${woven.blockers}`);
  const route = woven.result.days[0].primary_route;
  assert.equal(route.estimated_km, 5.8);
  assert.equal(route.route_shape, "open");
  assert.equal(route.live_event_stop.base_estimated_km, 6.8);
  assert.equal(route.live_event_stop.removed_closing_leg_km, 3.4);
  assert.equal(route.live_event_stop.leg_km, 2.4);
});

test("a day already past the band may take the event only when that does not lengthen it", async () => {
  // "~4 km" asks for at most 4.72. The loop is 6.8 km before any event: the
  // weave did not cause that, and ending at the event shortens it to 5.8.
  const shortening = await weaveEveningEventRouteStop({
    result: agnosticResult(longLoopRoute()),
    placeStructure: structureWith(EDGE_EVENT),
    walkingKmTarget: 4,
  });
  assert.equal(shortening.applied, true, `blockers: ${shortening.blockers}`);
  assert.equal(shortening.result.days[0].primary_route.estimated_km, 5.8);

  // The open 6.8 km day would grow to 9.2 km: refused.
  const lengthening = await weaveEveningEventRouteStop({
    result: agnosticResult(openRoute()),
    placeStructure: structureWith(EDGE_EVENT),
    walkingKmTarget: 4,
  });
  assert.equal(lengthening.applied, false);
  assert.deepEqual(lengthening.blockers, ["event_exceeds_walking_target"]);
  assert.equal(lengthening.interrupt.status, "suggested");
});

test("no_limit and a missing target keep the evening-hop limit as the only distance gate", async () => {
  const unlimited = await weaveEveningEventRouteStop({
    result: agnosticResult(openRoute()),
    placeStructure: structureWith(EDGE_EVENT),
    walkingKmTarget: 6,
    distanceMode: "no_limit",
  });
  assert.equal(unlimited.applied, true, "a user who asked for no limit is not given one");
  assert.equal(unlimited.result.days[0].primary_route.estimated_km, 9.2);
  assert.equal(unlimited.interrupt.walking_impact.walking_target_status, "not_requested");

  const untargeted = await weaveEveningEventRouteStop({
    result: agnosticResult(openRoute()),
    placeStructure: structureWith(EDGE_EVENT),
  });
  assert.equal(untargeted.applied, true);
});

test("an event beyond the evening hop is still refused first, whatever the target", async () => {
  const far = { ...NEAR_EVENT, lng: 12.546 };
  const woven = await weaveEveningEventRouteStop({
    result: agnosticResult(openRoute()),
    placeStructure: structureWith(far),
    walkingKmTarget: 6,
  });
  assert.deepEqual(woven.blockers, ["event_leg_too_long"]);
  assert.deepEqual(woven.interrupt.reasons, ["outside_auto_weave_limit"]);
  assert.equal(woven.interrupt.walking_impact.base_estimated_km, 6.8);
});
