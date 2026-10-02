"use strict";

/**
 * A second-hand stop says what its source says it is.
 *
 * Pi QA on a Göteborg `second_hand` day published a used retro-games shop and
 * a mixed antiques hall under one broad route type, and the English card chip
 * read "Vintage" for both. The route type stays broad (both are legitimate
 * second-hand stops); the stop now carries the source's own narrower category
 * from a closed set, derived from the loader's source-category tags and never
 * from a name, and anything else stays the broad "second hand".
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { mapOsmElement } = require("../server/place-candidates/open-data-loader");
const { categoryMapping } = require("../server/place-candidates/overture-source");
const { selectPlannerRoleCandidates } = require("../server/planner/role-selector");
const { mapAdmittedSelectionToSourceCandidates } = require("../server/planner/agnostic-engine-compose");
const { buildApp } = require("../server/app");
const { mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const DATE = "2026-06-03";
const ORIGIN = { lat: 57.707, lng: 11.967 };

function osm(id, shop, offset) {
  return mapOsmElement({
    type: "node",
    id,
    lat: ORIGIN.lat + offset,
    lon: ORIGIN.lng,
    // A Wikidata link gives the record a second family, as a real map record
    // can carry; it has no bearing on the category.
    tags: { name: `Shop ${id}`, shop, wikidata: `Q${id}` },
  });
}

function overture(id, category, offset) {
  const mapping = categoryMapping(category);
  return {
    id: `overture-${id}`,
    name: `Directory ${id}`,
    type: mapping.type,
    lat: ORIGIN.lat,
    lng: ORIGIN.lng + offset,
    tags: [...mapping.tags],
    sources: [
      { provider: "overture", family: "open_directory", tier: "inferred", url: "https://docs.overturemaps.org/attribution" },
      { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: `https://www.wikidata.org/wiki/Q9${id}` },
    ],
  };
}

const OSM_RECORDS = [
  osm(101, "antiques", 0.001),
  osm(102, "charity", 0.002),
  osm(103, "vintage", 0.003),
  osm(104, "second_hand", 0.004),
];
const DIRECTORY_RECORDS = [
  overture("0f7a1c2e-4b3d-4e5f-8a9b-0c1d2e3f4a5b", "antique_store", 0.001),
  overture("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "second_hand_store", 0.002),
];

function cityConfig() {
  return {
    key: "source-category-test",
    label: "Source Category Test",
    timezone: "Europe/Stockholm",
    center: ORIGIN,
    catalog: { allItems: [], routeTemplates: [] },
    routing: { areaDefinitions: {} },
    todayIsoDate: () => DATE,
  };
}

function secondHandRole({ experiment, records = OSM_RECORDS }) {
  const out = selectPlannerRoleCandidates(
    cityConfig(),
    { date: DATE, preferences: ["second_hand"], include_external_candidates: 1, origin: ORIGIN, limitPerRole: 5 },
    {
      external_provider: { dataset: () => records.map((record) => ({ ...record, tags: [...record.tags] })) },
      ...(experiment ? { experimentalAdmitCandidate: () => ({ allowed: true, policy: "test_admission" }) } : {}),
    },
  );
  return out.roles.find((role) => role.role === "vintage_second_hand_option");
}

test("the any-place role surface names each second-hand stop by its source's own category", () => {
  const categories = (records) => Object.fromEntries(secondHandRole({ experiment: true, records }).candidates
    .map((candidate) => [candidate.candidate_id, candidate.source_category]));
  const byId = { ...categories(OSM_RECORDS), ...categories(DIRECTORY_RECORDS) };
  assert.equal(byId["osm-node-101"], "antiques", "OSM shop=antiques");
  assert.equal(byId["osm-node-102"], "charity", "OSM shop=charity");
  assert.equal(byId["osm-node-103"], "vintage", "OSM shop=vintage");
  assert.equal(byId["osm-node-104"], "second_hand", "OSM shop=second_hand stays broad");
  assert.equal(byId["overture-0f7a1c2e-4b3d-4e5f-8a9b-0c1d2e3f4a5b"], "antiques", "Overture antique_store");
  assert.equal(byId["overture-1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"], "second_hand", "Overture second_hand_store stays broad");
});

test("default and citypack role payloads are unchanged", () => {
  const role = secondHandRole({ experiment: false });
  assert.ok(role.candidates.length > 0);
  assert.ok(role.candidates.every((candidate) => !("source_category" in candidate)));
});

test("the published stop carries the category on its source, and only from the closed set", () => {
  const rich = (id, category) => ({
    candidate_id: id,
    label: id,
    type: "vintage-shop",
    confidence: "needs_review",
    coordinates: { lat: ORIGIN.lat, lng: ORIGIN.lng },
    provenance: { source_family: "map", source_tier: "inferred", attribution: [{ label: "osm", url: "https://osm.org/node/1" }] },
    ...(category === undefined ? {} : { source_category: category }),
  });
  const plannerRoles = {
    roles: [{
      role: "vintage_second_hand_option",
      slot: "option",
      candidates: [rich("a", "antiques"), rich("b", "clothing vintage!"), rich("c")],
    }],
  };
  const selected = ["a", "b", "c"].map((id) => ({ role: "vintage_second_hand_option", candidate_id: id, coordinates: { lat: ORIGIN.lat, lng: ORIGIN.lng } }));
  const [antiques, injected, broad] = mapAdmittedSelectionToSourceCandidates({ selected, plannerRoles });
  assert.equal(antiques.source.category, "antiques");
  assert.equal("category" in injected.source, false, "an unknown category token is dropped, never rendered");
  assert.equal("category" in broad.source, false);
});

test("a published any-place second-hand day names each stop's source category", async (t) => {
  const place = (id, tags, dLat, dLng) => mapOsmElement({
    type: "node", id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lng + dLng, tags: { name: `Place ${id}`, wikidata: `Q${id}`, ...tags },
  });
  const records = [
    place(201, { shop: "antiques" }, 0.004, 0),
    place(202, { shop: "second_hand" }, -0.006, 0.004),
    place(203, { amenity: "cafe" }, 0.001, 0.002),
    place(204, { amenity: "restaurant" }, -0.002, -0.003),
    place(205, { leisure: "park" }, 0.008, -0.004),
    place(206, { tourism: "museum" }, -0.004, 0.009),
  ];
  const originalFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({
    openDataLoader: async () => records.map((record) => ({ ...record, tags: [...record.tags] })),
    placeResolver: null, eventSupply: null, reviewedPlaceSource: null, sourceCatalog: null,
  }).listen(0);
  t.after(async () => {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  });
  const body = JSON.stringify({
    ...ORIGIN,
    dates: ["2026-10-01"],
    preferences: ["second_hand"],
    walking_km_target: 6,
    include_external_candidates: 1,
    experimental_agnostic_route_output: 1,
    agnostic_engine_compose: 1,
  });
  const response = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1", port: server.address().port, path: "/api/route-recommendations?lang=en", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve(JSON.parse(raw)));
    });
    request.on("error", reject);
    request.end(body);
  });
  const stops = response.days?.[0]?.primary_route?.main_stops || [];
  const secondHand = Object.fromEntries(stops.filter((stop) => stop.type === "vintage-shop").map((stop) => [stop.id, stop.source?.category]));
  assert.deepEqual(secondHand, { "osm-node-201": "antiques", "osm-node-202": "second_hand" });
  assert.ok(stops.filter((stop) => stop.type !== "vintage-shop").every((stop) => !("category" in (stop.source || {}))),
    "only the broad second-hand type carries a category");
  assert.ok(stops.every((stop) => !stop.selected_day_hours), "no hours were invented for places whose source has none");
});
