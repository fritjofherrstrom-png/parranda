const assert = require("node:assert/strict");
const test = require("node:test");

const { buildBlitzDecision } = require("../server/blitz-engine");
const {
  isCandidateBlitzModeEnabled,
  buildCandidateBlitzDecision,
  evaluateCandidateEligibility,
} = require("../server/candidates/blitz-candidate-mode");
const { scoreCandidateFit, CONTEXT_CAP } = require("../server/candidates/fit-scorer");
const {
  normalizeUserIntents,
  matchCandidateToIntent,
  candidateModifiers,
} = require("../server/candidates/intent-vocabulary");
const { createEvidence } = require("../server/candidates/evidence");

const rome = require("../server/cities/rome.js");
const DATE = "2026-06-03";

function candidate(overrides = {}) {
  return {
    id: "c1",
    city: "rome",
    label: "Test Place",
    type: "landmark",
    candidate_kind: "real_place",
    lat: 41.9,
    lng: 12.49,
    tags: [],
    time_fit: [],
    route_roles: ["catalog_stop"],
    trust: { source_tier: "curated", confidence: "high", human_verified: true, freshness: "fresh" },
    city_pack_owned: true,
    ...overrides,
  };
}

function fakeCity(allItems) {
  return {
    key: "testville",
    label: "Testville",
    catalog: { allItems },
    routing: { areaDefinitions: {} },
    todayIsoDate: () => DATE,
  };
}

// 1 -------------------------------------------------------------------------
test("flag detection: candidate mode is strictly opt-in", () => {
  assert.equal(isCandidateBlitzModeEnabled({}), false);
  assert.equal(isCandidateBlitzModeEnabled({ candidate_mode: 0 }), false);
  assert.equal(isCandidateBlitzModeEnabled({ candidate_mode: 1 }), true);
  assert.equal(isCandidateBlitzModeEnabled({ candidate_mode: "1" }), true);
  assert.equal(isCandidateBlitzModeEnabled({ candidate_mode: "on" }), true);
});

test("default Blitz is unchanged when candidate mode is not enabled", async () => {
  const legacy = await buildBlitzDecision(rome, { date: DATE, preferences: ["second_hand"] });
  // legacy shape, no experimental fields
  assert.equal(legacy.experimental, undefined);
  assert.equal(legacy.candidate_mode, undefined);
  assert.equal(legacy.engine, undefined);
  assert.ok(legacy.best_move);
  assert.ok("memory" in legacy); // legacy-only field

  const candidateRun = await buildBlitzDecision(rome, { date: DATE, candidate_mode: 1, preferences: ["scenic"] });
  assert.equal(candidateRun.experimental, true);
  assert.equal(candidateRun.engine, "candidate-spine-blitz-v1");
});

// 2 + 7 ---------------------------------------------------------------------
test("candidate mode ignores candidates that fail gates", () => {
  const view = candidate({ type: "viewpoint", tags: ["utsikt"] });
  assert.equal(evaluateCandidateEligibility(view, { now: DATE }).eligible, true);

  const structural = candidate({
    candidate_kind: "structural_anchor",
    is_structural: true,
    type: "district-group",
  });
  assert.equal(evaluateCandidateEligibility(structural, { now: DATE }).eligible, false);

  const noTarget = candidate({ lat: undefined, lng: undefined, city_pack_owned: false, trust: { source_tier: "inferred", confidence: "low", human_verified: false, freshness: "unknown" } });
  assert.equal(evaluateCandidateEligibility(noTarget, { now: DATE }).eligible, false);
});

test("structural candidates do not become user-facing next moves", () => {
  const out = buildCandidateBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"] });
  assert.notEqual(out.best_move.candidate_kind, "structural_anchor");
  assert.notEqual(out.best_move.candidate_kind, "area_preset");
  assert.ok(out.inspect.rejected_count > 0);
  assert.ok(out.inspect.rejected_sample.some((r) => r.reason === "structural_route_only"));
});

// 3 ------------------------------------------------------------------------
test("popularity-only candidate is not eligible (consensus is not existence)", () => {
  const popularityOnly = candidate({
    label: "Hyped Bar",
    type: "bar",
    city_pack_owned: false,
    trust: { source_tier: "inferred", confidence: "low", human_verified: false, freshness: "unknown" },
    evidence: [
      createEvidence({ claim_type: "popularity", value: 9000, provider_id: "map", source_family: "map", source_tier: "inferred" }),
      createEvidence({ claim_type: "sentiment", value: 4.9, provider_id: "map", source_family: "map", source_tier: "inferred" }),
    ],
  });
  assert.equal(evaluateCandidateEligibility(popularityOnly, { now: DATE }).eligible, false);

  // even WITH a single-family existence claim, huge consensus cannot promote it
  const singleFamilyPlusHype = candidate({
    type: "bar",
    city_pack_owned: false,
    trust: { source_tier: "inferred", confidence: "low", human_verified: false, freshness: "unknown" },
    evidence: [
      createEvidence({ claim_type: "existence", value: true, provider_id: "map", source_family: "map", source_tier: "inferred" }),
      createEvidence({ claim_type: "popularity", value: 9000, provider_id: "map", source_family: "map", source_tier: "inferred" }),
    ],
  });
  assert.equal(evaluateCandidateEligibility(singleFamilyPlusHype, { now: DATE }).eligible, false);
});

// 4 ------------------------------------------------------------------------
test("a verified curated candidate can win when it fits", () => {
  const out = buildCandidateBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"] });
  assert.equal(out.best_move.match_tier, "primary");
  assert.ok(out.best_move.covered_preferences.includes("scenic"));
  assert.equal(out.best_move.candidate_kind, "real_place");
  assert.ok(out.best_move.gates_passed.includes("may_create_place_candidate"));
});

// 5 ------------------------------------------------------------------------
test("second hand / vintage is preserved and not collapsed into generic shopping", () => {
  assert.equal(matchCandidateToIntent({ type: "shop", tags: ["shopping"] }, "second_hand").level, "none");
  assert.equal(matchCandidateToIntent({ type: "vintage-shop", tags: ["second_hand", "vintage"] }, "second_hand").level, "strong");

  // "shopping" is not a canonical intent; it must not silently become second_hand
  const norm = normalizeUserIntents(["shopping"]);
  assert.ok(!norm.intents.includes("second_hand"));
  assert.ok(norm.unmapped.includes("shopping"));

  const out = buildCandidateBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["second_hand"] });
  assert.ok(out.best_move.covered_preferences.includes("second_hand"));
  // the winner truly carries a second-hand signal, not a generic shop
  const winner = rome.catalog.allItems.find((i) => i.id === out.best_move.candidate_id);
  const tags = (winner?.tags || []).map((t) => t.toLowerCase());
  assert.ok(["second_hand", "vintage", "antique", "antiques"].some((t) => tags.includes(t)));
});

test("golden_hour modifier matches all spellings consistently (tags + time_fit)", () => {
  // Three on-the-wire spellings — must collapse to the same modifier bucket.
  for (const tag of ["golden hour", "golden-hour", "golden_hour"]) {
    const present = candidateModifiers({ tags: [tag] });
    assert.ok(
      present.includes("golden_hour") && present.includes("sunset"),
      `tag "${tag}" should match golden_hour + sunset; got ${JSON.stringify(present)}`,
    );
  }
  // time_fit field carries the same alias surface.
  for (const tf of ["golden hour", "golden-hour", "golden_hour"]) {
    const present = candidateModifiers({ time_fit: [tf] });
    assert.ok(
      present.includes("golden_hour"),
      `time_fit "${tf}" should match golden_hour; got ${JSON.stringify(present)}`,
    );
  }
  // waterfront alias surface
  assert.deepEqual(candidateModifiers({ tags: ["coast"] }), ["waterfront"]);
  assert.deepEqual(candidateModifiers({ type: "beach" }), ["waterfront"]);
});

// 6 ------------------------------------------------------------------------
test("viewpoint / scenic preference maps correctly", () => {
  assert.ok(normalizeUserIntents(["views"]).intents.includes("scenic"));
  assert.ok(normalizeUserIntents(["viewpoint"]).intents.includes("scenic"));
  assert.ok(normalizeUserIntents(["utsikt"]).intents.includes("scenic"));
  assert.equal(matchCandidateToIntent({ type: "viewpoint" }, "scenic").level, "strong");

  const out = buildCandidateBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"] });
  assert.equal(out.best_move.type, "viewpoint");
});

// 8 ------------------------------------------------------------------------
test("no candidates produces an honest fallback, not hallucinated output", () => {
  const out = buildCandidateBlitzDecision(fakeCity([]), { candidate_mode: 1, date: DATE });
  assert.equal(out.best_move, null);
  assert.equal(out.backup_option, null);
  assert.equal(out.reason, "no_candidates");
});

test("only-structural city yields honest no-eligible fallback", () => {
  const out = buildCandidateBlitzDecision(
    fakeCity([{ id: "tv-center", name: "Center", kind: "district-group" }]),
    { candidate_mode: 1, date: DATE },
  );
  assert.equal(out.best_move, null);
  assert.equal(out.reason, "no_eligible_candidates");
  assert.ok(out.inspect.rejected_count >= 1);
});

test("requested intent with zero matches gives an honest fallback move, not a fake match", () => {
  // Rome has no swimming candidates → eligible places exist but none cover it.
  const out = buildCandidateBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["swimming"] });
  assert.ok(out.best_move); // still offers a real, eligible place
  assert.equal(out.best_move.match_tier, "fallback");
  assert.ok(out.best_move.missing_preferences.includes("swimming"));
  assert.equal(out.reason, "no_preference_match_offering_general");
});

// 9 ------------------------------------------------------------------------
test("context (time/weather) tilts ordering but never dominates intent coverage", () => {
  const ctx = { timeBand: "evening", weather: null };
  const onTime = scoreCandidateFit({
    candidate: candidate({ type: "viewpoint", tags: ["utsikt"], time_fit: ["evening"] }),
    userIntents: ["scenic"],
    context: ctx,
  });
  const offTime = scoreCandidateFit({
    candidate: candidate({ type: "viewpoint", tags: ["utsikt"], time_fit: ["morning"] }),
    userIntents: ["scenic"],
    context: ctx,
  });
  // both cover the intent; time only tilts the score within the same tier
  assert.equal(onTime.intent_match, "covered");
  assert.equal(offTime.intent_match, "covered");
  assert.ok(onTime.primary_score > offTime.primary_score);

  // covering candidate with BAD weather still out-ranks a non-covering one with
  // GOOD weather — coverage is lexicographically primary.
  const rain = { timeBand: "evening", weather: { condition: "rain" } };
  const coveringBadWeather = scoreCandidateFit({
    candidate: candidate({ type: "viewpoint", tags: ["utsikt"] }),
    userIntents: ["scenic"],
    context: rain,
  });
  const nonCoveringGoodWeather = scoreCandidateFit({
    candidate: candidate({ type: "museum", tags: ["kultur"] }),
    userIntents: ["scenic"],
    context: rain,
  });
  assert.ok(coveringBadWeather.coverage_rank[0] > nonCoveringGoodWeather.coverage_rank[0]);
  // and context magnitude is bounded
  assert.ok(Math.abs(coveringBadWeather.context_total) <= CONTEXT_CAP + 1e-9);

  // integration: under rain, scenic request still returns a scenic place
  const out = buildCandidateBlitzDecision(rome, {
    candidate_mode: 1,
    date: DATE,
    preferences: ["scenic"],
    weather: { condition: "rain" },
  });
  assert.ok(out.best_move.covered_preferences.includes("scenic"));
});
