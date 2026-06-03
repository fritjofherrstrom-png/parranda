const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classifyCatalogDensity,
  calibrateSource,
  INFLUENCE_MIN,
  INFLUENCE_MAX,
} = require("../server/candidates/source-calibration");

// --- density ---------------------------------------------------------------
test("catalog density classifies by curated real-place count", () => {
  assert.equal(classifyCatalogDensity(0), "absent");
  assert.equal(classifyCatalogDensity(1), "thin");
  assert.equal(classifyCatalogDensity(24), "thin");
  assert.equal(classifyCatalogDensity(25), "rich");
  assert.equal(classifyCatalogDensity(94), "rich");
  assert.equal(classifyCatalogDensity(undefined), "absent");
});

// --- baseline + bounds -----------------------------------------------------
test("official open data outweighs generic map at baseline", () => {
  const official = calibrateSource({ family: "official", density: "rich", diversity: 2 });
  const map = calibrateSource({ family: "map", density: "rich", diversity: 2 });
  assert.ok(official.influence > map.influence);
});

test("influence is always clamped to [-1, 1]", () => {
  const maxed = calibrateSource({
    family: "official",
    intents: ["swimming"],
    density: "thin",
    diversity: 5,
    freshness: "live",
  });
  assert.ok(maxed.influence <= INFLUENCE_MAX);
  const floored = calibrateSource({ family: "map", density: "rich", diversity: 0, freshness: "stale", lens: "local" });
  assert.ok(floored.influence >= INFLUENCE_MIN);
});

// --- adaptivity ------------------------------------------------------------
test("thin/absent cities boost credible open + official sources", () => {
  const thin = calibrateSource({ family: "official", density: "thin", diversity: 2 });
  const rich = calibrateSource({ family: "official", density: "rich", diversity: 2 });
  assert.ok(thin.influence > rich.influence);
  assert.ok(thin.reasons.some((r) => r.startsWith("thin_city_boost")));
});

test("intent × family affinity lifts the right source for the intent", () => {
  // food → editorial (food writers) matters more than for a neutral intent
  const foodEditorial = calibrateSource({ family: "editorial", intents: ["food"], density: "rich", diversity: 2 });
  const neutralEditorial = calibrateSource({ family: "editorial", intents: ["markets"], density: "rich", diversity: 2 });
  assert.ok(foodEditorial.influence > neutralEditorial.influence);

  // nightlife → live/community pulse matters more
  const barsLive = calibrateSource({ family: "live", intents: ["bars"], density: "rich", diversity: 2 });
  assert.ok(barsLive.reasons.some((r) => r.includes("intent_affinity:bars->live")));
});

test("local lens lifts editorial/community and softens generic map", () => {
  const localEditorial = calibrateSource({ family: "editorial", lens: "local", density: "rich", diversity: 2 });
  const touristEditorial = calibrateSource({ family: "editorial", lens: "first_time", density: "rich", diversity: 2 });
  assert.ok(localEditorial.influence > touristEditorial.influence);

  const localMap = calibrateSource({ family: "map", lens: "local", density: "rich", diversity: 2 });
  const touristMap = calibrateSource({ family: "map", lens: "first_time", density: "rich", diversity: 2 });
  assert.ok(localMap.influence < touristMap.influence); // map softened locally
});

test("corroboration across families raises influence; a lone family lowers it", () => {
  const three = calibrateSource({ family: "map", density: "rich", diversity: 3 });
  const two = calibrateSource({ family: "map", density: "rich", diversity: 2 });
  const one = calibrateSource({ family: "map", density: "rich", diversity: 1 });
  assert.ok(three.influence > two.influence);
  assert.ok(two.influence > one.influence);
});

test("stale evidence is penalized", () => {
  const fresh = calibrateSource({ family: "official", density: "rich", diversity: 2, freshness: "live" });
  const stale = calibrateSource({ family: "official", density: "rich", diversity: 2, freshness: "stale" });
  assert.ok(fresh.influence > stale.influence);
});

// --- GUARDRAILS ------------------------------------------------------------
test("GUARDRAIL: calibration never reads popularity/consensus (it cannot rank)", () => {
  const plain = calibrateSource({ family: "map", intents: ["food"], density: "rich", diversity: 2 });
  const withConsensus = calibrateSource({
    family: "map",
    intents: ["food"],
    density: "rich",
    diversity: 2,
    // these MUST be ignored — consensus corroborates existence, never ranks
    popularity: 9000,
    rating: 4.9,
    review_count: 12000,
  });
  assert.equal(withConsensus.influence, plain.influence);
});

test("calibration is pure and deterministic", () => {
  const input = { family: "editorial", intents: ["food"], lens: "local", density: "thin", diversity: 2, freshness: "fresh" };
  assert.deepEqual(calibrateSource(input), calibrateSource(input));
});
