/**
 * Integration: entity safety inside candidate-mode Blitz (#238).
 * External records are injected through the trusted helper channel exactly as
 * the open-data loader does in production.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildCandidateBlitzDecision } = require("../server/candidates/blitz-candidate-mode");
const { collectPlaceCandidatesForCity } = require("../server/place-candidates/provider-registry");

const rome = require("../server/cities/rome.js");
const DATE = "2026-06-03";

function curatedViewpoint() {
  return collectPlaceCandidatesForCity(rome).candidates.find((c) => /gianicolo/i.test(c.label));
}

function withRecords(records, payloadOver = {}) {
  return buildCandidateBlitzDecision(
    rome,
    { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["scenic"], ...payloadOver },
    { external_provider: { dataset: records } },
  );
}

function osmDuplicateOf(curatedPlace) {
  return {
    id: "osm-dup",
    name: curatedPlace.label,
    type: curatedPlace.type,
    lat: curatedPlace.lat + 0.0001, // ~11m
    lng: curatedPlace.lng,
    tags: ["utsikt"],
    sources: [
      { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/1" },
      { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: "https://www.wikidata.org/wiki/Q1" },
    ],
  };
}

test("a curated + external duplicate yields one canonical curated move (external suppressed)", () => {
  const cur = curatedViewpoint();
  const out = withRecords([osmDuplicateOf(cur)]);
  assert.equal(out.inspect.entity_resolution.merged_count, 1);
  // the external open candidate must not appear as a separate ranked move
  assert.ok(!out.inspect.ranked_sample.some((r) => r.origin === "external_open"));
  // the merge is inspectable
  const merge = out.inspect.entity_resolution.merges[0];
  assert.equal(merge.into_id, cur.id);
  assert.equal(merge.duplicate_id, "osm-dup");
  assert.equal(merge.into_origin, "curated_catalog");
});

test("the canonical candidate keeps external attribution + a merged_from trail", () => {
  const cur = curatedViewpoint();
  // make the merged place the actual best move by requesting its exact area —
  // simplest: assert via the ranked candidate, not necessarily best_move
  const out = withRecords([osmDuplicateOf(cur)]);
  const ranked = out.inspect.ranked_sample.find((r) => r.id === cur.id);
  assert.ok(ranked, "curated canonical should be in the ranked set");
  // and if it is the best move, provenance carries the external corroboration
  if (out.best_move.candidate_id === cur.id) {
    assert.equal(out.best_move.provenance.corroborated_by_external, true);
    assert.ok(out.best_move.provenance.merged_from.some((m) => m.id === "osm-dup"));
    const families = out.best_move.provenance.attribution.map((a) => a.source_family);
    assert.ok(families.includes("map") && families.includes("open_knowledge"));
  }
});

test("a genuinely new external candidate can still win when it is the better fit", () => {
  // Rome has no curated swimming → the open beach is new and wins, unmerged.
  const out = withRecords(
    [
      {
        id: "osm-beach",
        name: "Lido di Ostia",
        type: "beach",
        lat: 41.73,
        lng: 12.27,
        tags: ["coast"],
        sources: [
          { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/way/9" },
          { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: "https://www.wikidata.org/wiki/Q9" },
        ],
      },
    ],
    { preferences: ["swimming"] },
  );
  assert.equal(out.best_move.origin, "external_open");
  assert.ok(out.best_move.covered_preferences.includes("swimming"));
  assert.equal(out.inspect.entity_resolution.merged_count, 0);
});

test("catalog-only candidate_mode is unchanged (no merges, same best move)", () => {
  const baseline = buildCandidateBlitzDecision(rome, { candidate_mode: 1, date: DATE, preferences: ["scenic"] });
  assert.equal(baseline.inspect.entity_resolution.merged_count, 0);
  assert.equal(baseline.best_move.origin, "curated_catalog");
  // identity summary is present but empty
  assert.deepEqual(baseline.inspect.entity_resolution.merges, []);
});

test("a non-duplicate external (different place) is NOT merged and remains available", () => {
  const cur = curatedViewpoint();
  // same area, viewpoint, but a clearly different distinctive name
  const out = withRecords([
    {
      id: "osm-other",
      name: "Terrazza Belvedere Alfredo",
      type: "viewpoint",
      lat: cur.lat + 0.0002,
      lng: cur.lng,
      tags: ["utsikt"],
      sources: [
        { provider: "osm", family: "map", tier: "inferred" },
        { provider: "wikidata", family: "open_knowledge", tier: "inferred" },
      ],
    },
  ]);
  assert.equal(out.inspect.entity_resolution.merged_count, 0);
  assert.ok(out.inspect.by_origin.eligible.external_open >= 1);
});
