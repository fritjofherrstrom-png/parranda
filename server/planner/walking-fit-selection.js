"use strict";

const { distanceKm } = require('./candidate-reach-policy');
const { plannerUsableOptionsForRole } = require('./candidate-combination');

const MAX_ROLE_ALTERNATIVES = 2;
const MAX_WALKING_FIT_TRIALS = 3;
// Thin-day refinement only. Larger reservoirs already have combinatorial
// ordering cost; do not multiply their search or the pin-settling lifecycle.
const MAX_WALKING_FIT_RESERVOIR = 6;
const STATUS = { partial: 1, filled: 2 };
const CONFIDENCE = { low: 1, medium: 2, high: 3 };
const includesAll = (values, required) => required.every(value => values.includes(value));

// Replacements are not extra provisional breadth. Every proposed place must
// be independently usable for this same requested role, with no loss of the
// original admission, preference, operational, local-feel or confidence tier.
function comparableRoleReplacement(base, next) {
  if (!base || !next || next.planner_usable !== true || next.availability?.eligible === false) return false;
  if (!STATUS[base.candidate_status] || !STATUS[next.candidate_status] ||
      STATUS[next.candidate_status] < STATUS[base.candidate_status]) return false;
  if (Boolean(base.experimental_admission?.allowed) !== Boolean(next.experimental_admission?.allowed)) return false;
  if (base.origin === 'curated_catalog' && next.origin !== 'curated_catalog') return false;
  if ((CONFIDENCE[next.confidence] || 0) < (CONFIDENCE[base.confidence] || 0)) return false;
  if ((next.local_feel_rank ?? 0) > (base.local_feel_rank ?? 0)) return false;
  if ((next.operational_viability?.rank ?? 0) > (base.operational_viability?.rank ?? 0)) return false;
  // Distance is allowed to change; weather, time and experience-lens signals
  // are not silently traded away for it. Different context needs its own choice.
  for (const key of ['weather_reasons','time_reasons','lens_reasons']) {
    const tokens = value => JSON.stringify([...new Set(value || [])].sort());
    if (tokens(base[key]) !== tokens(next[key])) return false;
  }
  const exact = base.covered_preferences || [];
  const partial = base.partial_preferences || [];
  return includesAll(next.covered_preferences || [], exact) &&
    includesAll([...(next.covered_preferences || []), ...(next.partial_preferences || [])], partial);
}

// Inspect only the already reached/eligible role pool. A loop's radial reach
// is a cheap proposal order, not walking evidence; the engine validates trials.
function retainWalkingFitAlternatives({ roles, candidatesByRole, origin, band }) {
  if (!band || !Number.isFinite(origin?.lat) || !Number.isFinite(origin?.lng)) return [];
  return roles.filter(role => role.requested).flatMap(role => {
    const surfaced = plannerUsableOptionsForRole(role);
    if (!surfaced.length) return [];
    const eligible = plannerUsableOptionsForRole({candidates: candidatesByRole[role.role] || []});
    return eligible.filter(next => surfaced.some(base => comparableRoleReplacement(base, next)))
      .sort((a,b) => proposalCost(a.coordinates,origin,band) - proposalCost(b.coordinates,origin,band) ||
        String(a.candidate_id).localeCompare(String(b.candidate_id)))
      .slice(0,MAX_ROLE_ALTERNATIVES).map(candidate => ({role:role.role,...candidate}));
  });
}

function proposalCost(point, origin, band) {
  return Math.abs(2 * distanceKm(origin,point) - band.targetKm);
}

// Re-ordering a reservoir must not quietly exchange a second published place.
// Preserve every actual stop except the explicitly comparable replacement.
function replacementKeepsOtherStops(baseRoute, nextRoute, removedId, addedId) {
  const baseIds = (baseRoute?.main_stops || []).map(stop => stop.id);
  const nextIds = new Set((nextRoute?.main_stops || []).map(stop => stop.id));
  return baseIds.includes(removedId) && nextIds.has(addedId) &&
    baseIds.every(id => id === removedId || nextIds.has(id));
}

module.exports = { comparableRoleReplacement, retainWalkingFitAlternatives, proposalCost,
  replacementKeepsOtherStops,
  MAX_ROLE_ALTERNATIVES, MAX_WALKING_FIT_TRIALS, MAX_WALKING_FIT_RESERVOIR };
