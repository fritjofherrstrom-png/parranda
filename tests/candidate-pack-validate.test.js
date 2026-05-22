const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  parseCandidatePack,
  validateCandidatePack,
  parseListValue,
  REQUIRED_PACK_METADATA,
  REQUIRED_CANDIDATE_FIELDS,
} = require("../server/candidate-packs/validate");

const barcelonaPackPath = path.join(
  __dirname,
  "..",
  "docs",
  "candidate-packs",
  "barcelona-second-hand-v0.md",
);
const barcelonaPack = fs.readFileSync(barcelonaPackPath, "utf8");

/* -------------------------------------------------------- */
/* Parser                                                   */
/* -------------------------------------------------------- */

test("parser extracts metadata + every candidate block from Barcelona pack", () => {
  const { metadata, candidates } = parseCandidatePack(barcelonaPack);
  assert.equal(metadata.pack_name, "barcelona-second-hand-v0");
  assert.equal(metadata.city, "barcelona");
  assert.equal(metadata.pack_version, "v0");
  assert.equal(candidates.length, 18);
  assert.ok(candidates.every((c) => c.proposed_id), "every candidate has proposed_id");
});

test("parser concatenates multi-line continuation values with a single space", () => {
  const markdown = [
    "```text",
    "proposed_id:               example",
    "name:                      Example Venue",
    "why_it_fits_parranda:      First line continues",
    "                           into a second line",
    "                           and a third.",
    "candidate_kind:            real_place",
    "```",
  ].join("\n");
  const { candidates } = parseCandidatePack(markdown);
  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0].why_it_fits_parranda,
    "First line continues into a second line and a third.",
  );
  assert.equal(candidates[0].candidate_kind, "real_place");
});

test("parser ignores blocks that contain neither pack_name nor proposed_id", () => {
  const markdown = [
    "```text",
    "some_other_block: ignore me",
    "```",
    "",
    "```text",
    "pack_name: test",
    "city: test",
    "theme: test",
    "intended_use: test",
    "quality_bar: test",
    "promotion_criteria: test",
    "pack_version: v0",
    "last_updated: 2026-01-01",
    "author: test",
    "```",
  ].join("\n");
  const { metadata, candidates } = parseCandidatePack(markdown);
  assert.equal(metadata.pack_name, "test");
  assert.equal(candidates.length, 0);
});

test("parseListValue parses bracketed comma-separated values", () => {
  assert.deepEqual(parseListValue("[a, b, c]"), ["a", "b", "c"]);
  assert.deepEqual(parseListValue("[]"), []);
  assert.deepEqual(parseListValue("[ slow , buzzy ]"), ["slow", "buzzy"]);
  assert.equal(parseListValue("not a list"), null);
  assert.equal(parseListValue(""), null);
});

/* -------------------------------------------------------- */
/* Validator — happy path                                   */
/* -------------------------------------------------------- */

test("Barcelona second-hand v0 validates as intake_only with no errors and no warnings", () => {
  const report = validateCandidatePack(barcelonaPack, { sourcePath: barcelonaPackPath });
  assert.equal(report.status, "intake_only");
  assert.deepEqual(report.errors, [], "no hard errors");
  assert.deepEqual(report.warnings, [], "no warnings");
  assert.equal(report.candidates.length, 18);
  assert.equal(report.distributions.confidence.needs_review, 18);
});

test("validator vocabularies cover every field shipped in CANDIDATE_PACK_FORMAT.md", () => {
  // Sanity guard: the required field lists are not empty and align with
  // what the spec promises pack authors. If a field is added or
  // renamed in the spec, this test forces a sync update.
  assert.ok(REQUIRED_PACK_METADATA.includes("pack_name"));
  assert.ok(REQUIRED_PACK_METADATA.includes("promotion_criteria"));
  assert.ok(REQUIRED_CANDIDATE_FIELDS.includes("proposed_id"));
  assert.ok(REQUIRED_CANDIDATE_FIELDS.includes("verification_priority"));
  assert.ok(REQUIRED_CANDIDATE_FIELDS.includes("promotion_recommendation"));
});

/* -------------------------------------------------------- */
/* Validator — invalid fixtures (one rule per test)         */
/* -------------------------------------------------------- */

function buildMinimalCandidate(overrides = {}) {
  const defaults = {
    proposed_id: "fixture-candidate",
    name: "Fixture Candidate",
    city: "barcelona",
    neighborhood: "Test",
    category: "fixture",
    candidate_kind: "real_place",
    source_kind: "city_catalog",
    route_role: "[main_stop]",
    vibes: "[curious]",
    tags: "[fixture]",
    why_it_fits_parranda: "Fixture for tests.",
    confidence: "needs_review",
    source_notes: "Fixture-only.",
    verification_priority: "low",
    promotion_recommendation: "needs_research",
  };
  return { ...defaults, ...overrides };
}

function buildMinimalMetadata(overrides = {}) {
  return {
    pack_name: "fixture-pack",
    city: "barcelona",
    theme: "Fixture pack",
    intended_use: "Test fixtures only",
    quality_bar: "n/a",
    promotion_criteria: "n/a",
    pack_version: "v0",
    last_updated: "2026-05-22",
    author: "test fixture",
    ...overrides,
  };
}

function buildPackMarkdown({ metadata = buildMinimalMetadata(), candidates = [buildMinimalCandidate()] } = {}) {
  const blocks = [];
  if (metadata) blocks.push(toFencedBlock(metadata));
  for (const candidate of candidates) blocks.push(toFencedBlock(candidate));
  return blocks.join("\n\n");
}

function toFencedBlock(fields) {
  const lines = ["```text"];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push("```");
  return lines.join("\n");
}

test("missing pack metadata block → missing_pack_metadata", () => {
  const markdown = buildPackMarkdown({ metadata: null });
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "blocked");
  assert.ok(report.errors.some((e) => e.code === "missing_pack_metadata"));
});

test("missing required metadata field → missing_metadata_field", () => {
  const metadata = buildMinimalMetadata();
  delete metadata.theme;
  const markdown = buildPackMarkdown({ metadata });
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "blocked");
  assert.ok(
    report.errors.some(
      (e) => e.code === "missing_metadata_field" && e.field === "theme",
    ),
  );
});

test("missing required candidate field → missing_candidate_field", () => {
  const candidate = buildMinimalCandidate();
  delete candidate.confidence;
  const markdown = buildPackMarkdown({ candidates: [candidate] });
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "blocked");
  assert.ok(
    report.errors.some(
      (e) => e.code === "missing_candidate_field" && e.field === "confidence",
    ),
  );
});

test("invalid candidate_kind → invalid_candidate_kind", () => {
  const markdown = buildPackMarkdown({
    candidates: [buildMinimalCandidate({ candidate_kind: "mystery_place" })],
  });
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "blocked");
  assert.ok(
    report.errors.some(
      (e) => e.code === "invalid_candidate_kind" && e.value === "mystery_place",
    ),
  );
});

test("invalid source_kind → invalid_source_kind (catches catalog drift)", () => {
  const markdown = buildPackMarkdown({
    candidates: [buildMinimalCandidate({ source_kind: "catalog" })],
  });
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "blocked");
  assert.ok(
    report.errors.some(
      (e) => e.code === "invalid_source_kind" && e.value === "catalog",
    ),
  );
});

test("invalid vibe → invalid_vibe", () => {
  const markdown = buildPackMarkdown({
    candidates: [buildMinimalCandidate({ vibes: "[serene, slow]" })],
  });
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "blocked");
  assert.ok(
    report.errors.some((e) => e.code === "invalid_vibe" && e.value === "serene"),
  );
});

test("confidence: needs_review + promotion_recommendation: promote_first → hard error", () => {
  const markdown = buildPackMarkdown({
    candidates: [
      buildMinimalCandidate({
        confidence: "needs_review",
        promotion_recommendation: "promote_first",
      }),
    ],
  });
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "blocked");
  assert.ok(
    report.errors.some((e) => e.code === "needs_review_with_promote_first"),
  );
});

test("generated_place + promote_first → hard error (cannot be runtime venue)", () => {
  const markdown = buildPackMarkdown({
    candidates: [
      buildMinimalCandidate({
        candidate_kind: "generated_place",
        source_kind: "generated",
        confidence: "high",
        promotion_recommendation: "promote_first",
      }),
    ],
  });
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "blocked");
  assert.ok(
    report.errors.some((e) => e.code === "generated_place_marked_promote_first"),
  );
});

test("area_preset + promote_first → hard error (cannot be fake shop)", () => {
  const markdown = buildPackMarkdown({
    candidates: [
      buildMinimalCandidate({
        candidate_kind: "area_preset",
        source_kind: "routing_config",
        confidence: "high",
        promotion_recommendation: "promote_first",
      }),
    ],
  });
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "blocked");
  assert.ok(
    report.errors.some((e) => e.code === "area_preset_marked_promote_first"),
  );
});

test("non-canonical route_role → warning (not blocking)", () => {
  const markdown = buildPackMarkdown({
    candidates: [buildMinimalCandidate({ route_role: "[main_stop, unicorn_role]" })],
  });
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "intake_only");
  assert.deepEqual(report.errors, []);
  assert.ok(
    report.warnings.some(
      (w) => w.code === "non_canonical_route_role" && w.value === "unicorn_role",
    ),
  );
});

test("verified real_place + promote_first → status: promotion_safe", () => {
  const markdown = buildPackMarkdown({
    candidates: [
      buildMinimalCandidate({
        candidate_kind: "real_place",
        confidence: "high",
        verification_priority: "high",
        promotion_recommendation: "promote_first",
      }),
    ],
  });
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "promotion_safe");
  assert.deepEqual(report.errors, []);
});

test("no candidates at all → no_candidates error", () => {
  const markdown = toFencedBlock(buildMinimalMetadata());
  const report = validateCandidatePack(markdown);
  assert.equal(report.status, "blocked");
  assert.ok(report.errors.some((e) => e.code === "no_candidates"));
});
