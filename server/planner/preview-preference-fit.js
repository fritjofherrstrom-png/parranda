"use strict";

// Preference-driven composition for thin PREVIEW Planner cities.
//
// The problem this solves: a recognized preview city (e.g. Athens) does NOT run
// the any-place route-output path. It runs the registered-city preview-beta
// path through `generateRecommendations` with a `cityConfigOverride`. In that
// path, stop SELECTION was dominated by generic geometry/anchor weighting, so
// different preference sets collapsed to the same `primary_route.main_stops`.
//
// The fix routes the SHARED candidate reservoir (the same fit logic Blitz uses —
// `rankCandidatesForBlitz`) into preview Planner composition. For each requested
// preference we ask the reservoir which catalogue/source-backed candidates
// actually satisfy that intent, then hand the route engine a per-id fit map
// (`__previewPreferenceFit`) it can boost on. Source-fit is the reservoir's
// verdict — it is NOT re-implemented here.
//
// Trust posture is unchanged: source-backed candidates stay provisional and are
// never promoted to curated trust. The reservoir already gates them; we only
// read its fit ranking. Public payload candidates cannot enter — the reservoir
// collects from the trusted city config (catalog + server-injected
// sourceCandidates), never from request-supplied places.

const { rankCandidatesForBlitz } = require("../candidates/blitz-candidate-mode");
const { scoreCandidateFit } = require("../candidates/fit-scorer");
const { normalizeUserIntents } = require("../candidates/intent-vocabulary");

const MATCH_TIER = { covered: 2, partial: 1 };

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// Build the preference fit map + honest per-preference coverage for a thin
// preview city. Runs the reservoir once per requested preference so each raw
// preference token (including Swedish: utsikt/kväll/fika/kultur) is normalized
// and matched independently — a candidate that satisfies ANY requested
// preference is boosted, and a preference nothing satisfies is reported
// `missing` instead of being silently absorbed into a generic day.
//
// Returns:
//   fitMap  → { [candidateId]: { match: "covered"|"partial", score } } or null
//   coverage → [{ preference, status: "covered"|"partial"|"missing" }]
function buildPreviewPreferenceFit(cityConfig, options = {}) {
  const { preferences = [], origin = null, date = null, now = null } = options;
  const prefs = uniqueStrings(preferences);
  if (!cityConfig || cityConfig.visibility !== "preview" || !prefs.length) {
    return { fitMap: null, coverage: [] };
  }

  const fitMap = {};
  const coverage = [];
  const sourceCandidates = Array.isArray(cityConfig.sourceCandidates) ? cityConfig.sourceCandidates : [];

  // Merge a fit verdict into the map, keeping the strongest match per candidate
  // (a candidate that satisfies several requested preferences is boosted by its
  // best one). Returns the resulting status contribution: "covered" | "partial".
  function record(id, match, score, statusRef) {
    if (match === "covered") {
      statusRef.status = "covered";
    } else if (statusRef.status !== "covered") {
      statusRef.status = "partial";
    }
    if (id == null) return;
    const prev = fitMap[id];
    const stronger =
      !prev ||
      MATCH_TIER[match] > MATCH_TIER[prev.match] ||
      (MATCH_TIER[match] === MATCH_TIER[prev.match] && score > prev.score);
    if (stronger) {
      fitMap[id] = { match, score };
    }
  }

  for (const preference of prefs) {
    const statusRef = { status: "missing" };

    // (1) Curated/collected spine — the reservoir, which enriches catalog
    // candidates during identity resolution so sparse catalog tags still match.
    // No helpers: the reservoir's fallbacks (fallbackNowContext /
    // fallbackTimeBand / normalizeUserIntents over the raw preference) cover
    // everything the fit verdict needs, and no external provider is enabled so
    // there is no live fetch.
    let ranked = [];
    try {
      ({ ranked } = rankCandidatesForBlitz(cityConfig, { preferences: [preference], origin, date, now }, {}));
    } catch (_error) {
      ranked = [];
    }
    const rankedIds = new Set();
    for (const entry of Array.isArray(ranked) ? ranked : []) {
      const match = entry && entry.fit ? entry.fit.intent_match : null;
      const id = entry.candidate && entry.candidate.id;
      if (id != null) rankedIds.add(id);
      if (match !== "covered" && match !== "partial") continue;
      record(id, match, Number(entry.fit.primary_score) || 0, statusRef);
    }

    // (2) Provisional source candidates the reservoir drops in collection
    // (draft_place, e.g. the #302 second-hand pack). Score them with the SAME
    // shared fit scorer — they carry explicit tags so they match on their own.
    // This is the reservoir's fit logic, not a second scorer.
    const intents = normalizeUserIntents([preference]);
    for (const candidate of sourceCandidates) {
      if (!candidate || candidate.id == null || rankedIds.has(candidate.id)) continue;
      const fit = scoreCandidateFit({
        candidate,
        userIntents: intents.intents,
        userModifiers: intents.modifiers,
        context: {},
      });
      if (fit.intent_match !== "covered" && fit.intent_match !== "partial") continue;
      record(candidate.id, fit.intent_match, Number(fit.primary_score) || 0, statusRef);
    }

    coverage.push({ preference, status: statusRef.status });
  }

  // Always return the map (possibly empty) when preferences were requested. An
  // EMPTY map is meaningful: it tells the route engine the request was judged
  // and nothing matched, so it must suppress off-intent provisional packs rather
  // than silently reserving them as a generic fallback day. `null` is reserved
  // for "no preferences requested" (handled by the early return above), where
  // the pre-existing reservation behavior stays untouched.
  return { fitMap, coverage };
}

module.exports = { buildPreviewPreferenceFit };
