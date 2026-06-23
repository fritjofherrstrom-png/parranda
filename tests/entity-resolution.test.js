const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveCandidateIdentity,
  matchIdentity,
  normalizeName,
  distinctiveTokens,
  nameSimilarity,
  wikidataIdOf,
} = require("../server/candidates/entity-resolution");

const NOW = "2026-06-03";

function curated(over = {}) {
  return {
    id: "cur-1",
    label: "Gianicolo Terrace",
    type: "viewpoint",
    lat: 41.8896,
    lng: 12.4583,
    city_pack_owned: true,
    ...over,
  };
}

function external(over = {}) {
  return {
    id: "osm-1",
    label: "Gianicolo Terrace",
    type: "viewpoint",
    lat: 41.8896,
    lng: 12.4583,
    city_pack_owned: false,
    candidate_origin: "external_open",
    provider_id: "open-data-osm-wikidata-v1",
    source_family: "map",
    evidence: [
      { claim_type: "existence", value: true, source_ref: { provider_id: "osm", source_family: "map", url: "https://www.openstreetmap.org/node/1" } },
      { claim_type: "existence", value: true, source_ref: { provider_id: "wikidata", source_family: "open_knowledge", url: "https://www.wikidata.org/wiki/Q42" } },
    ],
    ...over,
  };
}

// --- name signals ----------------------------------------------------------
test("normalizeName strips accents/punctuation/case", () => {
  assert.equal(normalizeName("Caffè  Sant'Eustachio!"), "caffe sant eustachio");
});

test("distinctiveTokens drops articles and category nouns", () => {
  assert.deepEqual([...distinctiveTokens("The Bar Giulia")], ["giulia"]);
  assert.equal(distinctiveTokens("The Cafe").size, 0); // fully generic
});

test("nameSimilarity handles category-word-on-one-side via distinctive tokens", () => {
  assert.ok(nameSimilarity("Bar Giulia", "Giulia") >= 0.6);
  assert.ok(nameSimilarity("Bar Roma", "Bar Milano") < 0.6);
});

test("non-Latin names (Greek AND Cyrillic) produce tokens and merge — consensus is script-agnostic, not Athens-only", () => {
  // Pre-fix, the ASCII-only normalizer stripped any non-Latin name to "" → zero
  // tokens → it could never merge on geo+name, so cross-source consensus was
  // impossible for non-Latin cities generally (Athens was just where we hit it).
  // Two independent scripts prove the fix is generic.
  assert.equal(normalizeName("Επιγραφικό Μουσείο"), "επιγραφικο μουσειο"); // Greek
  assert.ok(distinctiveTokens("Επιγραφικό Μουσείο").size >= 1);
  assert.ok(distinctiveTokens("Третьяковская галерея").size >= 1); // Cyrillic (Moscow)

  // Greek: a place OSM + Wikidata both know merges into one (two families).
  const gA = external({ id: "osm-gr", label: "Επιγραφικό Μουσείο", type: "museum", lat: 37.9890, lng: 23.7330, evidence: [{ claim_type: "existence", value: true, source_ref: { provider_id: "osm", source_family: "map" } }] });
  const gB = external({ id: "wikidata-Q1768487", label: "Επιγραφικό Μουσείο", type: "museum", lat: 37.98902, lng: 23.73301, evidence: [{ claim_type: "existence", value: true, source_ref: { provider_id: "wikidata", source_family: "open_knowledge" } }] });
  assert.equal(matchIdentity(gA, gB).same, true, "two Greek-named open-source records at the same spot merge");

  // Cyrillic: same generic capability, a different city/script (Moscow gallery).
  const cA = external({ id: "osm-ru", label: "Третьяковская галерея", type: "gallery", lat: 55.7415, lng: 37.6208, evidence: [{ claim_type: "existence", value: true, source_ref: { provider_id: "osm", source_family: "map" } }] });
  const cB = external({ id: "wikidata-Q2616", label: "Третьяковская галерея", type: "gallery", lat: 55.74152, lng: 37.62081, evidence: [{ claim_type: "existence", value: true, source_ref: { provider_id: "wikidata", source_family: "open_knowledge" } }] });
  assert.equal(matchIdentity(cA, cB).same, true, "two Cyrillic-named open-source records at the same spot merge");
});

test("Latin-name merging is unchanged by the Unicode fix (no regression)", () => {
  // ASCII normalization is byte-identical to before (a-z0-9 ⊂ \p{L}\p{N}), so
  // existing Latin/curated merges behave exactly as they did.
  assert.equal(normalizeName("Caffè  Sant'Eustachio!"), "caffe sant eustachio");
  const a = external({ id: "osm-lat", label: "Gianicolo Terrace", type: "viewpoint", lat: 41.8896, lng: 12.4583, evidence: [{ claim_type: "existence", value: true, source_ref: { provider_id: "osm", source_family: "map" } }] });
  assert.equal(matchIdentity(curated(), a).same, true, "curated ↔ external Latin merge still fires");
});

test("wikidataIdOf reads id from evidence source urls or known fields", () => {
  assert.equal(wikidataIdOf(external()), "Q42");
  assert.equal(wikidataIdOf(curated({ known_place_id: "Q99" })), "Q99");
  assert.equal(wikidataIdOf(curated()), null);
});

// --- matchIdentity ---------------------------------------------------------
test("close + same distinctive name + compatible category → same place", () => {
  const v = matchIdentity(curated(), external({ lat: 41.88965 }));
  assert.equal(v.same, true);
  assert.equal(v.confidence, "geo_name");
});

test("shared wikidata id is a hard match even at a few hundred metres", () => {
  const a = curated({ known_place_id: "Q42" });
  const b = external({ lat: 41.8916 }); // ~220m north, carries Q42 in evidence
  const v = matchIdentity(a, b);
  assert.equal(v.same, true);
  assert.equal(v.confidence, "hard_wikidata");
});

test("a shared wikidata id that is geographically far is rejected", () => {
  const a = curated({ known_place_id: "Q42" });
  const b = external({ lat: 42.5 }); // ~68 km away
  assert.equal(matchIdentity(a, b).same, false);
});

test("two curated candidates are never merged", () => {
  assert.equal(matchIdentity(curated(), curated({ id: "cur-2", city_pack_owned: true })).same, false);
});

test("category mismatch blocks a merge even when name + geo align", () => {
  const v = matchIdentity(curated({ type: "restaurant" }), external({ type: "viewpoint" }));
  assert.equal(v.same, false);
  assert.equal(v.reason, "category_mismatch");
});

test("same distinctive name but far apart stays separate", () => {
  assert.equal(matchIdentity(curated(), external({ lat: 41.95 })).same, false);
});

test("generic names (no distinctive token) never merge on geo+name alone", () => {
  const a = curated({ label: "The Cafe", type: "cafe" });
  const b = external({ label: "Cafe", type: "cafe", lat: 41.88962, evidence: [{ claim_type: "existence", value: true, source_ref: { provider_id: "osm", source_family: "map" } }] });
  assert.equal(matchIdentity(a, b).same, false); // even ~2m apart
});

test("missing coordinates on a side means we cannot confirm → separate", () => {
  assert.equal(matchIdentity(curated(), external({ lat: undefined, lng: undefined })).same, false);
});

// --- resolveCandidateIdentity ---------------------------------------------
test("a curated + external duplicate becomes one canonical curated candidate", () => {
  const result = resolveCandidateIdentity([curated(), external({ lat: 41.88965 })], { now: NOW });
  assert.equal(result.summary.output_count, 1);
  assert.equal(result.summary.merged_count, 1);
  const canonical = result.candidates[0];
  assert.equal(canonical.id, "cur-1"); // curated stays canonical
  assert.equal(canonical.city_pack_owned, true);
  // external evidence absorbed → attribution-bearing sources now present
  const families = canonical.evidence.map((e) => e.source_ref.source_family);
  assert.ok(families.includes("map"));
  assert.ok(families.includes("open_knowledge"));
  // merged_from trail preserved
  assert.equal(canonical.merged_from[0].id, "osm-1");
  assert.equal(canonical.merged_from[0].origin, "external_open");
  // the external duplicate is gone from the candidate set
  assert.ok(!result.candidates.some((c) => c.id === "osm-1"));
});

test("a genuinely new external candidate is kept (not merged)", () => {
  const newExternal = external({ id: "osm-new", label: "Lido di Ostia", type: "beach", lat: 41.73, lng: 12.27 });
  const result = resolveCandidateIdentity([curated(), newExternal], { now: NOW });
  assert.equal(result.summary.merged_count, 0);
  assert.equal(result.summary.output_count, 2);
  assert.ok(result.candidates.some((c) => c.id === "osm-new"));
});

test("an external matching MULTIPLE curated places stays separate (ambiguous)", () => {
  const a = curated({ id: "cur-a", label: "San Giovanni", lat: 41.8896, lng: 12.4583 });
  const b = curated({ id: "cur-b", label: "San Giovanni", lat: 41.88965, lng: 12.4583 });
  const ext = external({ id: "osm-amb", label: "San Giovanni", lat: 41.88962, lng: 12.4583 });
  const result = resolveCandidateIdentity([a, b, ext], { now: NOW });
  assert.equal(result.summary.merged_count, 0);
  assert.equal(result.summary.ambiguous_kept_separate, 1);
  assert.ok(result.candidates.some((c) => c.id === "osm-amb"));
});

test("external-vs-external duplicates dedupe into the richer record", () => {
  const single = external({ id: "osm-a", evidence: [{ claim_type: "existence", value: true, source_ref: { provider_id: "osm", source_family: "map" } }] });
  const rich = external({ id: "osm-b", lat: 41.88965 }); // 2 families
  const result = resolveCandidateIdentity([single, rich], { now: NOW });
  assert.equal(result.summary.merged_count, 1);
  assert.equal(result.summary.output_count, 1);
  assert.equal(result.candidates[0].id, "osm-b"); // richer one is canonical
});

test("no external candidates → identity resolution is a pure no-op", () => {
  const inputs = [curated(), curated({ id: "cur-2" })];
  const result = resolveCandidateIdentity(inputs, { now: NOW });
  assert.equal(result.summary.merged_count, 0);
  assert.equal(result.candidates.length, 2);
  // unchanged objects pass straight through (no evidence/merged_from added)
  assert.equal(result.candidates[0].evidence, undefined);
});

test("resolveCandidateIdentity does not mutate its inputs", () => {
  const cur = curated();
  const ext = external({ lat: 41.88965 });
  resolveCandidateIdentity([cur, ext], { now: NOW });
  assert.equal(cur.evidence, undefined);
  assert.equal(cur.merged_from, undefined);
});
