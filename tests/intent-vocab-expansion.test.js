/**
 * Intent vocabulary + OSM tag mapping expansion (#242).
 *
 * After #241 let open data reach Athens/Malmö flows, the limiter was vocabulary:
 * taverna-style food, café/fika/coffee, pub, thrift, bathing, lookout. These
 * tests prove the broader vocabulary turns real open records into useful moves
 * WITHOUT generic-map drift. Deterministic — external records injected via the
 * trusted channel, no live network.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildCandidateBlitzDecision } = require("../server/candidates/blitz-candidate-mode");
const { buildAgnosticCityContext } = require("../server/candidates/agnostic-context");
const { matchCandidateToIntent, normalizeUserIntents } = require("../server/candidates/intent-vocabulary");
const { mapOsmElement } = require("../server/place-candidates/open-data-loader");
const { osmRecord, DATE } = require("./scenario-helpers");

const athens = require("../server/cities/athens/index.js");

function agnosticDecision(records, preferences, over = {}) {
  const ctx = buildAgnosticCityContext({ lat: 41.9, lng: 12.5, todayIsoDate: () => DATE });
  return buildCandidateBlitzDecision(
    ctx,
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences, ...over },
    records ? { external_provider: { dataset: records } } : {},
  );
}

// --- 1. taverna / food ------------------------------------------------------
test("a taverna-typed record matches food intent (Greek/Italian eateries)", () => {
  assert.equal(matchCandidateToIntent({ type: "taverna" }, "food").level, "strong");
  assert.equal(matchCandidateToIntent({ type: "tavern" }, "food").level, "strong");

  // end to end: an external taverna with no 'mat' tag still wins food
  const out = agnosticDecision(
    [osmRecord("o-tav", "Taverna To Steki", "taverna", 41.9, 12.5, { tags: [], wikidata: "Q1" })],
    ["food"],
  );
  assert.equal(out.best_move.origin, "external_open");
  assert.ok(out.best_move.covered_preferences.includes("food"));
  assert.equal(out.best_move.provenance.human_verified, false);
  assert.notEqual(out.confidence.level, "high"); // source-backed, never citypack
});

test("Athens curated tavernas still serve food (no regression)", () => {
  const out = buildCandidateBlitzDecision(athens, { candidate_mode: 1, date: DATE, preferences: ["food"] });
  assert.ok(out.best_move.covered_preferences.includes("food"));
  assert.equal(out.best_move.origin, "curated_catalog");
});

// --- 2. café / fika / coffee ------------------------------------------------
test("a café record covers the coffee/fika intent, not only weak food", () => {
  assert.equal(matchCandidateToIntent({ type: "cafe" }, "coffee").level, "strong");
  assert.deepEqual(normalizeUserIntents(["fika"]).intents, ["coffee"]);
  assert.deepEqual(normalizeUserIntents(["coffee"]).intents, ["coffee"]);

  const out = agnosticDecision(
    [osmRecord("o-cafe", "Lilla Kafferosteriet", "cafe", 41.9, 12.5, { tags: ["fika"], wikidata: "Q2" })],
    ["fika"],
  );
  assert.equal(out.best_move.origin, "external_open");
  assert.ok(out.best_move.covered_preferences.includes("coffee"));
  assert.equal(out.best_move.match_tier, "primary"); // covered, not a weak fallback
});

test("a café is only a PARTIAL food match (not covered) — no over-coverage", () => {
  // a café answering a 'food' request is partial, never a strong cover
  const out = agnosticDecision(
    [osmRecord("o-cafe2", "Cafe Aroma", "cafe", 41.9, 12.5, { tags: ["fika"], wikidata: "Q3" })],
    ["food"],
  );
  assert.ok(!out.best_move.covered_preferences.includes("food"));
  assert.ok(out.best_move.partial_preferences.includes("food"));
  assert.equal(out.best_move.match_tier, "supporting");
});

// --- 3. vintage / second-hand ----------------------------------------------
test("thrift / charity records map to second-hand, never generic shopping", () => {
  assert.equal(matchCandidateToIntent({ type: "charity-shop" }, "second_hand").level, "strong");
  assert.equal(matchCandidateToIntent({ type: "shop", tags: ["thrift"] }, "second_hand").level, "strong");
  // generic retail is still NOT second hand
  assert.equal(matchCandidateToIntent({ type: "shop", tags: ["shopping"] }, "second_hand").level, "none");

  const out = agnosticDecision(
    [osmRecord("o-thrift", "Myrorna", "vintage-shop", 41.9, 12.5, { tags: ["second_hand", "charity"], wikidata: "Q4" })],
    ["second_hand"],
  );
  assert.ok(out.best_move.covered_preferences.includes("second_hand"));
});

// --- 4. swimming / coast ----------------------------------------------------
test("bathing / swimming_area records map cleanly to swimming", () => {
  assert.equal(matchCandidateToIntent({ type: "swimming-area" }, "swimming").level, "strong");
  assert.equal(matchCandidateToIntent({ type: "beach", tags: ["bathing"] }, "swimming").level, "strong");
});

test("#241 Athens swimming gap-fill still works (regression)", () => {
  const out = buildCandidateBlitzDecision(
    athens,
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["swimming"] },
    { external_provider: { dataset: [osmRecord("a-beach", "Kavouri Beach", "beach", 37.82, 23.78, { tags: ["coast"], wikidata: "Q5" })] } },
  );
  assert.equal(out.best_move.origin, "external_open");
  assert.ok(out.best_move.covered_preferences.includes("swimming"));
});

// --- 5. scenic / viewpoint --------------------------------------------------
test("viewpoint / lookout records remain scenic (no regression)", () => {
  assert.equal(matchCandidateToIntent({ type: "viewpoint", tags: ["utsikt"] }, "scenic").level, "strong");
  assert.equal(matchCandidateToIntent({ type: "lookout" }, "scenic").level, "strong");
});

test("green and walks is a real intent distinct from scenic", () => {
  assert.deepEqual(normalizeUserIntents(["green"]).intents, ["green"]);
  assert.deepEqual(normalizeUserIntents(["grönt"]).intents, ["green"]);
  assert.equal(matchCandidateToIntent({ type: "park", tags: ["green"] }, "green").level, "strong");
  assert.equal(matchCandidateToIntent({ type: "garden" }, "green").level, "strong");
  assert.equal(matchCandidateToIntent({ type: "viewpoint" }, "green").level, "weak");
});

// --- 6. noise guards --------------------------------------------------------
test("a pub reads as bars, not food (no cross-intent leakage)", () => {
  assert.equal(matchCandidateToIntent({ type: "pub" }, "bars").level, "strong");
  assert.equal(matchCandidateToIntent({ type: "pub" }, "food").level, "none");
});

test("a popularity-only / single-family record still cannot win despite broader vocab", () => {
  const out = agnosticDecision(
    [osmRecord("o-hype", "Hyped Taverna", "taverna", 41.9, 12.5, { tags: [], wikidata: null, popularity: { count: 99999, rating: 4.9 } })],
    ["food"],
  );
  // single family + huge consensus → gated out → honest no move
  assert.equal(out.best_move, null);
});

test("broadened OSM tags map to the right types (cafe→fika, pub→bar, charity→vintage)", () => {
  assert.equal(mapOsmElement({ type: "node", id: 1, lat: 1, lon: 1, tags: { name: "Kafe", amenity: "cafe" } }).type, "cafe");
  assert.deepEqual(mapOsmElement({ type: "node", id: 1, lat: 1, lon: 1, tags: { name: "Kafe", amenity: "cafe" } }).tags, ["fika"]);
  assert.equal(mapOsmElement({ type: "node", id: 2, lat: 1, lon: 1, tags: { name: "Pub", amenity: "pub" } }).type, "bar");
  assert.equal(mapOsmElement({ type: "node", id: 3, lat: 1, lon: 1, tags: { name: "Charity", shop: "charity" } }).type, "vintage-shop");
  assert.equal(mapOsmElement({ type: "node", id: 4, lat: 1, lon: 1, tags: { name: "Bath", leisure: "swimming_area" } }).type, "beach");
});
