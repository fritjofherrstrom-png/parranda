"use strict";

/**
 * Bounded local-event source scout.
 *
 * This discovers source interfaces, not events. It inspects an explicitly
 * supplied set of trusted public website seeds and identifies machine-readable
 * calendars that existing Parranda adapters can consume. Every proposed
 * manifest remains review-needed; discovery never activates a provider and
 * never runs in the user request path.
 */

const { createHash } = require("node:crypto");

const { evaluateLiveEventSourceCandidate } = require("./source-discovery");
const { extractSchemaOrgEventsFromHtml } = require("./schema-org-event-provider");
const { extractCalendarPageLinks } = require("./calendar-page-locator");
const { hasSitevisionCalendarSignature } = require("./sitevision-calendar-provider");
const { hasEmbeddedProgramRscSignature } = require("./embedded-program-rsc-provider");
const {
  hasOfficialProgramArticleSignature,
} = require("./official-program-article-provider");

const DEFAULT_USER_AGENT =
  "Parranda-Source-Scout/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_SEEDS = 12;
const MAX_SEEDS = 30;
// Modern server-rendered calendars can carry factual program data in a larger
// HTML shell. Keep the probe bounded, but large enough to inspect a reviewed
// public program before classifying it as unsupported.
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_LINKED_PAGES_PER_SEED = 2;
const MAX_LINKED_PAGES_PER_SEED = 4;
const DEFAULT_MAX_LINKED_PAGES = 12;
const MAX_LINKED_PAGES = 30;
const DEFAULT_MANIFEST_RADIUS_KM = 20;
const MAX_DISCOVERY_QUERIES = 18;

const MANIFEST_ADAPTERS = new Set([
  "events_calendar",
  "ical",
  "rss_atom_event_detail",
  "schema_org_html",
  "html_venue_calendar",
  "sitevision_calendar",
  "wix_event_sitemap",
  "embedded_program_rsc",
  "official_program_article",
]);

function buildLocalEventDiscoveryQueries({
  place = {},
  intentHints = [],
  localDiscoveryTerms = [],
} = {}) {
  const verboseLabel = firstString(place.label);
  const localityLabel = firstString(place.name, localityFromLabel(verboseLabel));
  const labels = uniqueStrings([
    localityLabel,
    ...(Array.isArray(place.region_terms) ? place.region_terms : []),
    verboseLabel,
  ]).slice(0, 4);
  const primaryLabel = localityLabel || labels[0] || null;
  const secondaryLabels = labels.filter((label) => label !== primaryLabel);
  const suppliedTerms = uniqueStrings([
    ...localDiscoveryTerms,
    ...(Array.isArray(place.local_discovery_terms) ? place.local_discovery_terms : []),
    ...intentHints,
  ]);
  // Intent narrows ranking later; it must not erase the generic calendar
  // discovery baseline. Local-language terms lead the bounded budget, while
  // generic terms remain present for sites that expose English interfaces.
  const terms = uniqueStrings([
    suppliedTerms[0],
    "events",
    suppliedTerms[1],
    "calendar",
    suppliedTerms[2],
    "festival",
    ...suppliedTerms.slice(3),
  ]).slice(0, 8);
  const queries = [];

  // The runtime search adapter normally executes only the first six queries.
  // Give the simple locality several high-value local terms before interleaving
  // regional and verbose resolver labels; a long Nominatim label must never
  // consume the whole effective search budget.
  for (const term of terms.slice(0, 4)) {
    if (primaryLabel) queries.push(primaryLabel + " " + term);
  }
  for (const term of terms) {
    for (const label of secondaryLabels) queries.push(label + " " + term);
    if (primaryLabel) queries.push(primaryLabel + " " + term);
  }
  return uniqueStrings(queries).slice(0, MAX_DISCOVERY_QUERIES);
}

function localityFromLabel(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.split(",")[0].trim() || null;
}

function extractEventWebsiteSeeds(records = []) {
  const seeds = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== "object") continue;
    const urls = uniqueStrings([
      record.website,
      record.contact_website,
      record.contact?.website,
      record.tags?.website,
      record.tags?.["contact:website"],
      record.source_owned?.website,
      record.source_owned?.contact_website,
    ]);
    for (const url of urls) {
      if (!isScoutablePublicUrl(url)) continue;
      seeds.push({
        url: normalizeHttpUrl(url),
        label: firstString(record.name, record.label),
        place: firstString(record.place, record.area),
        family: inferSeedFamily(record),
        trust_tier: firstString(record.trust_tier, record.source_tier, "unknown"),
        source_language: firstString(record.source_language, record.language),
        lat: toFinite(record.lat),
        lng: toFinite(record.lng),
        discovery_method: "trusted_place_website",
      });
    }
  }
  return dedupeSeeds(seeds);
}

function inspectEventSourcePage({
  seed = {},
  html = "",
  contentType = "text/html",
  context = {},
} = {}) {
  const pageUrl = normalizeHttpUrl(seed.url);
  if (!pageUrl || !isScoutablePublicUrl(pageUrl)) {
    return emptyInspection(seed, "unsafe_or_invalid_source_url");
  }

  const source = String(html || "");
  const links = extractHtmlLinks(source, pageUrl);
  const declaredLicense = extractDeclaredOpenLicense(links);
  const effectiveSeed = {
    ...seed,
    source_language: firstString(seed.source_language, extractHtmlLanguage(source)),
    ...(declaredLicense
      ? { license: declaredLicense, terms_status: "open_license" }
      : {}),
  };
  const candidates = [];
  const socialHints = [];
  const evidence = [];
  const seen = new Set();

  const addCandidate = (kind, endpoint, overrides = {}) => {
    const normalizedEndpoint = normalizeHttpUrl(endpoint);
    if (!normalizedEndpoint || !isScoutablePublicUrl(normalizedEndpoint)) return;
    const key = kind + ":" + normalizedEndpoint;
    if (seen.has(key)) return;
    seen.add(key);
    const candidate = buildDetectedCandidate({
      kind,
      endpoint: normalizedEndpoint,
      pageUrl,
      seed: effectiveSeed,
      context,
      ...overrides,
    });
    candidates.push(evaluateLiveEventSourceCandidate(candidate));
    evidence.push(kind);
  };

  for (const link of links) {
    if (isSocialEventUrl(link.url)) {
      socialHints.push(buildSocialHint(link.url, seed, context));
      continue;
    }
    if (isIcalLink(link)) addCandidate("ical", normalizeWebcalUrl(link.url));
    if (isRssLink(link)) addCandidate("rss", link.url);
    if (isTribeRestUrl(link.url)) addCandidate("events_calendar", link.url);
  }

  for (const endpoint of extractEventJsonEndpoints(source, pageUrl)) {
    addCandidate("event_json", endpoint);
  }

  if (looksLikeEventJsonPayload(source, contentType)) {
    addCandidate("event_json", pageUrl);
  }

  const schemaEvents = extractSchemaOrgEventsFromHtml(source);
  if (schemaEvents.length > 0) {
    addCandidate("schema_org_html", pageUrl, { schemaEventCount: schemaEvents.length });
  }

  const explicitTribeEndpoint = firstTribeEndpoint(source, pageUrl);
  if (explicitTribeEndpoint) {
    addCandidate("events_calendar", explicitTribeEndpoint);
  } else if (hasStrongTribeSignature(source)) {
    addCandidate(
      "events_calendar",
      new URL("/wp-json/tribe/events/v1/events", pageUrl).toString(),
      { inferredEndpoint: true },
    );
  }

  if (hasEmbeddedProgramRscSignature(source)) {
    addCandidate("embedded_program_rsc", pageUrl);
  } else if (hasOfficialProgramArticleSignature(source)) {
    addCandidate("official_program_article", pageUrl);
  } else if (hasSitevisionCalendarSignature(source)) {
    addCandidate("sitevision_calendar", pageUrl);
  } else if (hasWixEventSitemapSignature(source, pageUrl)) {
    addCandidate("wix_event_sitemap", new URL("/sitemap.xml", pageUrl).toString(), {
      inferredEndpoint: true,
    });
  } else if (hasCompatibleVenueCalendarSignature(source)) {
    addCandidate("html_venue_calendar", pageUrl);
  } else if (hasGenericEventListingSignature(source)) {
    addCandidate("stable_html_needs_adapter", pageUrl);
  }

  return {
    source_url: pageUrl,
    source_identity: sourceIdentity(pageUrl),
    content_type: String(contentType || "").split(";")[0].trim().toLowerCase() || null,
    detected: uniqueStrings(evidence),
    candidates: dedupeCandidates(candidates),
    manifest_candidates: dedupeManifests(
      candidates
        .map((candidate) => buildReviewedManifestCandidate(candidate, { seed: effectiveSeed, context }))
        .filter(Boolean),
    ),
    social_hints: dedupeSocialHints(socialHints),
    reasons:
      candidates.length || socialHints.length
        ? ["source_interfaces_detected"]
        : ["no_event_source_interface_detected"],
  };
}

async function scoutLocalEventSources({
  place = {},
  anchor = null,
  bounds = null,
  seeds = [],
  intentHints = [],
  localDiscoveryTerms = [],
  fetcher = typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : null,
  maxSeeds = DEFAULT_MAX_SEEDS,
  maxBytes = DEFAULT_MAX_BYTES,
  maxLinkedPagesPerSeed = DEFAULT_MAX_LINKED_PAGES_PER_SEED,
  maxLinkedPages = DEFAULT_MAX_LINKED_PAGES,
  calendarLinkTerms = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userAgent = DEFAULT_USER_AGENT,
  cache = null,
} = {}) {
  const normalizedSeeds = dedupeSeeds(seeds)
    .filter((seed) => isScoutablePublicUrl(seed.url))
    .slice(0, clampInteger(maxSeeds, 1, MAX_SEEDS));
  const discoveryQueries = buildLocalEventDiscoveryQueries({
    place,
    intentHints,
    localDiscoveryTerms,
  });
  const context = { place, anchor, bounds, intentHints, localDiscoveryTerms };

  if (typeof fetcher !== "function") {
    return {
      status: "unavailable",
      reasons: ["source_scout_fetch_unavailable"],
      discovery_queries: discoveryQueries,
      inspected_source_count: 0,
      results: [],
      manifest_candidates: [],
      social_hints: [],
    };
  }

  const robotsByOrigin = new Map();
  const visitedPages = new Set(normalizedSeeds.map((seed) => normalizeHttpUrl(seed.url)));
  const linkedPageLimit = clampInteger(maxLinkedPages, 0, MAX_LINKED_PAGES);
  const perSeedLinkedPageLimit = clampInteger(
    maxLinkedPagesPerSeed,
    0,
    MAX_LINKED_PAGES_PER_SEED,
  );
  let linkedPageAttempts = 0;
  const results = [];
  for (const seed of normalizedSeeds) {
    const url = normalizeHttpUrl(seed.url);
    const parsed = new URL(url);
    let robots = robotsByOrigin.get(parsed.origin);
    if (!robots) {
      robots = await fetchRobotsPolicy({
        origin: parsed.origin,
        path: parsed.pathname || "/",
        fetcher,
        timeoutMs,
        maxBytes: Math.min(maxBytes, 128 * 1024),
        userAgent,
        cache,
      });
      robotsByOrigin.set(parsed.origin, robots);
    } else {
      robots = applyRobotsPolicy(robots.raw, parsed.pathname || "/");
    }

    if (robots.status === "disallowed") {
      results.push({
        source_url: url,
        status: "blocked",
        robots: compactRobots(robots),
        candidates: [],
        manifest_candidates: [],
        social_hints: [],
        reasons: ["robots_disallowed"],
      });
      continue;
    }

    const page = await fetchScoutPageWithCache({
      url,
      requiredOrigin: parsed.origin,
      fetcher,
      timeoutMs,
      maxBytes,
      userAgent,
      cache,
    });
    if (page.status !== "ok") {
      results.push({
        source_url: url,
        status: page.status,
        robots: compactRobots(robots),
        candidates: [],
        manifest_candidates: [],
        social_hints: [],
        reasons: [page.reason],
      });
      continue;
    }

    const inspection = inspectEventSourcePage({
      seed,
      html: page.body,
      contentType: page.content_type,
      context,
    });
    const sourceResult = {
      ...inspection,
      manifest_candidates: withManifestRobotsStatus(inspection.manifest_candidates, robots),
      status: "inspected",
      robots: compactRobots(robots),
      fetched_bytes: page.bytes,
      discovery_method: firstString(seed.discovery_method, "trusted_website_seed"),
      discovered_from: firstString(seed.discovered_from),
    };
    results.push(sourceResult);

    if (
      sourceResult.manifest_candidates.length > 0 ||
      linkedPageAttempts >= linkedPageLimit ||
      perSeedLinkedPageLimit === 0
    ) {
      continue;
    }

    const linkedPages = extractCalendarPageLinks({
      html: page.body,
      pageUrl: url,
      calendarLinkTerms: uniqueStrings([
        ...(Array.isArray(localDiscoveryTerms) ? localDiscoveryTerms : []),
        ...(Array.isArray(calendarLinkTerms) ? calendarLinkTerms : []),
      ]),
    });
    let seedLinkedPageAttempts = 0;
    for (const link of linkedPages) {
      if (
        seedLinkedPageAttempts >= perSeedLinkedPageLimit ||
        linkedPageAttempts >= linkedPageLimit
      ) {
        break;
      }
      if (visitedPages.has(link.url)) continue;
      visitedPages.add(link.url);
      seedLinkedPageAttempts += 1;
      linkedPageAttempts += 1;

      const linkedUrl = new URL(link.url);
      const linkedRobots = applyRobotsPolicy(
        robots.raw,
        linkedUrl.pathname || "/",
      );
      if (linkedRobots.status === "disallowed") {
        results.push(linkedPageResult({
          seed,
          link,
          status: "blocked",
          robots: linkedRobots,
          reason: "robots_disallowed",
        }));
        continue;
      }

      const linkedPage = await fetchScoutPageWithCache({
        url: link.url,
        requiredOrigin: parsed.origin,
        fetcher,
        timeoutMs,
        maxBytes,
        userAgent,
        cache,
      });
      if (linkedPage.status !== "ok") {
        results.push(linkedPageResult({
          seed,
          link,
          status: linkedPage.status,
          robots: linkedRobots,
          reason: linkedPage.reason,
        }));
        continue;
      }

      const linkedSeed = {
        ...seed,
        url: link.url,
        discovery_method: "same_origin_calendar_link",
        discovered_from: url,
      };
      const linkedInspection = inspectEventSourcePage({
        seed: linkedSeed,
        html: linkedPage.body,
        contentType: linkedPage.content_type,
        context,
      });
      results.push({
        ...linkedInspection,
        manifest_candidates: withManifestRobotsStatus(
          linkedInspection.manifest_candidates,
          linkedRobots,
        ),
        status: "inspected",
        robots: compactRobots(linkedRobots),
        fetched_bytes: linkedPage.bytes,
        discovery_method: "same_origin_calendar_link",
        discovered_from: url,
        discovery_link_reasons: link.reasons,
      });
    }
  }

  const manifestCandidates = dedupeManifests(
    results.flatMap((result) => result.manifest_candidates || []),
  );
  const socialHints = dedupeSocialHints(
    results.flatMap((result) => result.social_hints || []),
  );
  return {
    status: normalizedSeeds.length ? "complete" : "empty",
    reasons: normalizedSeeds.length
      ? ["bounded_source_scout_complete"]
      : ["no_trusted_website_seeds"],
    discovery_queries: discoveryQueries,
    supplied_source_count: Array.isArray(seeds) ? seeds.length : 0,
    inspected_source_count: results.filter((result) => result.status === "inspected").length,
    blocked_source_count: results.filter((result) => result.status === "blocked").length,
    failed_source_count: results.filter((result) =>
      ["failed", "unavailable"].includes(result.status),
    ).length,
    linked_page_attempt_count: linkedPageAttempts,
    linked_source_count: results.filter(
      (result) => result.discovery_method === "same_origin_calendar_link",
    ).length,
    results,
    manifest_candidates: manifestCandidates,
    social_hints: socialHints,
  };
}

function buildDetectedCandidate({
  kind,
  endpoint,
  pageUrl,
  seed,
  context,
  schemaEventCount = 0,
  inferredEndpoint = false,
}) {
  const metadata = normalizeSeedMetadata(seed, context);
  const common = {
    id: "scout-" + stableHash(kind + ":" + endpoint),
    place: firstString(metadata.place, context.place?.label),
    family: metadata.family,
    source_label: firstString(metadata.label, sourceIdentity(pageUrl)),
    url: endpoint,
    source_identity: sourceIdentity(pageUrl),
    discovery_method: firstString(seed.discovery_method, "reviewed_website_probe"),
    source_language: metadata.source_language,
    event_language: metadata.source_language,
    local_discovery_terms: uniqueStrings([
      ...(Array.isArray(context.localDiscoveryTerms) ? context.localDiscoveryTerms : []),
      ...(Array.isArray(context.place?.local_discovery_terms)
        ? context.place.local_discovery_terms
        : []),
    ]),
    translation_status:
      metadata.source_language && metadata.source_language !== "en"
        ? "needed"
        : "not_required",
    trust_tier: metadata.trust_tier,
    terms_status: metadata.terms_status,
    source_health: "healthy",
    runtime_policy: "review_needed",
    notes: inferredEndpoint ? "endpoint_inferred_from_reviewed_cms_signature" : null,
  };

  if (kind === "ical") {
    return {
      ...common,
      adapter: "ical",
      extraction_tier: "ics_rss_feed",
      extractable: baseExtractable({ end: true, recurrence: true, ical: true }),
    };
  }
  if (kind === "events_calendar" || kind === "event_json") {
    return {
      ...common,
      adapter: "the_events_calendar",
      extraction_tier: "official_api_open_data",
      extractable: baseExtractable({
        end: true,
        venue: true,
        venue_geocodable: true,
        recurrence: true,
        the_events_calendar: true,
      }),
      notes:
        kind === "event_json"
          ? "generic_event_json_endpoint_requires_review"
          : common.notes,
    };
  }
  if (kind === "schema_org_html") {
    return {
      ...common,
      adapter: "schema_org_event",
      extraction_tier: "schema_org_json_ld",
      extractable: baseExtractable({
        end: true,
        venue: true,
        venue_geocodable: true,
        schema_org_event: true,
      }),
      notes: "schema_event_rows:" + schemaEventCount,
    };
  }
  if (kind === "rss") {
    return {
      ...common,
      adapter: "rss_atom_event_detail",
      extraction_tier: "ics_rss_feed",
      // RSS/Atom is an index only. Event facts must come from structured
      // schema.org/Event atoms on bounded, same-origin detail pages.
      extractable: baseExtractable({ rss: true, schema_org_event: true }),
      notes: "rss_atom_links_require_reviewed_schema_event_details",
    };
  }
  if (kind === "html_venue_calendar") {
    return {
      ...common,
      adapter: "venue_calendar",
      extraction_tier: "stable_html_calendar",
      extractable: baseExtractable({
        end: true,
        venue: true,
        venue_geocodable: true,
        stable_html: true,
      }),
    };
  }
  if (kind === "sitevision_calendar") {
    return {
      ...common,
      adapter: "sitevision_calendar",
      extraction_tier: "stable_html_calendar",
      extractable: baseExtractable({
        end: true,
        venue: true,
        venue_geocodable: true,
        recurrence: true,
        stable_html: true,
      }),
      notes: "sitevision_calendar_signature_requires_manifest_review",
    };
  }
  if (kind === "wix_event_sitemap") {
    return {
      ...common,
      adapter: "wix_event_sitemap",
      extraction_tier: "stable_html_calendar",
      extractable: baseExtractable({
        end: true,
        venue: true,
        venue_geocodable: true,
        stable_html: true,
      }),
      notes: "wix_public_sitemap_and_ssr_details_require_manifest_review",
    };
  }
  if (kind === "embedded_program_rsc") {
    return {
      ...common,
      adapter: "embedded_program_rsc",
      extraction_tier: "stable_html_calendar",
      extractable: baseExtractable({
        end: true,
        venue: true,
        venue_geocodable: true,
        stable_html: true,
      }),
      notes: "server_rendered_program_atoms_require_manifest_review",
    };
  }
  if (kind === "official_program_article") {
    return {
      ...common,
      adapter: "official_program_article",
      extraction_tier: "stable_html_calendar",
      extractable: baseExtractable({
        end: true,
        venue: true,
        venue_geocodable: true,
        recurrence: true,
        stable_html: true,
      }),
      notes: "official_program_section_atoms_require_manifest_review",
    };
  }
  return {
    ...common,
    adapter: "needs_adapter",
    extraction_tier: "stable_html_calendar",
    extractable: baseExtractable({
      venue: true,
      venue_geocodable: true,
      stable_html: true,
    }),
    notes: "stable_html_signature_needs_reviewed_adapter",
  };
}

function buildReviewedManifestCandidate(candidate, { seed = {}, context = {} } = {}) {
  if (!candidate || candidate.status === "rejected") return null;
  const adapterMap = {
    ical: "ical",
    rss_atom_event_detail: "rss_atom_event_detail",
    the_events_calendar: "events_calendar",
    schema_org_event: "schema_org_html",
    venue_calendar: "html_venue_calendar",
    sitevision_calendar: "sitevision_calendar",
    wix_event_sitemap: "wix_event_sitemap",
    embedded_program_rsc: "embedded_program_rsc",
    official_program_article: "official_program_article",
  };
  const adapter = adapterMap[candidate.adapter];
  if (!MANIFEST_ADAPTERS.has(adapter)) return null;
  const bbox =
    normalizeBounds(context.bounds) ||
    boundsAroundAnchor(context.anchor, DEFAULT_MANIFEST_RADIUS_KM);
  if (!bbox) return null;
  return compact({
    id: candidate.id,
    label: candidate.source_label,
    endpoint: candidate.url,
    adapter,
    format:
      adapter === "schema_org_html"
        ? "html"
        : adapter === "ical"
          ? "ical"
          : null,
    bbox,
    license: firstString(seed.license),
    timezone: firstString(seed.timezone),
    timezone_offset: firstString(seed.timezone_offset, seed.timezoneOffset),
    source_language: candidate.source_language,
    source_tier: candidate.trust_tier,
    confidence: "low",
    source_family: candidate.family,
    source_identity: candidate.source_identity,
    priority: 100,
    status: "review-needed",
    runtime_policy: "review_required",
    review: {
      terms_status: candidate.terms_status,
      robots_status: "review_at_activation",
      discovered_from: firstString(seed.discovered_from, seed.url),
      reasons: uniqueStrings(candidate.reasons),
    },
  });
}

function withManifestRobotsStatus(manifests, robots) {
  const status = firstString(robots?.status, "unknown");
  return (Array.isArray(manifests) ? manifests : []).map((manifest) => ({
    ...manifest,
    review: {
      ...(manifest.review || {}),
      robots_status: status,
      ...(robots?.reason ? { robots_reason: robots.reason } : {}),
    },
  }));
}

function extractHtmlLanguage(html) {
  const match = String(html || "").match(/<html\b[^>]*\blang\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  const raw = firstString(match?.[1], match?.[2], match?.[3]);
  if (!raw) return null;
  const language = raw.toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(language) ? language : null;
}

async function fetchRobotsPolicy({
  origin,
  path,
  fetcher,
  timeoutMs,
  maxBytes,
  userAgent,
  cache,
}) {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const result = await fetchScoutPageWithCache({
    url: robotsUrl,
    fetcher,
    timeoutMs,
    maxBytes,
    userAgent,
    accept: "text/plain",
    requiredOrigin: origin,
    cache,
  });
  if (result.status !== "ok") {
    return {
      status: "unknown",
      reason: result.reason,
      matched_rule: null,
      raw: "",
    };
  }
  return applyRobotsPolicy(result.body, path);
}

async function fetchScoutPageWithCache({ cache = null, ...options }) {
  if (!cache || typeof cache.get !== "function") {
    return fetchScoutPage(options);
  }
  const cacheKey = [
    "source-page",
    stableHash(
      [
        normalizeHttpUrl(options.url),
        String(options.accept || ""),
        String(options.maxBytes || DEFAULT_MAX_BYTES),
        String(normalizeOrigin(options.requiredOrigin) || ""),
      ].join("|"),
    ),
  ].join(":");
  return cache.get(cacheKey, () => fetchScoutPage(options), {
    // Do not freeze provider, robots, timeout, or parse failures. A healthy
    // response is stable enough for the operator-configured discovery TTL.
    shouldStore: (result) => result?.status === "ok",
  });
}

function applyRobotsPolicy(raw, path = "/", userAgent = "parranda-source-scout") {
  const groups = parseRobotsGroups(raw);
  const exact = groups.filter((group) =>
    group.agents.some(
      (agent) => agent !== "*" && userAgent.toLowerCase().includes(agent),
    ),
  );
  const selected = exact.length
    ? exact
    : groups.filter((group) => group.agents.includes("*"));
  if (!selected.length) {
    return {
      status: "unknown",
      reason: "robots_no_matching_group",
      matched_rule: null,
      raw: String(raw || ""),
    };
  }

  const rules = selected
    .flatMap((group) => group.rules)
    .filter((rule) => path.startsWith(rule.path));
  rules.sort(
    (left, right) =>
      right.path.length - left.path.length ||
      (left.type === "allow" ? -1 : 1),
  );
  const rule = rules[0] || null;
  return {
    status: rule?.type === "disallow" ? "disallowed" : "allowed",
    reason: rule ? "robots_" + rule.type : "robots_no_applicable_rule",
    matched_rule: rule ? rule.type + ":" + rule.path : null,
    raw: String(raw || ""),
  };
}

function parseRobotsGroups(raw) {
  const groups = [];
  let current = null;
  for (const originalLine of String(raw || "").split(/\r?\n/)) {
    const line = originalLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      const agent = value.toLowerCase();
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      if (agent) current.agents.push(agent);
      continue;
    }
    if (
      !current ||
      !["allow", "disallow"].includes(key) ||
      !value.startsWith("/")
    ) {
      continue;
    }
    current.rules.push({ type: key, path: value });
  }
  return groups;
}

async function fetchScoutPage({
  url,
  fetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  userAgent = DEFAULT_USER_AGENT,
  accept = "text/html, application/xhtml+xml, text/plain",
  requiredOrigin = null,
}) {
  if (!isScoutablePublicUrl(url)) {
    return { status: "blocked", reason: "unsafe_or_invalid_source_url" };
  }
  const boundedTimeout = clampInteger(timeoutMs, 50, 30000);
  const boundedBytes = clampInteger(maxBytes, 1024, MAX_BYTES);
  const constrainedOrigin = normalizeOrigin(requiredOrigin);
  if (requiredOrigin && !constrainedOrigin) {
    return { status: "blocked", reason: "invalid_required_source_origin" };
  }
  if (constrainedOrigin && new URL(url).origin !== constrainedOrigin) {
    return { status: "blocked", reason: "cross_origin_source_url" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout);
  let phase = "fetch";
  try {
    let currentUrl = url;
    let response;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      response = await fetcher(currentUrl, {
        headers: { "User-Agent": userAgent, Accept: accept },
        redirect: "manual",
        signal: controller.signal,
      });
      if (!isRedirectResponse(response)) break;
      if (redirectCount === 3) {
        return { status: "blocked", reason: "source_redirect_limit" };
      }
      const nextUrl = absolutizeUrl(
        response.headers?.get?.("location"),
        currentUrl,
      );
      if (!nextUrl || !isScoutablePublicUrl(nextUrl)) {
        return { status: "blocked", reason: "unsafe_source_redirect" };
      }
      if (constrainedOrigin && new URL(nextUrl).origin !== constrainedOrigin) {
        return { status: "blocked", reason: "cross_origin_source_redirect" };
      }
      currentUrl = nextUrl;
    }
    const responseUrl = normalizeHttpUrl(response?.url);
    if (
      constrainedOrigin &&
      responseUrl &&
      new URL(responseUrl).origin !== constrainedOrigin
    ) {
      return { status: "blocked", reason: "cross_origin_source_redirect" };
    }
    if (!response || response.ok !== true) {
      return {
        status: "failed",
        reason: "source_http_" + safeHttpStatus(response?.status),
      };
    }
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > boundedBytes) {
      return { status: "blocked", reason: "source_payload_too_large" };
    }
    phase = "body";
    const body = await readBoundedText(response, boundedBytes);
    if (body == null) {
      return { status: "blocked", reason: "source_payload_too_large" };
    }
    return {
      status: "ok",
      body,
      bytes: Buffer.byteLength(body, "utf8"),
      content_type: response.headers?.get?.("content-type") || null,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { status: "failed", reason: "source_timeout" };
    }
    return {
      status: "failed",
      reason: phase === "body" ? "source_body_failed" : "source_fetch_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(response, maxBytes) {
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength || 0;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  }
  const text = typeof response.text === "function" ? await response.text() : "";
  return Buffer.byteLength(text, "utf8") <= maxBytes ? text : null;
}

function extractHtmlLinks(html, baseUrl) {
  const links = [];
  const pattern = /<(a|link)\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(String(html || ""))) !== null) {
    const attrs = match[2] || "";
    const href = attributeValue(attrs, "href");
    if (!href) continue;
    const url = absolutizeUrl(href, baseUrl);
    if (!url) continue;
    links.push({
      tag: match[1].toLowerCase(),
      url,
      rel: attributeValue(attrs, "rel").toLowerCase(),
      type: attributeValue(attrs, "type").toLowerCase(),
    });
  }
  return links;
}

function extractDeclaredOpenLicense(links) {
  for (const link of Array.isArray(links) ? links : []) {
    const rel = String(link?.rel || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!rel.includes("license")) continue;
    const url = normalizeHttpUrl(link?.url);
    if (!url) continue;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      if (
        host === "creativecommons.org" &&
        (/^\/licenses\/(?:by|by-sa)\/\d+(?:\.\d+)?\/?$/.test(path) ||
          /^\/publicdomain\/(?:zero|mark)\/\d+(?:\.\d+)?\/?$/.test(path))
      ) {
        return parsed.toString();
      }
    } catch (_error) {
      // A malformed declaration is not evidence.
    }
  }
  return null;
}

function firstTribeEndpoint(html, baseUrl) {
  const match = String(html || "").match(
    /(?:https?:\\?\/\\?\/[^"'\s<>]+|\/[^"'\s<>]*)wp-json\/tribe\/events\/v1\/events[^"'\s<>]*/i,
  );
  if (!match) return null;
  return absolutizeUrl(match[0].replace(/\\\//g, "/"), baseUrl);
}

function extractEventJsonEndpoints(html, baseUrl) {
  const endpoints = [];
  const seen = new Set();
  const tagPattern = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  const endpointAttributes = [
    "data-rest-url",
    "data-api-url",
    "data-events-url",
    "data-calendar-url",
    "data-events-endpoint",
    "data-calendar-endpoint",
    "data-endpoint",
  ];
  let match;

  while ((match = tagPattern.exec(String(html || ""))) !== null) {
    const attributes = parseHeaderAttributes(match[2] || "");
    const eventContext = [
      match[1],
      attributes.id,
      attributes.class,
      ...Object.keys(attributes),
    ].join(" ");

    for (const attribute of endpointAttributes) {
      const rawEndpoint = attributes[attribute];
      if (!rawEndpoint) continue;
      if (!hasEventEndpointSignature(rawEndpoint, eventContext)) continue;
      const endpoint = absolutizeUrl(rawEndpoint, baseUrl);
      if (!endpoint || seen.has(endpoint)) continue;
      seen.add(endpoint);
      endpoints.push(endpoint);
    }
  }
  return endpoints;
}

function hasEventEndpointSignature(endpoint, context) {
  return /(?:event|calendar|agenda|programme|program)/i.test(
    String(endpoint || "") + " " + String(context || ""),
  );
}

function looksLikeEventJsonPayload(payload, contentType) {
  const source = String(payload || "").trim();
  if (!source) return false;
  if (
    !String(contentType || "").toLowerCase().includes("json") &&
    !/^[\[{]/.test(source)
  ) {
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (_error) {
    return false;
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.events)
      ? parsed.events
      : Array.isArray(parsed?.data)
        ? parsed.data
        : [];
  return rows.some((row) =>
    row &&
    typeof row === "object" &&
    firstString(localizedValue(row.title), row.name) &&
    firstString(row.start, row.start_date, row.startDate, row.starts_at)
  );
}

function localizedValue(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  return firstString(value.rendered, value.text, value.name);
}

function hasStrongTribeSignature(html) {
  const source = String(html || "");
  return (
    /\btribe-events\b/i.test(source) &&
    /\bwp-json\b|\bwordpress\b/i.test(source)
  );
}

function hasCompatibleVenueCalendarSignature(html) {
  const source = String(html || "");
  return (
    /\bdate-container\b/i.test(source) &&
    /\btease--event-calendar\b/i.test(source)
  );
}

function hasWixEventSitemapSignature(html, pageUrl) {
  const source = String(html || "");
  const wix =
    /<meta\b[^>]*name=["']generator["'][^>]*content=["'][^"']*Wix/i.test(source) ||
    /id=["']wix-warmup-data["']/i.test(source);
  if (!wix) return false;
  const pageSignals = [
    String(pageUrl || ""),
    firstMatch(source, /<title\b[^>]*>([\s\S]*?)<\/title>/i),
    firstMatch(source, /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i),
  ].filter(Boolean).join(" ");
  return /(?:event|events|evenemang|kalender|calendar)/i.test(pageSignals);
}

function hasGenericEventListingSignature(html) {
  const source = String(html || "");
  const hasTime = /<time\b[^>]*datetime\s*=/i.test(source);
  const hasEventStructure =
    /\b(?:event-list|events-list|event-card|calendar-event|event-item)\b/i.test(source);
  return hasTime && hasEventStructure;
}

function isIcalLink(link) {
  const url = String(link?.url || "");
  return (
    link?.type.includes("text/calendar") ||
    /(?:\.ics(?:[?#]|$)|^webcal:)/i.test(url)
  );
}

function isRssLink(link) {
  return (
    link?.type.includes("rss+xml") ||
    /(?:\/feed\/?|\.rss|\.xml)(?:[?#]|$)/i.test(String(link?.url || ""))
  );
}

function isTribeRestUrl(value) {
  return /\/wp-json\/tribe\/events\/v1\/events(?:[/?#]|$)/i.test(
    String(value || ""),
  );
}

function isSocialEventUrl(value) {
  const url = String(value || "").toLowerCase();
  return /facebook\.com\/(?:events|groups)|instagram\.com|tiktok\.com/.test(url);
}

function buildSocialHint(url, seed, context) {
  return {
    id: "social-" + stableHash(url),
    url,
    source_identity: sourceIdentity(url),
    source_label: firstString(seed.label, sourceIdentity(url)),
    place: firstString(seed.place, context.place?.label),
    family: "community_social_listing",
    extraction_tier: "weak_social_manual",
    runtime_policy: "probe_only",
    corroboration_required: true,
    reasons: [
      "social_discovery_hint_only",
      "event_atoms_require_corroboration_or_manual_review",
    ],
  };
}

function isScoutablePublicUrl(value) {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      !host ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local")
    ) {
      return false;
    }
    if (host === "0.0.0.0") return false;
    if (isPrivateIpv4(host) || isPrivateIpv6(host)) return false;
    return true;
  } catch (_error) {
    return false;
  }
}

function isPrivateIpv4(host) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const parts = host.split(".").map(Number);
  if (parts.some((part) => part < 0 || part > 255)) return true;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isPrivateIpv6(host) {
  const value = String(host || "").toLowerCase();
  if (!value.includes(":")) return false;
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("::ffff:") ||
    /^f[cd]/.test(value) ||
    /^fe[89a-f]/.test(value) ||
    /^ff/.test(value)
  );
}

function normalizeHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const normalized = /^webcal:/i.test(raw)
      ? raw.replace(/^webcal:/i, "https:")
      : raw;
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeOrigin(value) {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).origin;
  } catch (_error) {
    return null;
  }
}

function normalizeWebcalUrl(value) {
  return normalizeHttpUrl(String(value || "").replace(/^webcal:/i, "https:"));
}

function normalizeSeedMetadata(seed, context) {
  return {
    label: firstString(seed.label, seed.name),
    place: firstString(seed.place, context.place?.label),
    family: firstString(seed.family, "unknown_source_family"),
    trust_tier: firstString(seed.trust_tier, seed.source_tier, "unknown"),
    terms_status: firstString(seed.terms_status, "unknown"),
    source_language: firstString(
      seed.source_language,
      context.place?.language_hints?.[0],
    ),
  };
}

function inferSeedFamily(record) {
  const explicit = firstString(record.family, record.source_family);
  if (explicit) return explicit;
  if (
    ["museum", "gallery", "theatre", "arts_centre"].includes(
      String(record.type || "").toLowerCase(),
    )
  ) {
    return "venue_owned_calendar";
  }
  if (String(record.type || "").toLowerCase() === "market") {
    return "market_listing";
  }
  return "unknown_source_family";
}

function baseExtractable(overrides = {}) {
  return {
    title: true,
    start: true,
    source_url: true,
    ...overrides,
  };
}

function normalizeBounds(value) {
  const bounds = Array.isArray(value)
    ? value.map(Number)
    : value && typeof value === "object"
      ? [value.west, value.south, value.east, value.north].map(Number)
      : [];
  if (bounds.length !== 4 || !bounds.every(Number.isFinite)) return null;
  const [west, south, east, north] = bounds;
  if (west > east || south > north) return null;
  return bounds;
}

function boundsAroundAnchor(anchor, radiusKm) {
  const lat = toFinite(anchor?.lat);
  const lng = toFinite(anchor?.lng);
  if (lat == null || lng == null) return null;
  const latDelta = radiusKm / 111;
  const lngDelta =
    radiusKm / Math.max(20, 111 * Math.cos((lat * Math.PI) / 180));
  return [
    Number((lng - lngDelta).toFixed(5)),
    Number((lat - latDelta).toFixed(5)),
    Number((lng + lngDelta).toFixed(5)),
    Number((lat + latDelta).toFixed(5)),
  ];
}

function parseHeaderAttributes(value) {
  const attrs = {};
  const pattern =
    /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/g;
  let match;
  while ((match = pattern.exec(String(value || ""))) !== null) {
    attrs[match[1].toLowerCase()] =
      match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function attributeValue(attributes, name) {
  return parseHeaderAttributes(attributes)[String(name).toLowerCase()] || "";
}

function absolutizeUrl(value, baseUrl) {
  try {
    return new URL(String(value || "").trim(), baseUrl).toString();
  } catch (_error) {
    return null;
  }
}

function sourceIdentity(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_error) {
    return null;
  }
}

function stableHash(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 16);
}

function safeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? String(status)
    : "not_ok";
}

function isRedirectResponse(response) {
  const status = Number(response?.status);
  return Number.isInteger(status) && status >= 300 && status <= 399;
}

function dedupeSeeds(seeds) {
  const out = [];
  const seen = new Set();
  for (const input of Array.isArray(seeds) ? seeds : []) {
    const seed = typeof input === "string" ? { url: input } : input;
    if (!seed || typeof seed !== "object") continue;
    const url = normalizeHttpUrl(seed.url || seed.website);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...seed, url });
  }
  return out;
}

function dedupeCandidates(candidates) {
  const out = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.adapter + ":" + candidate.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function dedupeManifests(manifests) {
  const out = [];
  const seen = new Set();
  for (const manifest of manifests) {
    if (!manifest) continue;
    const key = manifest.adapter + ":" + manifest.endpoint;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(manifest);
  }
  return out;
}

function dedupeSocialHints(hints) {
  const out = [];
  const seen = new Set();
  for (const hint of hints) {
    if (!hint?.url || seen.has(hint.url)) continue;
    seen.add(hint.url);
    out.push(hint);
  }
  return out;
}

function emptyInspection(seed, reason) {
  return {
    source_url: firstString(seed?.url),
    source_identity: null,
    content_type: null,
    detected: [],
    candidates: [],
    manifest_candidates: [],
    social_hints: [],
    reasons: [reason],
  };
}

function linkedPageResult({ seed, link, status, robots, reason }) {
  return {
    source_url: link.url,
    source_identity: sourceIdentity(link.url),
    status,
    robots: compactRobots(robots),
    candidates: [],
    manifest_candidates: [],
    social_hints: [],
    reasons: [reason],
    discovery_method: "same_origin_calendar_link",
    discovered_from: firstString(seed.url),
    discovery_link_reasons: link.reasons,
  };
}

function compactRobots(robots) {
  return {
    status: robots.status,
    reason: robots.reason,
    matched_rule: robots.matched_rule,
  };
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) continue;
    const key = text.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function firstMatch(value, pattern) {
  const match = String(value || "").match(pattern);
  return match ? match[1] : null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function toFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampInteger(value, min, max) {
  const number = Number.isFinite(Number(value))
    ? Math.floor(Number(value))
    : max;
  return Math.max(min, Math.min(number, max));
}

function compact(value) {
  const output = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item == null || item === "") continue;
    output[key] = item;
  }
  return output;
}

module.exports = {
  buildLocalEventDiscoveryQueries,
  extractEventWebsiteSeeds,
  inspectEventSourcePage,
  extractDeclaredOpenLicense,
  scoutLocalEventSources,
  buildReviewedManifestCandidate,
  applyRobotsPolicy,
  parseRobotsGroups,
  fetchScoutPage,
  readBoundedText,
  extractHtmlLinks,
  extractCalendarPageLinks,
  isScoutablePublicUrl,
  normalizeHttpUrl,
  DEFAULT_USER_AGENT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_SEEDS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINKED_PAGES_PER_SEED,
  DEFAULT_MAX_LINKED_PAGES,
};
