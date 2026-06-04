/**
 * Integration: field reconciliation inside candidate-mode Blitz (#239).
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildCandidateBlitzDecision } = require("../server/candidates/blitz-candidate-mode");
const { buildAgnosticCityContext } = require("../server/candidates/agnostic-context");

const DATE = "2026-06-03";

// A minimal city carrying ONE curated place that is missing coordinates but
// known by a Wikidata id — the exact gap reconciliation is meant to close.
function cityWithCoordlessCurated() {
  return {
    key: "reconcile-city",
    label: "Reconcile City",
    timezone: "UTC",
    center: { lat: 41.9, lng: 12.49 },
    catalog: {
      allItems: [
        {
          id: "teatro-marcello",
          name: "Teatro di Marcello",
          kind: "viewpoint",
          // NOTE: no lat/lng — curated entry lacks coordinates
          known_place_id: "Q1",
          tags: ["utsikt"],
          time_fit: ["golden-hour"],
        },
      ],
      routeTemplates: [],
    },
    routing: { areaDefinitions: {} },
    todayIsoDate: () => DATE,
  };
}

function externalTwinRecords() {
  return [
    {
      id: "osm-teatro",
      name: "Teatro Marcello",
      type: "viewpoint",
      lat: 41.8919,
      lng: 12.4797,
      tags: ["utsikt"],
      sources: [
        { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/1" },
        { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: "https://www.wikidata.org/wiki/Q1" },
      ],
    },
  ];
}

test("a curated place missing coords gets reconciled coords available downstream", () => {
  const out = buildCandidateBlitzDecision(
    cityWithCoordlessCurated(),
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["scenic"] },
    { external_provider: { dataset: externalTwinRecords() } },
  );
  // one canonical move, curated stays canonical
  assert.equal(out.inspect.entity_resolution.merged_count, 1);
  assert.equal(out.inspect.entity_resolution.reconciled_count, 1);
  assert.equal(out.best_move.origin, "curated_catalog");
  assert.equal(out.best_move.candidate_id, "teatro-marcello");
  // coords were filled from the external twin → present on the move
  assert.equal(out.best_move.lat, 41.8919);
  assert.equal(out.best_move.lng, 12.4797);
  // and the reconciliation is inspectable on provenance
  assert.deepEqual(out.best_move.provenance.reconciliation.filled, ["coordinates"]);
  assert.equal(out.best_move.provenance.corroborated_by_external, true);
});

test("a brand-new external (no curated twin) is unaffected by reconciliation", () => {
  const agnostic = buildAgnosticCityContext({ lat: 41.9, lng: 12.5, todayIsoDate: () => DATE });
  const out = buildCandidateBlitzDecision(
    agnostic,
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["swimming"] },
    {
      external_provider: {
        dataset: [
          { id: "osm-beach", name: "Open Beach", type: "beach", lat: 41.9, lng: 12.5, tags: ["coast"], sources: [{ provider: "osm", family: "map", tier: "inferred" }, { provider: "wikidata", family: "open_knowledge", tier: "inferred" }] },
        ],
      },
    },
  );
  assert.equal(out.inspect.entity_resolution.merged_count, 0);
  assert.equal(out.inspect.entity_resolution.reconciled_count, 0);
  assert.equal(out.best_move.origin, "external_open");
  assert.equal(out.best_move.provenance.reconciliation, null);
});

test("catalog-only candidate_mode reports no reconciliation", () => {
  const out = buildCandidateBlitzDecision(cityWithCoordlessCurated(), {
    candidate_mode: 1,
    date: DATE,
    preferences: ["scenic"],
  });
  // no external → no merges, no reconciliation
  assert.equal(out.inspect.entity_resolution.merged_count, 0);
  assert.equal(out.inspect.entity_resolution.reconciled_count, 0);
});
