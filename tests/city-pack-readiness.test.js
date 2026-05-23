const assert = require("node:assert/strict");
const test = require("node:test");

const rome = require("../server/cities/rome");
const barcelona = require("../server/cities/barcelona");
const athens = require("../server/cities/athens");
const testCity = require("../server/cities/test-city");
const { inspectCityPack } = require("../server/city-readiness/inspect-city-pack");

test("inspectCityPack reports Rome as inspectable and not blocked", () => {
  const report = inspectCityPack(rome);

  assert.equal(report.city, "rome");
  assert.equal(report.label, "Rom");
  assert.notEqual(report.status, "blocked");
  assert.equal(report.support.city_page, true);
  assert.equal(report.support.pulse_baseline, true);
  assert.equal(report.catalog.item_count, rome.catalog.allItems.length);
  assert.ok(report.catalog.real_place_count > 0);
  assert.ok(report.catalog.route_template_count > 0);
  assert.ok(report.place_candidate_readiness);
  assert.equal(report.place_candidate_readiness.can_support_blitz, true);
});

test("inspectCityPack reports Barcelona without brittle catalog count assumptions", () => {
  const report = inspectCityPack(barcelona);

  assert.equal(report.city, "barcelona");
  assert.equal(report.label, "Barcelona");
  assert.equal(report.visibility, "preview");
  assert.notEqual(report.status, "blocked");
  assert.equal(report.support.city_page, true);
  assert.equal(report.support.pulse_baseline, true);
  assert.equal(report.catalog.item_count, barcelona.catalog.allItems.length);
  assert.ok(report.catalog.real_place_count > 0);
  assert.ok(report.catalog.area_token_count > 0);
  assert.ok(report.place_candidate_readiness);
});

test("inspectCityPack reports Athens preview skeleton as honest non-blocked starter city", () => {
  const report = inspectCityPack(athens);

  assert.equal(report.city, "athens");
  assert.equal(report.label, "Athens");
  assert.equal(report.visibility, "preview");
  assert.notEqual(report.status, "blocked");
  assert.equal(report.catalog.item_count, 0);
  assert.equal(report.catalog.real_place_count, 0);
  assert.equal(report.catalog.route_template_count, 0);
  assert.equal(report.support.city_page, true);
  assert.equal(report.support.pulse_baseline, true);
  assert.equal(report.support.blitz_baseline, false);
  assert.equal(report.support.planner_baseline, false);
  assert.ok(report.place_candidate_readiness);
  assert.equal(report.place_candidate_readiness.can_support_blitz, false);
  assert.equal(report.place_candidate_readiness.can_support_planner, false);
});

test("inspectCityPack reports test-city honestly without crashing", () => {
  const report = inspectCityPack(testCity);

  assert.equal(report.city, "test-city");
  assert.equal(report.visibility, "internal");
  assert.notEqual(report.status, "blocked");
  assert.equal(report.support.city_page, true);
  assert.equal(report.support.pulse_baseline, true);
  assert.equal(report.support.blitz_baseline, false);
  assert.equal(report.support.planner_baseline, false);
  assert.ok(
    report.warnings.place_candidate_readiness.includes("insufficient_real_places_for_blitz"),
  );
});

test("inspectCityPack blocks duplicate catalog ids", () => {
  const report = inspectCityPack(
    buildSyntheticCity({
      items: [
        buildPlace({ id: "duplicate-place" }),
        buildPlace({ id: "duplicate-place", name: "Duplicate Place 2" }),
      ],
    }),
  );

  assert.equal(report.status, "blocked");
  assert.deepEqual(report.catalog.issues.duplicate_ids, ["duplicate-place"]);
  assert.deepEqual(report.blocking_issues.duplicate_ids, ["duplicate-place"]);
});

test("inspectCityPack reports invalid area tokens as installability warnings", () => {
  const report = inspectCityPack(
    buildSyntheticCity({
      items: [buildPlace({ id: "bad-area", area: "missing-area" })],
    }),
  );

  assert.equal(report.status, "partial");
  assert.deepEqual(report.catalog.issues.invalid_area_tokens, [
    { id: "bad-area", area: "missing-area" },
  ]);
  assert.deepEqual(report.warnings.invalid_area_tokens, [
    { id: "bad-area", area: "missing-area" },
  ]);
});

test("inspectCityPack reports missing coordinates, search terms, and provenance", () => {
  const report = inspectCityPack(
    buildSyntheticCity({
      items: [
        buildPlace({
          id: "needs-cleanup",
          lat: null,
          lng: null,
          searchTerms: [],
        }),
      ],
      provenanceById: {},
    }),
  );

  assert.equal(report.status, "partial");
  assert.deepEqual(report.catalog.issues.missing_coordinates, ["needs-cleanup"]);
  assert.deepEqual(report.catalog.issues.missing_search_terms, ["needs-cleanup"]);
  assert.deepEqual(report.catalog.issues.missing_provenance, ["needs-cleanup"]);
  assert.ok(report.warnings.place_candidate_readiness.includes("no_coordinate_ready_real_places"));
});

test("inspectCityPack includes PlaceCandidate readiness diagnostics", () => {
  const report = inspectCityPack(
    buildSyntheticCity({
      items: Array.from({ length: 12 }, (_value, index) =>
        buildPlace({ id: `ready-place-${index}` }),
      ),
      routeTemplates: [
        {
          id: "synthetic-route",
          stops: ["ready-place-0", "ready-place-1", "ready-place-2", "ready-place-3"],
        },
      ],
    }),
  );

  assert.equal(report.place_candidate_readiness.real_place_count, 12);
  assert.equal(report.place_candidate_readiness.can_support_blitz, true);
  assert.equal(report.place_candidate_readiness.can_support_planner, false);
  assert.equal(report.support.blitz_baseline, true);
  assert.equal(report.support.planner_baseline, false);
});

function buildSyntheticCity({
  key = "synthetic-city",
  items,
  routeTemplates = [],
  provenanceById,
}) {
  return {
    key,
    label: "Synthetic City",
    visibility: "preview",
    timezone: "Europe/Stockholm",
    locale: "en-US",
    currency: "EUR",
    searchLabel: "Synthetic City",
    editorialAreaLabel: "Synthetic City",
    fallbackLabel: "Center",
    center: { lat: 59.3293, lng: 18.0686 },
    todayIsoDate: () => "2026-05-23",
    catalog: {
      allItems: items,
      routeTemplates,
      provenanceById,
      findItemByName(name) {
        return items.find((item) => item.name === name) || null;
      },
    },
    services: {
      geocodeQuery: async () => [],
      fetchWeatherForDates: async () => ({}),
      getCityPulse: () => ({ items: [], official_events: [], wildcards: [] }),
      getDateSignals: () => ({}),
      fetchLiveEventsForDates: async () => ({}),
    },
    walking: {
      defaultProvider: "heuristic",
      truthPassTopCandidates: 4,
      requestTimeoutMs: 3500,
    },
    routing: {
      areaDefinitions: {
        center: { label: "Center", macro: "center" },
      },
      macroAreaLabels: {
        center: "Center",
      },
      tuning: {},
    },
    localTruth: {
      calendar: [],
      rules: [],
    },
  };
}

function buildPlace({
  id = "synthetic-place",
  name = "Synthetic Place",
  kind = "cafe",
  lat = 59.3293,
  lng = 18.0686,
  area = "center",
  searchTerms = ["synthetic place"],
} = {}) {
  const place = {
    id,
    name,
    kind,
    area,
    tags: ["mat"],
    searchTerms,
  };

  if (lat !== undefined) place.lat = lat;
  if (lng !== undefined) place.lng = lng;

  return place;
}
