"use strict";

const { haversineKm } = require("../candidates/area-intelligence");
const { fuseTimeSensitiveEvents } = require("../pulse-sources/event-fusion");

const DEFAULT_MAX_SOURCES = 4;
const DEFAULT_MAX_LOCAL_SOURCES = 3;

/**
 * Select a bounded, deterministic set of approved sources around a trusted
 * coordinate anchor. A global provider gets one reserved slot so overlapping
 * municipal feeds complement rather than hide the global family.
 */
function buildAnchorEventSourcePlan({
  anchor,
  registry = [],
  globalSource = null,
  globalEnabled = false,
  maxSources = DEFAULT_MAX_SOURCES,
  maxLocalSources = DEFAULT_MAX_LOCAL_SOURCES,
} = {}) {
  if (!hasCoordinates(anchor)) return [];

  const cap = clampInteger(maxSources, 1, DEFAULT_MAX_SOURCES);
  const availableLocalSources = resolveEventFeedsForAnchor(anchor, registry, {
    // Inspect the approved local registry before applying the network cap so
    // several rows from one publisher cannot hide an independent source.
    limit: Array.isArray(registry) ? registry.length : 0,
  });
  const reserveGlobal = globalEnabled && globalSource && (cap > 1 || availableLocalSources.length === 0) ? 1 : 0;
  const localCap = Math.min(
    clampInteger(maxLocalSources, 0, DEFAULT_MAX_LOCAL_SOURCES),
    Math.max(0, cap - reserveGlobal),
  );
  const localSources = selectPublisherDiverseFeeds(availableLocalSources, localCap).map((feed) => ({
    ...feed,
    // Legacy rows are Linked Events. Reviewed source manifests can select one
    // of the other allowlisted adapters without adding city branches here.
    kind: feed.adapter || feed.kind || "linked_events",
  }));
  const sources = [...localSources];

  if (reserveGlobal && sources.length < cap) {
    sources.push({ ...globalSource, kind: "global" });
  }
  return sources.slice(0, cap);
}

function resolveEventFeedsForAnchor(anchor, registry = [], { limit = DEFAULT_MAX_LOCAL_SOURCES } = {}) {
  if (!hasCoordinates(anchor)) return [];
  const cap = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : DEFAULT_MAX_LOCAL_SOURCES;
  const seen = new Set();
  return (Array.isArray(registry) ? registry : [])
    .filter((feed) => sourceRuntimeEnabled(feed) && feedCoversAnchor(feed, anchor))
    .slice()
    .sort(compareFeeds)
    .filter((feed) => {
      const key = exactFeedIdentity(feed);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, cap);
}

function selectPublisherDiverseFeeds(feeds, limit) {
  if (limit <= 0) return [];
  const selected = [];
  const deferred = [];
  const publishers = new Set();

  for (const feed of feeds) {
    const publisher = publisherIdentity(feed);
    if (publisher && publishers.has(publisher)) {
      deferred.push(feed);
      continue;
    }
    selected.push(feed);
    if (publisher) publishers.add(publisher);
    if (selected.length === limit) return selected;
  }

  for (const feed of deferred) {
    selected.push(feed);
    if (selected.length === limit) break;
  }
  return selected;
}

/**
 * Reject explicit out-of-bound evidence before fusion. Coordinate-less rows may
 * still corroborate the same occurrence when another source supplies trusted
 * geometry; standalone coordinate-less rows remain rejected.
 */
function fuseAndBoundEventEvidence(events = [], { anchor, radiusM } = {}) {
  if (!hasCoordinates(anchor)) {
    return {
      events: [],
      fused_count: 0,
      rejected: (Array.isArray(events) ? events : []).map((event) => ({
        id: stableEventId(event),
        reason: "missing_trusted_anchor",
      })),
    };
  }

  const radiusKm = Math.max(0.1, Number(radiusM || 0) / 1000);
  const fusable = [];
  const rejected = [];

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== "object") continue;
    if (!hasCoordinates(event)) {
      fusable.push(event);
      continue;
    }
    const distanceKm = haversineKm(anchor, event);
    if (!Number.isFinite(distanceKm) || distanceKm > radiusKm) {
      rejected.push({
        id: stableEventId(event),
        source_provider_id: event.source_provider_id || null,
        reason: "outside_anchor_radius",
        distance_km: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
      });
      continue;
    }
    fusable.push(event);
  }

  const fused = fuseTimeSensitiveEvents(fusable);
  const accepted = [];
  for (const event of fused) {
    if (!hasCoordinates(event)) {
      rejected.push({
        id: stableEventId(event),
        source_provider_id: event.source_provider_id || null,
        reason: "missing_event_coordinates",
      });
      continue;
    }
    const distanceKm = haversineKm(anchor, event);
    if (!Number.isFinite(distanceKm) || distanceKm > radiusKm) {
      rejected.push({
        id: stableEventId(event),
        source_provider_id: event.source_provider_id || null,
        reason: "outside_anchor_radius",
        distance_km: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
      });
      continue;
    }
    accepted.push({ ...event, anchor_distance_km: Number(distanceKm.toFixed(2)) });
  }

  return { events: accepted, fused_count: fused.length, rejected };
}

function summarizeRejections(rejected = []) {
  const counts = new Map();
  for (const row of Array.isArray(rejected) ? rejected : []) {
    const reason = row && row.reason ? String(row.reason) : "unknown_rejection";
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => ({ reason, count }));
}

function buildAnchorEventSourceHealth(
  collections = [],
  { acceptedEventCount = 0, surfacedEventCount = acceptedEventCount, normalizedEventCount = 0, rejected = [] } = {},
) {
  const rows = Array.isArray(collections) ? collections : [];
  const statusCounts = { ok: 0, empty: 0, failed: 0, unavailable: 0 };
  let eventBearingSourceCount = 0;
  let rawEventCount = 0;

  for (const row of rows) {
    const status = Object.hasOwn(statusCounts, row?.status) ? row.status : "failed";
    statusCounts[status] += 1;
    const eventRows = Array.isArray(row?.raw) ? row.raw.length : 0;
    rawEventCount += eventRows;
    if (eventRows > 0) eventBearingSourceCount += 1;
  }

  const respondingSourceCount = statusCounts.ok + statusCounts.empty;
  let status = "uncovered";
  if (rows.length > 0 && respondingSourceCount === rows.length) status = "healthy";
  else if (respondingSourceCount > 0) status = "partial";
  else if (rows.length > 0) status = "unavailable";

  const accepted = Math.max(0, Math.floor(Number(acceptedEventCount) || 0));
  const surfaced = Math.max(0, Math.floor(Number(surfacedEventCount) || 0));
  const normalized = Math.max(0, Math.floor(Number(normalizedEventCount) || 0));
  const rejectionCount = Array.isArray(rejected) ? rejected.length : 0;
  let result = "unknown";
  if (accepted > 0) result = "events_found";
  else if (respondingSourceCount > 0) result = "empty";

  const reasons = [];
  if (rows.length === 0) reasons.push("no_approved_sources");
  if (statusCounts.failed > 0) reasons.push("source_failures_present");
  if (statusCounts.unavailable > 0) reasons.push("source_unavailable_present");
  if (status === "unavailable") reasons.push("all_sources_unavailable");
  if (result === "events_found") reasons.push("bounded_events_found");
  if (result === "empty" && rawEventCount === 0) reasons.push("no_current_events_found");
  if (result === "empty" && rawEventCount > 0 && normalized === 0) {
    reasons.push("all_event_rows_failed_normalization");
  } else if (result === "empty" && normalized > 0 && rejectionCount > 0) {
    reasons.push("all_event_evidence_rejected");
  } else if (result === "empty" && normalized > 0) {
    reasons.push("no_routeable_timed_events");
  }

  return {
    status,
    result,
    selected_source_count: rows.length,
    responding_source_count: respondingSourceCount,
    event_bearing_source_count: eventBearingSourceCount,
    empty_source_count: statusCounts.empty,
    failed_source_count: statusCounts.failed,
    unavailable_source_count: statusCounts.unavailable,
    raw_event_count: rawEventCount,
    normalized_event_count: normalized,
    accepted_event_count: accepted,
    surfaced_event_count: surfaced,
    rejected_event_count: rejectionCount,
    reasons,
  };
}

function feedCoversAnchor(feed, anchor) {
  const bbox = Array.isArray(feed && feed.bbox) ? feed.bbox.map(Number) : [];
  if (bbox.length < 4 || !bbox.every(Number.isFinite)) return false;
  const [west, south, east, north] = bbox;
  if (west > east || south > north) return false;
  return anchor.lng >= west && anchor.lng <= east && anchor.lat >= south && anchor.lat <= north;
}

function sourceRuntimeEnabled(feed) {
  if (!feed || typeof feed !== "object") return false;
  const status = String(feed.status || "active").trim().toLowerCase();
  const policy = String(feed.runtime_policy || feed.runtimePolicy || "bounded_refresh").trim().toLowerCase();
  if (["candidate", "review-needed", "needs_review", "disabled", "paused"].includes(status)) return false;
  if (["probe_only", "review_required", "inspect_only", "disabled"].includes(policy)) return false;
  if (feed.profile_key) {
    const expiresAt = Date.parse(String(feed.profile_expires_at || ""));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  }
  return true;
}

function exactFeedIdentity(feed) {
  if (feed && feed.id) return `id:${String(feed.id).trim().toLowerCase()}`;
  return `base:${String((feed && feed.base) || "").trim().toLowerCase()}`;
}

function publisherIdentity(feed) {
  if (feed && feed.source_identity) return String(feed.source_identity).trim().toLowerCase();
  try {
    return new URL(String((feed && feed.base) || "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_error) {
    return null;
  }
}

function compareFeeds(left, right) {
  return (
    finitePriority(left.priority) - finitePriority(right.priority) ||
    bboxArea(left.bbox) - bboxArea(right.bbox) ||
    sourceTierRank(right.source_tier) - sourceTierRank(left.source_tier) ||
    String(left.id || "").localeCompare(String(right.id || ""))
  );
}

function finitePriority(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 100;
}

function bboxArea(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return Infinity;
  const [west, south, east, north] = bbox.map(Number);
  if (![west, south, east, north].every(Number.isFinite)) return Infinity;
  return Math.abs((east - west) * (north - south));
}

function sourceTierRank(value) {
  return { official: 4, verified: 3, curated: 2, editorial: 1 }[String(value || "").toLowerCase()] || 0;
}

function stableEventId(event) {
  return event && (event.fusion_id || event.id || event.source_url) ? String(event.fusion_id || event.id || event.source_url) : null;
}

function hasCoordinates(value) {
  return Boolean(value && Number.isFinite(value.lat) && Number.isFinite(value.lng));
}

function clampInteger(value, min, fallbackMax) {
  const number = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallbackMax;
  return Math.max(min, Math.min(number, fallbackMax));
}

module.exports = {
  buildAnchorEventSourcePlan,
  resolveEventFeedsForAnchor,
  fuseAndBoundEventEvidence,
  summarizeRejections,
  buildAnchorEventSourceHealth,
  DEFAULT_MAX_SOURCES,
  DEFAULT_MAX_LOCAL_SOURCES,
};
