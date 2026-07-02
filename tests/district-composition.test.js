/**
 * Inter-district day composition — compose a smart day ACROSS a place's districts,
 * generically (any city, no citypack, deterministic).
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { composeDistrictDay, tokensToAxes } = require("../server/candidates/district-composition");

// A synthetic ANY-city candidate set with FOUR distinct districts ~1.6 km apart:
// vintage/market quarter (morning), café district, nightlife strip (evening),
// scenic cluster (afternoon/golden-hour).
function fourDistrictCity() {
  const cluster = (prefix, baseLat, baseLng, type, tags, time_fit) =>
    [0, 1, 2].map((i) => ({
      id: `${prefix}${i}`,
      type,
      tags,
      time_fit,
      lat: baseLat + i * 0.0008,
      lng: baseLng + i * 0.0008,
    }));
  return [
    ...cluster("vint", 41.9000, 12.5000, "vintage-shop", ["second_hand", "vintage"], ["morning"]),
    ...cluster("cafe", 41.9150, 12.5000, "cafe", ["fika", "coffee"], []),
    ...cluster("bar", 41.9000, 12.5200, "bar", ["nattliv", "kväll"], ["evening"]),
    ...cluster("view", 41.9150, 12.5200, "viewpoint", ["utsikt"], ["afternoon"]),
  ];
}

test("each district carries a few concrete stop NAMES (so the UI shows an itinerary, not a count)", () => {
  const named = [
    { id: "n0", name: "Taverna Aleksis", type: "restaurant", tags: ["food"], lat: 60.0, lng: 24.0 },
    { id: "n1", name: "Mokka Café", type: "cafe", tags: ["fika"], lat: 60.0006, lng: 24.0 },
    { id: "n2", name: "Bar Loose", type: "bar", tags: ["nightlife"], lat: 60.0, lng: 24.0006 },
  ];
  const day = composeDistrictDay(named, { intents: ["food", "fika", "nightlife"], maxAreas: 2 });
  const names = day.areas.flatMap((a) => a.stop_names);
  assert.ok(names.includes("Taverna Aleksis") && names.includes("Mokka Café"), "real names are forwarded");
  assert.ok(day.areas.every((a) => a.stop_names.length <= 4), "names are capped for a readable card");
});

test("each district carries map-drawable stops (id + name + real coords, never fabricated)", () => {
  const named = [
    { id: "m0", name: "Taverna Aleksis", type: "restaurant", tags: ["food"], lat: 60.0, lng: 24.0 },
    { id: "m1", name: "Mokka Café", type: "cafe", tags: ["fika"], lat: 60.0006, lng: 24.0 },
    { id: "m2", type: "bar", tags: ["nightlife"], lat: 60.0, lng: 24.0006 }, // no name → name null, coords kept
    { id: "m3", name: "Ghost", type: "cafe", tags: ["fika"] }, // no coords → excluded from stops
  ];
  const day = composeDistrictDay(named, { intents: ["food", "fika", "nightlife"], maxAreas: 2 });
  const stops = day.areas.flatMap((a) => a.stops);
  assert.ok(stops.length >= 3, "coordinate-bearing stops are emitted");
  for (const s of stops) {
    assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lng), "every emitted stop has real coords");
  }
  assert.ok(stops.some((s) => s.name === "Taverna Aleksis"));
  assert.ok(!stops.some((s) => s.id === "m3"), "a stop without coords is never fabricated onto the map");
});

test("composes complementary districts that cover the requested intents", () => {
  const day = composeDistrictDay(fourDistrictCity(), { intents: ["second_hand", "fika"], maxAreas: 3 });
  assert.deepEqual(day.covered_intents.slice().sort(), ["fika", "second_hand"]);
  assert.deepEqual(day.missing_intents, []);
  assert.equal(day.areas.length, 2, "two complementary districts chosen, not the whole city");
  // Each chosen district contributes its on-intent stops.
  const allStops = day.areas.flatMap((a) => a.stop_ids);
  assert.ok(allStops.some((id) => id.startsWith("vint")) && allStops.some((id) => id.startsWith("cafe")));
  // An honest inter-district leg with a real distance.
  assert.equal(day.legs.length, 1);
  assert.ok(day.legs[0].distance_km > 0);
});

test("orders districts by daypart: morning district before evening district", () => {
  const day = composeDistrictDay(fourDistrictCity(), { intents: ["second_hand", "nightlife"], maxAreas: 3 });
  assert.equal(day.areas.length, 2);
  assert.ok(day.areas[0].covers.includes("second_hand"), "morning vintage quarter first");
  assert.equal(day.areas[0].daypart_hint, "morning");
  assert.ok(day.areas[1].covers.includes("nightlife"), "evening nightlife strip last");
  assert.equal(day.areas[1].daypart_hint, "evening");
});

test("honestly reports an intent no district can satisfy (no fabricated district)", () => {
  // A city with NO scenic district; user wants views.
  const noScenic = fourDistrictCity().filter((c) => !c.id.startsWith("view"));
  const day = composeDistrictDay(noScenic, { intents: ["views"], maxAreas: 3 });
  assert.deepEqual(day.covered_intents, []);
  assert.deepEqual(day.missing_intents, ["views"]);
});

test("deterministic and order-independent", () => {
  const a = composeDistrictDay(fourDistrictCity(), { intents: ["fika", "utsikt"], maxAreas: 3 });
  const b = composeDistrictDay(fourDistrictCity().reverse(), { intents: ["fika", "utsikt"], maxAreas: 3 });
  assert.deepEqual(a, b);
});

test("respects maxAreas (a compact day, not the whole city)", () => {
  const day = composeDistrictDay(fourDistrictCity(), { intents: ["second_hand", "fika", "nightlife", "utsikt"], maxAreas: 2 });
  assert.ok(day.areas.length <= 2);
});

test("tokensToAxes maps surface tokens (tags/types/synonyms) to canonical axes", () => {
  assert.deepEqual([...tokensToAxes(["vintage", "viewpoint", "kväll"])].sort(), ["nightlife", "second_hand", "views"]);
  assert.equal(tokensToAxes(["totally-unknown-token"]).size, 0);
});
