/**
 * External / open evidence provider v1.
 *
 * The first bridge from the Candidate Spine to source-backed candidates BEYOND
 * the curated city catalog. It is deliberately fixture/injection backed and
 * makes NO network calls — a real OSM/Wikidata/open-data fetch would simply
 * populate the `dataset` this provider consumes; the architecture is identical.
 *
 *   external/open record
 *     → source-backed place candidate (NOT Parranda-verified)
 *     → explicit evidence claims (existence / location / category [+ consensus])
 *     → (reduced confidence → gates → fit) handled downstream by the spine
 *
 * Hard product stances baked in here:
 *   - external candidates are city_pack_owned:false, human_verified:false, and
 *     carry candidate_origin:"external_open" so nothing downstream can mistake
 *     them for curated truth.
 *   - confidence is NOT declared by this provider; it emits evidence and lets
 *     the reducer derive belief. Corroboration across source families is what
 *     lifts existence — a single weak family stays weak; consensus alone does
 *     not promote.
 *   - a record with no reliable location (no coords / no known place) becomes a
 *     map_result that the gates will keep out of user-facing moves.
 *
 * Deterministic and pure given its dataset.
 */

const { normalizePlaceCandidate, validatePlaceCandidate } = require("./contract");
const { normalizeOpeningHours } = require("./opening-hours");
const { createEvidence, SOURCE_FAMILIES } = require("../candidates/evidence");

const EXTERNAL_OPEN_PROVIDER_META = Object.freeze({
  provider_id: "open-data-osm-wikidata-v1",
  source_family: "map",
  source_tier: "inferred",
  source_policy: "open_data_attribution_required",
});

const CANDIDATE_ORIGIN = "external_open";

class ExternalOpenCandidateProvider {
  constructor(cityConfig, { dataset, observedAt = null, useBundledFixtures = false } = {}) {
    if (!cityConfig || typeof cityConfig !== "object") {
      throw new Error("ExternalOpenCandidateProvider requires a city config");
    }
    this.cityConfig = cityConfig;
    this.dataset = dataset;
    this.observedAt = observedAt;
    this.useBundledFixtures = useBundledFixtures === true;
  }

  listCandidates() {
    const records = resolveDataset(this.dataset, this.cityConfig, this.useBundledFixtures);
    return records
      .map((record, index) => mapRecordToCandidate(this.cityConfig, record, this.observedAt, index))
      .filter(Boolean);
  }
}

function createExternalOpenProvider(cityConfig, options = {}) {
  return new ExternalOpenCandidateProvider(cityConfig, options);
}

/**
 * Dataset resolution — FAIL CLOSED at runtime.
 *
 *   - a function → called once with cityConfig (injectable loader; lets tests
 *     count calls and lets a future real fetcher plug in)
 *   - an array → used directly (explicit injection)
 *   - undefined → []
 *
 * Bundled deterministic fixtures are NEVER auto-loaded at runtime; they exist
 * only as a development/testing aid and must be opted into explicitly via the
 * { useBundledFixtures: true } option (test/dev seam) — typically not exposed
 * over HTTP. This stops a `candidate_sources=open` runtime call from silently
 * surfacing demo records as if they were real source-backed open data.
 */
function resolveDataset(dataset, cityConfig, useBundledFixtures) {
  if (typeof dataset === "function") {
    const produced = dataset(cityConfig);
    return Array.isArray(produced) ? produced : [];
  }
  if (Array.isArray(dataset)) {
    return dataset;
  }
  if (useBundledFixtures === true) {
    const { getOpenCandidateFixtures } = require("./fixtures/open-candidates");
    return getOpenCandidateFixtures(cityConfig.key);
  }
  // Fail closed: no loader → no candidates. Real OSM/Wikidata wiring will pass
  // a dataset function; tests/dev opt into bundled fixtures explicitly.
  return [];
}

function mapRecordToCandidate(cityConfig, record, observedAt, index) {
  if (!record || typeof record !== "object") return null;
  const name = firstString(record.name, record.label, record.title);
  if (!name) return null;

  const hasCoords = Number.isFinite(record.lat) && Number.isFinite(record.lng);
  const type = firstString(record.type, record.category, "place");
  const sources = Array.isArray(record.sources) ? record.sources.filter(Boolean) : [];

  const evidence = buildEvidence(record, sources, hasCoords, type, observedAt);

  // Source tier = the strongest tier any contributing source claims. Provider
  // default applies when a source omits it.
  const sourceTier = strongestTier(sources) || EXTERNAL_OPEN_PROVIDER_META.source_tier;
  const primaryFamily = firstString(sources[0]?.family, EXTERNAL_OPEN_PROVIDER_META.source_family);

  const base = normalizePlaceCandidate({
    id: firstString(record.id, `${cityConfig.key}-ext-${index}`),
    city: cityConfig.key,
    label: name,
    type,
    // located → a real place we can route to; unlocated → a search-style result
    candidate_kind: hasCoords ? "real_place" : "map_result",
    lat: hasCoords ? record.lat : undefined,
    lng: hasCoords ? record.lng : undefined,
    area: firstString(record.area, record.neighborhood),
    tags: Array.isArray(record.tags) ? record.tags : [],
    time_fit: Array.isArray(record.time_fit) ? record.time_fit : [],
    route_roles: ["external_candidate"],
    source: {
      kind: "open_data",
      id: EXTERNAL_OPEN_PROVIDER_META.provider_id,
      label: firstString(sources[0]?.provider, "open data"),
      url: firstString(sources[0]?.url),
    },
    trust: {
      // NOT verified, NOT declared-high — the reducer derives real belief.
      source_tier: sourceTier,
      confidence: "needs_review",
      human_verified: false,
      freshness: firstString(record.freshness, "fresh"),
    },
    city_pack_owned: false,
  });

  // Spine extras (validatePlaceCandidate tolerates additional fields).
  base.evidence = evidence;
  base.candidate_origin = CANDIDATE_ORIGIN;
  base.provider_id = EXTERNAL_OPEN_PROVIDER_META.provider_id;
  base.source_family = primaryFamily;
  base.source_policy = EXTERNAL_OPEN_PROVIDER_META.source_policy;
  // Chain signal (#272): carried verbatim from the loader record (OSM brand tag,
  // never name matching). Composition may prefer non-chain options; chains stay
  // valid sparse fallbacks.
  base.chain = record.chain === true;
  base.brand = typeof record.brand === "string" && record.brand.trim() ? record.brand.trim() : null;
  const website = safeHttpUrl(record.website);
  if (website) base.website = website;
  const openingHours = normalizeOpeningHours(record.opening_hours);
  if (openingHours) base.opening_hours = openingHours;
  const operationalStatus = normalizeOperationalStatus(record.operational_status);
  if (operationalStatus) base.operational_status = operationalStatus;
  const operationalReasons = normalizeOperationalReasons(record.operational_reasons);
  if (operationalReasons.length) base.operational_reasons = operationalReasons;

  return validatePlaceCandidate(base, `externalOpenCandidate[${index}]`);
}

function normalizeOperationalStatus(value) {
  const token = firstString(value).toLowerCase();
  return ["inactive", "source_indicated_active", "unknown"].includes(token) ? token : "";
}

function normalizeOperationalReasons(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => firstString(value).toLowerCase())
      .filter((value) => /^[a-z0-9_:-]{1,80}$/.test(value)),
  )];
}

function safeHttpUrl(value) {
  const raw = firstString(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

function buildEvidence(record, sources, hasCoords, type, observedAt) {
  const evidence = [];

  for (const source of sources) {
    const family = normalizeFamily(source.family);
    const ref = {
      provider_id: firstString(source.provider, source.provider_id, "open-data"),
      source_family: family,
      source_tier: firstString(source.tier, "inferred"),
      url: firstString(source.url) || undefined,
      label: firstString(source.provider, source.label) || undefined,
    };
    const freshness = firstString(source.freshness, record.freshness, "fresh");

    evidence.push(
      createEvidence({ claim_type: "existence", value: true, ...ref, observed_at: observedAt, freshness }),
    );
    if (hasCoords) {
      evidence.push(
        createEvidence({
          claim_type: "location",
          value: { lat: record.lat, lng: record.lng },
          ...ref,
          observed_at: observedAt,
          freshness,
        }),
      );
    }
    evidence.push(
      createEvidence({ claim_type: "category", value: type, ...ref, observed_at: observedAt, freshness }),
    );
  }

  // Consensus is recorded as evidence but quarantined — banding + the reducer
  // make sure it confirms, never promotes.
  const popularity = record.popularity || record.consensus;
  if (popularity && typeof popularity === "object") {
    const ref = {
      provider_id: "map-consensus",
      source_family: "map",
      source_tier: "inferred",
      url: firstString(popularity.url) || undefined,
    };
    if (Number.isFinite(popularity.count)) {
      evidence.push(createEvidence({ claim_type: "popularity", value: popularity.count, ...ref, observed_at: observedAt }));
    }
    if (Number.isFinite(popularity.rating)) {
      evidence.push(createEvidence({ claim_type: "sentiment", value: popularity.rating, ...ref, observed_at: observedAt }));
    }
  }

  return evidence;
}

function normalizeFamily(family) {
  const value = firstString(family).toLowerCase();
  return SOURCE_FAMILIES.has(value) ? value : "map";
}

const TIER_RANK = { official: 5, verified: 4, curated: 3, computed: 2, editorial: 2, inferred: 1, fallback: 0 };
function strongestTier(sources) {
  let best = null;
  let bestRank = -1;
  for (const source of sources) {
    const tier = firstString(source.tier).toLowerCase();
    const rank = TIER_RANK[tier];
    if (rank !== undefined && rank > bestRank) {
      bestRank = rank;
      best = tier;
    }
  }
  return best;
}

function firstString(...values) {
  return values.map((value) => String(value === undefined || value === null ? "" : value).trim()).find(Boolean) || "";
}

module.exports = {
  EXTERNAL_OPEN_PROVIDER_META,
  CANDIDATE_ORIGIN,
  ExternalOpenCandidateProvider,
  createExternalOpenProvider,
  mapRecordToCandidate,
};
