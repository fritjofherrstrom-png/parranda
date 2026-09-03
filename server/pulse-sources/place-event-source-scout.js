"use strict";

const { createHash } = require("node:crypto");

/**
 * Trusted place -> local-event source discovery bridge.
 *
 * This is an operator/background capability, never a request-path collector.
 * It resolves one place through the trusted resolver seam, combines source-
 * owned venue websites with optional bounded background-search seeds, then
 * hands only public website atoms to the source scout. Search results remain
 * untrusted; discovery can propose a manifest for review but never activate it.
 */

const { resolveAgnosticIntake } = require("../planner/agnostic-place-intake");
const {
  buildLocalSourceDiscoveryQueryPlan,
  extractEventWebsiteSeeds,
  isScoutablePublicUrl,
  normalizeHttpUrl,
  scoutLocalEventSources,
} = require("./local-event-source-scout");
const { buildLocalLiveSourceGraph } = require("./local-live-source-graph");
const { discoveryLocaleForCountryCode } = require("./source-discovery-locales");

const MAX_SEARCH_SEEDS = 18;
const MAX_SEARCH_SEEDS_PER_ORIGIN = 2;

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
  sourceSearch = null,
  sourceScout = scoutLocalEventSources,
  bounds = null,
  intentHints = [],
  localDiscoveryTerms = [],
  localPlaceDiscoveryTerms = [],
  timeWindow = {},
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

  const trustedBounds = bounds || resolution.spatialScope?.bounds || null;
  const place = buildTrustedScoutPlace({
    query,
    intake: resolution.intake,
    placeContext: resolution.placeContext,
    anchor: resolution.anchor,
    bounds: trustedBounds,
    localDiscoveryTerms,
    localPlaceDiscoveryTerms,
  });
  const discoveryQueryOptions = {
    place,
    intentHints,
    localDiscoveryTerms,
    localPlaceDiscoveryTerms,
  };
  const discoveryQueryPlan = buildLocalSourceDiscoveryQueryPlan(discoveryQueryOptions);
  const discoveryQueries = discoveryQueryPlan.map((item) => item.query);
  const emptySourceProfile = buildSourceProfile({
    place,
    anchor: resolution.anchor,
    timeWindow,
    intentHints,
  });

  if (typeof openDataLoader !== "function" && typeof sourceSearch !== "function") {
    return baseOutcome({
      status: "unavailable",
      reasons: ["trusted_place_loader_unavailable"],
      intake: resolution.intake,
      anchor: resolution.anchor,
      discoveryQueries,
      sourceProfile: emptySourceProfile,
    });
  }

  const loaded = await loadTrustedPlaceRecords({
    openDataLoader,
    anchor: resolution.anchor,
    spatialScope: resolution.spatialScope,
  });
  if (loaded.failed && typeof sourceSearch !== "function") {
    return baseOutcome({
      status: "failed",
      reasons: [loaded.invalid ? "trusted_place_loader_invalid" : "trusted_place_loader_failed"],
      intake: resolution.intake,
      anchor: resolution.anchor,
      loader: loaded.summary,
      discoveryQueries,
      sourceProfile: emptySourceProfile,
    });
  }

  const trustedSeeds = loaded.failed ? [] : extractEventWebsiteSeeds(loaded.records);
  loaded.summary.website_seed_count = trustedSeeds.length;
  const searched = await searchForSourceSeeds({
    sourceSearch,
    discoveryQueries,
    discoveryQueryPlan,
    place,
    anchor: resolution.anchor,
    bounds: trustedBounds,
  });
  const searchedSeeds = sanitizeSearchSeeds(searched.raw?.seeds, place);
  if (searched.summary) searched.summary.accepted_seed_count = searchedSeeds.length;
  const seeds = combineSeeds(trustedSeeds, searchedSeeds);
  const loader = loaded.summary;

  if (!seeds.length) {
    if (loaded.failed) {
      return baseOutcome({
        status: loader.status === "unavailable" ? "unavailable" : "failed",
        reasons: [
          loaded.invalid
            ? "trusted_place_loader_invalid"
            : loader.status === "unavailable"
              ? "trusted_place_loader_unavailable"
              : "trusted_place_loader_failed",
          searchAnswerless(searched.summary)
            ? searched.summary?.status === "degraded"
              ? "source_search_degraded"
              : "source_search_failed"
            : "source_search_no_public_results",
        ],
        intake: resolution.intake,
        anchor: resolution.anchor,
        loader,
        sourceSearch: searched.summary,
        discoveryQueries,
        sourceProfile: emptySourceProfile,
      });
    }
    return baseOutcome({
      status: "empty",
      reasons: emptySeedReasons({
        records: loaded.records,
        searched: searched.summary,
      }),
      intake: resolution.intake,
      anchor: resolution.anchor,
      loader,
      sourceSearch: searched.summary,
      discoveryQueries,
      sourceProfile: emptySourceProfile,
    });
  }

  if (typeof sourceScout !== "function") {
    return baseOutcome({
      status: "unavailable",
      reasons: ["source_scout_unavailable"],
      intake: resolution.intake,
      anchor: resolution.anchor,
      loader,
      sourceSearch: searched.summary,
      discoveryQueries,
      seeds,
      sourceProfile: emptySourceProfile,
    });
  }

  let scouted;
  try {
    scouted = await sourceScout({
      place,
      anchor: resolution.anchor,
      bounds: trustedBounds,
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
      sourceSearch: searched.summary,
      discoveryQueries,
      seeds,
      sourceProfile: emptySourceProfile,
    });
  }

  const scout = compactScoutSummary(scouted);
  const sourceProfile = buildSourceProfile({
    place,
    anchor: resolution.anchor,
    timeWindow,
    intentHints,
    sourceCandidates: sourceCandidatesForProfile(scouted),
    placeSourceCandidates: placeSourceCandidatesForProfile(scouted),
  });
  return baseOutcome({
    status: normalizeScoutStatus(scouted?.status),
    reasons: compactTokens(scouted?.reasons).length
      ? compactTokens(scouted.reasons)
      : ["source_scout_completed"],
    intake: resolution.intake,
    anchor: resolution.anchor,
    loader,
    sourceSearch: searched.summary,
    discoveryQueries:
      Array.isArray(scouted?.discovery_queries) && scouted.discovery_queries.length
        ? scouted.discovery_queries
        : discoveryQueries,
    seeds,
    scout,
    manifestCandidates: reviewOnlyManifests(scouted?.manifest_candidates),
    placeManifestCandidates: reviewOnlyPlaceManifests(scouted?.place_manifest_candidates),
    sourceResults: compactSourceResults(scouted?.results),
    socialHints: compactSocialHints(scouted?.social_hints),
    exploratoryInterfaces: compactExploratoryInterfaces(scouted?.exploratory_interfaces),
    sourceProfile,
  });
}

function baseOutcome({
  status,
  reasons,
  intake = null,
  anchor = null,
  loader = null,
  sourceSearch = null,
  discoveryQueries = [],
  seeds = [],
  scout = null,
  manifestCandidates = [],
  placeManifestCandidates = [],
  sourceResults = [],
  socialHints = [],
  exploratoryInterfaces = [],
  sourceProfile = null,
}) {
  return {
    status,
    reasons,
    intake,
    anchor,
    loader,
    source_search: sourceSearch,
    discovery_queries: discoveryQueries,
    trusted_website_seeds: seeds,
    source_scout: scout,
    manifest_candidates: manifestCandidates,
    place_manifest_candidates: placeManifestCandidates,
    source_results: sourceResults,
    social_hints: socialHints,
    // Uncertain feed interfaces. Retained so a poorly structured local web
    // ecosystem is not silently written off; never a runtime source.
    exploratory_interfaces: exploratoryInterfaces,
    source_profile: sourceProfile,
    activation_performed: false,
  };
}

function buildTrustedScoutPlace({
  query,
  intake,
  placeContext,
  anchor,
  bounds,
  localDiscoveryTerms,
  localPlaceDiscoveryTerms,
}) {
  const context = placeContext && typeof placeContext === "object" ? placeContext : {};
  const locale = discoveryLocaleForCountryCode(context.country_code);
  const locality = publicString(context.locality);
  const regionTerms = uniqueStrings([
    context.municipality,
    context.county,
    context.region,
    context.country,
  ]).filter((value) => value !== locality);
  return {
    label: publicString(intake?.resolved?.label) || locality || query,
    name: locality || query,
    lat: Number.isFinite(Number(anchor?.lat)) ? Number(anchor.lat) : null,
    lng: Number.isFinite(Number(anchor?.lng)) ? Number(anchor.lng) : null,
    bounds: normalizeGraphBounds(bounds),
    region_terms: regionTerms,
    language_hints: locale.language_hints,
    local_discovery_terms: uniqueStrings([
      ...locale.local_discovery_terms,
      ...localDiscoveryTerms,
    ]),
    local_place_discovery_terms: uniqueStrings([
      ...locale.local_place_discovery_terms,
      ...localPlaceDiscoveryTerms,
    ]),
  };
}

async function loadTrustedPlaceRecords({ openDataLoader, anchor, spatialScope }) {
  if (typeof openDataLoader !== "function") {
    return {
      records: [],
      failed: true,
      invalid: false,
      summary: loaderSummary(null, "unavailable", null),
    };
  }
  let records;
  try {
    records = await openDataLoader({
      ...anchor,
      anchorMode: "place",
      spatialScope: spatialScope || null,
    });
  } catch (_error) {
    return {
      records: [],
      failed: true,
      invalid: false,
      summary: loaderSummary(null, "error_failed_closed", null),
    };
  }
  if (!Array.isArray(records)) {
    return {
      records: [],
      failed: true,
      invalid: true,
      summary: loaderSummary(null, "error_failed_closed", null),
    };
  }
  const status = normalizeLoaderStatus(records.loader_status, records.length);
  const error = normalizeLoaderError(records.loader_error);
  return {
    records,
    failed: status.startsWith("error"),
    invalid: false,
    summary: loaderSummary(records, status, error),
  };
}

async function searchForSourceSeeds({
  sourceSearch,
  discoveryQueries,
  discoveryQueryPlan,
  place,
  anchor,
  bounds,
}) {
  if (typeof sourceSearch !== "function") return { raw: null, summary: null };
  try {
    const raw = await sourceSearch({
      queries: discoveryQueries,
      query_plan: discoveryQueryPlan,
      place,
      anchor,
      bounds,
    });
    return { raw, summary: compactSourceSearchSummary(raw) };
  } catch (_error) {
    return {
      raw: null,
      summary: compactSourceSearchSummary({
        status: "failed",
        reasons: ["source_search_failed"],
      }),
    };
  }
}

function compactSourceSearchSummary(result) {
  if (!result || typeof result !== "object") {
    return {
      status: "failed",
      reasons: ["source_search_failed"],
      queried_count: 0,
      generated_query_count: 0,
      skipped_query_count: 0,
      responding_query_count: 0,
      failed_query_count: 0,
      degraded_query_count: 0,
      expansion_round_count: 0,
      novel_source_identity_count: 0,
      stop_reason: "query_space_exhausted",
      query_tranches: [],
      result_count: 0,
      seed_count: 0,
      retry_recommended: true,
      activation_performed: false,
    };
  }
  const status = ["complete", "partial", "empty", "degraded", "failed"].includes(result.status)
    ? result.status
    : "failed";
  return {
    status,
    reasons: compactTokens(result.reasons).length
      ? compactTokens(result.reasons)
      : [status === "failed" ? "source_search_failed" : "source_search_completed"],
    queried_count: finiteCount(result.queried_count),
    generated_query_count: finiteCount(result.generated_query_count),
    skipped_query_count: finiteCount(result.skipped_query_count),
    responding_query_count: finiteCount(result.responding_query_count),
    failed_query_count: finiteCount(result.failed_query_count),
    degraded_query_count: finiteCount(result.degraded_query_count),
    expansion_round_count: finiteCount(result.expansion_round_count),
    novel_source_identity_count: finiteCount(result.novel_source_identity_count),
    stop_reason: compactTokens([result.stop_reason])[0] || "query_space_exhausted",
    query_tranches: (Array.isArray(result.query_tranches) ? result.query_tranches : [])
      .slice(0, 8)
      .map((item) => ({
        query_count: finiteCount(item?.query_count),
        novel_source_identity_count: finiteCount(item?.novel_source_identity_count),
        untrustworthy_query_count: finiteCount(item?.untrustworthy_query_count),
      })),
    result_count: finiteCount(result.result_count),
    seed_count: finiteCount(result.seed_count),
    accepted_seed_count: 0,
    // Whether the provider gave us an answer worth believing. A clean
    // zero-result search is an answer; a degraded one is not.
    retry_recommended: result.retry_recommended === true,
    query_outcomes: (Array.isArray(result.query_outcomes) ? result.query_outcomes : [])
      .slice(0, 24)
      .map((item) => ({
        // Parranda-generated queries about public places. Bounded, and kept so
        // an operator can tell which query degraded without shell access.
        query: publicString(item?.query)?.slice(0, 120) || null,
        query_key: /^[a-f0-9]{12}$/.test(String(item?.query_key || ""))
          ? item.query_key
          : null,
        query_family: compactTokens([item?.query_family])[0] || "unclassified",
        label_scope: compactTokens([item?.label_scope])[0] || "unclassified",
        status: ["ok", "empty", "partial", "degraded", "failed"].includes(item?.status)
          ? item.status
          : "failed",
        reason: compactTokens([item?.reason])[0] || "source_search_failed",
        raw_result_count: finiteCount(item?.raw_result_count),
        result_count: finiteCount(item?.result_count),
        novel_source_identity_count: finiteCount(item?.novel_source_identity_count),
        engine_failure_count: finiteCount(item?.engine_failure_count),
        unresponsive_engines: compactTokens(item?.unresponsive_engines).slice(0, 6),
        results_despite_degraded_engines: item?.results_despite_degraded_engines === true,
        attempt_count: finiteCount(item?.attempt_count),
        retryable: item?.retryable === true,
      })),
    activation_performed: false,
  };
}

function sanitizeSearchSeeds(input, place) {
  const out = [];
  const seen = new Set();
  const originCounts = new Map();
  for (const item of Array.isArray(input) ? input : []) {
    const url = normalizeHttpUrl(item?.url);
    if (!url || !isScoutablePublicUrl(url) || seen.has(url)) continue;
    const origin = new URL(url).origin;
    const originCount = originCounts.get(origin) || 0;
    if (originCount >= MAX_SEARCH_SEEDS_PER_ORIGIN) continue;
    seen.add(url);
    originCounts.set(origin, originCount + 1);
    out.push({
      url,
      label: publicString(item?.label) || new URL(url).hostname.replace(/^www\./, ""),
      place: publicString(place?.label) || publicString(place?.name),
      family: "unknown_source_family",
      trust_tier: "unknown",
      source_language: null,
      discovery_method: "bounded_source_search",
      discovered_from: publicString(item?.discovered_from),
    });
    if (out.length >= MAX_SEARCH_SEEDS) break;
  }
  return out;
}

function combineSeeds(trustedSeeds, searchedSeeds) {
  const out = [];
  const seen = new Set();
  const trusted = normalizedSeedLane(trustedSeeds);
  const searched = normalizedSeedLane(searchedSeeds);
  const institutional = trusted.filter(isInstitutionalSeed);
  const otherTrusted = trusted.filter((seed) => !isInstitutionalSeed(seed));
  const lanes = [institutional, searched, otherTrusted];

  // The scout inspects a bounded prefix. Interleave source classes so neither a
  // venue-heavy place loader nor noisy web search can monopolize that prefix.
  while (lanes.some((lane) => lane.length > 0)) {
    for (const lane of lanes) {
      let seed = lane.shift();
      while (seed && seen.has(seed.url)) seed = lane.shift();
      if (!seed) continue;
      seen.add(seed.url);
      out.push(seed);
    }
  }
  return out;
}

function normalizedSeedLane(seeds) {
  return (Array.isArray(seeds) ? seeds : [])
    .map((seed) => {
      const url = normalizeHttpUrl(seed?.url);
      return url ? { ...seed, url } : null;
    })
    .filter(Boolean);
}

function isInstitutionalSeed(seed) {
  const trust = publicString(seed?.trust_tier)?.toLowerCase();
  const family = publicString(seed?.family)?.toLowerCase();
  return ["official", "civic", "institution", "municipal"].includes(trust) ||
    /official|municipal|tourism|institution/.test(family || "");
}

// True when the search gave us nothing we can believe, as opposed to a clean
// "there is nothing here". The difference decides whether the place keeps its
// discovery opportunity.
function searchAnswerless(searched) {
  return ["failed", "degraded"].includes(publicString(searched?.status)) ||
    searched?.retry_recommended === true;
}

function emptySeedReasons({ records, searched }) {
  const seedReason = records.length ? "no_trusted_website_seeds" : "no_trusted_place_records";
  if (!searched) return [seedReason];
  // "no public results" is a claim about the world. Only make it when the
  // provider actually answered.
  if (!searchAnswerless(searched)) {
    return uniqueStrings([seedReason, "source_search_no_public_results"]);
  }
  // The persisted last_reason is the first token. When the search is why we
  // have nothing, say so first rather than reporting a healthy-looking
  // "no seeds found".
  return uniqueStrings([
    searched.status === "degraded" ? "source_search_degraded" : "source_search_failed",
    seedReason,
  ]);
}

function buildSourceProfile({
  place,
  anchor,
  timeWindow = {},
  intentHints = [],
  sourceCandidates = [],
  placeSourceCandidates = [],
}) {
  const graph = buildLocalLiveSourceGraph({
    place,
    timeWindow,
    intentHints,
    sourceCandidates,
  });
  return {
    profile_key: sourceProfileKey(place, anchor),
    // Discovery never activates a provider. An operator may later attach a
    // fresh approved review that binds exact discovered candidates to runtime
    // feed rows; the runtime bridge fails closed without it.
    runtime_review: {
      status: "unreviewed",
      reviewed_at: null,
      expires_at: null,
      feeds: [],
      place_sources: [],
    },
    place_context: graph.place_context,
    time_window: graph.time_window,
    intent_hints: graph.intent_hints,
    discovery_terms: graph.discovery_terms,
    coverage: graph.coverage,
    source_families: graph.source_families,
    social_coverage: graph.social_coverage,
    acquisition_plan: graph.acquisition_plan,
    place_source_candidates: (Array.isArray(placeSourceCandidates) ? placeSourceCandidates : [])
      .slice(0, 24),
  };
}

function sourceCandidatesForProfile(result) {
  if (!result || typeof result !== "object") return [];
  const detected = (Array.isArray(result.results) ? result.results : [])
    .flatMap((source) => (Array.isArray(source?.candidates) ? source.candidates : []));
  const social = Array.isArray(result.social_hints) ? result.social_hints : [];
  return [...detected, ...social];
}

function placeSourceCandidatesForProfile(result) {
  if (!result || typeof result !== "object") return [];
  return (Array.isArray(result.place_source_candidates) ? result.place_source_candidates : [])
    .filter((candidate) => candidate?.candidate_kind === "place_list")
    .map(compactPlaceSourceCandidate)
    .filter(Boolean)
    .slice(0, 24);
}

function compactPlaceSourceCandidate(candidate) {
  const id = publicString(candidate?.id);
  const url = publicString(candidate?.url);
  const adapter = [
    "schema_org_place_html",
    "schema_org_place_json",
    "experience_card_place_list_detail_html",
    "map_linked_place_html",
  ]
    .includes(candidate?.adapter)
    ? candidate.adapter
    : null;
  if (!id || !url || !adapter) return null;
  return compactObject({
    id,
    candidate_kind: "place_list",
    family: publicString(candidate?.family) || "structured_place_guide",
    source_label: publicString(candidate?.source_label),
    url,
    source_identity: publicString(candidate?.source_identity),
    discovery_method: publicString(candidate?.discovery_method),
    adapter,
    status: candidate?.status === "viable_place_provider_probe"
      ? "viable_place_provider_probe"
      : "rejected",
    maps_to_existing_provider: candidate?.maps_to_existing_provider === true,
    trust_tier: publicString(candidate?.trust_tier) || "unknown",
    terms_status: publicString(candidate?.terms_status) || "unknown",
    source_health: publicString(candidate?.source_health) || "unknown",
    runtime_policy: "review_needed",
    corroboration_required: candidate?.corroboration_required === true,
    accepted_place_count: finiteCount(candidate?.accepted_place_count),
    distinct_place_type_count: finiteCount(candidate?.distinct_place_type_count),
    detail_link_count: finiteCount(candidate?.detail_link_count),
    reasons: compactTokens(candidate?.reasons),
    blockers: compactTokens(candidate?.blockers),
  });
}

function sourceProfileKey(place, anchor) {
  const identity = [
    place?.name,
    ...(Array.isArray(place?.region_terms) ? place.region_terms : []),
    Number.isFinite(Number(anchor?.lat)) ? Number(anchor.lat).toFixed(2) : "",
    Number.isFinite(Number(anchor?.lng)) ? Number(anchor.lng).toFixed(2) : "",
  ]
    .map((value) => publicString(value)?.toLocaleLowerCase("en-US") || "")
    .join("|");
  return `place-source-profile-v1:${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
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
    place_source_candidate_count: Array.isArray(result.place_source_candidates)
      ? result.place_source_candidates.length
      : 0,
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
      place_manifest_candidate_count: Array.isArray(result?.place_manifest_candidates)
        ? result.place_manifest_candidates.length
        : 0,
      exploratory_interface_count: Array.isArray(result?.exploratory_interfaces)
        ? result.exploratory_interfaces.length
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

function compactExploratoryInterfaces(hints) {
  return (Array.isArray(hints) ? hints : []).map((hint) => ({
    url: publicString(hint?.url),
    source_identity: publicString(hint?.source_identity),
    source_label: publicString(hint?.source_label),
    family: publicString(hint?.family) || "unknown_source_family",
    interface: publicString(hint?.interface) || "rss_atom",
    transport: publicString(hint?.transport) || "feed",
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

function reviewOnlyPlaceManifests(manifests) {
  return (Array.isArray(manifests) ? manifests : []).map((manifest) => ({
    id: publicString(manifest?.id),
    label: publicString(manifest?.label),
    endpoint: publicString(manifest?.endpoint),
    adapter: [
      "schema_org_place_html",
      "schema_org_place_json",
      "experience_card_place_list_detail_html",
      "map_linked_place_html",
    ]
      .includes(manifest?.adapter)
      ? manifest.adapter
      : null,
    format: publicString(manifest?.format),
    bbox: normalizeBounds(manifest?.bbox),
    license: publicString(manifest?.license),
    source_tier: publicString(manifest?.source_tier),
    source_family: publicString(manifest?.source_family),
    source_identity: publicString(manifest?.source_identity),
    priority: finiteCount(manifest?.priority),
    max_items: Math.min(100, Math.max(1, finiteCount(manifest?.max_items))),
    status: "review-needed",
    runtime_policy: "review_required",
    review: compactReview(manifest?.review),
  })).filter((manifest) => manifest.id && manifest.endpoint && manifest.adapter && manifest.bbox);
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

function normalizeGraphBounds(value) {
  if (Array.isArray(value) && value.length === 4) {
    const [west, south, east, north] = value.map(Number);
    return [south, west, north, east].every(Number.isFinite)
      ? { north, south, east, west }
      : null;
  }
  if (!value || typeof value !== "object") return null;
  const normalized = {
    north: Number(value.north),
    south: Number(value.south),
    east: Number(value.east),
    west: Number(value.west),
  };
  return Object.values(normalized).every(Number.isFinite) ? normalized : null;
}

function compactTokens(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && /^[a-z0-9_:-]+$/i.test(value))
    .slice(0, 20);
}

function publicString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(publicString).filter(Boolean))];
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function compactObject(value) {
  const output = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item != null) output[key] = item;
  }
  return output;
}

module.exports = {
  combineSeeds,
  discoverLocalEventSourcesForPlace,
  reviewOnlyManifests,
};
