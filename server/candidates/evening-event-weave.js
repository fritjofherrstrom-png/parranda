"use strict";

/**
 * Weave a genuine "tonight" event INTO the composed day.
 *
 * The district day (place_structure.district_day) says WHERE to go. Stable places
 * tell you what a place IS; this gives the day an honest EVENING ANCHOR — a real
 * happening tonight, with its own time window and source, tied to the nearest
 * district so the day reads "...and end your evening at X, near the Y quarter."
 *
 * It is an ANCHOR, not a walking-validated route stop: no ETA, no walking time, no
 * geometry is claimed for it — only the event's real start/end, place, and source.
 * Pure + deterministic. Additive + honest: if there is no genuine, geocoded
 * tonight-event, the day is returned UNCHANGED (no fabricated happening).
 */

const { haversineKm } = require("./area-intelligence");

function weaveEveningEvent(placeStructure, liveEvents) {
  if (!placeStructure || typeof placeStructure !== "object" || !placeStructure.district_day) {
    return placeStructure;
  }
  const tonight = liveEvents && Array.isArray(liveEvents.tonight) ? liveEvents.tonight : [];
  // The list is already salience-ranked; take the top event that has real
  // coordinates AND is salient enough to shape a visitor-facing day. Civic/admin
  // notices can stay in Pulse/source inspect, but must not become an evening
  // anchor just because they are timed and geocoded.
  const event = tonight.find(isEligibleEveningAnchor);
  if (!event) return placeStructure;

  const areas = Array.isArray(placeStructure.district_day.areas) ? placeStructure.district_day.areas : [];
  let nearIndex = null;
  let nearKm = Infinity;
  areas.forEach((area, i) => {
    const c = area && area.center;
    if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
      const d = haversineKm({ lat: event.lat, lng: event.lng }, c);
      if (d < nearKm) {
        nearKm = d;
        nearIndex = i;
      }
    }
  });

  const eveningEvent = {
    id: event.id || null,
    title: event.title || null,
    starts_at: event.starts_at || null,
    ends_at: event.ends_at || null,
    place: event.place || null,
    source_label: event.source_label || null,
    source_url: event.source_url || null,
    license: event.license || null,
    cultural_tier: event.cultural_tier || null,
    salience_score: Number.isFinite(event.salience_score) ? event.salience_score : null,
    lat: event.lat,
    lng: event.lng,
    near_area_index: nearIndex,
    near_area_km: nearIndex != null && Number.isFinite(nearKm) ? Number(nearKm.toFixed(2)) : null,
  };

  return {
    ...placeStructure,
    district_day: { ...placeStructure.district_day, evening_event: eveningEvent },
  };
}

function isEligibleEveningAnchor(event) {
  if (!event || typeof event !== "object") return false;
  if (!Number.isFinite(event.lat) || !Number.isFinite(event.lng)) return false;
  if (!(event.title || event.id)) return false;
  if (!event.source_url && !event.source_label) return false;

  const timing = String(event.timing_relevance || "").toLowerCase();
  if (timing && !["now", "today", "tonight"].includes(timing)) return false;

  if (event.cultural_tier === "administrative") return false;
  if (event.cultural_tier === "cultural") return true;

  // Older injected/event fixtures may predate cultural_tier. Keep the path
  // useful for clearly salient events, while still preventing low-score noise
  // from becoming the day's anchor.
  if (Number.isFinite(event.salience_score)) return event.salience_score >= 6;
  return true;
}

module.exports = { weaveEveningEvent, isEligibleEveningAnchor };
