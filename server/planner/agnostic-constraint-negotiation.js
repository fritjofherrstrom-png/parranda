/**
 * Post-hoc honesty for the finished agnostic route experiment.
 *
 * Evidence in, verdict out: this helper never selects candidates, changes an
 * order, relaxes eligibility, or mutates route output. Stable ids are the only
 * join between the selected route and the richer planner-role evidence.
 */

const { describeAgnosticWalkingTarget } = require("./agnostic-walking-target");

function buildAgnosticConstraintNegotiation({
  routeMutation = false,
  experimentalRoute = null,
  plannerRoles = null,
  walkingKmTarget = null,
  walkingValidation = null,
  blockers = [],
} = {}) {
  const requested = uniqueStrings(plannerRoles?.requested_preferences);
  const routeStops = routeMutation && Array.isArray(experimentalRoute?.main_stops)
    ? experimentalRoute.main_stops
    : [];
  const evidenceById = buildCandidateEvidenceIndex(plannerRoles);
  const routeEvidence = routeStops.map((stop) => evidenceForRouteStop(stop, evidenceById));
  const covered = requested.filter((preference) =>
    routeEvidence.some((evidence) => evidence.covered.has(preference)),
  );
  const partial = requested.filter(
    (preference) =>
      !covered.includes(preference) &&
      routeEvidence.some((evidence) => evidence.partial.has(preference)),
  );
  const missing = requested.filter(
    (preference) => !covered.includes(preference) && !partial.includes(preference),
  );
  const estimatedKm = firstFinite(
    experimentalRoute?.estimated_km,
    walkingValidation?.checks?.total_walk_km,
  );
  const walking = describeAgnosticWalkingTarget({ estimatedKm, targetKm: walkingKmTarget });
  const tradeoffs = [
    ...partial.map((preference) => `partial_preference:${preference}`),
    ...missing.map((preference) => `missing_preference:${preference}`),
  ];
  if (walking.status === "shorter_than_requested_band") tradeoffs.push("walking_shorter_than_requested_band");
  if (walking.status === "longer_than_requested_band") tradeoffs.push("walking_longer_than_requested_band");
  if (walking.status === "unavailable") tradeoffs.push("walking_distance_unavailable");

  const status = !routeMutation || routeStops.length === 0
    ? "unresolved"
    : tradeoffs.length > 0
      ? "tradeoffs"
      : "satisfied";
  const reasons = status === "unresolved"
    ? uniqueStrings([...(Array.isArray(blockers) ? blockers : []), "no_composed_route"])
    : status === "tradeoffs"
      ? ["trusted_route_returned_with_explicit_tradeoffs"]
      : ["requested_constraints_satisfied_by_selected_route"];

  return {
    status,
    route_present: routeStops.length > 0,
    preference_coverage: {
      requested_preferences: requested,
      covered_preferences: covered,
      partial_preferences: partial,
      missing_preferences: missing,
    },
    walking: {
      ...walking,
      validation_status: walkingValidation?.valid === true
        ? "validated"
        : walkingValidation?.valid === false
          ? "failed"
          : "not_evaluated",
    },
    tradeoffs,
    reasons,
  };
}

function buildCandidateEvidenceIndex(plannerRoles) {
  const index = new Map();
  for (const role of Array.isArray(plannerRoles?.roles) ? plannerRoles.roles : []) {
    for (const candidate of Array.isArray(role?.candidates) ? role.candidates : []) {
      const id = stableId(candidate);
      if (!id) continue;
      const existing = index.get(id) || { covered: new Set(), partial: new Set() };
      addStrings(existing.covered, candidate.covered_preferences);
      addStrings(existing.partial, candidate.partial_preferences);
      index.set(id, existing);
    }
  }
  return index;
}

function evidenceForRouteStop(stop, evidenceById) {
  const own = {
    covered: new Set(uniqueStrings(stop?.covered_preferences)),
    partial: new Set(uniqueStrings(stop?.partial_preferences)),
  };
  const indexed = evidenceById.get(stableId(stop));
  if (indexed) {
    addStrings(own.covered, indexed.covered);
    addStrings(own.partial, indexed.partial);
  }
  return own;
}

function stableId(value) {
  for (const key of ["candidate_id", "id", "place_id"]) {
    const id = value?.[key];
    if (typeof id === "string" && id.trim()) return id.trim();
    if (Number.isFinite(id)) return String(id);
  }
  return null;
}

function addStrings(target, values) {
  for (const value of values instanceof Set ? values : uniqueStrings(values)) target.add(value);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value))];
}

function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}

module.exports = {
  buildAgnosticConstraintNegotiation,
};
