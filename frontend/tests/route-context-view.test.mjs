import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRouteContextSuggestions,
  routePreferenceCoverage,
  walkingDistanceLabel,
} from "../src/lib/route-context-view.mjs";

test("route context excludes route stops by stable id and normalized name", () => {
  const route = [
    { id: "route-a", name: "Monteliusvägen", lat: 59.32, lng: 18.05 },
    { id: "route-b", name: "Kafé 44", lat: 59.31, lng: 18.08 },
  ];
  const areas = [{
    stops: [
      { id: "route-a", name: "Duplicate by id", lat: 59.3201, lng: 18.0501 },
      { id: "other-id", name: "  monteliusvägen ", lat: 59.3202, lng: 18.0502 },
      { id: "context-a", name: "Mariaberget", lat: 59.319, lng: 18.051 },
    ],
  }];

  const result = buildRouteContextSuggestions(route, areas);
  assert.deepEqual(result.map((candidate) => candidate.id), ["context-a"]);
});

test("route context stays bounded, deterministic and at most one suggestion per route stop", () => {
  const route = [
    { id: "r1", name: "A", lat: 55.55, lng: 14.34 },
    { id: "r2", name: "B", lat: 55.56, lng: 14.36 },
    { id: "r3", name: "C", lat: 55.57, lng: 14.38 },
  ];
  const areas = [
    { daypart_hint: "morning", covers: ["culture"], stops: [
      { id: "farther-a", name: "Farther A", lat: 55.552, lng: 14.34 },
      { id: "near-a", name: "Near A", lat: 55.5502, lng: 14.34 },
    ] },
    { daypart_hint: "afternoon", covers: ["food"], stops: [
      { id: "near-b", name: "Near B", lat: 55.5602, lng: 14.36 },
      { id: "near-c", name: "Near C", lat: 55.5702, lng: 14.38 },
    ] },
  ];

  const result = buildRouteContextSuggestions(route, areas, { limit: 3 });
  assert.deepEqual(result.map((candidate) => candidate.id), ["near-a", "near-b", "near-c"]);
  assert.deepEqual(result.map((candidate) => candidate.route_stop_index), [0, 1, 2]);
  assert.equal(result[1].daypart_hint, "afternoon");
  assert.deepEqual(result[1].covers, ["food"]);
});

test("route context prefers source-backed local options over closer branded chains", () => {
  const route = [
    { id: "r1", name: "A", lat: 55.55, lng: 14.34 },
    { id: "r2", name: "B", lat: 55.56, lng: 14.36 },
    { id: "r3", name: "C", lat: 55.57, lng: 14.38 },
  ];
  const areas = [{ stops: [
    { id: "chain-nearest", name: "Branded Food", lat: 55.5501, lng: 14.34, chain: true, brand: "Brand" },
    { id: "local-a", name: "Local Food", lat: 55.551, lng: 14.34, chain: false },
    { id: "chain-b", name: "Branded Coffee", lat: 55.5601, lng: 14.36, chain: true, brand: "Brand" },
    { id: "local-c", name: "Local Shop", lat: 55.5705, lng: 14.38, chain: false },
  ] }];

  const result = buildRouteContextSuggestions(route, areas, { limit: 2 });
  assert.deepEqual(result.map((candidate) => candidate.id), ["local-a", "local-c"]);
  assert.deepEqual(result.map((candidate) => candidate.route_stop_index), [0, 2]);
});

test("route context keeps a chain as a sparse fallback when no local option exists", () => {
  const route = [{ id: "r1", name: "A", lat: 55.55, lng: 14.34 }];
  const areas = [{ stops: [
    { id: "only-nearby", name: "Branded Food", lat: 55.5501, lng: 14.34, chain: true, brand: "Brand" },
  ] }];

  const result = buildRouteContextSuggestions(route, areas, { limit: 3 });
  assert.deepEqual(result.map((candidate) => candidate.id), ["only-nearby"]);
  assert.equal(result[0].chain, true);
});

test("explicit candidate-spine local-feel rank is reused without name-based rules", () => {
  const route = [{ id: "r1", name: "A", lat: 55.55, lng: 14.34 }];
  const areas = [{ stops: [
    { id: "rank-two", name: "First", lat: 55.5501, lng: 14.34, local_feel_rank: 2 },
    { id: "rank-zero", name: "Second", lat: 55.551, lng: 14.34, local_feel_rank: 0 },
  ] }];

  assert.deepEqual(
    buildRouteContextSuggestions(route, areas, { limit: 1 }).map((candidate) => candidate.id),
    ["rank-zero"],
  );
});

test("route context rejects distant candidates and never mutates route or area inputs", () => {
  const route = [{ id: "r1", name: "A", lat: 55.55, lng: 14.34 }];
  const areas = [{ stops: [{ id: "distant", name: "Distant", lat: 55.9, lng: 14.9 }] }];
  const routeBefore = structuredClone(route);
  const areasBefore = structuredClone(areas);

  assert.deepEqual(buildRouteContextSuggestions(route, areas, { maxDistanceKm: 1 }), []);
  assert.deepEqual(route, routeBefore);
  assert.deepEqual(areas, areasBefore);
});

test("walking distances never render a broken zero-kilometre leg", () => {
  assert.equal(walkingDistanceLabel(0.04, "sv"), "< 0,1 km");
  assert.equal(walkingDistanceLabel(0, "en"), "< 0.1 km");
  assert.equal(walkingDistanceLabel(0.84, "sv"), "0,8 km");
  assert.equal(walkingDistanceLabel(1.26, "en"), "1.3 km");
  assert.equal(walkingDistanceLabel(null, "sv"), "");
});

test("composed-route coverage uses route stop evidence and normalizes planner aliases", () => {
  const coverage = routePreferenceCoverage(
    [
      { covered_preferences: ["scenic"] },
      { covered_preferences: ["food", "bars", "museums"] },
    ],
    ["views", "food", "nightlife", "culture", "green"],
  );

  assert.equal(coverage.has_coverage_evidence, true);
  assert.deepEqual(coverage.covered_preferences, ["views", "food", "nightlife", "culture"]);
  assert.deepEqual(coverage.missing_preferences, ["green"]);
});

test("missing route metadata is unknown rather than fabricated missing coverage", () => {
  assert.deepEqual(routePreferenceCoverage([{ id: "route-a" }], ["food", "views"]), {
    has_coverage_evidence: false,
    covered_preferences: [],
    missing_preferences: [],
  });
});
