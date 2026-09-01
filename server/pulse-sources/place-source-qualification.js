"use strict";

const {
  probeSchemaOrgPlaceFeed,
} = require("../place-candidates/schema-org-place-source");

const QUALIFICATION_SCHEMA_VERSION = 1;
const MAX_PROBES_PER_RUN = 2;
const MAX_OBSERVATIONS_PER_SOURCE = 6;
const MAX_OBSERVATION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const MIN_ACCEPTED_PLACE_COUNT = 2;

async function qualifyDiscoveredPlaceSourceProfile({
  profile,
  manifests = [],
  previousQualification = null,
  now = new Date(),
  fetcher,
  probe = probeSchemaOrgPlaceFeed,
  maxProbes = MAX_PROBES_PER_RUN,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
} = {}) {
  const clonedProfile = cloneObject(profile);
  const observedAt = normalizeDate(now);
  if (!clonedProfile || !observedAt) {
    return {
      profile: clonedProfile || profile || null,
      qualification: emptyQualification("unavailable", ["place_qualification_input_invalid"], observedAt),
    };
  }

  const candidates = candidateIndex(clonedProfile.place_source_candidates);
  const priorById = priorCandidateIndex(previousQualification);
  const allBindings = (Array.isArray(manifests) ? manifests : [])
    .map((manifest) => bindManifestCandidate(manifest, candidates.get(publicString(manifest?.id))))
    .filter(Boolean)
    .sort((left, right) => compareBindings(left, right, priorById));
  if (!allBindings.length) {
    const qualification = emptyQualification(
      "unavailable",
      ["no_probeable_place_source_candidates"],
      observedAt,
    );
    clonedProfile.place_source_qualification = qualification;
    return { profile: clonedProfile, qualification };
  }

  const probeLimit = clampInteger(maxProbes, 1, MAX_PROBES_PER_RUN);
  const selected = allBindings.slice(0, probeLimit);
  const observations = await Promise.all(selected.map((binding) => probeBinding(binding, {
    observedAt,
    fetcher,
    probe,
    timeoutMs,
  })));
  const byId = new Map(observations.map((item) => [item.candidate_id, item]));
  const states = allBindings.map((binding) => buildCandidateQualification({
    binding,
    observation: byId.get(binding.candidateId) || null,
    previous: priorById.get(binding.candidateId),
    observedAt,
  }));
  const qualification = buildProfileQualification(states, observedAt);
  clonedProfile.place_source_qualification = qualification;
  return { profile: clonedProfile, qualification };
}

function bindManifestCandidate(manifest, candidate) {
  if (!manifest || typeof manifest !== "object" || !candidate) return null;
  const candidateId = publicString(candidate.id);
  const endpoint = safeHttpsUrl(manifest.endpoint);
  const candidateEndpoint = safeHttpsUrl(candidate.url);
  const adapter = normalizeAdapter(manifest.adapter);
  const candidateAdapter = normalizeAdapter(candidate.adapter);
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
    candidate.candidate_kind !== "place_list" ||
    candidate.status !== "viable_place_provider_probe" ||
    candidate.maps_to_existing_provider !== true ||
    candidate.runtime_policy !== "review_needed" ||
    manifest.status !== "review-needed" ||
    manifest.runtime_policy !== "review_required" ||
    manifest.review?.robots_status !== "allowed" ||
    candidate.terms_status === "restricted"
  ) return null;
  return {
    candidateId,
    endpoint,
    adapter,
    bbox,
    sourceIdentity,
    sourceLabel: publicString(manifest.label) || publicString(candidate.source_label) || sourceIdentity,
    sourceTier: publicString(manifest.source_tier) || publicString(candidate.trust_tier) || "unknown",
    sourceFamily: publicString(manifest.source_family) || publicString(candidate.family) || "structured_place_guide",
    termsStatus: publicString(manifest.review?.terms_status) || publicString(candidate.terms_status) || "unknown",
    license: safeHttpsUrl(manifest.license),
    maxItems: clampInteger(manifest.max_items, 1, 100),
  };
}

async function probeBinding(binding, { observedAt, fetcher, probe, timeoutMs }) {
  try {
    const result = await probe(reviewCandidate(binding), {
      fetcher,
      timeoutMs: clampInteger(timeoutMs, 1_000, DEFAULT_PROBE_TIMEOUT_MS),
    });
    const successful = ["ok", "empty"].includes(result?.status);
    const acceptedCount = finiteCount(result?.accepted_place_count);
    return {
      candidate_id: binding.candidateId,
      endpoint: binding.endpoint,
      adapter: binding.adapter,
      source_identity: binding.sourceIdentity,
      observed_at: observedAt.toISOString(),
      observed_day: observedAt.toISOString().slice(0, 10),
      status: successful ? "healthy" : "failed",
      result: acceptedCount >= MIN_ACCEPTED_PLACE_COUNT ? "places_found" : successful ? "empty" : "failed",
      accepted_place_count: acceptedCount,
      distinct_place_type_count: finiteCount(result?.distinct_place_type_count),
      reasons: [successful ? "place_source_probe_healthy" : "place_source_probe_failed"],
    };
  } catch (_error) {
    return failedObservation(binding, observedAt);
  }
}

function failedObservation(binding, observedAt) {
  return {
    candidate_id: binding.candidateId,
    endpoint: binding.endpoint,
    adapter: binding.adapter,
    source_identity: binding.sourceIdentity,
    observed_at: observedAt.toISOString(),
    observed_day: observedAt.toISOString().slice(0, 10),
    status: "failed",
    result: "failed",
    accepted_place_count: 0,
    distinct_place_type_count: 0,
    reasons: ["place_source_probe_failed"],
  };
}

function buildCandidateQualification({ binding, observation, previous, observedAt }) {
  const identity = qualificationIdentity(binding);
  const previousMatches = previous && qualificationIdentity(previous) === identity;
  const prior = previousMatches && Array.isArray(previous.observations)
    ? previous.observations
    : [];
  const observations = mergeObservations(prior, observation, binding, observedAt);
  const healthyCount = observations.filter((item) => item.status === "healthy").length;
  const placeBearingCount = observations.filter(
    (item) => item.accepted_place_count >= MIN_ACCEPTED_PLACE_COUNT,
  ).length;
  const latest = observations[0];
  const reasons = [];
  if (!previousMatches && previous) reasons.push("place_qualification_history_reset");
  if (!["open_license", "api_terms_compatible"].includes(binding.termsStatus)) {
    reasons.push("terms_review_required");
  }
  if (!latest) reasons.push("place_source_probe_evidence_required");
  else if (latest.status !== "healthy") reasons.push("latest_place_probe_not_healthy");
  if ((latest?.accepted_place_count || 0) < MIN_ACCEPTED_PLACE_COUNT) {
    reasons.push("latest_place_list_evidence_required");
  }
  if (healthyCount < 2) reasons.push("repeated_place_probe_evidence_required");
  if (placeBearingCount < 1) reasons.push("accepted_place_evidence_required");

  const status = latest?.status === "healthy" &&
    latest.accepted_place_count >= MIN_ACCEPTED_PLACE_COUNT &&
    healthyCount >= 2 &&
    placeBearingCount >= 1
    ? "qualified_for_review"
    : "observing";
  if (status === "qualified_for_review") reasons.unshift("repeated_place_source_probe_passed");
  return {
    candidate_id: binding.candidateId,
    endpoint: binding.endpoint,
    adapter: binding.adapter,
    source_identity: binding.sourceIdentity,
    status,
    reasons: uniqueTokens(reasons),
    observation_count: observations.length,
    healthy_probe_count: healthyCount,
    place_bearing_probe_count: placeBearingCount,
    last_observed_at: latest?.observed_at || null,
    observations,
    review_candidate: reviewCandidate(binding),
    activation_performed: false,
  };
}

function buildProfileQualification(states, observedAt) {
  const qualifiedCount = states.filter((item) => item.status === "qualified_for_review").length;
  return {
    schema_version: QUALIFICATION_SCHEMA_VERSION,
    status: qualifiedCount ? "qualified_for_review" : "observing",
    updated_at: observedAt.toISOString(),
    qualified_candidate_count: qualifiedCount,
    candidate_count: states.length,
    candidates: states,
    activation_performed: false,
  };
}

function mergeObservations(previous, current, binding, observedAt) {
  const byDay = new Map();
  const oldestAllowedAt = observedAt.getTime() - MAX_OBSERVATION_AGE_MS;
  for (const item of [...previous, ...(current ? [current] : [])]) {
    const normalized = normalizeObservation(item, binding);
    if (!normalized) continue;
    const at = Date.parse(normalized.observed_at);
    if (at < oldestAllowedAt || at > observedAt.getTime()) continue;
    const existing = byDay.get(normalized.observed_day);
    if (!existing || normalized.observed_at > existing.observed_at) {
      byDay.set(normalized.observed_day, normalized);
    }
  }
  return [...byDay.values()]
    .sort((left, right) => right.observed_at.localeCompare(left.observed_at))
    .slice(0, MAX_OBSERVATIONS_PER_SOURCE);
}

function normalizeObservation(item, binding) {
  if (!item || qualificationIdentity(item) !== qualificationIdentity(binding)) return null;
  const observedAt = normalizeDate(item.observed_at);
  if (!observedAt) return null;
  return {
    candidate_id: binding.candidateId,
    endpoint: binding.endpoint,
    adapter: binding.adapter,
    source_identity: binding.sourceIdentity,
    observed_at: observedAt.toISOString(),
    observed_day: observedAt.toISOString().slice(0, 10),
    status: item.status === "healthy" ? "healthy" : "failed",
    result: ["places_found", "empty", "failed"].includes(item.result) ? item.result : "failed",
    accepted_place_count: finiteCount(item.accepted_place_count),
    distinct_place_type_count: finiteCount(item.distinct_place_type_count),
    reasons: uniqueTokens(item.reasons).slice(0, 8),
  };
}

function reviewCandidate(binding) {
  return compact({
    id: binding.candidateId,
    label: binding.sourceLabel,
    endpoint: binding.endpoint,
    adapter: binding.adapter,
    bbox: binding.bbox,
    license: binding.license,
    source_tier: binding.sourceTier,
    source_family: binding.sourceFamily,
    source_identity: binding.sourceIdentity,
    terms_status: binding.termsStatus,
    max_items: binding.maxItems,
    status: "review-needed",
    runtime_policy: "review_required",
  });
}

function emptyQualification(status, reasons, observedAt) {
  return {
    schema_version: QUALIFICATION_SCHEMA_VERSION,
    status,
    updated_at: observedAt?.toISOString() || null,
    qualified_candidate_count: 0,
    candidate_count: 0,
    candidates: [],
    reasons,
    activation_performed: false,
  };
}

function candidateIndex(values) {
  const index = new Map();
  for (const candidate of Array.isArray(values) ? values : []) {
    const id = publicString(candidate?.id);
    if (id && !index.has(id)) index.set(id, candidate);
  }
  return index;
}

function priorCandidateIndex(value) {
  if (
    !value ||
    value.schema_version !== QUALIFICATION_SCHEMA_VERSION ||
    value.activation_performed !== false
  ) return new Map();
  const index = new Map();
  for (const candidate of Array.isArray(value.candidates) ? value.candidates : []) {
    const id = publicString(candidate?.candidate_id);
    if (id && !index.has(id)) index.set(id, candidate);
  }
  return index;
}

function compareBindings(left, right, priorById) {
  const leftCount = finiteCount(priorById.get(left.candidateId)?.observation_count);
  const rightCount = finiteCount(priorById.get(right.candidateId)?.observation_count);
  return leftCount - rightCount || left.candidateId.localeCompare(right.candidateId);
}

function qualificationIdentity(value) {
  return [
    publicString(value?.candidateId || value?.candidate_id),
    safeHttpsUrl(value?.endpoint),
    normalizeAdapter(value?.adapter),
    publicString(value?.sourceIdentity || value?.source_identity).toLowerCase(),
  ].join("|");
}

function normalizeAdapter(value) {
  return ["schema_org_place_html", "schema_org_place_json"].includes(value) ? value : null;
}

function normalizeBounds(value) {
  const values = Array.isArray(value) ? value.map(Number) : [];
  if (values.length !== 4 || !values.every(Number.isFinite)) return null;
  const [west, south, east, north] = values;
  return west <= east && south <= north && west >= -180 && east <= 180 && south >= -90 && north <= 90
    ? values
    : null;
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

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function clampInteger(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : min;
}

function publicString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function uniqueTokens(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(
    (value) => typeof value === "string" && /^[a-z0-9_:-]{1,120}$/.test(value),
  ))];
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

function cloneObject(value) {
  try {
    return value && typeof value === "object" && !Array.isArray(value)
      ? structuredClone(value)
      : null;
  } catch (_error) {
    return null;
  }
}

module.exports = {
  DEFAULT_PROBE_TIMEOUT_MS,
  MAX_OBSERVATIONS_PER_SOURCE,
  MAX_PROBES_PER_RUN,
  MIN_ACCEPTED_PLACE_COUNT,
  bindManifestCandidate,
  qualifyDiscoveredPlaceSourceProfile,
};
