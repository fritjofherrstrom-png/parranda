const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const scriptPath = path.join(__dirname, "..", "scripts", "inspect-candidate-pack.js");
const repoRoot = path.join(__dirname, "..");
const barcelonaPath = path.join(
  "docs",
  "candidate-packs",
  "barcelona-second-hand-v0.md",
);

function runCli(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("inspect-candidate-pack prints intake_only report for Barcelona second-hand v0", () => {
  const result = runCli([barcelonaPath]);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(
    result.stdout,
    /Candidate pack inspection: docs\/candidate-packs\/barcelona-second-hand-v0\.md/,
  );
  assert.match(result.stdout, /pack_name: barcelona-second-hand-v0/);
  assert.match(result.stdout, /city: barcelona/);
  assert.match(result.stdout, /Candidate count: 18/);
  assert.match(result.stdout, /- area_preset: 8/);
  assert.match(result.stdout, /- event_venue: 5/);
  assert.match(result.stdout, /- generated_place: 4/);
  assert.match(result.stdout, /- real_place: 1/);
  assert.match(result.stdout, /- needs_review: 18/);
  assert.match(result.stdout, /- high: 3/);
  assert.match(result.stdout, /- low: 12/);
  assert.match(result.stdout, /Hard errors: none/);
  assert.match(result.stdout, /Warnings: none/);
  assert.match(result.stdout, /Status: intake_only/);
  assert.equal(result.stderr, "");
});

test("inspect-candidate-pack exits 1 when no path argument is given", () => {
  const result = runCli([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: node scripts\/inspect-candidate-pack\.js/);
});

test("inspect-candidate-pack exits 1 when the file cannot be read", () => {
  const result = runCli(["docs/candidate-packs/does-not-exist.md"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Failed to read/);
});

test("inspect-candidate-pack reports blocked status with non-zero exit on invalid pack", () => {
  // Write a temp pack that violates the needs_review + promote_first rule.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-pack-"));
  const fixturePath = path.join(tempDir, "broken-pack.md");
  fs.writeFileSync(
    fixturePath,
    [
      "```text",
      "pack_name: broken-fixture",
      "city: barcelona",
      "theme: broken fixture",
      "intended_use: fixture",
      "quality_bar: n/a",
      "promotion_criteria: n/a",
      "pack_version: v0",
      "last_updated: 2026-05-22",
      "author: test",
      "```",
      "",
      "```text",
      "proposed_id: broken-candidate",
      "name: Broken Candidate",
      "city: barcelona",
      "neighborhood: Test",
      "category: test",
      "candidate_kind: real_place",
      "source_kind: city_catalog",
      "route_role: [main_stop]",
      "vibes: [curious]",
      "tags: [test]",
      "why_it_fits_parranda: This pairing must be rejected.",
      "confidence: needs_review",
      "source_notes: fixture",
      "verification_priority: high",
      "promotion_recommendation: promote_first",
      "```",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = runCli([fixturePath]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Status: blocked/);
    assert.match(result.stdout, /needs_review_with_promote_first/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
