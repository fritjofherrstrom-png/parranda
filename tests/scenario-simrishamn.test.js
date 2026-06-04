/**
 * Scenario: Simrishamn / Österlen — the small-town agnostic stress test.
 *
 * Part A: a pure coordinate request with no citypack at all → must be honest
 *   (absent catalog, source-backed confidence) and fail closed without a loader.
 * Part B: a deterministic THIN pilot citypack fixture that intentionally
 *   includes a coordless curated entry and a far-coordinate twin, to exercise
 *   #239 reconciliation + conflict exposure in a realistic small-place setting.
 *
 * This is Parranda's long-term goal: useful + honest from big cities down to
 * small towns, never pretending thin curation is a rich citypack.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildCandidateBlitzDecision } = require("../server/candidates/blitz-candidate-mode");
const { osmRecord, DATE, postBlitz, withScenarioServer } = require("./scenario-helpers");

const SIMRISHAMN = { lat: 55.5577, lng: 14.3517 };
const Q = "candidate_mode=1&include_external_candidates=1";

// --- Part A: pure agnostic coordinate (no curation at all) ------------------

test("Österlen coordinate with a tiny open-data slice → honest source-backed move", async () => {
  const records = [osmRecord("o-stenshuvud", "Stenshuvud Viewpoint", "viewpoint", 55.65, 14.27, { tags: ["utsikt"], wikidata: "Q40" })];
  await withScenarioServer(records, async (server) => {
    const res = await postBlitz(server, Q, { ...SIMRISHAMN, preferences: ["scenic"] });
    assert.equal(res.body.agnostic_context.used, true);
    assert.equal(res.body.context.catalog_density, "absent");
    assert.equal(res.body.best_move.origin, "external_open");
    assert.equal(res.body.confidence.label, "source_backed");
    assert.notEqual(res.body.confidence.level, "high"); // never citypack confidence
  });
});

test("Österlen coordinate with NO loader fails closed (honest, not a guess)", async () => {
  await withScenarioServer(null, async (server) => {
    const res = await postBlitz(server, Q, { ...SIMRISHAMN, preferences: ["scenic"] });
    assert.equal(res.body.best_move, null);
    assert.equal(res.body.reason, "no_candidates");
    assert.equal(res.body.confidence.level, null);
  });
});

test("Österlen coordinate where open data has nothing for the intent → honest fallback", async () => {
  // only a beach in the slice, but the user wants a museum → no fake museum
  const records = [osmRecord("o-beach", "Sandhammaren", "beach", 55.39, 14.2, { tags: ["coast"], wikidata: "Q41" })];
  await withScenarioServer(records, async (server) => {
    const res = await postBlitz(server, Q, { ...SIMRISHAMN, preferences: ["museums"] });
    // a real eligible place exists, but it does not cover the intent → fallback
    assert.equal(res.body.best_move.match_tier, "fallback");
    assert.ok(res.body.best_move.missing_preferences.includes("museums"));
  });
});

// --- Part B: thin Österlen pilot citypack (reconciliation + conflict) -------

// A deterministic, intentionally-thin pilot pack. One curated entry lacks
// coordinates (known only by a Wikidata id); one has coordinates that an
// external twin will disagree with by a few hundred metres.
function osterlenPilotCity() {
  return {
    key: "osterlen-pilot",
    label: "Österlen (pilot)",
    timezone: "Europe/Stockholm",
    center: { lat: 55.5577, lng: 14.3517 },
    catalog: {
      allItems: [
        { id: "kivik-mill", name: "Kiviks Kvarn", kind: "viewpoint", known_place_id: "Q1001", tags: ["utsikt"] }, // NO coords
        { id: "simris-harbor", name: "Simrishamns Hamn", kind: "viewpoint", lat: 55.5577, lng: 14.3517, known_place_id: "Q1002", tags: ["utsikt"] },
        { id: "osterlen-bageri", name: "Olof Viktors", kind: "cafe", lat: 55.56, lng: 14.35, tags: ["mat"] },
        { id: "kivik-bar", name: "Kiviks Hamnkrog", kind: "bar", lat: 55.683, lng: 14.227, tags: ["nattliv"] },
      ],
      routeTemplates: [],
    },
    routing: { areaDefinitions: {} },
    todayIsoDate: () => DATE,
  };
}

function decidePilot(preferences, dataset, over = {}) {
  return buildCandidateBlitzDecision(
    osterlenPilotCity(),
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences, ...over },
    dataset ? { external_provider: { dataset } } : {},
  );
}

test("the pilot pack is honestly THIN, not rich", () => {
  const out = decidePilot(["scenic"], null);
  assert.equal(out.context.catalog_density, "thin");
  assert.equal(out.confidence.level, "medium"); // curated but thin
});

test("a coordless curated entry gets coordinates filled from its wikidata twin (#239)", () => {
  // external twin of Kiviks Kvarn carries the same Wikidata id + real coords
  const dataset = [osmRecord("o-mill", "Kiviks Kvarn", "viewpoint", 55.7, 14.21, { tags: ["utsikt"], wikidata: "Q1001" })];
  const out = decidePilot(["scenic"], dataset);
  assert.equal(out.inspect.entity_resolution.merged_count, 1);
  assert.equal(out.inspect.entity_resolution.reconciled_count, 1);
  const mill = out.inspect.ranked_sample.find((r) => r.id === "kivik-mill");
  assert.ok(mill, "coordless curated should now be eligible/ranked");
  if (out.best_move.candidate_id === "kivik-mill") {
    assert.equal(out.best_move.lat, 55.7); // filled from the twin
    assert.deepEqual(out.best_move.provenance.reconciliation.filled, ["coordinates"]);
  }
});

test("a far-coordinate twin is NOT silently overwritten — conflict is inspectable", () => {
  // external twin of Simrishamns Hamn shares the wikidata id but sits ~300m off
  // (inside the wikidata sanity bound, beyond the 100m conflict threshold).
  const dataset = [osmRecord("o-harbor", "Simrishamns Hamn", "viewpoint", 55.5604, 14.3517, { tags: ["utsikt"], wikidata: "Q1002" })];
  const out = decidePilot(["scenic"], dataset);
  assert.equal(out.inspect.entity_resolution.conflict_count, 1);
  const merge = out.inspect.entity_resolution.merges.find((m) => m.into_id === "simris-harbor");
  assert.ok(merge);
  assert.equal(merge.conflicts.length, 1);
  assert.equal(merge.conflicts[0].field, "coordinates");
  assert.equal(merge.conflicts[0].kept, "curated");
  assert.ok(merge.conflicts[0].distance_m >= 200);
  // curated coords retained (not overwritten)
  const harbor = out.inspect.ranked_sample.find((r) => r.id === "simris-harbor");
  if (harbor && out.best_move.candidate_id === "simris-harbor") {
    assert.equal(out.best_move.lat, 55.5577);
  }
});

test("the pilot pack still serves everyday intents from curation (food)", () => {
  const out = decidePilot(["food"], null);
  assert.ok(out.best_move);
  assert.equal(out.best_move.origin, "curated_catalog");
  assert.ok(out.best_move.covered_preferences.includes("food"));
});
