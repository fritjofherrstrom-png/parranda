const VALID_ROUTE_SHAPES = new Set(["loop", "arc", "mini_route", "nearby_move", "fallback"]);
const VALID_ROUTE_SOURCE_KINDS = new Set([
  "curated_template",
  "candidate_provider",
  "live_assisted",
  "generated",
  "fallback",
]);
const VALID_CONFIDENCE_LEVELS = new Set(["high", "medium", "low", "needs_review"]);
const VALID_TRUST_TIERS = new Set([
  "official",
  "verified",
  "computed",
  "curated",
  "editorial",
  "inferred",
  "fallback",
]);
const VALID_STOP_KINDS = new Set(["user_stop", "route_structure"]);

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

function assertNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
}

function assertValidChoice(value, label, choices) {
  if (!choices.has(value)) {
    throw new Error(`${label} has unsupported value ${value}`);
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

function normalizeRouteCandidate(routeCandidate) {
  assertPlainObject(routeCandidate, "routeCandidate");

  const stops = normalizeRouteStops(routeCandidate.stops || routeCandidate.stop_ids || routeCandidate.stopIds);
  const sourceMix = normalizeStringArray(routeCandidate.source_mix || routeCandidate.sourceMix);
  const trustSummary = normalizeTrustSummary(routeCandidate.trust_summary || routeCandidate.trustSummary);

  const normalized = {
    id: normalizeString(routeCandidate.id),
    city: normalizeString(routeCandidate.city),
    route_shape: normalizeString(routeCandidate.route_shape || routeCandidate.routeShape || routeCandidate.shape),
    stops,
    start_context: normalizeContext(routeCandidate.start_context || routeCandidate.startContext),
    end_context: normalizeContext(routeCandidate.end_context || routeCandidate.endContext),
    covered_intents: normalizeStringArray(routeCandidate.covered_intents || routeCandidate.coveredIntents),
    missing_intents: normalizeStringArray(routeCandidate.missing_intents || routeCandidate.missingIntents),
    area_flow: normalizeStringArray(routeCandidate.area_flow || routeCandidate.areaFlow),
    macro_flow: normalizeStringArray(routeCandidate.macro_flow || routeCandidate.macroFlow),
    source_mix: sourceMix.length ? sourceMix : ["generated"],
    trust_summary: trustSummary,
    confidence:
      normalizeString(routeCandidate.confidence) || trustSummary.confidence || "needs_review",
    explanation_inputs: normalizeExplanationInputs(
      routeCandidate.explanation_inputs || routeCandidate.explanationInputs,
    ),
    warnings: normalizeStringArray(routeCandidate.warnings),
    limitations: normalizeStringArray(routeCandidate.limitations),
  };

  const distanceKm = routeCandidate.estimated_walking_km ?? routeCandidate.estimatedWalkingKm;
  const durationMinutes =
    routeCandidate.estimated_duration_minutes ?? routeCandidate.estimatedDurationMinutes;

  if (Number.isFinite(distanceKm)) {
    normalized.estimated_walking_km = Number(distanceKm);
  }
  if (Number.isFinite(durationMinutes)) {
    normalized.estimated_duration_minutes = Number(durationMinutes);
  }

  return normalized;
}

function normalizeRouteStops(stopsInput) {
  if (!Array.isArray(stopsInput)) {
    return [];
  }

  return stopsInput
    .map((stop) => normalizeRouteStop(stop))
    .filter((stop) => stop.candidate_id || stop.label);
}

function normalizeRouteStop(stop) {
  if (typeof stop === "string") {
    return {
      candidate_id: normalizeString(stop),
      stop_kind: "user_stop",
      is_user_facing: true,
    };
  }

  assertPlainObject(stop, "routeCandidate.stop");

  const candidateKind = normalizeString(stop.candidate_kind || stop.candidateKind);
  const isStructural =
    stop.is_structural === true ||
    stop.isStructural === true ||
    ["structural_anchor", "area_preset"].includes(candidateKind);
  const explicitStopKind = normalizeString(stop.stop_kind || stop.stopKind);
  const stopKind = explicitStopKind || (isStructural ? "route_structure" : "user_stop");
  const explicitUserFacing =
    typeof stop.is_user_facing === "boolean"
      ? stop.is_user_facing
      : typeof stop.isUserFacing === "boolean"
        ? stop.isUserFacing
        : null;

  const candidateId = normalizeString(stop.candidate_id || stop.candidateId || stop.id);
  const normalized = {
    stop_kind: stopKind,
    is_user_facing: explicitUserFacing ?? stopKind === "user_stop",
  };

  const label = normalizeString(stop.label || stop.name);
  const role = normalizeString(stop.role || stop.route_role || stop.routeRole);
  const area = normalizeString(stop.area);
  const macro = normalizeString(stop.macro || stop.macro_area || stop.macroArea);

  if (candidateId) normalized.candidate_id = candidateId;
  if (label) normalized.label = label;
  if (candidateKind) normalized.candidate_kind = candidateKind;
  if (role) normalized.role = role;
  if (area) normalized.area = area;
  if (macro) normalized.macro = macro;

  return normalized;
}

function normalizeContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }

  const normalized = {};
  const type = normalizeString(context.type);
  const label = normalizeString(context.label || context.name);
  const candidateId = normalizeString(context.candidate_id || context.candidateId || context.id);

  if (type) normalized.type = type;
  if (label) normalized.label = label;
  if (candidateId) normalized.candidate_id = candidateId;
  if (Number.isFinite(context.lat)) normalized.lat = context.lat;
  if (Number.isFinite(context.lng)) normalized.lng = context.lng;

  return normalized;
}

function normalizeTrustSummary(trustSummary = {}) {
  const sourceTiers = normalizeStringArray(
    trustSummary.source_tiers || trustSummary.sourceTiers || trustSummary.tiers,
  );
  const confidence = normalizeString(trustSummary.confidence);
  const freshness = normalizeString(trustSummary.freshness);

  return {
    source_tiers: sourceTiers.length ? sourceTiers : ["inferred"],
    confidence: confidence || "needs_review",
    human_verified:
      typeof trustSummary.human_verified === "boolean"
        ? trustSummary.human_verified
        : Boolean(trustSummary.humanVerified),
    freshness: freshness || "unknown",
  };
}

function normalizeExplanationInputs(explanationInputs) {
  if (!explanationInputs || typeof explanationInputs !== "object" || Array.isArray(explanationInputs)) {
    return {};
  }

  return Object.entries(explanationInputs).reduce((normalized, [key, value]) => {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) return normalized;
    if (Array.isArray(value)) {
      normalized[normalizedKey] = normalizeStringArray(value);
    } else if (typeof value === "string") {
      const normalizedValue = normalizeString(value);
      if (normalizedValue) normalized[normalizedKey] = normalizedValue;
    } else if (typeof value === "number" || typeof value === "boolean") {
      normalized[normalizedKey] = value;
    }
    return normalized;
  }, {});
}

function validateRouteCandidate(routeCandidate, label = "routeCandidate") {
  assertPlainObject(routeCandidate, label);
  assertNonEmptyString(routeCandidate.id, `${label}.id`);
  assertNonEmptyString(routeCandidate.city, `${label}.city`);
  assertValidChoice(routeCandidate.route_shape, `${label}.route_shape`, VALID_ROUTE_SHAPES);

  if (!Array.isArray(routeCandidate.stops) || routeCandidate.stops.length === 0) {
    throw new Error(`${label}.stops must contain at least one stop`);
  }
  routeCandidate.stops.forEach((stop, index) => validateRouteStop(stop, `${label}.stops[${index}]`));

  validateContext(routeCandidate.start_context, `${label}.start_context`);
  validateContext(routeCandidate.end_context, `${label}.end_context`);
  validateStringArray(routeCandidate.covered_intents, `${label}.covered_intents`);
  validateStringArray(routeCandidate.missing_intents, `${label}.missing_intents`);
  validateStringArray(routeCandidate.area_flow, `${label}.area_flow`);
  validateStringArray(routeCandidate.macro_flow, `${label}.macro_flow`);
  validateStringArray(routeCandidate.source_mix, `${label}.source_mix`);
  routeCandidate.source_mix.forEach((sourceKind, index) =>
    assertValidChoice(sourceKind, `${label}.source_mix[${index}]`, VALID_ROUTE_SOURCE_KINDS),
  );
  validateTrustSummary(routeCandidate.trust_summary, `${label}.trust_summary`);
  assertValidChoice(routeCandidate.confidence, `${label}.confidence`, VALID_CONFIDENCE_LEVELS);
  assertPlainObject(routeCandidate.explanation_inputs, `${label}.explanation_inputs`);
  validateStringArray(routeCandidate.warnings, `${label}.warnings`);
  validateStringArray(routeCandidate.limitations, `${label}.limitations`);

  if (routeCandidate.estimated_walking_km !== undefined) {
    assertNumber(routeCandidate.estimated_walking_km, `${label}.estimated_walking_km`);
  }
  if (routeCandidate.estimated_duration_minutes !== undefined) {
    assertNumber(routeCandidate.estimated_duration_minutes, `${label}.estimated_duration_minutes`);
  }

  return routeCandidate;
}

function validateRouteStop(stop, label) {
  assertPlainObject(stop, label);
  if (!stop.candidate_id && !stop.label) {
    throw new Error(`${label} must include candidate_id or label`);
  }
  if (stop.candidate_id !== undefined) {
    assertNonEmptyString(stop.candidate_id, `${label}.candidate_id`);
  }
  if (stop.label !== undefined) {
    assertNonEmptyString(stop.label, `${label}.label`);
  }
  assertValidChoice(stop.stop_kind, `${label}.stop_kind`, VALID_STOP_KINDS);
  assertBoolean(stop.is_user_facing, `${label}.is_user_facing`);
  if (stop.candidate_kind !== undefined) {
    assertNonEmptyString(stop.candidate_kind, `${label}.candidate_kind`);
  }
  if (stop.role !== undefined) assertNonEmptyString(stop.role, `${label}.role`);
  if (stop.area !== undefined) assertNonEmptyString(stop.area, `${label}.area`);
  if (stop.macro !== undefined) assertNonEmptyString(stop.macro, `${label}.macro`);

  const isStructuralCandidate = ["structural_anchor", "area_preset"].includes(stop.candidate_kind);
  if (isStructuralCandidate && stop.is_user_facing) {
    throw new Error(`${label} structural candidates must be marked as route_structure`);
  }
  if (stop.stop_kind === "route_structure" && stop.is_user_facing) {
    throw new Error(`${label}.is_user_facing must be false for route_structure stops`);
  }
}

function validateContext(context, label) {
  assertPlainObject(context, label);
  if ((context.lat === undefined) !== (context.lng === undefined)) {
    throw new Error(`${label}.lat and ${label}.lng must be provided together`);
  }
  if (context.lat !== undefined) {
    if (!Number.isFinite(context.lat) || context.lat < -90 || context.lat > 90) {
      throw new Error(`${label}.lat must be a valid coordinate`);
    }
    if (!Number.isFinite(context.lng) || context.lng < -180 || context.lng > 180) {
      throw new Error(`${label}.lng must be a valid coordinate`);
    }
  }
}

function validateTrustSummary(trustSummary, label) {
  assertPlainObject(trustSummary, label);
  validateStringArray(trustSummary.source_tiers, `${label}.source_tiers`);
  trustSummary.source_tiers.forEach((tier, index) =>
    assertValidChoice(tier, `${label}.source_tiers[${index}]`, VALID_TRUST_TIERS),
  );
  assertValidChoice(trustSummary.confidence, `${label}.confidence`, VALID_CONFIDENCE_LEVELS);
  assertBoolean(trustSummary.human_verified, `${label}.human_verified`);
  assertNonEmptyString(trustSummary.freshness, `${label}.freshness`);
}

function validateStringArray(values, label) {
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array`);
  }
  values.forEach((value, index) => {
    assertNonEmptyString(value, `${label}[${index}]`);
  });
}

module.exports = {
  VALID_ROUTE_SHAPES,
  VALID_ROUTE_SOURCE_KINDS,
  VALID_CONFIDENCE_LEVELS,
  VALID_TRUST_TIERS,
  VALID_STOP_KINDS,
  normalizeRouteCandidate,
  validateRouteCandidate,
};
