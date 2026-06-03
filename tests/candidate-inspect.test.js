const assert = require("node:assert/strict");
const test = require("node:test");

const rome = require("../server/cities/rome.js");
const {
  buildCandidateIntelligenceInspect,
} = require("../server/candidates/inspect");

const NOW = "2026-06-03";

test("inspect runs the spine over a real city's existing candidates", () => {
  const out = buildCandidateIntelligenceInspect(rome, { now: NOW });
  assert.equal(out.city, "rome");
  assert.ok(out.candidate_count > 0);
  assert.equal(out.inspected_count, out.candidate_count);
  assert.equal(out.rows.length, out.candidate_count);

  const row = out.rows[0];
  assert.ok(row.id);
  assert.ok(row.derived);
  assert.ok(row.gates);
  assert.equal(row.fit.implemented, false); // v1: fit is contract only
  assert.ok(row.evidence_count >= 1);
});

test("curated catalog candidates come through with strong existence + provenance", () => {
  const out = buildCandidateIntelligenceInspect(rome, { now: NOW });
  const curatedRows = out.rows.filter((row) => row.provenance.human_verified);
  assert.ok(curatedRows.length > 0);
  for (const row of curatedRows) {
    // human-verified curated catalog → high existence confidence retained.
    assert.equal(row.derived.existence_confidence, "high");
  }
});

test("inspect summary tallies gates and existence bands", () => {
  const out = buildCandidateIntelligenceInspect(rome, { now: NOW });
  assert.ok(Number.isFinite(out.summary.by_gate.may_show));
  assert.ok(out.summary.by_gate.may_show > 0);
  assert.equal(typeof out.summary.by_existence_confidence, "object");
});

test("limit caps inspected rows without changing the reported total", () => {
  const out = buildCandidateIntelligenceInspect(rome, { now: NOW, limit: 3 });
  assert.equal(out.inspected_count, 3);
  assert.ok(out.candidate_count >= 3);
});

test("inspect is deterministic for a fixed now", () => {
  const a = buildCandidateIntelligenceInspect(rome, { now: NOW, limit: 10 });
  const b = buildCandidateIntelligenceInspect(rome, { now: NOW, limit: 10 });
  assert.deepEqual(a, b);
});
