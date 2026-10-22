"use strict";

/**
 * Request-time event-source discovery for a place that has no approved or
 * machine-qualified local event source yet.
 *
 * It runs inside the out-of-band Live collection (never in front of the day):
 * at most two locality-scoped searches, the ordinary bounded source scout on
 * the results, and the same manifest binding the qualification worker uses.
 * Only structured event interfaces the scout recognises (iCal, RSS/Atom
 * detail, schema.org, The Events Calendar, scheduled cards …) become feeds;
 * prose is not read here. A feed found this way is a single observation:
 * probationary, Pulse-only, low confidence, with its source URL kept, and the
 * ordinary time/geography/display gates still decide every event. Robots
 * exclusions and restricted or permission-required terms stay blockers.
 * The ordinary scout demand still asks the worker to qualify the source.
 */

const { createHash } = require("node:crypto");
const { createSourceCache } = require("../place-candidates/source-cache");
const { coordinateTimezone } = require("./coordinate-timezone");
const {
  buildLocalEventDiscoveryQueryPlan,
  scoutLocalEventSources,
} = require("./local-event-source-scout");
const { buildTrustedScoutPlace, sanitizeSearchSeeds } = require("./place-event-source-scout");
const { bindManifestCandidate, sourceRowForBinding } = require("./source-qualification");

const MAX_QUERIES = 2;
const MAX_SEARCH_SEEDS = 6;
// The venues around the anchor are read first: up to nine of their own sites,
// in three groups side by side, inside the same discovery budget.
const MAX_VENUE_SEEDS = 9;
const SCOUT_GROUPS = 3;
const VENUE_RADIUS_KM = 3;
const VENUE_LOOKUP_WAIT_MS = 12_000;
const SCOUT_TIMEOUT_MS = 8_000;
// Live capabilities last 120 s. Spend at most 30 s on finding sources, leaving
// the rest for ordinary bounded collection, venue lookup and completion reads.
const DISCOVERY_BUDGET_MS = 30_000;
const FOUND_TTL_MS = 6 * 60 * 60 * 1000;
// A place with nothing to find is not searched again for a while. A failed
// search or scout is a different answer: the absence is unproven, so it is
// retried after minutes, and only held that long to spare the search service.
const EMPTY_HOLD_MS = 60 * 60 * 1000;
const FAILED_HOLD_MS = 5 * 60 * 1000;
const FAILED_SEARCH_STATUSES = new Set(["failed", "degraded", "unavailable"]);
const BOUNDS_HALF_SPAN_DEG = 0.08;
const ALLOWED_TERMS = new Set(["open_license", "api_terms_compatible"]);
// Only three local sources are read per collection, so the event-specific
// structured interfaces go first; RSS is often a site's blog, not its events.
const ADAPTER_PRIORITY = Object.freeze({
  events_calendar: 184,
  ical: 185,
  schema_org_html: 185,
  scheduled_event_cards: 186,
  venue_calendar: 186,
  sitevision_calendar: 186,
  wix_event_sitemap: 186,
  embedded_program_rsc: 186,
  rss_atom_event_detail: 192,
});
const DEFAULT_ADAPTER_PRIORITY = 190;
const LOCALITY_SCOPES = new Set(["locality", "resolved_label"]);

function createRequestTimeEventDiscovery({
  sourceSearch = null,
  venueSeeds = null,
  scout = scoutLocalEventSources,
  fetcher,
  cache = createSourceCache({ namespace: "request-time-event-discovery-v6", ttlMs: FOUND_TTL_MS }),
  timezoneForPoint = coordinateTimezone,
  now = () => Date.now(),
  venueLookupWaitMs = VENUE_LOOKUP_WAIT_MS,
} = {}) {
  if (typeof sourceSearch !== "function" && typeof venueSeeds !== "function") return null;
  const holds = new Map();

  // Resolves to { status: "found" | "empty" | "failed", reason, feeds }.
  return async function discoverRequestTimeEventFeeds({ anchor, placeLabel = null, placeContext = null } = {}) {
    if (!validPoint(anchor)) return outcome("empty", "invalid_anchor");
    const key = `rt-discovery-v6:${anchorBucket(anchor)}`;
    const held = holds.get(key);
    if (held && held.until > now()) return held.outcome;
    let result;
    const controller = new AbortController();
    let deadline;
    try {
      result = await Promise.race([
        cache.get(key, () => discoverOnce(controller.signal), {
          signal: controller.signal,
          shouldStore: found => !controller.signal.aborted && found?.status === "found",
        }),
        new Promise(resolve => { deadline = setTimeout(() => {
          controller.abort();
          resolve(outcome("failed", "request_time_discovery_timeout"));
        }, DISCOVERY_BUDGET_MS); }),
      ]);
    } catch (_error) {
      result = outcome("failed", "request_time_discovery_failed");
    } finally {
      clearTimeout(deadline);
    }
    if (result.status === "empty") holds.set(key, { until: now() + EMPTY_HOLD_MS, outcome: result });
    else if (result.status === "failed") holds.set(key, { until: now() + FAILED_HOLD_MS, outcome: result });
    else holds.delete(key);
    return result;

    async function discoverOnce(signal) {
      const bounds = {
        south: anchor.lat - BOUNDS_HALF_SPAN_DEG,
        north: anchor.lat + BOUNDS_HALF_SPAN_DEG,
        west: anchor.lng - BOUNDS_HALF_SPAN_DEG * 1.5,
        east: anchor.lng + BOUNDS_HALF_SPAN_DEG * 1.5,
      };
      const place = buildTrustedScoutPlace({
        query: placeLabel || placeContext?.locality || "",
        intake: placeLabel ? { resolved: { label: placeLabel } } : null,
        placeContext,
        anchor,
        bounds,
        localDiscoveryTerms: [],
        localPlaceDiscoveryTerms: [],
      });
      // Two lanes at once: the venues around the anchor (their own websites)
      // and the locality-scoped web search. Either can find a source alone.
      const [venue, search] = await Promise.all([
        typeof venueSeeds === "function" ? findVenueSeeds() : null,
        typeof sourceSearch === "function" ? findSearchSeeds(signal, place, bounds) : null,
      ]);
      const seeds = combineLaneSeeds(venue?.seeds || [], search?.seeds || [], place);
      if (!seeds.length) {
        if (search?.failed) return search.failed;
        if (venue && venue.status !== "ok") return outcome("failed", "venue_seed_lookup_incomplete");
        return outcome("empty", search?.emptyReason || "no_venue_websites");
      }
      const scouted = await scoutInGroups(seeds, { signal, place, bounds });
      if (!scouted) return outcome("failed", "source_scout_failed");
      const feeds = feedsFromScout(scouted, { timezone: timezoneForPoint(anchor.lat, anchor.lng) });
      if (feeds.length) return outcome("found", null, feeds);
      // Without a feed, absence is proven only by a mostly complete look: more
      // than half of the sites failing, or an interface whose robots policy
      // could not be read, keeps the answer retryable rather than empty.
      if (scoutMostlyFailed(scouted, seeds.length) ||
          scouted.manifest_candidates.some(manifest => manifest?.review?.robots_status === "unknown" &&
            /^(?:source_|robots_endpoint_budget_)/.test(String(manifest.review.robots_reason || "")))) {
        return outcome("failed", "source_scout_failed");
      }
      if (search?.failed) return search.failed;
      if (search?.acquisitionFailed) return outcome("failed", "source_search_failed");
      if (venue && venue.status !== "ok") return outcome("failed", "venue_seed_lookup_incomplete");
      return outcome("empty", "no_structured_event_source");
    }

    // A cold venue lookup may outlast this collection. It keeps running and
    // warms its own cache; this round continues with what has arrived.
    async function findVenueSeeds() {
      let timer;
      try {
        return await Promise.race([
          Promise.resolve(venueSeeds({ anchor, radiusKm: VENUE_RADIUS_KM }))
            .catch(() => ({ status: "failed", seeds: [] })),
          new Promise(resolve => { timer = setTimeout(() => resolve({ status: "pending", seeds: [] }), venueLookupWaitMs); }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }

    async function findSearchSeeds(signal, place, bounds) {
      if (!place.name) return { seeds: [], emptyReason: "no_locality_name" };
      const queryPlan = buildLocalEventDiscoveryQueryPlan({ place, localDiscoveryTerms: place.local_discovery_terms })
        .filter((item) => LOCALITY_SCOPES.has(item.label_scope))
        .slice(0, MAX_QUERIES);
      if (!queryPlan.length) return { seeds: [], emptyReason: "no_locality_query" };
      let searched;
      try {
        searched = await sourceSearch({
          signal,
          queries: queryPlan.map((item) => item.query),
          query_plan: queryPlan,
          place,
          anchor,
          bounds,
        });
      } catch (_error) {
        return { seeds: [], failed: outcome("failed", "source_search_failed") };
      }
      const seeds = sanitizeSearchSeeds(searched?.seeds, place).slice(0, MAX_SEARCH_SEEDS);
      if (!seeds.length) {
        const searchStatus = typeof searched?.status === "string" ? searched.status : "failed";
        return searchAcquisitionFailed(searched) || !searched
          ? { seeds, failed: outcome("failed", `source_search_${FAILED_SEARCH_STATUSES.has(searchStatus) ? searchStatus : "failed"}`) }
          : { seeds, emptyReason: "no_search_results" };
      }
      return { seeds, acquisitionFailed: searchAcquisitionFailed(searched) };
    }

    // Different sites are read side by side, a few groups at a time, so a
    // dozen sites fit the collection budget. Seeds are dealt round-robin so
    // every group starts with the most promising ones.
    async function scoutInGroups(seeds, { signal, place, bounds }) {
      const groupCount = Math.min(SCOUT_GROUPS, seeds.length);
      const groups = Array.from({ length: groupCount }, (_, index) => seeds.filter((_seed, i) => i % groupCount === index));
      const settled = await Promise.all(groups.map(group => Promise.resolve().then(() => scout({
        place,
        anchor,
        bounds,
        seeds: group,
        maxSeeds: group.length,
        timeoutMs: SCOUT_TIMEOUT_MS,
        fetcher: async (url, options = {}) => {
          signal.throwIfAborted();
          const transport = typeof fetcher === "function" ? fetcher : globalThis.fetch;
          const response = await transport(url, { ...options,
            signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal });
          signal.throwIfAborted();
          return response;
        },
        eventReader: null,
      })).then(value => ({ value, size: group.length }), () => ({ thrown: group.length }))));
      if (settled.every(group => group.thrown)) return null;
      return {
        status: "complete",
        results: settled.flatMap(group => group.value?.results || []),
        manifest_candidates: settled.flatMap(group => group.value?.manifest_candidates || []),
        thrown_seed_count: settled.reduce((sum, group) => sum + (group.thrown || 0), 0),
        group_statuses: settled.map(group => group.value?.status || "failed"),
      };
    }
  };
}

// Venue seeds lead (they are the places events happen), then search seeds;
// one seed per site.
function combineLaneSeeds(venueSeedList, searchSeedList, place) {
  const out = [];
  const sites = new Set();
  const add = (seed) => {
    const url = normalizeSeedUrl(seed?.url);
    if (!url) return;
    const site = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (sites.has(site)) return;
    sites.add(site);
    out.push({ ...seed, url, place: seed.place || place?.label || place?.name || null });
  };
  venueSeedList.slice(0, MAX_VENUE_SEEDS).forEach(add);
  searchSeedList.forEach(add);
  return out;
}

function normalizeSeedUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch (_error) {
    return null;
  }
}

// A site failed when its page, a programme page or its robots policy could
// not be read; a robots exclusion or an unsafe redirect is a decision, not a
// failure. Counted per listed site, against every site the round tried.
function scoutMostlyFailed(scouted, seedCount) {
  const failedSites = new Set();
  for (const result of scouted.results) {
    const site = result?.discovered_from || result?.source_url;
    if (!site) continue;
    if (FAILED_SEARCH_STATUSES.has(result?.status) ||
        (result?.robots?.status === "unknown" && String(result.robots.reason || "").startsWith("source_"))) {
      failedSites.add(site);
    }
  }
  const failed = failedSites.size + Number(scouted.thrown_seed_count || 0);
  return failed > 0 && failed * 2 > Math.max(1, seedCount);
}

function outcome(status, reason, feeds = []) {
  return { status, reason, feeds };
}

function searchAcquisitionFailed(searched) {
  // The search provider retains useful seeds when another query fails, and
  // reports partial/retry_recommended=false. That does not prove absence if
  // the retained seeds yield no feeds. A partial result alone is not a failure.
  return FAILED_SEARCH_STATUSES.has(searched?.status) || searched?.retry_recommended === true ||
    Number(searched?.failed_query_count) > 0 || Number(searched?.degraded_query_count) > 0 ||
    (Array.isArray(searched?.query_outcomes) && searched.query_outcomes.some(query =>
      FAILED_SEARCH_STATUSES.has(query?.status)));
}

function feedsFromScout(scouted, { timezone = null } = {}) {
  const candidates = new Map();
  for (const result of Array.isArray(scouted?.results) ? scouted.results : []) {
    for (const candidate of Array.isArray(result?.candidates) ? result.candidates : []) {
      if (candidate?.id && !candidates.has(candidate.id)) candidates.set(candidate.id, candidate);
    }
  }
  const bestByPublisher = new Map();
  for (const manifest of Array.isArray(scouted?.manifest_candidates) ? scouted.manifest_candidates : []) {
    const binding = bindManifestCandidate(manifest, candidates.get(manifest?.id));
    if (!binding) continue;
    if (binding.robotsStatus !== "allowed") continue;
    if (!(ALLOWED_TERMS.has(binding.termsStatus) || binding.termsStatus === "unknown")) continue;
    const priority = ADAPTER_PRIORITY[binding.adapter] ?? DEFAULT_ADAPTER_PRIORITY;
    // One feed per publisher: several interfaces of one site are one source.
    const publisher = binding.sourceIdentity.toLowerCase();
    const current = bestByPublisher.get(publisher);
    if (current && current.priority <= priority) continue;
    bestByPublisher.set(publisher, {
      ...sourceRowForBinding(binding),
      // Local floating times need a zone; the coordinate-derived zone of the
      // trusted anchor is server-owned, a source-declared zone still wins.
      ...(!binding.timezone && timezone ? { fallback_timezone: timezone } : {}),
      priority,
      status: "probationary",
      source_health: "request_time_single_observation",
      runtime_trust: "request_time_single_observation",
      pulse_only: true,
      source_scoped_pulse: false,
    });
  }
  return [...bestByPublisher.values()].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

function anchorBucket(anchor) {
  // ~1 km cells: nearby requests share one discovery instead of re-searching.
  const cell = `${Math.round(anchor.lat * 100)}:${Math.round(anchor.lng * 100)}`;
  return createHash("sha256").update(cell).digest("hex").slice(0, 16);
}

function validPoint(value) {
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lng) &&
    Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
}

module.exports = {
  createRequestTimeEventDiscovery,
  feedsFromScout,
};
