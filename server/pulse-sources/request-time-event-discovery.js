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
const MAX_SEEDS = 6;
const SCOUT_TIMEOUT_MS = 8_000;
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
  sourceSearch,
  scout = scoutLocalEventSources,
  fetcher,
  cache = createSourceCache({ namespace: "request-time-event-discovery-v2", ttlMs: FOUND_TTL_MS }),
  timezoneForPoint = coordinateTimezone,
  now = () => Date.now(),
} = {}) {
  if (typeof sourceSearch !== "function") return null;
  const holds = new Map();

  // Resolves to { status: "found" | "empty" | "failed", reason, feeds }.
  return async function discoverRequestTimeEventFeeds({ anchor, placeLabel = null, placeContext = null } = {}) {
    if (!validPoint(anchor)) return outcome("empty", "invalid_anchor");
    const key = `rt-discovery:${anchorBucket(anchor)}`;
    const held = holds.get(key);
    if (held && held.until > now()) return held.outcome;
    let result;
    try {
      result = await cache.get(key, () => discoverOnce(), { shouldStore: (found) => found?.status === "found" });
    } catch (_error) {
      result = outcome("failed", "request_time_discovery_failed");
    }
    if (result.status === "empty") holds.set(key, { until: now() + EMPTY_HOLD_MS, outcome: result });
    else if (result.status === "failed") holds.set(key, { until: now() + FAILED_HOLD_MS, outcome: result });
    else holds.delete(key);
    return result;

    async function discoverOnce() {
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
      if (!place.name) return outcome("empty", "no_locality_name");
      const queryPlan = buildLocalEventDiscoveryQueryPlan({ place, localDiscoveryTerms: place.local_discovery_terms })
        .filter((item) => LOCALITY_SCOPES.has(item.label_scope))
        .slice(0, MAX_QUERIES);
      if (!queryPlan.length) return outcome("empty", "no_locality_query");
      let searched;
      try {
        searched = await sourceSearch({
          queries: queryPlan.map((item) => item.query),
          query_plan: queryPlan,
          place,
          anchor,
          bounds,
        });
      } catch (_error) {
        return outcome("failed", "source_search_failed");
      }
      const seeds = sanitizeSearchSeeds(searched?.seeds, place).slice(0, MAX_SEEDS);
      if (!seeds.length) {
        const searchStatus = typeof searched?.status === "string" ? searched.status : "failed";
        return FAILED_SEARCH_STATUSES.has(searchStatus) || searched?.retry_recommended === true || !searched
          ? outcome("failed", `source_search_${FAILED_SEARCH_STATUSES.has(searchStatus) ? searchStatus : "failed"}`)
          : outcome("empty", "no_search_results");
      }
      let scouted;
      try {
        scouted = await scout({
          place,
          anchor,
          bounds,
          seeds,
          maxSeeds: MAX_SEEDS,
          timeoutMs: SCOUT_TIMEOUT_MS,
          ...(typeof fetcher === "function" ? { fetcher } : {}),
          eventReader: null,
        });
      } catch (_error) {
        return outcome("failed", "source_scout_failed");
      }
      const feeds = feedsFromScout(scouted, { timezone: timezoneForPoint(anchor.lat, anchor.lng) });
      return feeds.length ? outcome("found", null, feeds) : outcome("empty", "no_structured_event_source");
    }
  };
}

function outcome(status, reason, feeds = []) {
  return { status, reason, feeds };
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
      ...(!binding.timezone && timezone ? { timezone } : {}),
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
