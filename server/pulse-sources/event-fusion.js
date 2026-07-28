"use strict";

const crypto = require("node:crypto");

const { normalizeConfidence } = require("./display-gates");

const START_MATCH_TOLERANCE_MS = 15 * 60 * 1000;
const START_CONFLICT_TOLERANCE_MS = 5 * 60 * 1000;
const END_CONFLICT_TOLERANCE_MS = 15 * 60 * 1000;
const LOCATION_MATCH_RADIUS_KM = 0.25;

const SOURCE_TIER_RANK = {
  official: 6,
  verified: 5,
  curated: 4,
  editorial: 3,
  inferred: 2,
  fallback: 1,
};

const CONFIDENCE_RANK = {
  strong: 4,
  medium: 3,
  low: 2,
  needs_review: 1,
};

/**
 * Conservatively fuse normalized time-sensitive events from multiple providers.
 *
 * A title is never enough. Cross-publisher rows must agree on title, start time,
 * and venue/geo. The output keeps every compact source atom and field provenance
 * so corroboration raises trust without erasing where facts came from.
 */
function fuseTimeSensitiveEvents(events = []) {
  const sorted = (Array.isArray(events) ? events : [])
    .filter((event) => event && typeof event === "object" && !Array.isArray(event))
    .slice()
    .sort(compareEventsForGrouping);
  const groups = [];

  for (const event of sorted) {
    const group = groups.find((candidate) =>
      candidate.every((member) => eventsRepresentSameOccurrence(member, event)),
    );
    if (group) {
      group.push(event);
    } else {
      groups.push([event]);
    }
  }

  return groups.map(buildFusedEvent);
}

function eventsRepresentSameOccurrence(left, right) {
  if (!left || !right) return false;
  if (normalizedText(left.city) && normalizedText(right.city) && normalizedText(left.city) !== normalizedText(right.city)) {
    return false;
  }

  const samePublisher = sourceIdentity(left) === sourceIdentity(right);
  const sameStableId = nonEmpty(left.id) && nonEmpty(right.id) && nonEmpty(left.id) === nonEmpty(right.id);
  const leftSourceUrl = canonicalUrl(left.source_url || left.provenance?.source_url);
  const rightSourceUrl = canonicalUrl(right.source_url || right.provenance?.source_url);
  const sameSourceUrl = Boolean(leftSourceUrl && leftSourceUrl === rightSourceUrl);

  if ((samePublisher && sameStableId) || sameSourceUrl) {
    return temporalOccurrencesCompatible(left, right, { allowBothMissing: true });
  }

  if (
    !normalizedText(left.title || left.name) ||
    normalizedText(left.title || left.name) !== normalizedText(right.title || right.name)
  ) {
    return false;
  }
  if (!temporalOccurrencesCompatible(left, right)) return false;
  return locationsMatch(left, right);
}

function buildFusedEvent(members) {
  const ranked = members.slice().sort(comparePrimaryEvidence);
  const primary = ranked[0];
  const merged = { ...primary };
  const fieldProvenance = {};

  for (const field of [
    "title",
    "name",
    "starts_at",
    "ends_at",
    "starts_on",
    "ends_on",
    "place_context",
    "address",
    "area",
    "time_window",
    "recurrence",
    "route_role_hint",
    "timezone",
    "source_language",
    "event_language",
    "translation_status",
    "translation_confidence",
  ]) {
    const owner = ranked.find((event) => hasValue(event[field]));
    if (!hasValue(merged[field]) && owner) merged[field] = owner[field];
    if (owner) fieldProvenance[field] = sourceIdentity(owner);
  }

  const coordinateOwner = ranked.find((event) => finiteCoordinates(event));
  if (!finiteCoordinates(merged) && coordinateOwner) {
    merged.lat = coordinateOwner.lat;
    merged.lng = coordinateOwner.lng;
  }
  if (coordinateOwner) {
    fieldProvenance.lat = sourceIdentity(coordinateOwner);
    fieldProvenance.lng = sourceIdentity(coordinateOwner);
    if (coordinateOwner.venue_resolution) {
      merged.venue_resolution = coordinateOwner.venue_resolution;
      fieldProvenance.venue_resolution = sourceIdentity(coordinateOwner);
    }
  }

  merged.tags = unionValues(ranked.flatMap((event) => event.tags || []));
  merged.intents = unionValues(ranked.flatMap((event) => event.intents || []));
  merged.translated_atoms = unionValues(ranked.flatMap((event) => event.translated_atoms || []));
  merged.timing_reasons = unionValues(ranked.flatMap((event) => event.timing_reasons || []));

  const sources = uniqueSources(ranked.map(sourceEvidence));
  const independentSourceCount = countIndependentSources(sources);
  const conflicts = detectConflicts(ranked);
  const staleEvidence = ranked.some(
    (event) => event.freshness === "stale" || event.timing_relevance === "stale",
  );
  const fusionStatus = conflicts.length
    ? "conflict"
    : independentSourceCount >= 2
      ? "corroborated"
      : "single_source";
  const confidence = calibrateFusedConfidence({
    primaryConfidence: merged.confidence,
    sources,
    independentSourceCount,
    conflicts,
    staleEvidence,
  });
  const fusionReasons = buildFusionReasons({
    fusionStatus,
    independentSourceCount,
    sources,
    staleEvidence,
  });

  if (staleEvidence) {
    merged.freshness = "stale";
    merged.timing_relevance = "stale";
  }
  merged.confidence = confidence;
  merged.fusion_id = buildFusionId(ranked);
  merged.fusion_status = fusionStatus;
  merged.source_count = sources.length;
  merged.independent_source_count = independentSourceCount;
  merged.sources = sources;
  merged.field_provenance = fieldProvenance;
  merged.conflicts = conflicts;
  merged.fusion_reasons = fusionReasons;
  merged.corroboration = {
    status: fusionStatus,
    independent_source_count: independentSourceCount,
    source_count: sources.length,
    reasons: fusionReasons,
  };

  return merged;
}

function detectConflicts(events) {
  const conflicts = [];
  if (dateSpread(events.map((event) => event.starts_at)) > START_CONFLICT_TOLERANCE_MS) {
    conflicts.push("starts_at_disagreement");
  }
  if (dateSpread(events.map((event) => event.ends_at)) > END_CONFLICT_TOLERANCE_MS) {
    conflicts.push("ends_at_disagreement");
  }
  const staleStates = new Set(
    events.map((event) => event.freshness === "stale" || event.timing_relevance === "stale"),
  );
  if (staleStates.size > 1) conflicts.push("freshness_disagreement");
  return conflicts;
}

function calibrateFusedConfidence({
  primaryConfidence,
  sources,
  independentSourceCount,
  conflicts,
  staleEvidence,
}) {
  let confidence = normalizeConfidence(primaryConfidence);
  const allWeak = sources.length > 0 && sources.every(isWeakSource);
  const hasTrustedSource = sources.some((source) => ["official", "verified", "curated"].includes(source.tier));

  if (allWeak && confidenceRank(confidence) > confidenceRank("low")) {
    confidence = "low";
  }
  if (
    independentSourceCount >= 2 &&
    hasTrustedSource &&
    conflicts.length === 0 &&
    !staleEvidence &&
    confidenceRank(confidence) < confidenceRank("medium")
  ) {
    confidence = "medium";
  }
  if ((conflicts.length > 0 || staleEvidence) && confidenceRank(confidence) > confidenceRank("low")) {
    confidence = "low";
  }
  return confidence;
}

function buildFusionReasons({ fusionStatus, independentSourceCount, sources, staleEvidence }) {
  const reasons = [`event_evidence_${fusionStatus}`];
  reasons.push(`independent_sources_${independentSourceCount}`);
  if (sources.length > independentSourceCount) reasons.push("source_rows_not_independent");
  if (sources.length > 0 && sources.every(isWeakSource)) reasons.push("weak_sources_only");
  if (staleEvidence) reasons.push("stale_source_evidence");
  return reasons;
}

function sourceEvidence(event) {
  return compactObject({
    identity: sourceIdentity(event),
    provider_id: nonEmpty(event.source_provider_id),
    family: nonEmpty(event.source_family || event.source_type),
    label: nonEmpty(event.source_label || event.provenance?.source_label),
    url: nonEmpty(event.source_url || event.provenance?.source_url),
    type: nonEmpty(event.source_type),
    tier: nonEmpty(event.source_tier),
    confidence: normalizeConfidence(event.confidence),
    attribution: nonEmpty(event.provenance?.attribution),
    license: nonEmpty(event.provenance?.license),
  });
}

function uniqueSources(sources) {
  const seen = new Set();
  return sources
    .filter(Boolean)
    .sort((left, right) => sourceSortKey(left).localeCompare(sourceSortKey(right)))
    .filter((source) => {
      const key = sourceSortKey(source);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function countIndependentSources(sources) {
  const parents = sources.map((_source, index) => index);
  const find = (index) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let left = 0; left < sources.length; left += 1) {
    for (let right = left + 1; right < sources.length; right += 1) {
      const sameIdentity = sources[left].identity === sources[right].identity;
      const leftUrl = canonicalUrl(sources[left].url);
      const sameCanonicalUrl = Boolean(leftUrl && leftUrl === canonicalUrl(sources[right].url));
      if (sameIdentity || sameCanonicalUrl) union(left, right);
    }
  }

  return new Set(sources.map((_source, index) => find(index))).size;
}

function sourceSortKey(source) {
  return [source.identity, source.provider_id, canonicalUrl(source.url), source.label]
    .map((value) => normalizedText(value))
    .join("|");
}

function sourceIdentity(event) {
  const explicit = nonEmpty(event.source_identity || event.publisher_id);
  if (explicit) return canonicalIdentity(explicit);
  const host = urlHost(event.source_url || event.provenance?.source_url);
  if (host) return host;
  const providerId = nonEmpty(event.source_provider_id);
  if (providerId) return canonicalIdentity(providerId);
  const label = nonEmpty(event.source_label || event.provenance?.source_label);
  return canonicalIdentity(label) || "unknown-source";
}

function locationsMatch(left, right) {
  if (finiteCoordinates(left) && finiteCoordinates(right)) {
    return distanceKm(left, right) <= LOCATION_MATCH_RADIUS_KM;
  }
  const leftPlace = normalizedPlace(left);
  const rightPlace = normalizedPlace(right);
  return Boolean(leftPlace && rightPlace && leftPlace === rightPlace);
}

function normalizedPlace(event) {
  const place = normalizedText(event.place_context || event.area);
  const city = normalizedText(event.city);
  if (!place || place === city || place.length < 3) return "";
  return place;
}

function startsCompatible(leftValue, rightValue, { allowBothMissing = false } = {}) {
  const left = parseTimestamp(leftValue);
  const right = parseTimestamp(rightValue);
  if (left == null || right == null) return allowBothMissing && left == null && right == null;
  return Math.abs(left - right) <= START_MATCH_TOLERANCE_MS;
}

function temporalOccurrencesCompatible(left, right, { allowBothMissing = false } = {}) {
  const leftKind = temporalKind(left);
  const rightKind = temporalKind(right);
  if (leftKind === "unknown" || rightKind === "unknown") {
    return allowBothMissing && leftKind === "unknown" && rightKind === "unknown";
  }
  if (leftKind !== rightKind) return false;
  if (leftKind === "continuous") {
    return startsCompatible(left.starts_at, right.starts_at, { allowBothMissing });
  }
  if (leftKind === "daily") {
    const leftSignature = dailyTemporalSignature(left);
    return Boolean(leftSignature && leftSignature === dailyTemporalSignature(right));
  }
  const leftSignature = allDayTemporalSignature(left);
  return Boolean(leftSignature && leftSignature === allDayTemporalSignature(right));
}

function temporalKind(event) {
  const declared = nonEmpty(event?.time_window?.kind).toLowerCase();
  if (["continuous", "daily", "all_day"].includes(declared)) return declared;
  if (parseTimestamp(event?.starts_at) != null) return "continuous";
  if (dateOnly(event?.starts_on)) return "all_day";
  return "unknown";
}

function dateOnly(value) {
  const raw = nonEmpty(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : "";
}

function localClock(value) {
  const raw = nonEmpty(value);
  return /^\d{2}:\d{2}(?::\d{2})?$/.test(raw) ? raw : "";
}

function dailyTemporalSignature(event) {
  const startsOn = dateOnly(event?.starts_on || event?.time_window?.starts_on);
  const endsOn = dateOnly(event?.ends_on || event?.time_window?.ends_on);
  const startsAt = localClock(event?.time_window?.local_start);
  const endsAt = localClock(event?.time_window?.local_end);
  const timezone = nonEmpty(event?.timezone || event?.time_window?.timezone);
  return startsOn && endsOn && startsAt && endsAt && timezone
    ? [startsOn, endsOn, startsAt, endsAt, timezone].join("|")
    : "";
}

function allDayTemporalSignature(event) {
  const startsOn = dateOnly(event?.starts_on || event?.time_window?.starts_on);
  const endsOn = dateOnly(event?.ends_on || event?.time_window?.ends_on);
  return startsOn && endsOn ? `${startsOn}|${endsOn}` : "";
}

function dateSpread(values) {
  const timestamps = values.map(parseTimestamp).filter((value) => value != null);
  if (timestamps.length < 2) return 0;
  return Math.max(...timestamps) - Math.min(...timestamps);
}

function parseTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteCoordinates(event) {
  return Number.isFinite(event?.lat) && Number.isFinite(event?.lng);
}

function distanceKm(left, right) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(right.lat - left.lat);
  const dLng = toRad(right.lng - left.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function compareEventsForGrouping(left, right) {
  return eventSortKey(left).localeCompare(eventSortKey(right));
}

function eventSortKey(event) {
  return [
    temporalSortKey(event),
    normalizedText(event.title || event.name),
    normalizedPlace(event),
    sourceIdentity(event),
    nonEmpty(event.id),
  ].join("|");
}

function comparePrimaryEvidence(left, right) {
  return (
    sourceTierRank(right.source_tier) - sourceTierRank(left.source_tier) ||
    confidenceRank(right.confidence) - confidenceRank(left.confidence) ||
    evidenceCompleteness(right) - evidenceCompleteness(left) ||
    eventSortKey(left).localeCompare(eventSortKey(right))
  );
}

function evidenceCompleteness(event) {
  return [
    event.title || event.name,
    event.starts_at || event.starts_on,
    event.ends_at || event.ends_on,
    event.place_context,
    event.address,
    finiteCoordinates(event),
    event.source_url || event.provenance?.source_url,
  ].filter(Boolean).length;
}

function sourceTierRank(value) {
  return SOURCE_TIER_RANK[nonEmpty(value).toLowerCase()] || 0;
}

function confidenceRank(value) {
  return CONFIDENCE_RANK[normalizeConfidence(value)] || 0;
}

function isWeakSource(source) {
  const family = normalizedText(source.family);
  return (
    ["inferred", "fallback"].includes(nonEmpty(source.tier).toLowerCase()) ||
    /social|community|manual/.test(family)
  );
}

function buildFusionId(events) {
  const primary = events.slice().sort(comparePrimaryEvidence)[0] || {};
  const raw = [
    normalizedText(primary.city),
    normalizedText(primary.title || primary.name),
    temporalSortKey(primary),
    normalizedPlace(primary),
    finiteCoordinates(primary) ? `${Number(primary.lat).toFixed(4)},${Number(primary.lng).toFixed(4)}` : "",
  ].join("|");
  return `event-fusion-${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
}

function temporalSortKey(event) {
  const kind = temporalKind(event);
  if (kind === "continuous") return `${kind}|${nonEmpty(event.starts_at)}`;
  if (kind === "daily") {
    return [
      kind,
      dateOnly(event.starts_on || event.time_window?.starts_on),
      dateOnly(event.ends_on || event.time_window?.ends_on),
      localClock(event.time_window?.local_start),
      localClock(event.time_window?.local_end),
      nonEmpty(event.timezone || event.time_window?.timezone),
    ].join("|");
  }
  if (kind === "all_day") {
    return [
      kind,
      dateOnly(event.starts_on || event.time_window?.starts_on),
      dateOnly(event.ends_on || event.time_window?.ends_on),
    ].join("|");
  }
  return "unknown";
}

function canonicalUrl(value) {
  const raw = nonEmpty(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) =>
      url.searchParams.delete(key),
    );
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch (_error) {
    return raw.toLowerCase();
  }
}

function urlHost(value) {
  try {
    return new URL(nonEmpty(value)).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_error) {
    return "";
  }
}

function normalizedText(value) {
  return nonEmpty(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function canonicalIdentity(value) {
  return nonEmpty(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._:-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function unionValues(values) {
  return [...new Set(values.map(nonEmpty).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function nonEmpty(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""),
  );
}

module.exports = {
  START_MATCH_TOLERANCE_MS,
  LOCATION_MATCH_RADIUS_KM,
  fuseTimeSensitiveEvents,
  eventsRepresentSameOccurrence,
  sourceIdentity,
};
