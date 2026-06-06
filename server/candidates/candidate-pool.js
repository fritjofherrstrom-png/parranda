/**
 * Candidate Intelligence Spine — shared candidate pool.
 *
 * Extracts the intent-independent part of the candidate pipeline so Blitz and
 * future Planner helpers read from the same spine instead of cloning loops:
 * providers -> entity resolution -> evidence/reducer -> gates.
 */

const {
  collectPlaceCandidatesForCity,
  DEFAULT_PROVIDER_SPECS,
} = require("../place-candidates/provider-registry");
const { deriveEvidenceFromPlaceCandidate } = require("./evidence");
const { reduceEvidence } = require("./evidence-reducer");
const { evaluateCandidateGates, targetFromPlaceCandidate } = require("./gates");
const { confidenceRank } = require("./confidence");
const { normalizeUserIntents } = require("./intent-vocabulary");
const { classifyCatalogDensity } = require("./source-calibration");
const { resolveCandidateIdentity } = require("./entity-resolution");
const { normalizeLens } = require("./lens");

// Curated/verified Parranda candidates keep priority when fit is comparable.
const CURATED_SOURCE_PRIORITY = 100;

const OPEN_SOURCE_TOKENS = new Set(["open", "external", "open_data", "open-data", "osm", "wikidata"]);
const TRUTHY_FLAGS = new Set([true, 1, "1", "on", "yes", "true"]);

function isExternalCandidatesEnabled(payload = {}) {
  if (
    TRUTHY_FLAGS.has(payload.include_external_candidates) ||
    TRUTHY_FLAGS.has(payload.includeExternalCandidates)
  ) {
    return true;
  }
  const sources = payload.candidate_sources ?? payload.candidateSources;
  const list = Array.isArray(sources) ? sources : String(sources || "").split(/[,\s]+/);
  return list.map((token) => String(token).toLowerCase().trim()).some((token) => OPEN_SOURCE_TOKENS.has(token));
}

function buildEligibleCandidatePool(cityConfig, payload = {}, helpers = {}) {
  const nowContext = helpers.resolveNowContext
    ? helpers.resolveNowContext(cityConfig, payload)
    : fallbackNowContext(cityConfig, payload);
  const timeBand = helpers.resolveTimeBand
    ? helpers.resolveTimeBand(nowContext.hour)
    : fallbackTimeBand(nowContext.hour);
  const prefs = helpers.resolveBlitzPreferences
    ? helpers.resolveBlitzPreferences(payload)
    : { intent_keys: payload.intent_keys || [], preferences: payload.preferences || [] };

  const normalized = normalizeUserIntents([...(prefs.preferences || []), ...(prefs.intent_keys || [])]);
  const origin = resolveOriginCoords(payload.origin || payload.start || payload.anchor);
  const weather = payload.weather && typeof payload.weather === "object" ? payload.weather : null;
  const lens = normalizeLens(payload.lens);
  const context = {
    date: nowContext.date,
    now_iso: nowContext.now_iso,
    weekday: nowContext.weekday,
    timeBand,
    weather,
    origin,
    lens,
    preferences: prefs.preferences || [],
    intent_keys: prefs.intent_keys || [],
  };

  const externalEnabled = isExternalCandidatesEnabled(payload);
  const providerSpecs = buildProviderSpecs({
    externalEnabled,
    externalOptions: helpers.external_provider || null,
    now: nowContext.date,
  });
  const collection = collectPlaceCandidatesForCity(cityConfig, { providerSpecs });
  const collected = Array.isArray(collection.candidates) ? collection.candidates : [];
  const identity = resolveCandidateIdentity(collected, { now: nowContext.date });
  const allCandidates = Array.isArray(identity.candidates) ? identity.candidates : [];

  // Density is intentionally curated-only. External/open candidates can fill
  // gaps, but must never make a city look like a rich citypack.
  const curatedRealPlaceCount = allCandidates.filter(
    (candidate) => candidate.city_pack_owned === true && candidate.is_structural !== true,
  ).length;
  const density = classifyCatalogDensity(curatedRealPlaceCount);

  const pool = [];
  const rejected = [];
  for (const candidate of allCandidates) {
    const { eligible, derived, gates, evidence } = evaluateCandidateEligibility(candidate, {
      now: nowContext.date,
    });
    if (!eligible) {
      rejected.push({
        id: candidate.id,
        label: candidate.label,
        origin: candidateOrigin(candidate),
        reason: primaryRejectionReason(gates),
      });
      continue;
    }
    pool.push({ candidate, derived, gates, evidence });
  }

  return {
    pool,
    density,
    identity,
    rejected,
    context,
    providerSpecs,
    normalized,
    allCandidates,
    externalEnabled,
  };
}

function evaluateCandidateEligibility(candidate, { now = null } = {}) {
  const evidence =
    Array.isArray(candidate.evidence) && candidate.evidence.length
      ? candidate.evidence
      : deriveEvidenceFromPlaceCandidate(candidate, { observed_at: now });
  const derived = reduceEvidence(evidence, { now });
  const gates = evaluateCandidateGates({ target: targetFromPlaceCandidate(candidate), derived });
  return { eligible: gates.may_show_as_nearby === true, derived, gates, evidence };
}

function rankEligible(eligible) {
  return [...eligible].sort((a, b) => {
    const cov = b.fit.coverage_rank[0] - a.fit.coverage_rank[0];
    if (cov) return cov;
    const part = b.fit.coverage_rank[1] - a.fit.coverage_rank[1];
    if (part) return part;
    const score = b.fit.primary_score - a.fit.primary_score;
    if (Math.abs(score) > 1e-9) return score;
    const sp = sourcePriority(b) - sourcePriority(a);
    if (Math.abs(sp) > 1e-9) return sp;
    return String(a.candidate.id).localeCompare(String(b.candidate.id));
  });
}

function sourcePriority(entry) {
  if (entry.candidate.city_pack_owned === true) {
    return CURATED_SOURCE_PRIORITY;
  }
  const existence = confidenceRank(entry.derived?.existence_confidence);
  const influence = entry.calibration?.influence || 0;
  return existence + influence;
}

function buildProviderSpecs({ externalEnabled, externalOptions, now }) {
  const specs = [...DEFAULT_PROVIDER_SPECS];
  if (!externalEnabled) {
    return specs;
  }
  const {
    createExternalOpenProvider,
    EXTERNAL_OPEN_PROVIDER_META,
  } = require("../place-candidates/external-open-provider");

  const providerOptions = sanitizeExternalOptions(externalOptions, now);

  specs.push({
    id: EXTERNAL_OPEN_PROVIDER_META.provider_id,
    provider_id: EXTERNAL_OPEN_PROVIDER_META.provider_id,
    source_family: EXTERNAL_OPEN_PROVIDER_META.source_family,
    source_tier: EXTERNAL_OPEN_PROVIDER_META.source_tier,
    source_policy: EXTERNAL_OPEN_PROVIDER_META.source_policy,
    create: (city) => createExternalOpenProvider(city, providerOptions),
  });
  return specs;
}

function sanitizeExternalOptions(externalOptions, now) {
  if (!externalOptions || typeof externalOptions !== "object") {
    return { observedAt: now };
  }
  const out = { observedAt: now };
  if (Array.isArray(externalOptions.dataset) || typeof externalOptions.dataset === "function") {
    out.dataset = externalOptions.dataset;
  }
  if (externalOptions.useBundledFixtures === true) {
    out.useBundledFixtures = true;
  }
  return out;
}

function candidateOrigin(candidate) {
  if (candidate.candidate_origin) return candidate.candidate_origin;
  return candidate.city_pack_owned ? "curated_catalog" : "external_open";
}

function candidateProvenance(candidate, derived) {
  const curated = candidate.city_pack_owned === true;
  return {
    provider_id: candidate.provider_id || (curated ? "curated-catalog" : null),
    source_family: candidate.source_family || (curated ? "catalog" : null),
    source_tier: candidate.trust?.source_tier || null,
    source_policy: candidate.source_policy || (curated ? "parranda_curated" : null),
    human_verified: candidate.trust?.human_verified === true,
    existence_confidence: derived?.existence_confidence || null,
    provenance_diversity: derived?.provenance_diversity ?? null,
    attribution: buildAttribution(candidate),
    corroborated_by_external: Array.isArray(candidate.merged_from) && candidate.merged_from.length > 0,
    merged_from: Array.isArray(candidate.merged_from) ? candidate.merged_from : [],
    reconciliation: candidate.reconciliation || null,
  };
}

function buildAttribution(candidate) {
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
  const byProvider = new Map();
  for (const item of evidence) {
    const ref = item.source_ref || {};
    const key = ref.provider_id || ref.label;
    if (!key || byProvider.has(key)) continue;
    byProvider.set(key, {
      provider_id: ref.provider_id || null,
      label: ref.label || ref.provider_id || null,
      source_family: ref.source_family || null,
      url: ref.url || null,
    });
  }
  return [...byProvider.values()];
}

function matchTier(intentMatch, slot) {
  if (intentMatch === "covered") return "primary";
  if (intentMatch === "partial") return "supporting";
  if (intentMatch === "general") return slot === "best" ? "primary" : "supporting";
  return "fallback";
}

function primaryRejectionReason(gates) {
  if (gates.reasons.includes("structural_route_only")) return "structural_route_only";
  if (gates.reasons.includes("context_not_a_place")) return "context_not_a_place";
  if (gates.reasons.includes("no_reliable_place_target")) return "no_reliable_place_target";
  if (!gates.may_show) return "below_show_threshold";
  return "not_nearby_eligible";
}

function resolveOriginCoords(origin) {
  if (!origin || typeof origin !== "object") return null;
  if (Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
    return { lat: origin.lat, lng: origin.lng, label: origin.label || null };
  }
  return null;
}

function fallbackNowContext(cityConfig, payload) {
  const date = String(payload.date || cityConfig.todayIsoDate() || "").trim() || cityConfig.todayIsoDate();
  let hour = 13;
  if (payload.now) {
    const d = new Date(payload.now);
    if (!Number.isNaN(d.getTime())) hour = d.getUTCHours();
  }
  if (Number.isFinite(payload.hour)) hour = payload.hour;
  return { date, hour, weekday: null, now_iso: payload.now || `${date}T13:00:00` };
}

// Single source of truth for hour → time band. Exported so other trusted time
// paths (e.g. the agnostic route context) use the SAME semantics the candidate
// pool already scores against, instead of duplicating divergent logic.
function resolveTimeBandFromHour(hour) {
  if (hour >= 6 && hour < 11) return "morning";
  if (hour >= 11 && hour < 15) return "midday";
  if (hour >= 15 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "late";
}

function fallbackTimeBand(hour) {
  return resolveTimeBandFromHour(hour);
}

module.exports = {
  CURATED_SOURCE_PRIORITY,
  buildEligibleCandidatePool,
  buildProviderSpecs,
  candidateOrigin,
  candidateProvenance,
  evaluateCandidateEligibility,
  isExternalCandidatesEnabled,
  matchTier,
  rankEligible,
  resolveTimeBandFromHour,
  sourcePriority,
};
