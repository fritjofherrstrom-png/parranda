"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  COUNTRY_DISCOVERY_LOCALES,
  discoveryLocaleForCountryCode,
} = require("../server/pulse-sources/source-discovery-locales");

test("resolver country context adds bounded local-language discovery vocabulary", () => {
  assert.deepEqual(discoveryLocaleForCountryCode("SE"), {
    language_hints: ["sv"],
    local_discovery_terms: ["evenemang", "evenemangskalender", "loppis", "marknad", "konsert"],
    local_place_discovery_terms: ["sevärdheter", "besöksmål", "utflyktsmål"],
    local_rhythm_discovery_terms: ["bygdefest", "helgdagar"],
  });
  assert.deepEqual(discoveryLocaleForCountryCode("fr"), {
    language_hints: ["fr"],
    local_discovery_terms: ["événements", "agenda", "vide-greniers", "marché", "concert"],
    local_place_discovery_terms: ["sites à visiter", "incontournables"],
    local_rhythm_discovery_terms: ["fête de village", "jours fériés"],
  });
  assert.deepEqual(discoveryLocaleForCountryCode("cz"), {
    language_hints: ["cs"],
    local_discovery_terms: ["akce", "kalendář akcí", "bleší trh", "trhy", "koncert"],
    local_place_discovery_terms: ["památky", "co navštívit"],
    local_rhythm_discovery_terms: ["pouť", "místní svátky"],
  });
  assert.deepEqual(discoveryLocaleForCountryCode("es"), {
    language_hints: ["es"],
    local_discovery_terms: ["eventos", "agenda", "festes", "programació", "mercadillo"],
    local_place_discovery_terms: ["lugares que visitar", "qué ver"],
    local_rhythm_discovery_terms: ["fiestas patronales", "festivos"],
  });
});

test("unknown country context stays neutral instead of inventing a locale", () => {
  assert.deepEqual(discoveryLocaleForCountryCode("xx"), {
    language_hints: [],
    local_discovery_terms: [],
    local_place_discovery_terms: [],
    local_rhythm_discovery_terms: [],
  });
  assert.deepEqual(discoveryLocaleForCountryCode(null), {
    language_hints: [],
    local_discovery_terms: [],
    local_place_discovery_terms: [],
    local_rhythm_discovery_terms: [],
  });
});

test("European discovery includes small-happening and holiday vocabulary without implying occurrences", () => {
  for (const code of Object.keys(COUNTRY_DISCOVERY_LOCALES)) {
    const vocabulary = discoveryLocaleForCountryCode(code);
    assert.ok(vocabulary.local_rhythm_discovery_terms.length >= 2, code);
    assert.ok(vocabulary.local_discovery_terms.length <= 5, code);
    assert.equal(JSON.stringify(vocabulary).includes("starts_at"), false, "a search hint never creates an event date");
  }
  for (const [code, term] of [["it", "sagra"], ["mt", "village festa"], ["hr", "pučka fešta"], ["es", "festivos"], ["gb", "village fete"], ["hu", "falunap"]]) {
    assert.ok(discoveryLocaleForCountryCode(code).local_rhythm_discovery_terms.includes(term));
  }
});

test("locale vocabulary is country-generic and contains no city branches", () => {
  const source = fs.readFileSync(
    require.resolve("../server/pulse-sources/source-discovery-locales"),
    "utf8",
  );
  assert.doesNotMatch(source, /stockholm|malm[oö]|prag|prague|simrishamn|naxos|bologna|lyon/i);
});
