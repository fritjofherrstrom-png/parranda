/**
 * Scenario: Athens — a real but still THIN preview citypack with enough
 * verified places for field testing, but not enough maturity to claim rich
 * density. Evaluates whether citypack + external evidence cooperate: dedupe,
 * honest thin density, calibration not overpowering curated, honest confidence.
 *
 * Athens is a recognized city, so external records are injected at the ENGINE
 * level (the trusted external_provider channel) — this is also how a future
 * "augment a thin recognized city with open data" path would feed them. (At the
 * HTTP layer today the open-data loader only runs for agnostic coordinate
 * requests; see scenario-malmo for that path.)
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildCandidateBlitzDecision } = require("../server/candidates/blitz-candidate-mode");
const { collectPlaceCandidatesForCity } = require("../server/place-candidates/provider-registry");
const { osmRecord, DATE } = require("./scenario-helpers");

const athens = require("../server/cities/athens/index.js");

function curatedViewpoint() {
  return collectPlaceCandidatesForCity(athens).candidates.find((c) => c.type === "viewpoint");
}

function decide(preferences, dataset, over = {}) {
  return buildCandidateBlitzDecision(
    athens,
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences, ...over },
    dataset ? { external_provider: { dataset } } : {},
  );
}

test("Athens is honestly THIN, never claims citypack-rich", () => {
  const out = decide(["scenic"], null);
  assert.equal(out.context.catalog_density, "thin"); // preview city stays thin
  assert.equal(out.best_move.origin, "curated_catalog");
  assert.equal(out.confidence.level, "medium"); // curated but thin → not "high"
});

test("Athens food works off the curated catalog (Greek tavernas tagged 'mat')", () => {
  const out = decide(["food"], null);
  assert.ok(out.best_move);
  assert.ok(out.best_move.covered_preferences.includes("food"));
  assert.equal(out.best_move.origin, "curated_catalog");
});

test("Athens evening/bar intent returns a real curated move", () => {
  const out = decide(["bars"], null, { now: `${DATE}T20:00:00` });
  assert.ok(out.best_move);
  assert.equal(out.best_move.origin, "curated_catalog");
});

test("Athens second hand resolves to the curated flea-market spine, not generic shopping", () => {
  const out = decide(["second_hand"], null);
  assert.equal(out.best_move.candidate_id, "athens-avissinias-flea-market");
  assert.equal(out.best_move.origin, "curated_catalog");
  assert.ok(out.best_move.covered_preferences.includes("second_hand"));
  assert.match(out.best_move.fit_reasons.join(" "), /tag:second_hand/);
});

test("an external duplicate of a curated viewpoint merges in (no identity competition)", () => {
  const vp = curatedViewpoint();
  const dataset = [osmRecord("a-dup", vp.label, "viewpoint", vp.lat + 0.0001, vp.lng, { tags: ["utsikt"], wikidata: "Q1" })];
  const out = decide(["scenic"], dataset);
  assert.equal(out.inspect.entity_resolution.merged_count, 1);
  // the external open candidate is NOT a separate ranked move
  assert.ok(!out.inspect.ranked_sample.some((r) => r.origin === "external_open"));
  // curated stays canonical; if it is the move, external attribution shows
  if (out.best_move.candidate_id === vp.id) {
    assert.equal(out.best_move.provenance.corroborated_by_external, true);
    const fams = out.best_move.provenance.attribution.map((a) => a.source_family);
    assert.ok(fams.includes("map") && fams.includes("open_knowledge"));
  }
});

test("a genuinely new external candidate can win an intent the thin catalog misses", () => {
  // Athens curated catalog has no beach; an open-data coast spot is a real add.
  const dataset = [osmRecord("a-beach", "Kavouri Beach", "beach", 37.82, 23.78, { tags: ["coast"], wikidata: "Q2" })];
  const out = decide(["swimming"], dataset);
  assert.equal(out.best_move.origin, "external_open");
  assert.ok(out.best_move.covered_preferences.includes("swimming"));
  // honest: source-backed, not citypack
  assert.equal(out.confidence.label, "source_backed");
  assert.notEqual(out.confidence.level, "high");
});

test("a weak single-family external candidate does not overpower the curated catalog", () => {
  // single-family (no wikidata) → existence low → gated out
  const dataset = [osmRecord("a-weak", "Some Random Viewpoint", "viewpoint", 37.98, 23.74, { tags: ["utsikt"], wikidata: null })];
  const out = decide(["scenic"], dataset);
  assert.equal(out.best_move.origin, "curated_catalog");
  assert.ok(!out.inspect.ranked_sample.some((r) => r.origin === "external_open"));
});

test("a popularity-only external candidate cannot rank (no generic-map behavior)", () => {
  const dataset = [osmRecord("a-hype", "Hyped Spot", "viewpoint", 37.98, 23.74, { tags: ["utsikt"], wikidata: null, popularity: { count: 99999, rating: 4.9 } })];
  const out = decide(["scenic"], dataset);
  assert.equal(out.best_move.origin, "curated_catalog");
});
