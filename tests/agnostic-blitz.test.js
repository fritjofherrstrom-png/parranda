const assert = require("node:assert/strict");
const test = require("node:test");

const { buildBlitzDecision } = require("../server/blitz-engine");
const { buildCandidateBlitzDecision } = require("../server/candidates/blitz-candidate-mode");
const { buildAgnosticCityContext } = require("../server/candidates/agnostic-context");

const rome = require("../server/cities/rome.js");
const athens = require("../server/cities/athens/index.js");
const DATE = "2026-06-03";

// 2 distinct families, all inferred tier → existence "medium" via diversity.
const TWO_FAMILIES_MAP = [
  { provider: "osm", family: "map", tier: "inferred" },
  { provider: "opendata", family: "official", tier: "inferred" },
];
const TWO_FAMILIES_EDITORIAL = [
  { provider: "local-food-writer", family: "editorial", tier: "inferred" },
  { provider: "community-guide", family: "community", tier: "inferred" },
];
const TWO_FAMILIES_COMMUNITY = [
  { provider: "localblog", family: "community", tier: "inferred" },
  { provider: "local-guide", family: "editorial", tier: "inferred" },
];

function loaderOf(records) {
  return () => records.map((r) => ({ ...r }));
}

// --- no regression ---------------------------------------------------------
test("catalog-only candidate_mode is unchanged (curated still wins, now labeled rich/high)", async () => {
  const out = await buildBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"] });
  assert.equal(out.best_move.origin, "curated_catalog");
  assert.equal(out.best_move.type, "viewpoint");
  assert.equal(out.context.catalog_density, "rich");
  assert.equal(out.confidence.level, "high");
});

test("default Blitz (no candidate_mode) is untouched — no confidence/density fields", async () => {
  const legacy = await buildBlitzDecision(rome, { date: DATE, preferences: ["scenic"] });
  assert.equal(legacy.experimental, undefined);
  assert.equal(legacy.confidence, undefined);
});

// --- density honesty -------------------------------------------------------
test("catalog density reflects curated ground-truth, not external augmentation", async () => {
  const romeOut = await buildBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"] });
  assert.equal(romeOut.context.catalog_density, "rich");

  const athensOut = await buildBlitzDecision(athens, { candidate_mode: 1, date: DATE, preferences: ["scenic"] });
  assert.equal(athensOut.context.catalog_density, "thin"); // preview city stays honestly thin

  // an uncurated coordinate area is honestly "absent" even with open candidates
  const agnostic = buildAgnosticCityContext({ lat: 41.9, lng: 12.5, todayIsoDate: () => DATE });
  const out = buildCandidateBlitzDecision(
    agnostic,
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["scenic"] },
    { external_provider: { dataset: loaderOf([{ id: "x", name: "Open View", type: "viewpoint", lat: 41.9, lng: 12.5, tags: ["utsikt"], sources: TWO_FAMILIES_MAP }]) } },
  );
  assert.equal(out.context.catalog_density, "absent");
  assert.equal(out.context.agnostic, true);
});

// --- honest confidence -----------------------------------------------------
test("a source-backed move never claims full citypack confidence", () => {
  const agnostic = buildAgnosticCityContext({ lat: 41.9, lng: 12.5, todayIsoDate: () => DATE });
  const out = buildCandidateBlitzDecision(
    agnostic,
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["swimming"] },
    { external_provider: { dataset: loaderOf([{ id: "b", name: "Open Beach", type: "beach", lat: 41.9, lng: 12.5, tags: ["coast"], sources: TWO_FAMILIES_MAP }]) } },
  );
  assert.equal(out.best_move.origin, "external_open");
  assert.equal(out.confidence.label, "source_backed");
  assert.notEqual(out.confidence.level, "high"); // capped — corroborated is "medium" at best
  assert.match(out.confidence.note, /source-backed/i);
});

// --- agnostic, fail closed -------------------------------------------------
test("agnostic context with external on but NO loader fails closed honestly", () => {
  const agnostic = buildAgnosticCityContext({ lat: 59.5, lng: 18.0, todayIsoDate: () => DATE });
  const out = buildCandidateBlitzDecision(agnostic, {
    candidate_mode: 1,
    include_external_candidates: 1,
    date: DATE,
    preferences: ["scenic"],
  });
  assert.equal(out.best_move, null);
  assert.equal(out.confidence.level, null);
  assert.equal(out.context.catalog_density, "absent");
});

// --- calibration changes ranking -------------------------------------------
test("source calibration reorders the external set by context (equal existence + fit)", () => {
  // Two equally-corroborated (existence medium), equally-fitting food
  // candidates from different source families. For a FOOD intent a local food
  // writer (editorial) should out-rank a generic map node — decided purely by
  // calibration, since existence and fit are identical.
  const agnostic = buildAgnosticCityContext({ lat: 41.9, lng: 12.5, todayIsoDate: () => DATE });
  const records = [
    { id: "map-eatery", name: "Map Eatery", type: "restaurant", lat: 41.9, lng: 12.5, tags: ["mat"], sources: TWO_FAMILIES_MAP },
    { id: "editorial-eatery", name: "Editorial Eatery", type: "restaurant", lat: 41.9, lng: 12.5, tags: ["mat"], sources: TWO_FAMILIES_EDITORIAL },
  ];
  const opts = { external_provider: { dataset: loaderOf(records) } };

  const out = buildCandidateBlitzDecision(
    agnostic,
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["food"], lens: "local" },
    opts,
  );
  assert.equal(out.best_move.candidate_id, "editorial-eatery");
  // same existence + fit → the editorial source's higher influence decided it
  const sample = Object.fromEntries(out.inspect.ranked_sample.map((r) => [r.id, r.source_influence]));
  assert.ok(sample["editorial-eatery"] > sample["map-eatery"]);

  // …and influence is context-adaptive: the editorial source is worth more in a
  // local lens than to a first-timer.
  const tourist = buildCandidateBlitzDecision(
    agnostic,
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["food"], lens: "first_time" },
    opts,
  );
  const localInfluence = out.best_move.calibration.influence;
  const touristInfluence = tourist.inspect.ranked_sample.find((r) => r.id === "editorial-eatery").source_influence;
  assert.ok(localInfluence > touristInfluence);
});

test("curated retains priority over a comparably-fitting external candidate", () => {
  // Rome has curated golden-hour viewpoints. Give the external one the SAME
  // time profile so fit is genuinely comparable, then in the golden-hour window
  // the curated pick must still win (curated dominates the source tiebreak).
  const out = buildCandidateBlitzDecision(
    rome,
    {
      candidate_mode: 1,
      include_external_candidates: 1,
      date: DATE,
      now: "2026-06-03T19:30:00",
      preferences: ["scenic"],
      lens: "local",
    },
    {
      external_provider: {
        dataset: loaderOf([
          { id: "ext-view", name: "Open Viewpoint", type: "viewpoint", lat: 41.9, lng: 12.46, tags: ["utsikt"], time_fit: ["golden-hour", "sun"], sources: TWO_FAMILIES_COMMUNITY },
        ]),
      },
    },
  );
  assert.equal(out.best_move.origin, "curated_catalog");
});

test("calibration is surfaced in inspect for the ranked set", () => {
  const agnostic = buildAgnosticCityContext({ lat: 41.9, lng: 12.5, todayIsoDate: () => DATE });
  const out = buildCandidateBlitzDecision(
    agnostic,
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["swimming"] },
    { external_provider: { dataset: loaderOf([{ id: "b", name: "Open Beach", type: "beach", lat: 41.9, lng: 12.5, tags: ["coast"], sources: TWO_FAMILIES_MAP }]) } },
  );
  assert.equal(out.inspect.catalog_density, "absent");
  assert.ok(Number.isFinite(out.inspect.ranked_sample[0].source_influence));
  assert.ok(out.inspect.selected.calibration);
});
