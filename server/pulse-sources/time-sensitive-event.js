const { normalizeConfidence } = require("./display-gates");
const {
  datePartsInTimezone,
  normalizeIanaTimezone,
  normalizeSourceEventDate,
  normalizeSourceEventDateTime,
} = require("./source-event-time");

const VALID_TIMING_RELEVANCE = new Set(["now", "today", "tonight", "future", "stale", "unknown"]);
const EVENING_START_HOUR = 17;

function normalizeTimeSensitiveSourceEvent(rawEvent, options = {}) {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return null;
  }

  const timezone = normalizeIanaTimezone(options.timezone);
  const now = parseDate(options.now || rawEvent.now);
  const rawStartsAt = firstString(rawEvent.starts_at, rawEvent.start_at, rawEvent.start_date);
  const rawEndsAt = firstString(rawEvent.ends_at, rawEvent.end_at, rawEvent.end_date);
  const startsAt = parseSourceInstantDate(rawStartsAt, { timezone });
  const endsAt = parseSourceInstantDate(rawEndsAt, { timezone });
  const startsOn = normalizeDateOnly(rawEvent.starts_on, rawEvent.listing_date, rawStartsAt);
  const endsOn = normalizeDateOnly(rawEvent.ends_on, rawEvent.listing_end_date, rawEndsAt);
  const lastChecked = parseDate(rawEvent.last_checked || rawEvent.fetched_at || rawEvent.checked_at);
  const timeWindow = normalizeTimeWindow(rawEvent.time_window, {
    startsAt,
    endsAt,
    startsOn,
    endsOn,
    timezone,
  });
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
      startsOn,
      endsOn,
      timeWindow,
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
    address: firstString(rawEvent.address, rawEvent.venue_address, rawEvent.location_address),
    lat: coordinates.lat,
    lng: coordinates.lng,
    area: firstString(rawEvent.area, rawEvent.neighborhood, rawEvent.district),
    starts_at: startsAt ? startsAt.toISOString() : null,
    ends_at: endsAt ? endsAt.toISOString() : null,
    starts_on: startsOn,
    ends_on: endsOn,
    time_window: timeWindow,
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
    local_significance: normalizeLocalSignificance(rawEvent.local_significance),
    timing_relevance: timingRelevance,
    timezone,
    timing_reasons: timingReasons(timingRelevance, {
      hasNow: Boolean(now),
      hasStartsAt: Boolean(startsAt),
      hasEndsAt: Boolean(endsAt),
      hasStartsOn: Boolean(startsOn),
      hasEndsOn: Boolean(endsOn),
      hasDailyWindow: timeWindow?.kind === "daily",
      hasSourceBacking,
      confidence,
    }),
  });
}

function normalizeLocalSignificance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sourceProminence = firstString(value.source_prominence);
  const programmeEventCount = boundedInteger(value.programme_event_count, 1, 300);
  const programmeDayCount = boundedInteger(value.programme_day_count, 1, 45);
  return compactObject({
    source_prominence: sourceProminence === "dedicated_programme" ? sourceProminence : null,
    programme_event_count: programmeEventCount,
    programme_day_count: programmeDayCount,
    current_year_evidence: value.current_year_evidence === true || null,
  });
}

function boundedInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const integer = Math.floor(number);
  return integer >= min && integer <= max ? integer : null;
}

function normalizeTimingRelevance(explicit, facts = {}) {
  const { now, startsAt, endsAt, timeWindow } = facts;
  if (firstString(facts.freshness) === "stale") {
    return "stale";
  }
  if (now && endsAt && endsAt < now) {
    return "stale";
  }
  if (timeWindow?.kind === "daily") {
    return dailyWindowTimingRelevance(timeWindow, { now, timezone: facts.timezone });
  }
  if (timeWindow?.kind === "all_day") {
    return "unknown";
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
  if (facts.hasStartsOn) reasons.push("has_start_date");
  if (facts.hasEndsOn) reasons.push("has_end_date");
  if (facts.hasDailyWindow) reasons.push("has_daily_time_window");
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

function normalizeTimeWindow(value, facts = {}) {
  const { startsAt, endsAt, startsOn, endsOn, timezone } = facts;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const kind = normalizeTimeWindowKind(value.kind || value.type, value);
    const windowStartsOn = normalizeDateOnly(value.starts_on, value.start_date, startsOn);
    const windowEndsOn = normalizeDateOnly(value.ends_on, value.end_date, endsOn);
    const localStart = normalizeLocalClock(value.local_start || value.starts_at_local || value.start_time);
    const localEnd = normalizeLocalClock(value.local_end || value.ends_at_local || value.end_time);
    if (kind === "daily") {
      return compactObject({
        kind,
        label: firstString(value.label),
        starts_on: windowStartsOn,
        ends_on: windowEndsOn || windowStartsOn,
        local_start: localStart,
        local_end: localEnd,
        timezone,
        spans_midnight: localStart && localEnd
          ? clockMinutes(localEnd) < clockMinutes(localStart) || undefined
          : undefined,
      });
    }
    if (kind === "all_day") {
      return compactObject({
        kind,
        label: firstString(value.label),
        starts_on: windowStartsOn,
        ends_on: windowEndsOn || windowStartsOn,
      });
    }
    return compactObject({
      kind: kind || "continuous",
      label: firstString(value.label),
      starts_at:
        parseSourceInstantDate(value.starts_at || value.start, { timezone })?.toISOString() ||
        (startsAt ? startsAt.toISOString() : null),
      ends_at:
        parseSourceInstantDate(value.ends_at || value.end, { timezone })?.toISOString() ||
        (endsAt ? endsAt.toISOString() : null),
    });
  }
  if (startsAt || endsAt) {
    return compactObject({
      kind: "continuous",
      starts_at: startsAt ? startsAt.toISOString() : null,
      ends_at: endsAt ? endsAt.toISOString() : null,
    });
  }
  if (startsOn) {
    return compactObject({
      kind: "all_day",
      starts_on: startsOn,
      ends_on: endsOn || startsOn,
    });
  }
  return null;
}

function normalizeTimeWindowKind(value, window = {}) {
  const raw = firstString(value).toLowerCase();
  if (["daily", "continuous", "all_day"].includes(raw)) return raw;
  if (window.local_start || window.starts_at_local || window.start_time) return "daily";
  if (window.starts_on || window.start_date) return "all_day";
  return null;
}

function dailyWindowTimingRelevance(window, { now, timezone } = {}) {
  const trustedTimezone = normalizeIanaTimezone(timezone || window.timezone);
  const localNow = now && trustedTimezone ? datePartsInTimezone(now, trustedTimezone) : null;
  const startsOn = normalizeDateOnly(window.starts_on);
  const endsOn = normalizeDateOnly(window.ends_on, startsOn);
  const localStart = normalizeLocalClock(window.local_start);
  const localEnd = normalizeLocalClock(window.local_end);
  if (!localNow || !startsOn || !endsOn || !localStart || !localEnd) return "unknown";
  if (window.spans_midnight || clockMinutes(localEnd) <= clockMinutes(localStart)) return "unknown";

  const today = dateKey(localNow);
  if (today < startsOn) return "future";
  if (today > endsOn) return "stale";

  const nowMinutes = localNow.hour * 60 + localNow.minute;
  const startMinutes = clockMinutes(localStart);
  const endMinutes = clockMinutes(localEnd);
  if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) return "now";
  if (nowMinutes < startMinutes) return startMinutes >= EVENING_START_HOUR * 60 ? "tonight" : "today";
  return today < endsOn ? "future" : "stale";
}

function normalizeLocalClock(value) {
  const match = firstString(value).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${match[1]}:${match[2]}${match[3] ? `:${match[3]}` : ""}`;
}

function clockMinutes(value) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  return hour * 60 + minute;
}

function dateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function normalizeDateOnly(...values) {
  for (const value of values) {
    const normalized = normalizeSourceEventDate(value);
    if (normalized) return normalized;
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

function parseSourceInstantDate(value, { timezone } = {}) {
  if (value instanceof Date) return parseDate(value);
  const normalized = normalizeSourceEventDateTime(value, { timezone });
  return normalized ? parseDate(normalized) : null;
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
