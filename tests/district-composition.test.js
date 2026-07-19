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

test("district stops preserve explicit local-quality facts for optional route context", () => {
  const candidates = [
    {
      id: "local-cafe",
      name: "Independent Cafe",
      type: "cafe",
      tags: ["coffee"],
      lat: 60,
      lng: 24,
      chain: false,
      brand: null,
      local_feel_rank: 0,
      candidate_origin: "external_open",
    },
    {
      id: "brand-cafe",
      name: "Branded Cafe",
      type: "cafe",
      tags: ["coffee"],
      lat: 60.0004,
      lng: 24,
      chain: true,
      brand: "Brand",
      local_feel_rank: 2,
      candidate_origin: "external_open",
    },
    {
      id: "local-bakery",
      name: "Independent Bakery",
      type: "bakery",
      tags: ["coffee"],
      lat: 60.0002,
      lng: 24.0002,
      chain: false,
      local_feel_rank: 0,
      candidate_origin: "external_open",
    },
  ];
  const before = structuredClone(candidates);
  const day = composeDistrictDay(candidates, { intents: ["fika"], maxAreas: 1 });
  const stops = day.areas.flatMap((area) => area.stops);

  assert.deepEqual(candidates, before, "composition never mutates candidate evidence");
  assert.deepEqual(
    stops
      .filter((stop) => stop.id !== "local-bakery")
      .map(({ id, type, tags, chain, brand, local_feel_rank, candidate_origin }) => ({
        id,
        type,
        tags,
        chain,
        brand,
        local_feel_rank,
        candidate_origin,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    [
      {
        id: "brand-cafe",
        type: "cafe",
        tags: ["coffee"],
        chain: true,
        brand: "Brand",
        local_feel_rank: 2,
        candidate_origin: "external_open",
      },
      {
        id: "local-cafe",
        type: "cafe",
        tags: ["coffee"],
        chain: false,
        brand: null,
        local_feel_rank: 0,
        candidate_origin: "external_open",
      },
    ],
  );
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

test("daypart coherence: the day reads as a distinct morning→evening arc (no two districts share a daypart)", () => {
  const cluster = (prefix, lat, specs) =>
    specs.map((s, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}`, type: s.type, tags: s.tags, lat: lat + i * 0.0003, lng: 24.0 }));
  // Three well-separated clusters: café-morning, culture+food-midday, bars-evening.
  const city = [
    ...cluster("m", 60.10, [{ type: "cafe", tags: ["fika"] }, { type: "cafe", tags: ["fika"] }, { type: "bakery", tags: ["fika"] }]),
    ...cluster("d", 60.13, [{ type: "museum", tags: ["culture"] }, { type: "restaurant", tags: ["food"] }, { type: "gallery", tags: ["culture"] }]),
    ...cluster("e", 60.16, [{ type: "bar", tags: ["nightlife"] }, { type: "bar", tags: ["nightlife"] }, { type: "pub", tags: ["nightlife"] }]),
  ];
  const day = composeDistrictDay(city, { intents: ["fika", "culture", "food", "nightlife"], maxAreas: 3 });
  assert.equal(day.areas.length, 3);
  const dayparts = day.areas.map((a) => a.daypart_hint);
  assert.equal(new Set(dayparts).size, 3, `distinct dayparts, got ${dayparts.join("/")}`);
  // Ordered morning → evening, and the bar strip reads evening (not midday).
  assert.ok(day.areas[0].covers.includes("fika"), "café morning district first");
  assert.equal(day.areas[day.areas.length - 1].daypart_hint, "evening");
  assert.ok(day.areas[day.areas.length - 1].covers.includes("nightlife"), "nightlife district reads evening, last");
});

test("a district with a few strong-evening bars amid daytime types leans later than a pure-daytime one", () => {
  const cluster = (prefix, lat, specs) =>
    specs.map((s, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}`, type: s.type, tags: s.tags, lat: lat + i * 0.0003, lng: 24.0 }));
  // Two clusters both heavy on daytime types, but one has bars — it must sort later.
  const city = [
    ...cluster("day", 60.10, [{ type: "restaurant", tags: ["food"] }, { type: "museum", tags: ["culture"] }, { type: "gallery", tags: ["culture"] }]),
    ...cluster("night", 60.14, [{ type: "restaurant", tags: ["food"] }, { type: "bar", tags: ["nightlife"] }, { type: "bar", tags: ["nightlife"] }]),
  ];
  const day = composeDistrictDay(city, { intents: ["food", "culture", "nightlife"], maxAreas: 2 });
  assert.equal(day.areas.length, 2);
  const nightIdx = day.areas.findIndex((a) => a.covers.includes("nightlife"));
  assert.equal(nightIdx, 1, "the bar-bearing district sorts later despite shared daytime types (bar strength wins)");
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
