/**
 * Promotion dry-run: Athens pilot catalog v0.1
 *
 * Quality gate for `promote_first` entries in a candidate-pack doc file.
 * Runs BEFORE any catalog.js edit; catches promotion blockers at the
 * doc-review stage rather than after a developer writes runtime code.
 *
 * This test does NOT promote any candidate into server/cities/athens/.
 * It does NOT add route templates or change city visibility.
 * It uses the same parser exported from server/candidate-packs/validate.js
 * that the existing candidate-pack-validate tests use.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  parseCandidatePack,
  validateCandidatePack,
  parseListValue,
} = require("../server/candidate-packs/validate");

const PACK_PATH = path.join(
  __dirname,
  "..",
  "docs",
  "candidate-packs",
  "athens-pilot-catalog-v0.1.md",
);

const packMarkdown = fs.readFileSync(PACK_PATH, "utf8");
const { candidates: allCandidates } = parseCandidatePack(packMarkdown);
const promoteCandidates = allCandidates.filter(
  (c) => c.promotion_recommendation === "promote_first",
);

// Candidate kinds that may legitimately appear in a promote_first set.
// area_preset and generated_place are blocked by the pack validator itself;
// structural_anchor and map_result are not runtime venue types.
const PROMOTABLE_CANDIDATE_KINDS = new Set(["real_place", "event_venue"]);

// Blocker language that must not appear anywhere in a promote_first entry.
// These phrases signal an unresolved problem that was not caught during
// verification and would mislead a runtime promotion PR.
const BLOCKER_PHRASES = [
  "UNRESOLVED",
  "needs_research",
  "reject_for_now",
  "keep_as_optional",
  "no source",
  "unknown address",
  "area-model blocker",
];

// Slug-safe id: lower-case, letters/digits/hyphens, must start with a letter.
const SLUG_RE = /^[a-z][a-z0-9-]*$/;

// Must contain at least one https:// URL for a source note to count as cited.
const URL_RE = /https:\/\/\S+/;

/* ------------------------------------------------------------------ */
/* Pack-level gate: validator status                                   */
/* ------------------------------------------------------------------ */

test("athens v0.1 pack validates as promotion_safe before any dry-run check", () => {
  const report = validateCandidatePack(packMarkdown, { sourcePath: PACK_PATH });
  assert.equal(
    report.status,
    "promotion_safe",
    `Expected promotion_safe but got ${report.status}. Errors: ${JSON.stringify(report.errors)}`,
  );
  assert.deepEqual(report.errors, [], "pack must have zero hard errors");
});

/* ------------------------------------------------------------------ */
/* promote_first count                                                 */
/* ------------------------------------------------------------------ */

test("athens v0.1 contains exactly 11 promote_first candidates", () => {
  assert.equal(
    promoteCandidates.length,
    11,
    `Expected 11 promote_first candidates, found ${promoteCandidates.length}: ${promoteCandidates.map((c) => c.proposed_id).join(", ")}`,
  );
});

/* ------------------------------------------------------------------ */
/* Per-candidate dry-run assertions                                    */
/* ------------------------------------------------------------------ */

for (const candidate of promoteCandidates) {
  const id = candidate.proposed_id || "(no proposed_id)";

  test(`promote_first candidate "${id}": proposed_id is slug-safe`, () => {
    assert.ok(
      candidate.proposed_id,
      `"${id}" is missing proposed_id`,
    );
    assert.match(
      candidate.proposed_id,
      SLUG_RE,
      `proposed_id "${candidate.proposed_id}" is not slug-safe (lowercase letters, digits, hyphens only, starts with letter)`,
    );
  });

  test(`promote_first candidate "${id}": name exists`, () => {
    assert.ok(
      typeof candidate.name === "string" && candidate.name.trim().length > 0,
      `"${id}" is missing a non-empty name`,
    );
  });

  test(`promote_first candidate "${id}": city is athens`, () => {
    assert.equal(
      candidate.city,
      "athens",
      `"${id}" city is "${candidate.city}", expected "athens"`,
    );
  });

  test(`promote_first candidate "${id}": candidate_kind is promotable (real_place or event_venue)`, () => {
    assert.ok(
      PROMOTABLE_CANDIDATE_KINDS.has(candidate.candidate_kind),
      `"${id}" candidate_kind "${candidate.candidate_kind}" is not in the promotable set [${[...PROMOTABLE_CANDIDATE_KINDS].join(", ")}]`,
    );
  });

  test(`promote_first candidate "${id}": neighborhood exists and is not UNRESOLVED`, () => {
    assert.ok(
      typeof candidate.neighborhood === "string" && candidate.neighborhood.trim().length > 0,
      `"${id}" is missing a non-empty neighborhood`,
    );
    assert.notEqual(
      candidate.neighborhood.trim().toUpperCase(),
      "UNRESOLVED",
      `"${id}" neighborhood is UNRESOLVED — area-model decision required before promotion`,
    );
  });

  test(`promote_first candidate "${id}": category exists`, () => {
    assert.ok(
      typeof candidate.category === "string" && candidate.category.trim().length > 0,
      `"${id}" is missing a non-empty category`,
    );
  });

  test(`promote_first candidate "${id}": tags is a non-empty list`, () => {
    const tags = parseListValue(candidate.tags);
    assert.ok(
      Array.isArray(tags) && tags.length > 0,
      `"${id}" tags must be a non-empty bracketed list (got: "${candidate.tags}")`,
    );
  });

  test(`promote_first candidate "${id}": route_role is a non-empty list`, () => {
    const roles = parseListValue(candidate.route_role);
    assert.ok(
      Array.isArray(roles) && roles.length > 0,
      `"${id}" route_role must be a non-empty bracketed list (got: "${candidate.route_role}")`,
    );
  });

  test(`promote_first candidate "${id}": confidence is high or medium (not needs_review)`, () => {
    assert.ok(
      candidate.confidence === "high" || candidate.confidence === "medium",
      `"${id}" confidence is "${candidate.confidence}" — promote_first candidates must be verified (high or medium)`,
    );
  });

  test(`promote_first candidate "${id}": promotion_recommendation is promote_first`, () => {
    assert.equal(
      candidate.promotion_recommendation,
      "promote_first",
      `"${id}" has promotion_recommendation "${candidate.promotion_recommendation}" but was expected in the promote_first set`,
    );
  });

  test(`promote_first candidate "${id}": source_notes contain at least one exact URL`, () => {
    assert.ok(
      typeof candidate.source_notes === "string" && URL_RE.test(candidate.source_notes),
      `"${id}" source_notes do not contain an exact URL (https://…). Current value:\n${candidate.source_notes}`,
    );
  });

  test(`promote_first candidate "${id}": why_it_fits_parranda exists`, () => {
    assert.ok(
      typeof candidate.why_it_fits_parranda === "string" &&
        candidate.why_it_fits_parranda.trim().length > 0,
      `"${id}" is missing a non-empty why_it_fits_parranda`,
    );
  });

  test(`promote_first candidate "${id}": no unresolved-blocker language in any field`, () => {
    const allText = JSON.stringify(candidate);
    const found = BLOCKER_PHRASES.filter((phrase) => allText.includes(phrase));
    assert.deepEqual(
      found,
      [],
      `"${id}" contains unresolved-blocker language: ${found.join(", ")}. ` +
        `Fix the candidate entry or downgrade it before the runtime promotion PR.`,
    );
  });
}

/* ------------------------------------------------------------------ */
/* Cross-candidate sanity                                              */
/* ------------------------------------------------------------------ */

test("promote_first proposed_ids are all unique (no duplicate IDs)", () => {
  const ids = promoteCandidates.map((c) => c.proposed_id);
  const seen = new Set();
  const duplicates = ids.filter((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
  assert.deepEqual(
    duplicates,
    [],
    `Duplicate proposed_ids detected: ${duplicates.join(", ")}`,
  );
});

test("promote_first candidates cover at least 4 distinct neighborhoods", () => {
  const neighborhoods = new Set(promoteCandidates.map((c) => c.neighborhood).filter(Boolean));
  assert.ok(
    neighborhoods.size >= 4,
    `Expected at least 4 distinct neighborhoods in the promote_first set; got ${neighborhoods.size}: ${[...neighborhoods].join(", ")}`,
  );
});

test("promote_first set contains at least one event_venue candidate for Live source wiring", () => {
  const eventVenues = promoteCandidates.filter((c) => c.candidate_kind === "event_venue");
  assert.ok(
    eventVenues.length >= 1,
    `Expected at least one event_venue in promote_first (for future Live source wiring); got 0`,
  );
});
