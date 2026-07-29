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
