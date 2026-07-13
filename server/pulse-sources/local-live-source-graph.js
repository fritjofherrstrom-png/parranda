const {
  SOURCE_FAMILIES,
  evaluateLiveEventSourceCandidate,
} = require("./source-discovery");

const DEFAULT_REQUIRED_FAMILIES = Object.freeze([
  "official_municipal_calendar",
  "official_tourism_calendar",
  "cultural_institution_calendar",
  "venue_owned_calendar",
  "market_listing",
  "trusted_local_media",
  "community_social_listing",
]);

const FAMILY_STATUS_RANK = Object.freeze({
  covered: 4,
  needs_corroboration: 3,
  needs_review: 2,
  blocked: 1,
  missing: 0,
});

function buildLocalLiveSourceGraph({
  place = {},
  timeWindow = {},
  intentHints = [],
  sourceCandidates = [],
  requiredFamilies = DEFAULT_REQUIRED_FAMILIES,
} = {}) {
  const placeContext = normalizePlaceContext(place);
  const normalizedRequiredFamilies = normalizeRequiredFamilies(requiredFamilies);
  const evaluatedCandidates = (Array.isArray(sourceCandidates) ? sourceCandidates : [])
    .map(evaluateLiveEventSourceCandidate)
    .sort(compareEvaluatedSourceCandidates);
  const familyCoverage = normalizedRequiredFamilies.map((family) =>
    summarizeFamilyCoverage(family, evaluatedCandidates.filter((candidate) => candidate.family === family)),
  );
  const additionalFamilies = [...new Set(evaluatedCandidates.map((candidate) => candidate.family))]
    .filter((family) => !normalizedRequiredFamilies.includes(family))
    .sort(compareFamilyPriority)
    .map((family) => summarizeFamilyCoverage(family, evaluatedCandidates.filter((candidate) => candidate.family === family)));
  const sourceFamilies = [...familyCoverage, ...additionalFamilies];
  const coverage = summarizeCoverage(sourceFamilies, evaluatedCandidates);

  return {
    place_context: placeContext,
    time_window: normalizeTimeWindow(timeWindow),
    intent_hints: normalizeStringList(intentHints),
    discovery_terms: buildDiscoveryTerms(placeContext, intentHints),
    coverage,
    source_families: sourceFamilies,
    social_coverage: summarizeSocialCoverage(sourceFamilies),
    acquisition_plan: buildAcquisitionPlan(sourceFamilies),
  };
}

function summarizeFamilyCoverage(family, candidates) {
  const knownFamily = SOURCE_FAMILIES[family] ? family : "unknown_source_family";
  const sortedCandidates = [...candidates].sort(compareEvaluatedSourceCandidates);
  const best = sortedCandidates[0] || null;
  const hasViable = sortedCandidates.some((candidate) => candidate.status === "viable_provider_probe");
  const hasNeedsReview = sortedCandidates.some((candidate) => candidate.status === "needs_adapter_or_permission");
  const hasRejected = sortedCandidates.some((candidate) => candidate.status === "rejected");
  const socialLike = isCommunityOrSocialFamily(knownFamily, sortedCandidates);

  let status = "missing";
  if (hasViable && !socialLike) {
    status = "covered";
  } else if (hasViable || (socialLike && hasNeedsReview)) {
    status = "needs_corroboration";
  } else if (hasNeedsReview) {
    status = "needs_review";
  } else if (hasRejected) {
    status = "blocked";
  }

  return {
    family: knownFamily,
    family_label: SOURCE_FAMILIES[knownFamily]?.label || knownFamily,
    priority: SOURCE_FAMILIES[knownFamily]?.priority || 99,
    status,
    candidate_count: sortedCandidates.length,
    best_candidate_id: best?.id || null,
    runtime_ready_count: sortedCandidates.filter((candidate) => candidate.status === "viable_provider_probe").length,
    needs_review_count: sortedCandidates.filter((candidate) => candidate.status === "needs_adapter_or_permission").length,
    rejected_count: sortedCandidates.filter((candidate) => candidate.status === "rejected").length,
    coverage_tags: unionSorted(sortedCandidates.flatMap((candidate) => candidate.coverage_tags || [])),
    signal_roles: unionSorted(sortedCandidates.flatMap((candidate) => candidate.signal_roles || [])),
    event_kinds: unionSorted(sortedCandidates.flatMap((candidate) => candidate.event_kinds || [])),
    blockers: unionSorted(sortedCandidates.flatMap((candidate) => candidate.blockers || [])),
    reasons: familyReasons({ status, socialLike, candidates: sortedCandidates }),
    candidates: sortedCandidates.map(compactGraphCandidate),
  };
}

function summarizeCoverage(sourceFamilies, candidates) {
  const coveredFamilies = sourceFamilies.filter((family) => family.status === "covered").map((family) => family.family);
  const needsReviewFamilies = sourceFamilies
    .filter((family) => family.status === "needs_review")
    .map((family) => family.family);
  const missingFamilies = sourceFamilies.filter((family) => family.status === "missing").map((family) => family.family);
  const blockedFamilies = sourceFamilies.filter((family) => family.status === "blocked").map((family) => family.family);
  const socialOnly =
    coveredFamilies.length === 0 &&
    sourceFamilies.some((family) => family.status === "needs_corroboration") &&
    sourceFamilies.every((family) => family.status !== "covered");

  let status = "missing";
  if (coveredFamilies.length >= 3 && hasCoreRuntimeCoverage(sourceFamilies)) {
    status = "strong";
  } else if (coveredFamilies.length >= 2) {
    status = "partial";
  } else if (coveredFamilies.length === 1 || needsReviewFamilies.length > 0 || socialOnly) {
    status = "thin";
  }

  const reasons = [];
  if (hasCoreRuntimeCoverage(sourceFamilies)) reasons.push("core_source_families_covered");
  if (socialOnly) reasons.push("social_or_community_only_needs_corroboration");
  if (missingFamilies.length > 0) reasons.push("source_family_gaps_remain");
  if (blockedFamilies.length > 0) reasons.push("some_sources_blocked_or_rejected");

  return {
    status,
    runtime_ready_source_count: candidates.filter((candidate) => candidate.status === "viable_provider_probe").length,
    covered_families: coveredFamilies,
    needs_review_families: needsReviewFamilies,
    needs_corroboration_families: sourceFamilies
      .filter((family) => family.status === "needs_corroboration")
      .map((family) => family.family),
    missing_families: missingFamilies,
    blocked_families: blockedFamilies,
    can_support_pulse_now: coveredFamilies.length >= 1 && !socialOnly,
    can_support_route_salience: hasCoreRuntimeCoverage(sourceFamilies) && coveredFamilies.length >= 2,
    confidence_ceiling: status === "strong" ? "medium" : status === "partial" ? "low" : "needs_review",
    reasons,
  };
}

function summarizeSocialCoverage(sourceFamilies) {
  const socialFamilies = sourceFamilies.filter((family) => isCommunityOrSocialFamily(family.family, family.candidates || []));
  const candidateCount = socialFamilies.reduce((sum, family) => sum + family.candidate_count, 0);
  const hasRuntimeCorroboration = sourceFamilies.some((family) => family.status === "covered" && !isCommunityOrSocialFamily(family.family));
  return {
    status: candidateCount === 0 ? "absent" : hasRuntimeCorroboration ? "corroborated_signal" : "needs_corroboration",
    candidate_count: candidateCount,
    families: socialFamilies.map((family) => family.family),
    reasons:
      candidateCount === 0
        ? ["no_social_or_community_source_seen"]
        : hasRuntimeCorroboration
          ? ["social_signal_has_stronger_source_context"]
          : ["social_signal_not_enough_for_runtime_claims"],
  };
}

function buildAcquisitionPlan(sourceFamilies) {
  return sourceFamilies
    .filter((family) => family.status !== "covered")
    .sort(compareFamilyCoverage)
    .map((family) => ({
      family: family.family,
      priority: family.priority,
      action: actionForFamilyStatus(family.status),
      reason: reasonForFamilyStatus(family),
    }));
}

function compactGraphCandidate(candidate) {
  return {
    id: candidate.id || null,
    source_label: candidate.source_label || null,
    url: candidate.url || null,
    status: candidate.status,
    adapter: candidate.adapter,
    extraction_tier: candidate.extraction_tier,
    trust_tier: candidate.trust_tier,
    terms_status: candidate.terms_status,
    source_health: candidate.source_health,
    runtime_policy: candidate.runtime_policy,
    corroboration_required: candidate.corroboration_required === true || isSocialExtraction(candidate),
    score: candidate.score,
    maps_to_existing_provider: candidate.maps_to_existing_provider === true,
    signal_roles: candidate.signal_roles || [],
    coverage_tags: candidate.coverage_tags || [],
    event_kinds: candidate.event_kinds || [],
    source_language: candidate.source_language || "",
    local_discovery_terms: candidate.local_discovery_terms || [],
    reasons: candidate.reasons || [],
    blockers: candidate.blockers || [],
  };
}

function normalizePlaceContext(place) {
  return {
    label: firstString(place.label, place.name, place.place),
    lat: finiteNumber(place.lat),
    lng: finiteNumber(place.lng),
    bounds: normalizeBounds(place.bounds),
    region_terms: normalizeStringList(place.region_terms || place.regionTerms || place.terms),
    language_hints: normalizeStringList(place.language_hints || place.languages || place.language),
  };
}

function normalizeTimeWindow(timeWindow) {
  return {
    label: firstString(timeWindow.label, timeWindow.window),
    starts_at: firstString(timeWindow.starts_at, timeWindow.start, timeWindow.from),
    ends_at: firstString(timeWindow.ends_at, timeWindow.end, timeWindow.to),
  };
}

function buildDiscoveryTerms(placeContext, intentHints) {
  const baseTerms = [
    placeContext.label,
    ...placeContext.region_terms,
    ...normalizeStringList(intentHints),
    "events",
    "calendar",
    "market",
    "concert",
    "loppis",
    "marknad",
    "konsert",
  ];
  return unionSorted(baseTerms);
}

function normalizeRequiredFamilies(requiredFamilies) {
  const families = Array.isArray(requiredFamilies) && requiredFamilies.length > 0 ? requiredFamilies : DEFAULT_REQUIRED_FAMILIES;
  return unionSorted(families.map((family) => (SOURCE_FAMILIES[family] ? family : "unknown_source_family"))).sort(compareFamilyPriority);
}

function compareEvaluatedSourceCandidates(a, b) {
  return (
    sourceStatusRank(b.status) - sourceStatusRank(a.status) ||
    Number(b.score || 0) - Number(a.score || 0) ||
    compareFamilyPriority(a.family, b.family) ||
    String(a.id || "").localeCompare(String(b.id || ""))
  );
}

function compareFamilyCoverage(a, b) {
  return (
    FAMILY_STATUS_RANK[a.status] - FAMILY_STATUS_RANK[b.status] ||
    Number(a.priority || 99) - Number(b.priority || 99) ||
    String(a.family || "").localeCompare(String(b.family || ""))
  );
}

function compareFamilyPriority(a, b) {
  const familyA = typeof a === "string" ? a : a?.family;
  const familyB = typeof b === "string" ? b : b?.family;
  return (SOURCE_FAMILIES[familyA]?.priority || 99) - (SOURCE_FAMILIES[familyB]?.priority || 99);
}

function sourceStatusRank(status) {
  if (status === "viable_provider_probe") return 3;
  if (status === "needs_adapter_or_permission") return 2;
  if (status === "rejected") return 1;
  return 0;
}

function hasCoreRuntimeCoverage(sourceFamilies) {
  const covered = new Set(sourceFamilies.filter((family) => family.status === "covered").map((family) => family.family));
  return (
    covered.has("official_municipal_calendar") ||
    covered.has("official_tourism_calendar") ||
    covered.has("cultural_institution_calendar") ||
    covered.has("venue_owned_calendar")
  );
}

function isCommunityOrSocialFamily(family, candidates = []) {
  return family === "community_social_listing" || candidates.some(isSocialExtraction);
}

function isSocialExtraction(candidate = {}) {
  return candidate.extraction_tier === "weak_social_manual" || candidate.extractable?.social === true;
}

function familyReasons({ status, socialLike, candidates }) {
  const reasons = [];
  if (status === "covered") reasons.push("runtime_ready_source_family");
  if (status === "missing") reasons.push("source_family_not_found_yet");
  if (status === "needs_review") reasons.push("source_family_needs_adapter_or_permission");
  if (status === "blocked") reasons.push("source_family_rejected_or_blocked");
  if (socialLike) reasons.push("community_or_social_requires_corroboration");
  if (candidates.some((candidate) => candidate.reasons?.includes("local_language_source"))) {
    reasons.push("local_language_source_present");
  }
  return unionSorted(reasons);
}

function actionForFamilyStatus(status) {
  if (status === "missing") return "discover_source_family";
  if (status === "blocked") return "replace_or_reclassify_source";
  if (status === "needs_corroboration") return "find_stronger_corroborating_source";
  return "review_terms_or_build_adapter";
}

function reasonForFamilyStatus(family) {
  if (family.status === "missing") return "coverage_gap";
  if (family.status === "blocked") return family.blockers[0] || "source_blocked";
  if (family.status === "needs_corroboration") return "weak_signal_needs_stronger_source";
  return family.reasons[0] || "needs_review";
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) return null;
  return {
    north: finiteNumber(bounds.north),
    south: finiteNumber(bounds.south),
    east: finiteNumber(bounds.east),
    west: finiteNumber(bounds.west),
  };
}

function finiteNumber(value) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return Number.isFinite(number) ? number : null;
}

function normalizeStringList(value) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return unionSorted(items.map(firstString).filter(Boolean));
}

function unionSorted(values) {
  return [...new Set((values || []).map(firstString).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function firstString(...values) {
  for (const value of values.flat()) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

module.exports = {
  DEFAULT_REQUIRED_FAMILIES,
  buildLocalLiveSourceGraph,
};
