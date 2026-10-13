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
  sourceSearch,
  scout = scoutLocalEventSources,
  fetcher,
  cache = createSourceCache({ namespace: "request-time-event-discovery-v3", ttlMs: FOUND_TTL_MS }),
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
      if (!place.name) return outcome("empty", "no_locality_name");
      const queryPlan = buildLocalEventDiscoveryQueryPlan({ place, localDiscoveryTerms: place.local_discovery_terms })
        .filter((item) => LOCALITY_SCOPES.has(item.label_scope))
        .slice(0, MAX_QUERIES);
      if (!queryPlan.length) return outcome("empty", "no_locality_query");
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
        return outcome("failed", "source_search_failed");
      }
      const seeds = sanitizeSearchSeeds(searched?.seeds, place).slice(0, MAX_SEEDS);
      if (!seeds.length) {
        const searchStatus = typeof searched?.status === "string" ? searched.status : "failed";
        return searchAcquisitionFailed(searched) || !searched
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
          fetcher: async (url, options = {}) => {
            signal.throwIfAborted();
            const transport = typeof fetcher === "function" ? fetcher : globalThis.fetch;
            const response = await transport(url, { ...options,
              signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal });
            signal.throwIfAborted();
            return response;
          },
          eventReader: null,
        });
      } catch (_error) {
        return outcome("failed", "source_scout_failed");
      }
      const feeds = feedsFromScout(scouted, { timezone: timezoneForPoint(anchor.lat, anchor.lng) });
      if (feeds.length) return outcome("found", null, feeds);
      // The scout normally returns transport failures as data, not exceptions.
      // Without useful feeds, incomplete acquisition cannot prove absence.
      if (FAILED_SEARCH_STATUSES.has(scouted?.status) || Number(scouted?.failed_source_count) > 0 ||
          scouted?.manifest_candidates?.some(manifest => manifest?.review?.robots_status === "unknown" &&
            /^(?:source_|robots_endpoint_budget_)/.test(String(manifest.review.robots_reason || ""))) ||
          scouted?.results?.some(result => FAILED_SEARCH_STATUSES.has(result?.status) ||
            (result?.robots?.status === "unknown" && String(result.robots.reason || "").startsWith("source_")))) {
        return outcome("failed", "source_scout_failed");
      }
      if (searchAcquisitionFailed(searched)) {
        return outcome("failed", "source_search_failed");
      }
      return outcome("empty", "no_structured_event_source");
    }
  };
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
