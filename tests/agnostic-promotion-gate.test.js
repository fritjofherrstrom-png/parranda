const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyPromotionReadiness,
  evaluateAgnosticPromotion,
} = require("../server/planner/agnostic-promotion-gate");

function calibration(overrides = {}) {
  return {
    status: "thin_usable",
    level: "low",
    caps: ["capped_by_external_only_sources"],
    ...overrides,
  };
}

test("promotes a thin_usable/low route with only allowed caps + strong anchor", () => {
  const verdict = evaluateAgnosticPromotion({ calibration: calibration(), strongAnchor: true });
  assert.equal(verdict.promote, true);
  assert.deepEqual(verdict.blocked_caps, []);
  assert.equal(verdict.readiness, "promotable_limited");
  assert.ok(verdict.reasons.includes("promoted_with_limitations"));
});

test("all four allowed caps together still promote", () => {
  const verdict = evaluateAgnosticPromotion({
    calibration: calibration({
      caps: [
        "capped_by_external_only_sources",
        "capped_by_derived_timezone",
        "capped_by_partial_context",
        "capped_by_heuristic_walking",
      ],
    }),
    strongAnchor: true,
  });
  assert.equal(verdict.promote, true);
});

test("a weak anchor never promotes (no invented geography for a weak resolve)", () => {
  const verdict = evaluateAgnosticPromotion({ calibration: calibration(), strongAnchor: false });
  assert.equal(verdict.promote, false);
  assert.ok(verdict.reasons.includes("anchor_not_strong"));
});

test("a thin day is published as a limitation, not withheld", () => {
  const verdict = evaluateAgnosticPromotion({
    calibration: calibration({ caps: ["capped_by_external_only_sources", "capped_by_thin_day"] }),
    strongAnchor: true,
  });
  // Two real, walk-validated stops are a short day, not a false one.
  assert.equal(verdict.promote, true);
  assert.equal(verdict.readiness, "promotable_limited");
  assert.deepEqual(verdict.disqualifying_caps, []);
  assert.ok(verdict.qualifying_caps.includes("capped_by_thin_day"));
});

test("a trusted remaining-day short route promotes with its own honest cap", () => {
  const verdict = evaluateAgnosticPromotion({
    calibration: calibration({
      caps: ["capped_by_external_only_sources", "capped_by_remaining_day_short_route"],
    }),
    strongAnchor: true,
  });

  assert.equal(verdict.promote, true);
  assert.deepEqual(verdict.blocked_caps, []);
});

test("bounded stale candidate cache remains promotable with an explicit readiness cap", () => {
  const verdict = evaluateAgnosticPromotion({
    calibration: calibration({
      caps: ["capped_by_external_only_sources", "capped_by_stale_candidate_cache"],
    }),
    strongAnchor: true,
  });

  assert.equal(verdict.promote, true);
  assert.deepEqual(verdict.blocked_caps, []);
});

test("supply and ordering caps describe a limited day, never an invalid one", () => {
  // A small reservoir, an unfilled optional role, or a fallback ordering all
  // mean "smaller or less refined than ideal" — none of them makes the stops
  // that WERE found untrue.
  for (const cap of [
    "capped_by_below_planner_candidate_threshold",
    "capped_by_unresolved_roles",
    "capped_by_role_order_fallback",
  ]) {
    const verdict = evaluateAgnosticPromotion({
      calibration: calibration({ caps: [cap] }),
      strongAnchor: true,
    });
    assert.equal(verdict.promote, true, `${cap} must publish`);
    assert.equal(verdict.readiness, "promotable_limited", cap);
    assert.deepEqual(verdict.disqualifying_caps, [], cap);
    assert.ok(verdict.qualifying_caps.includes(cap), cap);
  }
});

test("blocked / environment_not_wired / not_applicable statuses never promote", () => {
  for (const status of ["blocked", "environment_not_wired", "not_applicable"]) {
    const verdict = evaluateAgnosticPromotion({
      calibration: calibration({ status, level: "unavailable" }),
      strongAnchor: true,
    });
    assert.equal(verdict.promote, false, `${status} must not promote`);
  }
});

test("a medium-level usable route promotes (forward-compatible even if unreachable today)", () => {
  const verdict = evaluateAgnosticPromotion({
    calibration: calibration({ status: "usable", level: "medium", caps: [] }),
    strongAnchor: true,
  });
  assert.equal(verdict.promote, true);
  // No caps at all is the one case that is not "limited".
  assert.equal(verdict.readiness, "promotable");
  assert.ok(verdict.reasons.includes("promoted_unlimited"));
});

test("the always-present experimental_agnostic_route marker is not a blocking cap", () => {
  const verdict = evaluateAgnosticPromotion({
    calibration: calibration({ caps: ["experimental_agnostic_route", "capped_by_external_only_sources"] }),
    strongAnchor: true,
  });
  assert.equal(verdict.promote, true);
  assert.deepEqual(verdict.blocked_caps, []);
});

test("missing calibration never promotes, never throws", () => {
  assert.equal(evaluateAgnosticPromotion({ calibration: null, strongAnchor: true }).promote, false);
  assert.equal(evaluateAgnosticPromotion({}).promote, false);
  assert.equal(evaluateAgnosticPromotion({}).readiness, "non_promotable");
});

// --------------------------------------------------------------------------
// Planner intent stays primary. Relaxing the gate must not let a requested
// need quietly vanish from the day.
// --------------------------------------------------------------------------

test("an unresolved role nobody asked for is only a limitation", () => {
  const verdict = classifyPromotionReadiness({
    calibration: calibration({ caps: ["capped_by_unresolved_roles"] }),
    strongAnchor: true,
    unresolvedRoles: [{ role: "swimming_coast_option", reason: "no_candidate" }],
    requestedIntents: ["food"],
  });

  assert.equal(verdict.promote, true);
  assert.equal(verdict.readiness, "promotable_limited");
  assert.deepEqual(verdict.unmet_requested_intents, []);
});

test("the only requested intent going unresolved disqualifies the day", () => {
  const verdict = classifyPromotionReadiness({
    calibration: calibration({ caps: ["capped_by_unresolved_roles"] }),
    strongAnchor: true,
    unresolvedRoles: [{ role: "food_anchor", reason: "no_candidate" }],
    requestedIntents: ["food"],
  });

  // Asking for dinner and getting a day with no dinner is not a limitation,
  // it is a different day than the one requested.
  assert.equal(verdict.promote, false);
  assert.equal(verdict.readiness, "non_promotable");
  assert.deepEqual(verdict.unmet_requested_intents, ["food"]);
  assert.ok(verdict.disqualifying_caps.includes("capped_by_requested_intent_unmet"));
  assert.ok(verdict.reasons.includes("requested_intent_unmet:food"));
});

test("one unresolved intent among several is a limitation on the role path too", () => {
  const verdict = classifyPromotionReadiness({
    calibration: calibration({ caps: ["capped_by_unresolved_roles"] }),
    strongAnchor: true,
    unresolvedRoles: [{ role: "food_anchor", reason: "no_candidate" }],
    requestedIntents: ["food", "coffee"],
  });

  assert.equal(verdict.promote, true);
  assert.equal(verdict.readiness, "promotable_limited");
  assert.deepEqual(verdict.unmet_requested_intents, ["food"]);
  assert.ok(verdict.qualifying_caps.includes("capped_by_requested_intent_partial"));
});

test("experiment-only roles participate in the same intent contract", () => {
  const verdict = classifyPromotionReadiness({
    calibration: calibration({ caps: ["capped_by_unresolved_roles"] }),
    strongAnchor: true,
    unresolvedRoles: [{ role: "culture_stop", reason: "capped_out" }],
    requestedIntents: ["museums"],
  });

  assert.equal(verdict.promote, false);
  assert.deepEqual(verdict.unmet_requested_intents, ["museums"]);
});

test("no requested intents means no intent can go unmet", () => {
  const verdict = classifyPromotionReadiness({
    calibration: calibration({ caps: ["capped_by_unresolved_roles"] }),
    strongAnchor: true,
    unresolvedRoles: [{ role: "food_anchor", reason: "no_candidate" }],
    requestedIntents: [],
  });

  assert.equal(verdict.promote, true);
  assert.equal(verdict.readiness, "promotable_limited");
});

test("an unvalidated walking contract is invalidity, never a limitation", () => {
  const verdict = classifyPromotionReadiness({
    calibration: calibration({ caps: [], inputs: { walking_valid: false } }),
    strongAnchor: true,
  });

  assert.equal(verdict.promote, false);
  assert.ok(verdict.reasons.includes("walking_contract_unvalidated"));
});

test("a published day never reports qualifying caps it was refused for", () => {
  const refused = classifyPromotionReadiness({
    calibration: calibration({ caps: ["capped_by_thin_day"] }),
    strongAnchor: false,
  });
  assert.equal(refused.promote, false);
  assert.deepEqual(refused.qualifying_caps, []);
});

// --------------------------------------------------------------------------
// Preference coverage is the engine path's first-class statement of what the
// day answered. It outranks the role fallback when present.
// --------------------------------------------------------------------------

test("a partially covered request is a limited day, not a refusal", () => {
  const verdict = classifyPromotionReadiness({
    calibration: calibration({ caps: ["capped_by_thin_day"] }),
    strongAnchor: true,
    preferenceCoverage: {
      requested_preferences: ["food", "coffee", "scenic"],
      covered_preferences: ["food", "coffee"],
      missing_preferences: ["scenic"],
    },
  });

  // Food and coffee were found; there is no viewpoint here. Withholding the
  // whole day over the viewpoint is the bug this slice removes.
  assert.equal(verdict.promote, true);
  assert.equal(verdict.readiness, "promotable_limited");
  assert.deepEqual(verdict.unmet_requested_intents, ["scenic"]);
  assert.ok(verdict.qualifying_caps.includes("capped_by_requested_intent_partial"));
  assert.deepEqual(verdict.disqualifying_caps, []);
});

test("a request the day answers in no way at all is refused", () => {
  const verdict = classifyPromotionReadiness({
    calibration: calibration({ caps: [] }),
    strongAnchor: true,
    preferenceCoverage: {
      requested_preferences: ["food", "coffee"],
      covered_preferences: [],
      missing_preferences: ["food", "coffee"],
    },
  });

  assert.equal(verdict.promote, false);
  assert.equal(verdict.readiness, "non_promotable");
  assert.ok(verdict.reasons.includes("no_requested_intent_covered"));
  assert.ok(verdict.disqualifying_caps.includes("capped_by_requested_intent_unmet"));
});

test("a partially covered preference still counts as covered", () => {
  const verdict = classifyPromotionReadiness({
    calibration: calibration({ caps: [] }),
    strongAnchor: true,
    preferenceCoverage: {
      requested_preferences: ["food", "scenic"],
      covered_preferences: [],
      partial_preferences: ["food"],
      missing_preferences: ["scenic"],
    },
  });

  assert.equal(verdict.promote, true);
});

test("full coverage carries no intent cap at all", () => {
  const verdict = classifyPromotionReadiness({
    calibration: calibration({ caps: [] }),
    strongAnchor: true,
    preferenceCoverage: {
      requested_preferences: ["food"],
      covered_preferences: ["food"],
      missing_preferences: [],
    },
  });

  assert.equal(verdict.readiness, "promotable");
  assert.deepEqual(verdict.unmet_requested_intents, []);
});

test("coverage outranks the unresolved-role fallback when both are present", () => {
  const verdict = classifyPromotionReadiness({
    calibration: calibration({ caps: ["capped_by_unresolved_roles"] }),
    strongAnchor: true,
    // The role signal alone would call this fully unmet...
    unresolvedRoles: [{ role: "food_anchor", reason: "no_candidate" }],
    requestedIntents: ["food"],
    // ...but the engine actually covered it.
    preferenceCoverage: {
      requested_preferences: ["food"],
      covered_preferences: ["food"],
      missing_preferences: [],
    },
  });

  assert.equal(verdict.promote, true);
  assert.deepEqual(verdict.unmet_requested_intents, []);
});
