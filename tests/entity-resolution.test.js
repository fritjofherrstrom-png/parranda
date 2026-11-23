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

test("same-place merge preserves exact source identities and ages without counting duplicate observations twice", () => {
  const observation = (url, observed_at) => ({ claim_type: 'existence', value: true,
    source_ref: { provider_id: 'osm', source_family: 'map', source_tier: 'inferred', url },
    observed_at, freshness: 'fresh', weight: 1 });
  const older = external({ id: 'a', evidence: [observation('https://www.openstreetmap.org/node/1', '2024-01-01')] });
  const newer = external({ id: 'b', evidence: [observation('https://www.openstreetmap.org/way/2', '2026-06-03')] });
  const duplicate = external({ id: 'c', evidence: [observation('https://www.openstreetmap.org/way/2', '2026-06-03')] });
  for (const input of [[older, newer, duplicate], [newer, older, duplicate], [duplicate, newer, older]]) {
    const result = resolveCandidateIdentity(input, { now: NOW });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.summary.merged_count, 2);
    assert.equal(result.candidates[0].evidence.length, 2);
    assert.deepEqual(new Set(result.candidates[0].evidence.map(item => `${item.source_ref.url}|${item.observed_at}`)),
      new Set(['https://www.openstreetmap.org/node/1|2024-01-01', 'https://www.openstreetmap.org/way/2|2026-06-03']));
    const { reduceEvidence } = require('../server/candidates/evidence-reducer');
    assert.equal(reduceEvidence(result.candidates[0].evidence, { now: NOW }).provenance_diversity, 1);
  }
});

test("retained same-family observations cannot change canonical place identity with provider order", () => {
  const { createExternalOpenProvider } = require('../server/place-candidates/external-open-provider');
  const rows = [
    { id: 'a', type: 'viewpoint', lat: 55.6 },
    { id: 'b', type: 'viewpoint', lat: 55.6001 },
    { id: '0', type: 'park', lat: 55.6002 },
  ].map(row => ({ ...row, name: 'Cedar Grove', lng: 13,
    sources: [{ provider: 'osm', family: 'map', tier: 'inferred', url: `https://www.openstreetmap.org/node/${row.id}` }] }));
  for (const indices of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const candidates = createExternalOpenProvider({ key: 'canonical-order' }, {
      dataset: indices.map(i => rows[i]), observedAt: NOW,
    }).listCandidates();
    const result = resolveCandidateIdentity(candidates, { now: NOW });
    assert.equal(result.candidates.length, 1);
    const [canonical] = result.candidates;
    assert.deepEqual({ id: canonical.id, type: canonical.type, lat: canonical.lat, lng: canonical.lng },
      { id: '0', type: 'park', lat: 55.6002, lng: 13 }, indices.join(','));
    assert.equal(canonical.evidence.length, 9, 'all three source observations retain their three actual claims');
  }
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

test("a confirmed duplicate fills a missing venue website without overwriting the canonical link", () => {
  const site = "https://operator.example/visit";
  const result = resolveCandidateIdentity([curated(), external({ website: site })], { now: NOW });
  assert.equal(result.candidates[0].website, site);
  assert.ok(result.candidates[0].reconciliation.filled.includes("website"));
  const ownSite = "https://curated.example/visit";
  const retained = resolveCandidateIdentity([curated({ website: ownSite }), external({ website: site })], { now: NOW });
  assert.equal(retained.candidates[0].website, ownSite);
});

test("unsafe links and ambiguous duplicate identities cannot supply a venue website", () => {
  for (const website of ["javascript:alert(1)", "https://user:secret@operator.example/", "/visit", "https://operator.example/" + "x".repeat(2048)]) {
    const result = resolveCandidateIdentity([curated(), external({ website })], { now: NOW });
    assert.equal(result.candidates[0].website, undefined, website);
  }
  const result = resolveCandidateIdentity([
    curated({ id: "one" }), curated({ id: "two", lat: 41.88965 }),
    external({ website: "https://operator.example/" }),
  ], { now: NOW });
  assert.equal(result.summary.merged_count, 0);
  assert.ok(result.candidates.filter(row => row.city_pack_owned).every(row => row.website === undefined));
});

test("source metadata follows newly filled hours and cannot overwrite the canonical schedule source", () => {
  const externalSource = { url: "https://operator.example/", observed_at: "2026-10-17T10:00:00.000Z" };
  const duplicate = external({ opening_hours: "Mo-Su 09:00-17:00", opening_hours_source: externalSource });
  const filled = resolveCandidateIdentity([curated(), duplicate], { now: NOW }).candidates[0];
  assert.deepEqual(filled.opening_hours_source, externalSource);
  const originalSource = { url: "https://curated.example/", observed_at: "2026-10-17T09:00:00.000Z" };
  const retained = resolveCandidateIdentity([curated({ opening_hours: "Mo-Su 10:00-18:00", opening_hours_source: originalSource }), duplicate], { now: NOW }).candidates[0];
  assert.equal(retained.opening_hours, "Mo-Su 10:00-18:00");
  assert.deepEqual(retained.opening_hours_source, originalSource);
});

test("near-name branches do not borrow corroboration from a neighbouring place", () => {
  const a = external({ id: "map-place", label: "North Pier Gallery", type: "gallery", evidence: [] });
  const b = external({ id: "official-place", label: "North Pier Gallery Annex", type: "gallery", evidence: [] });
  assert.equal(matchIdentity(a, b).same, false);
  assert.equal(matchIdentity(a, { ...b, label: "North Pier" }).same, true, "category-word aliases still match");
  assert.equal(matchIdentity({ ...a, label: "Pier 1" }, { ...b, label: "Pier 2" }).same, false);
});

test("a historic site and adjacent restaurant cannot corroborate each other", () => {
  const a = external({ label: "North Pier", type: "historic-site", evidence: [] });
  const b = external({ label: "North Pier", type: "restaurant", evidence: [] });
  assert.equal(matchIdentity(a, b).same, false);
  assert.equal(matchIdentity(a, { ...b, type: "castle" }).same, true);
});

test("conflicting explicit entities and lookalike Wikidata URLs never establish shared identity", () => {
  assert.equal(matchIdentity(external({ wikidata: "Q1" }), external({ wikidata: "Q2" })).same, false);
  for (const url of ["https://notwikidata.org/wiki/Q42", "https://example.org/wikidata.org/wiki/Q42", "https://www.wikidata.org/wiki/Q42/other"]) {
    assert.equal(wikidataIdOf(external({ evidence: [{ source_ref: { url } }] })), null);
  }
});

// Simrishamn, 22 Nov 2026: OSM and Overture named the same museum with "och"
// and "&". The conjunction counted as a distinctive word, so the day listed
// the museum twice. Coordinates are the two real source records, ~7 m apart.
test("an 'och' and an '&' in the same name do not split one place in two", () => {
  const osm = external({ id: "osm-gw", label: "Konstmuseet Gösta Werner och Havet", type: "museum",
    lat: 55.5589186, lng: 14.3519352, evidence: [] });
  const overture = external({ id: "overture-gw", label: "Konstmuseet Gösta Werner & Havet", type: "museum",
    lat: 55.5589752, lng: 14.3519869, evidence: [], provider_id: "overture", candidate_origin: "external_open" });
  const v = matchIdentity(osm, overture);
  assert.equal(v.same, true, JSON.stringify(v));
  assert.equal(v.confidence, "geo_name");
  const resolved = resolveCandidateIdentity([osm, overture], { now: NOW });
  assert.equal(resolved.candidates.length, 1, "one stop for one museum");
  assert.equal(resolved.summary.merged_count, 1);
});

test("conjunctions in other languages are connectors too", () => {
  for (const [a, b] of [
    ["Smith and Wollensky", "Smith & Wollensky"],
    ["Sankt und Söhne", "Sankt & Söhne"],
    ["Tante et Fils", "Tante & Fils"],
    ["Kaffe og Kage Holm", "Kaffe & Kage Holm"],
  ]) {
    const v = matchIdentity(external({ label: a, type: "restaurant", evidence: [] }),
      external({ id: "osm-2", label: b, type: "restaurant", evidence: [] }));
    assert.equal(v.same, true, `${a} / ${b}: ${JSON.stringify(v)}`);
  }
});

test("a shared conjunction never joins two different places", () => {
  const a = external({ label: "Lund och Havet", type: "museum", evidence: [] });
  const b = external({ id: "osm-2", label: "Lund och Skogen", type: "museum", evidence: [] });
  assert.equal(matchIdentity(a, b).same, false);
});

// Hermes review of #709: "et" and "og" were dropped wherever they stood, so a
// name that begins or ends with them lost its distinctive word. A conjunction is
// a connector only between two other words.
test("ET or OG that is the name itself stays a distinctive word", () => {
  const et = external({ label: "ET Sushi Lund", type: "restaurant", evidence: [] });
  const og = external({ id: "osm-2", label: "OG Sushi Lund", type: "restaurant", evidence: [] });
  assert.equal(matchIdentity(et, og).same, false, "two different restaurants are not joined");

  const osm = external({ label: "Bar ET", type: "bar", evidence: [] });
  const overture = external({ id: "overture-et", label: "ET Bar", type: "bar", evidence: [],
    provider_id: "overture" });
  assert.equal(matchIdentity(osm, overture).same, true, "one bar named ET is one place");
  assert.equal(matchIdentity({ ...osm, label: "Och" }, { ...overture, label: "Och" }).same, true,
    "a one-word name is the name, even when the word is a conjunction");
});

// Hermes review of #711: a generic word in front ("The", "Café") made "og" look
// like a connector on one side only, so one place split in two, and "Café OG
// Aurora" merged with a different "Café Aurora". A conjunction joins only two
// name words; generic words around it do not count.
test("initials ET/OG keep their identity behind generic words and in any order", () => {
  const at = (id, label, over = {}) => external({ id, label, type: "cafe", evidence: [], ...over });
  for (const initials of ["OG", "ET"]) {
    for (const [a, b] of [
      [`${initials} Aurora Café`, `The ${initials} Aurora Café`],
      [`${initials} Aurora Café`, `Café ${initials} Aurora`],
      [`The ${initials} Café`, `The ${initials} Café`],
    ]) {
      const one = at("osm-a", a);
      const two = at("overture-b", b, { provider_id: "overture" });
      assert.equal(matchIdentity(one, two).same, true, `${a} / ${b}: ${JSON.stringify(matchIdentity(one, two))}`);
      assert.equal(resolveCandidateIdentity([one, two], { now: NOW }).candidates.length, 1, `${a} / ${b}: one stop`);
    }
    const initialsPlace = at("osm-a", `Café ${initials} Aurora`);
    const other = at("overture-b", "Café Aurora", { provider_id: "overture" });
    assert.equal(matchIdentity(initialsPlace, other).same, false, `Café ${initials} Aurora is not Café Aurora`);
    assert.equal(resolveCandidateIdentity([initialsPlace, other], { now: NOW }).candidates.length, 2);
  }
  // Connectors between two name words still join, behind a generic word too.
  for (const [a, b] of [["Café Gösta och Havet", "Café Gösta & Havet"], ["The Smith and Wollensky", "Smith & Wollensky"]]) {
    assert.equal(matchIdentity(at("osm-a", a), at("overture-b", b)).same, true, `${a} / ${b}`);
  }
  // Initials never stand in for a category or a hard-id conflict.
  assert.equal(matchIdentity(at("osm-a", "OG Aurora"), at("overture-b", "OG Aurora", { type: "museum" })).same, false);
});

// Connector-only identities need full word agreement, not another positional
// guess: keep literal names, article prefixes and category-word reordering.
test("literal connector names still match when their complete words agree", () => {
  for (const [a, b] of [
    ["OG Café", "The OG Café"],
    ["ET Café", "The ET Café"],
    ["OG Café", "OG Restaurant"],
    ["Bar ET", "ET Pub"],
    ["Café OG", "OG"],
    ["山 och 海 Café", "山 och 海 Restaurant"],
    ["Bar ET", "ET Bar"],
    ["Och", "The Och"],
    ["山 och 海", "山 och 海"],
    ["Bar and Café", "The Café and Bar"],
    ["OG Aurora Café", "The OG Aurora Restaurant"],
  ]) {
    const one = external({ id: "osm-a", label: a, type: "cafe", evidence: [] });
    const two = external({ id: "overture-b", label: b, type: "cafe", evidence: [],
      provider_id: "overture" });
    assert.equal(matchIdentity(one, two).same, true, `${a} / ${b}`);
    assert.equal(matchIdentity(two, one).same, true, `${b} / ${a}`);
    assert.equal(resolveCandidateIdentity([one, two], { now: NOW }).candidates.length, 1);
  }
});

// Synthetic #711 review regressions: a retained conjunction must not erase
// conflicting category words, single-letter initials, or single-character names.
for (const [a, b, typeB] of [
  ["Bar and Café", "Restaurant and Bakery", "restaurant"],
  ["Bar and et Café", "Restaurant and et Bakery", "restaurant"],
  ["X and Y", "J and K", "cafe"],
  ["山 och 海", "空 och 雨", "cafe"],
  ["Bar and Bar", "Café and Café", "cafe"],
]) {
  test(`a shared conjunction does not identify ${a} as ${b}`, () => {
    const operatorUrl = "https://operator.fixture.example/b";
    const one = curated({ label: a, type: "cafe", lat: 55.6, lng: 13,
      evidence: [] });
    const two = external({ label: b, type: typeB, lat: 55.6001, lng: 13,
      provider_id: "fixture-operator", source_family: "official",
      opening_hours: "Mo-Fr 10:00-18:00",
      opening_hours_source: { url: `${operatorUrl}/hours`, observed_at: NOW },
      evidence: [{ claim_type: "existence", value: true, observed_at: NOW,
        source_ref: { provider_id: "fixture-operator", source_family: "official",
          source_tier: "official", url: operatorUrl } }] });
    const before = JSON.stringify([one, two]);
    assert.equal(matchIdentity(one, two).same, false, "the conjunction is not sufficient identity");
    assert.equal(matchIdentity(two, one).same, false, "the guard is symmetric");
    for (const input of [[one, two], [two, one]]) {
      const result = resolveCandidateIdentity(input, { now: NOW });
      assert.equal(result.candidates.length, 2);
      assert.equal(result.summary.merged_count, 0);
      const retained = result.candidates.find(candidate => candidate.id === one.id);
      const donor = result.candidates.find(candidate => candidate.id === two.id);
      assert.equal(retained.opening_hours, undefined, "no foreign hours");
      assert.equal(retained.opening_hours_source, undefined, "no foreign hours source");
      assert.equal(retained.evidence.some(record => record.source_ref.url === operatorUrl), false,
        "no foreign official corroboration");
      assert.equal(donor.opening_hours, two.opening_hours, "keep the operator's own hours");
    }
    assert.equal(JSON.stringify([one, two]), before, "inputs are unchanged");
  });
}
