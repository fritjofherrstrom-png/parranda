const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const {
  evaluateReadinessGate,
  formatFailureSummary,
  main,
} = require("../scripts/check-route-candidate-readiness");

const scriptPath = path.join(__dirname, "..", "scripts", "check-route-candidate-readiness.js");
const repoRoot = path.join(__dirname, "..");

function runGate(args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function createComparison(overrides = {}) {
  return {
    city: "diagnostic-city",
    label: "Diagnostic City",
    route_templates_count: 1,
    route_candidate_count: 1,
    template_ids_missing_from_route_candidates: [],
    route_candidate_ids_missing_from_templates: [],
    stop_count_comparison: [
      {
        id: "diagnostic-route",
        template_stop_count: 2,
        route_candidate_stop_count: 2,
        user_facing_stop_count: 2,
        structural_stop_count: 0,
        stop_count_matches: true,
        unresolved_template_stops: [],
      },
    ],
    unresolved_template_stops: [],
    structural_stop_count: 0,
    user_facing_stop_count: 2,
    by_route_shape: { arc: 1 },
    by_confidence: { high: 1 },
    warnings: {},
    limitations: {},
    readiness: "ready",
    ...overrides,
  };
}

test("check-route-candidate-readiness passes for the current baseline cities", () => {
  const result = runGate();

  assert.equal(result.status, 0);
  assert.match(result.stdout, /RouteCandidate readiness gate/);
  assert.match(
    result.stdout,
    /- rome: ready \| templates=41 \| route_candidates=41 \| user_facing=174 \| structural=71 \| warnings=0 \| limitations=0/,
  );
  assert.match(
    result.stdout,
    /- barcelona: ready \| templates=8 \| route_candidates=8 \| user_facing=33 \| structural=0 \| warnings=0 \| limitations=0/,
  );
  assert.match(
    result.stdout,
    /- test-city: ready \| templates=2 \| route_candidates=2 \| user_facing=7 \| structural=4 \| warnings=0 \| limitations=0/,
  );
  assert.match(result.stdout, /Readiness gate: ready/);
  assert.equal(result.stderr, "");
});

test("check-route-candidate-readiness rejects CLI city arguments", () => {
  const result = runGate(["barcelona"]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Usage: node scripts\/check-route-candidate-readiness\.js/);
});

test("readiness gate fails synthetic unresolved-stop comparisons", () => {
  const gate = evaluateReadinessGate([
    createComparison({
      unresolved_template_stops: [
        {
          route_id: "broken-route",
          stop_id: "missing-place",
        },
      ],
      warnings: {
        "unresolved_template_stops:missing-place": 1,
      },
      readiness: "needs_review",
    }),
  ]);

  assert.equal(gate.ready, false);
  assert.deepEqual(gate.results[0].failure_reasons, [
    "unresolved stops: broken-route:missing-place",
    "warnings: unresolved_template_stops:missing-place=1",
  ]);
  assert.match(formatFailureSummary(gate), /RouteCandidate readiness gate failed:/);
  assert.match(formatFailureSummary(gate), /- diagnostic-city: needs_review/);
  assert.match(formatFailureSummary(gate), /unresolved stops: broken-route:missing-place/);
});

test("readiness gate fails synthetic stop-count mismatches", () => {
  const gate = evaluateReadinessGate([
    createComparison({
      stop_count_comparison: [
        {
          id: "short-route",
          template_stop_count: 4,
          route_candidate_stop_count: 3,
          user_facing_stop_count: 3,
          structural_stop_count: 0,
          stop_count_matches: false,
          unresolved_template_stops: [],
        },
      ],
      readiness: "needs_review",
    }),
  ]);

  assert.equal(gate.ready, false);
  assert.deepEqual(gate.results[0].failure_reasons, [
    "stop count mismatches: short-route template=4 route_candidate=3",
  ]);
});

test("main returns non-zero for injected failed comparison", () => {
  let stdout = "";
  let stderr = "";
  const output = { write: (text) => { stdout += text; } };
  const errorOutput = { write: (text) => { stderr += text; } };

  const exitCode = main([], output, errorOutput, {
    cityKeys: ["diagnostic-city"],
    loadComparison: () =>
      createComparison({
        template_ids_missing_from_route_candidates: ["missing-template"],
        readiness: "needs_review",
      }),
  });

  assert.equal(exitCode, 1);
  assert.match(stdout, /- diagnostic-city: needs_review/);
  assert.match(stdout, /Readiness gate: failed/);
  assert.match(stderr, /missing template ids: missing-template/);
});
