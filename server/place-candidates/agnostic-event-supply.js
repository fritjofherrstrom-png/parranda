"use strict";

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
const { normalizeTimeSensitiveSourceEvent } = require("../pulse-sources/time-sensitive-event");
const { scoreTimeSensitiveEventSalience } = require("../pulse-engine/time-sensitive-events");
const { createSourceCache } = require("./source-cache");
const { classifyCulturalSalience } = require("../pulse-engine/cultural-salience");
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
// Every place gets live events the SAME way — from the coordinate-driven global
// provider (key-gated) — or an honest "no events yet". A deployment adds the open
// feed for its region as data via PARRANDA_EVENT_FEEDS; nothing here is per-city
// code. Kept as a mutable array so the default param below stays a live reference.
const BUILTIN_EVENT_FEEDS = [];

/**
 * The registry is GENERIC and deploy-configurable: a city is a data row, never
 * code. `PARRANDA_EVENT_FEEDS` (a JSON array of {id,label,base,bbox,license})
 * lets any deployment add the open feed covering its region without touching the
 * engine. The default registry is EMPTY on purpose — no city is special out of
 * the box; live events come uniformly from the global provider or not at all.
 * Malformed config is ignored (keep whatever is built-in), never throws.
 */
function resolveEventFeedRegistry(env = process.env) {
  const feeds = [...BUILTIN_EVENT_FEEDS];
  const extra = String((env && env.PARRANDA_EVENT_FEEDS) || "").trim();
  if (!extra) return feeds;
  try {
    const parsed = JSON.parse(extra);
    if (Array.isArray(parsed)) {
      for (const f of parsed) {
        if (f && typeof f.base === "string" && Array.isArray(f.bbox) && f.bbox.length >= 4) {
          feeds.push({
            id: String(f.id || `feed-${feeds.length}`),
            label: String(f.label || f.id || "Events"),
            base: f.base,
            bbox: f.bbox.map(Number),
            license: f.license != null ? String(f.license) : null,
            timezone: f.timezone != null ? String(f.timezone) : null,
            source_tier: f.source_tier != null ? String(f.source_tier) : "official",
            confidence: f.confidence != null ? String(f.confidence) : "medium",
            source_family: f.source_family != null ? String(f.source_family) : "municipal_open",
            source_identity: f.source_identity != null ? String(f.source_identity) : sourceIdentityForUrl(f.base),
            priority: Number.isFinite(Number(f.priority)) ? Number(f.priority) : 100,
            status: f.status != null ? String(f.status) : "active",
            runtime_policy: f.runtime_policy != null ? String(f.runtime_policy) : "bounded_refresh",
          });
        }
      }
    }
  } catch (_e) {
    // malformed PARRANDA_EVENT_FEEDS → keep the built-in registry, never throw
  }
  return feeds;
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

// A genuine happening is time-bounded — not permanent infrastructure. Excludes
// always-open exhibitions (a 2001→2030 "event" the #279 normalizer rates `now`),
// malformed ancient dates (the feed's occasional year-0026 row), and undated
// rows that already started long ago. Feed-agnostic: it is the safety net behind
// the feed-level max_duration query, and it is what the deterministic tests
// exercise (they inject payloads, not query params).
function isEphemeralHappening(event, now) {
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

// Collapse duplicate occurrences (recurring series surface the same title/venue
// repeatedly) — keep the first (already salience-ranked) per id, then per
// title+venue.
function dedupeViews(views) {
  const seen = new Set();
  const out = [];
  for (const v of views) {
    const key = v.id || `${(v.title || "").toLowerCase()}|${v.place || ""}`;
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
function toEventView(event, feed, { eventTimezone = null } = {}) {
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
    timing_relevance: event.timing_relevance || null,
    place: event.place_context || event.area || null,
    lat: Number.isFinite(event.lat) ? event.lat : null,
    lng: Number.isFinite(event.lng) ? event.lng : null,
    source_label: event.source_label || event.provenance?.source_label || feed.label || null,
    source_url: event.source_url || event.provenance?.source_url || null,
    license: event.provenance?.license || feed.license || null,
    trust_level: event.confidence || null,
    cultural_tier: cultural.tier,
    salience_score: score,
    anchor_distance_km: Number.isFinite(event.anchor_distance_km) ? event.anchor_distance_km : null,
    fusion_status: event.fusion_status || "single_source",
    source_count: Number.isFinite(event.source_count) ? event.source_count : 1,
    independent_source_count: Number.isFinite(event.independent_source_count)
      ? event.independent_source_count
      : 1,
    sources: Array.isArray(event.sources) ? event.sources : [],
    // The venue-local timezone so the UI shows the real local start time.
    timezone: eventTimezone || feed.timezone || null,
  };
}

function rankAndCap(views) {
  const sorted = views
    .filter(Boolean)
    .sort(
      (a, b) =>
        (b.salience_score || 0) - (a.salience_score || 0) ||
        String(a.starts_at || "").localeCompare(String(b.starts_at || "")) ||
        String(a.id || "").localeCompare(String(b.id || "")),
    );
  return dedupeViews(sorted).slice(0, MAX_PER_BUCKET);
}

/**
 * Collect ranked live events near an anchor, bucketed tonight / this_week.
 * @param {object} opts
 * @param {{lat:number,lng:number}} opts.anchor  trusted coordinate anchor
 * @param {string|Date|null} [opts.now]          trusted clock (tests inject)
 * @param {string|null} [opts.date]              feed window start (default today)
 * @param {object[]} [opts.registry]             feed registry (default built-in)
 * @param {Function} [opts.fetcher]              injected fetch (tests)
 * @returns {Promise<{coverage:"covered"|"uncovered", feed:object|null, feeds:object[], tonight:object[], this_week:object[], acquisition:object}>}
 */
async function collectAnchorEvents({
  anchor,
  now = null,
  date = null,
  registry,
  fetcher,
  radiusM,
  timeoutMs = 15000,
  globalKey = null,
  maxSources = DEFAULT_MAX_SOURCES,
  maxLocalSources = DEFAULT_MAX_LOCAL_SOURCES,
} = {}) {
  const effectiveRadiusM = Math.max(100, Math.round(radiusM || DEFAULT_RADIUS_M));
  const sourcePlan = buildAnchorEventSourcePlan({
    anchor,
    registry: registry || resolveEventFeedRegistry(),
    globalSource: GLOBAL_FEED_DESCRIPTOR,
    globalEnabled: Boolean(globalKey),
    maxSources,
    maxLocalSources,
  });
  if (sourcePlan.length === 0) {
    return {
      coverage: "uncovered",
      feed: null,
      feeds: [],
      tonight: [],
      this_week: [],
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
      const enriched = {
        source_tier: source.source_tier || (source.kind === "global" ? "verified" : "official"),
        confidence: source.confidence || "medium",
        source_provider_id: source.id,
        source_identity:
          source.source_identity || sourceIdentityForUrl(source.base || source.source_url) || source.id,
        source_family:
          source.source_family || source.family || (source.kind === "global" ? "global_commercial" : "municipal_open"),
        ...rawEvent,
      };
      const normalized = normalizeTimeSensitiveSourceEvent(enriched, nowDate ? { now: nowDate } : {});
      if (!normalized) continue;
      if (rawEvent.timezone) normalized.timezone = rawEvent.timezone;
      normalizedEvidence.push(normalized);
    }
  }

  // Explicit outside-radius rows are rejected before fusion. A mapless row can
  // only survive when another source describes the same occurrence with trusted
  // coordinates, after which the fused occurrence is bounded again.
  const bounded = fuseAndBoundEventEvidence(normalizedEvidence, {
    anchor,
    radiusM: effectiveRadiusM,
  });
  const rejected = [...bounded.rejected];
  const sourceById = new Map(sourcePlan.map((source) => [source.id, source]));
  const tonight = [];
  const thisWeek = [];

  for (const event of bounded.events) {
    if (!isEphemeralHappening(event, nowDate)) {
      rejected.push({
        id: event.fusion_id || event.id || null,
        source_provider_id: event.source_provider_id || null,
        reason: "not_ephemeral_happening",
      });
      continue;
    }
    const source = sourceById.get(event.source_provider_id) || sourcePlan[0];
    const view = toEventView(event, source, { eventTimezone: event.timezone || null });
    if (!view) continue;
    if (TONIGHT_TIMING.has(event.timing_relevance)) {
      tonight.push(view);
    } else if (
      event.timing_relevance === "future" &&
      withinHorizonDays(event.starts_at, nowDate, THIS_WEEK_HORIZON_DAYS)
    ) {
      thisWeek.push(view);
    }
  }

  const rankedTonight = rankAndCap(tonight);
  const rankedThisWeek = rankAndCap(thisWeek);
  const feeds = collectedSources.map(compactSourceStatus);
  const sourceHealth = buildAnchorEventSourceHealth(collectedSources, {
    acceptedEventCount: rankedTonight.length + rankedThisWeek.length,
    normalizedEventCount: normalizedEvidence.length,
    rejected,
  });
  return {
    coverage: "covered",
    feed: feeds[0] || null,
    feeds,
    tonight: rankedTonight,
    this_week: rankedThisWeek,
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
    },
  };
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
    provider = createLinkedEventsProvider({
      endpoint: buildAnchorEventEndpoint(source.base, anchor, { radiusM }),
      fetcher: fetcher || undefined,
      limit: FETCH_LIMIT,
      timeoutMs: Math.max(1000, Math.floor(timeoutMs) || 15000),
      label: source.label,
      license: source.license,
    });
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

function compactSourceStatus(collection) {
  const source = collection.source;
  return {
    id: source.id,
    label: source.label,
    license: source.license ?? null,
    family: source.source_family || source.family || (source.kind === "global" ? "global_commercial" : "municipal_open"),
    source_identity: source.source_identity || sourceIdentityForUrl(source.base || source.source_url) || source.id,
    status: collection.status,
    reason: collection.reason || null,
    event_rows: collection.raw.length,
  };
}

function emptyAcquisition(radiusM) {
  return {
    mode: "bounded_multi_source",
    radius_m: radiusM,
    source_cap: DEFAULT_MAX_SOURCES,
    selected_source_count: 0,
    normalized_event_count: 0,
    fused_event_count: 0,
    rejected_event_count: 0,
    rejection_summary: [],
    source_health: buildAnchorEventSourceHealth([]),
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
 * PARRANDA_AGNOSTIC_EVENTS). Returns an `({anchor, now}) => Promise<result>`
 * bound to the env-resolved registry, using global fetch.
 */
// Coarse cache key: ~1 km anchor bucket + hour bucket (events are time-sensitive,
// so the window must not be stale, but a fresh request a minute later must hit).
function eventCacheKey(anchor, now, sourceIds = []) {
  const lat = Number(anchor.lat).toFixed(2);
  const lng = Number(anchor.lng).toFixed(2);
  const hour = (now ? new Date(now) : new Date(0)).toISOString().slice(0, 13);
  const sources = (Array.isArray(sourceIds) ? sourceIds : [])
    .map(String)
    .sort()
    .join(",");
  return `${lat},${lng}:${hour}:${sources}`;
}

function sourceIdentityForUrl(value) {
  try {
    return new URL(String(value || "").trim()).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_error) {
    return null;
  }
}

const EVENT_CACHE_TTL_MS = 20 * 60 * 1000; // 20 min — time-sensitive, but reusable
const WARM_TIMEOUT_MS = 30000; // out-of-band, so a long timeout never blocks a route

/**
 * Default event supply: env-gated + BACKGROUND-WARMED. Selected sources can be
 * slow and high-variance, so they must NEVER be fetched inline on the route. On a
 * cold anchor we kick one bounded concurrent warm and return honest `pending`;
 * once warm, the next visit serves the cached fused result. Even a valid empty
 * result is cached so "nothing on" never becomes an unbounded refresh loop.
 */
function resolveDefaultEventSupply(env = process.env) {
  const flag = String((env && env.PARRANDA_AGNOSTIC_EVENTS) || "").trim().toLowerCase();
  if (!["enabled", "1", "true", "on", "yes"].includes(flag)) return null;
  const registry = resolveEventFeedRegistry(env);
  const globalKey = resolveGlobalEventKey(env);
  const cache = createSourceCache({
    namespace: "agnostic-events",
    ttlMs: EVENT_CACHE_TTL_MS,
    dir: (env && env.PARRANDA_CACHE_DIR) || null,
  });
  return ({ anchor, now } = {}) => {
    const sourcePlan = buildAnchorEventSourcePlan({
      anchor,
      registry,
      globalSource: GLOBAL_FEED_DESCRIPTOR,
      globalEnabled: Boolean(globalKey),
    });
    if (sourcePlan.length === 0) {
      return Promise.resolve({
        coverage: "uncovered",
        feed: null,
        feeds: [],
        tonight: [],
        this_week: [],
        acquisition: emptyAcquisition(DEFAULT_RADIUS_M),
      });
    }
    const descriptors = sourcePlan.map((source) => compactSourceStatus({ source, status: "pending", raw: [] }));
    const key = eventCacheKey(anchor, now, sourcePlan.map((source) => source.id));
    const cached = cache.peek(key);
    if (cached) return Promise.resolve(cached);
    // Cold: warm out-of-band (long timeout, fire-and-forget), serve honest pending.
    cache.warm(key, () => collectAnchorEvents({ anchor, now, registry, timeoutMs: WARM_TIMEOUT_MS, globalKey }), {
      // A valid empty result is cacheable too. Otherwise every request would
      // hammer every selected source merely because nothing is happening now.
      shouldStore: (r) => r && r.coverage === "covered",
    });
    return Promise.resolve({
      coverage: "covered",
      feed: descriptors[0] || null,
      feeds: descriptors,
      tonight: [],
      this_week: [],
      pending: true,
      acquisition: {
        mode: "bounded_multi_source",
        radius_m: DEFAULT_RADIUS_M,
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
          rejected_event_count: 0,
          reasons: ["background_refresh_pending"],
        },
      },
    });
  };
}

module.exports = {
  collectAnchorEvents,
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
};
