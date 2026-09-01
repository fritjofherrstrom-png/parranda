"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  discoveryLocaleForCountryCode,
} = require("../server/pulse-sources/source-discovery-locales");

test("resolver country context adds bounded local-language discovery vocabulary", () => {
  assert.deepEqual(discoveryLocaleForCountryCode("SE"), {
    language_hints: ["sv"],
    local_discovery_terms: ["evenemang", "evenemangskalender", "loppis", "marknad", "konsert"],
    local_place_discovery_terms: ["sevärdheter", "besöksmål", "utflyktsmål"],
  });
  assert.deepEqual(discoveryLocaleForCountryCode("fr"), {
    language_hints: ["fr"],
    local_discovery_terms: ["événements", "agenda", "vide-greniers", "marché", "concert"],
    local_place_discovery_terms: ["sites à visiter", "incontournables"],
  });
  assert.deepEqual(discoveryLocaleForCountryCode("cz"), {
    language_hints: ["cs"],
    local_discovery_terms: ["akce", "kalendář akcí", "bleší trh", "trhy", "koncert"],
    local_place_discovery_terms: ["památky", "co navštívit"],
  });
  assert.deepEqual(discoveryLocaleForCountryCode("es"), {
    language_hints: ["es"],
    local_discovery_terms: ["eventos", "agenda", "festes", "programació", "mercadillo"],
    local_place_discovery_terms: ["lugares que visitar", "qué ver"],
  });
});

test("unknown country context stays neutral instead of inventing a locale", () => {
  assert.deepEqual(discoveryLocaleForCountryCode("xx"), {
    language_hints: [],
    local_discovery_terms: [],
    local_place_discovery_terms: [],
  });
  assert.deepEqual(discoveryLocaleForCountryCode(null), {
    language_hints: [],
    local_discovery_terms: [],
    local_place_discovery_terms: [],
  });
});

test("locale vocabulary is country-generic and contains no city branches", () => {
  const source = fs.readFileSync(
    require.resolve("../server/pulse-sources/source-discovery-locales"),
    "utf8",
  );
  assert.doesNotMatch(source, /stockholm|malm[oö]|prag|prague|simrishamn|naxos|bologna|lyon/i);
});
