"use strict";

const { haversineKm } = require("../candidates/area-intelligence");

const LIVE_EVENT_SCOPES = new Set(["around_place", "near_route", "near_me"]);
const LIVE_EVENT_TIME_WINDOWS = new Set(["tonight", "this_week"]);
const AROUND_PLACE_RADIUS_M = 3000;
const NEAR_ME_RADIUS_M = 2000;
const ROUTE_CORRIDOR_RADIUS_M = 1200;
const MAX_ROUTE_POINTS = 24;
const MAX_COLLECTION_RADIUS_M = 10000;
const MAX_PREFERENCES = 12;
const MAX_PREFERENCE_LENGTH = 64;

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
  const distanceKm = eventDistanceKm(event, scope);
  return Number.isFinite(distanceKm) && distanceKm * 1000 <= Number(scope?.radius_m || 0);
}

function filterEventsForLiveScope(events, scope) {
  if (!scope) return Array.isArray(events) ? events : [];
  return (Array.isArray(events) ? events : []).filter((event) => eventMatchesLiveScope(event, scope));
}

function shapeCollectedLiveEvents(collected, { scope = null } = {}) {
  if (!collected || !["covered", "uncovered"].includes(collected.coverage)) return null;
  const tonight = filterEventsForLiveScope(collected.tonight, scope);
  const thisWeek = filterEventsForLiveScope(collected.this_week, scope);
  const acquisition = collected.acquisition && typeof collected.acquisition === "object"
    ? {
        ...collected.acquisition,
        ...(collected.acquisition.source_health && typeof collected.acquisition.source_health === "object"
          ? {
              source_health: {
                ...collected.acquisition.source_health,
                surfaced_event_count: tonight.length + thisWeek.length,
              },
            }
          : {}),
      }
    : null;
  return {
    coverage: collected.coverage,
    feed: collected.feed || null,
    ...(Array.isArray(collected.feeds) ? { feeds: collected.feeds } : {}),
    ...(acquisition ? { acquisition } : {}),
    tonight,
    this_week: thisWeek,
    ...(collected.pending ? { pending: true } : {}),
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
  return {
    query: normalized.public,
    route_mutation: false,
    day_anchor_mutation: false,
    live_events: liveEvents,
  };
}

async function executeLiveEventQuery({ payload, eventSupply, now } = {}) {
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
    const collected = await eventSupply({
      anchor: query.collection_anchor,
      sourceAnchors: query.source_anchors,
      radiusM: query.collection_radius_m,
      scope: query.scope,
      now,
      preferences: query.preferences,
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
  LIVE_EVENT_TIME_WINDOWS,
  MAX_COLLECTION_RADIUS_M,
  MAX_ROUTE_POINTS,
  NEAR_ME_RADIUS_M,
  ROUTE_CORRIDOR_RADIUS_M,
  eventMatchesLiveScope,
  executeLiveEventQuery,
  filterEventsForLiveScope,
  normalizeLiveEventQuery,
  shapeCollectedLiveEvents,
  unavailableLiveEvents,
};
