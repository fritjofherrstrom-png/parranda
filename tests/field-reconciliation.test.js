const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveCandidateIdentity,
  reconcileFields,
} = require("../server/candidates/entity-resolution");

const NOW = "2026-06-03";

function curated(over = {}) {
  return { id: "cur-1", label: "Teatro Marcello", type: "viewpoint", city_pack_owned: true, ...over };
}

// external twin matched by a shared Wikidata id (so a coords-less curated can match)
function externalTwin(over = {}) {
  return {
    id: "osm-1",
    label: "Teatro Marcello",
    type: "viewpoint",
    city_pack_owned: false,
    candidate_origin: "external_open",
    source_family: "map",
    evidence: [
      { claim_type: "existence", value: true, source_ref: { provider_id: "osm", source_family: "map", url: "https://www.openstreetmap.org/node/1" } },
      { claim_type: "existence", value: true, source_ref: { provider_id: "wikidata", source_family: "open_knowledge", url: "https://www.wikidata.org/wiki/Q1" } },
    ],
    ...over,
  };
}

// --- reconcileFields (pure) ------------------------------------------------
test("missing curated coordinates are filled from the external twin", () => {
  const { patch, reconciliation } = reconcileFields(curated(), externalTwin({ lat: 41.892, lng: 12.479 }));
  assert.equal(patch.lat, 41.892);
  assert.equal(patch.lng, 12.479);
  assert.deepEqual(reconciliation.filled, ["coordinates"]);
  assert.deepEqual(reconciliation.conflicts, []);
});

test("close curated coordinates are preserved (no patch, no conflict)", () => {
  const { patch, reconciliation } = reconcileFields(
    curated({ lat: 41.8896, lng: 12.4583 }),
    externalTwin({ lat: 41.88965, lng: 12.4583 }),
  );
  assert.deepEqual(patch, {});
  assert.deepEqual(reconciliation.filled, []);
  assert.deepEqual(reconciliation.conflicts, []);
});

test("far curated coordinates are NOT overwritten and surface a conflict", () => {
  const { patch, reconciliation } = reconcileFields(
    curated({ lat: 41.8986, lng: 12.4769 }),
    externalTwin({ lat: 41.9013, lng: 12.4769 }), // ~300m
  );
  assert.deepEqual(patch, {}); // curated kept
  assert.equal(reconciliation.conflicts.length, 1);
  assert.equal(reconciliation.conflicts[0].field, "coordinates");
  assert.equal(reconciliation.conflicts[0].kept, "curated");
  assert.ok(reconciliation.conflicts[0].distance_m >= 250);
});

// --- through resolveCandidateIdentity --------------------------------------
test("merge fills missing curated coordinates and records reconciliation", () => {
  const result = resolveCandidateIdentity(
    [curated({ known_place_id: "Q1" }), externalTwin({ lat: 41.892, lng: 12.479 })],
    { now: NOW },
  );
  assert.equal(result.summary.merged_count, 1);
  assert.equal(result.summary.reconciled_count, 1);
  const canonical = result.candidates[0];
  assert.equal(canonical.id, "cur-1"); // curated stays canonical
  assert.equal(canonical.lat, 41.892); // coords now available downstream
  assert.equal(canonical.lng, 12.479);
  assert.deepEqual(canonical.reconciliation.filled, ["coordinates"]);
  // merge record is inspectable
  assert.deepEqual(result.merges[0].reconciled_fields, ["coordinates"]);
});

test("a far coordinate conflict keeps curated coords and is inspectable", () => {
  const result = resolveCandidateIdentity(
    [curated({ type: "museum", lat: 41.8986, lng: 12.4769, known_place_id: "Q99" }), externalTwin({ type: "museum", lat: 41.9013, lng: 12.4769, evidence: [{ claim_type: "existence", value: true, source_ref: { provider_id: "wikidata", source_family: "open_knowledge", url: "https://www.wikidata.org/wiki/Q99" } }] })],
    { now: NOW },
  );
  assert.equal(result.summary.merged_count, 1);
  assert.equal(result.summary.conflict_count, 1);
  const canonical = result.candidates[0];
  assert.equal(canonical.lat, 41.8986); // curated kept
  assert.equal(canonical.reconciliation.conflicts[0].field, "coordinates");
  assert.equal(result.merges[0].conflicts.length, 1);
});

test("curated label and type are always preserved across reconciliation", () => {
  const result = resolveCandidateIdentity(
    [curated({ label: "Teatro di Marcello", lat: undefined, known_place_id: "Q1" }), externalTwin({ label: "Theatre of Marcellus", type: "landmark", lat: 41.892, lng: 12.479 })],
    { now: NOW },
  );
  const canonical = result.candidates[0];
  assert.equal(canonical.label, "Teatro di Marcello"); // curated label kept
  assert.equal(canonical.type, "viewpoint"); // curated type kept
  assert.equal(canonical.lat, 41.892); // only coords filled
});

test("non-merged external candidates are not reconciled", () => {
  const newExternal = externalTwin({ id: "osm-new", label: "Lido di Ostia", type: "beach", lat: 41.73, lng: 12.27, evidence: [{ claim_type: "existence", value: true, source_ref: { provider_id: "osm", source_family: "map" } }] });
  const result = resolveCandidateIdentity([curated({ lat: 41.8896, lng: 12.4583 }), newExternal], { now: NOW });
  assert.equal(result.summary.merged_count, 0);
  assert.ok(result.candidates.every((c) => c.reconciliation === undefined));
});

test("reconciliation does not mutate inputs", () => {
  const cur = curated({ known_place_id: "Q1" });
  const ext = externalTwin({ lat: 41.892, lng: 12.479 });
  resolveCandidateIdentity([cur, ext], { now: NOW });
  assert.equal(cur.lat, undefined);
  assert.equal(cur.reconciliation, undefined);
  assert.equal(ext.lat, 41.892); // untouched
});

test("#238 dedupe behaviour is intact (curated absorbs external, external suppressed)", () => {
  const result = resolveCandidateIdentity(
    [curated({ lat: 41.8896, lng: 12.4583 }), externalTwin({ lat: 41.88965, lng: 12.4583 })],
    { now: NOW },
  );
  assert.equal(result.summary.output_count, 1);
  assert.ok(!result.candidates.some((c) => c.id === "osm-1"));
  assert.ok(result.candidates[0].merged_from.some((m) => m.id === "osm-1"));
});
