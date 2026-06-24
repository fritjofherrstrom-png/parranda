/**
 * Agnostic area / district intelligence — derive a place's structure from its
 * candidate set, generically (no citypack, no network, deterministic).
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { summarizePlaceStructure, clusterCandidatesIntoAreas, profileArea } = require("../server/candidates/area-intelligence");

// A synthetic ANY-city candidate set (could be OSM output for any coordinates):
// - a vintage/market quarter (3 places, tightly clustered)
// - a café district ~1 km away (3 places, tightly clustered)
// - one lone scenic viewpoint far from both (scattered)
function fixture() {
  return [
    { id: "v1", type: "vintage-shop", tags: ["second_hand", "vintage"], lat: 41.9000, lng: 12.5000, time_fit: ["midday"] },
    { id: "v2", type: "market", tags: ["market", "second_hand"], lat: 41.9006, lng: 12.5006, time_fit: ["morning"] },
    { id: "v3", type: "vintage-shop", tags: ["vintage"], lat: 41.9003, lng: 12.5003 },
    { id: "c1", type: "cafe", tags: ["fika"], lat: 41.9200, lng: 12.5200, time_fit: ["morning"] },
    { id: "c2", type: "cafe", tags: ["fika", "coffee"], lat: 41.9206, lng: 12.5206 },
    { id: "c3", type: "cafe", tags: ["fika"], lat: 41.9203, lng: 12.5203 },
    { id: "lone", type: "viewpoint", tags: ["utsikt"], lat: 41.9500, lng: 12.5500 },
  ];
}

test("derives distinct districts from the candidate set, each with its own character", () => {
  const s = summarizePlaceStructure(fixture());
  assert.equal(s.area_count, 2, "two districts found");
  assert.equal(s.scattered_count, 1, "the lone viewpoint is scattered, not a district");

  // Sorted by size (tie → center); both are size 3 here, so identify by dominant type.
  const vintage = s.areas.find((a) => a.dominant_types.includes("vintage-shop") || a.dominant_types.includes("market"));
  const cafe = s.areas.find((a) => a.dominant_types.includes("cafe"));
  assert.ok(vintage, "a vintage/market district");
  assert.ok(cafe, "a café district");
  assert.ok(vintage.dominant_intents.includes("second_hand") || vintage.dominant_intents.includes("vintage"));
  assert.ok(cafe.dominant_intents.includes("fika"));
  assert.equal(cafe.daypart_hint, "morning"); // its time_fit signal
  assert.deepEqual(vintage.member_ids.slice().sort(), ["v1", "v2", "v3"]);
});

test("clustering is deterministic and order-independent", () => {
  const a = summarizePlaceStructure(fixture());
  const shuffled = fixture().reverse();
  const b = summarizePlaceStructure(shuffled);
  assert.deepEqual(a, b, "same input set in any order → identical structure");
});

test("a tighter link distance splits, a looser one merges (generic knob, not city-specific)", () => {
  // Very loose link → the two ~1 km clusters merge into one big area.
  const merged = summarizePlaceStructure(fixture(), { linkKm: 5 });
  assert.equal(merged.area_count, 1);
  // Very tight link → nothing clusters, everything scattered.
  const split = summarizePlaceStructure(fixture(), { linkKm: 0.01, minAreaSize: 3 });
  assert.equal(split.area_count, 0);
  assert.equal(split.scattered_count, 7);
});

test("empty / coordinate-less input degrades to no structure (no throw)", () => {
  assert.deepEqual(summarizePlaceStructure([]), { areas: [], scattered_count: 0, area_count: 0 });
  assert.deepEqual(summarizePlaceStructure([{ id: "x", type: "cafe" }]), { areas: [], scattered_count: 0, area_count: 0 });
  assert.equal(clusterCandidatesIntoAreas(null).length, 0);
});

test("profileArea centers on the members and ranks dominant types", () => {
  const p = profileArea([
    { id: "a", type: "cafe", tags: ["fika"], lat: 41.90, lng: 12.50 },
    { id: "b", type: "cafe", tags: ["fika"], lat: 41.90, lng: 12.50 },
    { id: "c", type: "bar", tags: ["nattliv"], lat: 41.90, lng: 12.50 },
  ]);
  assert.equal(p.size, 3);
  assert.equal(p.dominant_types[0], "cafe");
  assert.deepEqual(p.center, { lat: 41.9, lng: 12.5 });
});
