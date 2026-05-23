const assert = require("node:assert/strict");
const test = require("node:test");

const rome = require("../server/cities/rome");
const barcelona = require("../server/cities/barcelona");
const testCity = require("../server/cities/test-city");
const {
  assessCityCandidateReadiness,
} = require("../server/place-candidates/readiness");

test("assessCityCandidateReadiness reports Rome candidate coverage", () => {
  const readiness = assessCityCandidateReadiness(rome);

  assert.equal(readiness.city, "rome");
  assert.equal(readiness.total_candidates, rome.catalog.allItems.length);
  assert.ok(readiness.real_place_count >= 25);
  assert.ok(readiness.structural_count >= 1);
  assert.equal(readiness.by_trust_tier.curated, readiness.total_candidates);
  assert.equal(readiness.by_provider["curated-catalog"].count, readiness.total_candidates);
  assert.equal(readiness.has_minimum_real_places, true);
  assert.equal(readiness.has_coordinates_coverage, true);
  assert.equal(readiness.can_support_blitz, true);
  assert.equal(readiness.can_support_planner, true);
  assert.deepEqual(readiness.warnings, []);
});

test("assessCityCandidateReadiness reports Barcelona candidate coverage without counting structural anchors as real places", () => {
  const readiness = assessCityCandidateReadiness(barcelona);

  assert.equal(readiness.city, "barcelona");
  assert.equal(readiness.total_candidates, 100);
  assert.equal(readiness.real_place_count, 95);
  assert.equal(readiness.structural_count, 5);
  assert.equal(readiness.coordinate_ready_real_place_count, 95);
  assert.equal(readiness.coordinate_coverage, 1);
  assert.deepEqual(readiness.by_candidate_kind, {
    structural_anchor: 5,
    real_place: 95,
  });
  assert.deepEqual(readiness.by_trust_tier, {
    curated: 100,
  });
  assert.equal(readiness.can_support_blitz, true);
  assert.equal(readiness.can_support_planner, true);
  assert.deepEqual(readiness.warnings, []);
});

test("assessCityCandidateReadiness can evaluate only user-facing real-place candidates", () => {
  const readiness = assessCityCandidateReadiness(barcelona, {
    includeStructural: false,
  });

  assert.equal(readiness.total_candidates, 95);
  assert.equal(readiness.real_place_count, 95);
  assert.equal(readiness.structural_count, 0);
  assert.deepEqual(readiness.by_candidate_kind, {
    real_place: 95,
  });
  assert.equal(readiness.can_support_blitz, true);
  assert.equal(readiness.can_support_planner, true);
});

test("assessCityCandidateReadiness warns for sparse cities", () => {
  const sparseCity = buildSyntheticCity({
    key: "sparse-city",
    realPlaces: 4,
    structuralAnchors: 2,
  });
  const readiness = assessCityCandidateReadiness(sparseCity);

  assert.equal(readiness.total_candidates, 6);
  assert.equal(readiness.real_place_count, 4);
  assert.equal(readiness.structural_count, 2);
  assert.equal(readiness.has_minimum_real_places, false);
  assert.equal(readiness.can_support_blitz, false);
  assert.equal(readiness.can_support_planner, false);
  assert.ok(readiness.warnings.includes("insufficient_real_places_for_blitz"));
  assert.ok(readiness.warnings.includes("insufficient_real_places_for_planner"));
});

test("assessCityCandidateReadiness warns for low coordinate coverage and structural dominance", () => {
  const weakCity = buildSyntheticCity({
    key: "weak-city",
    realPlaces: 12,
    structuralAnchors: 14,
    omitCoordinatesAfter: 3,
  });
  const readiness = assessCityCandidateReadiness(weakCity);

  assert.equal(readiness.real_place_count, 12);
  assert.equal(readiness.structural_count, 14);
  assert.equal(readiness.coordinate_ready_real_place_count, 3);
  assert.equal(readiness.has_minimum_real_places, true);
  assert.equal(readiness.has_coordinates_coverage, false);
  assert.equal(readiness.can_support_blitz, false);
  assert.equal(readiness.can_support_planner, false);
  assert.ok(readiness.warnings.includes("low_coordinate_coverage"));
  assert.ok(readiness.warnings.includes("structural_candidates_dominate"));
});

test("assessCityCandidateReadiness can use stricter thresholds without changing providers", () => {
  const readiness = assessCityCandidateReadiness(barcelona, {
    minRealPlacesForPlanner: 120,
  });

  assert.equal(readiness.has_minimum_real_places, true);
  assert.equal(readiness.can_support_blitz, true);
  assert.equal(readiness.can_support_planner, false);
  assert.ok(readiness.warnings.includes("insufficient_real_places_for_planner"));
});

test("assessCityCandidateReadiness reports test-city honestly without crashing", () => {
  const readiness = assessCityCandidateReadiness(testCity);

  assert.equal(readiness.city, "test-city");
  assert.equal(readiness.total_candidates, testCity.catalog.allItems.length);
  assert.equal(readiness.real_place_count, 4);
  assert.equal(readiness.structural_count, 1);
  assert.equal(readiness.has_coordinates_coverage, true);
  assert.equal(readiness.can_support_blitz, false);
  assert.equal(readiness.can_support_planner, false);
  assert.ok(readiness.warnings.includes("insufficient_real_places_for_blitz"));
  assert.ok(readiness.warnings.includes("insufficient_real_places_for_planner"));
});

test("assessCityCandidateReadiness handles an empty city catalog without crashing", () => {
  const emptyCity = buildSyntheticCity({
    key: "empty-city",
    realPlaces: 0,
    structuralAnchors: 0,
  });
  const readiness = assessCityCandidateReadiness(emptyCity);

  assert.equal(readiness.city, "empty-city");
  assert.equal(readiness.total_candidates, 0);
  assert.equal(readiness.real_place_count, 0);
  assert.equal(readiness.structural_count, 0);
  assert.equal(readiness.coordinate_ready_real_place_count, 0);
  assert.equal(readiness.has_minimum_real_places, false);
  assert.equal(readiness.has_coordinates_coverage, false);
  assert.equal(readiness.can_support_blitz, false);
  assert.equal(readiness.can_support_planner, false);
  assert.ok(readiness.warnings.includes("no_real_place_candidates"));
  assert.ok(readiness.warnings.includes("insufficient_real_places_for_blitz"));
  assert.ok(readiness.warnings.includes("insufficient_real_places_for_planner"));
});

function buildSyntheticCity({
  key,
  realPlaces,
  structuralAnchors,
  omitCoordinatesAfter = Number.POSITIVE_INFINITY,
}) {
  const allItems = [];

  for (let index = 0; index < realPlaces; index += 1) {
    allItems.push({
      id: `${key}-place-${index}`,
      name: `${key} Place ${index}`,
      kind: "cafe",
      lat: index < omitCoordinatesAfter ? 41 + index / 1000 : undefined,
      lng: index < omitCoordinatesAfter ? 12 + index / 1000 : undefined,
      area: "center",
      tags: ["mat"],
      searchTerms: [`${key} place ${index}`],
    });
  }

  for (let index = 0; index < structuralAnchors; index += 1) {
    allItems.push({
      id: `${key}-anchor-${index}`,
      name: `${key} Anchor ${index}`,
      kind: "district-group",
      structuralRouteAnchor: true,
      lat: 41.5 + index / 1000,
      lng: 12.5 + index / 1000,
      area: "center",
      tags: ["kultur"],
      searchTerms: [`${key} anchor ${index}`],
    });
  }

  return {
    key,
    label: key,
    catalog: {
      allItems,
      routeTemplates: [],
      findItemByName(name) {
        return allItems.find((item) => item.name === name) || null;
      },
    },
    routing: {
      areaDefinitions: {
        center: { label: "Center", macro: "center" },
      },
      macroAreaLabels: {
        center: "Center",
      },
      tuning: {},
    },
  };
}
