/**
 * Endpoint tests for open-data augmentation of THIN recognized cities (#241).
 *
 * Athens (a real, thin citypack) can now pull trusted open-data records through
 * /api/blitz; rich citypacks (Rome) must not. External records are injected via
 * buildApp({ openDataLoader }) — no live network.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { collectPlaceCandidatesForCity } = require("../server/place-candidates/provider-registry");
const { osmRecord, DATE, postBlitz, withScenarioServer } = require("./scenario-helpers");

const athens = require("../server/cities/athens/index.js");
const Q = "candidate_mode=1&include_external_candidates=1";

function curatedAthensViewpoint() {
  return collectPlaceCandidatesForCity(athens).candidates.find((c) => c.type === "viewpoint");
}

// --- 1. Athens recognized city via HTTP augments, honestly -----------------

test("Athens recognized city augments from open data but stays honestly thin", async () => {
  const records = [osmRecord("a-beach", "Kavouri Beach", "beach", 37.82, 23.78, { tags: ["coast"], wikidata: "Q2" })];
  await withScenarioServer(records, async (server) => {
    const res = await postBlitz(server, Q, { city: "athens", date: DATE, preferences: ["scenic"] });
    assert.equal(res.body.city, "athens");
    assert.equal(res.body.agnostic_context.used, false); // recognized city, not agnostic
    assert.equal(res.body.open_data_augmentation.used, true);
    assert.equal(res.body.open_data_augmentation.reason, "thin_recognized_city");
    assert.equal(res.body.open_data_augmentation.open_data_loader, "loaded:1");
    assert.equal(res.body.context.catalog_density, "thin"); // never claims rich
    assert.notEqual(res.body.confidence.level, "high"); // honest
  });
});

test("Athens augmentation does not fire without include_external_candidates", async () => {
  const records = [osmRecord("a-beach", "Kavouri Beach", "beach", 37.82, 23.78, { tags: ["coast"], wikidata: "Q2" })];
  await withScenarioServer(records, async (server) => {
    const res = await postBlitz(server, "candidate_mode=1", { city: "athens", date: DATE, preferences: ["scenic"] });
    assert.equal(res.body.open_data_augmentation.used, false);
    assert.equal(res.body.open_data_augmentation.reason, "not_applicable");
    assert.equal(res.body.best_move.origin, "curated_catalog");
  });
});

// --- 2. Athens external gap-fill -------------------------------------------

test("an injected coast record wins swimming (a gap the Athens catalog lacks)", async () => {
  const records = [osmRecord("a-beach", "Kavouri Beach", "beach", 37.82, 23.78, { tags: ["coast"], wikidata: "Q2" })];
  await withScenarioServer(records, async (server) => {
    const res = await postBlitz(server, Q, { city: "athens", date: DATE, preferences: ["swimming"] });
    assert.equal(res.body.best_move.origin, "external_open");
    assert.ok(res.body.best_move.covered_preferences.includes("swimming"));
    // provenance shows external source families, honest confidence
    const fams = res.body.best_move.provenance.attribution.map((a) => a.source_family);
    assert.ok(fams.includes("map") && fams.includes("open_knowledge"));
    assert.equal(res.body.best_move.provenance.human_verified, false);
    assert.equal(res.body.confidence.label, "source_backed");
    assert.notEqual(res.body.confidence.level, "high");
  });
});

// --- 3. Athens duplicate / dedupe ------------------------------------------

test("an external duplicate of a curated Athens place merges, not competes", async () => {
  const vp = curatedAthensViewpoint();
  const records = [osmRecord("a-dup", vp.label, "viewpoint", vp.lat + 0.0001, vp.lng, { tags: ["utsikt"], wikidata: "Q3" })];
  await withScenarioServer(records, async (server) => {
    const res = await postBlitz(server, Q, { city: "athens", date: DATE, preferences: ["scenic"] });
    assert.equal(res.body.inspect.entity_resolution.merged_count, 1);
    assert.equal(res.body.best_move.origin, "curated_catalog"); // curated stays canonical
    assert.ok(!res.body.inspect.ranked_sample.some((r) => r.origin === "external_open"));
    if (res.body.best_move.candidate_id === vp.id) {
      assert.equal(res.body.best_move.provenance.corroborated_by_external, true);
    }
  });
});

test("a weak single-family external record does not overpower curated Athens", async () => {
  const records = [osmRecord("a-weak", "Random Lookout", "viewpoint", 37.98, 23.74, { tags: ["utsikt"], wikidata: null })];
  await withScenarioServer(records, async (server) => {
    const res = await postBlitz(server, Q, { city: "athens", date: DATE, preferences: ["scenic"] });
    assert.equal(res.body.best_move.origin, "curated_catalog");
  });
});

// --- 4. Rich citypack guard -------------------------------------------------

test("a rich citypack (Rome) is NOT auto-augmented by open data", async () => {
  const records = [osmRecord("r-beach", "Ostia Beach", "beach", 41.73, 12.27, { tags: ["coast"], wikidata: "Q9" })];
  await withScenarioServer(records, async (server) => {
    const res = await postBlitz(server, Q, { city: "rome", date: DATE, preferences: ["swimming"] });
    assert.equal(res.body.open_data_augmentation.used, false);
    assert.equal(res.body.open_data_augmentation.reason, "not_thin:rich");
    assert.equal(res.body.context.catalog_density, "rich");
    // no external record reaches the ranking
    assert.ok(!(res.body.inspect.by_origin.eligible || {}).external_open);
  });
});

test("rich-citypack scenic stays curated-first even with a loader configured", async () => {
  const vp = curatedAthensViewpoint();
  const records = [osmRecord("r-view", "Open Viewpoint", "viewpoint", 41.9, 12.46, { tags: ["utsikt"], wikidata: "Q8" })];
  await withScenarioServer(records, async (server) => {
    const res = await postBlitz(server, Q, { city: "barcelona", date: DATE, preferences: ["scenic"] });
    assert.equal(res.body.open_data_augmentation.used, false);
    assert.equal(res.body.best_move.origin, "curated_catalog");
  });
});

// --- 5. Existing agnostic + fail-closed behavior ---------------------------

test("coordinate-only agnostic path still works (Malmö)", async () => {
  const records = [osmRecord("m-rest", "Bastard Restaurang", "restaurant", 55.6049, 13.004, { tags: ["mat"], wikidata: "Q31" })];
  await withScenarioServer(records, async (server) => {
    const res = await postBlitz(server, Q, { lat: 55.605, lng: 13.0038, date: DATE, preferences: ["food"] });
    assert.equal(res.body.agnostic_context.used, true);
    assert.equal(res.body.open_data_augmentation.used, false);
    assert.equal(res.body.best_move.origin, "external_open");
  });
});

test("Athens augmentation with NO loader fails closed honestly (curated only)", async () => {
  await withScenarioServer(null, async (server) => {
    const res = await postBlitz(server, Q, { city: "athens", date: DATE, preferences: ["scenic"] });
    assert.equal(res.body.open_data_augmentation.used, true);
    assert.equal(res.body.open_data_augmentation.open_data_loader, "no_loader_configured");
    // no external records → falls back to the curated catalog, honestly
    assert.equal(res.body.best_move.origin, "curated_catalog");
  });
});

test("Athens augmentation with a loader that errors fails closed (curated only)", async () => {
  const { buildApp } = require("../server/app");
  const server = buildApp({ openDataLoader: async () => { throw new Error("overpass down"); } }).listen(0);
  try {
    const res = await postBlitz(server, Q, { city: "athens", date: DATE, preferences: ["scenic"] });
    assert.equal(res.body.open_data_augmentation.open_data_loader, "error_failed_closed");
    assert.equal(res.body.best_move.origin, "curated_catalog");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
