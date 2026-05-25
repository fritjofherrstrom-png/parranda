const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const {
  compareRouteCandidates,
} = require("../scripts/compare-route-candidates");

const scriptPath = path.join(__dirname, "..", "scripts", "compare-route-candidates.js");
const repoRoot = path.join(__dirname, "..");

function runCompare(city) {
  return spawnSync(process.execPath, [scriptPath, city], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("compare-route-candidates reports Barcelona as ready", () => {
  const result = runCompare("barcelona");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /RouteCandidate comparison: barcelona \(Barcelona\)/);
  assert.match(result.stdout, /Route templates: 8/);
  assert.match(result.stdout, /RouteCandidates: 8/);
  assert.match(result.stdout, /Template ids missing from RouteCandidates:\n- none/);
  assert.match(result.stdout, /RouteCandidate ids missing from templates:\n- none/);
  assert.match(result.stdout, /Unresolved template stops:\n- none/);
  assert.match(result.stdout, /Stop visibility:\n- user-facing: 33\n- structural: 0/);
  assert.match(result.stdout, /Route shape distribution:\n- arc: 8/);
  assert.match(result.stdout, /Confidence distribution:\n- high: 8/);
  assert.match(result.stdout, /Warnings:\n- none/);
  assert.match(result.stdout, /Limitations:\n- none/);
  assert.match(result.stdout, /Readiness verdict: ready/);
  assert.equal(result.stderr, "");
});

test("compare-route-candidates reports Rome structural stops without review warnings", () => {
  const result = runCompare("rome");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /RouteCandidate comparison: rome \(Rom\)/);
  assert.match(result.stdout, /Route templates: 41/);
  assert.match(result.stdout, /RouteCandidates: 41/);
  assert.match(result.stdout, /classic-loop: template=6, route_candidate=6, user_facing=2, structural=4, matches=yes/);
  assert.match(result.stdout, /Stop visibility:\n- user-facing: 174\n- structural: 71/);
  assert.match(result.stdout, /Route shape distribution:\n- arc: 31\n- loop: 10/);
  assert.match(result.stdout, /Readiness verdict: ready/);
  assert.equal(result.stderr, "");
});

test("compare-route-candidates works for test-city", () => {
  const result = runCompare("test-city");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /RouteCandidate comparison: test-city \(Test City\)/);
  assert.match(result.stdout, /Route templates: 2/);
  assert.match(result.stdout, /RouteCandidates: 2/);
  assert.match(result.stdout, /Stop visibility:\n- user-facing: 7\n- structural: 4/);
  assert.match(result.stdout, /Readiness verdict: ready/);
  assert.equal(result.stderr, "");
});

test("compare-route-candidates flags unresolved template stops as needs_review", () => {
  const comparison = compareRouteCandidates({
    key: "diagnostic-city",
    label: "Diagnostic City",
    catalog: {
      allItems: [
        {
          id: "known-place",
          name: "Known Place",
          kind: "cafe",
          lat: 41.1,
          lng: 12.1,
          area: "center",
          tags: ["mat"],
          searchTerms: ["known place"],
        },
      ],
      routeTemplates: [
        {
          id: "broken-template",
          title: "Broken template",
          stops: ["known-place", "missing-place"],
          defaultKm: 2,
          preferenceTags: ["mat"],
        },
      ],
    },
    routing: {
      areaDefinitions: {
        center: { label: "Center", macro: "center" },
      },
    },
  });

  assert.equal(comparison.route_templates_count, 1);
  assert.equal(comparison.route_candidate_count, 1);
  assert.deepEqual(comparison.template_ids_missing_from_route_candidates, []);
  assert.deepEqual(comparison.route_candidate_ids_missing_from_templates, []);
  assert.deepEqual(comparison.unresolved_template_stops, [
    {
      route_id: "broken-template",
      stop_id: "missing-place",
    },
  ]);
  assert.deepEqual(comparison.warnings, {
    "unresolved_template_stops:missing-place": 1,
  });
  assert.equal(comparison.stop_count_comparison[0].stop_count_matches, true);
  assert.equal(comparison.readiness, "needs_review");
});

test("compare-route-candidates fails clearly for unknown cities", () => {
  const result = runCompare("unknown-city");

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown city "unknown-city"/);
});
