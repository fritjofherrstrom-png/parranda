/**
 * Candidate Intelligence Spine — Evidence item model.
 *
 * An Evidence item is a CLAIM made by a source about a candidate. It is raw
 * material, never a final truth. Parranda's belief about a candidate is DERIVED
 * from a candidate's evidence by the reducer (evidence-reducer.js); providers
 * must not hand-declare confidence.
 *
 * Shape (see docs/CANDIDATE_INTELLIGENCE_MIGRATION.md):
 *   {
 *     claim_type,                  // existence | location | name | category | ...
 *     value,                       // the asserted value (true, a string, a number)
 *     source_ref: {
 *       provider_id,
 *       source_family,             // catalog | official | map | community | ...
 *       source_tier,               // official | verified | curated | ... (provenance)
 *       url?, label?
 *     },
 *     observed_at,                 // ISO date/timestamp string or null
 *     freshness,                   // live | fresh | stale | unknown
 *     weight                       // 0..1 — the source's own reliability for THIS claim
 *   }
 *
 * Pure / side-effect free.
 */

const { normalizeFreshness } = require("./confidence");

const CLAIM_TYPES = new Set([
  "existence",
  "location",
  "name",
  "category",
  "hours",
  "popularity",
  "sentiment",
  "vibe",
  "price",
  "live_timing",
]);

// Source FAMILIES are coarse, independent provenance buckets. Provenance
// diversity (how many distinct families corroborate) is the promotion currency
// for the gates — NOT raw volume from a single family.
const SOURCE_FAMILIES = new Set([
  "catalog", // Parranda's own curated catalog
  "official", // official open data / APIs / city sources
  "map", // map/search public geodata (OSM and similar)
  "open_knowledge", // linked open knowledge graphs (Wikidata/Wikipedia) — NOT
  // community/social. Kept distinct so it adds provenance diversity without
  // inheriting community/local lens calibration. See source-calibration.js.
  "community", // blogs, community pages, social
  "editorial", // editorial / local guides
  "live", // live event feeds
  "computed", // derived/computed signals
  "environmental", // weather / air quality / transport context
]);

// Claim types that assert the candidate is a real, locatable place. Provenance
// diversity and existence confidence are computed over these.
const EXISTENCE_CLAIM_TYPES = new Set(["existence", "location", "name"]);

function normalizeEvidenceItem(item, label = "evidence") {
  assertPlainObject(item, label);

  const claimType = compact(item.claim_type || item.claimType);
  if (!CLAIM_TYPES.has(claimType)) {
    throw new Error(`${label}.claim_type has unsupported value ${claimType || "(empty)"}`);
  }

  if (item.value === undefined || item.value === null || item.value === "") {
    throw new Error(`${label}.value is required`);
  }

  const sourceRef = normalizeSourceRef(item.source_ref || item.sourceRef, `${label}.source_ref`);
  const observedAt = compact(item.observed_at || item.observedAt) || null;
  const freshness = normalizeFreshness(item.freshness);
  const weight = normalizeWeight(item.weight);

  return {
    claim_type: claimType,
    value: item.value,
    source_ref: sourceRef,
    observed_at: observedAt,
    freshness,
    weight,
  };
}

function normalizeSourceRef(sourceRef, label) {
  assertPlainObject(sourceRef, label);
  const providerId = compact(sourceRef.provider_id || sourceRef.providerId);
  if (!providerId) {
    throw new Error(`${label}.provider_id must be a non-empty string`);
  }

  const family = compact(sourceRef.source_family || sourceRef.sourceFamily);
  if (!SOURCE_FAMILIES.has(family)) {
    throw new Error(`${label}.source_family has unsupported value ${family || "(empty)"}`);
  }

  const tier = compact(sourceRef.source_tier || sourceRef.sourceTier) || "inferred";

  const normalized = {
    provider_id: providerId,
    source_family: family,
    source_tier: tier,
  };

  const url = compact(sourceRef.url);
  const labelText = compact(sourceRef.label);
  if (url) normalized.url = url;
  if (labelText) normalized.label = labelText;

  return normalized;
}

function normalizeWeight(weight) {
  if (weight === undefined || weight === null || weight === "") return 1;
  const value = Number(weight);
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function createEvidence({
  claim_type,
  value,
  provider_id,
  source_family,
  source_tier = "inferred",
  url,
  label,
  observed_at = null,
  freshness = "unknown",
  weight = 1,
} = {}) {
  return normalizeEvidenceItem({
    claim_type,
    value,
    source_ref: { provider_id, source_family, source_tier, url, label },
    observed_at,
    freshness,
    weight,
  });
}

function normalizeEvidenceList(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence.map((item, index) => normalizeEvidenceItem(item, `evidence[${index}]`));
}

/**
 * Bridge: derive a v1 evidence ledger from an EXISTING normalized place
 * candidate (place-candidates/contract.js). This lets the spine operate on
 * real candidates today, before any external evidence provider exists, by
 * translating the candidate's single-source trust block into explicit claims.
 *
 * A curated catalog item becomes a small set of catalog-family claims; a live
 * event venue becomes live-family claims; etc. No data is invented — we only
 * re-express what the candidate already asserts, with provenance attached.
 *
 * @param {object} candidate  A normalized place candidate.
 * @param {object} [opts]
 * @param {string|null} [opts.observed_at]  Reference observation time (ISO).
 * @returns {Array} Evidence[]
 */
function deriveEvidenceFromPlaceCandidate(candidate, { observed_at = null } = {}) {
  if (!candidate || typeof candidate !== "object") return [];

  const trust = candidate.trust || {};
  const source = candidate.source || {};
  const sourceTier = compact(trust.source_tier) || "inferred";
  const freshness = trust.freshness || candidate.freshness || "unknown";
  const family = sourceFamilyFromCandidate(candidate);
  const providerId =
    compact(source.id) || compact(source.kind) || `${compact(candidate.city) || "city"}-candidate`;
  const url = compact(source.url) || undefined;
  const sourceLabel = compact(source.label) || undefined;

  const sourceRef = {
    provider_id: providerId,
    source_family: family,
    source_tier: sourceTier,
    url,
    label: sourceLabel,
  };

  // Human-verified curated entries carry full existence weight; everything else
  // is weighted by its tier so unverified candidates stay appropriately soft.
  const existenceWeight = trust.human_verified === true ? 1 : tierWeight(sourceTier);

  const evidence = [
    createEvidence({
      claim_type: "existence",
      value: true,
      ...sourceRef,
      observed_at,
      freshness,
      weight: existenceWeight,
    }),
  ];

  if (Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)) {
    evidence.push(
      createEvidence({
        claim_type: "location",
        value: { lat: candidate.lat, lng: candidate.lng },
        ...sourceRef,
        observed_at,
        freshness,
        weight: existenceWeight,
      }),
    );
  }

  const category = compact(candidate.type);
  if (category) {
    evidence.push(
      createEvidence({
        claim_type: "category",
        value: category,
        ...sourceRef,
        observed_at,
        freshness,
        weight: existenceWeight,
      }),
    );
  }

  return evidence;
}

function sourceFamilyFromCandidate(candidate) {
  const kind = compact(candidate.source?.kind).toLowerCase();
  if (candidate.city_pack_owned === true || kind === "city_catalog") return "catalog";
  if (/live|event|feed/.test(kind)) return "live";
  if (/weather|computed/.test(kind)) return "computed";
  if (/official|open[_-]?data/.test(kind)) return "official";
  if (/editorial|guide/.test(kind)) return "editorial";
  if (/map|search/.test(kind)) return "map";
  // Fall back by tier so a bare candidate still lands in a sane family.
  const tier = compact(candidate.trust?.source_tier).toLowerCase();
  if (tier === "official" || tier === "verified") return "official";
  if (tier === "editorial") return "editorial";
  if (tier === "curated") return "catalog";
  return "community";
}

function tierWeight(tier) {
  switch (compact(tier).toLowerCase()) {
    case "official":
    case "verified":
    case "curated":
      return 0.9;
    case "computed":
    case "editorial":
      return 0.6;
    case "inferred":
      return 0.4;
    default:
      return 0.3;
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function compact(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  CLAIM_TYPES,
  SOURCE_FAMILIES,
  EXISTENCE_CLAIM_TYPES,
  normalizeEvidenceItem,
  normalizeEvidenceList,
  createEvidence,
  deriveEvidenceFromPlaceCandidate,
  sourceFamilyFromCandidate,
};
