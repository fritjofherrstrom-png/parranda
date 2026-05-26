const test = require("node:test");
const assert = require("node:assert/strict");

const barcelona = require("../server/cities/barcelona");

const { findItemByName, allItems } = barcelona.catalog;

// Regression coverage for the user-search gaps surfaced by the
// Barcelona-as-a-user audit after #141. The catalog uses exact-key
// lookup on a normalized form (NFKD, diacritics stripped, lowercased,
// trimmed), so a query only matches when the exact normalized string
// appears in `name` or `searchTerms` of some entry. These tests pin
// the local-language and English variants users actually type.

test("Barcelona catalog resolves canonical English/Spanish/Catalan second-hand clothing terms", () => {
  const canonicalQueries = {
    // English variants
    "second hand": "expected an entry tagged second_hand to surface",
    "Second Hand": "case-insensitive lookup must hit too",
    "vintage": "vintage as a bare word must hit a vintage clothing shop",
    // Spanish variants
    "segunda mano": "Spanish form must hit a verified second-hand shop",
    "ropa segunda mano": "Spanish two-word form must hit",
    "moda vintage": "Spanish 'moda vintage' must hit",
    // Catalan variant
    "roba de segona mà": "Catalan form (with diacritic) must normalize and hit",
    "roba de segona ma": "Catalan form without diacritic must also hit",
  };

  for (const [query, message] of Object.entries(canonicalQueries)) {
    const hit = findItemByName(query);
    assert.ok(hit, `"${query}" returned no match — ${message}`);
    assert.ok(
      (hit.tags || []).includes("second_hand") || (hit.tags || []).includes("vintage"),
      `"${query}" hit ${hit.id} but the result lacks second_hand/vintage tags`,
    );
  }
});

test("Barcelona catalog resolves bare 'kilo' to a pay-by-weight vintage shop", () => {
  // Regression for audit gap G2: "kilo" returned no match because
  // Flamingos searchTerms only carried "kilo shop" / "vintage kilo".
  const hit = findItemByName("kilo");
  assert.ok(hit, "'kilo' must hit a kilo-format vintage shop");
  assert.equal(hit.id, "flamingos-vintage-kilo-tallers");
});

test("Barcelona beta-depth anchors are searchable by local area and intent terms", () => {
  const expectedHits = {
    "arepa queer": "arepa-queer",
    "vilde vintage": "vilde-vintage",
    "ronda universitat": "humana-vintage-ronda-universitat",
    "los feliz": "los-feliz-vintage",
    "mahalo vintage": "mahalo-vintage-diamant",
    "la mundana": "la-mundana",
    "bodega montferry": "bodega-montferry",
    "abirradero": "abirradero",
  };

  for (const [query, expectedId] of Object.entries(expectedHits)) {
    const hit = findItemByName(query);
    assert.ok(hit, `"${query}" returned no Barcelona beta-depth match`);
    assert.equal(hit.id, expectedId);
  }
});

test("Barcelona catalog does not leak Rome IDs via second-hand search terms", () => {
  // Counter-test: confirm none of the new second-hand search terms
  // accidentally collide with a Rome entry's name/alias.
  const queries = ["second hand", "kilo", "segunda mano", "moda vintage", "roba de segona mà"];
  for (const query of queries) {
    const hit = findItemByName(query);
    if (!hit) continue;
    assert.equal(
      barcelona.catalog.allItems.some((item) => item.id === hit.id),
      true,
      `"${query}" returned ${hit.id} which is not a Barcelona catalog item`,
    );
  }
});

test("every Barcelona entry tagged second_hand exposes the English phrase 'second hand'", () => {
  // The catalog convention this PR establishes: any entry tagged
  // second_hand should also carry the spaced English phrase in
  // searchTerms so users typing the English form land somewhere.
  // (Markets and shops alike — the search layer is uniform.)
  const secondHandEntries = allItems.filter((item) => (item.tags || []).includes("second_hand"));
  assert.ok(secondHandEntries.length >= 14, "expected at least the #141 + #143 second-hand entries");

  for (const entry of secondHandEntries) {
    assert.ok(
      (entry.searchTerms || []).some((term) => /^second hand$/i.test(String(term))),
      `${entry.id} is tagged second_hand but searchTerms does not include "second hand"`,
    );
  }
});
