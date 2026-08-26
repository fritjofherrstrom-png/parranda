"use strict";

const { haversineKm } = require("../candidates/area-intelligence");
const { resolveAgnosticIntake } = require("../planner/agnostic-place-intake");
const {
  normalizeSourceDiscoveryHealth,
} = require("../pulse-sources/source-discovery-health");

const LIVE_EVENT_SCOPES = new Set(["around_place", "near_route", "near_me"]);
const LIVE_EVENT_TIME_WINDOWS = new Set(["tonight", "this_week"]);
const LIVE_EVENT_QUERY_CONTRACT = "live_event_query_v1";
const AROUND_PLACE_RADIUS_M = 3000;
const NEAR_ME_RADIUS_M = 2000;
const ROUTE_CORRIDOR_RADIUS_M = 1200;
const MAX_ROUTE_POINTS = 24;
const MAX_COLLECTION_RADIUS_M = 10000;
// A small, resolver-attested settlement may fall back to explicitly nearby
// events when its local 3 km bucket is empty. This never applies to near_me,
// route corridors, untrusted coordinates or broad city/region bounds.
const NEARBY_SETTLEMENT_RADIUS_M = 25000;
const MAX_PLACE_QUERY_LENGTH = 200;
const MAX_ATTESTED_ANCHOR_DRIFT_KM = 1;
const MAX_PREFERENCES = 12;
const MAX_PREFERENCE_LENGTH = 64;
const SOURCE_HEALTH_STATUSES = new Set([
  "failed",
  "healthy",
  "partial",
  "pending",
  "unavailable",
  "uncovered",
]);
const SOURCE_HEALTH_RESULTS = new Set(["empty", "events_found", "pending", "unavailable", "unknown"]);
const SOURCE_HEALTH_COUNT_FIELDS = Object.freeze([
  "selected_source_count",
  "responding_source_count",
  "event_bearing_source_count",
  "empty_source_count",
  "failed_source_count",
  "unavailable_source_count",
  "raw_event_count",
  "normalized_event_count",
  "accepted_event_count",
  "surfaced_event_count",
  "rejected_event_count",
]);

function coordinatePart(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinate(value) {
  if (!value || typeof value !== "object") return null;
  const lat = coordinatePart(value.lat);
  const lng = coordinatePart(value.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat, lng };
}

function normalizePreferences(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const preference = typeof item === "string" ? item.trim() : "";
    if (!preference || preference.length > MAX_PREFERENCE_LENGTH || seen.has(preference)) continue;
    seen.add(preference);
    normalized.push(preference);
    if (normalized.length >= MAX_PREFERENCES) break;
  }
  return normalized;
}

function centroid(points) {
  const vector = points.reduce((sum, point) => {
    const lat = (point.lat * Math.PI) / 180;
    const lng = (point.lng * Math.PI) / 180;
    sum.x += Math.cos(lat) * Math.cos(lng);
    sum.y += Math.cos(lat) * Math.sin(lng);
    sum.z += Math.sin(lat);
    return sum;
  }, { x: 0, y: 0, z: 0 });
  const horizontal = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
  return {
    lat: (Math.atan2(vector.z, horizontal) * 180) / Math.PI,
    lng: (Math.atan2(vector.y, vector.x) * 180) / Math.PI,
  };
}

function publicQueryShape(query) {
  return {
    scope: query.scope.kind,
    time: query.time,
    radius_m: query.scope.radius_m,
    route_point_count: query.scope.kind === "near_route" ? query.scope.points.length : 0,
    preferences: query.preferences,
  };
}

function normalizeLiveEventQuery(payload = {}) {
  const scopeKind = String(payload.scope || "around_place").trim().toLowerCase();
  if (!LIVE_EVENT_SCOPES.has(scopeKind)) {
    return { error: "invalid_live_event_scope" };
  }
  const time = String(payload.time || "tonight").trim().toLowerCase();
  if (!LIVE_EVENT_TIME_WINDOWS.has(time)) {
    return { error: "invalid_live_event_time_window" };
  }
  const preferences = normalizePreferences(payload.preferences);

  if (scopeKind === "near_route") {
    if (!Array.isArray(payload.route_points) || payload.route_points.length < 2) {
      return { error: "near_route_requires_route_points" };
    }
    if (payload.route_points.length > MAX_ROUTE_POINTS) {
      return { error: "too_many_route_points" };
    }
    const points = payload.route_points.map(coordinate);
    if (points.some((point) => !point)) {
      return { error: "invalid_route_point" };
    }
    const collectionAnchor = centroid(points);
    const furthestPointKm = Math.max(...points.map((point) => haversineKm(collectionAnchor, point)));
    const collectionRadiusM = Math.ceil(furthestPointKm * 1000 + ROUTE_CORRIDOR_RADIUS_M);
    if (collectionRadiusM > MAX_COLLECTION_RADIUS_M) {
      return { error: "route_scope_too_large" };
    }
    const query = {
      time,
      preferences,
      collection_anchor: collectionAnchor,
      collection_radius_m: collectionRadiusM,
      source_anchors: points,
      scope: {
        kind: scopeKind,
        points,
        radius_m: ROUTE_CORRIDOR_RADIUS_M,
      },
    };
    return { value: query, public: publicQueryShape(query) };
  }

  const anchor = coordinate(payload.anchor || payload);
  if (!anchor) return { error: "invalid_live_event_anchor" };
  const radiusM = scopeKind === "near_me" ? NEAR_ME_RADIUS_M : AROUND_PLACE_RADIUS_M;
  const query = {
    time,
    preferences,
    collection_anchor: anchor,
    collection_radius_m: radiusM,
    source_anchors: [anchor],
    scope: {
      kind: scopeKind,
      anchor,
      radius_m: radiusM,
    },
  };
  if (scopeKind === "around_place" && typeof payload.place_query === "string") {
    const placeQuery = payload.place_query.trim().replace(/\s+/g, " ");
    if (placeQuery && placeQuery.length <= MAX_PLACE_QUERY_LENGTH) query.place_query = placeQuery;
  }
  return { value: query, public: publicQueryShape(query) };
}

function pointToSegmentKm(point, start, end) {
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const xScale = 111.32 * Math.max(0.01, Math.abs(cosLat));
  const yScale = 110.574;
  const longitudeDelta = (value) => ((value + 540) % 360) - 180;
  const ax = longitudeDelta(start.lng - point.lng) * xScale;
  const ay = (start.lat - point.lat) * yScale;
  const bx = longitudeDelta(end.lng - point.lng) * xScale;
  const by = (end.lat - point.lat) * yScale;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.sqrt(ax * ax + ay * ay);
  const projection = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  const nearestX = ax + projection * dx;
  const nearestY = ay + projection * dy;
  return Math.sqrt(nearestX * nearestX + nearestY * nearestY);
}

function eventDistanceKm(event, scope) {
  const eventPoint = coordinate(event);
  if (!eventPoint || !scope || typeof scope !== "object") return null;
  if (scope.kind !== "near_route") {
    return scope.anchor ? haversineKm(scope.anchor, eventPoint) : null;
  }
  const points = Array.isArray(scope.points) ? scope.points : [];
  if (points.length < 2) return null;
  let nearestKm = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    nearestKm = Math.min(nearestKm, pointToSegmentKm(eventPoint, points[index - 1], points[index]));
  }
  return Number.isFinite(nearestKm) ? nearestKm : null;
}

function eventMatchesLiveScope(event, scope) {
  if (
    event?.source_scope_verified === true &&
    event?.geographic_relevance === "source_scope"
  ) {
    // Source-bounds are sufficient for the ordinary local around-place view,
    // but not for a 25 km settlement fallback. A regional result must have a
    // point so Parranda can prove it is inside the fallback and state exactly
    // how far away it is.
    return scope?.kind === "around_place" && !scope?.trusted_nearby_fallback_m;
  }
  const distanceKm = eventDistanceKm(event, scope);
  return Number.isFinite(distanceKm) && distanceKm * 1000 <= Number(scope?.radius_m || 0);
}

function filterEventsForLiveScope(events, scope) {
  if (!scope) return Array.isArray(events) ? events : [];
  const input = Array.isArray(events) ? events : [];
  const local = input.filter((event) => eventMatchesLiveScope(event, scope));
  const fallbackRadiusM = Number(scope?.trusted_nearby_fallback_m || 0);
  if (local.length > 0 || scope?.kind !== "around_place" || fallbackRadiusM <= Number(scope.radius_m || 0)) {
    return local;
  }
  return input.flatMap((event) => {
    const distanceKm = eventDistanceKm(event, scope);
    if (!Number.isFinite(distanceKm) || distanceKm * 1000 > fallbackRadiusM) return [];
    return [{
      ...event,
      live_proximity: "nearby",
      anchor_distance_km: Number(distanceKm.toFixed(2)),
    }];
  });
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function compactReasonTokens(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((reason) => String(reason || "").trim())
    .filter((reason) => /^[a-z][a-z0-9_]{0,63}$/.test(reason)))];
}

function normalizeLiveEventSourceHealth(sourceHealth, { coverage, pending, surfacedEventCount } = {}) {
  const input = sourceHealth && typeof sourceHealth === "object" ? sourceHealth : {};
  const fallbackStatus = pending ? "pending" : coverage === "uncovered" ? "uncovered" : "unavailable";
  const status = SOURCE_HEALTH_STATUSES.has(input.status) ? input.status : fallbackStatus;
  const fallbackResult = status === "pending" ? "pending" : status === "failed" ? "unavailable" : "unknown";
  const result = SOURCE_HEALTH_RESULTS.has(input.result) ? input.result : fallbackResult;
  const normalized = { status, result };
  for (const field of SOURCE_HEALTH_COUNT_FIELDS) normalized[field] = nonNegativeInteger(input[field]);
  normalized.surfaced_event_count = nonNegativeInteger(surfacedEventCount);
  normalized.reasons = compactReasonTokens(input.reasons);
  return normalized;
}

function shapeCollectedLiveEvents(collected, { scope = null } = {}) {
  if (!collected || !["covered", "uncovered"].includes(collected.coverage)) return null;
  const tonight = filterEventsForLiveScope(collected.tonight, scope);
  const thisWeek = filterEventsForLiveScope(collected.this_week, scope);
  const browse = shapeLiveEventBrowse(collected.browse, { scope });
  const acquisitionInput = collected.acquisition && typeof collected.acquisition === "object"
    ? collected.acquisition
    : {};
  const { discovery_health: rawDiscoveryHealth, ...safeAcquisitionInput } = acquisitionInput;
  const acquisition = {
    ...safeAcquisitionInput,
    source_health: normalizeLiveEventSourceHealth(acquisitionInput.source_health, {
      coverage: collected.coverage,
      pending: Boolean(collected.pending),
      surfacedEventCount: tonight.length + thisWeek.length,
    }),
  };
  const discoveryHealth = normalizeSourceDiscoveryHealth(rawDiscoveryHealth);
  if (discoveryHealth) acquisition.discovery_health = discoveryHealth;
  return {
    coverage: collected.coverage,
    feed: collected.feed || null,
    ...(Array.isArray(collected.feeds) ? { feeds: collected.feeds } : {}),
    acquisition,
    tonight,
    this_week: thisWeek,
    browse,
    ...(collected.pending ? { pending: true } : {}),
  };
}

function shapeLiveEventBrowse(value, { scope = null } = {}) {
  const input = value && typeof value === "object" ? value : {};
  const shapeBucket = (bucket) => {
    const source = bucket && typeof bucket === "object" ? bucket : {};
    const more = filterEventsForLiveScope(source.more, scope).slice(0, 18);
    const rankedEventCount = nonNegativeInteger(source.ranked_event_count);
    const highlightCount = nonNegativeInteger(source.highlight_count);
    return {
      ranked_event_count: rankedEventCount,
      highlight_count: highlightCount,
      more_count: more.length,
      hidden_count: Math.max(
        nonNegativeInteger(source.hidden_count),
        rankedEventCount - highlightCount - more.length,
      ),
      more,
    };
  };
  return {
    contract: "live_event_browse_v1",
    max_rows_per_bucket: 24,
    tonight: shapeBucket(input.tonight),
    this_week: shapeBucket(input.this_week),
  };
}

function unavailableLiveEvents(reason, status = "unavailable") {
  const safeStatus = status === "failed" ? "failed" : "unavailable";
  const safeReason = ["event_supply_not_configured", "event_supply_failed", "event_supply_invalid_result"].includes(reason)
    ? reason
    : "event_supply_failed";
  return {
    coverage: "unavailable",
    feed: null,
    feeds: [],
    tonight: [],
    this_week: [],
    browse: shapeLiveEventBrowse(null),
    acquisition: {
      mode: "bounded_multi_source",
      source_health: {
        status: safeStatus,
        result: "unavailable",
        selected_source_count: 0,
        responding_source_count: 0,
        event_bearing_source_count: 0,
        empty_source_count: 0,
        failed_source_count: safeStatus === "failed" ? 1 : 0,
        unavailable_source_count: safeStatus === "unavailable" ? 1 : 0,
        raw_event_count: 0,
        normalized_event_count: 0,
        accepted_event_count: 0,
        surfaced_event_count: 0,
        rejected_event_count: 0,
        reasons: [safeReason],
      },
    },
  };
}

function liveEventQueryBody(normalized, liveEvents) {
  const nearbyFallbackM = normalized.value?.scope?.trusted_nearby_fallback_m;
  const query = {
    ...normalized.public,
    // Describe the server-owned collection scope, not whether this particular
    // response happened to contain a nearby row. Pending and honest-empty
    // responses still searched the regional fallback.
    discovery_scope: nearbyFallbackM ? "regional_nearby" : "local",
  };
  if (nearbyFallbackM) {
    query.nearby_fallback_radius_m = nearbyFallbackM;
  }
  return {
    contract: LIVE_EVENT_QUERY_CONTRACT,
    query,
    route_mutation: false,
    day_anchor_mutation: false,
    live_events: liveEvents,
  };
}

async function attestSmallSettlementScope(query, placeResolver, placeLanguage) {
  if (
    query?.scope?.kind !== "around_place" ||
    !query.place_query ||
    typeof placeResolver !== "function"
  ) return null;
  const resolved = await resolveAgnosticIntake({
    placeQuery: query.place_query,
    placeResolver,
    placeLanguage,
  });
  if (!resolved.anchor || !resolved.spatialScope) return null;
  const driftKm = haversineKm(query.collection_anchor, resolved.anchor);
  const scope = resolved.spatialScope;
  if (
    !Number.isFinite(driftKm) ||
    driftKm > MAX_ATTESTED_ANCHOR_DRIFT_KM ||
    scope.kind !== "settlement" ||
    scope.collection_mode !== "local_anchor" ||
    !Number.isFinite(scope.diagonal_km) ||
    scope.diagonal_km > 15
  ) return null;
  return {
    placeContext: resolved.placeContext,
    spatialScope: scope,
    placeLabel: resolved.intake?.resolved?.label || null,
  };
}

async function executeLiveEventQuery({ payload, eventSupply, now, placeResolver = null, placeLanguage = null } = {}) {
  const normalized = normalizeLiveEventQuery(payload);
  if (normalized.error) {
    return { status: 400, body: { error: normalized.error } };
  }
  if (typeof eventSupply !== "function") {
    return {
      status: 200,
      body: liveEventQueryBody(normalized, unavailableLiveEvents("event_supply_not_configured")),
    };
  }

  const query = normalized.value;
  try {
    const attested = await attestSmallSettlementScope(query, placeResolver, placeLanguage).catch(() => null);
    if (attested) {
      query.collection_radius_m = NEARBY_SETTLEMENT_RADIUS_M;
      query.scope = {
        ...query.scope,
        trusted_nearby_fallback_m: NEARBY_SETTLEMENT_RADIUS_M,
      };
    }
    const collected = await eventSupply({
      anchor: query.collection_anchor,
      sourceAnchors: query.source_anchors,
      radiusM: query.collection_radius_m,
      scope: query.scope,
      now,
      preferences: query.preferences,
      ...(attested ? {
        placeLabel: attested.placeLabel,
        placeContext: attested.placeContext,
        spatialScope: attested.spatialScope,
      } : {}),
    });
    const liveEvents = shapeCollectedLiveEvents(collected, { scope: query.scope });
    return {
      status: 200,
      body: liveEventQueryBody(
        normalized,
        liveEvents || unavailableLiveEvents("event_supply_invalid_result", "failed"),
      ),
    };
  } catch (_error) {
    return {
      status: 200,
      body: liveEventQueryBody(normalized, unavailableLiveEvents("event_supply_failed", "failed")),
    };
  }
}

module.exports = {
  AROUND_PLACE_RADIUS_M,
  LIVE_EVENT_SCOPES,
  LIVE_EVENT_QUERY_CONTRACT,
  LIVE_EVENT_TIME_WINDOWS,
  MAX_COLLECTION_RADIUS_M,
  NEARBY_SETTLEMENT_RADIUS_M,
  MAX_ROUTE_POINTS,
  NEAR_ME_RADIUS_M,
  ROUTE_CORRIDOR_RADIUS_M,
  eventMatchesLiveScope,
  executeLiveEventQuery,
  filterEventsForLiveScope,
  normalizeLiveEventQuery,
  normalizeLiveEventSourceHealth,
  shapeCollectedLiveEvents,
  shapeLiveEventBrowse,
  unavailableLiveEvents,
};
