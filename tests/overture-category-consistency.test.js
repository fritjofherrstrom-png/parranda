"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fixture = require("./fixtures/overture-category-conflict-20261028.json");
const { mapOvertureRow, createOvertureSource } = require("../server/place-candidates/overture-source");
const { matchCandidateToIntent } = require("../server/candidates/intent-vocabulary");
const { mapRecordToCandidate } = require("../server/place-candidates/external-open-provider");
const { scoreCandidateFit } = require("../server/candidates/fit-scorer");
const ANCHOR = { lat: 21.304547, lng: -157.855676 };
const source = () => createOvertureSource({ queryRows: async () => assert.fail("cached semantic selection must not acquire sources") });

function raw(overrides = {}) {
  return { id: "10000000-0000-0000-0000-000000000001", name: "Harbour Kitchen", category: "restaurant",
    category_hierarchy: ["food_and_drink", "restaurant"], confidence: 0.99,
    lat: ANCHOR.lat, lng: ANCHOR.lng, licenses: ["CC0-1.0"], websites: ["https://kitchen.example/"], ...overrides };
}

test("the retained real record cannot claim Food through cached supply and candidate fit", () => {
  const input = structuredClone(fixture.record);
  const candidate = mapRecordToCandidate({ key: "anywhere" }, input, "2026-10-28T10:00:00Z", 0);
  assert.deepEqual(scoreCandidateFit({ candidate, userIntents: ["food"] }).covered_preferences, ["food"],
    "reproduction: the saved wrong type reaches full preference coverage without any UI inference");
  const selected = source().select([input], { ...ANCHOR, requestedIntents: ["food"] });
  assert.deepEqual(selected, [], "the Overture boundary must withhold internally contradictory eating venues");
  assert.deepEqual(input, fixture.record, "the retained sample and receipt are not rewritten");
});

test("fresh food rows with matching feature names and article paths are withheld without reclassification", () => {
  for (const [name, url] of [
    ["Ada Lovelace Statue", "https://history.example/news/ada_lovelace_statue.html"],
    ["Sculpture of the Harbour", "https://arts.example/articles/harbour-sculpture"],
    ["River Memorial", "https://history.example/wiki/river_memorial"],
    ["Hamnens staty", "https://history.example/news/hamnens-staty"],
  ]) {
    assert.equal(mapOvertureRow(raw({ name, websites: [url] })), null, name);
  }
});

test("actual businesses and single-field ambiguity retain their source-owned food category", () => {
  for (const [name, url] of [
    ["Statue Restaurant", "https://food.example/news/statue-restaurant"],
    ["Memorial Cafe", "https://food.example/articles/memorial-cafe"],
    ["Trattoria del Monumento", "https://food.example/news/trattoria-del-monumento"],
    ["Osteria del Monumento", "https://food.example/news/osteria-del-monumento"],
    ["The Monument", "https://pub.example/news/monument"],
    ["Harbour Kitchen", "https://food.example/news/near-a-statue"],
    ["Ada Lovelace Statue", "https://restaurant.example/"],
    ["Ada Lovelace Statue", "https://statue.example/news/kitchen"],
  ]) {
    const record = mapOvertureRow(raw({ name, websites: [url] }));
    assert.equal(record?.type, "restaurant", name);
    assert.equal(matchCandidateToIntent(record, "food").level, "strong");
    assert.equal(record.opening_hours, undefined, "unknown hours remain unknown without excluding genuine food supply");
  }
});

test("cached contradictory rows cannot crowd a genuine restaurant out of the bounded selection", () => {
  const good = mapOvertureRow(raw({ lat: 21.315 }));
  const selected = createOvertureSource({ limit: 1 }).select([fixture.record, good], { ...ANCHOR, requestedIntents: ["food"] });
  assert.deepEqual(selected.map(row => row.id), [good.id]);
  assert.equal(selected[0].sources[0].tier, "inferred");
});

test("the consistency check covers eating/drinking types without vetoing a provider-typed monument", () => {
  const fields = { name: "Ada Lovelace Statue", websites: ["https://history.example/news/ada-lovelace-statue"] };
  for (const category of ["restaurant", "coffee_shop", "bar"]) {
    assert.equal(mapOvertureRow(raw({ ...fields, category, category_hierarchy: [category] })), null, category);
  }
  const monument = mapOvertureRow(raw({ ...fields, category: "monument", category_hierarchy: ["monument"] }));
  assert.equal(monument.type, "monument", "the source category, not a name inference, still owns positive classification");
  assert.equal(matchCandidateToIntent(monument, "food").level, "none");
});
