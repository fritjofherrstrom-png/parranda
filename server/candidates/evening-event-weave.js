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
  // coordinates (a happening we can place on the map honestly).
  const event = tonight.find((e) => e && Number.isFinite(e.lat) && Number.isFinite(e.lng) && (e.title || e.id));
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

module.exports = { weaveEveningEvent };
