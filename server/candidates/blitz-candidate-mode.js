/**
 * Candidate Intelligence Spine — experimental Blitz candidate path.
 *
 * The FIRST surface where the spine moves from inspect/debug into a real
 * decision: a candidate-based "next move". It is strictly opt-in (behind an
 * explicit flag) and never runs unless enabled, so default Blitz stays
 * byte-stable.
 *
 * Pipeline:
 *   collect candidates (curated catalog + optional external/open provider,
 *     opt-in via include_external_candidates — see #234)
 *     → derive evidence (bridge) → reduce → gates
 *     → keep only candidates eligible as a user-facing nearby/now move
 *       (this is where structural / context / weak / popularity-only candidates
 *        are dropped — gates, not the scorer, enforce that)
 *     → score fit (intent primary; context bounded)
 *     → calibrate source influence (#235; bounded, no consensus input)
 *     → rank lexicographically: intent coverage → fit → source priority
 *       (curated dominates the tiebreak; source-backed ordered by existence +
 *        context-calibrated influence)
 *     → pick best + backup, or emit an HONEST fallback (never hallucinate)
 *
 * Promotes the existing spine — no fourth pipeline. External providers/
 * fixtures stay strictly opt-in and fail closed without a trusted loader.
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
const { scoreCandidateFit } = require("./fit-scorer");
const { classifyCatalogDensity, calibrateSource } = require("./source-calibration");
const { resolveAgnosticConfidence } = require("./agnostic-context");
const { resolveCandidateIdentity } = require("./entity-resolution");

// Curated/verified Parranda candidates keep priority when fit is comparable.
// They get a flat priority that dominates any source-calibration influence, so
// calibration only ever reorders the SOURCE-BACKED set among itself.
const CURATED_SOURCE_PRIORITY = 100;

const TRUTHY_FLAGS = new Set([true, 1, "1", "on", "yes", "true"]);
const OPEN_SOURCE_TOKENS = new Set(["open", "external", "open_data", "open-data", "osm", "wikidata"]);

function isCandidateBlitzModeEnabled(payload = {}) {
  return TRUTHY_FLAGS.has(payload.candidate_mode) || TRUTHY_FLAGS.has(payload.candidateMode);
}

/**
 * External candidates are a SECOND opt-in, nested under candidate_mode. Enabled
 * by include_external_candidates=1 or candidate_sources=open (csv/array). When
 * off, the external provider module is never even require()'d (see
 * buildProviderSpecs) — catalog-only and default Blitz cannot load it.
 */
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

/**
 * @param {object} cityConfig
 * @param {object} payload  same shape as buildBlitzDecision's payload, plus:
 *   - candidate_mode (flag), preferences[], intent_keys[], origin, now, date,
 *     weather, lens
 * @param {object} [helpers] injectable { resolveNowContext, resolveTimeBand,
 *   resolveBlitzPreferences } — supplied by blitz-engine to avoid duplication.
 */
function buildCandidateBlitzDecision(cityConfig, payload = {}, helpers = {}) {
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
  const origin = resolveOriginCoords(payload.origin || payload.start);
  const weather = payload.weather && typeof payload.weather === "object" ? payload.weather : null;
  const lens = typeof payload.lens === "string" ? payload.lens : null;
  const context = { timeBand, weekday: nowContext.weekday, weather, origin, lens };

  const externalEnabled = isExternalCandidatesEnabled(payload);
  // The candidate engine never accepts a dataset/loader from the public
  // payload — that would let `/api/blitz` callers inject arbitrary candidates.
  // Test/dev callers pass external_provider injection through the THIRD
  // `helpers` argument (not the payload). Public HTTP cannot reach it.
  const providerSpecs = buildProviderSpecs({
    externalEnabled,
    externalOptions: helpers.external_provider || null,
    now: nowContext.date,
  });
  const collection = collectPlaceCandidatesForCity(cityConfig, { providerSpecs });
  const collected = Array.isArray(collection.candidates) ? collection.candidates : [];

  // Entity safety (#238): resolve identity BEFORE gates/fit so the same real
  // place arriving as both curated + external becomes ONE canonical candidate.
  // A confident curated↔external match enriches the curated candidate with the
  // external evidence/attribution and suppresses the external duplicate;
  // ambiguous matches stay separate. This is a no-op when nothing matches, so
  // catalog-only and city candidate_mode output is unchanged.
  const identity = resolveCandidateIdentity(collected, { now: nowContext.date });
  const allCandidates = identity.candidates;

  // How much CURATED ground-truth this area has (external candidates must not
  // inflate it — an area we have not curated is honestly "absent" even when open
  // sources supply candidates). Drives source calibration and honest confidence.
  const curatedRealPlaceCount = allCandidates.filter(
    (candidate) => candidate.city_pack_owned === true && candidate.is_structural !== true,
  ).length;
  const density = classifyCatalogDensity(curatedRealPlaceCount);

  const eligible = [];
  const rejected = [];
  for (const candidate of allCandidates) {
    const { eligible: isEligible, derived, gates } = evaluateCandidateEligibility(candidate, {
      now: nowContext.date,
    });

    // A next move must be a user-facing nearby place. Gates already exclude
    // structural / context / weak / popularity-only-and-uncorroborated here.
    if (!isEligible) {
      rejected.push({
        id: candidate.id,
        label: candidate.label,
        origin: candidateOrigin(candidate),
        reason: primaryRejectionReason(gates, candidate),
      });
      continue;
    }

    const fit = scoreCandidateFit({
      candidate,
      userIntents: normalized.intents,
      userModifiers: normalized.modifiers,
      context,
    });
    // Source calibration: how much this source family's influence should count
    // in THIS context. Curated candidates are calibrated too (for inspect), but
    // the ranker gives them a flat dominant priority regardless.
    const calibration = calibrateSource({
      family: candidate.source_family || (candidate.city_pack_owned ? "catalog" : "map"),
      tier: candidate.trust?.source_tier,
      intents: normalized.intents,
      lens,
      density,
      diversity: derived.provenance_diversity,
      freshness: derived.freshness,
    });
    eligible.push({ candidate, derived, gates, fit, calibration });
  }

  const ranked = rankEligible(eligible);

  const base = {
    city: cityConfig.key,
    experimental: true,
    candidate_mode: true,
    engine: "candidate-spine-blitz-v1",
    context: {
      date: nowContext.date,
      now: nowContext.now_iso,
      weekday: nowContext.weekday,
      time_band: timeBand,
      origin: origin || null,
      preferences: prefs.preferences,
      intent_keys: prefs.intent_keys,
      normalized_intents: normalized.intents,
      requested_modifiers: normalized.modifiers,
      unmapped_preferences: normalized.unmapped,
      external_candidates_enabled: externalEnabled,
      candidate_providers: providerSpecs.map((spec) => spec.id),
      catalog_density: density,
      agnostic: cityConfig.agnostic === true || density !== "rich",
      lens,
    },
    reroll_supported: false,
  };

  // --- Honest fallbacks ------------------------------------------------------
  if (!allCandidates.length) {
    return { ...base, best_move: null, backup_option: null, confidence: resolveAgnosticConfidence({ best: null, density }), inspect: emptyInspect("no_candidates", normalized, rejected, [], externalEnabled, density, identity), reason: "no_candidates" };
  }
  if (!ranked.length) {
    return { ...base, best_move: null, backup_option: null, confidence: resolveAgnosticConfidence({ best: null, density }), inspect: emptyInspect("no_eligible_candidates", normalized, rejected, [], externalEnabled, density, identity), reason: "no_eligible_candidates" };
  }

  const best = ranked[0];
  const backup = ranked[1] || null;
  const noPreferenceMatch =
    normalized.intents.length > 0 && best.fit.intent_match === "none";

  return {
    ...base,
    best_move: formatMove(best, "best"),
    backup_option: backup ? formatMove(backup, "backup") : null,
    // Honest confidence — a source-backed or thin-city move never claims full
    // citypack confidence.
    confidence: resolveAgnosticConfidence({ best, density }),
    reason: noPreferenceMatch ? "no_preference_match_offering_general" : "ok",
    inspect: buildInspect({ normalized, ranked, rejected, best, context, externalEnabled, density, identity }),
  };
}

/**
 * Build the provider spec list. Curated catalog is always present. The external
 * open provider is added — and its module require()'d — ONLY when external
 * candidates are explicitly enabled, so catalog-only and default Blitz paths
 * never load external code.
 *
 * The external provider FAILS CLOSED at runtime: without an injected
 * dataset/loader OR an explicit useBundledFixtures opt-in, it returns []. This
 * stops fixtures from masquerading as runtime open data on a normal
 * `candidate_sources=open` HTTP call. Test/dev injection arrives through the
 * trusted `helpers.external_provider` channel (NOT the public payload).
 */
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
  // Only honour these explicitly-named injection seams. Anything else on the
  // object is ignored, so future fields cannot leak from the payload by
  // accident.
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

/**
 * Decide whether a candidate is eligible to be a user-facing next move, using
 * the spine: evidence → reduce → gates. Prefers a candidate's own attached
 * evidence ledger when present (forward hook for future external/source-backed
 * candidates), otherwise derives evidence from its trust block.
 *
 * Exported so the eligibility boundary can be tested directly with synthetic
 * candidates (e.g. a popularity-only candidate must NOT be eligible).
 */
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
    // 1. covered intents (lexicographic primacy — context can never override)
    const cov = b.fit.coverage_rank[0] - a.fit.coverage_rank[0];
    if (cov) return cov;
    // 2. partial intents
    const part = b.fit.coverage_rank[1] - a.fit.coverage_rank[1];
    if (part) return part;
    // 3. fit score (intent base + bounded context)
    const score = b.fit.primary_score - a.fit.primary_score;
    if (Math.abs(score) > 1e-9) return score;
    // 4. source priority: curated dominates (priority preserved when fit is
    //    comparable); source-backed candidates are ordered by existence +
    //    context-calibrated source influence. Consensus never enters here.
    const sp = sourcePriority(b) - sourcePriority(a);
    if (Math.abs(sp) > 1e-9) return sp;
    // 5. stable
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

function formatMove(entry, slot) {
  const { candidate, gates, fit, derived, calibration } = entry;
  return {
    candidate_id: candidate.id,
    label: candidate.label,
    type: candidate.type,
    candidate_kind: candidate.candidate_kind,
    lat: candidate.lat ?? null,
    lng: candidate.lng ?? null,
    origin: candidateOrigin(candidate),
    provenance: candidateProvenance(candidate, derived),
    calibration: calibration
      ? { level: calibration.level, influence: calibration.influence, reasons: calibration.reasons }
      : null,
    match_tier: matchTier(fit.intent_match, slot),
    fit_score: fit.primary_score,
    intent_base: fit.intent_base,
    context_total: fit.context_total,
    covered_preferences: fit.covered_preferences,
    partial_preferences: fit.partial_preferences,
    missing_preferences: fit.missing_preferences,
    gates_passed: Object.keys(gates).filter((k) => gates[k] === true),
    fit_reasons: fit.reasons,
    dimensions: fit.dimensions,
  };
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
    // Minimal attribution seam — enough for a UI to render "Source: OSM,
    // Wikidata" without leaking the raw evidence ledger. Open-data sources
    // typically require visible attribution. After an entity-safety merge this
    // includes the absorbed external source(s).
    attribution: buildAttribution(candidate),
    // Entity safety (#238): when an external duplicate was merged into this
    // candidate, show where the corroboration came from. Empty/absent otherwise.
    corroborated_by_external: Array.isArray(candidate.merged_from) && candidate.merged_from.length > 0,
    merged_from: Array.isArray(candidate.merged_from) ? candidate.merged_from : [],
    // Field reconciliation (#239): which safe fields were filled from a merged
    // external twin, plus any kept-curated coordinate conflicts. Null when none.
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
  return "fallback"; // intent_match === "none"
}

function buildInspect({ normalized, ranked, rejected, best, context, externalEnabled, density, identity }) {
  return {
    requested_intents: normalized.intents,
    requested_modifiers: normalized.modifiers,
    unmapped_preferences: normalized.unmapped,
    external_candidates_enabled: externalEnabled,
    catalog_density: density,
    entity_resolution: identitySummary(identity),
    eligible_count: ranked.length,
    rejected_count: rejected.length,
    by_origin: countByOrigin(ranked, rejected),
    selected: {
      candidate_id: best.candidate.id,
      label: best.candidate.label,
      origin: candidateOrigin(best.candidate),
      match_tier: matchTier(best.fit.intent_match, "best"),
      gates_passed: Object.keys(best.gates).filter((k) => best.gates[k] === true),
      covered_preferences: best.fit.covered_preferences,
      missing_preferences: best.fit.missing_preferences,
      partial_preferences: best.fit.partial_preferences,
      fit_reasons: best.fit.reasons,
      existence_confidence: best.derived.existence_confidence,
      provenance_diversity: best.derived.provenance_diversity,
      calibration: best.calibration || null,
      corroborated_by_external: Array.isArray(best.candidate.merged_from) && best.candidate.merged_from.length > 0,
    },
    ranked_sample: ranked.slice(0, 5).map((e) => ({
      id: e.candidate.id,
      label: e.candidate.label,
      type: e.candidate.type,
      origin: candidateOrigin(e.candidate),
      intent_match: e.fit.intent_match,
      fit_score: e.fit.primary_score,
      source_influence: e.calibration ? e.calibration.influence : null,
    })),
    rejected_sample: rejected.slice(0, 5),
    context_applied: { time_band: context.timeBand, weather: Boolean(context.weather), origin: Boolean(context.origin), lens: context.lens || "neutral" },
    bypass: {
      default_blitz_bypassed: true,
      reason: "experimental candidate_mode enabled",
    },
  };
}

function emptyInspect(reason, normalized, rejected, ranked, externalEnabled, density, identity) {
  return {
    requested_intents: normalized.intents,
    requested_modifiers: normalized.modifiers,
    unmapped_preferences: normalized.unmapped,
    external_candidates_enabled: Boolean(externalEnabled),
    catalog_density: density || "rich",
    entity_resolution: identitySummary(identity),
    eligible_count: ranked.length,
    rejected_count: rejected.length,
    by_origin: countByOrigin(ranked, rejected),
    rejected_sample: rejected.slice(0, 5),
    reason,
    bypass: { default_blitz_bypassed: true, reason: "experimental candidate_mode enabled" },
  };
}

function identitySummary(identity) {
  if (!identity || typeof identity !== "object") {
    return { merged_count: 0, ambiguous_kept_separate: 0, merges: [] };
  }
  return {
    ...(identity.summary || { merged_count: 0, ambiguous_kept_separate: 0 }),
    merges: Array.isArray(identity.merges) ? identity.merges.slice(0, 8) : [],
  };
}

function countByOrigin(ranked, rejected) {
  const tally = { eligible: {}, rejected: {} };
  for (const entry of ranked) {
    const origin = candidateOrigin(entry.candidate);
    tally.eligible[origin] = (tally.eligible[origin] || 0) + 1;
  }
  for (const entry of rejected) {
    const origin = entry.origin || "unknown";
    tally.rejected[origin] = (tally.rejected[origin] || 0) + 1;
  }
  return tally;
}

function primaryRejectionReason(gates, candidate) {
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

// --- Minimal fallbacks if blitz-engine helpers are not injected -------------
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

function fallbackTimeBand(hour) {
  if (hour >= 6 && hour < 11) return "morning";
  if (hour >= 11 && hour < 15) return "midday";
  if (hour >= 15 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "late";
}

module.exports = {
  isCandidateBlitzModeEnabled,
  isExternalCandidatesEnabled,
  buildCandidateBlitzDecision,
  evaluateCandidateEligibility,
};
