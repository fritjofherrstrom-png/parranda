const test = require("node:test");
const assert = require("node:assert/strict");

const { selectAgnosticCandidateSet } = require("../server/planner/agnostic-candidate-set");

function candidate(id, {
  lat,
  lng,
  role,
  covered = [],
  partial = [],
  spine = false,
  chain = false,
  localFeelRank = chain ? 2 : 0,
  confidence = "medium",
  operationalRank = 0,
  type = role,
} = {}) {
  return {
    id,
    name: id,
    lat,
    lng,
    role,
    routeRoles: role ? [role] : [],
    coveredPreferences: covered,
    partialPreferences: partial,
    reservoirSpine: spine,
    chain,
    localFeelRank,
    operationalViabilityRank: operationalRank,
    type,
    trust: { confidence, human_verified: false },
  };
}

function ranked(item, score = 10) {
  return { item, score };
}

test("urban set keeps requested spine and adds a new daypart instead of another same-role top score", () => {
  const center = { lat: 59.3293, lng: 18.0686 };
  const food = candidate("food", { ...center, role: "food_anchor", covered: ["food"], spine: true });
  const culture = candidate("culture", { lat: 59.331, lng: 18.067, role: "culture_stop", covered: ["culture"], spine: true });
  const view = candidate("view", { lat: 59.332, lng: 18.069, role: "scenic_anchor", covered: ["scenic"], spine: true });
  const duplicateFood = candidate("food-2", { lat: 59.3305, lng: 18.068, role: "food_anchor", covered: ["food"] });
  const coffee = candidate("coffee", { lat: 59.3285, lng: 18.0675, role: "coffee_fika_stop" });

  const result = selectAgnosticCandidateSet({
    rankedCandidates: [ranked(food), ranked(culture), ranked(view), ranked(duplicateFood, 30), ranked(coffee, 5)],
    desiredCount: 4,
    requestedPreferences: ["food", "culture", "scenic"],
    start: center,
    shape: "loop",
    targetKm: 6,
  });

  assert.deepEqual(result.selected.map((entry) => entry.id).sort(), ["coffee", "culture", "food", "view"]);
  assert.equal(result.diagnostics.exact_preference_count, 3);
  assert.equal(result.diagnostics.spine_role_count, 3);
  assert.equal(result.diagnostics.daypart_count, 3);
});

test("local independent candidate beats a marginally closer chain without a city name rule", () => {
  const anchor = { lat: 48.8566, lng: 2.3522 };
  const spine = candidate("museum", { ...anchor, role: "culture_stop", covered: ["culture"], spine: true });
  const chain = candidate("chain-coffee", {
    lat: 48.857,
    lng: 2.3524,
    role: "coffee_fika_stop",
    chain: true,
  });
  const independent = candidate("independent-coffee", {
    lat: 48.859,
    lng: 2.354,
    role: "coffee_fika_stop",
  });

  const result = selectAgnosticCandidateSet({
    rankedCandidates: [ranked(spine), ranked(chain, 25), ranked(independent, 5)],
    desiredCount: 2,
    requestedPreferences: ["culture"],
    start: anchor,
    shape: "loop",
    targetKm: 4,
  });

  assert.deepEqual(result.selected.map((entry) => entry.id).sort(), ["independent-coffee", "museum"]);
  assert.equal(result.diagnostics.chain_count, 0);
});

test("regional sparse set accepts a farther candidate when it adds genuinely missing requested coverage", () => {
  const anchor = { lat: 55.556, lng: 14.35 };
  const localFood = candidate("local-food", { ...anchor, role: "food_anchor", covered: ["food"], spine: true });
  const nearbyFood = candidate("nearby-food", { lat: 55.558, lng: 14.351, role: "food_anchor", covered: ["food"] });
  const regionalMarket = candidate("regional-market", {
    lat: 55.61,
    lng: 14.29,
    role: "market_stop",
    covered: ["markets"],
  });

  const result = selectAgnosticCandidateSet({
    rankedCandidates: [ranked(localFood), ranked(nearbyFood, 40), ranked(regionalMarket, 3)],
    desiredCount: 2,
    requestedPreferences: ["food", "markets"],
    start: anchor,
    shape: "loop",
    targetKm: 6,
  });

  assert.deepEqual(result.selected.map((entry) => entry.id).sort(), ["local-food", "regional-market"]);
  assert.equal(result.diagnostics.exact_preference_count, 2);
  assert.equal(result.diagnostics.within_budget, false, "the distance remains visible rather than being disguised");
});

test("equally relevant support stays compact around a different urban anchor", () => {
  const anchor = { lat: 50.0755, lng: 14.4378 };
  const spine = candidate("bar", { ...anchor, role: "evening_bar_option", covered: ["bars"], spine: true });
  const nearPark = candidate("near-park", { lat: 50.078, lng: 14.439, role: "green_walk_stop" });
  const farPark = candidate("far-park", { lat: 50.14, lng: 14.52, role: "green_walk_stop" });

  const result = selectAgnosticCandidateSet({
    rankedCandidates: [ranked(spine), ranked(farPark, 50), ranked(nearPark, 2)],
    desiredCount: 2,
    requestedPreferences: ["bars"],
    start: anchor,
    shape: "loop",
    targetKm: 4,
  });

  assert.deepEqual(result.selected.map((entry) => entry.id).sort(), ["bar", "near-park"]);
  assert.equal(result.diagnostics.within_budget, true);
});

test("selection is deterministic across candidate input order and never mutates inputs", () => {
  const anchor = { lat: 41.9028, lng: 12.4964 };
  const entries = [
    ranked(candidate("a", { ...anchor, role: "food_anchor", covered: ["food"], spine: true })),
    ranked(candidate("b", { lat: 41.904, lng: 12.497, role: "culture_stop" })),
    ranked(candidate("c", { lat: 41.905, lng: 12.498, role: "culture_stop" })),
  ];
  const before = structuredClone(entries);
  const first = selectAgnosticCandidateSet({
    rankedCandidates: entries,
    desiredCount: 2,
    requestedPreferences: ["food"],
    start: anchor,
    targetKm: 4,
  });
  const second = selectAgnosticCandidateSet({
    rankedCandidates: [...entries].reverse(),
    desiredCount: 2,
    requestedPreferences: ["food"],
    start: anchor,
    targetKm: 4,
  });

  assert.deepEqual(first.selected.map((entry) => entry.id).sort(), second.selected.map((entry) => entry.id).sort());
  assert.deepEqual(entries, before);
});

test("a requested preference keeps a representative inside the bounded evaluation pool", () => {
  const anchor = { lat: 52.52, lng: 13.405 };
  const food = Array.from({ length: 12 }, (_, index) =>
    ranked(
      candidate(`food-${index}`, {
        lat: anchor.lat + index * 0.0002,
        lng: anchor.lng,
        role: "food_anchor",
        covered: ["food"],
        type: "restaurant",
      }),
      100 - index,
    ),
  );
  const view = ranked(
    candidate("view", {
      lat: anchor.lat + 0.002,
      lng: anchor.lng + 0.002,
      role: "scenic_anchor",
      covered: ["scenic"],
      type: "viewpoint",
    }),
    1,
  );

  const result = selectAgnosticCandidateSet({
    rankedCandidates: [...food, view],
    desiredCount: 4,
    requestedPreferences: ["food", "scenic"],
    start: anchor,
    shape: "loop",
    targetKm: 6,
  });

  assert.ok(result.selected.some((entry) => entry.id === "view"));
  assert.deepEqual(result.diagnostics.covered_preferences, ["food", "scenic"]);
  assert.deepEqual(result.diagnostics.missing_preferences, []);
});

test("walking target is a fit band, so equally useful days do not collapse to the shortest set", () => {
  const anchor = { lat: 59.3293, lng: 18.0686 };
  const food = candidate("food", {
    ...anchor,
    role: "food_anchor",
    covered: ["food"],
    spine: true,
    type: "restaurant",
  });
  const scenic = candidate("scenic", {
    lat: 59.337,
    lng: 18.0686,
    role: "scenic_anchor",
    covered: ["scenic"],
    spine: true,
    type: "viewpoint",
  });
  const nearCulture = candidate("near-culture", {
    lat: 59.332,
    lng: 18.0705,
    role: "culture_stop",
    covered: ["culture"],
    type: "museum",
  });
  const fullerCulture = candidate("fuller-culture", {
    lat: 59.3293,
    lng: 18.092,
    role: "culture_stop",
    covered: ["culture"],
    type: "museum",
  });

  const result = selectAgnosticCandidateSet({
    rankedCandidates: [ranked(food), ranked(scenic), ranked(nearCulture, 50), ranked(fullerCulture, 5)],
    desiredCount: 3,
    requestedPreferences: ["food", "culture", "scenic"],
    start: anchor,
    shape: "loop",
    targetKm: 6,
  });

  assert.ok(result.selected.some((entry) => entry.id === "fuller-culture"));
  assert.ok(!result.selected.some((entry) => entry.id === "near-culture"));
  assert.equal(result.diagnostics.within_target_band, true);
  assert.ok(result.diagnostics.estimated_km >= result.diagnostics.target_floor_km);
});

test("an equally useful independent family beats a duplicate family with a higher individual score", () => {
  const anchor = { lat: 50.0755, lng: 14.4378 };
  const food = candidate("food", {
    ...anchor,
    role: "food_anchor",
    covered: ["food"],
    spine: true,
    type: "restaurant",
  });
  const museum = candidate("museum", {
    lat: 50.078,
    lng: 14.439,
    role: "culture_stop",
    covered: ["culture"],
    type: "museum",
  });
  const duplicateMuseum = candidate("museum-2", {
    lat: 50.079,
    lng: 14.44,
    role: "culture_stop",
    covered: ["culture"],
    type: "museum",
  });
  const gallery = candidate("gallery", {
    lat: 50.079,
    lng: 14.44,
    role: "culture_stop",
    covered: ["culture"],
    type: "gallery",
  });

  const result = selectAgnosticCandidateSet({
    rankedCandidates: [ranked(food), ranked(museum), ranked(duplicateMuseum, 50), ranked(gallery, 5)],
    desiredCount: 3,
    requestedPreferences: ["food", "culture"],
    start: anchor,
    targetKm: 4,
  });

  assert.ok(result.selected.some((entry) => entry.id === "gallery"));
  assert.ok(!result.selected.some((entry) => entry.id === "museum-2"));
  assert.equal(result.diagnostics.duplicate_family_count, 0);
});

test("day-value repair adds a distinct useful stop when the fixed set under-fills the walking band", () => {
  const anchor = { lat: 48.8566, lng: 2.3522 };
  const food = candidate("food", {
    ...anchor,
    role: "food_anchor",
    covered: ["food"],
    spine: true,
    type: "restaurant",
  });
  const culture = candidate("culture", {
    lat: 48.861,
    lng: 2.353,
    role: "culture_stop",
    covered: ["culture"],
    spine: true,
    type: "museum",
  });
  const view = candidate("view", {
    lat: 48.858,
    lng: 2.361,
    role: "scenic_anchor",
    covered: ["scenic"],
    spine: true,
    type: "viewpoint",
  });
  const independentCoffee = candidate("coffee", {
    lat: 48.8536,
    lng: 2.3522,
    role: "coffee_fika_stop",
    type: "cafe",
  });

  const result = selectAgnosticCandidateSet({
    rankedCandidates: [ranked(food), ranked(culture), ranked(view), ranked(independentCoffee, 4)],
    desiredCount: 3,
    requestedPreferences: ["food", "culture", "scenic"],
    start: anchor,
    shape: "loop",
    targetKm: 6,
    allowExpansion: true,
  });

  assert.deepEqual(result.selected.map((entry) => entry.id).sort(), ["coffee", "culture", "food", "view"]);
  assert.equal(result.diagnostics.repair_applied, true);
  assert.equal(result.diagnostics.base_candidate_count, 3);
  assert.equal(result.diagnostics.selected_candidate_count, 4);
  assert.ok(result.diagnostics.repair_reasons.includes("adds_daypart"));
  assert.ok(result.diagnostics.repair_reasons.includes("uses_walking_target"));
  assert.equal(result.diagnostics.within_budget, true);
});

test("day-value repair does not add an over-budget candidate", () => {
  const anchor = { lat: 41.9028, lng: 12.4964 };
  const entries = [
    ranked(candidate("food", { ...anchor, role: "food_anchor", covered: ["food"], spine: true, type: "restaurant" })),
    ranked(candidate("culture", { lat: 41.906, lng: 12.498, role: "culture_stop", covered: ["culture"], spine: true, type: "museum" })),
    ranked(candidate("view", { lat: 41.904, lng: 12.502, role: "scenic_anchor", covered: ["scenic"], spine: true, type: "viewpoint" })),
    ranked(candidate("far-coffee", { lat: 42.03, lng: 12.62, role: "coffee_fika_stop", type: "cafe" }), 50),
  ];

  const result = selectAgnosticCandidateSet({
    rankedCandidates: entries,
    desiredCount: 3,
    requestedPreferences: ["food", "culture", "scenic"],
    start: anchor,
    shape: "loop",
    targetKm: 6,
    allowExpansion: true,
  });

  assert.equal(result.selected.length, 3);
  assert.equal(result.diagnostics.repair_applied, false);
  assert.ok(!result.selected.some((entry) => entry.id === "far-coffee"));
});

test("day-value repair may add one independent second hit for a requested preference", () => {
  const anchor = { lat: 59.3293, lng: 18.0686 };
  const entries = [
    ranked(candidate("food", { ...anchor, role: "food_anchor", covered: ["food"], spine: true, type: "restaurant" })),
    ranked(candidate("culture", { lat: 59.333, lng: 18.069, role: "culture_stop", covered: ["culture"], spine: true, type: "museum" })),
    ranked(candidate("view", { lat: 59.33, lng: 18.078, role: "scenic_anchor", covered: ["scenic"], spine: true, type: "viewpoint" })),
    ranked(candidate("independent-museum", { lat: 59.3243, lng: 18.0686, role: "culture_stop", covered: ["culture"], type: "museum" }), 5),
  ];

  const result = selectAgnosticCandidateSet({
    rankedCandidates: entries,
    desiredCount: 3,
    requestedPreferences: ["food", "culture", "scenic"],
    start: anchor,
    shape: "loop",
    targetKm: 6,
    allowExpansion: true,
  });

  assert.equal(result.selected.length, 4);
  assert.ok(result.selected.some((entry) => entry.id === "independent-museum"));
  assert.ok(result.diagnostics.repair_reasons.includes("adds_requested_depth"));
  assert.ok(result.diagnostics.repair_reasons.includes("uses_walking_target"));
  assert.equal(result.diagnostics.chain_count, 0);
});

test("day-value repair will not stretch a day with chain or duplicate filler", () => {
  const anchor = { lat: 52.52, lng: 13.405 };
  const entries = [
    ranked(candidate("food", { ...anchor, role: "food_anchor", covered: ["food"], spine: true, type: "restaurant" })),
    ranked(candidate("culture", { lat: 52.524, lng: 13.406, role: "culture_stop", covered: ["culture"], spine: true, type: "museum" })),
    ranked(candidate("view", { lat: 52.521, lng: 13.414, role: "scenic_anchor", covered: ["scenic"], spine: true, type: "viewpoint" })),
    ranked(candidate("chain-food", { lat: 52.508, lng: 13.42, role: "food_anchor", chain: true, type: "restaurant" }), 40),
    ranked(candidate("duplicate-museum", { lat: 52.507, lng: 13.419, role: "culture_stop", type: "museum" }), 30),
  ];

  const result = selectAgnosticCandidateSet({
    rankedCandidates: entries,
    desiredCount: 3,
    requestedPreferences: ["food", "culture", "scenic"],
    start: anchor,
    shape: "loop",
    targetKm: 6,
    allowExpansion: true,
  });

  assert.equal(result.selected.length, 3);
  assert.equal(result.diagnostics.repair_applied, false);
  assert.equal(result.diagnostics.chain_count, 0);
  assert.equal(result.diagnostics.duplicate_family_count, 0);
});

test("day-value repair cannot turn a coherent base into a backtracking daypart route", () => {
  const anchor = { lat: 59.3293, lng: 18.0686 };
  const entries = [
    ranked(candidate("view", { ...anchor, role: "scenic_anchor", covered: ["scenic"], spine: true, type: "viewpoint" })),
    ranked(candidate("food", { lat: anchor.lat, lng: anchor.lng + 0.01, role: "food_anchor", covered: ["food"], spine: true, type: "restaurant" })),
    ranked(candidate("bar", { lat: anchor.lat, lng: anchor.lng + 0.02, role: "evening_bar_option", covered: ["bars"], spine: true, type: "bar" })),
    ranked(candidate("backtracking-coffee", { lat: anchor.lat, lng: anchor.lng + 0.019, role: "coffee_fika_stop", type: "cafe" }), 5),
  ];

  const result = selectAgnosticCandidateSet({
    rankedCandidates: entries,
    desiredCount: 3,
    requestedPreferences: ["scenic", "food", "bars"],
    start: anchor,
    shape: "loop",
    targetKm: 6,
    allowExpansion: true,
  });

  assert.deepEqual(result.selected.map((entry) => entry.id).sort(), ["bar", "food", "view"]);
  assert.equal(result.diagnostics.repair_applied, false);
  assert.equal(result.diagnostics.daypart_walkable, true);
});
