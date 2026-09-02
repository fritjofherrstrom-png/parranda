const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mapAdmittedSelectionToSourceCandidates,
  mapPlannerReservoirToSourceCandidates,
} = require("../server/planner/agnostic-engine-compose");

// A rich planner-role candidate, shaped like formatRoleCandidate() output:
// carries type + provenance(attribution/source_tier/human_verified) that the
// lossy combination `selected[]` (formatSelected) drops.
function richCandidate(overrides = {}) {
  return {
    candidate_id: "osm-node-1",
    label: "Harbour Café",
    type: "cafe",
    candidate_kind: "draft_place",
    confidence: "needs_review",
    coordinates: { lat: 43.51, lng: 16.44 },
    provenance: {
      provider_id: "overpass",
      source_family: "openstreetmap",
      source_tier: "inferred",
      human_verified: false,
      attribution: [{ provider_id: "overpass", label: "OpenStreetMap", url: "https://osm.org/node/1" }],
      corroborated_by_external: false,
    },
    ...overrides,
  };
}

// A combination `selected[]` pick, shaped like formatSelected() output: role +
// id + coordinates, but NO type/provenance.
function selectedPick(overrides = {}) {
  return {
    role: "coffee_start",
    candidate_id: "osm-node-1",
    label: "Harbour Café",
    confidence: "needs_review",
    coordinates: { lat: 43.51, lng: 16.44 },
    ...overrides,
  };
}

function plannerRoles(candidatesByRole) {
  return {
    city: "agnostic-engine-area",
    roles: Object.entries(candidatesByRole).map(([role, candidates]) => ({
      role,
      slot: role.includes("anchor") ? "anchor" : "stop",
      candidates,
    })),
  };
}

test("joins selected picks back to rich candidates to recover source backing", () => {
  const rich = richCandidate();
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({ coffee_start: [rich] }),
    city: "agnostic-engine-area",
  });

  assert.equal(result.length, 1);
  const c = result[0];
  assert.equal(c.id, "osm-node-1");
  assert.equal(c.city, "agnostic-engine-area");
  // type + source attribution recovered from the rich candidate (NOT present on the pick)
  assert.equal(c.type, "cafe");
  assert.equal(c.source.label, "OpenStreetMap");
  assert.equal(c.source.url, "https://osm.org/node/1");
  assert.deepEqual(c.route_roles, ["coffee_start"]);
  assert.equal(c.lat, 43.51);
  assert.equal(c.lng, 16.44);
});

test("revision-bound worker provenance survives the rich candidate to composer seam", () => {
  const trustedSource = {
    profile_key: "place-source-profile-v1:rome",
    profile_revision: `sha256:${"a".repeat(64)}`,
    approval_key: "source-profile-approval-v1:approval123",
    source_id: "rome-official-guide",
    adapter: "schema_org_place_json",
    adapter_contract_revision: "schema-org-place-json-v1",
    observed_at: "2026-09-02T08:00:00.000Z",
    expires_at: "2026-09-03T08:00:00.000Z",
  };
  const rich = richCandidate({
    provenance: { ...richCandidate().provenance, trusted_source: trustedSource },
  });
  const [candidate] = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({ coffee_start: [rich] }),
  });

  assert.deepEqual(candidate.provenance.trusted_source, trustedSource);
});

test("reconstructs honest LOW trust — never curated or human-verified", () => {
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({ coffee_start: [richCandidate()] }),
  });
  const c = result[0];
  assert.equal(c.candidate_kind, "draft_place");
  assert.equal(c.city_pack_owned, false);
  assert.equal(c.trust.human_verified, false);
  assert.equal(c.trust.source_tier, "inferred");
  assert.equal(c.trust.confidence, "needs_review");
  assert.equal(c.is_structural, false);
});

test("a human-verified rich candidate still maps faithfully (does not lie either way)", () => {
  const rich = richCandidate({
    provenance: { ...richCandidate().provenance, human_verified: true, source_tier: "verified" },
  });
  const c = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({ coffee_start: [rich] }),
  })[0];
  assert.equal(c.trust.human_verified, true);
  assert.equal(c.trust.source_tier, "verified");
});

test("a pick with no coordinates (and no rich coords) is dropped — a stop must have a location", () => {
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick({ coordinates: null })],
    plannerRoles: plannerRoles({ coffee_start: [richCandidate({ coordinates: null })] }),
  });
  assert.deepEqual(result, []);
});

test("a stale selected pick cannot restore a rich candidate proven unavailable", () => {
  const unavailable = richCandidate({
    availability: {
      eligible: false,
      status: "closed_for_window",
      reason: "opening_hours_closed_for_query_window",
    },
  });
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({ coffee_start: [unavailable] }),
  });

  assert.deepEqual(result, []);
});

test("selected-day source hours survive as a bounded fact without raw schedule data", () => {
  const rich = richCandidate({
    availability: {
      eligible: true,
      status: "available_in_window",
      reason: "opening_hours_overlap_query_window",
      selected_day_hours: {
        status: "known",
        all_day: false,
        windows: [{ opens: "10:00", closes: "18:00" }],
        raw_schedule: "Mo-Fr 10:00-18:00",
      },
    },
  });
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({ coffee_start: [rich] }),
  });

  assert.deepEqual(result[0].selected_day_hours, {
    status: "known",
    all_day: false,
    windows: [{ opens: "10:00", closes: "18:00" }],
  });
  assert.equal(JSON.stringify(result[0]).includes("Mo-Fr"), false);
});

test("malformed selected-day hours never enter engine source candidates", () => {
  const rich = richCandidate({
    availability: {
      eligible: true,
      status: "unknown",
      selected_day_hours: {
        status: "known",
        windows: [{ opens: "payload", closes: "18:00" }],
      },
    },
  });
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({ coffee_start: [rich] }),
  });

  assert.equal(result[0].selected_day_hours, undefined);
});

test("falls back to bare-id join when the role does not match", () => {
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick({ role: "mismatched_role" })],
    plannerRoles: plannerRoles({ coffee_start: [richCandidate()] }),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "cafe", "still recovered the rich type via bare-id fallback");
});

test("missing rich source still yields a usable, honest candidate from the pick alone", () => {
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({}), // no rich candidates to join
  });
  assert.equal(result.length, 1);
  const c = result[0];
  assert.equal(c.id, "osm-node-1");
  assert.equal(c.type, "place"); // honest default, not invented
  assert.equal(c.trust.source_tier, "inferred");
  assert.equal(c.source.label, "open data");
});

test("duplicate selected ids are collapsed", () => {
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick(), selectedPick({ role: "scenic_anchor" })],
    plannerRoles: plannerRoles({ coffee_start: [richCandidate()] }),
  });
  assert.equal(result.length, 1);
});

test("empty / malformed input returns an empty list, never throws", () => {
  assert.deepEqual(mapAdmittedSelectionToSourceCandidates({}), []);
  assert.deepEqual(mapAdmittedSelectionToSourceCandidates({ selected: null, plannerRoles: null }), []);
  assert.deepEqual(mapAdmittedSelectionToSourceCandidates({ selected: [{}], plannerRoles: {} }), []);
});

test("bounded reservoir keeps combination winners first and adds only the same safe local-feel tier", () => {
  const candidate = (id, role, over = {}) => richCandidate({
    candidate_id: id,
    label: id,
    type: role === "food_anchor" ? "restaurant" : "park",
    coordinates: { lat: 43.51 + id.length * 0.0001, lng: 16.44 },
    candidate_status: "filled",
    planner_usable: true,
    origin: "external_open",
    covered_preferences: [role === "food_anchor" ? "food" : "green"],
    partial_preferences: [],
    local_feel_rank: 0,
    ...over,
  });
  const foodWinner = candidate("food-local-a", "food_anchor");
  const foodDepth = candidate("food-local-b", "food_anchor");
  const foodChain = candidate("food-chain", "food_anchor", { local_feel_rank: 2, chain: true, brand: "Chain" });
  const greenWinner = candidate("green-local-a", "green_walk_stop");
  const greenDepth = candidate("green-local-b", "green_walk_stop");
  const greenFallback = candidate("green-fallback", "green_walk_stop", {
    candidate_status: "fallback",
    planner_usable: false,
  });
  const roles = {
    city: "agnostic-engine-area",
    roles: [
      { role: "food_anchor", requested: true, candidates: [foodWinner, foodDepth, foodChain] },
      { role: "green_walk_stop", requested: true, candidates: [greenWinner, greenDepth, greenFallback] },
    ],
  };

  const result = mapPlannerReservoirToSourceCandidates({
    selected: [
      selectedPick({ role: "food_anchor", candidate_id: foodWinner.candidate_id, coordinates: foodWinner.coordinates }),
      selectedPick({ role: "green_walk_stop", candidate_id: greenWinner.candidate_id, coordinates: greenWinner.coordinates }),
    ],
    plannerRoles: roles,
  });

  assert.deepEqual(result.map((entry) => entry.id), ["food-local-a", "green-local-a", "food-local-b", "green-local-b"]);
  assert.deepEqual(result.map((entry) => entry.reservoir_selected), [true, true, false, false]);
  assert.equal(result.some((entry) => entry.id === "food-chain"), false);
  assert.equal(result.some((entry) => entry.id === "green-fallback"), false);
  assert.deepEqual(result.find((entry) => entry.id === "green-local-a").tags, ["green"]);
});

test("bounded reservoir honors its total and per-role caps without dropping selected winners", () => {
  const make = (id) => richCandidate({
    candidate_id: id,
    coordinates: { lat: 43.51, lng: 16.44 + id.length * 0.0001 },
    candidate_status: "filled",
    planner_usable: true,
    covered_preferences: ["food"],
  });
  const candidates = [make("food-a"), make("food-b"), make("food-c")];
  const result = mapPlannerReservoirToSourceCandidates({
    selected: [selectedPick({ role: "food_anchor", candidate_id: "food-a", coordinates: candidates[0].coordinates })],
    plannerRoles: plannerRoles({ food_anchor: candidates }),
    limit: 2,
    perRole: 3,
  });
  assert.deepEqual(result.map((entry) => entry.id), ["food-a", "food-b"]);
});

test("walking target retains a bounded geographic frontier from the strongest planner-safe tier", () => {
  const make = (id, role, type, lng, over = {}) => richCandidate({
    candidate_id: id,
    label: id,
    type,
    coordinates: { lat: 50, lng },
    candidate_status: "filled",
    planner_usable: true,
    origin: "external_open",
    covered_preferences: [role === "food_anchor" ? "food" : role === "scenic_anchor" ? "scenic" : "coffee"],
    partial_preferences: [],
    local_feel_rank: 0,
    ...over,
  });
  const food = make("food-centre", "food_anchor", "restaurant", 14.4);
  const scenic = make("view-centre", "scenic_anchor", "viewpoint", 14.405);
  const scenicFrontier = make("view-frontier", "scenic_anchor", "viewpoint", 14.47);
  const coffee = make("coffee-centre", "coffee_fika_stop", "cafe", 14.41);
  const roles = {
    city: "agnostic-engine-area",
    requested_preferences: ["food", "scenic", "coffee"],
    capacity_frontier_candidates: [{ ...scenicFrontier, role: "scenic_anchor" }],
    roles: [
      { role: "food_anchor", slot: "anchor", requested: true, candidates: [food] },
      { role: "scenic_anchor", slot: "anchor", requested: true, candidates: [scenic, scenicFrontier] },
      { role: "coffee_fika_stop", slot: "stop", requested: true, candidates: [coffee] },
    ],
  };

  const result = mapPlannerReservoirToSourceCandidates({
    selected: [
      selectedPick({ role: "food_anchor", candidate_id: food.candidate_id, coordinates: food.coordinates }),
      selectedPick({ role: "scenic_anchor", candidate_id: scenic.candidate_id, coordinates: scenic.coordinates }),
      selectedPick({ role: "coffee_fika_stop", candidate_id: coffee.candidate_id, coordinates: coffee.coordinates }),
    ],
    plannerRoles: roles,
    perRole: 1,
    walkingKmTarget: 6,
    origin: { lat: 50, lng: 14.4 },
  });

  assert.deepEqual(result.map((entry) => entry.id), [
    "food-centre",
    "view-centre",
    "coffee-centre",
    "view-frontier",
  ]);
  assert.equal(result.at(-1).reservoir_frontier, true);
  assert.equal(result.at(-1).reservoir_support, true);
  assert.equal(result.at(-1).reservoir_selected, false);
});

test("walking frontier stays inactive when the safe reservoir already supports the target floor", () => {
  const make = (id, role, type, lng) => richCandidate({
    candidate_id: id,
    label: id,
    type,
    coordinates: { lat: 50, lng },
    candidate_status: "filled",
    planner_usable: true,
    covered_preferences: [role === "food_anchor" ? "food" : "scenic"],
    partial_preferences: [],
    local_feel_rank: 0,
  });
  const food = make("food-a", "food_anchor", "restaurant", 14.4);
  const scenic = make("view-a", "scenic_anchor", "viewpoint", 14.44);
  const farther = make("view-b", "scenic_anchor", "viewpoint", 14.48);
  const roles = {
    city: "agnostic-engine-area",
    roles: [
      { role: "food_anchor", slot: "anchor", requested: true, candidates: [food] },
      { role: "scenic_anchor", slot: "anchor", requested: true, candidates: [scenic, farther] },
    ],
  };

  const result = mapPlannerReservoirToSourceCandidates({
    selected: [
      selectedPick({ role: "food_anchor", candidate_id: food.candidate_id, coordinates: food.coordinates }),
      selectedPick({ role: "scenic_anchor", candidate_id: scenic.candidate_id, coordinates: scenic.coordinates }),
    ],
    plannerRoles: roles,
    perRole: 1,
    walkingKmTarget: 4,
  });

  assert.deepEqual(result.map((entry) => entry.id), ["food-a", "view-a"]);
  assert.equal(result.some((entry) => entry.reservoir_frontier), false);
});

test("walking frontier rechecks chains and experimental admission at the engine boundary", () => {
  const winner = richCandidate({
    candidate_id: "safe-winner",
    type: "viewpoint",
    coordinates: { lat: 50, lng: 14.4 },
    candidate_status: "filled",
    planner_usable: true,
    covered_preferences: ["scenic"],
    local_feel_rank: 0,
  });
  const partial = richCandidate({
    candidate_id: "partial-frontier",
    type: "viewpoint",
    coordinates: { lat: 50, lng: 14.49 },
    candidate_status: "partial",
    planner_usable: true,
    covered_preferences: ["scenic"],
    local_feel_rank: 0,
  });
  const chain = richCandidate({
    candidate_id: "chain-frontier",
    type: "restaurant",
    coordinates: { lat: 50, lng: 14.5 },
    candidate_status: "filled",
    planner_usable: true,
    covered_preferences: ["food"],
    local_feel_rank: 0,
    chain: true,
  });
  const experimental = richCandidate({
    candidate_id: "experimental-frontier",
    type: "cafe",
    coordinates: { lat: 50, lng: 14.51 },
    candidate_status: "partial",
    planner_usable: true,
    covered_preferences: ["coffee"],
    local_feel_rank: 0,
    experimental_admission: { allowed: true, policy: "experimental_inferred_external" },
  });
  const food = richCandidate({
    candidate_id: "safe-food",
    type: "restaurant",
    coordinates: { lat: 50, lng: 14.405 },
    candidate_status: "filled",
    planner_usable: true,
    covered_preferences: ["food"],
    local_feel_rank: 0,
  });
  const roles = {
    city: "agnostic-engine-area",
    capacity_frontier_candidates: [
      { ...partial, role: "scenic_anchor" },
      { ...chain, role: "food_anchor" },
      { ...experimental, role: "coffee_fika_stop" },
    ],
    roles: [
      { role: "scenic_anchor", slot: "anchor", requested: true, candidates: [winner, partial] },
      { role: "food_anchor", slot: "anchor", requested: true, candidates: [food, chain] },
      { role: "coffee_fika_stop", slot: "stop", requested: false, candidates: [experimental] },
    ],
  };

  const result = mapPlannerReservoirToSourceCandidates({
    selected: [
      selectedPick({ role: "scenic_anchor", candidate_id: winner.candidate_id, coordinates: winner.coordinates }),
      selectedPick({ role: "food_anchor", candidate_id: food.candidate_id, coordinates: food.coordinates }),
    ],
    plannerRoles: roles,
    perRole: 1,
    walkingKmTarget: 9,
  });

  assert.deepEqual(result.map((entry) => entry.id), ["safe-winner", "safe-food", "partial-frontier"]);
  assert.equal(result.at(-1).reservoir_frontier, true);
  assert.equal(result.some((entry) => entry.id === "chain-frontier"), false);
  assert.equal(result.some((entry) => entry.id === "experimental-frontier"), false);
});

test("a requested experimental winner does not multiply lower-trust role depth", () => {
  const admitted = (id) => richCandidate({
    candidate_id: id,
    coordinates: { lat: 43.51, lng: 16.44 + id.length * 0.0001 },
    candidate_status: "partial",
    planner_usable: true,
    covered_preferences: ["food"],
    experimental_admission: {
      allowed: true,
      policy: "experimental_inferred_external",
    },
  });
  const winner = admitted("food-low-a");
  const duplicateDepth = admitted("food-low-b");
  const roles = {
    city: "agnostic-engine-area",
    requested_preferences: ["food"],
    roles: [
      {
        role: "food_anchor",
        slot: "anchor",
        requested: true,
        candidates: [winner, duplicateDepth],
      },
    ],
  };

  const result = mapPlannerReservoirToSourceCandidates({
    selected: [
      selectedPick({
        role: "food_anchor",
        candidate_id: winner.candidate_id,
        coordinates: winner.coordinates,
      }),
    ],
    plannerRoles: roles,
    perRole: 2,
  });

  assert.deepEqual(result.map((entry) => entry.id), ["food-low-a"]);
  assert.equal(result[0].reservoir_selected, true, "the requested role representative remains available");
});

test("single requested role gains bounded planner-safe day support without false preference coverage", () => {
  const make = (id, role, type, covered) => richCandidate({
    candidate_id: id,
    label: id,
    type,
    coordinates: { lat: 43.51 + id.length * 0.0001, lng: 16.44 },
    candidate_status: "filled",
    planner_usable: true,
    origin: "external_open",
    covered_preferences: [covered],
    partial_preferences: [],
    missing_preferences: [],
    local_feel_rank: 0,
  });
  const foodWinner = make("food-a", "food_anchor", "restaurant", "food");
  const foodDepth = make("food-b", "food_anchor", "restaurant", "food");
  const scenicSupport = make("view-a", "scenic_anchor", "viewpoint", "scenic");
  const coffeeSupport = make("coffee-a", "coffee_fika_stop", "cafe", "coffee");
  const eveningOption = make("bar-a", "evening_bar_option", "bar", "bars");
  const roles = {
    city: "agnostic-engine-area",
    requested_preferences: ["food"],
    roles: [
      { role: "food_anchor", slot: "anchor", requested: true, candidates: [foodWinner, foodDepth] },
      { role: "scenic_anchor", slot: "anchor", requested: false, candidates: [scenicSupport] },
      { role: "coffee_fika_stop", slot: "stop", requested: false, candidates: [coffeeSupport] },
      { role: "evening_bar_option", slot: "option", requested: false, candidates: [eveningOption] },
    ],
  };

  const result = mapPlannerReservoirToSourceCandidates({
    selected: [
      selectedPick({
        role: "food_anchor",
        candidate_id: foodWinner.candidate_id,
        coordinates: foodWinner.coordinates,
      }),
    ],
    plannerRoles: roles,
  });

  assert.deepEqual(result.map((entry) => entry.id), ["food-a", "food-b", "view-a", "coffee-a"]);
  assert.deepEqual(result.map((entry) => entry.reservoir_support), [false, false, true, true]);
  assert.equal(result.some((entry) => entry.id === "bar-a"), false, "unrequested option roles do not pad the day");
  assert.deepEqual(result.find((entry) => entry.id === "view-a").tags, ["scenic"]);
  assert.deepEqual(result.find((entry) => entry.id === "view-a").covered_preferences, []);
  assert.deepEqual(result.find((entry) => entry.id === "view-a").missing_preferences, ["food"]);
  assert.deepEqual(result.find((entry) => entry.id === "food-a").covered_preferences, ["food"]);
});

test("a proven-closed supporting stop cannot re-enter after role selection", () => {
  const food = richCandidate({
    candidate_id: "food-a",
    type: "restaurant",
    candidate_status: "filled",
    planner_usable: true,
    covered_preferences: ["food"],
    local_feel_rank: 0,
  });
  const closedCoffee = richCandidate({
    candidate_id: "closed-coffee",
    type: "cafe",
    candidate_status: "filled",
    planner_usable: true,
    covered_preferences: ["coffee"],
    local_feel_rank: 0,
    availability: {
      eligible: false,
      status: "closed_for_window",
      reason: "opening_hours_closed_for_query_window",
    },
  });
  const roles = {
    city: "agnostic-engine-area",
    requested_preferences: ["food"],
    roles: [
      { role: "food_anchor", slot: "anchor", requested: true, candidates: [food] },
      { role: "coffee_fika_stop", slot: "stop", requested: false, candidates: [closedCoffee] },
    ],
  };

  const result = mapPlannerReservoirToSourceCandidates({
    selected: [selectedPick({ role: "food_anchor", candidate_id: "food-a", coordinates: food.coordinates })],
    plannerRoles: roles,
  });

  assert.deepEqual(result.map((entry) => entry.id), ["food-a"]);
});

test("unrequested day support admits at most one experimental bridge after gate-passing support", () => {
  const requestedFood = richCandidate({
    candidate_id: "requested-food",
    type: "restaurant",
    candidate_status: "partial",
    planner_usable: true,
    covered_preferences: ["food"],
    experimental_admission: {
      allowed: true,
      policy: "experimental_inferred_external",
    },
  });
  const safeScenic = richCandidate({
    candidate_id: "safe-view",
    type: "viewpoint",
    candidate_status: "partial",
    planner_usable: true,
    covered_preferences: ["scenic"],
  });
  const admittedCoffee = richCandidate({
    candidate_id: "admitted-coffee",
    type: "cafe",
    candidate_status: "partial",
    planner_usable: true,
    covered_preferences: ["coffee"],
    experimental_admission: {
      allowed: true,
      policy: "experimental_inferred_external",
    },
  });
  const admittedMarket = richCandidate({
    candidate_id: "admitted-market",
    type: "market",
    candidate_status: "partial",
    planner_usable: true,
    covered_preferences: ["markets"],
    experimental_admission: {
      allowed: true,
      policy: "experimental_inferred_external",
    },
  });
  const roles = {
    city: "agnostic-engine-area",
    requested_preferences: ["food"],
    roles: [
      { role: "food_anchor", slot: "anchor", requested: true, candidates: [requestedFood] },
      { role: "scenic_anchor", slot: "anchor", requested: false, candidates: [safeScenic] },
      { role: "coffee_fika_stop", slot: "stop", requested: false, candidates: [admittedCoffee] },
      { role: "market_stop", slot: "stop", requested: false, candidates: [admittedMarket] },
    ],
  };

  const result = mapPlannerReservoirToSourceCandidates({
    selected: [
      selectedPick({
        role: "food_anchor",
        candidate_id: requestedFood.candidate_id,
        coordinates: requestedFood.coordinates,
      }),
    ],
    plannerRoles: roles,
  });

  assert.deepEqual(result.map((entry) => entry.id), ["requested-food", "safe-view", "admitted-coffee"]);
  assert.equal(result[0].reservoir_selected, true, "requested experimental admission remains available");
  assert.equal(result[1].reservoir_support, true, "gate-passing support remains available");
  assert.equal(result[2].reservoir_support, true, "one bounded experimental bridge may complete the thin day");
  assert.equal(result.some((entry) => entry.id === "admitted-market"), false);
});

test("unrequested experimental candidates cannot create support without a gate-passing spine", () => {
  const requestedFood = richCandidate({
    candidate_id: "requested-food",
    type: "restaurant",
    candidate_status: "partial",
    planner_usable: true,
    covered_preferences: ["food"],
    experimental_admission: { allowed: true, policy: "experimental_inferred_external" },
  });
  const admittedCoffee = richCandidate({
    candidate_id: "admitted-coffee",
    type: "cafe",
    candidate_status: "partial",
    planner_usable: true,
    covered_preferences: ["coffee"],
    experimental_admission: { allowed: true, policy: "experimental_inferred_external" },
  });
  const roles = {
    city: "agnostic-engine-area",
    requested_preferences: ["food"],
    roles: [
      { role: "food_anchor", slot: "anchor", requested: true, candidates: [requestedFood] },
      { role: "coffee_fika_stop", slot: "stop", requested: false, candidates: [admittedCoffee] },
    ],
  };

  const result = mapPlannerReservoirToSourceCandidates({
    selected: [
      selectedPick({
        role: "food_anchor",
        candidate_id: requestedFood.candidate_id,
        coordinates: requestedFood.coordinates,
      }),
    ],
    plannerRoles: roles,
  });

  assert.deepEqual(result.map((entry) => entry.id), ["requested-food"]);
});

test("local independent support beats a chain in the same role", () => {
  const food = richCandidate({
    candidate_id: "food-a",
    type: "restaurant",
    candidate_status: "filled",
    planner_usable: true,
    covered_preferences: ["food"],
    local_feel_rank: 0,
  });
  const chainCoffee = richCandidate({
    candidate_id: "chain-coffee",
    type: "cafe",
    candidate_status: "filled",
    planner_usable: true,
    covered_preferences: ["coffee"],
    local_feel_rank: 2,
    chain: true,
    brand: "Global Coffee",
  });
  const localCoffee = richCandidate({
    candidate_id: "local-coffee",
    type: "cafe",
    candidate_status: "filled",
    planner_usable: true,
    covered_preferences: ["coffee"],
    local_feel_rank: 0,
  });
  const roles = {
    city: "agnostic-engine-area",
    requested_preferences: ["food"],
    roles: [
      { role: "food_anchor", slot: "anchor", requested: true, candidates: [food] },
      {
        role: "coffee_fika_stop",
        slot: "stop",
        requested: false,
        candidates: [chainCoffee, localCoffee],
      },
    ],
  };

  const result = mapPlannerReservoirToSourceCandidates({
    selected: [selectedPick({ role: "food_anchor", candidate_id: "food-a", coordinates: food.coordinates })],
    plannerRoles: roles,
  });

  assert.deepEqual(result.map((entry) => entry.id), ["food-a", "local-coffee"]);
  assert.equal(result.some((entry) => entry.chain === true), false);
});

test("sparse single-role supply stays sparse instead of fabricating support", () => {
  const food = richCandidate({
    candidate_id: "food-only",
    type: "restaurant",
    candidate_status: "partial",
    planner_usable: true,
    covered_preferences: ["food"],
    partial_preferences: [],
  });
  const fallbackScenic = richCandidate({
    candidate_id: "weak-view",
    type: "viewpoint",
    candidate_status: "fallback",
    planner_usable: false,
    covered_preferences: ["scenic"],
  });
  const roles = {
    city: "agnostic-engine-area",
    requested_preferences: ["food"],
    roles: [
      { role: "food_anchor", slot: "anchor", requested: true, candidates: [food] },
      { role: "scenic_anchor", slot: "anchor", requested: false, candidates: [fallbackScenic] },
    ],
  };

  const result = mapPlannerReservoirToSourceCandidates({
    selected: [selectedPick({ role: "food_anchor", candidate_id: "food-only", coordinates: food.coordinates })],
    plannerRoles: roles,
  });

  assert.deepEqual(result.map((entry) => entry.id), ["food-only"]);
});

test("a pin reaches an experimentally admitted candidate the ranking left out", () => {
  // Found on staging: nearly every real open-data place on this path is
  // experimentally admitted (the shared gates reject it; the agnostic
  // experiment admits it anyway), and the composed day routes to those
  // candidates whenever the combination selects them. The pin hoist copied the
  // role-DEPTH guard, so the very same candidate became unpinnable — the verb
  // worked only for the rare candidate that cleared the shared gates outright.
  const admitted = (id) => richCandidate({
    candidate_id: id,
    coordinates: { lat: 43.51, lng: 16.44 + id.length * 0.0001 },
    candidate_status: "partial",
    planner_usable: true,
    covered_preferences: ["food"],
    experimental_admission: { allowed: true, policy: "experimental_inferred_external" },
  });
  const chosen = admitted("food-chosen");
  const wanted = admitted("food-wanted");
  const roles = {
    city: "agnostic-engine-area",
    requested_preferences: ["food"],
    roles: [
      { role: "food_anchor", slot: "anchor", requested: true, candidates: [chosen, wanted] },
    ],
  };
  const selected = [
    selectedPick({
      role: "food_anchor",
      candidate_id: chosen.candidate_id,
      coordinates: chosen.coordinates,
    }),
  ];

  // Without a pin, role depth is still not multiplied by admitted candidates.
  assert.deepEqual(
    mapPlannerReservoirToSourceCandidates({ selected, plannerRoles: roles, perRole: 2 })
      .map((entry) => entry.id),
    ["food-chosen"],
  );

  // With a pin, the named place reaches the engine.
  const pinned = mapPlannerReservoirToSourceCandidates({
    selected,
    plannerRoles: roles,
    perRole: 2,
    pinnedIds: ["food-wanted"],
  });
  assert.ok(
    pinned.map((entry) => entry.id).includes("food-wanted"),
    "an explicit keep must reach the engine even when the candidate is admitted rather than gate-passing",
  );
  assert.ok(
    pinned.map((entry) => entry.id).includes("food-chosen"),
    "and it does not displace the role's own choice",
  );
});

test("a pin still cannot reach outside the role reservoir", () => {
  const roles = {
    city: "agnostic-engine-area",
    requested_preferences: ["food"],
    roles: [
      {
        role: "food_anchor",
        slot: "anchor",
        requested: true,
        candidates: [
          richCandidate({
            candidate_id: "food-chosen",
            coordinates: { lat: 43.51, lng: 16.44 },
            candidate_status: "partial",
            planner_usable: true,
            covered_preferences: ["food"],
          }),
        ],
      },
    ],
  };
  const result = mapPlannerReservoirToSourceCandidates({
    selected: [
      selectedPick({ role: "food_anchor", candidate_id: "food-chosen", coordinates: { lat: 43.51, lng: 16.44 } }),
    ],
    plannerRoles: roles,
    pinnedIds: ["never-loaded"],
  });
  assert.deepEqual(result.map((entry) => entry.id), ["food-chosen"]);
});
