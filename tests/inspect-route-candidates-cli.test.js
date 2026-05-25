const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const scriptPath = path.join(__dirname, "..", "scripts", "inspect-route-candidates.js");
const repoRoot = path.join(__dirname, "..");

function runInspect(city) {
  return spawnSync(process.execPath, [scriptPath, city], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("inspect-route-candidates prints Barcelona route diagnostics", () => {
  const result = runInspect("barcelona");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /RouteCandidate inspection: barcelona \(Barcelona\)/);
  assert.match(result.stdout, /Route count: 8/);
  assert.match(result.stdout, /- gracia-local-evening-loop/);
  assert.match(result.stdout, /- encants-to-coast-drift/);
  assert.match(result.stdout, /- route shapes:\n  - arc: 8/);
  assert.match(result.stdout, /- source mix:\n  - curated_template: 8/);
  assert.match(result.stdout, /- confidence:\n  - high: 8/);
  assert.match(result.stdout, /- trust tiers:\n  - curated: 8/);
  assert.match(result.stdout, /Sample RouteCandidates \(5 of 8\):/);
  assert.equal(result.stderr, "");
});

test("inspect-route-candidates prints Rome route diagnostics with structural stops", () => {
  const result = runInspect("rome");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /RouteCandidate inspection: rome \(Rom\)/);
  assert.match(result.stdout, /Route count: \d+/);
  assert.match(result.stdout, /- classic-loop/);
  assert.match(result.stdout, /- source mix:\n  - curated_template: \d+/);
  assert.match(result.stdout, /- confidence:\n  - high: \d+/);
  assert.match(result.stdout, /user-facing/);
  assert.match(result.stdout, /structural/);
  assert.match(result.stdout, /\[structure\]/);
  assert.equal(result.stderr, "");
});

test("inspect-route-candidates prints test-city route diagnostics", () => {
  const result = runInspect("test-city");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /RouteCandidate inspection: test-city \(Test City\)/);
  assert.match(result.stdout, /Route count: 2/);
  assert.match(result.stdout, /- test-city-old-town-loop/);
  assert.match(result.stdout, /- test-city-riverfront-loop/);
  assert.match(result.stdout, /Sample RouteCandidates \(2 of 2\):/);
  assert.equal(result.stderr, "");
});

test("inspect-route-candidates fails clearly for unknown cities", () => {
  const result = runInspect("unknown-city");

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown city "unknown-city"/);
});
