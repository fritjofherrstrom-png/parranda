const {
  normalizePlaceCandidate,
  validatePlaceCandidate,
} = require("./contract");

const OFFICIAL_SOURCE_IDS = new Set([
  "barcelona-open-data-agenda",
  "turismo-roma-live",
]);

class LiveEventVenueProvider {
  constructor(cityConfig, context = {}) {
    if (!cityConfig || typeof cityConfig !== "object") {
      throw new Error("LiveEventVenueProvider requires a city config");
    }
    this.cityConfig = cityConfig;
    this.context = context && typeof context === "object" ? context : {};
  }

  listCandidates(options = {}) {
    const context = options.context && typeof options.context === "object"
      ? options.context
      : this.context;
    const events = options.events ?? context.events ?? context.live_events ?? context.official_events;
    return buildLiveEventVenuePlaceCandidates(this.cityConfig, events);
  }
}

function buildLiveEventVenuePlaceCandidates(cityConfig, eventsInput = []) {
  const seenIds = new Set();

  return flattenLiveEvents(eventsInput)
    .map((event, index) => normalizeLiveEventVenueCandidate(cityConfig, event, index))
    .filter(Boolean)
    .filter((candidate) => {
      if (seenIds.has(candidate.id)) {
        return false;
      }
      seenIds.add(candidate.id);
      return true;
    })
    .map((candidate, index) =>
      validatePlaceCandidate(candidate, `liveEventVenueCandidate[${index}]`),
    );
}

function flattenLiveEvents(eventsInput) {
  if (Array.isArray(eventsInput)) {
    return eventsInput.filter(isPlainObject);
  }
  if (!isPlainObject(eventsInput)) {
    return [];
  }
  if (Array.isArray(eventsInput.events)) {
    return eventsInput.events.filter(isPlainObject);
  }
  return Object.values(eventsInput).flatMap((value) =>
    Array.isArray(value) ? value.filter(isPlainObject) : [],
  );
}

function normalizeLiveEventVenueCandidate(cityConfig, event = {}, index = 0) {
  if (!isPlainObject(event)) {
    return null;
  }

  const venueLabel = firstString(
    event.venue,
    event.geocode_label,
    event.location_label,
    event.address,
  );
  if (!venueLabel) {
    return null;
  }

  const sourceId = firstString(event.source_id, event.provider_id, event.source?.id);
  const sourceLabel = firstString(event.source_label, event.provider, event.source?.label);
  const sourceUrl = firstString(event.source_url, event.source?.url, event.url);
  const coordinates = readCoordinates(event);
  const sourceTier = resolveSourceTier(event, sourceId, sourceLabel);
  const confidence = resolveConfidence(event, coordinates);

  return normalizePlaceCandidate({
    id: buildCandidateId(cityConfig.key, event, venueLabel, index),
    city: cityConfig.key,
    label: venueLabel,
    type: firstString(event.provider_category, event.type, "event_venue"),
    candidate_kind: "event_venue",
    lat: coordinates.lat,
    lng: coordinates.lng,
    area: firstString(event.area, event.neighborhood),
    neighborhood: firstString(event.neighborhood),
    tags: normalizeStringArray(event.match_tags || event.tags),
    route_roles: ["live_event_venue", "optional_detour"],
    source: {
      kind: "live_event_feed",
      id: sourceId || `${cityConfig.key}-live-events`,
      label: sourceLabel,
      url: sourceUrl,
    },
    trust: {
      source_tier: sourceTier,
      confidence,
      human_verified: false,
      freshness: "live",
    },
    city_pack_owned: false,
  });
}

function readCoordinates(event = {}) {
  const lat = Number.isFinite(event.lat) ? event.lat : undefined;
  const lng = Number.isFinite(event.lng) ? event.lng : undefined;
  if (lat === undefined || lng === undefined) {
    return {};
  }
  return { lat, lng };
}

function resolveSourceTier(event, sourceId, sourceLabel) {
  const explicit = firstString(event.trust?.source_tier, event.source_tier, event.source?.source_tier);
  if (explicit) {
    return explicit;
  }
  if (
    event.is_official === true ||
    event.official === true ||
    OFFICIAL_SOURCE_IDS.has(sourceId) ||
    /open data bcn|turismo roma/i.test(sourceLabel || "")
  ) {
    return "official";
  }
  return "verified";
}

function resolveConfidence(event, coordinates) {
  const explicit = firstString(event.trust?.confidence, event.confidence);
  if (explicit) {
    return explicit;
  }
  return coordinates.lat !== undefined && coordinates.lng !== undefined ? "medium" : "needs_review";
}

function buildCandidateId(cityKey, event, venueLabel, index) {
  const source = firstString(event.id, event.url, `${venueLabel}-${event.start_date || ""}-${index}`);
  return `${cityKey}-live-event-venue-${slugify(source)}`;
}

function firstString(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = {
  LiveEventVenueProvider,
  buildLiveEventVenuePlaceCandidates,
  normalizeLiveEventVenueCandidate,
  flattenLiveEvents,
};
