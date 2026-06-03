/**
 * Candidate Intelligence Spine — inspect/debug projection (read-only).
 *
 * Runs the spine (evidence bridge → reducer → gates → fit shape) over a city's
 * EXISTING place candidates and returns an auditable view. This is what makes
 * the spine a real read path in v1 instead of a second shadow layer, while
 * changing zero user-facing behavior — it is debug-only.
 *
 * Exposed via GET /api/candidate-inspect?city=...&date=...
 *
 * Pure given (cityConfig, { now }).
 */

const { collectPlaceCandidatesForCity } = require("../place-candidates/provider-registry");
const { deriveEvidenceFromPlaceCandidate } = require("./evidence");
const { reduceEvidence } = require("./evidence-reducer");
const { evaluateCandidateGates, targetFromPlaceCandidate, GATE_KEYS } = require("./gates");
const { createFitDecomposition } = require("./fit");

function buildCandidateIntelligenceInspect(cityConfig, { now = null, limit = null } = {}) {
  if (!cityConfig || typeof cityConfig !== "object") {
    throw new Error("buildCandidateIntelligenceInspect requires a city config");
  }

  const collection = collectPlaceCandidatesForCity(cityConfig);
  const allCandidates = Array.isArray(collection.candidates) ? collection.candidates : [];
  const candidates = Number.isFinite(limit) ? allCandidates.slice(0, limit) : allCandidates;

  const rows = candidates.map((candidate) => buildCandidateRow(candidate, { now }));

  return {
    city: collection.city,
    generated_for: now,
    candidate_count: allCandidates.length,
    inspected_count: rows.length,
    summary: summarizeRows(rows),
    rows,
  };
}

function buildCandidateRow(candidate, { now = null } = {}) {
  const evidence = deriveEvidenceFromPlaceCandidate(candidate, { observed_at: now });
  const derived = reduceEvidence(evidence, { now });
  const gates = evaluateCandidateGates({ target: targetFromPlaceCandidate(candidate), derived });
  const fit = createFitDecomposition();

  return {
    id: candidate.id,
    label: candidate.label,
    candidate_kind: candidate.candidate_kind,
    provenance: {
      source_kind: candidate.source?.kind || null,
      source_tier: candidate.trust?.source_tier || null,
      human_verified: candidate.trust?.human_verified === true,
      city_pack_owned: candidate.city_pack_owned === true,
    },
    evidence_count: evidence.length,
    derived,
    gates,
    fit,
  };
}

function summarizeRows(rows) {
  const byGate = GATE_KEYS.reduce((acc, key) => {
    acc[key] = rows.filter((row) => row.gates[key] === true).length;
    return acc;
  }, {});

  const byExistenceConfidence = rows.reduce((acc, row) => {
    const key = row.derived.existence_confidence || "needs_review";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    by_gate: byGate,
    by_existence_confidence: byExistenceConfidence,
  };
}

module.exports = {
  buildCandidateIntelligenceInspect,
  buildCandidateRow,
};
