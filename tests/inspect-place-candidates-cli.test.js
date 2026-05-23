const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const scriptPath = path.join(__dirname, "..", "scripts", "inspect-place-candidates.js");
const repoRoot = path.join(__dirname, "..");

function runInspect(city) {
  return spawnSync(process.execPath, [scriptPath, city], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("inspect-place-candidates prints Barcelona candidate diagnostics", () => {
  const result = runInspect("barcelona");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PlaceCandidate inspection: barcelona \(Barcelona\)/);
  assert.match(result.stdout, /Enabled providers:\n- curated-catalog/);
  assert.match(result.stdout, /Provider summary:\n- curated-catalog: 100 candidates/);
  assert.match(result.stdout, /- total: 100/);
  assert.match(result.stdout, /- real places: 95/);
  assert.match(result.stdout, /- structural: 5/);
  assert.match(result.stdout, /  - real_place: 95/);
  assert.match(result.stdout, /  - structural_anchor: 5/);
  assert.match(result.stdout, /  - curated: 100/);
  assert.match(result.stdout, /- can support Blitz: yes/);
  assert.match(result.stdout, /- can support Planner: yes/);
  assert.match(result.stdout, /Sample candidates \(8 of 100\):/);
  assert.equal(result.stderr, "");
});

test("inspect-place-candidates prints Rome candidate diagnostics", () => {
  const result = runInspect("rome");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PlaceCandidate inspection: rome \(Rom\)/);
  assert.match(result.stdout, /Enabled providers:\n- curated-catalog/);
  assert.match(result.stdout, /Provider summary:\n- curated-catalog: \d+ candidates/);
  assert.match(result.stdout, /- real places: \d+/);
  assert.match(result.stdout, /- structural: \d+/);
  assert.match(result.stdout, /  - curated: \d+/);
  assert.match(result.stdout, /Sample candidates \(8 of \d+\):/);
  assert.equal(result.stderr, "");
});

test("inspect-place-candidates reports sparse test-city readiness honestly", () => {
  const result = runInspect("test-city");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PlaceCandidate inspection: test-city \(Test City\)/);
  assert.match(result.stdout, /- total: 5/);
  assert.match(result.stdout, /- real places: 4/);
  assert.match(result.stdout, /- structural: 1/);
  assert.match(result.stdout, /- can support Blitz: no/);
  assert.match(result.stdout, /- can support Planner: no/);
  assert.match(result.stdout, /insufficient_real_places_for_blitz/);
  assert.match(result.stdout, /insufficient_real_places_for_planner/);
  assert.equal(result.stderr, "");
});

test("inspect-place-candidates fails clearly for unknown cities", () => {
  const result = runInspect("unknown-city");

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown city "unknown-city"/);
});
