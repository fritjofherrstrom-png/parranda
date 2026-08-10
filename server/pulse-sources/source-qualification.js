"use strict";

const {
  collectAnchorEvents,
  normalizeLocalEventAdapter,
} = require("../place-candidates/agnostic-event-supply");

const QUALIFICATION_SCHEMA_VERSION = 1;
const MAX_PROBES_PER_RUN = 2;
const MAX_OBSERVATIONS_PER_SOURCE = 6;
const MAX_OBSERVATION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const PROBEABLE_STATUSES = new Set(["viable_provider_probe"]);

async function qualifyDiscoveredSourceProfile({
  profile,
  manifests = [],
  previousQualification = null,
  anchor,
  spatialScope = null,
  placeContext = null,
  now = new Date(),
  fetcher,
  collectEvents = collectAnchorEvents,
  maxProbes = MAX_PROBES_PER_RUN,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
} = {}) {
  const clonedProfile = cloneObject(profile);
  const observedAt = normalizeDate(now);
  if (!clonedProfile || !observedAt || !validPoint(anchor)) {
    return {
      profile: clonedProfile || profile || null,
      qualification: emptyQualification("unavailable", ["qualification_input_invalid"], observedAt),
    };
  }

  const candidates = candidateIndex(clonedProfile.source_families);
  const priorById = priorCandidateIndex(previousQualification);
  const probeLimit = clampInteger(maxProbes, 1, MAX_PROBES_PER_RUN);
  const allBindings = (Array.isArray(manifests) ? manifests : [])
    .map((manifest) => bindManifestCandidate(manifest, candidates.get(publicString(manifest?.id))))
    .filter(Boolean)
    .sort((left, right) => compareBindingsForProbe(left, right, priorById));
  const bindings = allBindings
    .slice(0, probeLimit);

  if (!allBindings.length) {
    const qualification = emptyQualification("unavailable", ["no_probeable_source_candidates"], observedAt);
    clonedProfile.source_qualification = qualification;
    return { profile: clonedProfile, qualification };
  }

  const observations = await Promise.all(bindings.map((binding) => probeBinding(binding, {
    anchor,
    spatialScope,
    placeContext,
    observedAt,
    fetcher,
    collectEvents,
    timeoutMs,
  })));

  const observationsById = new Map(observations.map((item) => [item.candidate_id, item]));
  const candidateStates = allBindings.map((binding) => buildCandidateQualification({
    binding,
    observation: observationsById.get(binding.candidateId) || null,
    previous: priorById.get(binding.candidateId),
    observedAt,
  }));
  const qualification = buildProfileQualification(candidateStates, observedAt);
  clonedProfile.source_qualification = qualification;
  return { profile: clonedProfile, qualification };
}

function bindManifestCandidate(manifest, candidate) {
  if (!manifest || typeof manifest !== "object" || !candidate) return null;
  const candidateId = publicString(candidate.id);
  const endpoint = safeHttpsUrl(manifest.endpoint);
  const candidateEndpoint = safeHttpsUrl(candidate.url);
  const adapter = normalizeLocalEventAdapter(manifest.adapter);
  const candidateAdapter = normalizeLocalEventAdapter(candidate.adapter);
  const sourceIdentity = publicString(manifest.source_identity);
  const candidateIdentity = publicString(candidate.source_identity);
  const bbox = normalizeBounds(manifest.bbox);
  if (
    !candidateId ||
    !endpoint ||
    endpoint !== candidateEndpoint ||
    !adapter ||
    adapter !== candidateAdapter ||
    !sourceIdentity ||
    sourceIdentity.toLowerCase() !== candidateIdentity.toLowerCase() ||
    !bbox ||
    candidate.maps_to_existing_provider !== true ||
    !PROBEABLE_STATUSES.has(publicString(candidate.status)) ||
    candidate.corroboration_required === true ||
    publicString(candidate.family) === "community_social_listing"
  ) return null;

  return {
    candidateId,
    endpoint,
    adapter,
    sourceIdentity,
    sourceFamily: publicString(candidate.family) || "unknown_source_family",
    sourceLabel: publicString(manifest.label) || publicString(candidate.source_label) || sourceIdentity,
    sourceLanguage: publicString(manifest.source_language) || publicString(candidate.source_language),
    sourceTier: publicString(manifest.source_tier) || publicString(candidate.trust_tier) || "unknown",
    termsStatus: publicString(manifest.review?.terms_status) || publicString(candidate.terms_status) || "unknown",
    timezone: publicString(manifest.timezone),
    timezoneOffset: publicString(manifest.timezone_offset),
    eventPathPrefix: publicString(manifest.event_path_prefix),
    format: publicString(manifest.format),
    bbox,
  };
}

async function probeBinding(binding, {
  anchor,
  spatialScope,
  placeContext,
  observedAt,
  fetcher,
  collectEvents,
  timeoutMs,
}) {
  try {
    const result = await collectEvents({
      anchor,
      now: observedAt,
      registry: [sourceRowForBinding(binding)],
      fetcher,
      radiusM: 3000,
      timeoutMs: clampInteger(timeoutMs, 1_000, DEFAULT_PROBE_TIMEOUT_MS),
      maxSources: 1,
      maxLocalSources: 1,
      spatialScope,
      placeContext,
    });
    return observationFromCollection(binding, result, observedAt);
  } catch (_error) {
    return failedObservation(binding, observedAt, "source_probe_failed");
  }
}

function observationFromCollection(binding, result, observedAt) {
  const health = result?.acquisition?.source_health;
  const status = publicString(health?.status);
  const failedCount = finiteCount(health?.failed_source_count);
  const unavailableCount = finiteCount(health?.unavailable_source_count);
  const successful = status === "healthy" && failedCount === 0 && unavailableCount === 0;
  const acceptedCount = finiteCount(health?.accepted_event_count);
  const normalizedCount = finiteCount(health?.normalized_event_count);
  return compact({
    candidate_id: binding.candidateId,
    endpoint: binding.endpoint,
    adapter: binding.adapter,
    source_identity: binding.sourceIdentity,
    observed_at: observedAt.toISOString(),
    observed_day: observedAt.toISOString().slice(0, 10),
    status: successful ? "healthy" : status === "unavailable" ? "unavailable" : "failed",
    result: publicString(health?.result) || (acceptedCount ? "events_found" : "unknown"),
    normalized_event_count: normalizedCount,
    accepted_event_count: acceptedCount,
    rejected_event_count: finiteCount(health?.rejected_event_count),
    reasons: compactTokens(health?.reasons, successful ? "source_probe_healthy" : "source_probe_failed"),
  });
}

function failedObservation(binding, observedAt, reason) {
  return {
    candidate_id: binding.candidateId,
    endpoint: binding.endpoint,
    adapter: binding.adapter,
    source_identity: binding.sourceIdentity,
    observed_at: observedAt.toISOString(),
    observed_day: observedAt.toISOString().slice(0, 10),
    status: "failed",
    result: "failed",
    normalized_event_count: 0,
    accepted_event_count: 0,
    rejected_event_count: 0,
    reasons: [reason],
  };
}

function buildCandidateQualification({ binding, observation, previous, observedAt }) {
  const identity = qualificationIdentity(binding);
  const previousMatches = previous && qualificationIdentity(previous) === identity;
  const priorObservations = previousMatches && Array.isArray(previous.observations)
    ? previous.observations
    : [];
  const observations = mergeObservations(priorObservations, observation, binding, observedAt);
  const healthyCount = observations.filter((item) => item.status === "healthy").length;
  const eventBearingCount = observations.filter((item) => item.accepted_event_count > 0).length;
  const latest = observations[0];
  const reasons = [];
  if (!previousMatches && previous) reasons.push("qualification_history_reset");
  if (binding.termsStatus !== "open_license" && binding.termsStatus !== "api_terms_compatible") {
    reasons.push("terms_review_required");
  }
  if (!latest) reasons.push("source_probe_evidence_required");
  else if (latest.status !== "healthy") reasons.push("latest_probe_not_healthy");
  if (healthyCount < 2) reasons.push("repeated_probe_evidence_required");
  if (eventBearingCount < 1) reasons.push("accepted_event_evidence_required");

  const status = latest?.status === "healthy" && healthyCount >= 2 && eventBearingCount >= 1
    ? "qualified_for_review"
    : "observing";
  if (status === "qualified_for_review") reasons.unshift("repeated_source_probe_passed");
  return {
    candidate_id: binding.candidateId,
    endpoint: binding.endpoint,
    adapter: binding.adapter,
    source_identity: binding.sourceIdentity,
    status,
    reasons: uniqueTokens(reasons),
    observation_count: observations.length,
    healthy_probe_count: healthyCount,
    event_bearing_probe_count: eventBearingCount,
    last_observed_at: latest?.observed_at || null,
    observations,
    activation_performed: false,
  };
}

function buildProfileQualification(candidateStates, observedAt) {
  const qualifiedCount = candidateStates.filter((item) => item.status === "qualified_for_review").length;
  return {
    schema_version: QUALIFICATION_SCHEMA_VERSION,
    status: qualifiedCount ? "qualified_for_review" : "observing",
    updated_at: observedAt.toISOString(),
    qualified_candidate_count: qualifiedCount,
    candidate_count: candidateStates.length,
    candidates: candidateStates,
    activation_performed: false,
  };
}

function mergeObservations(previous, current, binding, observedAt) {
  const byDay = new Map();
  const referenceAt = normalizeDate(observedAt || current?.observed_at);
  if (!referenceAt) return [];
  const identity = {
    candidate_id: binding.candidateId,
    endpoint: binding.endpoint,
    adapter: binding.adapter,
    source_identity: binding.sourceIdentity,
  };
  const oldestAllowedAt = referenceAt.getTime() - MAX_OBSERVATION_AGE_MS;
  for (const item of [...previous, ...(current ? [current] : [])]) {
    const normalized = normalizeObservation(item, identity);
    if (!normalized) continue;
    const observationTime = Date.parse(normalized.observed_at);
    if (observationTime < oldestAllowedAt || observationTime > referenceAt.getTime()) continue;
    const existing = byDay.get(normalized.observed_day);
    if (!existing || normalized.observed_at > existing.observed_at) {
      byDay.set(normalized.observed_day, normalized);
    }
  }
  return [...byDay.values()]
    .sort((left, right) => right.observed_at.localeCompare(left.observed_at))
    .slice(0, MAX_OBSERVATIONS_PER_SOURCE);
}

function normalizeObservation(value, current) {
  if (!value || typeof value !== "object") return null;
  if (
    publicString(value.candidate_id) !== current.candidate_id ||
    safeHttpsUrl(value.endpoint) !== current.endpoint ||
    normalizeLocalEventAdapter(value.adapter) !== current.adapter ||
    publicString(value.source_identity).toLowerCase() !== current.source_identity.toLowerCase()
  ) return null;
  const observedAt = normalizeDate(value.observed_at);
  const status = publicString(value.status);
  if (!observedAt || !["healthy", "failed", "unavailable"].includes(status)) return null;
  return {
    candidate_id: current.candidate_id,
    endpoint: current.endpoint,
    adapter: current.adapter,
    source_identity: current.source_identity,
    observed_at: observedAt.toISOString(),
    observed_day: observedAt.toISOString().slice(0, 10),
    status,
    result: publicString(value.result) || "unknown",
    normalized_event_count: finiteCount(value.normalized_event_count),
    accepted_event_count: finiteCount(value.accepted_event_count),
    rejected_event_count: finiteCount(value.rejected_event_count),
    reasons: compactTokens(value.reasons, status === "healthy" ? "source_probe_healthy" : "source_probe_failed"),
  };
}

function sourceRowForBinding(binding) {
  return compact({
    id: binding.candidateId,
    label: binding.sourceLabel,
    endpoint: binding.endpoint,
    base: binding.endpoint,
    adapter: binding.adapter,
    format: binding.format,
    bbox: binding.bbox,
    timezone: binding.timezone,
    timezone_offset: binding.timezoneOffset,
    source_language: binding.sourceLanguage,
    event_path_prefix: binding.eventPathPrefix,
    source_tier: binding.sourceTier,
    confidence: "low",
    source_family: binding.sourceFamily,
    source_identity: binding.sourceIdentity,
    status: "active",
    runtime_policy: "bounded_refresh",
    terms_status: binding.termsStatus,
  });
}

function candidateIndex(sourceFamilies) {
  const index = new Map();
  for (const family of Array.isArray(sourceFamilies) ? sourceFamilies : []) {
    for (const candidate of Array.isArray(family?.candidates) ? family.candidates : []) {
      const id = publicString(candidate?.id);
      if (!id || index.has(id)) continue;
      index.set(id, { ...candidate, family: publicString(candidate.family) || publicString(family.family) });
    }
  }
  return index;
}

function priorCandidateIndex(value) {
  const index = new Map();
  if (value?.schema_version !== QUALIFICATION_SCHEMA_VERSION) return index;
  for (const candidate of Array.isArray(value.candidates) ? value.candidates : []) {
    const id = publicString(candidate?.candidate_id);
    if (id && !index.has(id)) index.set(id, candidate);
  }
  return index;
}

function emptyQualification(status, reasons, observedAt) {
  return {
    schema_version: QUALIFICATION_SCHEMA_VERSION,
    status,
    updated_at: observedAt ? observedAt.toISOString() : null,
    qualified_candidate_count: 0,
    candidate_count: 0,
    candidates: [],
    reasons,
    activation_performed: false,
  };
}

function qualificationIdentity(value) {
  return [
    publicString(value?.candidate_id || value?.candidateId),
    safeHttpsUrl(value?.endpoint),
    normalizeLocalEventAdapter(value?.adapter),
    publicString(value?.source_identity || value?.sourceIdentity).toLowerCase(),
  ].join("|");
}

function compareBindingsForProbe(left, right, priorById) {
  const leftAt = latestObservationTimestamp(priorById.get(left.candidateId));
  const rightAt = latestObservationTimestamp(priorById.get(right.candidateId));
  return (
    leftAt - rightAt ||
    left.sourceFamily.localeCompare(right.sourceFamily) ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

function latestObservationTimestamp(candidate) {
  let latest = 0;
  for (const observation of Array.isArray(candidate?.observations) ? candidate.observations : []) {
    const timestamp = Date.parse(observation?.observed_at);
    if (Number.isFinite(timestamp)) latest = Math.max(latest, timestamp);
  }
  return latest;
}

function normalizeBounds(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bounds = value.map(Number);
  const [west, south, east, north] = bounds;
  if (!bounds.every(Number.isFinite)) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) return null;
  return bounds;
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(publicString(value));
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function compactTokens(values, fallback) {
  const tokens = uniqueTokens(Array.isArray(values) ? values : []);
  return tokens.length ? tokens.slice(0, 12) : [fallback];
}

function uniqueTokens(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && /^[a-z0-9_:-]{1,120}$/.test(value)))];
}

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function cloneObject(value) {
  try {
    const cloned = structuredClone(value);
    return cloned && typeof cloned === "object" && !Array.isArray(cloned) ? cloned : null;
  } catch (_error) {
    return null;
  }
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(Number(value) || min)));
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function publicString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function validPoint(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

module.exports = {
  DEFAULT_PROBE_TIMEOUT_MS,
  MAX_OBSERVATION_AGE_MS,
  MAX_OBSERVATIONS_PER_SOURCE,
  MAX_PROBES_PER_RUN,
  QUALIFICATION_SCHEMA_VERSION,
  buildCandidateQualification,
  qualifyDiscoveredSourceProfile,
};
