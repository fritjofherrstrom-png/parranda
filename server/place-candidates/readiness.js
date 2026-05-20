const { collectPlaceCandidatesForCity } = require("./provider-registry");

const DEFAULT_MIN_REAL_PLACES_FOR_BLITZ = 10;
const DEFAULT_MIN_REAL_PLACES_FOR_PLANNER = 25;
const DEFAULT_MIN_COORDINATE_COVERAGE = 0.8;

function assessCityCandidateReadiness(cityConfig, options = {}) {
  const collection = collectPlaceCandidatesForCity(cityConfig, options);
  const realCandidates = collection.candidates.filter((candidate) => !candidate.is_structural);
  const coordinateReadyRealCandidates = realCandidates.filter(hasCoordinates);
  const coordinateCoverage = realCandidates.length
    ? coordinateReadyRealCandidates.length / realCandidates.length
    : 0;

  const minRealPlacesForBlitz =
    options.minRealPlacesForBlitz ?? DEFAULT_MIN_REAL_PLACES_FOR_BLITZ;
  const minRealPlacesForPlanner =
    options.minRealPlacesForPlanner ?? DEFAULT_MIN_REAL_PLACES_FOR_PLANNER;
  const minCoordinateCoverage =
    options.minCoordinateCoverage ?? DEFAULT_MIN_COORDINATE_COVERAGE;

  const hasMinimumRealPlaces = realCandidates.length >= minRealPlacesForBlitz;
  const hasPlannerRealPlaces = realCandidates.length >= minRealPlacesForPlanner;
  const hasCoordinatesCoverage = coordinateCoverage >= minCoordinateCoverage;
  const canSupportBlitz = hasMinimumRealPlaces && hasCoordinatesCoverage;
  const canSupportPlanner = hasPlannerRealPlaces && hasCoordinatesCoverage;

  return {
    city: collection.city,
    total_candidates: collection.summary.total,
    real_place_count: collection.summary.real_place_count,
    structural_count: collection.summary.structural_count,
    coordinate_ready_real_place_count: coordinateReadyRealCandidates.length,
    coordinate_coverage: Number(coordinateCoverage.toFixed(3)),
    by_candidate_kind: collection.summary.by_candidate_kind,
    by_trust_tier: collection.summary.by_trust_tier,
    by_provider: collection.summary.by_provider,
    has_minimum_real_places: hasMinimumRealPlaces,
    has_coordinates_coverage: hasCoordinatesCoverage,
    can_support_blitz: canSupportBlitz,
    can_support_planner: canSupportPlanner,
    warnings: buildWarnings({
      realPlaceCount: realCandidates.length,
      structuralCount: collection.summary.structural_count,
      coordinateCoverage,
      coordinateReadyRealPlaceCount: coordinateReadyRealCandidates.length,
      byTrustTier: collection.summary.by_trust_tier,
      minRealPlacesForBlitz,
      minRealPlacesForPlanner,
      minCoordinateCoverage,
    }),
  };
}

function hasCoordinates(candidate) {
  return Number.isFinite(candidate?.lat) && Number.isFinite(candidate?.lng);
}

function buildWarnings({
  realPlaceCount,
  structuralCount,
  coordinateCoverage,
  coordinateReadyRealPlaceCount,
  byTrustTier,
  minRealPlacesForBlitz,
  minRealPlacesForPlanner,
  minCoordinateCoverage,
}) {
  const warnings = [];

  if (realPlaceCount === 0) {
    warnings.push("no_real_place_candidates");
  }
  if (realPlaceCount < minRealPlacesForBlitz) {
    warnings.push("insufficient_real_places_for_blitz");
  }
  if (realPlaceCount < minRealPlacesForPlanner) {
    warnings.push("insufficient_real_places_for_planner");
  }
  if (coordinateReadyRealPlaceCount === 0) {
    warnings.push("no_coordinate_ready_real_places");
  } else if (coordinateCoverage < minCoordinateCoverage) {
    warnings.push("low_coordinate_coverage");
  }
  if (structuralCount > realPlaceCount) {
    warnings.push("structural_candidates_dominate");
  }
  if ((byTrustTier.inferred || 0) + (byTrustTier.fallback || 0) > (byTrustTier.curated || 0)) {
    warnings.push("low_trust_candidates_dominate");
  }

  return warnings;
}

module.exports = {
  DEFAULT_MIN_REAL_PLACES_FOR_BLITZ,
  DEFAULT_MIN_REAL_PLACES_FOR_PLANNER,
  DEFAULT_MIN_COORDINATE_COVERAGE,
  assessCityCandidateReadiness,
};
