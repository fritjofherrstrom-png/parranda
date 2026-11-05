"use strict";

/**
 * A venue's own programme places its events at that venue, on evidence.
 *
 * A Live source found on the official website of a venue (Wikidata P856 of a
 * venue item with coordinates; see pulse-sources/event-venue-seeds.js) carries
 * that venue as its host. An event from such a source that has no coordinates
 * gets the host venue's point only when:
 *  - the place the event names is the host venue (its distinctive name), or
 *  - the event names no place, and nothing else in the same source points
 *    elsewhere: no event names another place and no located event lies away
 *    from the host. A site that lists several venues proves nothing for the
 *    rows that name none.
 * Every other row keeps the ordinary venue resolution. Coordinates an event
 * already has are never replaced, and the basis stays on the event.
 */

const MULTI_VENUE_DISTANCE_KM = 0.3;
const MIN_NAME_LENGTH = 4;
// Articles and bare kinds of place: they name no particular venue.
const GENERIC_WORDS = new Set([
  "the", "le", "la", "les", "el", "los", "las", "lo", "il", "der", "die", "das", "den", "dem", "de", "del", "della",
  "di", "du", "des", "het", "een", "och", "and", "und", "et", "y", "e", "of", "at", "am", "im", "an",
  "theater", "theatre", "teatro", "teatre", "teater", "teatr", "kino", "cinema", "cine", "club", "klub", "bar",
  "haus", "house", "hall", "halle", "saal", "sala", "salle", "zaal", "museum", "museo", "musee", "museu",
  "galerie", "gallery", "galleria", "centre", "center", "centro", "zentrum", "centrum", "stage", "buhne",
  "scene", "scena", "arena", "opera", "oper", "venue", "space", "studio",
]);

function hasCoordinates(event) {
  return Number.isFinite(event?.lat) && Number.isFinite(event?.lng) &&
    Math.abs(event.lat) <= 90 && Math.abs(event.lng) <= 180 && !(event.lat === 0 && event.lng === 0);
}

function words(text) {
  return String(text || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/ß/g, "ss").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// The distinctive part of a name, without spaces: no articles, no bare kinds
// of place and none of the words of the town itself.
function distinctiveName(text, townWords) {
  return words(text).filter((word) => !GENERIC_WORDS.has(word) && !townWords.has(word)).join("");
}

function validHostVenue(value) {
  if (!value || typeof value !== "object") return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const lat = coordinateNumber(value.lat);
  const lng = coordinateNumber(value.lng);
  const ref = typeof value.wikidata_ref === "string" ? value.wikidata_ref : "";
  if (!name || name.length > 160 || !/^Q\d+$/.test(ref) || !hasCoordinates({ lat, lng })) return null;
  return { name, lat, lng, wikidata_ref: ref };
}

function coordinateNumber(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return NaN;
  return Number(value);
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// "host", "other" or "unnamed" for an event without coordinates.
function namedPlaceVerdict(event, hostNames, townWords) {
  const named = [event?.place_context, event?.address, event?.venue_name]
    .filter((text) => typeof text === "string" && text.trim())
    .flatMap((text) => text.split(",").map((part) => distinctiveName(part, townWords)))
    .filter(Boolean);
  // A short explicit name is still a name. Unknown qualifiers/fields cannot
  // disappear behind a matching fragment or authorize the programme fallback.
  if (!named.length) return "unnamed";
  return named.every((name) => hostNames.has(name)) ? "host" : "other";
}

function placeAtHostVenue(events, hostVenue, { placeContext = null, sourceLocationScope = null } = {}) {
  const rows = Array.isArray(events) ? events : [];
  const host = validHostVenue(hostVenue);
  if (!host || !rows.length) return rows;
  const townWords = new Set([placeContext?.locality, placeContext?.municipality].flatMap(words));
  // Slash-separated names are explicit parts of the host's own name, not
  // inferred substring aliases (e.g. "Sunset/Sunside" -> "Sunside").
  const hostNames = new Set([host.name, ...host.name.split("/")]
    .map((name) => distinctiveName(name, townWords)).filter((name) => name.length >= MIN_NAME_LENGTH));
  const verdicts = rows.map((event) => {
    // Even a partial, zero or out-of-range source point is an explicit fact,
    // not permission to manufacture host geometry. Keep it for the usual gates.
    if (event?.lat !== undefined || event?.lng !== undefined) {
      return hasCoordinates(event) && distanceKm(host, event) <= MULTI_VENUE_DISTANCE_KM ? "located" : "elsewhere";
    }
    return namedPlaceVerdict(event, hostNames, townWords);
  });
  const pointsElsewhere = [...rows, ...(Array.isArray(sourceLocationScope) ? sourceLocationScope : [])]
    .some((event) => {
      if (event?.lat !== undefined || event?.lng !== undefined) {
        return !hasCoordinates(event) || distanceKm(host, event) > MULTI_VENUE_DISTANCE_KM;
      }
      return namedPlaceVerdict(event, hostNames, townWords) === "other";
    });
  return rows.map((event, index) => {
    const basis = verdicts[index] === "host" ? "host_venue_name"
      : verdicts[index] === "unnamed" && !pointsElsewhere ? "host_venue_programme" : null;
    if (!basis) return event;
    return {
      ...event,
      lat: host.lat,
      lng: host.lng,
      venue_resolution: {
        status: "resolved",
        source: "host_venue",
        basis,
        name: host.name,
        provider: "wikidata",
        ref: host.wikidata_ref,
        attribution: "Wikidata",
        license: "CC0-1.0",
        geometry_scope: "host_venue",
      },
    };
  });
}

module.exports = { placeAtHostVenue, validHostVenue };
