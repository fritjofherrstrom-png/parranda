const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAgnosticConstraintNegotiation,
} = require("../server/planner/agnostic-constraint-negotiation");
const {
  describeAgnosticWalkingTarget,
} = require("../server/planner/agnostic-walking-target");

function plannerRoles() {
  return {
    requested_preferences: ["food", "scenic", "bars"],
    roles: [
      {
        role: "food_anchor",
        candidates: [
          { candidate_id: "food", covered_preferences: ["food"], partial_preferences: [] },
        ],
      },
      {
        role: "scenic_anchor",
        candidates: [
          { candidate_id: "view", covered_preferences: ["scenic"], partial_preferences: [] },
        ],
      },
      {
        role: "evening_bar_option",
        candidates: [
          { candidate_id: "bar", covered_preferences: [], partial_preferences: ["bars"] },
        ],
      },
    ],
  };
}

test("walking target uses the shared 60-118 percent product-fit band", () => {
  assert.deepEqual(describeAgnosticWalkingTarget({ estimatedKm: 3.5, targetKm: 6 }), {
    status: "shorter_than_requested_band",
    target_km: 6,
    estimated_km: 3.5,
    target_floor_km: 3.6,
    target_ceiling_km: 7.1,
  });
  assert.equal(describeAgnosticWalkingTarget({ estimatedKm: 4.1, targetKm: 6 }).status, "within_requested_band");
  assert.equal(describeAgnosticWalkingTarget({ estimatedKm: 7.2, targetKm: 6 }).status, "longer_than_requested_band");
});

test("finished route coverage is joined by stable id and reports explicit tradeoffs", () => {
  const input = {
    routeMutation: true,
    experimentalRoute: {
      estimated_km: 3.2,
      main_stops: [{ id: "food" }, { candidate_id: "bar" }],
    },
    plannerRoles: plannerRoles(),
    walkingKmTarget: 6,
    walkingValidation: { valid: true, checks: { total_walk_km: 3.2 } },
  };
  const before = structuredClone(input);
  const result = buildAgnosticConstraintNegotiation(input);

  assert.deepEqual(input, before, "post-hoc negotiation never mutates route evidence");
  assert.equal(result.status, "tradeoffs");
  assert.deepEqual(result.preference_coverage.covered_preferences, ["food"]);
  assert.deepEqual(result.preference_coverage.partial_preferences, ["bars"]);
  assert.deepEqual(result.preference_coverage.missing_preferences, ["scenic"]);
  assert.equal(result.walking.status, "shorter_than_requested_band");
  assert.deepEqual(result.tradeoffs, [
    "partial_preference:bars",
    "missing_preference:scenic",
    "walking_shorter_than_requested_band",
  ]);
  assert.deepEqual(buildAgnosticConstraintNegotiation(input), result, "same evidence always yields the same verdict");
});

test("route-owned preference evidence works without a reservoir lookup", () => {
  const result = buildAgnosticConstraintNegotiation({
    routeMutation: true,
    experimentalRoute: {
      estimated_km: 5,
      main_stops: [
        { id: "a", covered_preferences: ["food"] },
        { id: "b", covered_preferences: ["scenic", "bars"] },
      ],
    },
    plannerRoles: { requested_preferences: ["food", "scenic", "bars"], roles: [] },
    walkingKmTarget: 6,
    walkingValidation: { valid: true, checks: {} },
  });

  assert.equal(result.status, "satisfied");
  assert.deepEqual(result.preference_coverage.covered_preferences, ["food", "scenic", "bars"]);
  assert.deepEqual(result.tradeoffs, []);
});

test("blocked experiments are unresolved without inventing route or walking facts", () => {
  const result = buildAgnosticConstraintNegotiation({
    routeMutation: false,
    plannerRoles: plannerRoles(),
    walkingKmTarget: 9,
    blockers: ["insufficient_geocoded_candidates"],
  });

  assert.equal(result.status, "unresolved");
  assert.equal(result.route_present, false);
  assert.deepEqual(result.preference_coverage.missing_preferences, ["food", "scenic", "bars"]);
  assert.equal(result.walking.status, "unavailable");
  assert.equal(result.walking.estimated_km, null);
  assert.deepEqual(result.reasons, ["insufficient_geocoded_candidates", "no_composed_route"]);
});
