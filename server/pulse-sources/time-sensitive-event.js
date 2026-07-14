const { normalizeConfidence } = require("./display-gates");
const {
  datePartsInTimezone,
  normalizeIanaTimezone,
} = require("./source-event-time");

const VALID_TIMING_RELEVANCE = new Set(["now", "today", "tonight", "future", "stale", "unknown"]);
const EVENING_START_HOUR = 17;

function normalizeTimeSensitiveSourceEvent(rawEvent, options = {}) {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return null;
  }

  const now = parseDate(options.now || rawEvent.now);
  const startsAt = parseDate(rawEvent.starts_at || rawEvent.start_at || rawEvent.start_date);
  const endsAt = parseDate(rawEvent.ends_at || rawEvent.end_at || rawEvent.end_date);
  const lastChecked = parseDate(rawEvent.last_checked || rawEvent.fetched_at || rawEvent.checked_at);
  const timezone = normalizeIanaTimezone(options.timezone);
  const sourceUrl = firstString(rawEvent.source_url, rawEvent.url);
  const sourceLabel = firstString(rawEvent.source_label, rawEvent.provider, rawEvent.source?.label);
  const provenance = normalizeProvenance(rawEvent.provenance, { sourceUrl, sourceLabel });
  const hasSourceBacking = Boolean(sourceUrl || sourceLabel || provenance);
  const timingRelevance = normalizeTimingRelevance(
    rawEvent.timing_relevance,
    {
      now,
      startsAt,
      endsAt,
      freshness: rawEvent.freshness,
      timezone,
    },
  );
  const confidence = normalizeEventConfidence(rawEvent.confidence, {
    hasSourceBacking,
    timingRelevance,
  });
  const coordinates = normalizeCoordinates(rawEvent);

  return compactObject({
    id: firstString(rawEvent.id, rawEvent.source_event_id, rawEvent.provider_id, sourceUrl),
    title: firstString(rawEvent.title, rawEvent.name),
    name: firstString(rawEvent.name, rawEvent.title),
    source_url: sourceUrl || null,
    source_label: sourceLabel || null,
    source_type: firstString(rawEvent.source_type, rawEvent.sourceType, rawEvent.source?.type),
    source_tier: firstString(rawEvent.source_tier, rawEvent.sourceTier, rawEvent.source?.tier),
    source_provider_id: firstString(rawEvent.source_provider_id, rawEvent.sourceProviderId, rawEvent.source?.id),
    source_identity: firstString(rawEvent.source_identity, rawEvent.publisher_id, rawEvent.publisherId),
    source_family: firstString(rawEvent.source_family, rawEvent.sourceFamily, rawEvent.source?.family),
    city: firstString(rawEvent.city, options.city),
    place_context: firstString(rawEvent.place_context, rawEvent.place, rawEvent.venue),
    lat: coordinates.lat,
    lng: coordinates.lng,
    area: firstString(rawEvent.area, rawEvent.neighborhood, rawEvent.district),
    starts_at: startsAt ? startsAt.toISOString() : null,
    ends_at: endsAt ? endsAt.toISOString() : null,
    time_window: normalizeTimeWindow(rawEvent.time_window, startsAt, endsAt),
    recurrence: normalizeRecurrence(rawEvent.recurrence),
    freshness: firstString(rawEvent.freshness) || (timingRelevance === "stale" ? "stale" : null),
    last_checked: lastChecked ? lastChecked.toISOString() : null,
    confidence,
    source_language: normalizeLanguage(rawEvent.source_language || rawEvent.language),
    event_language: normalizeLanguage(rawEvent.event_language || rawEvent.source_language || rawEvent.language),
    translation_status: normalizeTranslationStatus(rawEvent.translation_status || rawEvent.translation?.status),
    translation_confidence: normalizeTranslationConfidence(
      rawEvent.translation_confidence || rawEvent.translation?.confidence,
    ),
    translated_atoms: normalizeStringList(rawEvent.translated_atoms || rawEvent.translation?.atoms),
    provenance,
    candidate_kind: "source_event",
    tags: normalizeStringList(rawEvent.tags),
    intents: normalizeStringList(rawEvent.intents || rawEvent.match_tags),
    route_role_hint: firstString(rawEvent.route_role_hint, rawEvent.routeRoleHint),
    timing_relevance: timingRelevance,
    timezone,
    timing_reasons: timingReasons(timingRelevance, {
      hasNow: Boolean(now),
      hasStartsAt: Boolean(startsAt),
      hasEndsAt: Boolean(endsAt),
      hasSourceBacking,
      confidence,
    }),
  });
}

function normalizeTimingRelevance(explicit, facts = {}) {
  const { now, startsAt, endsAt } = facts;
  if (firstString(facts.freshness) === "stale") {
    return "stale";
  }
  if (now && endsAt && endsAt < now) {
    return "stale";
  }

  const explicitValue = firstString(explicit);
  if (VALID_TIMING_RELEVANCE.has(explicitValue)) {
    return explicitValue;
  }

  if (!now || !startsAt) {
    return "unknown";
  }

  if (startsAt <= now && (!endsAt || endsAt >= now)) {
    return "now";
  }
  const localStart = facts.timezone
    ? datePartsInTimezone(startsAt, facts.timezone)
    : null;
  const localNow = facts.timezone
    ? datePartsInTimezone(now, facts.timezone)
    : null;
  if (localStart && localNow) {
    if (sameDateParts(localStart, localNow)) {
      return localStart.hour >= EVENING_START_HOUR ? "tonight" : "today";
    }
  } else if (sameUtcDate(startsAt, now)) {
    return startsAt.getUTCHours() >= EVENING_START_HOUR ? "tonight" : "today";
  }
  if (startsAt > now) {
    return "future";
  }
  return "stale";
}

function normalizeEventConfidence(value, { hasSourceBacking, timingRelevance }) {
  let confidence = normalizeConfidence(value || "needs_review");
  if (!hasSourceBacking && confidence === "strong") {
    confidence = "medium";
  }
  if (timingRelevance === "stale" && confidenceAtLeast(confidence, "medium")) {
    confidence = "low";
  }
  return confidence;
}

function timingReasons(timingRelevance, facts = {}) {
  const reasons = [`timing_${timingRelevance}`];
  if (facts.hasNow) reasons.push("has_now_context");
  if (facts.hasStartsAt) reasons.push("has_start_time");
  if (facts.hasEndsAt) reasons.push("has_end_time");
  if (facts.hasSourceBacking) reasons.push("has_source_backing");
  if (!facts.hasSourceBacking) reasons.push("missing_source_backing");
  reasons.push(`confidence_${facts.confidence || "needs_review"}`);
  return reasons;
}

function normalizeProvenance(value, { sourceUrl, sourceLabel } = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return compactObject({
      source_url: firstString(value.source_url, value.url, sourceUrl),
      source_label: firstString(value.source_label, value.label, sourceLabel),
      retrieved_at: firstString(value.retrieved_at, value.checked_at),
      attribution: firstString(value.attribution),
      license: firstString(value.license),
    });
  }
  if (sourceUrl || sourceLabel) {
    return compactObject({
      source_url: sourceUrl || null,
      source_label: sourceLabel || null,
    });
  }
  return null;
}

function normalizeTimeWindow(value, startsAt, endsAt) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return compactObject({
      label: firstString(value.label),
      starts_at: parseDate(value.starts_at || value.start)?.toISOString() || (startsAt ? startsAt.toISOString() : null),
      ends_at: parseDate(value.ends_at || value.end)?.toISOString() || (endsAt ? endsAt.toISOString() : null),
    });
  }
  if (startsAt || endsAt) {
    return compactObject({
      starts_at: startsAt ? startsAt.toISOString() : null,
      ends_at: endsAt ? endsAt.toISOString() : null,
    });
  }
  return null;
}

function normalizeRecurrence(value) {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return compactObject({
      rule: firstString(value.rule),
      label: firstString(value.label),
      timezone: firstString(value.timezone),
    });
  }
  return null;
}

function normalizeCoordinates(rawEvent) {
  const lat = normalizeFiniteNumber(rawEvent.lat ?? rawEvent.latitude);
  const lng = normalizeFiniteNumber(rawEvent.lng ?? rawEvent.lon ?? rawEvent.longitude);
  return {
    lat,
    lng,
  };
}

function normalizeStringList(value) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(items.map((item) => firstString(item)).filter(Boolean))];
}

function normalizeLanguage(value) {
  const raw = firstString(value).toLowerCase();
  return /^[a-z]{2,3}(-[a-z0-9]+)?$/.test(raw) ? raw : "";
}

function normalizeTranslationStatus(value) {
  const raw = firstString(value).toLowerCase();
  return ["not_required", "needed", "provided", "unavailable", "unknown"].includes(raw) ? raw : "";
}

function normalizeTranslationConfidence(value) {
  const raw = firstString(value).toLowerCase();
  return ["high", "medium", "low", "none", "unknown"].includes(raw) ? raw : "";
}

function parseDate(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeFiniteNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function confidenceAtLeast(value, minimum) {
  const rank = { needs_review: 0, low: 1, medium: 2, strong: 3 };
  return (rank[normalizeConfidence(value)] || 0) >= (rank[normalizeConfidence(minimum)] || 0);
}

function sameUtcDate(a, b) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function sameDateParts(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function firstString(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function compactObject(value) {
  const out = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry !== undefined && entry !== null && entry !== "") {
      out[key] = entry;
    }
  }
  return Object.keys(out).length ? out : null;
}

module.exports = {
  normalizeTimeSensitiveSourceEvent,
  normalizeTimingRelevance,
};
