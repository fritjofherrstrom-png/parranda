"use strict";

/**
 * Weave the evening anchor INTO the route as a WALKING-VALIDATED final stop.
 *
 * The evening-event-weave (#317/#330) gives the day an honest anchor: a genuine,
 * salience-gated tonight-event with real time + source — but explicitly "an
 * ANCHOR, not a walking-validated route stop". This module is that next step:
 * when the anchor is a genuinely walkable extension of the composed day, the
 * event becomes the day's LAST STOP — sequenced, walking-validated, on the map,
 * in the Google Maps link — so the route itself ends where the evening ends.
 *
 * Honesty rules (each fails CLOSED — the anchor card stays, the route is
 * returned unchanged):
 *   - Only a day the agnostic engine actually produced is touched (the day-level
 *     markers, the same signal anywhere-render-decision trusts). A fallback
 *     city's route NEVER gets the typed place's event.
 *   - The extended stop order re-runs the EXISTING walking validator
 *     (validateAgnosticWalkingOrder) in the supplied order — no reordering, no
 *     optimizing — and the new leg must be a short evening hop
 *     (<= MAX_EVENT_LEG_KM), not a trek.
 *   - The walk claim stays truthful: on a loop route the closing walk back to
 *     the start is REPLACED by the walk to the event (the evening ends at the
 *     event, so the day no longer claims a return leg) and the shape becomes
 *     "open". Distances/minutes are recomputed from the actual final legs.
 *   - The stop is marked (`is_live_event`, `event_id`, time window, source) —
 *     never dressed as a stable place.
 *
 * Pure with respect to its inputs (returns clones on apply, the original
 * references when not applied). Deterministic given the injected router.
 */

const { validateAgnosticWalkingOrder } = require("../planner/agnostic-route-walking-validation");

// A woven evening stop must be a short hop from where the day already ends —
// beyond this the event stays an anchor (real, sourced, but with no walk claim).
const MAX_EVENT_LEG_KM = 2.5;

function isAgnosticDay(day) {
  if (!day || typeof day !== "object") return false;
  return (
    day.experimental_agnostic_route_applied === true ||
    day.experimental_agnostic_day === true ||
    day.source === "agnostic_route_output_experiment"
  );
}

function finiteCoord(value) {
  return value && Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

function round1(n) {
  return Number(n.toFixed(1));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @returns {Promise<{result: object, placeStructure: object|null, applied: boolean, blockers: string[], interrupt?: object}>}
 *   `result`/`placeStructure` are the inputs when not applied, clones when applied.
 */
async function weaveEveningEventRouteStop({ result, placeStructure, walkingRouter, walkingConfig } = {}) {
  const unchanged = (blockers, interrupt = null) => ({
    result,
    placeStructure,
    applied: false,
    blockers,
    ...(interrupt ? { interrupt } : {}),
  });

  const day = result && Array.isArray(result.days) ? result.days[0] : null;
  if (!isAgnosticDay(day)) return unchanged(["day_not_agnostic"]);
  const route = day.primary_route;
  const event = placeStructure && placeStructure.district_day ? placeStructure.district_day.evening_event : null;
  if (!event || !finiteCoord(event) || !(event.title || event.id)) return unchanged(["no_geocoded_evening_event"]);
  if (event.occurrence_date && day.date && event.occurrence_date !== day.date) {
    return unchanged(["event_date_mismatch"]);
  }
  if (!route || !Array.isArray(route.main_stops)) return unchanged(["no_route"]);

  const coordStops = route.main_stops.filter(finiteCoord);
  if (coordStops.length < 2 || coordStops.length !== route.main_stops.length) {
    return unchanged(["route_stops_incomplete"]);
  }
  const lastStop = coordStops[coordStops.length - 1];
  const eventLabel = event.title || `Event ${event.id}`;
  if (route.main_stops.some((s) => s.event_id && event.id && s.event_id === event.id)) {
    return unchanged(["event_already_in_route"]);
  }

  // Walking validation of the EXTENDED order — same validator, same honesty:
  // supplied order only, heuristic router by default, fails closed.
  let validation;
  try {
    validation = await validateAgnosticWalkingOrder({
      stops: [...coordStops.map((s) => ({ lat: s.lat, lng: s.lng, label: s.label })), { lat: event.lat, lng: event.lng, label: eventLabel }],
      // Callers (buildApp) default these to null; the validator's own defaults
      // only engage on undefined.
      walkingRouter: typeof walkingRouter === "function" ? walkingRouter : undefined,
      walkingConfig: walkingConfig || undefined,
    });
  } catch (_error) {
    return unchanged(["walking_validation_error"]);
  }
  const legs = validation && validation.valid && validation.result && Array.isArray(validation.result.legs)
    ? validation.result.legs
    : null;
  if (!legs || legs.length !== coordStops.length) {
    return unchanged(["walking_validation_failed", ...((validation && validation.blockers) || [])]);
  }
  const eventLeg = legs[legs.length - 1];
  const legKm = Number(eventLeg && eventLeg.distance_km);
  const legMinutes = Number(eventLeg && eventLeg.estimated_walk_minutes);
  if (!Number.isFinite(legKm) || !Number.isFinite(legMinutes)) return unchanged(["event_leg_unmeasurable"]);
  if (legKm > MAX_EVENT_LEG_KM) {
    return unchanged(
      ["event_leg_too_long"],
      buildPulseRouteInterrupt({ status: "suggested", event, lastStop, legKm, legMinutes }),
    );
  }

  // Apply — on clones, never on the caller's objects.
  const nextResult = deepClone(result);
  const nextDay = nextResult.days[0];
  const nextRoute = nextDay.primary_route;

  nextRoute.main_stops.push({
    id: `live-event-${event.id || "tonight"}`,
    label: eventLabel,
    lat: event.lat,
    lng: event.lng,
    type: null,
    area: null,
    tags: [],
    summary: null,
    drawer_query: eventLabel,
    daypart: "evening",
    is_live_event: true,
    event_id: event.id || null,
    starts_at: event.starts_at || null,
    ends_at: event.ends_at || null,
    starts_on: event.starts_on || null,
    ends_on: event.ends_on || null,
    time_window: event.time_window || null,
    occurrence_date: event.occurrence_date || null,
    timezone: event.timezone || null,
    anchor_weight: 1,
    trust: { source_tier: "official", confidence: "medium", human_verified: false, freshness: "fresh" },
    provisional: false,
    source: { kind: "live_event_feed", label: event.source_label || null, url: event.source_url || null },
    provenance: {
      why_included: "Genuine selected-day event near the day's end — woven as the evening stop after walking validation.",
      attribution: [{ label: event.source_label || null, url: event.source_url || null, license: event.license || null }],
    },
  });

  // The evening now ends at the event: on a loop, the closing walk back to the
  // start anchor is no longer part of the day's claim — replace it.
  const routeLegs = Array.isArray(nextRoute.legs) ? nextRoute.legs : [];
  const closing = routeLegs[routeLegs.length - 1];
  const stopLabels = new Set(coordStops.map((s) => String(s.label)));
  let removedKm = 0;
  if (
    closing &&
    String(closing.from_label) === String(lastStop.label) &&
    !stopLabels.has(String(closing.to_label))
  ) {
    removedKm = Number.isFinite(closing.distance_km) ? closing.distance_km : 0;
    routeLegs.pop();
  }
  routeLegs.push({
    from_label: lastStop.label,
    to_label: eventLabel,
    distance_km: round1(legKm),
    estimated_walk_minutes: Math.round(legMinutes),
  });
  nextRoute.legs = routeLegs;

  if (Number.isFinite(nextRoute.estimated_km)) {
    nextRoute.estimated_km = round1(Math.max(0, nextRoute.estimated_km - removedKm + legKm));
  }
  const legKms = routeLegs.map((l) => Number(l.distance_km)).filter(Number.isFinite);
  if (legKms.length) nextRoute.longest_leg_km = round1(Math.max(...legKms));
  const legMins = routeLegs.map((l) => Number(l.estimated_walk_minutes)).filter(Number.isFinite);
  if (legMins.length) nextRoute.average_leg_minutes = Math.round(legMins.reduce((a, b) => a + b, 0) / legMins.length);
  if (Array.isArray(nextRoute.daypart_arc)) nextRoute.daypart_arc.push("evening");

  const eventPoint = { lat: event.lat, lng: event.lng };
  if (Array.isArray(nextRoute.map_path_points) && nextRoute.map_path_points.length) {
    const first = nextRoute.map_path_points[0];
    const last = nextRoute.map_path_points[nextRoute.map_path_points.length - 1];
    // Loop geometry closes back on the start point — the evening line now ends
    // at the event instead.
    if (first && last && first.lat === last.lat && first.lng === last.lng) nextRoute.map_path_points.pop();
    nextRoute.map_path_points.push(eventPoint);
  }
  if (Array.isArray(nextRoute.map_route_points) && nextRoute.map_route_points.length) {
    const lastPoint = nextRoute.map_route_points[nextRoute.map_route_points.length - 1];
    if (lastPoint && lastPoint.role === "end") nextRoute.map_route_points.pop();
    nextRoute.map_route_points.push({ label: eventLabel, lat: event.lat, lng: event.lng, role: "evening_event" });
  }
  if (nextRoute.route_shape === "loop") nextRoute.route_shape = "open";
  nextRoute.live_event_stop = {
    event_id: event.id || null,
    leg_km: round1(legKm),
    leg_minutes: Math.round(legMinutes),
  };

  const nextStructure = deepClone(placeStructure);
  nextStructure.district_day.evening_event = {
    ...nextStructure.district_day.evening_event,
    woven_into_route: true,
    route_leg_km: round1(legKm),
    route_leg_minutes: Math.round(legMinutes),
  };

  return {
    result: nextResult,
    placeStructure: nextStructure,
    applied: true,
    blockers: [],
    interrupt: buildPulseRouteInterrupt({ status: "applied", event, lastStop, legKm, legMinutes }),
  };
}

function buildPulseRouteInterrupt({ status, event, lastStop, legKm, legMinutes }) {
  const applied = status === "applied";
  return {
    contract: "pulse_route_interrupt_v1",
    status,
    route_mutation: applied,
    route_anchor_unchanged: true,
    requires_user_action: !applied,
    action: applied ? "evening_extension_applied" : "consider_recomposing_around_event",
    proposed_position: "after_final_stop",
    event: {
      id: event.id || null,
      title: event.title || null,
      lat: event.lat,
      lng: event.lng,
      starts_at: event.starts_at || null,
      ends_at: event.ends_at || null,
      occurrence_date: event.occurrence_date || null,
      timezone: event.timezone || null,
      source_label: event.source_label || null,
      source_url: event.source_url || null,
    },
    walking_impact: {
      from_stop_id: lastStop.id || null,
      from_stop_label: lastStop.label || null,
      leg_km: round1(legKm),
      leg_minutes: Math.round(legMinutes),
      auto_weave_limit_km: MAX_EVENT_LEG_KM,
    },
    reasons: [applied ? "walking_validated_evening_extension" : "outside_auto_weave_limit"],
  };
}

module.exports = { weaveEveningEventRouteStop, MAX_EVENT_LEG_KM };
