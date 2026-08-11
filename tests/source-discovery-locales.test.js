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
  });
  assert.deepEqual(discoveryLocaleForCountryCode("fr"), {
    language_hints: ["fr"],
    local_discovery_terms: ["événements", "agenda", "vide-greniers", "marché", "concert"],
  });
  assert.deepEqual(discoveryLocaleForCountryCode("cz"), {
    language_hints: ["cs"],
    local_discovery_terms: ["akce", "kalendář akcí", "bleší trh", "trhy", "koncert"],
  });
});

test("unknown country context stays neutral instead of inventing a locale", () => {
  assert.deepEqual(discoveryLocaleForCountryCode("xx"), {
    language_hints: [],
    local_discovery_terms: [],
  });
  assert.deepEqual(discoveryLocaleForCountryCode(null), {
    language_hints: [],
    local_discovery_terms: [],
  });
});

test("locale vocabulary is country-generic and contains no city branches", () => {
  const source = fs.readFileSync(
    require.resolve("../server/pulse-sources/source-discovery-locales"),
    "utf8",
  );
  assert.doesNotMatch(source, /stockholm|malm[oö]|prag|prague|simrishamn|naxos|bologna|lyon/i);
});
