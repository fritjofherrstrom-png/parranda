const assert = require("node:assert/strict");
const test = require("node:test");

const rome = require("../server/cities/rome");
const barcelona = require("../server/cities/barcelona");
const {
  CandidateProviderRegistry,
  collectPlaceCandidatesForCity,
  createDefaultCandidateProviderRegistry,
  summarizeCandidateCollection,
} = require("../server/place-candidates/provider-registry");
const { validatePlaceCandidate } = require("../server/place-candidates/contract");

test("default registry collects Rome catalog candidates as valid PlaceCandidates", () => {
  const registry = createDefaultCandidateProviderRegistry();
  const result = registry.collectCandidates(rome);

  assert.deepEqual(registry.listProviderIds(), ["curated-catalog"]);
  assert.equal(result.city, "rome");
  assert.equal(result.candidates.length, rome.catalog.allItems.length);
  assert.ok(result.candidates.length > 0);
  for (const candidate of result.candidates) {
    assert.doesNotThrow(() => validatePlaceCandidate(candidate));
    assert.equal(candidate.city, "rome");
    assert.equal(candidate.source.kind, "city_catalog");
  }

  assert.equal(result.summary.total, result.candidates.length);
  assert.equal(result.summary.by_provider["curated-catalog"].count, result.candidates.length);
  assert.equal(result.summary.by_trust_tier.curated, result.candidates.length);
  assert.ok(result.summary.by_candidate_kind.real_place > 0);
  assert.ok(result.summary.by_candidate_kind.area_preset > 0);
});

test("default registry collects Barcelona candidates and keeps structural anchors distinguishable", () => {
  const result = collectPlaceCandidatesForCity(barcelona);

  assert.equal(result.city, "barcelona");
  assert.equal(result.candidates.length, barcelona.catalog.allItems.length);
  assert.equal(result.summary.total, 75);
  assert.equal(result.summary.real_place_count, 70);
  assert.equal(result.summary.structural_count, 5);
  assert.deepEqual(result.summary.by_candidate_kind, {
    structural_anchor: 5,
    real_place: 70,
  });
  assert.deepEqual(result.summary.by_trust_tier, {
    curated: 75,
  });
  assert.deepEqual(result.summary.by_provider["curated-catalog"].by_candidate_kind, {
    structural_anchor: 5,
    real_place: 70,
  });

  const structural = result.candidates.filter((candidate) => candidate.is_structural);
  const realPlaces = result.candidates.filter((candidate) => !candidate.is_structural);

  assert.equal(structural.length, 5);
  assert.equal(realPlaces.length, 70);
  assert.ok(structural.every((candidate) => candidate.candidate_kind === "structural_anchor"));
  assert.ok(realPlaces.every((candidate) => candidate.candidate_kind === "real_place"));
});

test("registry passes provider options such as includeStructural", () => {
  const result = collectPlaceCandidatesForCity(barcelona, {
    includeStructural: false,
  });

  assert.equal(result.summary.total, 70);
  assert.equal(result.summary.real_place_count, 70);
  assert.equal(result.summary.structural_count, 0);
  assert.deepEqual(result.summary.by_candidate_kind, {
    real_place: 70,
  });
});

test("registry can restrict enabled providers without changing runtime behavior", () => {
  const emptyResult = collectPlaceCandidatesForCity(barcelona, {
    enabledProviderIds: ["not-enabled"],
  });

  assert.equal(emptyResult.city, "barcelona");
  assert.deepEqual(emptyResult.candidates, []);
  assert.deepEqual(emptyResult.summary, {
    total: 0,
    real_place_count: 0,
    structural_count: 0,
    by_candidate_kind: {},
    by_trust_tier: {},
    by_provider: {},
  });
});

test("registry validates provider specs and provider output", () => {
  assert.throws(() => new CandidateProviderRegistry([{ id: "", create() {} }]), /id/);
  assert.throws(() => new CandidateProviderRegistry([{ id: "broken" }]), /create/);

  const registry = new CandidateProviderRegistry([
    {
      id: "broken-provider",
      create() {
        return {
          listCandidates() {
            return [{ id: "", city: "rome" }];
          },
        };
      },
    },
  ]);

  assert.throws(() => registry.collectCandidates(rome), /broken-provider\.candidates\[0\]\.id/);
});

test("Rome and Barcelona candidates expose the same required shape", () => {
  // Cross-city consistency guard. Every candidate from any city pack must
  // carry the same required PlaceCandidate keys so downstream consumers
  // (Blitz, Planner, future engine code) can treat candidates uniformly
  // regardless of city. Optional keys (`lat`, `lng`, `area`, `macro`,
  // `neighborhood`) are intentionally excluded — they depend on data, not
  // on contract shape.
  const REQUIRED_KEYS = [
    "id",
    "city",
    "label",
    "type",
    "candidate_kind",
    "is_structural",
    "source",
    "trust",
    "freshness",
    "tags",
    "vibes",
    "time_fit",
    "route_roles",
    "confidence",
    "city_pack_owned",
  ].sort();

  const romeCandidates = collectPlaceCandidatesForCity(rome).candidates;
  const barcelonaCandidates = collectPlaceCandidatesForCity(barcelona).candidates;

  assert.ok(romeCandidates.length > 0, "Rome must produce at least one candidate");
  assert.ok(barcelonaCandidates.length > 0, "Barcelona must produce at least one candidate");

  // The first candidate from each city must carry every required key, and
  // both cities must share the same required-key set (no city-specific drift).
  const romeRequired = REQUIRED_KEYS.filter((key) => key in romeCandidates[0]).sort();
  const barcelonaRequired = REQUIRED_KEYS.filter((key) => key in barcelonaCandidates[0]).sort();
  assert.deepEqual(romeRequired, REQUIRED_KEYS);
  assert.deepEqual(barcelonaRequired, REQUIRED_KEYS);

  // Every candidate in either city must carry every required key. Catches
  // drift where one item type or provider drops a required field.
  for (const [cityKey, candidates] of [
    ["rome", romeCandidates],
    ["barcelona", barcelonaCandidates],
  ]) {
    for (const [index, candidate] of candidates.entries()) {
      for (const key of REQUIRED_KEYS) {
        assert.ok(
          key in candidate,
          `${cityKey}.candidates[${index}] missing required key "${key}"`,
        );
      }
    }
  }
});

test("summarizeCandidateCollection can summarize an explicit candidate list", () => {
  const candidates = collectPlaceCandidatesForCity(barcelona, {
    includeStructural: false,
  }).candidates.slice(0, 3);
  const summary = summarizeCandidateCollection(candidates, [
    {
      id: "sample",
      count: candidates.length,
      summary: {
        by_candidate_kind: { real_place: candidates.length },
        by_trust_tier: { curated: candidates.length },
      },
    },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.real_place_count, 3);
  assert.equal(summary.structural_count, 0);
  assert.equal(summary.by_candidate_kind.real_place, 3);
  assert.equal(summary.by_trust_tier.curated, 3);
  assert.equal(summary.by_provider.sample.count, 3);
});
