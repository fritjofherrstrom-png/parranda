"use strict";

const DISCOVERY_HEALTH_CONTRACT = "source_discovery_health_v1";
const DISCOVERY_HEALTH_STATUSES = new Set([
  "pending",
  "observing",
  "review_required",
  "healthy_empty",
  "search_failed",
  "environment_not_wired",
  "unavailable",
]);
const SEARCH_STATUSES = new Set(["complete", "partial", "empty", "failed", "not_configured"]);
const SCOUT_STATUSES = new Set(["complete", "empty", "failed", "unavailable", "not_run"]);
const QUALIFICATION_STATUSES = new Set([
  "qualified_for_review",
  "observing",
  "failed",
  "unavailable",
  "not_run",
]);

function buildSourceDiscoveryHealth({ result = {}, qualificationStatus = null, observedAt = new Date() } = {}) {
  const search = normalizeSearchStage(result.source_search);
  const scout = normalizeScoutStage(result.source_scout);
  const qualification = normalizeQualificationStage(
    result.source_profile?.source_qualification,
    qualificationStatus,
  );
  const candidateCount = Math.max(
    qualification.candidate_count,
    countManifestCandidates(result.manifest_candidates),
    countProfileCandidates(result.source_profile),
  );
  const status = classifyDiscoveryHealth({
    resultStatus: token(result.status),
    search,
    scout,
    qualification,
    candidateCount,
  });
  const reasons = compactTokens([
    ...(Array.isArray(result.reasons) ? result.reasons : []),
    ...(Array.isArray(result.source_search?.reasons) ? result.source_search.reasons : []),
    statusReason(status),
  ]);
  const timestamp = normalizeDate(observedAt)?.toISOString() || null;

  return compact({
    contract: DISCOVERY_HEALTH_CONTRACT,
    status,
    search,
    scout,
    qualification: { ...qualification, candidate_count: candidateCount },
    reasons,
    observed_at: timestamp,
  });
}

function normalizeSourceDiscoveryHealth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = DISCOVERY_HEALTH_STATUSES.has(value.status) ? value.status : null;
  if (!status) return null;
  return compact({
    contract: DISCOVERY_HEALTH_CONTRACT,
    status,
    search: normalizeSearchStage(value.search),
    scout: normalizeScoutStage(value.scout),
    qualification: normalizeQualificationStage(value.qualification),
    reasons: compactTokens(value.reasons),
    observed_at: normalizeDate(value.observed_at)?.toISOString() || null,
  });
}

function pendingSourceDiscoveryHealth(reason = "source_discovery_pending") {
  return {
    contract: DISCOVERY_HEALTH_CONTRACT,
    status: "pending",
    search: normalizeSearchStage(null),
    scout: normalizeScoutStage(null),
    qualification: normalizeQualificationStage(null),
    reasons: compactTokens([reason]),
  };
}

function unavailableSourceDiscoveryHealth(status = "unavailable", reason = "source_discovery_unavailable") {
  const safeStatus = status === "environment_not_wired" ? status : "unavailable";
  return {
    contract: DISCOVERY_HEALTH_CONTRACT,
    status: safeStatus,
    search: normalizeSearchStage(null),
    scout: normalizeScoutStage(null),
    qualification: normalizeQualificationStage(null),
    reasons: compactTokens([reason]),
  };
}

function classifyDiscoveryHealth({ resultStatus, search, scout, qualification, candidateCount }) {
  if (qualification.status === "qualified_for_review") return "review_required";
  if (qualification.status === "observing") return "observing";
  if (candidateCount > 0) return "review_required";

  const searchIncomplete = search.status === "failed" || search.status === "partial";
  if (searchIncomplete) return "search_failed";
  if (search.status === "not_configured" || scout.status === "unavailable") {
    return "environment_not_wired";
  }
  if (resultStatus === "failed" || qualification.status === "failed") return "unavailable";
  if (resultStatus === "unavailable") return "environment_not_wired";
  if (
    ["empty", "complete"].includes(resultStatus) &&
    ["empty", "complete"].includes(search.status) &&
    ["empty", "complete", "not_run"].includes(scout.status)
  ) return "healthy_empty";
  return "unavailable";
}

function normalizeSearchStage(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const status = SEARCH_STATUSES.has(input.status) ? input.status : "not_configured";
  return {
    status,
    queried_count: count(input.queried_count),
    responding_query_count: count(input.responding_query_count),
    failed_query_count: count(input.failed_query_count),
    result_count: count(input.result_count),
    seed_count: count(input.accepted_seed_count ?? input.seed_count),
  };
}

function normalizeScoutStage(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const status = SCOUT_STATUSES.has(input.status) ? input.status : "not_run";
  return {
    status,
    inspected_source_count: count(input.inspected_source_count),
    blocked_source_count: count(input.blocked_source_count),
    failed_source_count: count(input.failed_source_count),
  };
}

function normalizeQualificationStage(value, fallbackStatus = null) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const requestedStatus = token(input.status) || token(fallbackStatus);
  const status = QUALIFICATION_STATUSES.has(requestedStatus) ? requestedStatus : "not_run";
  return {
    status,
    candidate_count: count(input.candidate_count),
    qualified_candidate_count: count(input.qualified_candidate_count),
  };
}

function countManifestCandidates(value) {
  return Array.isArray(value) ? value.length : 0;
}

function countProfileCandidates(profile) {
  return (Array.isArray(profile?.source_families) ? profile.source_families : [])
    .reduce((sum, family) => sum + (Array.isArray(family?.candidates) ? family.candidates.length : 0), 0);
}

function statusReason(status) {
  return {
    pending: "source_discovery_pending",
    observing: "source_discovery_observing",
    review_required: "source_discovery_review_required",
    healthy_empty: "source_discovery_healthy_empty",
    search_failed: "source_discovery_search_failed",
    environment_not_wired: "source_discovery_environment_not_wired",
    unavailable: "source_discovery_unavailable",
  }[status];
}

function compactTokens(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = token(value);
    if (!normalized || !/^[a-z0-9_:-]{1,120}$/.test(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 12) break;
  }
  return out;
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function token(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null));
}

module.exports = {
  DISCOVERY_HEALTH_CONTRACT,
  DISCOVERY_HEALTH_STATUSES,
  buildSourceDiscoveryHealth,
  normalizeSourceDiscoveryHealth,
  pendingSourceDiscoveryHealth,
  unavailableSourceDiscoveryHealth,
};
