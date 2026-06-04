/**
 * Candidate Intelligence Spine — Fit decomposition CONTRACT (v1: shape only).
 *
 * Fit is the primary sort: among gate-eligible candidates, how well does this
 * candidate fit the user, route, intent, time, weather, moment, area, and lens?
 *
 * v1 deliberately ships ONLY the shape, not the scorer. The real fit weights
 * still live in route-engine.js / blitz-engine.js; re-homing them onto this
 * decomposition is a later migration step (see CANDIDATE_INTELLIGENCE_MIGRATION
 * Step 4+). Shipping the shape now lets gates + inspect reference a stable fit
 * contract without anyone reaching into the route engine prematurely.
 *
 * Pure / side-effect free.
 */

const { LENS_VALUES, normalizeLens } = require("./lens");

// The fit dimensions Parranda judges. `lens` (first_time/local/rediscover) is a
// modifier over these weights, not a dimension itself.
const FIT_DIMENSIONS = ["intent", "route", "time", "weather", "moment", "local"];

function createFitDecomposition({ lens = null, dimensions = {} } = {}) {
  const normalizedLens = normalizeLens(lens);

  const dims = FIT_DIMENSIONS.reduce((acc, key) => {
    const override = dimensions[key] || {};
    acc[key] = {
      // score stays null in v1 — fit is not yet computed by the spine.
      score: Number.isFinite(override.score) ? override.score : null,
      weight: Number.isFinite(override.weight) ? override.weight : 1,
      reasons: Array.isArray(override.reasons) ? override.reasons.slice() : [],
    };
    return acc;
  }, {});

  return {
    implemented: false, // v1: contract only
    lens: normalizedLens,
    dimensions: dims,
    primary_score: null,
  };
}

/**
 * Placeholder combiner. Intentionally returns a null primary_score in v1 so the
 * contract is exercised without faking a ranking. When fit scoring lands, this
 * becomes the bounded combine of dimensions × weights with modifiers applied
 * AFTER (never folded into the primary fit).
 */
function combineFit(decomposition) {
  return {
    ...decomposition,
    primary_score: null,
  };
}

module.exports = {
  FIT_DIMENSIONS,
  LENS_VALUES,
  createFitDecomposition,
  combineFit,
};
