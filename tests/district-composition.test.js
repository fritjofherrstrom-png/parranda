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

test("nearby same-name source features become one context suggestion", () => {
  const candidates = [
    {
      id: "viewpoint-b",
      name: "Harbour Walk",
      type: "viewpoint",
      tags: ["views"],
      lat: 57,
      lng: 12,
    },
    {
      id: "viewpoint-a",
      name: "harbour  walk",
      type: "viewpoint",
      tags: ["scenic"],
      lat: 57.0005,
      lng: 12.001,
    },
    {
      id: "museum",
      name: "Local Museum",
      type: "museum",
      tags: ["culture"],
      lat: 57.0002,
      lng: 12.0002,
    },
  ];

  const day = composeDistrictDay(candidates, { intents: ["views", "culture"], maxAreas: 1 });
  const reversed = composeDistrictDay([...candidates].reverse(), { intents: ["views", "culture"], maxAreas: 1 });
  const area = day.areas[0];

  assert.deepEqual(reversed, day, "duplicate evidence resolves independently of provider row order");
  assert.deepEqual([...area.stop_ids].sort(), ["museum", "viewpoint-a"], "the deterministic stronger representative remains");
  assert.deepEqual([...area.stop_names].sort(), ["Local Museum", "harbour  walk"]);
  assert.deepEqual(area.stops.map((stop) => stop.id).sort(), ["museum", "viewpoint-a"]);
});

test("same-name context evidence remains separate when far apart or functionally different", () => {
  const candidates = [
    { id: "near-cafe", name: "River House", type: "cafe", tags: ["coffee"], lat: 48, lng: 11 },
    { id: "near-gallery", name: "River House", type: "gallery", tags: ["culture"], lat: 48.0002, lng: 11.0002 },
    { id: "far-cafe", name: "River House", type: "cafe", tags: ["coffee"], lat: 48.003, lng: 11 },
  ];

  const day = composeDistrictDay(candidates, { intents: ["fika", "culture"], maxAreas: 2 });
  const ids = day.areas.flatMap((area) => area.stop_ids);

  assert.deepEqual(ids.sort(), ["far-cafe", "near-cafe", "near-gallery"]);
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
    stops.map(({ id, type, tags, chain, brand, local_feel_rank, candidate_origin }) => ({
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
        id: "local-bakery",
        type: "bakery",
        tags: ["coffee"],
        chain: false,
        brand: null,
        local_feel_rank: 0,
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
    "a chain is not surfaced beside local candidates covering the same axis",
  );
});

test("district context keeps a chain only as an axis-specific sparse fallback", () => {
  const candidates = [
    {
      id: "local-gallery",
      name: "Independent Gallery",
      type: "gallery",
      tags: ["culture"],
      lat: 50,
      lng: 14,
      chain: false,
      candidate_origin: "external_open",
    },
    {
      id: "chain-food",
      name: "Chain Food",
      type: "fast_food",
      tags: ["food"],
      lat: 50.0002,
      lng: 14.0002,
      chain: true,
      brand: "Chain Food",
      candidate_origin: "external_open",
    },
    {
      id: "chain-coffee",
      name: "Chain Coffee",
      type: "cafe",
      tags: ["coffee"],
      lat: 50.0003,
      lng: 14.0003,
      chain: true,
      brand: "Chain Coffee",
      candidate_origin: "external_open",
    },
    {
      id: "local-cafe",
      name: "Local Cafe",
      type: "cafe",
      tags: ["coffee"],
      lat: 50.0004,
      lng: 14.0004,
      chain: false,
      candidate_origin: "external_open",
    },
  ];

  const day = composeDistrictDay(candidates, {
    intents: ["culture", "food", "fika"],
    maxAreas: 1,
  });
  const ids = day.areas.flatMap((area) => area.stop_ids);

  assert.ok(ids.includes("local-gallery"));
  assert.ok(ids.includes("local-cafe"));
  assert.ok(ids.includes("chain-food"), "the only food evidence remains an honest sparse fallback");
  assert.ok(!ids.includes("chain-coffee"), "local coffee evidence suppresses the same-axis chain");
});

test("a chain-only district remains inspectable instead of becoming a fabricated empty", () => {
  const candidates = [
    { id: "chain-a", name: "Chain A", type: "restaurant", tags: ["food"], lat: 48, lng: 11, chain: true },
    { id: "chain-b", name: "Chain B", type: "cafe", tags: ["coffee"], lat: 48.0002, lng: 11.0002, chain: true },
    { id: "chain-c", name: "Chain C", type: "restaurant", tags: ["food"], lat: 48.0004, lng: 11.0004, chain: true },
  ];
  const day = composeDistrictDay(candidates, { intents: ["food", "fika"], maxAreas: 1 });

  assert.deepEqual(day.areas.flatMap((area) => area.stop_ids).sort(), ["chain-a", "chain-b", "chain-c"]);
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

// These regressions exercise the selected candidate surface, independently of
// the full place structure retained for diagnostics.
function denseSourceRows(specs) {
  return specs.map((spec, index) => ({
    id: `source-${index}`,
    name: `Source place ${index}`,
    lat: 50 + index * 0.00001,
    lng: 10,
    tags: [],
    ...spec,
  }));
}

test("second hand never publishes eleven unrelated cultural places as matches", () => {
  const candidates = denseSourceRows([
    ...Array.from({ length: 9 }, () => ({ type: "museum" })),
    { type: "gallery" }, { type: "castle" },
  ]);
  const day = composeDistrictDay(candidates, { candidateSurface: true, intents: ["second_hand"], maxAreas: 3 });
  assert.equal(day.structure.areas[0].size, 11, "the source-backed structure remains inspectable");
  assert.deepEqual(day.areas, [], "unrelated members are not selected matches");
  assert.deepEqual(day.legs, []);
  assert.deepEqual(day.covered_intents, []);
  assert.deepEqual(day.partial_intents, []);
  assert.deepEqual(day.missing_intents, ["second_hand"]);
});

test("a rare genuine vintage stop survives dominant type and tag summaries", () => {
  const candidates = denseSourceRows([
    ...Array.from({ length: 5 }, () => ({ type: "museum", tags: ["a", "b", "c", "d"] })),
    ...Array.from({ length: 4 }, () => ({ type: "gallery", tags: ["a", "b", "c", "d"] })),
    ...Array.from({ length: 3 }, () => ({ type: "castle", tags: ["a", "b", "c", "d"] })),
    { id: "rare-vintage", name: "Source-owned vintage", type: "vintage-shop", tags: ["second_hand"] },
  ]);
  const day = composeDistrictDay(candidates, { candidateSurface: true, intents: ["second_hand"] });
  assert.deepEqual(day.structure.areas[0].dominant_types, ["museum", "gallery", "castle"]);
  assert.deepEqual(day.structure.areas[0].dominant_intents, ["a", "b", "c", "d"]);
  assert.deepEqual(day.covered_intents, ["second_hand"]);
  assert.deepEqual(day.missing_intents, []);
  assert.deepEqual(day.areas[0].stop_ids, ["rare-vintage"]);
  assert.deepEqual(day.areas[0].stop_names, ["Source-owned vintage"]);
  assert.deepEqual(day.areas[0].stops.map(stop => stop.id), ["rare-vintage"]);
});

test("canonical second-hand aliases match source categories without inferring from names", () => {
  const candidates = denseSourceRows([
    { id: "thrift", type: "thrift-shop" },
    { id: "charity", type: "charity-shop" },
    { id: "antiques", type: "antiques-shop" },
    { id: "generic", name: "Vintage second hand museum cafe", type: "shop" },
  ]);
  const day = composeDistrictDay(candidates, { candidateSurface: true, intents: ["preloved"] });
  assert.deepEqual(day.covered_intents, ["second_hand"], "the established external axis is retained");
  assert.deepEqual(day.areas[0].stop_ids, ["antiques", "charity", "thrift"]);
  assert.deepEqual(day.areas[0].covers, ["second_hand"]);
  assert.deepEqual(day.missing_intents, []);
});

test("weak scenic places stay partial while a genuine viewpoint covers the same intent", () => {
  const parks = denseSourceRows(Array.from({ length: 3 }, () => ({ type: "park" })));
  const partial = composeDistrictDay(parks, { candidateSurface: true, intents: ["scenic"] });
  assert.deepEqual(partial.covered_intents, []);
  assert.deepEqual(partial.partial_intents, ["views"]);
  assert.deepEqual(partial.missing_intents, []);
  assert.deepEqual(partial.areas[0].covers, []);
  assert.deepEqual(partial.areas[0].partial_covers, ["views"]);

  const strong = composeDistrictDay([...parks, ...denseSourceRows([
    { id: "lookout", type: "viewpoint", lat: 50.03 },
    { id: "lookout-2", type: "viewpoint", lat: 50.03001 },
    { id: "lookout-3", type: "viewpoint", lat: 50.03002 },
  ])], { candidateSurface: true, intents: ["views"], maxAreas: 1 });
  assert.deepEqual(strong.covered_intents, ["views"]);
  assert.deepEqual(strong.partial_intents, []);
  assert.deepEqual(strong.areas[0].covers, ["views"]);
  assert.deepEqual(strong.areas[0].partial_covers, []);
  assert.ok(strong.areas[0].stop_ids.includes("lookout"), "strong evidence outranks the partial alternative");
});

test("a legitimate multifunction place can cover several requested preferences", () => {
  const candidates = denseSourceRows([
    { id: "multifunction", type: "museum", tags: ["second_hand", "panorama"] },
    { type: "shop" }, { type: "shop" },
  ]);
  const day = composeDistrictDay(candidates, { candidateSurface: true, intents: ["second hand", "culture", "utsikt"] });
  assert.deepEqual(day.covered_intents, ["second_hand", "culture", "views"]);
  assert.deepEqual(day.partial_intents, []);
  assert.deepEqual(day.missing_intents, []);
  assert.deepEqual(day.areas[0].stop_ids, ["multifunction"]);
});

test("no preferences retains varied source-backed candidates", () => {
  const candidates = denseSourceRows([{ type: "museum" }, { type: "cafe" }, { type: "vintage-shop" }]);
  const day = composeDistrictDay(candidates, { candidateSurface: true });
  assert.deepEqual(day.areas[0].stop_ids, ["source-0", "source-1", "source-2"]);
  assert.deepEqual(day.covered_intents, []);
  assert.deepEqual(day.missing_intents, []);
});


test("default district composition retains its legacy coverage and fallback contract", () => {
  const candidates = denseSourceRows(Array.from({ length: 3 }, () => ({ type: "gallery" })));
  const legacy = composeDistrictDay(candidates, { intents: ["culture"] });
  assert.deepEqual(legacy.covered_intents, ["culture"], "default callers keep the pre-existing broad culture policy");
  assert.deepEqual(legacy.areas[0].covers, ["culture"]);
  assert.equal("partial_intents" in legacy, false);
  assert.equal("partial_covers" in legacy.areas[0], false);
  const fallback = composeDistrictDay(candidates, { intents: ["second_hand"] });
  assert.deepEqual(fallback.areas[0].stop_ids, ["source-0", "source-1", "source-2"]);
  assert.deepEqual(fallback.missing_intents, ["second_hand"]);
});

test("the existing micro-base consumer keeps its legacy gallery anchor decision", () => {
  const { resolveWalkableMicroBase } = require("../server/planner/walkable-micro-base");
  const records = denseSourceRows(Array.from({ length: 3 }, (_, index) => ({
    type: "gallery", lat: 50.03 + index * 0.00001,
    sources: [{ provider: "fixture-map", family: "map", url: `https://example.test/gallery-${index}` }],
  })));
  const result = resolveWalkableMicroBase({ origin: { lat: 50, lng: 10 }, records,
    requestedIntents: ["culture"], anchorMode: "place" });
  assert.deepEqual(result.anchor, { lat: 50.03001, lng: 10 });
  assert.equal(result.summary?.mode, "trusted_candidate_cluster");
  assert.deepEqual(result.summary.covered_intents, ["culture"]);
  assert.equal(result.summary.cluster_candidate_count, 3);
});
