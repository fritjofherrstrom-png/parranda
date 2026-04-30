const assert = require("node:assert/strict");
const test = require("node:test");

const { routeSimilarity } = require("../server/route-diversity");

function route(overrides = {}) {
  return {
    id: overrides.id || "route-a",
    route_shape: overrides.route_shape || "arc",
    start_label: overrides.start_label || "North Gate",
    end_label: overrides.end_label || "South Market",
    anchor_zone: overrides.anchor_zone || "riverfront",
    main_stops:
      overrides.main_stops ||
      [
        { id: "gallery-one" },
        { id: "market-two" },
      ],
    hidden_mentions: overrides.hidden_mentions || [],
    bar_mentions: overrides.bar_mentions || [],
    geo_profile: {
      area_tokens: ["riverfront", "old-town"],
      macros: ["north", "center"],
      dominant_macro: "center",
      ...(overrides.geo_profile || {}),
    },
  };
}

test("routeSimilarity kan jämföra fake city-profiler utan Rome tokens", () => {
  const first = route();
  const second = route({
    id: "route-b",
    main_stops: [{ id: "gallery-one" }, { id: "design-yard" }],
    geo_profile: {
      area_tokens: ["riverfront", "creative-quarter"],
      macros: ["north", "center"],
      dominant_macro: "center",
    },
  });

  assert.ok(routeSimilarity(first, second) > 0);
});

test("routeSimilarity ger högre score för överlappande stopp och geo-profil", () => {
  const baseline = route();
  const close = route({
    id: "close-route",
    main_stops: [{ id: "gallery-one" }, { id: "market-two" }],
    geo_profile: {
      area_tokens: ["riverfront", "old-town"],
      macros: ["north", "center"],
      dominant_macro: "center",
    },
  });
  const distant = route({
    id: "distant-route",
    start_label: "East Station",
    end_label: "Hill Garden",
    anchor_zone: "hill-garden",
    main_stops: [{ id: "harbor-view" }, { id: "hill-garden" }],
    geo_profile: {
      area_tokens: ["harbor", "hill-garden"],
      macros: ["east", "south"],
      dominant_macro: "south",
    },
  });

  assert.ok(routeSimilarity(baseline, close) > routeSimilarity(baseline, distant));
});

test("routeSimilarity håller unrelated fake city-rutter relativt lågt", () => {
  const north = route({
    id: "north-route",
    start_label: "North Gate",
    end_label: "River Pier",
    anchor_zone: "riverfront",
    main_stops: [{ id: "north-gallery" }, { id: "river-pier" }],
    geo_profile: {
      area_tokens: ["north-gate", "riverfront"],
      macros: ["north"],
      dominant_macro: "north",
    },
  });
  const south = route({
    id: "south-route",
    start_label: "South Market",
    end_label: "Harbor Yard",
    anchor_zone: "harbor",
    main_stops: [{ id: "south-market" }, { id: "harbor-yard" }],
    geo_profile: {
      area_tokens: ["south-market", "harbor"],
      macros: ["south"],
      dominant_macro: "south",
    },
  });

  assert.ok(routeSimilarity(north, south) < 3);
});
