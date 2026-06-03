const assert = require("node:assert/strict");
const test = require("node:test");

const { buildBlitzDecision } = require("../server/blitz-engine");
const {
  isExternalCandidatesEnabled,
  evaluateCandidateEligibility,
  buildCandidateBlitzDecision,
} = require("../server/candidates/blitz-candidate-mode");
const {
  createExternalOpenProvider,
  EXTERNAL_OPEN_PROVIDER_META,
} = require("../server/place-candidates/external-open-provider");
const { matchCandidateToIntent } = require("../server/candidates/intent-vocabulary");
const { scoreCandidateFit } = require("../server/candidates/fit-scorer");

const rome = require("../server/cities/rome.js");
const DATE = "2026-06-03";

function externalCandidates(records) {
  return createExternalOpenProvider(rome, { dataset: records, observedAt: DATE }).listCandidates();
}

const TWO_FAMILIES = [
  { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/x" },
  { provider: "wikidata", family: "community", tier: "inferred", url: "https://www.wikidata.org/wiki/Qx" },
];

// --- flag wiring -----------------------------------------------------------
test("external candidates are a nested opt-in flag", () => {
  assert.equal(isExternalCandidatesEnabled({}), false);
  assert.equal(isExternalCandidatesEnabled({ include_external_candidates: 1 }), true);
  assert.equal(isExternalCandidatesEnabled({ candidate_sources: "open" }), true);
  assert.equal(isExternalCandidatesEnabled({ candidate_sources: ["curated", "external"] }), true);
  assert.equal(isExternalCandidatesEnabled({ candidate_sources: "curated" }), false);
});

test("default Blitz (no candidate_mode) never invokes the external provider", async () => {
  let calls = 0;
  const spy = () => {
    calls += 1;
    return [];
  };
  const legacy = await buildBlitzDecision(rome, { date: DATE, external_dataset: spy, preferences: ["scenic"] });
  assert.equal(legacy.experimental, undefined);
  assert.equal(calls, 0);
});

test("candidate_mode without the external flag stays catalog-only", async () => {
  let calls = 0;
  const spy = () => {
    calls += 1;
    return [];
  };
  const out = await buildBlitzDecision(rome, {
    candidate_mode: 1,
    date: DATE,
    external_dataset: spy,
    preferences: ["scenic"],
  });
  assert.equal(calls, 0); // external provider never created
  assert.equal(out.context.external_candidates_enabled, false);
  assert.deepEqual(out.context.candidate_providers, ["curated-catalog"]);
  assert.equal(out.inspect.by_origin.eligible.external_open, undefined);
});

test("external flag adds source-backed candidates (and calls the injected loader once)", async () => {
  let calls = 0;
  const injected = [
    { id: "inj-beach", name: "Injected Beach", type: "beach", lat: 41.73, lng: 12.27, tags: ["coast"], sources: TWO_FAMILIES },
  ];
  const loader = () => {
    calls += 1;
    return injected;
  };
  const out = await buildBlitzDecision(rome, {
    candidate_mode: 1,
    include_external_candidates: 1,
    date: DATE,
    external_dataset: loader,
    preferences: ["swimming"],
  });
  assert.ok(calls >= 1);
  assert.equal(out.context.external_candidates_enabled, true);
  assert.ok(out.context.candidate_providers.includes(EXTERNAL_OPEN_PROVIDER_META.provider_id));
  assert.ok(out.inspect.by_origin.eligible.external_open >= 1);
});

// --- provenance ------------------------------------------------------------
test("external candidates carry provider / source provenance and are not verified", () => {
  const [candidate] = externalCandidates([
    { id: "ext-1", name: "Open Viewpoint", type: "viewpoint", lat: 41.9, lng: 12.46, tags: ["utsikt"], sources: TWO_FAMILIES },
  ]);
  assert.equal(candidate.candidate_origin, "external_open");
  assert.equal(candidate.provider_id, EXTERNAL_OPEN_PROVIDER_META.provider_id);
  assert.equal(candidate.source_family, "map");
  assert.equal(candidate.source_policy, EXTERNAL_OPEN_PROVIDER_META.source_policy);
  assert.equal(candidate.trust.human_verified, false);
  assert.equal(candidate.city_pack_owned, false);
  // explicit evidence claims exist (existence + location + category per source)
  const kinds = candidate.evidence.map((e) => e.claim_type);
  assert.ok(kinds.includes("existence"));
  assert.ok(kinds.includes("location"));
  assert.ok(kinds.includes("category"));
});

// --- gates -----------------------------------------------------------------
test("a weak single-family external candidate fails the gates", () => {
  const [weak] = externalCandidates([
    { id: "w", name: "Weak cafe", type: "cafe", lat: 41.9, lng: 12.46, sources: [{ provider: "osm", family: "map", tier: "inferred" }] },
  ]);
  const e = evaluateCandidateEligibility(weak, { now: DATE });
  assert.equal(e.eligible, false);
  assert.equal(e.derived.existence_confidence, "low");
});

test("consensus alone does not promote an external candidate", () => {
  const [hyped] = externalCandidates([
    {
      id: "h",
      name: "Hyped bar",
      type: "cocktail-bar",
      lat: 41.9,
      lng: 12.48,
      sources: [{ provider: "osm", family: "map", tier: "inferred" }],
      popularity: { count: 9000, rating: 4.9 },
    },
  ]);
  const e = evaluateCandidateEligibility(hyped, { now: DATE });
  assert.equal(e.eligible, false);
  assert.equal(e.derived.consensus.volume_band, "lots"); // consensus seen…
  assert.equal(e.derived.existence_confidence, "low"); // …but does not promote
});

test("a source-URL-only external item does not become a place target", () => {
  const [urlOnly] = externalCandidates([
    { id: "u", name: "Listing without location", type: "bar", sources: [{ provider: "blog", family: "community", tier: "inferred", url: "https://example.org/x" }] },
  ]);
  assert.equal(urlOnly.candidate_kind, "map_result"); // unlocated
  const e = evaluateCandidateEligibility(urlOnly, { now: DATE });
  assert.equal(e.eligible, false);
  assert.ok(e.gates.reasons.includes("no_reliable_place_target"));
});

test("an open candidate with reliable coordinates + corroborating evidence is eligible", () => {
  const [strong] = externalCandidates([
    { id: "s", name: "Corroborated viewpoint", type: "viewpoint", lat: 41.92, lng: 12.45, tags: ["utsikt"], sources: TWO_FAMILIES },
  ]);
  const e = evaluateCandidateEligibility(strong, { now: DATE });
  assert.equal(e.eligible, true);
  assert.equal(e.derived.provenance_diversity, 2);
  assert.equal(e.gates.may_create_place_candidate, true); // corroborated → promotable
});

// --- ranking vs curated ----------------------------------------------------
test("a curated candidate still beats an external one when it fits as well", () => {
  const out = buildCandidateBlitzDecision(rome, {
    candidate_mode: 1,
    include_external_candidates: 1,
    date: DATE,
    preferences: ["scenic"],
  });
  // Rome's curated viewpoints (existence high) out-rank the medium external one.
  assert.equal(out.best_move.origin, "curated_catalog");
  assert.equal(out.best_move.type, "viewpoint");
});

test("an external candidate wins when it is the only strong preference match", () => {
  // Rome's curated catalog has no swimming; the open beach is the only match.
  const out = buildCandidateBlitzDecision(rome, {
    candidate_mode: 1,
    include_external_candidates: 1,
    date: DATE,
    preferences: ["swimming"],
  });
  assert.equal(out.best_move.origin, "external_open");
  assert.ok(out.best_move.covered_preferences.includes("swimming"));
  assert.equal(out.best_move.match_tier, "primary");
  assert.equal(out.best_move.provenance.human_verified, false);
});

// --- intent preservation for external --------------------------------------
test("second_hand/vintage and scenic/viewpoint are preserved for external candidates", () => {
  const [vintage] = externalCandidates([
    { id: "v", name: "Open vintage", type: "vintage-shop", lat: 41.89, lng: 12.47, tags: ["second_hand", "vintage"], sources: TWO_FAMILIES },
  ]);
  const [view] = externalCandidates([
    { id: "vp", name: "Open viewpoint", type: "viewpoint", lat: 41.92, lng: 12.45, tags: ["utsikt"], sources: TWO_FAMILIES },
  ]);

  assert.equal(matchCandidateToIntent(vintage, "second_hand").level, "strong");
  assert.equal(matchCandidateToIntent(view, "scenic").level, "strong");

  const vintageFit = scoreCandidateFit({ candidate: vintage, userIntents: ["second_hand"], context: { timeBand: "midday" } });
  assert.ok(vintageFit.covered_preferences.includes("second_hand"));
  const viewFit = scoreCandidateFit({ candidate: view, userIntents: ["scenic"], context: { timeBand: "afternoon" } });
  assert.ok(viewFit.covered_preferences.includes("scenic"));
});

// --- no network ------------------------------------------------------------
test("external provider performs no network calls (fetch is never touched)", async () => {
  const originalFetch = global.fetch;
  global.fetch = () => {
    throw new Error("network call attempted during external candidate test");
  };
  try {
    const out = await buildBlitzDecision(rome, {
      candidate_mode: 1,
      include_external_candidates: 1,
      date: DATE,
      preferences: ["swimming"],
    });
    assert.ok(out.best_move); // built entirely from fixtures, no fetch
  } finally {
    global.fetch = originalFetch;
  }
});
