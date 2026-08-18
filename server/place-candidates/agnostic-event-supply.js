"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Agnostic live-event supply — "what's alive near here, right now".
 *
 * Stable places (OSM / Wikidata / curated) say WHAT a place is. This says what is
 * HAPPENING there — tonight and this week — for an arbitrary anchor, with no
 * citypack. It resolves a bounded set of approved source families around the
 * trusted anchor (geo-keyed Linked Events rows plus the key-gated global family),
 * collects them concurrently, normalizes + fuses their event evidence, and then
 * requires real coordinates inside the anchor radius before salience ranking.
 * Adding a municipal region is DATA, not a per-city code branch.
 *
 * HONEST BY CONSTRUCTION: where no approved source covers the anchor it returns
 * `coverage:"uncovered"` with no events — it never invents a happening. Events are
 * bucketed into `tonight` (now/today/tonight) and `this_week` (the next 7 days),
 * each ranked and capped. Output is DATA (ids, times, coords, source, trust),
 * never prose — the UI/i18n layer renders labels.
 */

const { createLinkedEventsProvider } = require("../pulse-sources/linked-events-source-provider");
const { createTicketmasterProvider } = require("../pulse-sources/ticketmaster-source-provider");
const { createSchemaOrgEventProvider } = require("../pulse-sources/schema-org-event-provider");
const { createEventsCalendarProvider } = require("../pulse-sources/events-calendar-source-provider");
const { createRssAtomEventProvider } = require("../pulse-sources/rss-atom-event-provider");
const { createHtmlVenueCalendarProvider } = require("../pulse-sources/html-venue-calendar-provider");
const { createSitevisionCalendarProvider } = require("../pulse-sources/sitevision-calendar-provider");
const { createWixEventSitemapProvider } = require("../pulse-sources/wix-event-sitemap-provider");
const { createLocalizedEventsApiProvider } = require("../pulse-sources/localized-events-api-provider");
const { createEmbeddedProgramRscProvider } = require("../pulse-sources/embedded-program-rsc-provider");
const {
  createOfficialProgramArticleProvider,
} = require("../pulse-sources/official-program-article-provider");
const { normalizeTimeSensitiveSourceEvent } = require("../pulse-sources/time-sensitive-event");
const {
  datePartsInTimezone,
  normalizeIanaTimezone,
  normalizeSourceEventDate,
} = require("../pulse-sources/source-event-time");
const { scoreTimeSensitiveEventSalience } = require("../pulse-engine/time-sensitive-events");
const { scoreEventPreferenceFit } = require("../pulse-engine/event-preference-fit");
const { createSourceCache } = require("./source-cache");
const {
  resolveReviewedEventSourceProfileFeeds,
} = require("./reviewed-event-source-profile");
const {
  MAX_COLLECTION_RADIUS_M,
  filterEventsForLiveScope,
} = require("./live-event-query");
const { classifyCulturalSalience } = require("../pulse-engine/cultural-salience");
const { resolveEventVenueGeometry } = require("./event-venue-resolution");
const { spatialScopeCacheKey } = require("./spatial-scope");
const {
  normalizeSourceDiscoveryHealth,
  pendingSourceDiscoveryHealth,
  unavailableSourceDiscoveryHealth,
} = require("../pulse-sources/source-discovery-health");
const {
  buildAnchorEventSourcePlan,
  resolveEventFeedsForAnchor,
  fuseAndBoundEventEvidence,
  summarizeRejections,
  buildAnchorEventSourceHealth,
  DEFAULT_MAX_SOURCES,
  DEFAULT_MAX_LOCAL_SOURCES,
} = require("./anchor-event-acquisition");

const DEFAULT_RADIUS_M = 3000;
const MAX_PER_BUCKET = 6;
const MAX_BROWSE_PER_BUCKET = 24;
const SERENDIPITY_MIN_SALIENCE = 7;
const LIVE_EVENT_BROWSE_CONTRACT = "live_event_browse_v1";
// Wide enough that today's later (evening) events and the next days both fit in
// one chronological page after permanent infrastructure is excluded.
const FETCH_LIMIT = 40;
const THIS_WEEK_HORIZON_DAYS = 7;
const TONIGHT_TIMING = new Set(["now", "today", "tonight"]);
// A "happening" is time-bounded (a gig, tour, market, festival) — not permanent
// infrastructure (a museum open since 2001). Events longer than this are
// always-open, not something that is "on", and are excluded CLIENT-side. This is
// the duration guard (the query uses sort=end_time to surface current events, not
// a slow server-side max_duration), feed-agnostic so it protects ANY provider and
// the deterministic tests (which inject payloads, not query params).
const MAX_HAPPENING_DAYS = 14;
const MAX_PULSE_DAILY_RANGE_DAYS = 120;
const MAX_EVENT_FEED_MANIFEST_BYTES = 1024 * 1024;
const LOCAL_EVENT_ADAPTERS = new Set([
  "linked_events",
  "schema_org",
  "schema_org_html",
  "events_calendar",
  "ical",
  "rss_atom_event_detail",
  "html_venue_calendar",
  "sitevision_calendar",
  "wix_event_sitemap",
  "localized_events_api",
  "embedded_program_rsc",
  "official_program_article",
]);

// A single open municipal feed, kept as a NAMED FIXTURE — not a product default.
// It runs the Linked Events platform (api.hel.fi; CC-BY 4.0) and proves the
// municipal-feed path end-to-end in tests and dogfood. It is deliberately NOT in
// the built-in registry: baking one city in makes that city look arbitrarily
// special (Helsinki has events; Lyon, a far bigger city, shows none), which reads
// as a per-city hack. A deployment opts it in — like any region — via
// PARRANDA_EVENT_FEEDS.
const HELSINKI_LINKED_EVENTS_FEED = Object.freeze({
  id: "linkedevents-helsinki",
  label: "Helsinki Region Linked Events",
  base: "https://api.hel.fi/linkedevents/v1/event/",
  bbox: [24.5, 60.0, 25.3, 60.45], // Helsinki, Espoo, Vantaa, Kauniainen (live-verified)
  license: "CC-BY 4.0",
  source_tier: "official",
  confidence: "medium",
  source_family: "municipal_open",
  source_identity: "hel.fi",
  // The feed's region timezone — so a "tonight" time renders in the VENUE's
  // local clock, not the viewer's. A feed is region-scoped (bbox), so a
  // feed-level tz is accurate for its events. IANA name.
  timezone: "Europe/Helsinki",
});

// Product default: NO municipal feed is baked in, so no single city is special.
// Every place gets live events through the same coordinate-bounded acquisition.
// A deployment adds reviewed regional feeds as data via PARRANDA_EVENT_FEEDS;
// nothing here is per-city code. Optional global families may complement those
// sources, but are not required. Kept mutable so the default param stays live.
const BUILTIN_EVENT_FEEDS = [];

/**
 * The registry is GENERIC and deploy-configurable: a city is a data row, never
 * code. `PARRANDA_EVENT_FEEDS` accepts reviewed rows with
 * {id,label,endpoint,adapter,bbox,license,...}; legacy `base` rows remain Linked
 * Events. A deploy may point `PARRANDA_EVENT_FEEDS_FILE` at the same reviewed,
 * versioned JSON manifest used by `dev:full`. Direct JSON env rows retain
 * precedence over matching file rows. Both seams are trusted server config and
 * are never read from a request. The allowlisted adapters cover Linked Events,
 * schema.org JSON/HTML, The Events Calendar, iCal, and stable venue HTML without
 * touching the engine.
 * Fresh operator-approved source profiles may add the same rows through
 * PARRANDA_REVIEWED_EVENT_SOURCE_PROFILES; discovery output alone is ignored.
 * The default registry is EMPTY on purpose — no city is special out of the box.
 * Malformed config is ignored (keep whatever is built-in), never throws.
 */
function resolveEventFeedRegistry(env = process.env) {
  const feeds = [...BUILTIN_EVENT_FEEDS];
  const directRows = parseEventFeedRows((env && env.PARRANDA_EVENT_FEEDS) || "");
  appendUniqueEventFeeds(feeds, directRows);

  // The file path is deployment-owned configuration. Missing, oversized or
  // malformed manifests fail soft to the already trusted rows; they can never
  // make route/Pulse requests fail.
  const manifestRows = loadEventFeedRowsFromFile(
    (env && env.PARRANDA_EVENT_FEEDS_FILE) || "",
  );
  appendUniqueEventFeeds(feeds, manifestRows);

  // Reviewed profiles are trusted deploy configuration, never public payload.
  // Direct feed rows keep precedence so a deployment can override or disable a
  // profiled source without editing the cached discovery artifact.
  const identities = new Set(feeds.flatMap(feedIdentities));
  for (const f of resolveReviewedEventSourceProfileFeeds(env)) {
    const normalized = normalizeEventFeedRow(f, feeds.length);
    if (!normalized) continue;
    const rowIdentities = feedIdentities(normalized);
    if (rowIdentities.some((identity) => identities.has(identity))) continue;
    feeds.push(normalized);
    rowIdentities.forEach((identity) => identities.add(identity));
  }
  return feeds;
}

function parseEventFeedRows(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function loadEventFeedRowsFromFile(value) {
  const manifestPath = String(value || "").trim();
  if (!manifestPath) return [];
  try {
    const absolutePath = path.resolve(manifestPath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size > MAX_EVENT_FEED_MANIFEST_BYTES) return [];
    return parseEventFeedRows(fs.readFileSync(absolutePath, "utf8"));
  } catch (_error) {
    return [];
  }
}

function appendUniqueEventFeeds(feeds, rows) {
  const identities = new Set(feeds.flatMap(feedIdentities));
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeEventFeedRow(row, feeds.length);
    if (!normalized) continue;
    const rowIdentities = feedIdentities(normalized);
    if (rowIdentities.some((identity) => identities.has(identity))) continue;
    feeds.push(normalized);
    rowIdentities.forEach((identity) => identities.add(identity));
  }
}

function normalizeEventFeedRow(f, index = 0) {
  const endpoint = firstString(f?.endpoint, f?.base);
  const adapter = normalizeLocalEventAdapter(f?.adapter || f?.kind);
  if (!f || !endpoint || !adapter || !Array.isArray(f.bbox) || f.bbox.length < 4) return null;
  const bbox = f.bbox.map(Number);
  if (!bbox.every(Number.isFinite)) return null;
  return {
    id: String(f.id || `feed-${index}`),
    label: String(f.label || f.id || "Events"),
    // `base` remains for backward compatibility with the original Linked
    // Events rows. New reviewed source rows should use endpoint.
    base: endpoint,
    endpoint,
    adapter,
    format: firstString(f.format),
    bbox,
    license: f.license != null ? String(f.license) : null,
    timezone: f.timezone != null ? String(f.timezone) : null,
    timezone_offset: firstString(f.timezone_offset, f.timezoneOffset),
    source_language: firstString(f.source_language, f.sourceLanguage),
    supported_languages: Array.isArray(f.supported_languages)
      ? f.supported_languages.map(String).filter(Boolean)
      : null,
    route_role_hint: firstString(f.route_role_hint, f.routeRoleHint),
    fetch_details: f.fetch_details !== false,
    detail_limit: Number.isFinite(Number(f.detail_limit))
      ? Math.max(0, Math.floor(Number(f.detail_limit)))
      : null,
    detail_budget: Number.isFinite(Number(f.detail_budget))
      ? Math.max(1, Math.floor(Number(f.detail_budget)))
      : null,
    sitemap_limit: Number.isFinite(Number(f.sitemap_limit))
      ? Math.max(1, Math.floor(Number(f.sitemap_limit)))
      : null,
    page_size: Number.isFinite(Number(f.page_size))
      ? Math.max(1, Math.floor(Number(f.page_size)))
      : null,
    horizon_days: Number.isFinite(Number(f.horizon_days))
      ? Math.max(1, Math.floor(Number(f.horizon_days)))
      : null,
    event_path_prefix: firstString(f.event_path_prefix, f.eventPathPrefix),
    // Configuring an endpoint proves collection intent, not ownership or
    // official status. Missing review metadata stays conservative.
    source_tier: f.source_tier != null ? String(f.source_tier) : "unknown",
    confidence: f.confidence != null ? String(f.confidence) : "low",
    source_family: f.source_family != null
      ? String(f.source_family)
      : "unknown_source_family",
    source_identity: f.source_identity != null
      ? String(f.source_identity)
      : sourceIdentityForUrl(endpoint),
    priority: Number.isFinite(Number(f.priority)) ? Number(f.priority) : 100,
    status: f.status != null ? String(f.status) : "active",
    runtime_policy: f.runtime_policy != null
      ? String(f.runtime_policy)
      : "bounded_refresh",
    terms_status: f.terms_status != null ? String(f.terms_status) : null,
    source_health: f.source_health != null ? String(f.source_health) : null,
    profile_key: f.profile_key != null ? String(f.profile_key) : null,
    profile_reviewed_at: f.profile_reviewed_at != null
      ? String(f.profile_reviewed_at)
      : null,
    profile_qualified_at: f.profile_qualified_at != null
      ? String(f.profile_qualified_at)
      : null,
    profile_expires_at: f.profile_expires_at != null
      ? String(f.profile_expires_at)
      : null,
    runtime_trust: f.runtime_trust != null ? String(f.runtime_trust) : null,
    pulse_only: f.pulse_only === true,
    source_scoped_pulse: f.source_scoped_pulse === true,
  };
}

function feedIdentities(feed) {
  return [
    feed?.id ? `id:${String(feed.id).trim().toLowerCase()}` : null,
    firstString(feed?.endpoint, feed?.base)
      ? `endpoint:${String(firstString(feed.endpoint, feed.base)).trim().toLowerCase()}`
      : null,
  ].filter(Boolean);
}

function hasAnchor(anchor) {
  return anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng);
}

/**
 * The GLOBAL provider family — one integration that answers "what's on near these
 * coordinates" for ANY anchor (no bbox registry, no per-city rows). Key-gated and
 * fail-closed: without PARRANDA_TICKETMASTER_KEY the family is absent. Municipal
 * open feeds stay a complementary family for hyper-local happenings; this is what
 * makes live events work REGARDLESS of city, not via region hacks.
 */
function resolveGlobalEventKey(env = process.env) {
  const key = String((env && env.PARRANDA_TICKETMASTER_KEY) || "").trim();
  return key || null;
}

const GLOBAL_FEED_DESCRIPTOR = Object.freeze({
  id: "ticketmaster-global",
  label: "Ticketmaster",
  license: null, // commercial listings — attribution + outbound link, no open license claimed
  family: "global_commercial",
  source_tier: "verified",
  confidence: "medium",
  source_family: "global_commercial",
  source_identity: "ticketmaster.com",
  status: "active",
  runtime_policy: "credential_gated",
});

const CONFIDENCE_RANK = Object.freeze({
  needs_review: 0,
  low: 1,
  medium: 2,
  strong: 3,
});

// Backward-compatible singular view. Runtime acquisition uses the bounded plural
// resolver so overlapping approved feeds can corroborate one another.
function resolveEventFeedForAnchor(anchor, registry = BUILTIN_EVENT_FEEDS) {
  return resolveEventFeedsForAnchor(anchor, registry, { limit: 1 })[0] || null;
}

// Geo-filter the feed to the anchor + return genuine CURRENT happenings.
// The key is `sort=end_time`: it surfaces the soonest-ENDING events first — i.e.
// what is genuinely on now / today — and naturally pushes permanent exhibitions
// (whose end_time is years away) to the BACK. Crucially it avoids the server-side
// `max_duration` filter, which forced recurring-series expansion and made the
// query ~25 s; this query returns in a few seconds. Permanence/duration is then
// filtered CLIENT-side (isEphemeralHappening), feed-agnostically. The provider's
// own buildEventsUrl adds include/page_size/start/format WITHOUT clobbering these.
function buildAnchorEventEndpoint(base, anchor, { radiusM = DEFAULT_RADIUS_M } = {}) {
  let url;
  try {
    url = new URL(base);
  } catch (_e) {
    return base;
  }
  url.searchParams.set("dwithin_origin", `${anchor.lng},${anchor.lat}`);
  url.searchParams.set("dwithin_metres", String(Math.max(100, Math.round(radiusM))));
  url.searchParams.set("sort", "end_time");
  return url.toString();
}

function withinHorizonDays(startsAtIso, now, days) {
  if (!now) return true; // no clock → cannot exclude; keep (honest, undated)
  const starts = new Date(startsAtIso);
  if (!Number.isFinite(starts.getTime())) return false;
  const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return starts >= now && starts <= horizon;
}

function withinEventHorizon(event, now, days) {
  if (event?.starts_at) return withinHorizonDays(event.starts_at, now, days);
  const timezone = normalizeIanaTimezone(event?.timezone || event?.time_window?.timezone);
  const localNow = now && timezone ? datePartsInTimezone(now, timezone) : null;
  const startsOn = normalizeSourceEventDate(event?.starts_on || event?.time_window?.starts_on);
  const endsOn = normalizeSourceEventDate(event?.ends_on || event?.time_window?.ends_on) || startsOn;
  if (!localNow || !startsOn || !endsOn) return false;
  const today = `${localNow.year}-${String(localNow.month).padStart(2, "0")}-${String(localNow.day).padStart(2, "0")}`;
  const horizon = addDateOnlyDays(today, days);
  return Boolean(horizon && startsOn <= horizon && endsOn >= today);
}

// A genuine happening is time-bounded — not permanent infrastructure. Excludes
// always-open exhibitions (a 2001→2030 "event" the #279 normalizer rates `now`),
// malformed ancient dates (the feed's occasional year-0026 row), and undated
// rows that already started long ago. Feed-agnostic: it is the safety net behind
// the feed-level max_duration query, and it is what the deterministic tests
// exercise (they inject payloads, not query params).
function isEphemeralHappening(event, now) {
  const window = event?.time_window;
  if (window?.kind === "daily") {
    const startsOn = normalizeSourceEventDate(event.starts_on || window.starts_on);
    const endsOn = normalizeSourceEventDate(event.ends_on || window.ends_on) || startsOn;
    const timezone = normalizeIanaTimezone(event.timezone || window.timezone);
    if (!startsOn || !endsOn || !timezone || !validLocalClock(window.local_start) || !validLocalClock(window.local_end)) {
      return false;
    }
    return boundedDateOnlyRange(startsOn, endsOn, MAX_HAPPENING_DAYS);
  }
  if (window?.kind === "all_day") {
    const startsOn = normalizeSourceEventDate(event.starts_on || window.starts_on);
    const endsOn = normalizeSourceEventDate(event.ends_on || window.ends_on) || startsOn;
    return Boolean(startsOn && endsOn && boundedDateOnlyRange(startsOn, endsOn, MAX_HAPPENING_DAYS));
  }

  const start = event.starts_at ? new Date(event.starts_at) : null;
  if (!start || !Number.isFinite(start.getTime())) return false;
  if (start.getUTCFullYear() < 2000) return false; // malformed origin date
  const end = event.ends_at ? new Date(event.ends_at) : null;
  if (end && Number.isFinite(end.getTime())) {
    const durationDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    if (durationDays > MAX_HAPPENING_DAYS) return false; // permanent / always-open
  } else if (now && start.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    return false; // undated and already started long ago → not a live happening
  }
  return true;
}

// Pulse can honestly show a longer reviewed daily calendar window (for example
// a seasonal exhibition with explicit daily hours) without implying that it is
// a one-off route anchor. Continuous and all-day rows keep the stricter
// happening limit; only explicit daily windows get the wider display bound.
function isPulseDisplayEvent(event, now) {
  const window = event?.time_window;
  if (window?.kind !== "daily") return isEphemeralHappening(event, now);
  const startsOn = normalizeSourceEventDate(event.starts_on || window.starts_on);
  const endsOn = normalizeSourceEventDate(event.ends_on || window.ends_on) || startsOn;
  const timezone = normalizeIanaTimezone(event.timezone || window.timezone);
  if (!startsOn || !endsOn || !timezone || !validLocalClock(window.local_start) || !validLocalClock(window.local_end)) {
    return false;
  }
  return boundedDateOnlyRange(startsOn, endsOn, MAX_PULSE_DAILY_RANGE_DAYS);
}

// Collapse duplicate occurrences (recurring series surface the same title/venue
// repeatedly) — keep the first (already salience-ranked) per id, then per
// title+venue.
function dedupeViews(views) {
  const seen = new Set();
  const out = [];
  for (const v of views) {
    const key = eventViewIdentity(v);
    const titleKey = `${(v.title || "").toLowerCase()}|${v.place || ""}`;
    if (seen.has(key) || seen.has(titleKey)) continue;
    seen.add(key);
    seen.add(titleKey);
    out.push(v);
  }
  return out;
}

// Honest, prose-free user view of one event. The UI/i18n layer renders the label;
// this stays data (ids, ISO times, coords, source, trust). `eventTimezone` (from
// sources that carry an EVENT-level tz, e.g. the global provider) beats the
// feed-level region timezone — the truest venue-local clock wins.
function toEventView(event, feed, { eventTimezone = null, routeEligible = null } = {}) {
  const title = String(event.title || event.name || "").trim();
  if (!title) return null;
  const salience = scoreTimeSensitiveEventSalience(event);
  // Make "what's on" SMART, not just timely: a multilingual (en/el/sv) cultural
  // classifier lifts notable culture (concerts, festivals, exhibitions, workshops)
  // and demotes civic/admin notices (council/committee meetings) — generic, never
  // a city hack. Cultural cue wins ambiguity; neutral is unchanged.
  const cultural = classifyCulturalSalience(event);
  const score = Number(Math.min(salience.score * cultural.weight, 10).toFixed(2));
  return {
    id: event.id || null,
    title,
    starts_at: event.starts_at || null,
    ends_at: event.ends_at || null,
    starts_on: event.starts_on || null,
    ends_on: event.ends_on || null,
    time_window: event.time_window || null,
    timing_relevance: event.timing_relevance || null,
    place: event.place_context || event.area || null,
    address: event.address || null,
    lat: Number.isFinite(event.lat) ? event.lat : null,
    lng: Number.isFinite(event.lng) ? event.lng : null,
    source_label: event.source_label || event.provenance?.source_label || feed.label || null,
    source_url: event.source_url || event.provenance?.source_url || null,
    license: event.provenance?.license || feed.license || null,
    trust_level: event.confidence || null,
    cultural_tier: cultural.tier,
    salience_score: score,
    tags: Array.isArray(event.tags) ? event.tags : [],
    intents: Array.isArray(event.intents) ? event.intents : [],
    route_role_hint: event.route_role_hint || null,
    source_language: event.source_language || null,
    event_language: event.event_language || null,
    anchor_distance_km: Number.isFinite(event.anchor_distance_km) ? event.anchor_distance_km : null,
    fusion_status: event.fusion_status || "single_source",
    source_count: Number.isFinite(event.source_count) ? event.source_count : 1,
    independent_source_count: Number.isFinite(event.independent_source_count)
      ? event.independent_source_count
      : 1,
    sources: Array.isArray(event.sources) ? event.sources : [],
    venue_resolution: event.venue_resolution || null,
    pulse_display_eligible: true,
    route_eligible: routeEligible == null
      ? isEphemeralHappening(event, null)
      : Boolean(routeEligible),
    geometry_status: event.geometry_status || (Number.isFinite(event.lat) && Number.isFinite(event.lng)
      ? "resolved"
      : "unresolved"),
    geographic_relevance: event.geographic_relevance || null,
    source_scope_verified: event.source_scope_verified === true,
    local_significance: event.local_significance || null,
    // The venue-local timezone so the UI shows the real local start time.
    timezone: eventTimezone || feed.timezone || null,
  };
}

function rankEventViews(views, preferences = []) {
  return dedupeViews(
    views
    .filter(Boolean)
    .map((view) => withEventPreferenceFit(view, preferences))
    .sort(
      (a, b) =>
        eventRankingScore(b) - eventRankingScore(a) ||
        (b.salience_score || 0) - (a.salience_score || 0) ||
        String(a.starts_at || a.starts_on || "").localeCompare(String(b.starts_at || b.starts_on || "")) ||
        String(a.id || "").localeCompare(String(b.id || "")),
    ),
  );
}

function buildEventBucketSurface(views, preferences = []) {
  const ranked = rankEventViews(views, preferences);
  const highlights = selectEventHighlights(ranked, preferences);
  const highlighted = new Set(highlights.map(eventViewIdentity));
  const remaining = ranked.filter((view) => !highlighted.has(eventViewIdentity(view)));
  const more = remaining.slice(0, Math.max(0, MAX_BROWSE_PER_BUCKET - highlights.length));
  return {
    highlights,
    browse: {
      ranked_event_count: ranked.length,
      highlight_count: highlights.length,
      more_count: more.length,
      hidden_count: Math.max(0, ranked.length - highlights.length - more.length),
      more,
    },
  };
}

// Preference fit should personalize Live without turning it into a filter
// bubble. When all highlight slots are occupied by requested matches, reserve
// at most one slot for a genuinely salient local happening. The candidate has
// already passed the same source, timing, geometry and display gates as every
// other row; administrative notices and weak background rows never enter this
// bounded discovery lane.
function selectEventHighlights(ranked, preferences = []) {
  const highlights = ranked.slice(0, MAX_PER_BUCKET);
  if (
    highlights.length < MAX_PER_BUCKET ||
    !Array.isArray(preferences) ||
    preferences.length === 0 ||
    highlights.some(isSerendipityCandidate)
  ) {
    return highlights;
  }

  const discovery = ranked.slice(MAX_PER_BUCKET).find(isSerendipityCandidate);
  if (!discovery) return highlights;
  return [
    ...highlights.slice(0, -1),
    { ...discovery, highlight_reason: "local_serendipity" },
  ];
}

function isSerendipityCandidate(view) {
  return (
    view?.preference_match === "none" &&
    view?.cultural_tier !== "administrative" &&
    Number(view?.salience_score || 0) >= SERENDIPITY_MIN_SALIENCE
  );
}

function eventViewIdentity(view) {
  return view?.id || `${String(view?.title || "").toLowerCase()}|${view?.place || ""}`;
}

function emptyEventBrowse() {
  const emptyBucket = () => ({
    ranked_event_count: 0,
    highlight_count: 0,
    more_count: 0,
    hidden_count: 0,
    more: [],
  });
  return {
    contract: LIVE_EVENT_BROWSE_CONTRACT,
    max_rows_per_bucket: MAX_BROWSE_PER_BUCKET,
    tonight: emptyBucket(),
    this_week: emptyBucket(),
  };
}

function buildEventBrowse(tonightSurface, thisWeekSurface) {
  return {
    contract: LIVE_EVENT_BROWSE_CONTRACT,
    max_rows_per_bucket: MAX_BROWSE_PER_BUCKET,
    tonight: tonightSurface.browse,
    this_week: thisWeekSurface.browse,
  };
}

function withEventPreferenceFit(view, preferences = []) {
  const fit = scoreEventPreferenceFit(view, preferences);
  if (fit.requested_preferences.length === 0) return view;
  return {
    ...view,
    preference_match: fit.level,
    preference_score: fit.score,
    requested_preferences: fit.requested_preferences,
    matched_preferences: fit.matched_preferences,
    partial_preferences: fit.partial_preferences,
    missing_preferences: fit.missing_preferences,
    preference_reasons: fit.reasons,
  };
}

function eventRankingScore(view) {
  return Number(view?.salience_score || 0) + Number(view?.preference_score || 0);
}

function rankCollectedEventsForPreferences(collected, preferences = [], scope = null) {
  if (!collected || typeof collected !== "object") return collected;
  const pool = collected._rankable_events;
  const tonightPool = Array.isArray(pool?.tonight) ? pool.tonight : collected.tonight;
  const thisWeekPool = Array.isArray(pool?.this_week) ? pool.this_week : collected.this_week;
  const { _rankable_events: _internalPool, ...publicResult } = collected;
  const tonightSurface = buildEventBucketSurface(
    filterEventsForLiveScope(tonightPool, scope),
    preferences,
  );
  const thisWeekSurface = buildEventBucketSurface(
    filterEventsForLiveScope(thisWeekPool, scope),
    preferences,
  );
  const tonight = tonightSurface.highlights;
  const thisWeek = thisWeekSurface.highlights;
  const acquisition = publicResult.acquisition && typeof publicResult.acquisition === "object"
    ? {
        ...publicResult.acquisition,
        ...(publicResult.acquisition.source_health && typeof publicResult.acquisition.source_health === "object"
          ? {
              source_health: {
                ...publicResult.acquisition.source_health,
                surfaced_event_count: tonight.length + thisWeek.length,
              },
            }
          : {}),
      }
    : null;
  return {
    ...publicResult,
    ...(acquisition ? { acquisition } : {}),
    tonight,
    this_week: thisWeek,
    browse: buildEventBrowse(tonightSurface, thisWeekSurface),
  };
}

function buildScopedEventSourcePlan({
  anchor,
  sourceAnchors = [],
  registry,
  now = Date.now(),
  globalSource = null,
  globalEnabled = false,
  maxSources = DEFAULT_MAX_SOURCES,
  maxLocalSources = DEFAULT_MAX_LOCAL_SOURCES,
  now,
} = {}) {
  const sourceCap = Math.max(1, Math.min(Number(maxSources) || DEFAULT_MAX_SOURCES, DEFAULT_MAX_SOURCES));
  const reserveGlobal = globalEnabled && globalSource ? 1 : 0;
  const requestedLocalCap = Number(maxLocalSources);
  const localCap = Math.max(0, Math.min(
    Number.isFinite(requestedLocalCap) ? requestedLocalCap : DEFAULT_MAX_LOCAL_SOURCES,
    sourceCap - reserveGlobal,
  ));
  const anchors = [anchor, ...(Array.isArray(sourceAnchors) ? sourceAnchors : [])]
    .filter((point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .filter((point, index, rows) => rows.findIndex(
      (candidate) => candidate.lat.toFixed(5) === point.lat.toFixed(5) && candidate.lng.toFixed(5) === point.lng.toFixed(5),
    ) === index);
  const selected = [];
  const seen = new Set();

  for (const sourceAnchor of anchors) {
    const localSources = buildAnchorEventSourcePlan({
      anchor: sourceAnchor,
      registry,
      now,
      globalSource: null,
      globalEnabled: false,
      maxSources: DEFAULT_MAX_SOURCES,
      maxLocalSources: DEFAULT_MAX_LOCAL_SOURCES,
      now,
    });
    for (const source of localSources) {
      const identity = String(source.id || source.endpoint || source.base || "");
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      selected.push(source);
      if (selected.length >= localCap) break;
    }
    if (selected.length >= localCap) break;
  }

  if (reserveGlobal && selected.length < sourceCap) selected.push({ ...globalSource, kind: "global" });
  return selected.slice(0, sourceCap);
}

/**
 * Collect ranked live events near an anchor, bucketed tonight / this_week.
 * @param {object} opts
 * @param {{lat:number,lng:number}} opts.anchor  trusted coordinate anchor
 * @param {string|Date|null} [opts.now]          trusted clock (tests inject)
 * @param {string|null} [opts.date]              feed window start (default today)
 * @param {string[]} [opts.preferences]          rank context only; never source evidence
 * @param {object|null} [opts.scope]              trusted query geometry; filters cached evidence before ranking
 * @param {object[]} [opts.sourceAnchors]         reviewed-source discovery points for a bounded route corridor
 * @param {object[]} [opts.registry]             feed registry (default built-in)
 * @param {Function} [opts.fetcher]              injected fetch (tests)
 * @param {Function|null} [opts.venueResolver]    trusted server-only place resolver
 * @param {number} [opts.venueResolutionLimit]    bounded unique venue lookups
 * @param {object|null} [opts.spatialScope]        resolver-attested regional bounds, never public payload
 * @param {object|null} [opts.placeContext]        resolver-attested administrative context
 * @returns {Promise<{coverage:"covered"|"uncovered", feed:object|null, feeds:object[], tonight:object[], this_week:object[], acquisition:object}>}
 */
async function collectAnchorEvents({
  anchor,
  sourceAnchors = [],
  now = null,
  date = null,
  preferences = [],
  scope = null,
  registry,
  fetcher,
  radiusM,
  timeoutMs = 15000,
  globalKey = null,
  maxSources = DEFAULT_MAX_SOURCES,
  maxLocalSources = DEFAULT_MAX_LOCAL_SOURCES,
  venueResolver = null,
  venueResolutionLimit = 4,
  spatialScope = null,
  placeContext = null,
} = {}) {
  const effectiveRadiusM = Math.min(
    MAX_COLLECTION_RADIUS_M,
    Math.max(100, Math.round(radiusM || DEFAULT_RADIUS_M)),
  );
  const sourcePlan = buildScopedEventSourcePlan({
    anchor,
    sourceAnchors,
    registry: registry || resolveEventFeedRegistry(),
    now,
    globalSource: GLOBAL_FEED_DESCRIPTOR,
    globalEnabled: Boolean(globalKey),
    maxSources,
    maxLocalSources,
    // The same server-owned instant the rest of this collection reasons with.
    // Without it this plan expired qualifications against the real clock while
    // the caller's plan used the injected one, so one request could hold two
    // time bases and the warm result could disagree with the first.
    now,
  });
  if (sourcePlan.length === 0) {
    return {
      coverage: "uncovered",
      feed: null,
      feeds: [],
      tonight: [],
      this_week: [],
      browse: emptyEventBrowse(),
      acquisition: emptyAcquisition(effectiveRadiusM),
    };
  }

  const nowDate = now ? new Date(now) : null;
  // Window each source from NOW forward so a late-evening request does not spend
  // its bounded page on already-past rows. All selected sources run concurrently;
  // the slowest timeout is the upper bound, not source_count × timeout.
  const startParam = date || (nowDate ? nowDate.toISOString() : null);
  const collectedSources = await Promise.all(
    sourcePlan.map((source) =>
      collectEventSource({
        source,
        anchor,
        nowDate,
        startParam,
        fetcher,
        radiusM: effectiveRadiusM,
        timeoutMs,
        globalKey,
      }),
    ),
  );

  const normalizedEvidence = [];
  for (const collection of collectedSources) {
    const source = collection.source;
    for (const rawEvent of collection.raw) {
      const enriched = applyReviewedSourceTrust(rawEvent, source);
      const normalized = normalizeTimeSensitiveSourceEvent(enriched, {
        ...(nowDate ? { now: nowDate } : {}),
        timezone: source.timezone || undefined,
      });
      if (!normalized) continue;
      if (rawEvent.timezone) normalized.timezone = rawEvent.timezone;
      normalizedEvidence.push(normalized);
    }
  }

  // A bounded server-owned resolver may recover source-backed venue geometry.
  // Public payload cannot inject this seam; ambiguous, weak or out-of-radius
  // results remain mapless and are rejected by the unchanged fusion gate below.
  const venueResolution = await resolveEventVenueGeometry(
    normalizedEvidence.slice().sort(compareVenueResolutionPriority),
    {
      resolver: venueResolver,
      anchor,
      radiusM: effectiveRadiusM,
      spatialScope,
      placeContext,
      limit: venueResolutionLimit,
    },
  );

  // Explicit outside-radius rows are rejected before fusion. A mapless row can
  // only survive when another source describes the same occurrence with trusted
  // coordinates, after which the fused occurrence is bounded again.
  const bounded = fuseAndBoundEventEvidence(venueResolution.events, {
    anchor,
    radiusM: effectiveRadiusM,
    spatialScope,
    sourceScopedPulseIds: sourcePlan
      .filter((source) => source.source_scoped_pulse === true)
      .map((source) => source.id),
  });
  const rejected = [...bounded.rejected];
  const sourceById = new Map(sourcePlan.map((source) => [source.id, source]));
  const tonight = [];
  const thisWeek = [];

  for (const event of [...bounded.events, ...(bounded.pulse_only_events || [])]) {
    if (!isPulseDisplayEvent(event, nowDate)) {
      rejected.push({
        id: event.fusion_id || event.id || null,
        source_provider_id: event.source_provider_id || null,
        reason: "not_ephemeral_happening",
      });
      continue;
    }
    const source = sourceById.get(event.source_provider_id) || sourcePlan[0];
    const view = toEventView(event, source, {
      eventTimezone: event.timezone || null,
      routeEligible:
        event.geographic_relevance === "source_scope" ||
        source?.pulse_only === true
          ? false
          : isEphemeralHappening(event, nowDate),
    });
    if (!view) continue;
    if (TONIGHT_TIMING.has(event.timing_relevance)) {
      tonight.push(view);
    } else if (
      (event.timing_relevance === "future" || event.time_window?.kind === "all_day") &&
      withinEventHorizon(event, nowDate, THIS_WEEK_HORIZON_DAYS)
    ) {
      thisWeek.push(view);
    }
  }

  const tonightSurface = buildEventBucketSurface(
    filterEventsForLiveScope(tonight, scope),
    preferences,
  );
  const thisWeekSurface = buildEventBucketSurface(
    filterEventsForLiveScope(thisWeek, scope),
    preferences,
  );
  const rankedTonight = tonightSurface.highlights;
  const rankedThisWeek = thisWeekSurface.highlights;
  const feeds = collectedSources.map(compactSourceStatus);
  const sourceHealth = buildAnchorEventSourceHealth(collectedSources, {
    acceptedEventCount: tonight.length + thisWeek.length,
    surfacedEventCount: rankedTonight.length + rankedThisWeek.length,
    normalizedEventCount: normalizedEvidence.length,
    rejected,
  });
  return {
    coverage: "covered",
    feed: feeds[0] || null,
    feeds,
    tonight: rankedTonight,
    this_week: rankedThisWeek,
    browse: buildEventBrowse(tonightSurface, thisWeekSurface),
    // The normalized, geo/timing-gated pool is cached independently of user
    // preferences. A warm cache can therefore be reranked instantly without a
    // second provider request, while the public route response receives only
    // the capped `tonight` / `this_week` views.
    _rankable_events: {
      tonight,
      this_week: thisWeek,
    },
    acquisition: {
      mode: "bounded_multi_source",
      radius_m: effectiveRadiusM,
      source_cap: Math.max(1, Math.min(Number(maxSources) || DEFAULT_MAX_SOURCES, DEFAULT_MAX_SOURCES)),
      selected_source_count: sourcePlan.length,
      normalized_event_count: normalizedEvidence.length,
      fused_event_count: bounded.fused_count,
      rejected_event_count: rejected.length,
      rejection_summary: summarizeRejections(rejected),
      source_health: sourceHealth,
      venue_resolution: venueResolution.summary,
      geometry_scope: bounded.geometry_scope,
    },
  };
}

function boundedDateOnlyRange(startsOn, endsOn, maxDays = MAX_HAPPENING_DAYS) {
  const startOrdinal = dateOnlyOrdinal(startsOn);
  const endOrdinal = dateOnlyOrdinal(endsOn);
  if (startOrdinal == null || endOrdinal == null || endOrdinal < startOrdinal) return false;
  return endOrdinal - startOrdinal <= maxDays;
}

function compareVenueResolutionPriority(left, right) {
  const rank = { now: 0, tonight: 1, today: 2, future: 3, unknown: 4, stale: 5 };
  return (
    (rank[left?.timing_relevance] ?? 6) - (rank[right?.timing_relevance] ?? 6) ||
    String(left?.starts_at || left?.starts_on || "").localeCompare(
      String(right?.starts_at || right?.starts_on || ""),
    ) ||
    String(left?.id || "").localeCompare(String(right?.id || ""))
  );
}

function dateOnlyOrdinal(value) {
  const normalized = normalizeSourceEventDate(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000));
}

function addDateOnlyDays(value, days) {
  const ordinal = dateOnlyOrdinal(value);
  if (ordinal == null) return null;
  return new Date((ordinal + days) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function validLocalClock(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function applyReviewedSourceTrust(rawEvent = {}, source = {}) {
  const globalSource = source.kind === "global";
  const descriptorConfidence = normalizeEventConfidence(
    source.confidence,
    globalSource ? "medium" : "low",
  );
  const eventConfidence = rawEvent.confidence == null
    ? descriptorConfidence
    : normalizeEventConfidence(rawEvent.confidence, "needs_review");

  return {
    ...rawEvent,
    // Trust and ownership are reviewed descriptor facts. Provider rows may
    // lower per-event confidence, but may never upgrade or relabel the source.
    // That includes the DISPLAY label: the reviewed row's label ("Helsinki
    // Region Linked Events") is the attribution unit the user can verify —
    // never a provider-internal id like "helsinki"/"kulke".
    source_label: firstString(source.label) || firstString(rawEvent.source_label) || null,
    source_tier: firstString(source.source_tier) || (globalSource ? "verified" : "unknown"),
    confidence: lowerConfidence(descriptorConfidence, eventConfidence),
    source_provider_id: firstString(source.id) || null,
    source_identity:
      firstString(source.source_identity) ||
      sourceIdentityForUrl(source.base || source.source_url) ||
      firstString(source.id),
    source_family:
      firstString(source.source_family, source.family) ||
      (globalSource ? "global_commercial" : "unknown_source_family"),
  };
}

function normalizeEventConfidence(value, fallback) {
  const normalized = String(value || fallback || "needs_review").trim().toLowerCase();
  if (normalized === "high") return "strong";
  if (normalized === "weak") return "low";
  return Object.hasOwn(CONFIDENCE_RANK, normalized) ? normalized : "needs_review";
}

function lowerConfidence(left, right) {
  const normalizedLeft = normalizeEventConfidence(left, "needs_review");
  const normalizedRight = normalizeEventConfidence(right, "needs_review");
  return CONFIDENCE_RANK[normalizedLeft] <= CONFIDENCE_RANK[normalizedRight]
    ? normalizedLeft
    : normalizedRight;
}

async function collectEventSource({
  source,
  anchor,
  nowDate,
  startParam,
  fetcher,
  radiusM,
  timeoutMs,
  globalKey,
}) {
  let provider;
  if (source.kind === "global") {
    provider = createTicketmasterProvider({
      key: globalKey,
      anchor,
      radiusKm: Math.max(1, Math.round(radiusM / 1000)),
      windowDays: THIS_WEEK_HORIZON_DAYS,
      now: nowDate || undefined,
      fetcher: fetcher || undefined,
      timeoutMs: Math.max(1000, Math.floor(timeoutMs) || 15000),
      pageSize: FETCH_LIMIT,
    });
  } else {
    provider = createLocalEventProvider(source, {
      anchor,
      fetcher,
      radiusM,
      timeoutMs,
    });
  }

  if (!provider) {
    return { source, raw: [], status: "unavailable", reason: "source_adapter_unsupported" };
  }

  try {
    const collected = await provider.create({ key: null }).collect({ date: startParam });
    const raw = Array.isArray(collected && collected.time_sensitive_events) ? collected.time_sensitive_events : [];
    const outcome = normalizeDirectCollectionOutcome(collected?.collection_status, raw.length);
    return {
      source,
      raw,
      status: outcome.status,
      reason: outcome.reason,
    };
  } catch (_error) {
    return { source, raw: [], status: "failed", reason: "source_collect_failed" };
  }
}

function createLocalEventProvider(source, { anchor, fetcher, radiusM, timeoutMs } = {}) {
  const adapter = normalizeLocalEventAdapter(source?.adapter || source?.kind);
  if (!adapter) return null;
  const endpoint = firstString(source.endpoint, source.base);
  const common = {
    endpoint,
    fetcher: fetcher || undefined,
    limit: FETCH_LIMIT,
    timeoutMs: Math.max(1000, Math.floor(timeoutMs) || 15000),
    label: source.label,
    sourceUrl: firstString(source.source_url, endpoint),
    license: source.license,
  };

  if (adapter === "linked_events") {
    return createLinkedEventsProvider({
      ...common,
      endpoint: buildAnchorEventEndpoint(endpoint, anchor, { radiusM }),
    });
  }
  if (adapter === "schema_org" || adapter === "schema_org_html") {
    return createSchemaOrgEventProvider({
      ...common,
      format: adapter === "schema_org_html" ? "html" : source.format,
    });
  }
  if (adapter === "events_calendar" || adapter === "ical") {
    return createEventsCalendarProvider({
      ...common,
      format: adapter === "ical" ? "ical" : source.format,
      timezone: source.timezone || undefined,
      status: "active",
    });
  }
  if (adapter === "rss_atom_event_detail") {
    return createRssAtomEventProvider({
      ...common,
      sourceLanguage: source.source_language || undefined,
      supportedLanguages: source.supported_languages || undefined,
      sourceTier: source.source_tier || undefined,
      confidence: source.confidence || undefined,
      detailLimit: source.detail_limit || undefined,
      detailBudget: source.detail_budget || undefined,
    });
  }
  if (adapter === "html_venue_calendar") {
    return createHtmlVenueCalendarProvider({
      ...common,
      status: "active",
      baseUrl: endpoint,
      timezoneOffset: source.timezone_offset || undefined,
      sourceLanguage: source.source_language || undefined,
      routeRoleHint: source.route_role_hint || undefined,
      fetchDetails: source.fetch_details !== false,
    });
  }
  if (adapter === "sitevision_calendar") {
    return createSitevisionCalendarProvider({
      ...common,
      status: "active",
      baseUrl: endpoint,
      timezone: source.timezone || undefined,
      sourceLanguage: source.source_language || undefined,
      routeRoleHint: source.route_role_hint || undefined,
      fetchDetails: source.fetch_details !== false,
      detailLimit: source.detail_limit || undefined,
    });
  }
  if (adapter === "wix_event_sitemap") {
    return createWixEventSitemapProvider({
      ...common,
      status: "active",
      sitemapUrl: endpoint,
      timezone: source.timezone || undefined,
      sourceLanguage: source.source_language || undefined,
      routeRoleHint: source.route_role_hint || undefined,
      detailLimit: source.detail_limit || undefined,
      detailBudget: source.detail_budget || undefined,
      sitemapLimit: source.sitemap_limit || undefined,
      eventPathPrefix: source.event_path_prefix || undefined,
    });
  }
  if (adapter === "localized_events_api") {
    return createLocalizedEventsApiProvider({
      ...common,
      status: "active",
      timezone: source.timezone || undefined,
      sourceLanguage: source.source_language || undefined,
      supportedLanguages: source.supported_languages || undefined,
      limit: source.page_size || undefined,
    });
  }
  if (adapter === "embedded_program_rsc") {
    return createEmbeddedProgramRscProvider({
      ...common,
      status: "active",
      timezone: source.timezone || undefined,
      sourceLanguage: source.source_language || undefined,
      sourceTier: source.source_tier || undefined,
      confidence: source.confidence || undefined,
      sourceFamily: source.source_family || undefined,
      detailPathPrefix: source.event_path_prefix || undefined,
      limit: source.page_size || undefined,
      horizonDays: source.horizon_days || undefined,
    });
  }
  if (adapter === "official_program_article") {
    return createOfficialProgramArticleProvider({
      ...common,
      status: "active",
      timezone: source.timezone || undefined,
      sourceLanguage: source.source_language || undefined,
      sourceTier: source.source_tier || undefined,
      confidence: source.confidence || undefined,
      sourceFamily: source.source_family || undefined,
      limit: source.page_size || undefined,
      horizonDays: source.horizon_days || undefined,
      allDayLimit: source.all_day_limit || undefined,
    });
  }
  return null;
}

function compactSourceStatus(collection) {
  const source = collection.source;
  const probationary = source.runtime_trust === "qualified_probationary";
  return {
    id: source.id,
    label: source.label,
    license: source.license ?? null,
    family: source.source_family || source.family || (source.kind === "global" ? "global_commercial" : "municipal_open"),
    adapter: source.kind === "global" ? "global" : normalizeLocalEventAdapter(source.adapter || source.kind),
    source_identity: source.source_identity || sourceIdentityForUrl(source.base || source.source_url) || source.id,
    status: collection.status,
    reason: collection.reason || null,
    event_rows: collection.raw.length,
    ...(source.terms_status ? { terms_status: source.terms_status } : {}),
    ...(source.source_health && !probationary ? { reviewed_source_health: source.source_health } : {}),
    ...(source.source_health && probationary ? { qualified_source_health: source.source_health } : {}),
    ...(source.runtime_trust ? { runtime_trust: source.runtime_trust } : {}),
    ...(source.pulse_only === true ? { pulse_only: true } : {}),
    ...(source.source_scoped_pulse === true ? { source_scoped_pulse: true } : {}),
    ...(source.profile_key
      ? {
          source_profile: {
            profile_key: source.profile_key,
            reviewed_at: source.profile_reviewed_at || null,
            qualified_at: source.profile_qualified_at || null,
            expires_at: source.profile_expires_at || null,
          },
        }
      : {}),
  };
}

function emptyAcquisition(radiusM, discoveryHealth = null) {
  const normalizedDiscoveryHealth = normalizeSourceDiscoveryHealth(discoveryHealth) ||
    unavailableSourceDiscoveryHealth("unavailable", "source_discovery_unavailable");
  const sourceHealth = buildAnchorEventSourceHealth([]);
  sourceHealth.reasons = [...new Set([
    ...sourceHealth.reasons,
    ...normalizedDiscoveryHealth.reasons,
  ])];
  return {
    mode: "bounded_multi_source",
    radius_m: radiusM,
    source_cap: DEFAULT_MAX_SOURCES,
    selected_source_count: 0,
    normalized_event_count: 0,
    fused_event_count: 0,
    rejected_event_count: 0,
    rejection_summary: [],
    source_health: sourceHealth,
    discovery_health: normalizedDiscoveryHealth,
  };
}

function normalizeDirectCollectionOutcome(outcome, eventRows) {
  const status = ["ok", "empty", "failed", "unavailable"].includes(outcome?.status)
    ? outcome.status
    : eventRows > 0
      ? "ok"
      : "empty";
  return {
    status,
    reason: typeof outcome?.reason === "string" && outcome.reason.trim()
      ? outcome.reason.trim()
      : status === "empty"
        ? "source_empty"
        : null,
  };
}

/**
 * Env-gated default supply, mirroring the loader/resolver: a no-arg deploy gets
 * `null` (no live-event calls — production opts in explicitly via
 * PARRANDA_AGNOSTIC_EVENTS). Returns an
 * `({anchor, now, preferences}) => Promise<result>`
 * bound to the env-resolved registry, using global fetch.
 */
// Coarse cache key: ~1 km anchor bucket + hour bucket (events are time-sensitive,
// so the window must not be stale, but a fresh request a minute later must hit).
function eventCacheKey(
  anchor,
  now,
  sourceIds = [],
  radiusM = DEFAULT_RADIUS_M,
  spatialScope = null,
) {
  const lat = Number(anchor.lat).toFixed(2);
  const lng = Number(anchor.lng).toFixed(2);
  const hour = (now ? new Date(now) : new Date(0)).toISOString().slice(0, 13);
  const sources = (Array.isArray(sourceIds) ? sourceIds : [])
    .map(String)
    .sort()
    .join(",");
  const radius = Math.min(MAX_COLLECTION_RADIUS_M, Math.max(100, Math.round(Number(radiusM) || DEFAULT_RADIUS_M)));
  return `${lat},${lng}:${hour}:${radius}:${spatialScopeCacheKey(spatialScope)}:${sources}`;
}

function sourceIdentityForUrl(value) {
  try {
    return new URL(String(value || "").trim()).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_error) {
    return null;
  }
}

function normalizeLocalEventAdapter(value) {
  const raw = String(value || "linked_events").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    linked_event: "linked_events",
    schema_org_event: "schema_org",
    schema_org_json: "schema_org",
    schema_org_jsonld: "schema_org",
    schema_org_json_ld: "schema_org",
    schema_org_html_jsonld: "schema_org_html",
    the_events_calendar: "events_calendar",
    events_calendar_rest: "events_calendar",
    ics: "ical",
    rss: "rss_atom_event_detail",
    atom: "rss_atom_event_detail",
    rss_atom: "rss_atom_event_detail",
    html_calendar: "html_venue_calendar",
    venue_calendar: "html_venue_calendar",
    sitevision: "sitevision_calendar",
    sitevision_event_calendar: "sitevision_calendar",
    wix: "wix_event_sitemap",
    wix_event_calendar: "wix_event_sitemap",
    wix_sitemap: "wix_event_sitemap",
    localized_api: "localized_events_api",
    localized_event_api: "localized_events_api",
    localized_public_events: "localized_events_api",
    embedded_program: "embedded_program_rsc",
    next_rsc_program: "embedded_program_rsc",
    nextjs_program: "embedded_program_rsc",
    official_article_program: "official_program_article",
    public_program_article: "official_program_article",
  };
  const normalized = aliases[raw] || raw;
  return LOCAL_EVENT_ADAPTERS.has(normalized) ? normalized : null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

const EVENT_CACHE_TTL_MS = 20 * 60 * 1000; // 20 min — time-sensitive, but reusable
const WARM_TIMEOUT_MS = 30000; // out-of-band, so a long timeout never blocks a route
const EVENT_CACHE_NAMESPACE = "agnostic-events-v3";

function shouldCacheEventSupplyResult(result) {
  if (!result || result.coverage !== "covered") return false;
  const health = result.acquisition && result.acquisition.source_health;
  if (!health || typeof health !== "object") return false;

  // Keep useful partial results and proven healthy empties. A partial/unavailable
  // empty result may be a transient provider failure and must remain retryable.
  if (health.result === "events_found") return true;
  return health.status === "healthy" && health.result === "empty";
}

/**
 * Default event supply: env-gated + BACKGROUND-WARMED. Selected sources can be
 * slow and high-variance, so they must NEVER be fetched inline on the route. On a
 * cold anchor we kick one bounded concurrent warm and return honest `pending`;
 * once warm, the next visit serves the cached fused result. Even a valid empty
 * result is cached so "nothing on" never becomes an unbounded refresh loop.
 */
function resolveDefaultEventSupply(
  env = process.env,
  {
    venueResolver = null,
    sourceCatalog = null,
    eventCache = null,
    collectEvents = collectAnchorEvents,
  } = {},
) {
  const flag = String((env && env.PARRANDA_AGNOSTIC_EVENTS) || "").trim().toLowerCase();
  if (!["enabled", "1", "true", "on", "yes"].includes(flag)) return null;
  const registry = resolveEventFeedRegistry(env);
  const globalKey = resolveGlobalEventKey(env);
  const qualifiedRuntimeEnabled = ["enabled", "1", "true", "on", "yes"].includes(
    String((env && env.PARRANDA_QUALIFIED_SOURCE_RUNTIME) || "").trim().toLowerCase(),
  );
  const cache = eventCache || createSourceCache({
    // v2 excludes transient partial-empty acquisitions that v1 could persist.
    namespace: EVENT_CACHE_NAMESPACE,
    ttlMs: EVENT_CACHE_TTL_MS,
    dir: (env && env.PARRANDA_CACHE_DIR) || null,
  });
  return async ({
    anchor,
    sourceAnchors = [],
    placeLabel = null,
    placeContext = null,
    spatialScope = null,
    now,
    preferences = [],
    radiusM,
    scope = null,
  } = {}) => {
    const requestRegistry = [...registry];
    if (sourceCatalog && typeof sourceCatalog.listApprovedEventFeedsForAnchor === "function") {
      try {
        const catalogFeeds = await sourceCatalog.listApprovedEventFeedsForAnchor({ anchor, now });
        appendUniqueEventFeeds(requestRegistry, catalogFeeds);
      } catch (_error) {
        // The catalog is supplemental. A database outage must not take down
        // reviewed file/env feeds or the route request using this supply seam.
      }
    }
    if (
      qualifiedRuntimeEnabled &&
      sourceCatalog &&
      typeof sourceCatalog.listQualifiedEventFeedsForAnchor === "function"
    ) {
      try {
        const qualifiedFeeds = await sourceCatalog.listQualifiedEventFeedsForAnchor({ anchor, now });
        appendUniqueEventFeeds(requestRegistry, qualifiedFeeds);
      } catch (_error) {
        // Probationary sources are supplemental and Pulse-only. Catalog failure
        // cannot remove approved feeds or affect route composition.
      }
    }
    const effectiveRadiusM = Math.min(
      MAX_COLLECTION_RADIUS_M,
      Math.max(100, Math.round(Number(radiusM) || DEFAULT_RADIUS_M)),
    );
    const sourcePlan = buildScopedEventSourcePlan({
      anchor,
      sourceAnchors,
      registry: requestRegistry,
      now,
      globalSource: GLOBAL_FEED_DESCRIPTOR,
      globalEnabled: Boolean(globalKey),
      now,
    });
    const hasApprovedLocalSource = sourcePlan.some((source) => source?.kind !== "global");
    let discoveryHealth = null;
    if (!hasApprovedLocalSource) {
      discoveryHealth = await resolveUncoveredDiscoveryHealth(sourceCatalog, anchor);
    }
    if (
      !hasApprovedLocalSource &&
      sourceCatalog &&
      typeof sourceCatalog.recordScoutDemand === "function"
    ) {
      // Demand recording is a bounded database write only. Discovery/network
      // work remains exclusively in the background worker, and this promise is
      // intentionally detached so catalog latency cannot delay route/Pulse.
      Promise.resolve(sourceCatalog.recordScoutDemand({
        anchor,
        placeLabel,
        placeContext,
        spatialScope,
      })).catch(() => {});
      if (!discoveryHealth) {
        discoveryHealth = pendingSourceDiscoveryHealth("source_discovery_pending");
      }
    }
    if (sourcePlan.length === 0) {
      return {
        coverage: "uncovered",
        feed: null,
        feeds: [],
        tonight: [],
        this_week: [],
        browse: emptyEventBrowse(),
        acquisition: emptyAcquisition(
          effectiveRadiusM,
          discoveryHealth || unavailableSourceDiscoveryHealth(
            "environment_not_wired",
            "source_discovery_environment_not_wired",
          ),
        ),
      };
    }
    const descriptors = sourcePlan.map((source) => compactSourceStatus({ source, status: "pending", raw: [] }));
    const key = eventCacheKey(
      anchor,
      now,
      sourcePlan.map((source) => source.id),
      effectiveRadiusM,
      spatialScope,
    );
    const cached = cache.peek(key);
    if (cached) return rankCollectedEventsForPreferences(cached, preferences, scope);
    // Cold: warm out-of-band (long timeout, fire-and-forget), serve honest pending.
    cache.warm(key, () => collectEvents({
      anchor,
      sourceAnchors,
      now,
      registry: requestRegistry,
      radiusM: effectiveRadiusM,
      timeoutMs: WARM_TIMEOUT_MS,
      globalKey,
      venueResolver,
      spatialScope,
      placeContext,
    }), {
      // A proven healthy empty result is cacheable so a quiet calendar does not
      // cause refresh loops. Empty results with source failures stay retryable.
      shouldStore: shouldCacheEventSupplyResult,
    });
    return {
      coverage: "covered",
      feed: descriptors[0] || null,
      feeds: descriptors,
      tonight: [],
      this_week: [],
      browse: emptyEventBrowse(),
      pending: true,
      acquisition: {
        mode: "bounded_multi_source",
        radius_m: effectiveRadiusM,
        source_cap: DEFAULT_MAX_SOURCES,
        selected_source_count: sourcePlan.length,
        normalized_event_count: 0,
        fused_event_count: 0,
        rejected_event_count: 0,
        rejection_summary: [],
        source_health: {
          status: "pending",
          result: "pending",
          selected_source_count: sourcePlan.length,
          responding_source_count: 0,
          event_bearing_source_count: 0,
          empty_source_count: 0,
          failed_source_count: 0,
          unavailable_source_count: 0,
          raw_event_count: 0,
          normalized_event_count: 0,
          accepted_event_count: 0,
          surfaced_event_count: 0,
          rejected_event_count: 0,
          reasons: ["background_refresh_pending"],
        },
      },
    };
  };
}

async function resolveUncoveredDiscoveryHealth(sourceCatalog, anchor) {
  if (!sourceCatalog) {
    return unavailableSourceDiscoveryHealth(
      "environment_not_wired",
      "source_discovery_environment_not_wired",
    );
  }
  if (typeof sourceCatalog.getDiscoveryHealthForAnchor === "function") {
    try {
      return normalizeSourceDiscoveryHealth(
        await sourceCatalog.getDiscoveryHealthForAnchor({ anchor }),
      );
    } catch (_error) {
      return unavailableSourceDiscoveryHealth("unavailable", "source_catalog_unavailable");
    }
  }
  if (typeof sourceCatalog.recordScoutDemand === "function") return null;
  return unavailableSourceDiscoveryHealth(
    "environment_not_wired",
    "source_discovery_environment_not_wired",
  );
}

module.exports = {
  applyReviewedSourceTrust,
  buildScopedEventSourcePlan,
  collectAnchorEvents,
  shouldCacheEventSupplyResult,
  resolveDefaultEventSupply,
  resolveEventFeedRegistry,
  resolveEventFeedForAnchor,
  resolveEventFeedsForAnchor,
  resolveGlobalEventKey,
  buildAnchorEventEndpoint,
  eventCacheKey,
  BUILTIN_EVENT_FEEDS,
  HELSINKI_LINKED_EVENTS_FEED,
  GLOBAL_FEED_DESCRIPTOR,
  DEFAULT_RADIUS_M,
  MAX_PER_BUCKET,
  MAX_BROWSE_PER_BUCKET,
  SERENDIPITY_MIN_SALIENCE,
  LIVE_EVENT_BROWSE_CONTRACT,
  LOCAL_EVENT_ADAPTERS,
  normalizeLocalEventAdapter,
  createLocalEventProvider,
  isEphemeralHappening,
  isPulseDisplayEvent,
  rankCollectedEventsForPreferences,
  toEventView,
};
