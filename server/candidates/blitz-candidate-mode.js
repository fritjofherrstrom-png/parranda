/**
 * Candidate Intelligence Spine — experimental Blitz candidate path.
 *
 * The FIRST surface where the spine moves from inspect/debug into a real
 * decision: a candidate-based "next move". It is strictly opt-in (behind an
 * explicit flag) and never runs unless enabled, so default Blitz stays
 * byte-stable.
 *
 * Pipeline:
 *   collect existing place candidates
 *     → derive evidence (bridge) → reduce → gates
 *     → keep only candidates eligible as a user-facing nearby/now move
 *       (this is where structural / context / weak / popularity-only candidates
 *        are dropped — gates, not the scorer, enforce that)
 *     → score fit (intent primary; context bounded)
 *     → rank lexicographically by intent coverage, then context
 *     → pick best + backup, or emit an HONEST fallback (never hallucinate)
 *
 * Uses only existing city/catalog candidates. No external providers, no graph.
 */

const { collectPlaceCandidatesForCity } = require("../place-candidates/provider-registry");
const { deriveEvidenceFromPlaceCandidate } = require("./evidence");
const { reduceEvidence } = require("./evidence-reducer");
const { evaluateCandidateGates, targetFromPlaceCandidate } = require("./gates");
const { confidenceRank } = require("./confidence");
const { normalizeUserIntents } = require("./intent-vocabulary");
const { scoreCandidateFit } = require("./fit-scorer");

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

  const collection = collectPlaceCandidatesForCity(cityConfig);
  const allCandidates = Array.isArray(collection.candidates) ? collection.candidates : [];

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
    eligible.push({ candidate, derived, gates, fit });
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
      lens,
    },
    reroll_supported: false,
  };

  // --- Honest fallbacks ------------------------------------------------------
  if (!allCandidates.length) {
    return { ...base, best_move: null, backup_option: null, inspect: emptyInspect("no_candidates", normalized, rejected, []), reason: "no_candidates" };
  }
  if (!ranked.length) {
    return { ...base, best_move: null, backup_option: null, inspect: emptyInspect("no_eligible_candidates", normalized, rejected, []), reason: "no_eligible_candidates" };
  }

  const best = ranked[0];
  const backup = ranked[1] || null;
  const noPreferenceMatch =
    normalized.intents.length > 0 && best.fit.intent_match === "none";

  return {
    ...base,
    best_move: formatMove(best, "best"),
    backup_option: backup ? formatMove(backup, "backup") : null,
    reason: noPreferenceMatch ? "no_preference_match_offering_general" : "ok",
    inspect: buildInspect({ normalized, ranked, rejected, best, context }),
  };
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
    // 4. stronger existence confidence wins ties
    const conf = confidenceRank(b.derived.existence_confidence) - confidenceRank(a.derived.existence_confidence);
    if (conf) return conf;
    // 5. stable
    return String(a.candidate.id).localeCompare(String(b.candidate.id));
  });
}

function formatMove(entry, slot) {
  const { candidate, gates, fit } = entry;
  return {
    candidate_id: candidate.id,
    label: candidate.label,
    type: candidate.type,
    candidate_kind: candidate.candidate_kind,
    lat: candidate.lat ?? null,
    lng: candidate.lng ?? null,
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

function matchTier(intentMatch, slot) {
  if (intentMatch === "covered") return "primary";
  if (intentMatch === "partial") return "supporting";
  if (intentMatch === "general") return slot === "best" ? "primary" : "supporting";
  return "fallback"; // intent_match === "none"
}

function buildInspect({ normalized, ranked, rejected, best, context }) {
  return {
    requested_intents: normalized.intents,
    requested_modifiers: normalized.modifiers,
    unmapped_preferences: normalized.unmapped,
    eligible_count: ranked.length,
    rejected_count: rejected.length,
    selected: {
      candidate_id: best.candidate.id,
      label: best.candidate.label,
      match_tier: matchTier(best.fit.intent_match, "best"),
      gates_passed: Object.keys(best.gates).filter((k) => best.gates[k] === true),
      covered_preferences: best.fit.covered_preferences,
      missing_preferences: best.fit.missing_preferences,
      partial_preferences: best.fit.partial_preferences,
      fit_reasons: best.fit.reasons,
      existence_confidence: best.derived.existence_confidence,
    },
    ranked_sample: ranked.slice(0, 5).map((e) => ({
      id: e.candidate.id,
      label: e.candidate.label,
      type: e.candidate.type,
      intent_match: e.fit.intent_match,
      fit_score: e.fit.primary_score,
    })),
    rejected_sample: rejected.slice(0, 5),
    context_applied: { time_band: context.timeBand, weather: Boolean(context.weather), origin: Boolean(context.origin), lens: context.lens || "neutral" },
    bypass: {
      default_blitz_bypassed: true,
      reason: "experimental candidate_mode enabled",
    },
  };
}

function emptyInspect(reason, normalized, rejected, ranked) {
  return {
    requested_intents: normalized.intents,
    requested_modifiers: normalized.modifiers,
    unmapped_preferences: normalized.unmapped,
    eligible_count: ranked.length,
    rejected_count: rejected.length,
    rejected_sample: rejected.slice(0, 5),
    reason,
    bypass: { default_blitz_bypassed: true, reason: "experimental candidate_mode enabled" },
  };
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
  buildCandidateBlitzDecision,
  evaluateCandidateEligibility,
};
