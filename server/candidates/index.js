/**
 * Candidate Intelligence Spine — public surface.
 *
 * The shared decision substrate for Blitz and generated Your Day. v1 ships the
 * primitives (confidence, evidence, reducer, gates, fit contract) plus a
 * read-only inspect projection. No default product output changes here.
 *
 * See docs/CANDIDATE_INTELLIGENCE_MIGRATION.md.
 */

const confidence = require("./confidence");
const evidence = require("./evidence");
const reducer = require("./evidence-reducer");
const gates = require("./gates");
const fit = require("./fit");
const inspect = require("./inspect");

module.exports = {
  // confidence vocabulary + adapters
  ...confidence,
  // evidence model + bridge
  ...evidence,
  // reducer
  reduceEvidence: reducer.reduceEvidence,
  // gates
  evaluateCandidateGates: gates.evaluateCandidateGates,
  targetFromPlaceCandidate: gates.targetFromPlaceCandidate,
  targetFromContextSignal: gates.targetFromContextSignal,
  GATE_KEYS: gates.GATE_KEYS,
  // fit contract
  createFitDecomposition: fit.createFitDecomposition,
  combineFit: fit.combineFit,
  FIT_DIMENSIONS: fit.FIT_DIMENSIONS,
  LENS_VALUES: fit.LENS_VALUES,
  // inspect
  buildCandidateIntelligenceInspect: inspect.buildCandidateIntelligenceInspect,
  buildCandidateRow: inspect.buildCandidateRow,
};
