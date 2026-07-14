const VALID_SOURCE_ROLES = new Set([
  "official_live_baseline",
  "market_rhythm",
  "neighborhood_culture",
  "secondary_culture_source",
  "venue_programming",
  "coast_or_dayflow_signal",
  "computed_daily_signal",
  "weather_context",
  "transport_context",
  "air_quality_context",
]);

const VALID_SOURCE_TYPES = new Set([
  "official_open_data",
  "official_api",
  "official_website",
  "venue_feed",
  "computed",
  "weather",
  "transport",
  "environmental",
  "partner_feed",
]);

const VALID_SOURCE_STATUSES = new Set(["active", "candidate", "review-needed", "disabled"]);
const VALID_INTENDED_USES = new Set(["pulse", "live", "routes", "place_candidates", "both"]);
const VALID_PARSING_RISKS = new Set(["low", "medium", "high", "review-needed"]);
const VALID_TRUST_TIERS = new Set(["official", "verified", "curated", "editorial", "inferred", "fallback"]);
const VALID_CACHE_POLICIES = new Set(["none", "memory", "stale-while-revalidate", "external"]);

function normalizeSourceDescriptor(descriptor, label = "sourceDescriptor") {
  assertPlainObject(descriptor, label);

  const normalized = {
    id: nonEmptyString(descriptor.id, `${label}.id`),
    city: nonEmptyString(descriptor.city, `${label}.city`),
    role: choice(descriptor.role, `${label}.role`, VALID_SOURCE_ROLES),
    sourceType: choice(descriptor.sourceType, `${label}.sourceType`, VALID_SOURCE_TYPES),
    status: choice(descriptor.status, `${label}.status`, VALID_SOURCE_STATUSES),
    intendedUse: choice(descriptor.intendedUse, `${label}.intendedUse`, VALID_INTENDED_USES),
    supportedLanguages: stringArray(descriptor.supportedLanguages, `${label}.supportedLanguages`),
    updateCadence: nonEmptyString(descriptor.updateCadence, `${label}.updateCadence`),
    parsingRisk: choice(descriptor.parsingRisk, `${label}.parsingRisk`, VALID_PARSING_RISKS),
    trust: normalizeTrust(descriptor.trust, `${label}.trust`),
    cachePolicy: normalizeCachePolicy(descriptor.cachePolicy, `${label}.cachePolicy`),
    sourceOwnedFields: stringArray(descriptor.sourceOwnedFields, `${label}.sourceOwnedFields`),
    parrandaOwnedFields: stringArray(descriptor.parrandaOwnedFields || [], `${label}.parrandaOwnedFields`, {
      allowEmpty: true,
    }),
  };

  if (descriptor.label !== undefined) {
    normalized.label = nonEmptyString(descriptor.label, `${label}.label`);
  }

  if (descriptor.sourceUrl !== undefined) {
    normalized.sourceUrl = httpUrl(descriptor.sourceUrl, `${label}.sourceUrl`);
  }

  if (descriptor.publisherId !== undefined || descriptor.publisher_id !== undefined) {
    normalized.publisherId = nonEmptyString(
      descriptor.publisherId || descriptor.publisher_id,
      `${label}.publisherId`,
    );
  }

  if (descriptor.sourceFamily !== undefined || descriptor.source_family !== undefined) {
    normalized.sourceFamily = nonEmptyString(
      descriptor.sourceFamily || descriptor.source_family,
      `${label}.sourceFamily`,
    );
  }

  return normalized;
}

function normalizeTrust(trust, label) {
  assertPlainObject(trust, label);
  return {
    source_tier: choice(trust.source_tier || trust.sourceTier, `${label}.source_tier`, VALID_TRUST_TIERS),
    confidence: choice(
      trust.confidence,
      `${label}.confidence`,
      new Set(["high", "medium", "low", "needs_review"]),
    ),
    human_verified: boolean(trust.human_verified ?? trust.humanVerified, `${label}.human_verified`),
    freshness: choice(trust.freshness, `${label}.freshness`, new Set(["live", "fresh", "stale", "unknown"])),
  };
}

function normalizeCachePolicy(cachePolicy, label) {
  assertPlainObject(cachePolicy, label);
  return {
    kind: choice(cachePolicy.kind || cachePolicy.type, `${label}.kind`, VALID_CACHE_POLICIES),
    ttlSeconds: optionalNonNegativeNumber(cachePolicy.ttlSeconds ?? cachePolicy.ttl_seconds, `${label}.ttlSeconds`),
    staleTtlSeconds: optionalNonNegativeNumber(
      cachePolicy.staleTtlSeconds ?? cachePolicy.stale_ttl_seconds,
      `${label}.staleTtlSeconds`,
    ),
  };
}

function validateSourceDescriptor(descriptor, label = "sourceDescriptor") {
  return normalizeSourceDescriptor(descriptor, label);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function stringArray(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new Error(`${label} must include at least one value`);
  }
  return value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
}

function choice(value, label, choices) {
  const normalized = nonEmptyString(value, label);
  if (!choices.has(normalized)) {
    throw new Error(`${label} has unsupported value ${normalized}`);
  }
  return normalized;
}

function httpUrl(value, label) {
  const raw = nonEmptyString(value, label);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https`);
  }
  return raw;
}

function optionalNonNegativeNumber(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

module.exports = {
  VALID_SOURCE_ROLES,
  VALID_SOURCE_TYPES,
  VALID_SOURCE_STATUSES,
  VALID_INTENDED_USES,
  VALID_PARSING_RISKS,
  VALID_TRUST_TIERS,
  VALID_CACHE_POLICIES,
  normalizeSourceDescriptor,
  validateSourceDescriptor,
};
