/**
 * Real open-data loader seam for Agnostic Blitz (#237).
 *
 * Returns an async loader `({lat,lng}) → records[]` that fetches credible open
 * records (OSM via Overpass; corroborated with Wikidata when tagged) and maps
 * them into the same record shape the #234 external-open-provider already
 * understands. The loader plugs into the existing trusted helper channel
 * (helpers.external_provider.dataset) — no new pipeline, no public injection.
 *
 * Hard product stances baked in:
 *   - NO network in tests: `fetcher` is injectable; default falls back to the
 *     runtime's global fetch. Tests inject a deterministic one.
 *   - Bounded by construction: small radius, hard result limit, AbortController
 *     timeout. No unbounded scraping.
 *   - Fail closed on every error path (network, non-200, parse, timeout,
 *     malformed payload) — return `[]`, never throw, never hallucinate.
 *   - Source honesty: each record carries OSM as a `map` source; when the OSM
 *     element ALSO carries a `wikidata` tag, a SECOND source (`open_knowledge`)
 *     is emitted so the reducer sees real provenance diversity. Without it, a
 *     single-family record stays low and is gated out by the existing shared
 *     gates by default. The explicit agnostic route-output experiment may admit
 *     those attribution-bearing geocoded records through its own seam, but only
 *     with visible gate diagnostics and capped calibration; default Planner,
 *     Blitz, Pulse, and nearby surfaces stay on the safer shared gates.
 *   - No app-owned copy of external text: only attribution-bearing source refs.
 *
 * What this is NOT: Google/Tripadvisor/Facebook/social/review scraping; a
 * persisted clone of any restricted source; an entity-resolution/dedupe
 * service. Those are deliberate next-step boundaries.
 */

const { createSourceCache } = require("./source-cache");
const { createWikidataSource } = require("./wikidata-source");
const { createOvertureSource } = require("./overture-source");
const { normalizeOpeningHours } = require("./opening-hours");
const { normalizeUserIntents, matchCandidateToIntent } = require("../candidates/intent-vocabulary");
const {
  sanitizeTrustedSpatialScope,
  deriveSecondaryAnchors,
  allowsRegionalClusterSelection,
  spatialScopeCacheKey,
} = require("./spatial-scope");
const {
  TYPE_CATEGORY,
  MIN_CAPACITY_SPAN_IMPROVEMENT_KM,
  dayCapacityProfile,
  normalizeWalkingTargetBand,
  preserveCapacityFrontier,
} = require("./day-capacity");

const DEFAULT_OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
// Mirror failover is a MECHANISM, not a free fix. The loader can try several
// Overpass endpoints in order, failing over on a transport/parse error (never on
// a genuine empty 200). But the DEFAULT is primary-only on purpose: measured live,
// the public fallback mirrors (kumi.systems, private.coffee) take 60-77 s for a
// trivial query — far beyond any route timeout, so defaulting to them would only
// add latency on the sad path for zero rescue. The real cold-loader robustness
// lever is the persistent disk cache (one slow load per place, then cached) + a
// faster/self-hosted Overpass. A deploy that runs such mirrors lists them via
// PARRANDA_OVERPASS_ENDPOINTS to get HA failover.
//
// Measured correction: when overpass-api.de became globally unreachable, the
// disk cache did NOT carry a cold place — a cold cache plus a dead primary lost
// the request outright. What actually kept days alive was a second SOURCE
// (Overture), not a second Overpass mirror. Cross-source rescue is therefore
// the primary robustness lever here; see composeOpenDataLoaders.
const DEFAULT_OVERPASS_FALLBACKS = [];
// Overpass (like Nominatim, see place-resolver.js) rejects requests without an
// identifying User-Agent with HTTP 406 — without this header every live call
// fails closed and the loader silently returns [].
const DEFAULT_USER_AGENT = "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";
// The aperture a day is collected from, when the caller says nothing about how
// far the user wants to walk. It is a FLOOR, not the answer: see
// budgetAwareRadiusKm below.
//
// This constant used to be the whole story, justified as "1.5 km reach catches
// the scenic/cultural/second-hand places that cluster outside a tight centre".
// Product QA across Stockholm, Malmö, Ystad and Kivik measured that claim and
// it does not hold for a long day: a 9 km request drew from exactly the same
// 1.5 km disc as a 4 km request, so candidate span could not exceed ~3 km,
// `can_support_target` was false in 84 of 87 scenarios that reported it, and a
// longer budget produced a longer route in ZERO of 60 comparable groups.
const DEFAULT_RADIUS_KM = 1.5;
// A day is a loop back to where it started, so the useful reach from the anchor
// is roughly a quarter of the distance walked: span ~= 2 * radius ~= target / 2,
// leaving the rest of the budget for the legs between stops. Below the default
// this changes nothing (a short day keeps today's aperture); above it the disc
// grows with the ask and stays inside the reviewed ceiling. Generic — derived
// from the requested budget alone, never from a place.
const RADIUS_PER_WALKING_KM = 0.25;
const DEFAULT_LIMIT = 25;
// How many raw elements to ask Overpass for before balancing down to the final
// limit. Wider than the limit so scarce categories survive a dense centre;
// still small and bounded (one query).
const OVERPASS_FETCH_CAP = 150;
// Keep the client deadline above the bounded server-side query budget. A
// shorter client deadline turns a valid cold response into fake "no data"
// before Overpass has exhausted the budget we explicitly gave it.
const OVERPASS_QUERY_TIMEOUT_SECONDS = 25;
const DEFAULT_TIMEOUT_MS = 30000;
// Stable map/place facts can safely bridge a short provider outage, but stale
// data must stay bounded and visible in source/readiness metadata.
const DEFAULT_STALE_IF_ERROR_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RADIUS_KM = 5.0;
const MAX_LIMIT = 100;
// Adaptive aperture expansion. The first query stays cheap and local. A single
// wider query is allowed when supply is sparse or misses a requested intent;
// its 3/5 km target is response-driven and generic (never place-specific).
const EXPANSION_RADIUS_KM = 3.0;
const REGIONAL_EXPANSION_RADIUS_KM = 5.0;
const THIN_RECORD_COUNT = 12; // < ~half the default limit → thin
const THIN_CATEGORY_COUNT = 3; // fewer distinct place types than a real day needs
const SEVERELY_THIN_RECORD_COUNT = 5;
const REGIONAL_CLUSTER_RADIUS_KM = 3;

const LOADER_SUPPORTED_INTENTS = new Set([
  "scenic",
  "green",
  "food",
  "coffee",
  "bars",
  "markets",
  "museums",
  "swimming",
  "second_hand",
]);

// Small, intent-mapped OSM tag → Parranda type table. Kept conservative so
// every entry maps cleanly into the canonical intent vocabulary. Add lines
// here when adding a new intent — do not branch in the mapping function.
const OSM_TAG_MAP = [
  // scenic — viewpoints are rare in flat city centres, so the scenic role used
  // to go unfilled everywhere (#273). A scenic anchor in any place is also a
  // notable park, public garden, waterfront, or castle. These types are ALREADY
  // recognized as scenic by the shared intent vocabulary (weak_types), so this
  // is purely the loader catching up — zero change to citypack/default scoring.
  // (squares / monuments / attractions need new vocab types → deferred so this
  // PR stays loader-only and changes no shared behaviour.)
  { key: "tourism", value: "viewpoint", type: "viewpoint", tags: ["utsikt"] },
  { key: "leisure", value: "park", type: "park", tags: ["park", "green"] },
  { key: "leisure", value: "nature_reserve", type: "park", tags: ["park", "green"] },
  { key: "leisure", value: "garden", type: "garden", tags: ["garden", "green"] },
  { key: "leisure", value: "marina", type: "promenade", tags: ["waterfront", "coast"] },
  { key: "man_made", value: "pier", type: "promenade", tags: ["waterfront", "coast"] },
  { key: "historic", value: "castle", type: "castle", tags: ["historic", "landmark"] },
  // swimming / coast
  { key: "natural", value: "beach", type: "beach", tags: ["coast"] },
  { key: "leisure", value: "beach_resort", type: "beach", tags: ["coast"] },
  { key: "leisure", value: "swimming_area", type: "beach", tags: ["coast", "bathing"] },
  // second hand / vintage (NOT generic retail)
  { key: "shop", value: "second_hand", type: "vintage-shop", tags: ["second_hand"] },
  { key: "shop", value: "antiques", type: "vintage-shop", tags: ["vintage", "antique"] },
  { key: "shop", value: "charity", type: "vintage-shop", tags: ["second_hand", "charity"] },
  { key: "shop", value: "vintage", type: "vintage-shop", tags: ["vintage", "second_hand"] },
  // food (restaurant / taverna-style / street food)
  { key: "amenity", value: "restaurant", type: "restaurant", tags: ["mat"] },
  { key: "amenity", value: "fast_food", type: "street-food", tags: ["mat"] },
  // coffee / fika — a café, a dedicated coffee shop, a bakery, and a gelateria
  // are all fika stops. All map to the EXISTING `cafe` type (recognized as fika
  // by the shared vocab), so this is purely broader OSM coverage of a role that
  // already exists — no new vocab, every city benefits identically.
  { key: "amenity", value: "cafe", type: "cafe", tags: ["fika"] },
  { key: "shop", value: "coffee", type: "cafe", tags: ["fika"] },
  { key: "shop", value: "bakery", type: "cafe", tags: ["fika"] },
  { key: "shop", value: "pastry", type: "cafe", tags: ["fika"] },
  { key: "amenity", value: "ice_cream", type: "cafe", tags: ["fika"] },
  // bars / evening (pub & biergarten read as bars, not food)
  { key: "amenity", value: "bar", type: "bar", tags: ["nattliv"] },
  { key: "amenity", value: "pub", type: "bar", tags: ["nattliv"] },
  { key: "amenity", value: "biergarten", type: "bar", tags: ["nattliv", "öl"] },
  // markets
  { key: "amenity", value: "marketplace", type: "market", tags: ["market"] },
  // culture
  { key: "tourism", value: "museum", type: "museum", tags: ["kultur", "museum"] },
  { key: "tourism", value: "gallery", type: "gallery", tags: ["kultur"] },
  { key: "amenity", value: "arts_centre", type: "gallery", tags: ["kultur"] },
];

// Distinct place TYPES in a record set — a proxy for how varied a day can be.
function distinctCategoryCount(records) {
  const cats = new Set();
  for (const r of Array.isArray(records) ? records : []) {
    if (r && r.type) cats.add(r.type);
  }
  return cats.size;
}

function normalizeRequestedIntents(values = []) {
  const normalized = normalizeUserIntents(Array.isArray(values) ? values : []);
  return [...new Set(normalized.intents.filter((intent) => LOADER_SUPPORTED_INTENTS.has(intent)))].sort();
}

function supplyProfile(records, requestedIntents = []) {
  const categories = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const category = TYPE_CATEGORY[record?.type];
    if (category) categories.add(category);
  }
  const requested = [...new Set(requestedIntents)].sort();
  const levels = new Map(
    requested.map((intent) => {
      let level = "none";
      for (const record of Array.isArray(records) ? records : []) {
        const candidateLevel = matchCandidateToIntent(record, intent).level;
        if (candidateLevel === "strong") {
          level = "strong";
          break;
        }
        if (candidateLevel === "weak") level = "weak";
      }
      return [intent, level];
    }),
  );
  const covered = requested.filter((intent) => levels.get(intent) === "strong");
  const partial = requested.filter((intent) => levels.get(intent) === "weak");
  return {
    record_count: Array.isArray(records) ? records.length : 0,
    category_count: categories.size,
    requested_intent_count: requested.length,
    requested_intents_covered: covered,
    requested_intents_partial: partial,
    requested_intents_missing: requested.filter((intent) => levels.get(intent) === "none"),
  };
}

// A first pass is "thin" when it holds too few records OR too few distinct types
// to compose a varied day. An error result is NOT thin (expanding the radius
// won't fix a down mirror), and a genuinely rich pass is never expanded.
function isThinSupply(records) {
  if (!Array.isArray(records)) return true;
  if (typeof records.loader_status === "string" && records.loader_status.startsWith("error")) return false;
  return records.length < THIN_RECORD_COUNT || distinctCategoryCount(records) < THIN_CATEGORY_COUNT;
}

// A varied day is worth more than a bigger pile of the same type: category
// VARIETY dominates, record count is the tiebreak. So a wider pass with fewer
// records but more distinct types (8 across 3 categories) beats a thin one with
// more records of one type (15 cafés), while a wider pass that adds neither is
// discarded. This is what "richer" means for the expansion.
function supplyScore(records, requestedIntents = []) {
  const profile = supplyProfile(records, requestedIntents);
  return (
    profile.requested_intents_covered.length * 10_000_000 +
    profile.requested_intents_partial.length * 1_000_000 +
    profile.category_count * 1000 +
    profile.record_count
  );
}

function chooseExpansion(first, { baseRadiusKm, requestedIntents, origin = null, walkingTargetBand = null }) {
  const profile = supplyProfile(first, requestedIntents);
  const capacity = dayCapacityProfile(first, { origin, walkingTargetBand });
  const requestedGap = profile.requested_intents_covered.length < profile.requested_intent_count;
  const capacityGap = capacity.can_support_target === false;
  if (!isThinSupply(first) && !requestedGap && !capacityGap) {
    return null;
  }
  if (typeof first?.loader_status === "string" && first.loader_status.startsWith("error")) return null;
  if (baseRadiusKm >= MAX_RADIUS_KM) return null;

  if (requestedGap && capacityGap) {
    return { radius_km: REGIONAL_EXPANSION_RADIUS_KM, trigger: "requested_intent_and_capacity_gap" };
  }
  if (requestedGap) {
    return { radius_km: REGIONAL_EXPANSION_RADIUS_KM, trigger: "requested_intent_gap" };
  }
  if (profile.record_count < SEVERELY_THIN_RECORD_COUNT) {
    return { radius_km: REGIONAL_EXPANSION_RADIUS_KM, trigger: "severely_sparse_supply" };
  }
  if (isThinSupply(first)) {
    return { radius_km: EXPANSION_RADIUS_KM, trigger: "thin_supply" };
  }
  if (capacityGap) {
    return {
      radius_km: capacity.target_km > 6 ? REGIONAL_EXPANSION_RADIUS_KM : EXPANSION_RADIUS_KM,
      trigger: "walking_target_capacity_gap",
    };
  }
  return null;
}

/**
 * How far from the anchor to collect candidates for a day of `targetKm`.
 *
 * A day returns to where it began, so the reach that matters is about a quarter
 * of the distance walked — that puts the candidate span at roughly half the
 * budget and leaves the rest for the legs between stops. Never narrower than
 * the default (a short day is unchanged) and never past the reviewed ceiling.
 *
 * Depends only on the requested budget: no place, no city, no source.
 */
function budgetAwareRadiusKm(walkingTargetBand, defaultRadiusKm = DEFAULT_RADIUS_KM) {
  const targetKm = Number(walkingTargetBand?.targetKm);
  if (!Number.isFinite(targetKm) || targetKm <= 0) return defaultRadiusKm;
  return clamp(
    Math.max(defaultRadiusKm, targetKm * RADIUS_PER_WALKING_KM),
    0.1,
    MAX_RADIUS_KM,
  );
}

function createOpenDataLoader({
  fetcher = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null,
  endpoint = null,
  endpoints = null,
  radiusKm = null,
  limit = DEFAULT_LIMIT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userAgent = DEFAULT_USER_AGENT,
  cache = null,
  staleIfErrorMs = 0,
} = {}) {
  if (typeof fetcher !== "function") {
    return null; // honest fail closed: no fetcher → no loader
  }
  // An operator/test that pins a radius keeps it exactly. Otherwise the aperture
  // is derived per request from the walking budget the caller asked for.
  const pinnedRadiusKm = Number.isFinite(radiusKm) ? clamp(radiusKm, 0.1, MAX_RADIUS_KM) : null;
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), MAX_LIMIT));
  const boundedTimeoutMs = Math.max(50, Math.floor(timeoutMs));
  const boundedStaleIfErrorMs = Math.max(0, Math.floor(Number(staleIfErrorMs) || 0));
  // Resolve the endpoint set. An explicit single `endpoint` (e.g. an injected
  // test) stays single-shot; otherwise the default primary + fallback mirror(s)
  // give cold-load failover. `endpoints` (array) overrides both.
  const resolvedEndpoints =
    Array.isArray(endpoints) && endpoints.length
      ? endpoints.filter(Boolean)
      : endpoint
        ? [endpoint]
        : [DEFAULT_OVERPASS_ENDPOINT, ...DEFAULT_OVERPASS_FALLBACKS];

  // One attempt against one mirror. Returns { ok, payload } on a usable response,
  // or { ok:false, status, error } so the caller can fail over to the next mirror.
  async function attemptOverpass(targetEndpoint, query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeoutMs);
    try {
      const response = await fetcher(targetEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": userAgent,
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!response || response.ok !== true) {
        return { ok: false, status: "error_failed_closed", error: "http_non_200" };
      }
      try {
        return { ok: true, payload: await response.json() };
      } catch (_error) {
        return { ok: false, status: "error_failed_closed", error: "parse_error" };
      }
    } catch (error) {
      return { ok: false, status: "error_failed_closed", error: classifyFetchError(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  // One geocoded query at a given radius, with mirror failover. Fetch wider than
  // the final limit so scarce-but-important categories (scenic in a food-dense
  // centre) survive, then balance down to `boundedLimit` client-side.
  async function fetchAtRadius(lat, lng, radiusM, { queryIntents = [], walkingTargetBand = null } = {}) {
    const fetchBreadth = Math.min(boundedLimit * 6, OVERPASS_FETCH_CAP);
    const query = buildOverpassQuery({
      lat,
      lng,
      radiusM,
      limit: fetchBreadth,
      mappings: mappingsForRequestedIntents(queryIntents),
    });
    // Try each mirror in order; fail over ONLY on a transport/parse error — a
    // genuine 200 (even with zero elements) is a real answer, not a failure.
    let last = { status: "error_failed_closed", error: "no_endpoint" };
    for (const targetEndpoint of resolvedEndpoints) {
      const attempt = await attemptOverpass(targetEndpoint, query);
      if (attempt.ok) {
        const records = mapOverpassResponse(attempt.payload, boundedLimit, {
          origin: { lat, lng },
          walkingTargetBand,
        });
        return withLoaderStatus(records, records.length > 0 ? `loaded:${records.length}` : "loaded:0", null);
      }
      last = attempt;
    }
    return withLoaderStatus([], last.status, last.error);
  }

  async function fetchAcrossAnchors(anchors, radiusM) {
    const boundedAnchors = (Array.isArray(anchors) ? anchors : [])
      .filter((anchor) => Number.isFinite(anchor?.lat) && Number.isFinite(anchor?.lng))
      .slice(0, 2);
    if (!boundedAnchors.length) return { status: "loaded:0", error: null, clusters: [] };
    const fetchBreadth = Math.min(boundedLimit * 6 * boundedAnchors.length, OVERPASS_FETCH_CAP);
    const query = buildOverpassQueryForAnchors({
      anchors: boundedAnchors,
      radiusM,
      limit: fetchBreadth,
      mappings: OSM_TAG_MAP,
    });
    let last = { status: "error_failed_closed", error: "no_endpoint" };
    for (const targetEndpoint of resolvedEndpoints) {
      const attempt = await attemptOverpass(targetEndpoint, query);
      if (!attempt.ok) {
        last = attempt;
        continue;
      }
      const mapped = mapOverpassResponse(
        attempt.payload,
        // Keep the complete, already provider-capped response until it has been
        // partitioned. A dense first anchor must not crowd a better second
        // cluster out of the global candidate limit before comparison.
        OVERPASS_FETCH_CAP,
        { origin: boundedAnchors[0] },
      );
      const buckets = boundedAnchors.map(() => []);
      for (const record of mapped) {
        let nearestIndex = -1;
        let nearestKm = Number.POSITIVE_INFINITY;
        for (let index = 0; index < boundedAnchors.length; index += 1) {
          const km = distanceKm(boundedAnchors[index], record);
          if (km < nearestKm) {
            nearestKm = km;
            nearestIndex = index;
          }
        }
        if (nearestIndex >= 0 && nearestKm <= radiusM / 1000 + 0.05) buckets[nearestIndex].push(record);
      }
      const clusters = boundedAnchors.map((anchor, index) => ({
        anchor,
        records: withLoaderStatus(
          balanceMappedRecords(buckets[index], boundedLimit, anchor),
          buckets[index].length ? `loaded:${Math.min(buckets[index].length, boundedLimit)}` : "loaded:0",
          null,
        ),
      }));
      return { status: `loaded:${mapped.length}`, error: null, clusters };
    }
    return { status: last.status, error: last.error, clusters: [] };
  }

  const loadPrimaryOpenDataAround = async function loadPrimaryOpenDataAround({
    lat,
    lng,
    requestedIntents = [],
    anchorMode = "unknown",
    walkingTargetBand = null,
  } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return withLoaderStatus([], "loaded:0", null);

    const normalizedRequestedIntents = normalizeRequestedIntents(requestedIntents);
    const normalizedWalkingTargetBand = normalizeWalkingTargetBand(walkingTargetBand);
    const origin = { lat, lng };
    // The aperture this request is answered from. A pinned radius wins; else it
    // follows the budget the caller actually asked for.
    const requestRadiusKm = pinnedRadiusKm ?? budgetAwareRadiusKm(normalizedWalkingTargetBand);

    const first = await fetchAtRadius(lat, lng, Math.round(requestRadiusKm * 1000), {
      walkingTargetBand: normalizedWalkingTargetBand,
    });
    const initialProfile = supplyProfile(first, normalizedRequestedIntents);
    const initialDayCapacity = dayCapacityProfile(first, {
      origin,
      walkingTargetBand: normalizedWalkingTargetBand,
    });
    const expansion = chooseExpansion(first, {
      baseRadiusKm: requestRadiusKm,
      requestedIntents: normalizedRequestedIntents,
      origin,
      walkingTargetBand: normalizedWalkingTargetBand,
    });
    let selected = first;
    let selectedRadiusKm = requestRadiusKm;
    let selectionReason = expansion
      ? "wider_supply_not_richer"
      : typeof first.loader_status === "string" && first.loader_status.startsWith("error")
        ? "loader_error"
        : "expansion_not_needed";

    // Adaptive aperture: one bounded wider query when total supply is thin OR
    // the requested intent family is absent. Very sparse/request-gap contexts
    // may use the full reviewed 5 km ceiling; ordinary thin supply uses 3 km.
    // The wider result wins only when it improves requested coverage or variety.
    if (expansion) {
      // A custom base can sit above the ordinary 3 km expansion target. In that
      // case use the regional ceiling rather than repeating the same query.
      const widerKm = Math.min(
        expansion.radius_km > requestRadiusKm ? expansion.radius_km : MAX_RADIUS_KM,
        MAX_RADIUS_KM,
      );
      const expansionQueryIntents = expansion.trigger === "requested_intent_gap"
        ? [
            ...initialProfile.requested_intents_partial,
            ...initialProfile.requested_intents_missing,
          ]
        : [];
      const wider = await fetchAtRadius(lat, lng, Math.round(widerKm * 1000), {
        queryIntents: expansionQueryIntents,
        walkingTargetBand: normalizedWalkingTargetBand,
      });
      const combined = mergeLoaderRecords(first, wider, boundedLimit, origin, {
        walkingTargetBand: normalizedWalkingTargetBand,
      });
      if (isWiderSupplyBetter(first, combined, {
        requestedIntents: normalizedRequestedIntents,
        origin,
        walkingTargetBand: normalizedWalkingTargetBand,
        trigger: expansion.trigger,
      })) {
        selected = combined;
        selectedRadiusKm = widerKm;
        selectionReason = "richer_wider_supply";
      }
    }
    return withLoaderMetadata(selected, {
      base_radius_km: requestRadiusKm,
      selected_radius_km: selectedRadiusKm,
      attempted_radius_km: expansion
        ? Math.min(expansion.radius_km > requestRadiusKm ? expansion.radius_km : MAX_RADIUS_KM, MAX_RADIUS_KM)
        : null,
      expansion_applied: selectedRadiusKm > requestRadiusKm,
      expansion_trigger: expansion?.trigger || null,
      selection_reason: selectionReason,
      anchor_mode: normalizeAnchorMode(anchorMode),
      requested_intents: normalizedRequestedIntents,
      expansion_query_intents: expansion?.trigger === "requested_intent_gap"
        ? [...initialProfile.requested_intents_partial, ...initialProfile.requested_intents_missing]
        : [],
      initial_profile: initialProfile,
      selected_profile: supplyProfile(selected, normalizedRequestedIntents),
      walking_target: normalizedWalkingTargetBand,
      initial_day_capacity: initialDayCapacity,
      selected_day_capacity: dayCapacityProfile(selected, {
        origin,
        walkingTargetBand: normalizedWalkingTargetBand,
      }),
    });
  };

  const loadOpenDataAround = async function loadOpenDataAround(request = {}) {
    const primary = await loadPrimaryOpenDataAround(request);
    const anchorMode = normalizeAnchorMode(request.anchorMode);
    const scope = anchorMode === "place" ? sanitizeTrustedSpatialScope(request.spatialScope) : null;
    const primaryMetadata = primary.loader_metadata || null;
    const baseMetadata = {
      ...(primaryMetadata || {}),
      spatial_scope: scope ? summarizeSpatialScope(scope) : null,
    };
    if (!scope) return withLoaderMetadata(primary, baseMetadata);

    if (
      scope.collection_mode === "regional_bounded" &&
      !allowsRegionalClusterSelection(scope)
    ) {
      return withLoaderMetadata(primary, {
        ...baseMetadata,
        regional_scout: {
          attempted: false,
          reason: "primary_zone_preserved",
          selected_anchor: "primary",
          cluster_count: 1,
        },
      });
    }

    const secondaryAnchors = deriveSecondaryAnchors(scope, { lat: request.lat, lng: request.lng });
    const selectedProfile = primaryMetadata?.selected_profile || supplyProfile(primary, normalizeRequestedIntents(request.requestedIntents));
    const hasRequestedGap = selectedProfile.requested_intents_covered.length < selectedProfile.requested_intent_count;
    const needsRegionalScout =
      scope.collection_mode === "regional_bounded" &&
      secondaryAnchors.length > 0 &&
      !String(primary.loader_status || "").startsWith("error") &&
      (selectedProfile.record_count < THIN_RECORD_COUNT || hasRequestedGap);
    if (!needsRegionalScout) {
      return withLoaderMetadata(primary, {
        ...baseMetadata,
        regional_scout: {
          attempted: false,
          reason: scope.collection_mode === "regional_bounded" ? "primary_supply_sufficient" : "scope_not_bounded_regional",
          selected_anchor: "primary",
          cluster_count: 1,
        },
      });
    }

    const regional = await fetchAcrossAnchors(secondaryAnchors, REGIONAL_CLUSTER_RADIUS_KM * 1000);
    const requestedIntents = normalizeRequestedIntents(request.requestedIntents);
    let selected = primary;
    let selectedAnchor = { id: "primary", lat: request.lat, lng: request.lng };
    let bestScore = supplyScore(primary, requestedIntents);
    const clusterProfiles = [];
    for (const cluster of regional.clusters) {
      const profile = supplyProfile(cluster.records, requestedIntents);
      const score = supplyScore(cluster.records, requestedIntents);
      clusterProfiles.push({
        id: cluster.anchor.id,
        record_count: profile.record_count,
        requested_intents_covered: profile.requested_intents_covered,
        requested_intents_missing: profile.requested_intents_missing,
      });
      if (score > bestScore) {
        selected = cluster.records;
        selectedAnchor = cluster.anchor;
        bestScore = score;
      }
    }
    const selectedRegional = selectedAnchor.id !== "primary";
    return withLoaderMetadata(selected, {
      ...baseMetadata,
      ...(selectedRegional
        ? {
            selected_radius_km: REGIONAL_CLUSTER_RADIUS_KM,
            attempted_radius_km: REGIONAL_CLUSTER_RADIUS_KM,
            expansion_applied: true,
            expansion_trigger: "regional_scope_gap",
            selection_reason: "richer_regional_cluster",
            selected_profile: supplyProfile(selected, requestedIntents),
            selected_day_capacity: dayCapacityProfile(selected, {
              origin: selectedAnchor,
              walkingTargetBand: request.walkingTargetBand,
            }),
          }
        : {}),
      regional_scout: {
        attempted: true,
        status: safeLoaderToken(regional.status),
        reason: selectedRegional ? "richer_regional_cluster" : "primary_cluster_retained",
        selected_anchor: selectedAnchor.id,
        selected_anchor_coords: { lat: selectedAnchor.lat, lng: selectedAnchor.lng },
        cluster_count: 1 + regional.clusters.length,
        clusters: clusterProfiles,
      },
    });
  };

  if (!cache || typeof cache.get !== "function") {
    return loadOpenDataAround;
  }

  // Cached loader: repeat/concurrent lookups for the same anchor must not re-hit
  // Overpass (the "no public flip without persistent caching" guardrail). The key
  // buckets the anchor to ~110 m and carries the radius/limit that shaped the
  // query; the cache coalesces concurrent identical lookups and (when file-backed)
  // survives across requests. Only non-error results are stored, so a transient
  // outage is never frozen in.
  return async function cachedLoadOpenDataAround(request = {}) {
    const { lat, lng, requestedIntents = [], anchorMode = "unknown", spatialScope = null } = request;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return loadOpenDataAround(request);
    }
    const normalizedRequestedIntents = normalizeRequestedIntents(requestedIntents);
    const normalizedWalkingTargetBand = normalizeWalkingTargetBand(request.walkingTargetBand);
    const targetKey = normalizedWalkingTargetBand ? normalizedWalkingTargetBand.targetKm : "none";
    // v8 invalidates every row collected before the aperture followed the
    // walking budget: a `t9` row cached under v7 was gathered from a 1.5 km
    // disc, so reusing it would keep serving the narrow day this change fixes.
    const effectiveRadiusKm = pinnedRadiusKm ?? budgetAwareRadiusKm(normalizedWalkingTargetBand);
    const key = `v8:${lat.toFixed(3)},${lng.toFixed(3)}:r${effectiveRadiusKm}:l${boundedLimit}:m${normalizeAnchorMode(anchorMode)}:i${normalizedRequestedIntents.join(".") || "all"}:t${targetKey}:s${spatialScopeCacheKey(spatialScope)}`;
    const entry = await cache.get(
      key,
      async () => {
        const result = await loadOpenDataAround(request);
        return {
          records: Array.from(result),
          status: result.loader_status,
          error: result.loader_error,
          metadata: result.loader_metadata || null,
        };
      },
      {
        shouldStore: (value) => value && typeof value.status === "string" && !value.status.startsWith("error"),
        staleIfErrorMs: boundedStaleIfErrorMs,
        onStale: (stale, info) => {
          const refreshReason = safeLoaderToken(
            info?.refreshValue?.error ||
              (info?.refreshError ? classifyFetchError(info.refreshError) : "provider_failed"),
          );
          return {
            ...stale,
            error: "stale_cache_refresh_failed",
            metadata: {
              ...(stale?.metadata && typeof stale.metadata === "object" ? stale.metadata : {}),
              cache: {
                served_stale: true,
                stale_age_seconds: Math.max(0, Math.floor(Number(info?.staleAgeMs) / 1000) || 0),
                refresh_reason: refreshReason,
              },
            },
          };
        },
      },
    );
    return withLoaderMetadata(
      withLoaderStatus(entry.records, entry.status, entry.error),
      entry.metadata || null,
    );
  };
}

function buildOverpassQuery({ lat, lng, radiusM, limit, mappings = OSM_TAG_MAP }) {
  return buildOverpassQueryForAnchors({
    anchors: [{ lat, lng }],
    radiusM,
    limit,
    mappings,
  });
}

function buildOverpassQueryForAnchors({ anchors, radiusM, limit, mappings = OSM_TAG_MAP }) {
  // Per-category `out` budgets. Overpass outputs nodes before ways, so a single
  // combined `out center N` lets food/bar/cafe NODES exhaust N before park/
  // castle WAYS are ever emitted — scarce area-typed scenic places vanished
  // server-side (#273). Grouping by category with its own `out` guarantees each
  // category contributes regardless of node/way ordering. Still one request.
  const groups = new Map();
  for (const { key, value, type } of mappings) {
    const category = TYPE_CATEGORY[type] || "other";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ key, value });
  }
  const perCategory = Math.max(6, Math.ceil(limit / groups.size));
  const blocks = [];
  let i = 0;
  for (const [category, entries] of groups) {
    const setName = `c${i}`;
    const filters = entries
      .flatMap(({ key, value }) => anchors.flatMap(({ lat, lng }) => [
        `node["${key}"="${value}"](around:${radiusM},${lat},${lng});`,
        `way["${key}"="${value}"](around:${radiusM},${lat},${lng});`,
      ]))
      .join("");
    blocks.push(`(${filters})->.${setName};.${setName} out center ${perCategory};`);
    i += 1;
  }
  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SECONDS}];${blocks.join("")}`;
}

function mapOverpassResponse(payload, limit, { origin = null, walkingTargetBand = null } = {}) {
  if (!payload || !Array.isArray(payload.elements)) return [];
  // Map + dedupe everything Overpass returned (already bounded by the fetch
  // cap), preserving response order.
  const mapped = [];
  const seenIds = new Set();
  for (const element of payload.elements) {
    const record = mapOsmElement(element);
    if (!record) continue;
    if (seenIds.has(record.id)) continue; // exact-id dedupe inside the loader
    seenIds.add(record.id);
    mapped.push(record);
  }
  return balanceMappedRecords(mapped, limit, origin, { walkingTargetBand });
}

function balanceMappedRecords(mapped, limit, origin, { walkingTargetBand = null } = {}) {
  const ranked = rankMappedRecords(mapped, origin);
  if (mapped.length <= limit) return ranked;

  // Category-balanced round-robin: a food-dense centre must not crowd out the
  // single scenic anchor. Buckets keep response order; we take one per category
  // per round until the limit is reached. Deterministic given the input order.
  const buckets = new Map();
  for (const record of ranked) {
    const category = TYPE_CATEGORY[record.type] || "other";
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category).push(record);
  }
  const order = [...buckets.keys()]; // first-seen category order — deterministic
  const balanced = [];
  let round = 0;
  while (balanced.length < limit) {
    let tookOne = false;
    for (const category of order) {
      const bucket = buckets.get(category);
      if (round < bucket.length) {
        balanced.push(bucket[round]);
        tookOne = true;
        if (balanced.length >= limit) break;
      }
    }
    if (!tookOne) break; // all buckets exhausted
    round += 1;
  }
  return preserveCapacityFrontier(balanced, ranked, limit, origin, walkingTargetBand);
}

function mappingsForRequestedIntents(requestedIntents = []) {
  if (!requestedIntents.length) return OSM_TAG_MAP;
  const requested = new Set(requestedIntents);
  const mappings = OSM_TAG_MAP.filter((mapping) =>
    [...requested].some(
      (intent) => matchCandidateToIntent({ type: mapping.type, tags: mapping.tags }, intent).level === "strong",
    ),
  );
  return mappings.length ? mappings : OSM_TAG_MAP;
}

function mergeLoaderRecords(first, wider, limit, origin, { walkingTargetBand = null } = {}) {
  const deduped = [];
  const ids = new Set();
  for (const record of [...(Array.isArray(first) ? first : []), ...(Array.isArray(wider) ? wider : [])]) {
    if (!record || ids.has(record.id)) continue;
    ids.add(record.id);
    deduped.push(record);
  }
  const selected = balanceMappedRecords(deduped, limit, origin, { walkingTargetBand });
  return withLoaderStatus(
    selected,
    selected.length ? `loaded:${selected.length}` : first?.loader_status || wider?.loader_status || "loaded:0",
    first?.loader_error || wider?.loader_error || null,
  );
}

function isWiderSupplyBetter(first, combined, {
  requestedIntents = [],
  origin = null,
  walkingTargetBand = null,
  trigger = null,
} = {}) {
  if (!["walking_target_capacity_gap", "requested_intent_and_capacity_gap"].includes(trigger)) {
    return supplyScore(combined, requestedIntents) > supplyScore(first, requestedIntents);
  }

  const initialSupply = supplyProfile(first, requestedIntents);
  const combinedSupply = supplyProfile(combined, requestedIntents);
  const coverageNotWorse =
    combinedSupply.requested_intents_covered.length >= initialSupply.requested_intents_covered.length &&
    combinedSupply.requested_intents_partial.length >= initialSupply.requested_intents_partial.length &&
    combinedSupply.category_count >= initialSupply.category_count;
  if (!coverageNotWorse) return false;

  const initial = dayCapacityProfile(first, { origin, walkingTargetBand });
  const expanded = dayCapacityProfile(combined, { origin, walkingTargetBand });
  const capacityImproved = (
    (expanded.can_support_target === true && initial.can_support_target !== true) ||
    expanded.candidate_span_km >= initial.candidate_span_km + MIN_CAPACITY_SPAN_IMPROVEMENT_KM
  );
  if (trigger === "walking_target_capacity_gap") return capacityImproved;

  return capacityImproved || requestedCoverageRank(combinedSupply) > requestedCoverageRank(initialSupply);
}

function requestedCoverageRank(profile) {
  return profile.requested_intents_covered.length * 2 + profile.requested_intents_partial.length;
}

function rankMappedRecords(records, origin) {
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return records;
  return [...records].sort((a, b) =>
    operationalRecordRank(a) - operationalRecordRank(b) ||
    Number(a.chain === true) - Number(b.chain === true) ||
    distanceKm(origin, a) - distanceKm(origin, b) ||
    String(a.id).localeCompare(String(b.id)),
  );
}

function operationalRecordRank(record) {
  if (record?.operational_status === "source_indicated_active") return 0;
  if (record?.operational_status === "unknown") return 1;
  return 2;
}

function withLoaderStatus(records, status, error) {
  const output = Array.isArray(records) ? records : [];
  Object.defineProperty(output, "loader_status", {
    value: status,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(output, "loader_error", {
    value: error,
    enumerable: false,
    configurable: true,
  });
  return output;
}

function withLoaderMetadata(records, metadata) {
  const output = Array.isArray(records) ? records : [];
  Object.defineProperty(output, "loader_metadata", {
    value: metadata && typeof metadata === "object" ? metadata : null,
    enumerable: false,
    configurable: true,
  });
  return output;
}

function summarizeSpatialScope(scope) {
  return {
    source: scope.source,
    kind: scope.kind,
    collection_mode: scope.collection_mode,
    diagonal_km: scope.diagonal_km,
  };
}

function safeLoaderToken(value) {
  return typeof value === "string" && /^[a-z0-9_:-]{1,80}$/.test(value) ? value : "provider_failed";
}

function normalizeAnchorMode(value) {
  return ["coordinates", "place"].includes(String(value)) ? String(value) : "unknown";
}

function distanceKm(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function classifyFetchError(error) {
  const name = typeof error?.name === "string" ? error.name.toLowerCase() : "";
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  if (name.includes("abort") || message.includes("abort") || message.includes("timeout")) {
    return "timeout_or_abort";
  }
  return "fetch_error";
}

function mapOsmElement(element) {
  if (!element || typeof element !== "object") return null;
  const tags = element.tags && typeof element.tags === "object" ? element.tags : null;
  if (!tags) return null;

  const name = typeof tags.name === "string" ? tags.name.trim() : "";
  if (!name) return null; // no name → not a place

  const coords = resolveElementCoords(element);
  if (!coords) return null; // no coords → cannot become a place target

  const mapping = findOsmMapping(tags);
  if (!mapping) return null; // not an intent-mapped category

  const elementType = String(element.type || "node").toLowerCase();
  const osmId = element.id;
  if (osmId === undefined || osmId === null) return null;

  const sources = [
    {
      provider: "osm",
      family: "map",
      tier: "inferred",
      url: `https://www.openstreetmap.org/${elementType}/${osmId}`,
    },
  ];

  // Wikidata corroboration: when the OSM element itself links to a Wikidata
  // entity, emit a SECOND source claim from the `open_knowledge` family (linked
  // open knowledge graph) — that's how a single OSM element can carry real
  // provenance diversity. `open_knowledge` is deliberately NOT `community`: it
  // must add diversity without inheriting community/local-lens calibration.
  // Without this second source the candidate stays single-family and is gated
  // out by the existing gates — OSM alone never becomes a user-facing move.
  const wikidataId = typeof tags.wikidata === "string" ? tags.wikidata.trim() : "";
  if (/^Q\d+$/.test(wikidataId)) {
    sources.push({
      provider: "wikidata",
      family: "open_knowledge",
      tier: "inferred",
      url: `https://www.wikidata.org/wiki/${wikidataId}`,
    });
  }

  // Chain signal (#272): the OSM `brand` / `brand:wikidata` TAG is the signal —
  // never name-string matching. Chains stay valid candidates (sparse fallback);
  // downstream composition may prefer non-chain options, never ban them.
  const brandName = typeof tags.brand === "string" && tags.brand.trim() ? tags.brand.trim() : null;
  const brandWikidata = typeof tags["brand:wikidata"] === "string" && tags["brand:wikidata"].trim();
  const website = firstHttpUrl(tags.website, tags["contact:website"]);
  const openingHours = normalizeOpeningHours(tags.opening_hours);
  const operational = extractOsmOperationalMetadata(tags, { website, openingHours });

  return {
    id: `osm-${elementType}-${osmId}`,
    name,
    type: mapping.type,
    lat: coords.lat,
    lng: coords.lng,
    tags: mapping.tags.slice(),
    sources,
    chain: Boolean(brandName || brandWikidata),
    brand: brandName,
    operational_status: operational.status,
    operational_reasons: operational.reasons,
    // Source-owned operational metadata only. It does not raise place trust.
    // The website may seed bounded source discovery; opening hours may only
    // exclude a candidate when trusted local-time evaluation proves no overlap.
    ...(website ? { website } : {}),
    ...(openingHours ? { opening_hours: openingHours } : {}),
  };
}

function extractOsmOperationalMetadata(tags, { website = null, openingHours = null } = {}) {
  const reasons = [];
  const lifecyclePrefixes = ["disused", "abandoned", "demolished", "removed", "razed"];
  for (const [key, rawValue] of Object.entries(tags || {})) {
    const normalizedKey = String(key || "").trim().toLowerCase();
    const value = String(rawValue || "").trim().toLowerCase();
    if (!value || ["no", "false", "0"].includes(value)) continue;
    if (lifecyclePrefixes.some((prefix) => normalizedKey === prefix || normalizedKey.startsWith(`${prefix}:`))) {
      reasons.push(`osm_lifecycle_${normalizedKey.split(":", 1)[0]}`);
    }
  }
  const construction = String(tags?.construction || "").trim().toLowerCase();
  if (construction && !["no", "false", "0"].includes(construction)) {
    reasons.push("osm_lifecycle_construction");
  }
  if (/^(?:closed|off)$/i.test(String(openingHours || "").trim())) {
    reasons.push("osm_opening_hours_explicitly_closed");
  }
  if (reasons.length) {
    return { status: "inactive", reasons: [...new Set(reasons)] };
  }

  const activeSignals = [];
  if (openingHours) activeSignals.push("operational_opening_hours_present");
  if (website) activeSignals.push("operational_website_present");
  return {
    status: activeSignals.length ? "source_indicated_active" : "unknown",
    reasons: activeSignals,
  };
}

function firstHttpUrl(...values) {
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch (_error) {
      // Invalid source-owned website atoms are ignored, never repaired.
    }
  }
  return null;
}

function resolveElementCoords(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
    return { lat: element.lat, lng: element.lon };
  }
  const center = element.center && typeof element.center === "object" ? element.center : null;
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
    return { lat: center.lat, lng: center.lon };
  }
  return null;
}

function findOsmMapping(tags) {
  for (const mapping of OSM_TAG_MAP) {
    if (tags[mapping.key] === mapping.value) return mapping;
  }
  return null;
}

/**
 * Read PARRANDA_OPEN_DATA_LOADER from the env at call time (not module load)
 * so tests can flip it deterministically and so a fresh `buildApp()` reflects
 * current config. Returns null when not "enabled", so the default `buildApp()`
 * with no override has no loader — production opts in explicitly.
 */
function resolveDefaultOpenDataLoader(env = process.env) {
  const flag = String(env?.PARRANDA_OPEN_DATA_LOADER || "").toLowerCase();
  if (flag !== "enabled" && flag !== "1" && flag !== "true") return null;
  // Wrap the live Overpass loader in a persistent-capable cache so a deploy can
  // turn it on without re-hitting Overpass on every request. File-backed when
  // PARRANDA_CACHE_DIR is set (point it at a mounted disk to survive redeploys);
  // in-memory + de-duping otherwise.
  const ttlMs = Number(env?.PARRANDA_SOURCE_CACHE_TTL_MS);
  const staleRaw = env?.PARRANDA_SOURCE_CACHE_STALE_IF_ERROR_MS;
  const parsedStaleMs = staleRaw === undefined || staleRaw === null || staleRaw === "" ? null : Number(staleRaw);
  const staleIfErrorMs = Number.isFinite(parsedStaleMs) && parsedStaleMs >= 0
    ? parsedStaleMs
    : DEFAULT_STALE_IF_ERROR_MS;
  const cache = createSourceCache({
    namespace: "overpass",
    dir: env?.PARRANDA_CACHE_DIR || null,
    ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : undefined,
  });
  // Deploy-overridable Overpass mirror set (comma-separated) for cold-load
  // failover; defaults to the built-in primary + fallback mirror.
  const endpointsRaw = String(env?.PARRANDA_OVERPASS_ENDPOINTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const osmLoader = createOpenDataLoader({
    cache,
    staleIfErrorMs,
    ...(endpointsRaw.length ? { endpoints: endpointsRaw } : {}),
  });

  // Optional SECOND open source family: Wikidata notable places. When enabled,
  // both sources are queried (each independently cached) and concatenated; the
  // downstream entity-resolution merges OSM↔Wikidata duplicates so a place both
  // sources know carries two families (`map` + `open_knowledge`) → real
  // cross-source consensus past the single-family ceiling the reducer enforces.
  const wikiFlag = String(env?.PARRANDA_WIKIDATA_SOURCE || "").toLowerCase();
  const wikiEnabled = wikiFlag === "enabled" || wikiFlag === "1" || wikiFlag === "true";
  // Label-language priority (local first) so Wikidata names match local OSM
  // names for entity-resolution. Configurable per deploy; multi-city per-request
  // locale resolution is a follow-up.
  const labelLanguages = String(env?.PARRANDA_WIKIDATA_LABEL_LANGS || "en")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const storeNonEmpty = { shouldStore: (value) => Array.isArray(value) && value.length > 0 };
  let wikiSource = null;
  if (wikiEnabled) {
    const wikiRaw = createWikidataSource({ labelLanguages });
    if (typeof wikiRaw === "function") {
      const wikiCache = createSourceCache({
        namespace: "wikidata",
        dir: env?.PARRANDA_CACHE_DIR || null,
        ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : undefined,
      });
      wikiSource = ({ lat, lng } = {}) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
        const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
        const cached = wikiCache.peek(key);
        if (cached) return cached;
        // WDQS cold queries are slow (~10-20s) and must NOT block the route. On
        // a cache miss, warm out-of-band and serve the other sources this time.
        wikiCache.warm(key, () => wikiRaw({ lat, lng }), storeNonEmpty);
        return [];
      };
    }
  }

  // Overture is a global structured place directory, independent from the OSM
  // map family. Its cold GeoParquet read also stays out of the route request:
  // first visit starts a bounded warm; a repeat receives the cached rows. This
  // removes Overpass as a single point of failure without pretending Overture's
  // internal contributing datasets are multiple independent Parranda sources.
  const overtureFlag = String(env?.PARRANDA_OVERTURE_SOURCE || "").toLowerCase();
  const overtureEnabled = overtureFlag === "enabled" || overtureFlag === "1" || overtureFlag === "true";
  let overtureSource = null;
  if (overtureEnabled) {
    const overtureRaw = createOvertureSource({
      cacheDir: env?.PARRANDA_CACHE_DIR || null,
      radiusKm: Number(env?.PARRANDA_OVERTURE_RADIUS_KM) || undefined,
      limit: Number(env?.PARRANDA_OVERTURE_LIMIT) || undefined,
      minConfidence: Number(env?.PARRANDA_OVERTURE_MIN_CONFIDENCE) || undefined,
    });
    const overtureCache = createSourceCache({
      // v2 invalidates rows cached before per-record Overture licenses were
      // selected from the source schema; those rows cannot be relabeled safely.
      namespace: "overture-v2",
      dir: env?.PARRANDA_CACHE_DIR || null,
      ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : undefined,
    });
    overtureSource = {
      eager: true,
      load(anchor = {}, request = {}) {
        const { lat, lng } = anchor;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
        const requestedIntents = normalizeRequestedIntents(request.requestedIntents);
        const key = `${lat.toFixed(3)},${lng.toFixed(3)}:${requestedIntents.join("+") || "all"}`;
        const cached = overtureCache.peek(key);
        if (cached) return cached;
        overtureCache.warm(
          key,
          () => overtureRaw({ lat, lng, requestedIntents }),
          storeNonEmpty,
        );
        return [];
      },
    };
  }

  if (!wikiSource && !overtureSource) return osmLoader;
  return composeOpenDataLoaders(osmLoader, wikiSource, overtureSource);
}

// Compose the OSM loader (returns a `withLoaderStatus` array) with bounded
// background sources (plain arrays). OSM runs first so a selected regional
// cluster anchors every other source to the SAME place. A legacy function gets
// only the anchor; a descriptor's `load(anchor, request)` may also use bounded
// private request context (for example requested intents).
function composeOpenDataLoaders(osmLoader, wikiSource = null, overtureSource = null) {
  return async function loadComposedOpenData(request = {}) {
    const sources = [wikiSource, overtureSource].filter(Boolean);
    const primaryAnchor = { lat: request.lat, lng: request.lng };
    // Eager cache-only sources are read before waiting on the live primary. On
    // a miss their wrapper starts an out-of-band warm and returns []; on a hit a
    // sufficiently varied global directory can satisfy this request immediately
    // while Overpass continues in the background. This is the latency rescue,
    // not just a second source that still waits behind a 30-second outage.
    const eagerLoads = new Map();
    for (const source of sources.filter((candidate) => candidate?.eager === true)) {
      eagerLoads.set(
        source,
        Promise.resolve(source.load(primaryAnchor, request)).catch(() => []),
      );
    }
    const osmPromise = Promise.resolve(osmLoader(request))
      .catch(() => withLoaderStatus([], "error_failed_closed", "osm_threw"));
    const eagerRecords = [];
    for (const pending of eagerLoads.values()) {
      const loaded = await pending;
      if (Array.isArray(loaded)) eagerRecords.push(...loaded);
    }
    const requestedIntents = normalizeRequestedIntents(request.requestedIntents);
    const eagerProfile = supplyProfile(eagerRecords, requestedIntents);
    if (eagerProfile.record_count >= THIN_RECORD_COUNT && eagerProfile.category_count >= THIN_CATEGORY_COUNT) {
      // Keep the primary promise observed so a background failure can never
      // become an unhandled rejection. Its own loader/cache side effects remain
      // useful for later cross-source corroboration.
      osmPromise.catch(() => {});
      return withLoaderMetadata(
        withLoaderStatus(eagerRecords, `loaded:${eagerRecords.length}`, null),
        {
          selected_profile: eagerProfile,
          selected_day_capacity: dayCapacityProfile(eagerRecords, {
            origin: primaryAnchor,
            walkingTargetBand: request.walkingTargetBand,
          }),
          primary_collection: "background_refresh",
        },
      );
    }

    const osm = await osmPromise;
    // If bounded regional scouting selected a richer sub-anchor, warm/read the
    // independent knowledge source around that SAME cluster. Mixing primary-
    // anchor Wikidata rows into a remote selected cluster would fabricate one
    // walkable reservoir from two places.
    const selectedCoords = osm?.loader_metadata?.regional_scout?.selected_anchor_coords;
    const wikiAnchor =
      selectedCoords && Number.isFinite(selectedCoords.lat) && Number.isFinite(selectedCoords.lng)
        ? selectedCoords
        : { lat: request.lat, lng: request.lng };
    const osmRecords = Array.isArray(osm) ? osm : [];
    // The primary carried nothing: either it errored outright or it came back
    // empty. Both leave the day dependent on another source.
    const primaryFailed =
      osmRecords.length === 0 ||
      (typeof osm?.loader_status === "string" && osm.loader_status.startsWith("error"));
    const backgroundRecords = [];
    for (const source of sources) {
      const sameAsPrimary =
        Number(wikiAnchor.lat).toFixed(6) === Number(primaryAnchor.lat).toFixed(6) &&
        Number(wikiAnchor.lng).toFixed(6) === Number(primaryAnchor.lng).toFixed(6);
      // Reusing the eager result avoids a duplicate read — but an eager source
      // that missed its cache returned [] and started an out-of-band warm. When
      // the primary ALSO failed, reusing that [] is what loses the whole day:
      // nothing is left to answer with, even though the warm is landing right
      // now and the very next request will succeed. Observed live with the
      // primary provider globally unreachable — first request 0 records,
      // second identical request 80. So in exactly that case, read the source
      // again: on a warmed cache it now answers, and if it is still cold it
      // returns [] as before and we fail closed just the same.
      const eagerResult = sameAsPrimary ? eagerLoads.get(source) : null;
      const eagerWasEmpty = Array.isArray(await eagerResult) && (await eagerResult).length === 0;
      const alreadyLoaded = primaryFailed && eagerWasEmpty ? null : eagerResult;
      const loaded = await Promise.resolve(
        alreadyLoaded || (typeof source === "function" ? source(wikiAnchor) : source.load(wikiAnchor, request)),
      ).catch(() => []);
      if (Array.isArray(loaded)) backgroundRecords.push(...loaded);
    }
    const records = [...osmRecords, ...backgroundRecords];
    const status = records.length > 0 ? `loaded:${records.length}` : (osm.loader_status || "loaded:0");
    const metadata = osm.loader_metadata
      ? {
          ...osm.loader_metadata,
          selected_profile: supplyProfile(records, requestedIntents),
          selected_day_capacity: dayCapacityProfile(records, {
            origin: wikiAnchor,
            walkingTargetBand: request.walkingTargetBand,
          }),
        }
      : null;
    return withLoaderMetadata(
      withLoaderStatus(records, status, osm.loader_error || null),
      metadata,
    );
  };
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  DEFAULT_OVERPASS_ENDPOINT,
  DEFAULT_USER_AGENT,
  DEFAULT_RADIUS_KM,
  DEFAULT_LIMIT,
  DEFAULT_TIMEOUT_MS,
  OVERPASS_QUERY_TIMEOUT_SECONDS,
  MAX_RADIUS_KM,
  MAX_LIMIT,
  EXPANSION_RADIUS_KM,
  REGIONAL_EXPANSION_RADIUS_KM,
  OSM_TAG_MAP,
  createOpenDataLoader,
  resolveDefaultOpenDataLoader,
  composeOpenDataLoaders,
  // exported for tests / introspection
  buildOverpassQuery,
  mapOverpassResponse,
  mapOsmElement,
  extractOsmOperationalMetadata,
  normalizeRequestedIntents,
  supplyProfile,
  dayCapacityProfile,
};
