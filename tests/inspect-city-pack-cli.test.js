const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const scriptPath = path.join(__dirname, "..", "scripts", "inspect-city-pack.js");
const repoRoot = path.join(__dirname, "..");

function runInspect(city) {
  return spawnSync(process.execPath, [scriptPath, city], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("inspect-city-pack prints Rome installability diagnostics", () => {
  const result = runInspect("rome");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /City pack inspection: rome \(Rom\)/);
  assert.match(result.stdout, /Core metadata:/);
  assert.match(result.stdout, /Catalog:/);
  assert.match(result.stdout, /PlaceCandidate readiness:/);
  assert.match(result.stdout, /Support:/);
  assert.match(result.stdout, /Final status: (ready|preview_ready|partial)/);
  assert.equal(result.stderr, "");
});

test("inspect-city-pack prints help without requiring a city key", () => {
  const result = runInspect("--help");

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "Usage: node scripts/inspect-city-pack.js <city-key>\n");
  assert.equal(result.stderr, "");
});

test("inspect-city-pack prints Barcelona diagnostics without exact count assumptions", () => {
  const result = runInspect("barcelona");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /City pack inspection: barcelona \(Barcelona\)/);
  assert.match(result.stdout, /Visibility: beta/);
  assert.match(result.stdout, /- real places: \d+/);
  assert.match(result.stdout, /- structural anchors: \d+/);
  assert.match(result.stdout, /- route templates: \d+/);
  assert.match(result.stdout, /Final status: (ready|preview_ready|partial)/);
  assert.equal(result.stderr, "");
});

test("inspect-city-pack supports registered Athens preview skeleton", () => {
  const result = runInspect("athens");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /City pack inspection: athens \(Athens\)/);
  assert.match(result.stdout, /Visibility: preview/);
  assert.match(result.stdout, /- items: 26/);
  assert.match(result.stdout, /- route templates: 0/);
  assert.match(result.stdout, /- Blitz baseline: yes/);
  assert.match(result.stdout, /- can support Planner candidates: yes/);
  assert.match(result.stdout, /- Planner baseline: no/);
  assert.match(result.stdout, /Final status: preview_ready/);
  assert.equal(result.stderr, "");
});

test("inspect-city-pack supports registered test-city", () => {
  const result = runInspect("test-city");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /City pack inspection: test-city \(Test City\)/);
  assert.match(result.stdout, /Visibility: internal/);
  assert.match(result.stdout, /- Blitz baseline: no/);
  assert.match(result.stdout, /- Planner baseline: no/);
  assert.equal(result.stderr, "");
});

test("inspect-city-pack fails clearly for unknown cities without Rome fallback", () => {
  const result = runInspect("unknown-city");

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown city "unknown-city"/);
  assert.match(result.stderr, /barcelona/);
  assert.match(result.stderr, /rome/);
  assert.match(result.stderr, /test-city/);
});
