const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateAgnosticPromotion } = require("../server/planner/agnostic-promotion-gate");

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
  assert.ok(verdict.reasons.includes("promoted_thin_usable"));
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

test("thin_day cap blocks promotion (not in v1 allowlist)", () => {
  const verdict = evaluateAgnosticPromotion({
    calibration: calibration({ caps: ["capped_by_external_only_sources", "capped_by_thin_day"] }),
    strongAnchor: true,
  });
  assert.equal(verdict.promote, false);
  assert.deepEqual(verdict.blocked_caps, ["capped_by_thin_day"]);
  assert.ok(verdict.reasons.includes("capped_by_non_promotable"));
});

test("a trusted remaining-day short route can promote while the generic thin-day cap stays blocked", () => {
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

test("below_planner_threshold and unresolved_roles and role_order_fallback all block", () => {
  for (const cap of [
    "capped_by_below_planner_candidate_threshold",
    "capped_by_unresolved_roles",
    "capped_by_role_order_fallback",
  ]) {
    const verdict = evaluateAgnosticPromotion({
      calibration: calibration({ caps: [cap] }),
      strongAnchor: true,
    });
    assert.equal(verdict.promote, false, `${cap} must block`);
    assert.deepEqual(verdict.blocked_caps, [cap]);
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
});
