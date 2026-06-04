/**
 * Experience-lens fit scoring v1 (#243).
 *
 * Lens (first_time / local / rediscover / surprise) reweights which PLACES rise
 * from the SAME candidate set — additive lifts only, bounded, so it tilts within
 * a coverage tier and never overrides intent coverage or curated-first.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { scoreCandidateFit } = require("../server/candidates/fit-scorer");
const { buildCandidateBlitzDecision } = require("../server/candidates/blitz-candidate-mode");
const { buildAgnosticCityContext } = require("../server/candidates/agnostic-context");

const rome = require("../server/cities/rome.js");
const DATE = "2026-06-03";

const landmark = { type: "landmark", tags: ["klassiker"] };
const localSpot = { type: "cafe", tags: ["lokalt", "hidden gems"] };
const plain = { type: "viewpoint", tags: ["utsikt"] };

function lensScore(candidate, lens, intent) {
  return scoreCandidateFit({
    candidate,
    userIntents: intent ? [intent] : [],
    context: { timeBand: "midday", lens },
  });
}

// --- unit: the local dimension --------------------------------------------
test("no lens / balanced leaves the local dimension neutral (no regression)", () => {
  assert.equal(lensScore(landmark, null).dimensions.local.score, 0);
  assert.equal(lensScore(landmark, "balanced").dimensions.local.score, 0);
});

test("first_time lifts legible/iconic places, not neighborhood ones", () => {
  assert.equal(lensScore(landmark, "first_time").dimensions.local.score, 0.4);
  assert.equal(lensScore(localSpot, "first_time").dimensions.local.score, 0);
  assert.equal(lensScore(plain, "first_time").dimensions.local.score, 0);
});

test("local / rediscover lift neighborhood places, not iconic defaults", () => {
  assert.equal(lensScore(localSpot, "local").dimensions.local.score, 0.4);
  assert.equal(lensScore(localSpot, "rediscover").dimensions.local.score, 0.4);
  assert.equal(lensScore(landmark, "local").dimensions.local.score, 0); // softened only relatively
});

test("lens is additive-only — it never produces a negative score", () => {
  for (const lens of ["first_time", "local", "rediscover", "surprise"]) {
    for (const c of [landmark, localSpot, plain]) {
      assert.ok(lensScore(c, lens).dimensions.local.score >= 0, `${lens}/${c.type}`);
    }
  }
});

test("a place with no legibility/localness signal is never boosted (no blind reward)", () => {
  assert.equal(lensScore(plain, "local").dimensions.local.score, 0);
  assert.equal(lensScore(plain, "first_time").dimensions.local.score, 0);
});

// --- guardrail: lens never overrides coverage ------------------------------
test("lens cannot make a non-covering place outrank a covering one", () => {
  // a covered viewpoint vs a partial café, with first_time boosting... nothing
  // here changes that coverage is the primary sort key.
  const covered = lensScore({ type: "viewpoint", tags: ["utsikt"] }, "first_time", "scenic");
  const partialOnly = lensScore({ type: "cafe", tags: ["klassiker"] }, "first_time", "scenic");
  assert.equal(covered.coverage_rank[0], 1);
  assert.equal(partialOnly.coverage_rank[0], 0);
});

// --- integration: same city, different lens, different move ----------------
test("the same scenic request yields different best moves under tourist vs local lens", () => {
  const firstTime = buildCandidateBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"], lens: "first_time" });
  const local = buildCandidateBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"], lens: "local" });
  assert.notEqual(firstTime.best_move.candidate_id, local.best_move.candidate_id);
  // both still cover the intent — lens reorders, it doesn't break the request
  assert.ok(firstTime.best_move.covered_preferences.includes("scenic"));
  assert.ok(local.best_move.covered_preferences.includes("scenic"));
});

test("balanced (no lens) behaviour is unchanged vs omitting lens", () => {
  const withBalanced = buildCandidateBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"], lens: "balanced" });
  const noLens = buildCandidateBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"] });
  assert.equal(withBalanced.best_move.candidate_id, noLens.best_move.candidate_id);
});

// --- guardrail: curated-first preserved under lens -------------------------
test("curated still beats an external candidate that lacks the lens signal", () => {
  // external viewpoint with no localness tag; under local lens it gets no lift,
  // so a comparably-covering curated viewpoint stays ahead (#235).
  const out = buildCandidateBlitzDecision(
    rome,
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["scenic"], lens: "local", now: `${DATE}T19:30:00` },
    {
      external_provider: {
        dataset: [
          { id: "ext-view", name: "Open Viewpoint", type: "viewpoint", lat: 41.9, lng: 12.46, tags: ["utsikt"], time_fit: ["golden-hour", "sun"], sources: [{ provider: "osm", family: "map", tier: "inferred" }, { provider: "wikidata", family: "open_knowledge", tier: "inferred" }] },
        ],
      },
    },
  );
  assert.equal(out.best_move.origin, "curated_catalog");
});

test("lens score is surfaced on the move for inspectability", () => {
  const out = buildCandidateBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"], lens: "first_time" });
  assert.ok(Number.isFinite(out.best_move.dimensions.local.score));
  assert.equal(out.context.lens, "first_time");
});

// --- agnostic context: lens works on external candidates too ---------------
test("lens lifts a neighborhood external candidate in local mode", () => {
  const ctx = buildAgnosticCityContext({ lat: 55.6, lng: 13.0, todayIsoDate: () => DATE });
  const records = [
    { id: "ext-local", name: "Möllan Kafé", type: "cafe", lat: 55.6, lng: 13.0, tags: ["fika", "lokalt"], sources: [{ provider: "osm", family: "map", tier: "inferred" }, { provider: "wikidata", family: "open_knowledge", tier: "inferred" }] },
    { id: "ext-plain", name: "Central Kafé", type: "cafe", lat: 55.6, lng: 13.0, tags: ["fika"], sources: [{ provider: "osm", family: "map", tier: "inferred" }, { provider: "wikidata", family: "open_knowledge", tier: "inferred" }] },
  ];
  const local = buildCandidateBlitzDecision(ctx, { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["coffee"], lens: "local" }, { external_provider: { dataset: records } });
  assert.equal(local.best_move.candidate_id, "ext-local"); // neighborhood café rises under local lens
});
