const VALID_CANDIDATE_KINDS = new Set([
  "real_place",
  "event_venue",
  "structural_anchor",
  "area_preset",
  "generated_place",
  "map_result",
  "draft_place",
]);

const VALID_TRUST_TIERS = new Set([
  "official",
  "verified",
  "computed",
  "curated",
  "editorial",
  "inferred",
  "fallback",
]);

const VALID_CONFIDENCE_LEVELS = new Set(["high", "medium", "low", "needs_review"]);
const VALID_FRESHNESS_LEVELS = new Set(["live", "fresh", "stale", "unknown"]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be true or false`);
  }
}

function assertValidChoice(value, label, choices) {
  if (!choices.has(value)) {
    throw new Error(`${label} has unsupported value ${value}`);
  }
}

function assertHttpUrl(value, label) {
  assertNonEmptyString(value, label);
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https`);
  }
}

function assertCoordinate(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a valid coordinate`);
  }
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [
    ...new Set(
      values
        .map((value) => normalizeString(value))
        .filter(Boolean),
    ),
  ];
}

function normalizeCandidateKind(candidate) {
  const explicit = normalizeString(candidate.candidate_kind || candidate.candidateKind);
  if (explicit) return explicit;
  if (candidate.is_structural === true || candidate.structuralRouteAnchor === true) {
    return "structural_anchor";
  }
  if (candidate.source?.kind === "live_feed" || candidate.source?.kind === "event") {
    return "event_venue";
  }
  return "real_place";
}

function normalizeSource(source = {}) {
  const normalized = {
    kind: normalizeString(source.kind),
  };

  const id = normalizeString(source.id);
  const label = normalizeString(source.label);
  const url = normalizeString(source.url);

  if (id) normalized.id = id;
  if (label) normalized.label = label;
  if (url) normalized.url = url;

  return normalized;
}

function normalizeTrust(candidate) {
  const trust = candidate.trust && typeof candidate.trust === "object" ? candidate.trust : {};
  const sourceTier = normalizeString(trust.source_tier || trust.sourceTier || candidate.source_tier);
  const confidence = normalizeString(trust.confidence || candidate.confidence);
  const freshness = normalizeString(trust.freshness || candidate.freshness);

  return {
    source_tier: sourceTier || "inferred",
    confidence: confidence || "needs_review",
    human_verified:
      typeof trust.human_verified === "boolean"
        ? trust.human_verified
        : Boolean(trust.humanVerified || candidate.human_verified),
    freshness: freshness || "unknown",
  };
}

function normalizePlaceCandidate(candidate) {
  assertPlainObject(candidate, "placeCandidate");

  const candidateKind = normalizeCandidateKind(candidate);
  const trust = normalizeTrust(candidate);

  const normalized = {
    id: normalizeString(candidate.id),
    city: normalizeString(candidate.city),
    label: normalizeString(candidate.label || candidate.name),
    type: normalizeString(candidate.type || candidate.kind),
    candidate_kind: candidateKind,
    is_structural: ["structural_anchor", "area_preset"].includes(candidateKind),
    source: normalizeSource(candidate.source),
    trust,
    freshness: trust.freshness,
    tags: normalizeStringArray(candidate.tags),
    vibes: normalizeStringArray(candidate.vibes),
    time_fit: normalizeStringArray(candidate.time_fit || candidate.timeFit),
    route_roles: normalizeStringArray(candidate.route_roles || candidate.routeRoles),
    confidence: trust.confidence,
    city_pack_owned: Boolean(candidate.city_pack_owned || candidate.cityPackOwned),
  };

  if (Number.isFinite(candidate.lat)) normalized.lat = candidate.lat;
  if (Number.isFinite(candidate.lng)) normalized.lng = candidate.lng;

  const area = normalizeString(candidate.area || candidate.neighborhood);
  const macro = normalizeString(candidate.macro || candidate.macro_area || candidate.macroArea);
  const neighborhood = normalizeString(candidate.neighborhood);

  if (area) normalized.area = area;
  if (neighborhood) normalized.neighborhood = neighborhood;
  if (macro) normalized.macro = macro;

  return normalized;
}

function validatePlaceCandidate(candidate, label = "placeCandidate") {
  assertPlainObject(candidate, label);

  assertNonEmptyString(candidate.id, `${label}.id`);
  assertNonEmptyString(candidate.city, `${label}.city`);
  assertNonEmptyString(candidate.label, `${label}.label`);
  assertNonEmptyString(candidate.type, `${label}.type`);
  assertValidChoice(candidate.candidate_kind, `${label}.candidate_kind`, VALID_CANDIDATE_KINDS);
  assertBoolean(candidate.is_structural, `${label}.is_structural`);
  assertBoolean(candidate.city_pack_owned, `${label}.city_pack_owned`);

  if ((candidate.lat === undefined) !== (candidate.lng === undefined)) {
    throw new Error(`${label}.lat and ${label}.lng must be provided together`);
  }
  if (candidate.lat !== undefined) {
    assertCoordinate(candidate.lat, -90, 90, `${label}.lat`);
    assertCoordinate(candidate.lng, -180, 180, `${label}.lng`);
  }

  if (candidate.area !== undefined) {
    assertNonEmptyString(candidate.area, `${label}.area`);
  }
  if (candidate.neighborhood !== undefined) {
    assertNonEmptyString(candidate.neighborhood, `${label}.neighborhood`);
  }

  validateCandidateSource(candidate.source, `${label}.source`);
  validateCandidateTrust(candidate.trust, `${label}.trust`);
  assertStringArray(candidate.tags, `${label}.tags`);
  assertStringArray(candidate.vibes, `${label}.vibes`);
  assertStringArray(candidate.time_fit, `${label}.time_fit`);
  assertStringArray(candidate.route_roles, `${label}.route_roles`);
  assertValidChoice(candidate.confidence, `${label}.confidence`, VALID_CONFIDENCE_LEVELS);
  assertValidChoice(candidate.freshness, `${label}.freshness`, VALID_FRESHNESS_LEVELS);

  if (candidate.is_structural && candidate.candidate_kind === "real_place") {
    throw new Error(`${label} cannot be both structural and real_place`);
  }

  return candidate;
}

function validateCandidateSource(source, label = "source") {
  assertPlainObject(source, label);
  assertNonEmptyString(source.kind, `${label}.kind`);
  if (source.id !== undefined) assertNonEmptyString(source.id, `${label}.id`);
  if (source.label !== undefined) assertNonEmptyString(source.label, `${label}.label`);
  if (source.url !== undefined) assertHttpUrl(source.url, `${label}.url`);
  return source;
}

function validateCandidateTrust(trust, label = "trust") {
  assertPlainObject(trust, label);
  assertValidChoice(trust.source_tier, `${label}.source_tier`, VALID_TRUST_TIERS);
  assertValidChoice(trust.confidence, `${label}.confidence`, VALID_CONFIDENCE_LEVELS);
  assertBoolean(trust.human_verified, `${label}.human_verified`);
  assertValidChoice(trust.freshness, `${label}.freshness`, VALID_FRESHNESS_LEVELS);
  return trust;
}

function assertStringArray(values, label) {
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array`);
  }
  values.forEach((value, index) => {
    assertNonEmptyString(value, `${label}[${index}]`);
  });
}

module.exports = {
  VALID_CANDIDATE_KINDS,
  VALID_TRUST_TIERS,
  VALID_CONFIDENCE_LEVELS,
  VALID_FRESHNESS_LEVELS,
  normalizePlaceCandidate,
  validatePlaceCandidate,
  validateCandidateSource,
  validateCandidateTrust,
};
