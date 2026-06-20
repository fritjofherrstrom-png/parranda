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

const { scoreCandidateFit } = require("./fit-scorer");
const { calibrateSource } = require("./source-calibration");
const { resolveAgnosticConfidence } = require("./agnostic-context");
const {
  buildEligibleCandidatePool,
  candidateOrigin,
  candidateProvenance,
  evaluateCandidateEligibility,
  isExternalCandidatesEnabled,
  matchTier,
  rankEligible,
} = require("./candidate-pool");

const TRUTHY_FLAGS = new Set([true, 1, "1", "on", "yes", "true"]);

function isCandidateBlitzModeEnabled(payload = {}) {
  return TRUTHY_FLAGS.has(payload.candidate_mode) || TRUTHY_FLAGS.has(payload.candidateMode);
}

/**
 * @param {object} cityConfig
 * @param {object} payload  same shape as buildBlitzDecision's payload, plus:
 *   - candidate_mode (flag), preferences[], intent_keys[], origin, now, date,
 *     weather, lens
 * @param {object} [helpers] injectable { resolveNowContext, resolveTimeBand,
 *   resolveBlitzPreferences } — supplied by blitz-engine to avoid duplication.
 */
// Shared decision substrate: collect → gate → fit-score → calibrate → rank the
// candidate pool, returning the ranked eligible entries (intent coverage → fit →
// source priority; curated dominates the tiebreak, source-backed wins on better
// fit). Exported so the editorial Blitz path can use the SAME ranking as its
// decision for preview/thin/agnostic contexts, then render the winners through
// its own presentation layer — without duplicating the ranking logic.
function rankCandidatesForBlitz(cityConfig, payload = {}, helpers = {}) {
  const candidatePool = buildEligibleCandidatePool(cityConfig, payload, helpers);
  const { context, density, normalized, pool } = candidatePool;

  const eligible = [];
  for (const { candidate, derived, gates } of pool) {
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
      lens: context.lens,
      density,
      diversity: derived.provenance_diversity,
      freshness: derived.freshness,
    });
    eligible.push({ candidate, derived, gates, fit, calibration });
  }

  return { ranked: rankEligible(eligible), candidatePool };
}

function buildCandidateBlitzDecision(cityConfig, payload = {}, helpers = {}) {
  const { ranked, candidatePool } = rankCandidatesForBlitz(cityConfig, payload, helpers);
  const {
    allCandidates,
    context,
    density,
    externalEnabled,
    identity,
    normalized,
    providerSpecs,
    rejected,
  } = candidatePool;

  const base = {
    city: cityConfig.key,
    experimental: true,
    candidate_mode: true,
    engine: "candidate-spine-blitz-v1",
    context: {
      date: context.date,
      now: context.now_iso,
      weekday: context.weekday,
      time_band: context.timeBand,
      origin: context.origin || null,
      preferences: context.preferences,
      intent_keys: context.intent_keys,
      normalized_intents: normalized.intents,
      requested_modifiers: normalized.modifiers,
      unmapped_preferences: normalized.unmapped,
      external_candidates_enabled: externalEnabled,
      candidate_providers: providerSpecs.map((spec) => spec.id),
      catalog_density: density,
      agnostic: cityConfig.agnostic === true || density !== "rich",
      lens: context.lens,
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

module.exports = {
  isCandidateBlitzModeEnabled,
  isExternalCandidatesEnabled,
  buildCandidateBlitzDecision,
  rankCandidatesForBlitz,
  evaluateCandidateEligibility,
};
