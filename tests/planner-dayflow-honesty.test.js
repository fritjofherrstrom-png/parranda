const assert = require("node:assert/strict");
const test = require("node:test");

const { summarizeDayflowHonesty } = require("../server/planner/dayflow-honesty");

function candidate(overrides = {}) {
  return {
    candidate_id: "c1",
    candidate_status: "filled",
    planner_usable: true,
    origin: "curated_catalog",
    confidence: "high",
    provenance: { human_verified: true },
    covered_preferences: [],
    partial_preferences: [],
    missing_preferences: [],
    fit_reasons: [],
    ...overrides,
  };
}

function role(roleName, status, candidates = [], overrides = {}) {
  return {
    role: roleName,
    status,
    requested: true,
    planner_usable: status === "filled" || status === "partial",
    candidates,
    ...overrides,
  };
}

function plannerRoles(overrides = {}) {
  return {
    city: "test",
    density: "rich",
    lens: null,
    context: { date: "2026-06-03", now: "2026-06-03T18:30:00", time_band: "evening" },
    requested_preferences: ["scenic", "food"],
    roles: [],
    ...overrides,
  };
}

test("all requested roles filled returns full", () => {
  const summary = summarizeDayflowHonesty(plannerRoles({
    roles: [
      role("scenic_anchor", "filled", [candidate({ candidate_id: "view", covered_preferences: ["scenic"] })]),
      role("food_anchor", "filled", [candidate({ candidate_id: "food", covered_preferences: ["food"] })]),
      role("coffee_fika_stop", "missing", [], { requested: false }),
    ],
  }));

  assert.equal(summary.day_status, "full");
  assert.deepEqual(summary.role_coverage.filled, ["scenic_anchor", "food_anchor"]);
  assert.deepEqual(summary.preference_coverage.covered_preferences, ["food", "scenic"]);
});

test("partial anchors/options return partial with preference rollup", () => {
  const summary = summarizeDayflowHonesty(plannerRoles({
    requested_preferences: ["scenic", "food", "coffee"],
    roles: [
      role("scenic_anchor", "partial", [
        candidate({
          candidate_id: "source-view",
          candidate_status: "partial",
          origin: "external_open",
          confidence: "medium",
          covered_preferences: ["scenic"],
        }),
      ]),
      role("food_anchor", "filled", [candidate({ candidate_id: "food", covered_preferences: ["food"] })]),
      role("coffee_fika_stop", "missing", []),
    ],
  }));

  assert.equal(summary.day_status, "partial");
  assert.deepEqual(summary.preference_coverage.covered_preferences, ["food", "scenic"]);
  assert.deepEqual(summary.preference_coverage.missing_preferences, ["coffee"]);
  assert.ok(summary.quality_flags.includes("external_only_scenic_anchor"));
});

test("only fallback candidates returns fallback_heavy", () => {
  const summary = summarizeDayflowHonesty(plannerRoles({
    roles: [
      role("scenic_anchor", "fallback", [
        candidate({
          candidate_id: "fallback-view",
          candidate_status: "fallback",
          planner_usable: false,
          confidence: "low",
        }),
      ]),
      role("food_anchor", "fallback", [
        candidate({
          candidate_id: "fallback-food",
          candidate_status: "fallback",
          planner_usable: false,
          confidence: "needs_review",
        }),
      ]),
    ],
  }));

  assert.equal(summary.day_status, "fallback_heavy");
  assert.deepEqual(summary.role_coverage.fallback, ["scenic_anchor", "food_anchor"]);
  assert.equal(summary.trust_summary.low_confidence_count, 2);
});

test("no usable candidates in sparse context returns sparse", () => {
  const summary = summarizeDayflowHonesty(plannerRoles({
    density: "absent",
    roles: [
      role("scenic_anchor", "missing", []),
      role("food_anchor", "missing", []),
    ],
  }));

  assert.equal(summary.day_status, "sparse");
  assert.ok(summary.quality_flags.includes("thin_catalog_density"));
  assert.ok(summary.quality_flags.includes("missing_food_anchor"));
});

test("requested missing option role affects day status and emits scoped missing flag", () => {
  const summary = summarizeDayflowHonesty(plannerRoles({
    requested_preferences: ["swimming"],
    roles: [
      role("scenic_anchor", "filled", [candidate({ candidate_id: "view", covered_preferences: ["scenic"] })], { requested: false }),
      role("food_anchor", "filled", [candidate({ candidate_id: "food", covered_preferences: ["food"] })], { requested: false }),
      role("swimming_coast_option", "missing", [], { requested: true }),
    ],
  }));

  assert.equal(summary.day_status, "sparse");
  assert.ok(summary.quality_flags.includes("missing_swimming_coast_option"));
});

test("no preferences target scenic and food anchors, not unrequested option roles", () => {
  const summary = summarizeDayflowHonesty(plannerRoles({
    requested_preferences: [],
    roles: [
      role("scenic_anchor", "filled", [candidate({ candidate_id: "view", covered_preferences: ["scenic"] })], { requested: false }),
      role("food_anchor", "filled", [candidate({ candidate_id: "food", covered_preferences: ["food"] })], { requested: false }),
      role("swimming_coast_option", "missing", [], { requested: false }),
      role("evening_bar_option", "missing", [], { requested: false }),
    ],
  }));

  assert.equal(summary.day_status, "full");
  assert.equal(summary.quality_flags.includes("missing_swimming_coast_option"), false);
  assert.equal(summary.quality_flags.includes("missing_evening_bar_option"), false);
});

test("quality flags are scoped to target roles while role coverage remains complete", () => {
  const summary = summarizeDayflowHonesty(plannerRoles({
    requested_preferences: ["scenic"],
    roles: [
      role("scenic_anchor", "filled", [candidate({ candidate_id: "view", covered_preferences: ["scenic"] })]),
      role("food_anchor", "missing", [], { requested: false }),
      role("swimming_coast_option", "missing", [], { requested: false }),
    ],
  }));

  assert.deepEqual(summary.role_coverage.missing, ["food_anchor", "swimming_coast_option"]);
  assert.equal(summary.quality_flags.includes("missing_food_anchor"), false);
  assert.equal(summary.quality_flags.includes("missing_swimming_coast_option"), false);
});

test("one filled candidate covering multiple requested roles downgrades robust full status", () => {
  const rooftop = candidate({
    candidate_id: "rooftop",
    covered_preferences: ["scenic", "bars"],
  });
  const summary = summarizeDayflowHonesty(plannerRoles({
    requested_preferences: ["scenic", "bars"],
    roles: [
      role("scenic_anchor", "filled", [rooftop], { requested: true }),
      role("evening_bar_option", "filled", [rooftop], { requested: true }),
    ],
  }));

  assert.equal(summary.day_status, "partial");
  assert.ok(summary.quality_flags.includes("single_candidate_multi_role_coverage"));
});

test("trust summary counts curated, external, low confidence, and human verified candidates", () => {
  const summary = summarizeDayflowHonesty(plannerRoles({
    roles: [
      role("scenic_anchor", "filled", [
        candidate({ candidate_id: "curated", origin: "curated_catalog", confidence: "high", provenance: { human_verified: true } }),
      ]),
      role("evening_bar_option", "partial", [
        candidate({ candidate_id: "external", candidate_status: "partial", origin: "external_open", confidence: "low", provenance: { human_verified: false } }),
      ]),
    ],
  }));

  assert.deepEqual(summary.trust_summary, {
    curated_count: 1,
    external_count: 1,
    low_confidence_count: 1,
    human_verified_count: 1,
  });
});

test("time summary rolls up match, mismatch, and missing time data", () => {
  const summary = summarizeDayflowHonesty(plannerRoles({
    roles: [
      role("evening_bar_option", "filled", [
        candidate({ candidate_id: "bar", covered_preferences: ["bars"], fit_reasons: ["covers:bars(type)", "time_match:evening"] }),
      ]),
      role("food_anchor", "filled", [
        candidate({ candidate_id: "breakfast", covered_preferences: ["food"], fit_reasons: ["covers:food(type)", "time_mismatch:evening"] }),
      ]),
      role("scenic_anchor", "partial", [
        candidate({ candidate_id: "view", candidate_status: "partial", covered_preferences: ["scenic"], fit_reasons: ["covers:scenic(type)"] }),
      ]),
    ],
  }));

  assert.equal(summary.time_summary.date, "2026-06-03");
  assert.equal(summary.time_summary.now, "2026-06-03T18:30:00");
  assert.equal(summary.time_summary.time_band, "evening");
  assert.deepEqual(summary.time_summary.time_matched_roles, ["evening_bar_option"]);
  assert.deepEqual(summary.time_summary.time_mismatched_roles, ["food_anchor"]);
  assert.deepEqual(summary.time_summary.missing_time_data_roles, ["scenic_anchor"]);
  assert.ok(summary.quality_flags.includes("evening_bar_option_time_matched"));
  assert.ok(summary.quality_flags.includes("time_mismatch_food_anchor"));
  assert.ok(summary.quality_flags.includes("missing_time_data"));
});
