const test = require("node:test");
const assert = require("node:assert/strict");

const { buildEngineReadinessVerdict } = require("../server/planner/agnostic-engine-readiness");

function engineExperiment(overrides = {}) {
  return {
    synthesized_via: "agnostic_compose_engine",
    readiness_calibration: { status: "thin_usable", level: "low" },
    promotion: { promote: true, reasons: ["promoted_thin_usable"], blocked_caps: [] },
    experimental_route: {
      agnostic_daypart_ordering: { applied: true, fallback: false, reason: "daypart_rhythm" },
      daypart_arc: ["morning", "midday", "evening"],
    },
    ...overrides,
  };
}

test("engine path + promotable route → eligible and retirement_ready", () => {
  const v = buildEngineReadinessVerdict(engineExperiment());
  assert.equal(v.engine_path_active, true);
  assert.equal(v.synthesized_via, "agnostic_compose_engine");
  assert.equal(v.promotion_decision, "eligible");
  assert.deepEqual(v.promotion_blockers, []);
  assert.equal(v.retirement_ready, true);
  assert.deepEqual(v.remaining_for_default, []);
  assert.deepEqual(v.daypart, { applied: true, fallback: false, reason: "daypart_rhythm" });
  assert.deepEqual(v.daypart_arc, ["morning", "midday", "evening"]);
});

test("blocked promotion surfaces the exact blockers as remaining_for_default", () => {
  const v = buildEngineReadinessVerdict(
    engineExperiment({
      readiness_calibration: { status: "thin_usable", level: "low" },
      promotion: {
        promote: false,
        reasons: ["capped_by_non_promotable", "promoted_thin_usable"],
        blocked_caps: ["capped_by_thin_day"],
      },
    }),
  );
  assert.equal(v.promotion_decision, "blocked");
  assert.equal(v.retirement_ready, false);
  // the success marker is filtered out; the real blockers remain
  assert.ok(v.promotion_blockers.includes("capped_by_non_promotable"));
  assert.ok(v.promotion_blockers.includes("capped_by_thin_day"));
  assert.ok(!v.promotion_blockers.includes("promoted_thin_usable"));
  assert.deepEqual(v.remaining_for_default, v.promotion_blockers);
});

test("legacy path → engine_path_active false, decision unknown, remaining = not active", () => {
  const v = buildEngineReadinessVerdict({
    // legacy composeAgnosticRouteOutput sets no synthesized_via and no promotion
    readiness_calibration: { status: "thin_usable", level: "low" },
    experimental_route: {},
  });
  assert.equal(v.engine_path_active, false);
  assert.equal(v.synthesized_via, null);
  assert.equal(v.promotion_decision, "unknown");
  assert.equal(v.retirement_ready, false);
  assert.deepEqual(v.remaining_for_default, ["engine_path_not_active"]);
});

test("engine path active but no promotion verdict → unknown, no_promotion_verdict", () => {
  const v = buildEngineReadinessVerdict(
    engineExperiment({ promotion: null }),
  );
  assert.equal(v.engine_path_active, true);
  assert.equal(v.promotion_decision, "unknown");
  assert.deepEqual(v.remaining_for_default, ["no_promotion_verdict"]);
});

test("daypart fallback verdict is surfaced honestly", () => {
  const v = buildEngineReadinessVerdict(
    engineExperiment({
      experimental_route: {
        agnostic_daypart_ordering: { applied: false, fallback: true, reason: "daypart_order_exceeded_walk_budget" },
      },
    }),
  );
  assert.deepEqual(v.daypart, { applied: false, fallback: true, reason: "daypart_order_exceeded_walk_budget" });
  assert.equal(v.daypart_arc, null);
});

test("empty / malformed experiment never throws", () => {
  const v = buildEngineReadinessVerdict({});
  assert.equal(v.engine_path_active, false);
  assert.equal(v.promotion_decision, "unknown");
  assert.equal(v.retirement_ready, false);
  assert.deepEqual(buildEngineReadinessVerdict().remaining_for_default, ["engine_path_not_active"]);
});
