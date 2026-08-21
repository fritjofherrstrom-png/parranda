const SOURCE_FAMILIES = Object.freeze({
  official_municipal_calendar: {
    priority: 1,
    label: "Official city/municipal events calendar",
    preferredAdapters: [
      "linked_events",
      "the_events_calendar",
      "ical",
      "rss_atom_event_detail",
      "schema_org_event",
      "sitevision_calendar",
      "wix_event_sitemap",
      "embedded_program_rsc",
      "official_program_article",
    ],
  },
  official_tourism_calendar: {
    priority: 2,
    label: "Official tourism/destination calendar",
    preferredAdapters: ["schema_org_event", "html_event_listing", "ical", "rss_atom_event_detail", "wix_event_sitemap", "embedded_program_rsc", "official_program_article"],
  },
  cultural_institution_calendar: {
    priority: 3,
    label: "Cultural institution or major venue calendar",
    preferredAdapters: ["schema_org_event", "venue_calendar", "html_event_listing", "rss_atom_event_detail", "embedded_program_rsc", "official_program_article"],
  },
  venue_owned_calendar: {
    priority: 4,
    label: "Venue-owned event calendar",
    preferredAdapters: ["schema_org_event", "venue_calendar", "html_event_listing", "ical", "rss_atom_event_detail", "embedded_program_rsc", "official_program_article"],
  },
  market_listing: {
    priority: 5,
    label: "Market, flea market, and seasonal local listing",
    preferredAdapters: [
      "schema_org_event",
      "html_event_listing",
      "ical",
      "wix_event_sitemap",
      "embedded_program_rsc",
      "official_program_article",
      "needs_adapter",
    ],
  },
  trusted_local_media: {
    priority: 6,
    label: "Trusted local media or editorial calendar",
    preferredAdapters: ["rss_atom_event_detail", "schema_org_event", "html_event_listing"],
  },
  community_social_listing: {
    priority: 7,
    label: "Community or social listing",
    preferredAdapters: ["needs_adapter", "html_event_listing"],
  },
  schema_org_event: {
    priority: 8,
    label: "schema.org/Event JSON-LD",
    preferredAdapters: ["schema_org_event"],
  },
  open_data_event_api: {
    priority: 9,
    label: "Open-data event API",
    preferredAdapters: ["linked_events", "open_data_event_api", "the_events_calendar"],
  },
  compatible_ticket_api: {
    priority: 10,
    label: "Ticket/event API with compatible terms",
    preferredAdapters: ["ticket_event_api"],
  },
  existing_provider_family: {
    priority: 11,
    label: "Existing Parranda provider family",
    preferredAdapters: ["schema_org_event", "linked_events", "the_events_calendar", "ical"],
  },
  unknown_source_family: {
    priority: 99,
    label: "Unknown source family",
    preferredAdapters: ["needs_adapter"],
  },
});

const EXTRACTION_TIERS = Object.freeze({
  official_api_open_data: {
    tier: 1,
    label: "Official API / open data feed",
    score: 4,
    runtimeEligible: true,
  },
  ics_rss_feed: {
    tier: 2,
    label: "ICS / RSS / calendar feed",
    score: 3,
    runtimeEligible: true,
  },
  schema_org_json_ld: {
    tier: 3,
    label: "schema.org/Event / JSON-LD structured data",
    score: 3,
    runtimeEligible: true,
  },
  stable_html_calendar: {
    tier: 4,
    label: "Stable HTML calendar scraping",
    score: 1,
    runtimeEligible: true,
  },
  js_rendered_browser: {
    tier: 5,
    label: "JS-rendered/browser scraping",
    score: 0,
    runtimeEligible: false,
  },
  weak_social_manual: {
    tier: 6,
    label: "Weak social/manual listing",
    score: -1,
    runtimeEligible: false,
  },
});

const TRUST_SCORE = Object.freeze({
  official: 4,
  civic: 3,
  institution: 3,
  commercial: 2,
  community: 1,
  unknown: 0,
});

const TERMS_SCORE = Object.freeze({
  open_license: 3,
  api_terms_compatible: 2,
  permission_required: 1,
  unknown: 0,
  restricted: -2,
});

function evaluateLiveEventSourceCandidate(candidate = {}) {
  const normalized = normalizeSourceCandidate(candidate);
  const reasons = [];
  const blockers = [];

  if (!normalized.url && !normalized.discovery_method) blockers.push("missing_source_locator");
  if (!normalized.extractable.title) blockers.push("missing_title");
  if (!normalized.extractable.start) blockers.push("missing_start_time");
  if (!normalized.extractable.source_url) blockers.push("missing_source_url");

  const hasVenuePath = normalized.extractable.geo || normalized.extractable.venue_geocodable;
  if (!hasVenuePath) reasons.push("no_geo_but_city_level_possible");
  if (normalized.extractable.geo) reasons.push("has_provider_geo");
  if (normalized.extractable.venue_geocodable) reasons.push("venue_geocodable");
  if (normalized.extractable.end) reasons.push("has_end_time");
  if (normalized.extractable.recurrence) reasons.push("has_recurrence");

  const trustScore = TRUST_SCORE[normalized.trust_tier] ?? TRUST_SCORE.unknown;
  const termsScore = TERMS_SCORE[normalized.terms_status] ?? TERMS_SCORE.unknown;
  const tierInfo = EXTRACTION_TIERS[normalized.extraction_tier] || EXTRACTION_TIERS.stable_html_calendar;
  const extractionScore = [
    normalized.extractable.title,
    normalized.extractable.start,
    normalized.extractable.source_url,
    normalized.extractable.venue,
    normalized.extractable.geo || normalized.extractable.venue_geocodable,
  ].filter(Boolean).length;
  const score = trustScore + termsScore + tierInfo.score + extractionScore;

  if (normalized.terms_status === "restricted") blockers.push("terms_restricted");
  if (normalized.terms_status === "permission_required") reasons.push("permission_required_before_runtime");
  if (normalized.terms_status === "unknown") reasons.push("terms_need_review");
  if (!tierInfo.runtimeEligible) reasons.push(`probe_only_${normalized.extraction_tier}`);
  if (normalized.source_health === "blocked") blockers.push("source_health_blocked");
  if (normalized.source_health === "stale") reasons.push("source_health_stale");
  if (normalized.source_health === "fragile") reasons.push("source_health_fragile");
  if (normalized.runtime_policy === "blocked") blockers.push("runtime_policy_blocked");
  if (normalized.runtime_policy === "probe_only") reasons.push("runtime_policy_probe_only");
  if (normalized.runtime_policy === "review_needed") reasons.push("runtime_policy_review_needed");
  if (normalized.runtime_policy === "cache_only") reasons.push("runtime_policy_cache_only");
  if (!normalized.family_known) reasons.push("unknown_source_family");
  if (normalized.source_language && normalized.source_language !== "en") reasons.push("local_language_source");
  if (normalized.local_discovery_terms.length > 0) reasons.push("has_local_discovery_terms");
  if (normalized.translation_status === "provided") reasons.push("translation_available");
  if (normalized.translation_status === "needed") reasons.push("translation_needed_for_display");

  const hardOperationalBlock =
    normalized.source_health === "blocked" || normalized.runtime_policy === "blocked";
  const operationalReviewRequired =
    ["stale", "fragile"].includes(normalized.source_health) ||
    ["probe_only", "review_needed"].includes(normalized.runtime_policy);

  let status = "rejected";
  if (
    !hardOperationalBlock &&
    !operationalReviewRequired &&
    blockers.length === 0 &&
    termsScore >= 2 &&
    tierInfo.runtimeEligible
  ) {
    status = "viable_provider_probe";
  } else if (
    !hardOperationalBlock &&
    blockers.length <= 1 &&
    termsScore >= 0 &&
    normalized.extractable.title &&
    normalized.extractable.start
  ) {
    status = "needs_adapter_or_permission";
  }

  return {
    ...normalized,
    priority: sourceFamilyPriority(normalized.family),
    status,
    score,
    maps_to_existing_provider: mapsToExistingProvider(normalized.adapter),
    reasons,
    blockers,
  };
}

function normalizeSourceCandidate(candidate = {}) {
  const familyInfo = normalizeFamily(candidate.family);
  const family = familyInfo.family;
  const adapter = firstString(candidate.adapter, inferAdapter(candidate));
  const extractionTier = normalizeExtractionTier(candidate.extraction_tier || inferExtractionTier(candidate));
  const sourceUrl = firstString(candidate.url, candidate.source_url);
  const candidateId = firstString(candidate.id, sourceUrl, candidate.source_label);
  return {
    id: candidateId,
    place: firstString(candidate.place),
    raw_family: firstString(candidate.family),
    family,
    family_known: familyInfo.known,
    family_label: SOURCE_FAMILIES[family]?.label || family,
    source_label: firstString(candidate.source_label, candidate.label),
    url: sourceUrl,
    source_identity: firstString(
      candidate.source_identity,
      candidate.publisher_id,
      sourceIdentityFromUrl(sourceUrl),
    ),
    discovery_method: firstString(candidate.discovery_method),
    adapter,
    extraction_tier: extractionTier,
    extraction_tier_label: EXTRACTION_TIERS[extractionTier]?.label || "",
    source_language: normalizeLanguage(candidate.source_language || candidate.language),
    event_language: normalizeLanguage(candidate.event_language || candidate.source_language || candidate.language),
    local_discovery_terms: normalizeStringList(candidate.local_discovery_terms),
    translation_status: normalizeTranslationStatus(candidate.translation_status || candidate.translation?.status),
    translation_confidence: normalizeTranslationConfidence(
      candidate.translation_confidence || candidate.translation?.confidence,
    ),
    translated_atoms: normalizeStringList(candidate.translated_atoms || candidate.translation?.atoms),
    signal_roles: normalizeStringList(candidate.signal_roles || candidate.source_roles),
    coverage_tags: normalizeStringList(candidate.coverage_tags || candidate.tags),
    event_kinds: normalizeStringList(candidate.event_kinds || candidate.event_types),
    region_scope: firstString(candidate.region_scope || candidate.scope),
    source_health: normalizeSourceHealth(candidate.source_health),
    runtime_policy: normalizeRuntimePolicy(candidate.runtime_policy),
    corroboration_required: Boolean(candidate.corroboration_required),
    trust_tier: normalizeTrustTier(candidate.trust_tier || candidate.source_tier),
    terms_status: normalizeTermsStatus(candidate.terms_status),
    license: firstString(candidate.license),
    extractable: {
      title: Boolean(candidate.extractable?.title),
      start: Boolean(candidate.extractable?.start),
      end: Boolean(candidate.extractable?.end),
      venue: Boolean(candidate.extractable?.venue),
      source_url: Boolean(candidate.extractable?.source_url),
      geo: Boolean(candidate.extractable?.geo),
      venue_geocodable: Boolean(candidate.extractable?.venue_geocodable),
      recurrence: Boolean(candidate.extractable?.recurrence),
      schema_org_event: Boolean(candidate.extractable?.schema_org_event),
      linked_events: Boolean(candidate.extractable?.linked_events),
      the_events_calendar: Boolean(candidate.extractable?.the_events_calendar),
      ical: Boolean(candidate.extractable?.ical),
      rss: Boolean(candidate.extractable?.rss),
      stable_html: Boolean(candidate.extractable?.stable_html),
      js_rendered: Boolean(candidate.extractable?.js_rendered),
      social: Boolean(candidate.extractable?.social),
      manual_listing: Boolean(candidate.extractable?.manual_listing),
    },
    notes: firstString(candidate.notes),
  };
}

function sourceFamilyPriority(family) {
  return SOURCE_FAMILIES[family]?.priority || 99;
}

function mapsToExistingProvider(adapter) {
  return (
    adapter === "schema_org_event" ||
    adapter === "linked_events" ||
    adapter === "the_events_calendar" ||
    adapter === "ical" ||
    adapter === "rss_atom_event_detail" ||
    adapter === "sitevision_calendar" ||
    adapter === "wix_event_sitemap" ||
    adapter === "embedded_program_rsc" ||
    adapter === "official_program_article"
  );
}

function inferAdapter(candidate = {}) {
  if (candidate.extractable?.schema_org_event) return "schema_org_event";
  if (candidate.extractable?.linked_events) return "linked_events";
  if (candidate.extractable?.ical) return "ical";
  if (candidate.extractable?.rss) return "rss_atom_event_detail";
  if (candidate.extractable?.the_events_calendar) return "the_events_calendar";
  return "needs_adapter";
}

function inferExtractionTier(candidate = {}) {
  if (
    candidate.extractable?.official_api ||
    candidate.extractable?.the_events_calendar ||
    candidate.extractable?.linked_events
  ) {
    return "official_api_open_data";
  }
  if (candidate.extractable?.ical || candidate.extractable?.rss) return "ics_rss_feed";
  if (candidate.extractable?.schema_org_event) return "schema_org_json_ld";
  if (candidate.extractable?.stable_html) return "stable_html_calendar";
  if (candidate.extractable?.js_rendered) return "js_rendered_browser";
  if (candidate.extractable?.social || candidate.extractable?.manual_listing) return "weak_social_manual";
  return "stable_html_calendar";
}

function normalizeFamily(value) {
  const raw = firstString(value);
  if (SOURCE_FAMILIES[raw]) return { family: raw, known: true };
  return { family: "unknown_source_family", known: false };
}

function normalizeTrustTier(value) {
  const raw = firstString(value).toLowerCase();
  return TRUST_SCORE[raw] != null ? raw : "unknown";
}

function normalizeTermsStatus(value) {
  const raw = firstString(value).toLowerCase();
  return TERMS_SCORE[raw] != null ? raw : "unknown";
}

function normalizeExtractionTier(value) {
  const raw = firstString(value).toLowerCase();
  return EXTRACTION_TIERS[raw] ? raw : "stable_html_calendar";
}

function normalizeLanguage(value) {
  const raw = firstString(value).toLowerCase();
  return /^[a-z]{2,3}(-[a-z0-9]+)?$/.test(raw) ? raw : "";
}

function normalizeTranslationStatus(value) {
  const raw = firstString(value).toLowerCase();
  return ["not_required", "needed", "provided", "unavailable", "unknown"].includes(raw) ? raw : "unknown";
}

function normalizeTranslationConfidence(value) {
  const raw = firstString(value).toLowerCase();
  return ["high", "medium", "low", "none", "unknown"].includes(raw) ? raw : "unknown";
}

function normalizeSourceHealth(value) {
  const raw = firstString(value).toLowerCase();
  return ["healthy", "unknown", "fragile", "stale", "blocked"].includes(raw) ? raw : "unknown";
}

function normalizeRuntimePolicy(value) {
  const raw = firstString(value).toLowerCase();
  return ["runtime_ok", "cache_only", "probe_only", "review_needed", "blocked", "unknown"].includes(raw)
    ? raw
    : "unknown";
}

function sourceIdentityFromUrl(value) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeStringList(value) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(items.map((item) => firstString(item)).filter(Boolean))];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

module.exports = {
  EXTRACTION_TIERS,
  SOURCE_FAMILIES,
  evaluateLiveEventSourceCandidate,
  normalizeSourceCandidate,
  mapsToExistingProvider,
};
