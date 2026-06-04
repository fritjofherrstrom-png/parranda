/**
 * Scenario: Malmö — a real urban city with NO citypack. Tests whether Parranda
 * can work from coordinates + open data alone, across everyday intents, without
 * any hand-built tourist assumptions — and stays honest that it is uncurated.
 *
 * Exercises the full HTTP coordinate-intake path (#236) + open-data loader
 * (#237) via buildApp({ openDataLoader }).
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { osmRecord, DATE, postBlitz, withScenarioServer } = require("./scenario-helpers");

const MALMO = { lat: 55.6050, lng: 13.0038 };

// A small, deterministic open-data slice of central Malmö across intents.
function malmoRecords() {
  return [
    osmRecord("m-rest", "Bastard Restaurang", "restaurant", 55.6049, 13.004, { tags: ["mat"], wikidata: "Q31" }),
    osmRecord("m-cafe", "Lilla Kafferosteriet", "cafe", 55.6052, 13.0035, { tags: [], wikidata: "Q32" }),
    osmRecord("m-bar", "Far i Hatten", "bar", 55.5995, 13.0125, { tags: ["nattliv"], wikidata: "Q33" }),
    osmRecord("m-vintage", "Lager 157 Vintage", "vintage-shop", 55.6041, 13.0006, { tags: ["second_hand", "vintage"], wikidata: "Q34" }),
    osmRecord("m-view", "Turning Torso Viewpoint", "viewpoint", 55.6132, 12.9762, { tags: ["utsikt"], wikidata: "Q35" }),
    osmRecord("m-beach", "Ribersborg Beach", "beach", 55.6005, 12.9755, { tags: ["coast"], wikidata: "Q36" }),
  ];
}

const Q = "candidate_mode=1&include_external_candidates=1";

test("Malmö coordinate-only is honestly agnostic (absent catalog, source-backed confidence)", async () => {
  await withScenarioServer(malmoRecords(), async (server) => {
    const res = await postBlitz(server, Q, { ...MALMO, preferences: ["food"] });
    assert.equal(res.body.agnostic_context.used, true);
    assert.equal(res.body.agnostic_context.reason, "no_city_requested");
    assert.equal(res.body.agnostic_context.open_data_loader, "loaded:6");
    assert.equal(res.body.context.catalog_density, "absent");
    assert.equal(res.body.confidence.label, "source_backed");
    assert.notEqual(res.body.confidence.level, "high");
  });
});

test("Malmö food prefers the strong restaurant over a weak café match", async () => {
  await withScenarioServer(malmoRecords(), async (server) => {
    const res = await postBlitz(server, Q, { ...MALMO, preferences: ["food"] });
    assert.equal(res.body.best_move.candidate_id, "m-rest");
    assert.ok(res.body.best_move.covered_preferences.includes("food"));
    assert.equal(res.body.best_move.origin, "external_open");
  });
});

test("Malmö covers bar, scenic, swimming and vintage from open data", async () => {
  await withScenarioServer(malmoRecords(), async (server) => {
    const bar = await postBlitz(server, `${Q}`, { ...MALMO, preferences: ["bars"], now: `${DATE}T21:00:00` });
    assert.equal(bar.body.best_move.candidate_id, "m-bar");

    const scenic = await postBlitz(server, Q, { ...MALMO, preferences: ["scenic"] });
    assert.equal(scenic.body.best_move.candidate_id, "m-view");

    const swim = await postBlitz(server, Q, { ...MALMO, preferences: ["swimming"] });
    assert.equal(swim.body.best_move.candidate_id, "m-beach");

    const vintage = await postBlitz(server, Q, { ...MALMO, preferences: ["second_hand"] });
    assert.equal(vintage.body.best_move.candidate_id, "m-vintage");
    // second_hand is preserved, not collapsed into generic shopping
    assert.ok(vintage.body.best_move.covered_preferences.includes("second_hand"));
  });
});

test("Malmö best move carries open-data attribution (OSM + Wikidata)", async () => {
  await withScenarioServer(malmoRecords(), async (server) => {
    const res = await postBlitz(server, Q, { ...MALMO, preferences: ["scenic"] });
    const fams = res.body.best_move.provenance.attribution.map((a) => a.source_family);
    assert.ok(fams.includes("map") && fams.includes("open_knowledge"));
    assert.equal(res.body.best_move.provenance.human_verified, false);
    assert.ok(res.body.best_move.provenance.attribution.some((a) => /openstreetmap\.org/.test(a.url || "")));
  });
});

test("Malmö without a loader fails closed honestly (no hallucinated move)", async () => {
  await withScenarioServer(null, async (server) => {
    const res = await postBlitz(server, Q, { ...MALMO, preferences: ["food"] });
    assert.equal(res.body.agnostic_context.open_data_loader, "no_loader_configured");
    assert.equal(res.body.best_move, null);
    assert.equal(res.body.reason, "no_candidates");
    assert.equal(res.body.confidence.level, null);
  });
});

test("Malmö does not let a popularity-only open record win (no generic-map behavior)", async () => {
  const records = [
    osmRecord("m-hype", "Hyped Bar", "bar", 55.605, 13.004, { tags: ["nattliv"], wikidata: null, popularity: { count: 50000, rating: 4.9 } }),
  ];
  await withScenarioServer(records, async (server) => {
    const res = await postBlitz(server, Q, { ...MALMO, preferences: ["bars"] });
    // single-family + heavy consensus → gated out → honest no eligible move
    assert.equal(res.body.best_move, null);
  });
});
