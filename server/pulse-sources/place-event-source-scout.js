"use strict";

/**
 * Trusted place -> local-event source discovery bridge.
 *
 * This is an operator/background capability, never a request-path collector.
 * It resolves one place through the trusted resolver seam, asks the trusted
 * open-data loader for source-owned venue websites, then hands only those
 * public website atoms to the bounded source scout. Discovery can propose a
 * manifest for review; it can never activate one.
 */

const { resolveAgnosticIntake } = require("../planner/agnostic-place-intake");
const {
  buildLocalEventDiscoveryQueries,
  extractEventWebsiteSeeds,
  scoutLocalEventSources,
} = require("./local-event-source-scout");

const SAFE_LOADER_ERRORS = new Set([
  "fetch_error",
  "http_non_200",
  "no_endpoint",
  "parse_error",
  "timeout_or_abort",
]);

async function discoverLocalEventSourcesForPlace({
  placeQuery,
  placeResolver = null,
  openDataLoader = null,
  sourceScout = scoutLocalEventSources,
  bounds = null,
  intentHints = [],
  localDiscoveryTerms = [],
  cache = null,
  scoutOptions = {},
} = {}) {
  const query = normalizePlaceQuery(placeQuery);
  if (!query) {
    return baseOutcome({
      status: "blocked",
      reasons: ["missing_place_query"],
    });
  }

  const resolution = await resolveAgnosticIntake({
    placeQuery: query,
    placeResolver,
  });
  if (!resolution.anchor) {
    const blockers = compactTokens(resolution.intake?.blockers);
    return baseOutcome({
      status: statusForIntakeBlockers(blockers),
      reasons: blockers.length ? blockers : ["place_not_resolved"],
      intake: resolution.intake,
    });
  }

  if (typeof openDataLoader !== "function") {
    return baseOutcome({
      status: "unavailable",
      reasons: ["trusted_place_loader_unavailable"],
      intake: resolution.intake,
      anchor: resolution.anchor,
    });
  }

  let records;
  try {
    records = await openDataLoader(resolution.anchor);
  } catch (_error) {
    return baseOutcome({
      status: "failed",
      reasons: ["trusted_place_loader_failed"],
      intake: resolution.intake,
      anchor: resolution.anchor,
      loader: loaderSummary(null, "error_failed_closed", null),
    });
  }

  if (!Array.isArray(records)) {
    return baseOutcome({
      status: "failed",
      reasons: ["trusted_place_loader_invalid"],
      intake: resolution.intake,
      anchor: resolution.anchor,
      loader: loaderSummary(null, "error_failed_closed", null),
    });
  }

  const loaderStatus = normalizeLoaderStatus(records.loader_status, records.length);
  const loaderError = normalizeLoaderError(records.loader_error);
  const loader = loaderSummary(records, loaderStatus, loaderError);
  if (loaderStatus.startsWith("error")) {
    return baseOutcome({
      status: "failed",
      reasons: ["trusted_place_loader_failed"],
      intake: resolution.intake,
      anchor: resolution.anchor,
      loader,
    });
  }

  const seeds = extractEventWebsiteSeeds(records);
  loader.website_seed_count = seeds.length;
  const place = {
    label: resolution.intake?.resolved?.label || query,
    name: query,
  };
  const discoveryQueries = buildLocalEventDiscoveryQueries({
    place,
    intentHints,
    localDiscoveryTerms,
  });

  if (!seeds.length) {
    return baseOutcome({
      status: "empty",
      reasons: records.length
        ? ["no_trusted_website_seeds"]
        : ["no_trusted_place_records"],
      intake: resolution.intake,
      anchor: resolution.anchor,
      loader,
      discoveryQueries,
    });
  }

  if (typeof sourceScout !== "function") {
    return baseOutcome({
      status: "unavailable",
      reasons: ["source_scout_unavailable"],
      intake: resolution.intake,
      anchor: resolution.anchor,
      loader,
      discoveryQueries,
      seeds,
    });
  }

  let scouted;
  try {
    scouted = await sourceScout({
      place,
      anchor: resolution.anchor,
      bounds,
      seeds,
      intentHints,
      localDiscoveryTerms,
      cache,
      ...sanitizeScoutOptions(scoutOptions),
    });
  } catch (_error) {
    return baseOutcome({
      status: "failed",
      reasons: ["source_scout_failed"],
      intake: resolution.intake,
      anchor: resolution.anchor,
      loader,
      discoveryQueries,
      seeds,
    });
  }

  const scout = compactScoutSummary(scouted);
  return baseOutcome({
    status: normalizeScoutStatus(scouted?.status),
    reasons: compactTokens(scouted?.reasons).length
      ? compactTokens(scouted.reasons)
      : ["source_scout_completed"],
    intake: resolution.intake,
    anchor: resolution.anchor,
    loader,
    discoveryQueries:
      Array.isArray(scouted?.discovery_queries) && scouted.discovery_queries.length
        ? scouted.discovery_queries
        : discoveryQueries,
    seeds,
    scout,
    manifestCandidates: reviewOnlyManifests(scouted?.manifest_candidates),
    sourceResults: compactSourceResults(scouted?.results),
    socialHints: compactSocialHints(scouted?.social_hints),
  });
}

function baseOutcome({
  status,
  reasons,
  intake = null,
  anchor = null,
  loader = null,
  discoveryQueries = [],
  seeds = [],
  scout = null,
  manifestCandidates = [],
  sourceResults = [],
  socialHints = [],
}) {
  return {
    status,
    reasons,
    intake,
    anchor,
    loader,
    discovery_queries: discoveryQueries,
    trusted_website_seeds: seeds,
    source_scout: scout,
    manifest_candidates: manifestCandidates,
    source_results: sourceResults,
    social_hints: socialHints,
    activation_performed: false,
  };
}

function loaderSummary(records, status, error) {
  return {
    status,
    error,
    trusted_record_count: Array.isArray(records) ? records.length : 0,
    website_seed_count: 0,
  };
}

function compactScoutSummary(result) {
  if (!result || typeof result !== "object") {
    return {
      status: "failed",
      inspected_source_count: 0,
      blocked_source_count: 0,
      failed_source_count: 0,
    };
  }
  return {
    status: normalizeScoutStatus(result.status),
    inspected_source_count: finiteCount(result.inspected_source_count),
    blocked_source_count: finiteCount(result.blocked_source_count),
    failed_source_count: finiteCount(result.failed_source_count),
    linked_page_attempt_count: finiteCount(result.linked_page_attempt_count),
    linked_source_count: finiteCount(result.linked_source_count),
  };
}

function compactSourceResults(results) {
  return (Array.isArray(results) ? results : []).map((result) => {
    const discoveryMethod = publicString(result?.discovery_method);
    const discoveredFrom = publicString(result?.discovered_from);
    return {
      source_url: publicString(result?.source_url),
      source_identity: publicString(result?.source_identity),
      status: publicString(result?.status) || "unknown",
      detected: compactTokens(result?.detected),
      reasons: compactTokens(result?.reasons),
      ...(discoveryMethod ? { discovery_method: discoveryMethod } : {}),
      ...(discoveredFrom ? { discovered_from: discoveredFrom } : {}),
      manifest_candidate_count: Array.isArray(result?.manifest_candidates)
        ? result.manifest_candidates.length
        : 0,
      social_hint_count: Array.isArray(result?.social_hints)
        ? result.social_hints.length
        : 0,
    };
  });
}

function compactSocialHints(hints) {
  return (Array.isArray(hints) ? hints : []).map((hint) => ({
    url: publicString(hint?.url),
    source_identity: publicString(hint?.source_identity),
    source_label: publicString(hint?.source_label),
    family: publicString(hint?.family) || "community_social_listing",
    runtime_policy: "probe_only",
    corroboration_required: true,
    reasons: compactTokens(hint?.reasons),
  }));
}

function reviewOnlyManifests(manifests) {
  return (Array.isArray(manifests) ? manifests : []).map((manifest) => ({
    id: publicString(manifest?.id),
    label: publicString(manifest?.label),
    endpoint: publicString(manifest?.endpoint),
    adapter: publicString(manifest?.adapter),
    format: publicString(manifest?.format),
    bbox: normalizeBounds(manifest?.bbox),
    license: publicString(manifest?.license),
    timezone: publicString(manifest?.timezone),
    timezone_offset: publicString(manifest?.timezone_offset),
    source_language: publicString(manifest?.source_language),
    source_tier: publicString(manifest?.source_tier),
    confidence: publicString(manifest?.confidence) || "low",
    source_family: publicString(manifest?.source_family),
    source_identity: publicString(manifest?.source_identity),
    priority: finiteCount(manifest?.priority),
    status: "review-needed",
    runtime_policy: "review_required",
    review: compactReview(manifest?.review),
  }));
}

function sanitizeScoutOptions(options) {
  if (!options || typeof options !== "object") return {};
  const allowed = {};
  for (const key of [
    "fetcher",
    "maxSeeds",
    "maxBytes",
    "maxLinkedPagesPerSeed",
    "maxLinkedPages",
    "calendarLinkTerms",
    "timeoutMs",
    "userAgent",
  ]) {
    if (Object.prototype.hasOwnProperty.call(options, key)) allowed[key] = options[key];
  }
  return allowed;
}

function normalizePlaceQuery(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeLoaderStatus(value, count) {
  if (typeof value === "string" && /^(loaded:\d+|error_failed_closed)$/.test(value)) {
    return value;
  }
  return `loaded:${Math.max(0, Number(count) || 0)}`;
}

function normalizeLoaderError(value) {
  return SAFE_LOADER_ERRORS.has(value) ? value : null;
}

function normalizeScoutStatus(value) {
  return ["complete", "empty", "unavailable"].includes(value) ? value : "failed";
}

function statusForIntakeBlockers(blockers) {
  if (blockers.includes("place_resolver_unavailable")) return "unavailable";
  if (blockers.includes("place_resolver_error")) return "failed";
  return "blocked";
}

function compactReview(review) {
  return {
    terms_status: publicString(review?.terms_status),
    robots_status: publicString(review?.robots_status),
    discovered_from: publicString(review?.discovered_from),
    reasons: compactTokens(review?.reasons),
  };
}

function normalizeBounds(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

function compactTokens(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && /^[a-z0-9_:-]+$/i.test(value))
    .slice(0, 20);
}

function publicString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

module.exports = {
  discoverLocalEventSourcesForPlace,
  reviewOnlyManifests,
};
