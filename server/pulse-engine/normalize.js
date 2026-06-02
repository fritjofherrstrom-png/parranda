/**
 * Normalize a RawSignal coming out of a generator into a PulseSignal.
 *
 * Generators may emit partial shapes (especially the editorial generator
 * which wraps legacy items). normalize() fills defaults and guarantees
 * the schema contract for downstream consumers.
 *
 * The function is intentionally permissive: legacy fields (kind, when,
 * where, why_it_matters) survive on the output so the frontend keeps
 * working through one release before the items[] compat buffer is dropped.
 *
 * Chip labels are resolved via the existing `pulse.signal_type.*` i18n
 * keys (introduced in PR #98 for the Blitz chip) so the city-page chip
 * and the Blitz chip stay in sync vocabulary-wise.
 */

const { translate } = require("../ui-i18n");
const { classifySignalQuality } = require("./signal-quality");

const CHIPPABLE_SIGNAL_TYPES = new Set([
  "evening_window",
  "crowd_warning",
  "golden_hour",
  "live_event_nearby",
]);

/**
 * @param {import("./types").RawSignal} raw
 * @param {import("./types").EngineContext} context
 * @returns {import("./types").PulseSignal | null}
 */
function normalizeSignal(raw, context) {
  if (!raw || typeof raw !== "object" || !raw.title || !raw.type) {
    return null;
  }

  const reason = raw.reason || raw.why_it_matters || "";
  const editorialPitch = normalizeEditorialPitch(raw);
  const trustLevel = raw.trust_level || inferTrustLevel(raw);
  const freshness = raw.freshness || inferFreshness(raw);
  const source = raw.source || inferSource(raw);
  const id = raw.id || buildDeterministicId(raw, context);
  const score = typeof raw.score === "number" ? raw.score : 0;

  const signalLabel =
    raw.signal_label !== undefined
      ? raw.signal_label
      : buildSignalLabel(raw.type, context.lang);

  const normalized = {
    ...raw,
    id,
    city: raw.city || context.city.key,
    type: raw.type,
    level: raw.level || "city",
    title: raw.title,
    area: raw.area || raw.where || undefined,
    area_tokens: Array.isArray(raw.area_tokens) ? raw.area_tokens : undefined,
    reason,
    editorial_pitch: editorialPitch,
    blurb: raw.blurb || undefined,
    time_window: raw.time_window || undefined,
    source,
    trust_level: trustLevel,
    freshness,
    related_stop_id: raw.related_stop_id || undefined,
    related_route_id: raw.related_route_id || undefined,
    linked_wildcard_id: raw.linked_wildcard_id || undefined,
    action: raw.action || undefined,
    route_hints: raw.route_hints || undefined,
    score,
    matches_vibes: Array.isArray(raw.matches_vibes) ? raw.matches_vibes : undefined,
    // Legacy compat fields kept on the signal — frontend reads these as
    // fallbacks until items[] is fully retired.
    kind: raw.kind || undefined,
    kindLabel: raw.kindLabel || undefined,
    when: raw.when || undefined,
    where: raw.where || raw.area || undefined,
    why_it_matters: reason,
    signal_label: signalLabel,
    official_event_id: raw.official_event_id || undefined,
    place_query: raw.place_query || undefined,
  };

  return {
    ...normalized,
    signal_quality: classifySignalQuality(normalized),
  };
}

const BANNED_EDITORIAL_PITCH_PATTERNS = [
  /worth checking/i,
  /don't miss/i,
  /do not miss/i,
  /must-see/i,
  /must see/i,
  /discover(?:\s+the)?/i,
  /explore(?:\s+the)?/i,
  /unforgettable/i,
  /\bhidden gem\b/i,
];

function normalizeEditorialPitch(raw) {
  const pitch = compactInlineText(raw?.editorial_pitch);
  if (!pitch) return undefined;

  const lowerPitch = pitch.toLowerCase();
  const forbiddenDuplicates = [
    raw?.title,
    raw?.native_title,
    raw?.blurb,
    raw?.source?.label,
    raw?.source_label,
    raw?.provider,
  ]
    .map((value) => compactInlineText(value).toLowerCase())
    .filter(Boolean);

  for (const value of forbiddenDuplicates) {
    if (lowerPitch === value || lowerPitch.startsWith(`${value} `)) {
      return undefined;
    }
  }

  const sourceLabels = [raw?.source?.label, raw?.source_label, raw?.provider]
    .map((value) => compactInlineText(value))
    .filter(Boolean);
  for (const label of sourceLabels) {
    if (label && lowerPitch.includes(label.toLowerCase())) {
      return undefined;
    }
  }

  if (BANNED_EDITORIAL_PITCH_PATTERNS.some((pattern) => pattern.test(pitch))) {
    return undefined;
  }

  return /[.!?]$/.test(pitch) ? pitch : `${pitch}.`;
}

function compactInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildSignalLabel(type, lang) {
  if (!CHIPPABLE_SIGNAL_TYPES.has(type)) {
    return null;
  }
  const label = translate(lang, `pulse.signal_type.${type}`, {}, "");
  return label || null;
}

function inferTrustLevel(raw) {
  if (raw.type === "live_event_nearby") return "official";
  if (raw.source?.kind === "live_feed") return "official";
  if (raw.source?.kind === "computed") return "verified";
  if (raw.source?.kind === "editorial") return "editorial";
  return "editorial";
}

function inferFreshness(raw) {
  if (raw.type === "live_event_nearby") return "today";
  if (raw.type === "golden_hour") return "live";
  if (raw.type === "weather_shift") return "today";
  return "evergreen";
}

function inferSource(raw) {
  if (raw.type === "live_event_nearby") {
    return {
      kind: "live_feed",
      label: raw.source_label || raw.source?.label || null,
      url: raw.source_url || raw.source?.url || undefined,
      id: raw.source_id || raw.source?.id || undefined,
    };
  }
  if (raw.type === "golden_hour") {
    return { kind: "computed", label: "sunset" };
  }
  if (raw.type === "weather_shift") {
    return { kind: "weather", label: "weather" };
  }
  return { kind: "editorial" };
}

function buildDeterministicId(raw, context) {
  const base = `${raw.type}-${raw.title || "untitled"}`;
  return `${context.city.key}-${context.date}-${slugify(base)}`;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

module.exports = {
  normalizeSignal,
  normalizeEditorialPitch,
  BANNED_EDITORIAL_PITCH_PATTERNS,
  buildSignalLabel,
  CHIPPABLE_SIGNAL_TYPES,
};
