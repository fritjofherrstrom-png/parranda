const assert = require("node:assert/strict");
const test = require("node:test");

const { buildCandidateBlitzDecision } = require("../server/candidates/blitz-candidate-mode");
const { buildEligibleCandidatePool } = require("../server/candidates/candidate-pool");
const { buildAgnosticCityContext } = require("../server/candidates/agnostic-context");
const {
  ROLE_SPEC,
  selectPlannerRoleCandidates,
} = require("../server/planner/role-selector");

const DATE = "2026-06-03";

const TWO_FAMILIES = [
  { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/1" },
  { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: "https://www.wikidata.org/wiki/Q1" },
];
const OFFICIAL_TWO_FAMILIES = [
  { provider: "official", family: "official", tier: "official", url: "https://example.test/official" },
  { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: "https://www.wikidata.org/wiki/Q2" },
];
const SINGLE_FAMILY = [
  { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/weak" },
];

function city(items = []) {
  return {
    key: "role-test",
    label: "Role Test",
    timezone: "Europe/Rome",
    center: { lat: 41.9, lng: 12.49 },
    catalog: { allItems: items, routeTemplates: [] },
    routing: { areaDefinitions: {} },
    todayIsoDate: () => DATE,
  };
}

function item(overrides = {}) {
  return {
    id: "curated-view",
    name: "Curated View",
    kind: "viewpoint",
    lat: 41.9,
    lng: 12.49,
    tags: ["utsikt"],
    time_fit: [],
    ...overrides,
  };
}

function record(id, name, type, lat, lng, { tags = [], sources = TWO_FAMILIES, time_fit = [] } = {}) {
  return { id, name, type, lat, lng, tags, sources, time_fit };
}

function loaderOf(records) {
  return () => records.map((entry) => ({ ...entry }));
}

function decide(cityConfig, payload = {}, records = []) {
  return selectPlannerRoleCandidates(
    cityConfig,
    {
      date: DATE,
      include_external_candidates: records.length ? 1 : undefined,
      ...payload,
    },
    records.length ? { external_provider: { dataset: loaderOf(records) } } : {},
  );
}

function role(out, roleName) {
  const found = out.roles.find((entry) => entry.role === roleName);
  assert.ok(found, `missing role ${roleName}`);
  return found;
}

test("role selector always returns the full v0 role spec and marks requested roles only", () => {
  const out = decide(city([item({ kind: "restaurant", tags: ["mat"] })]), {
    preferences: ["food"],
  });
  assert.deepEqual(out.roles.map((entry) => entry.role), Object.keys(ROLE_SPEC));
  assert.equal(role(out, "food_anchor").requested, true);
  assert.equal(role(out, "scenic_anchor").requested, false);
});

test("shared pool extraction preserves Blitz candidate-mode behavior and helper-only external injection", () => {
  const thin = city([]);
  const records = [
    record("external-food", "External Food", "restaurant", 41.901, 12.491, {
      tags: ["mat"],
      sources: TWO_FAMILIES,
    }),
  ];
  const payload = { candidate_mode: 1, include_external_candidates: 1, date: DATE, preferences: ["food"] };

  const pool = buildEligibleCandidatePool(thin, payload, {
    external_provider: { dataset: loaderOf(records) },
  });
  assert.equal(pool.density, "absent");
  assert.equal(pool.context.lens, null);
  assert.equal(pool.providerSpecs.length, 2);
  assert.equal(pool.pool.length, 1);

  const withoutTrustedHelper = buildCandidateBlitzDecision(thin, payload);
  assert.equal(withoutTrustedHelper.best_move, null);
  assert.equal(withoutTrustedHelper.reason, "no_candidates");
});

test("anchor roles require may_anchor_route; medium external scenic is partial, not filled", () => {
  const out = decide(
    city([]),
    { preferences: ["scenic"] },
    [
      record("medium-view", "Medium View", "viewpoint", 41.9, 12.49, {
        tags: ["utsikt"],
        sources: TWO_FAMILIES,
      }),
    ],
  );
  const scenic = role(out, "scenic_anchor");
  assert.equal(scenic.status, "partial");
  assert.equal(scenic.planner_usable, true);
  assert.equal(scenic.candidates[0].candidate_status, "partial");
  assert.equal(scenic.candidates[0].gates.may_influence_routes, true);
  assert.equal(scenic.candidates[0].gates.may_anchor_route, false);
});

test("stop/option roles can be filled with may_influence_routes", () => {
  const out = decide(
    city([]),
    { preferences: ["coffee"] },
    [
      record("coffee", "Good Coffee", "cafe", 41.9, 12.49, {
        tags: ["coffee", "fika"],
        sources: TWO_FAMILIES,
      }),
    ],
  );
  const coffee = role(out, "coffee_fika_stop");
  assert.equal(coffee.status, "filled");
  assert.equal(coffee.candidates[0].candidate_status, "filled");
  assert.equal(coffee.candidates[0].planner_usable, true);
  assert.equal(coffee.candidates[0].coordinates.lat, 41.9);
});

test("filled status outranks a higher-fit partial candidate for anchor roles", () => {
  const out = decide(
    city([
      item({
        id: "curated-view",
        name: "Quiet Curated View",
        lat: 41.9,
        lng: 12.49,
        tags: ["utsikt"],
      }),
    ]),
    {
      preferences: ["scenic"],
      now: `${DATE}T19:30:00`,
    },
    [
      record("external-golden-view", "External Golden View", "viewpoint", 41.901, 12.491, {
        tags: ["utsikt"],
        time_fit: ["evening"],
        sources: TWO_FAMILIES,
      }),
    ],
  );
  const scenic = role(out, "scenic_anchor");
  assert.equal(scenic.status, "filled");
  assert.equal(scenic.candidates[0].candidate_id, "curated-view");
  assert.equal(scenic.candidates[0].candidate_status, "filled");
  assert.equal(scenic.candidates[1].candidate_id, "external-golden-view");
  assert.equal(scenic.candidates[1].candidate_status, "partial");
});

test("curated candidates win over comparable external candidates through reused ranking", () => {
  const out = decide(
    city([item({ id: "curated-food", name: "Curated Food", kind: "restaurant", tags: ["mat"] })]),
    { preferences: ["food"] },
    [
      record("external-food", "External Food", "restaurant", 41.901, 12.491, {
        tags: ["mat"],
        sources: OFFICIAL_TWO_FAMILIES,
      }),
    ],
  );
  const food = role(out, "food_anchor");
  assert.equal(food.status, "filled");
  assert.equal(food.candidates[0].origin, "curated_catalog");
});

test("external gap-fill preserves provenance, confidence, and attribution", () => {
  const out = decide(
    city([]),
    { preferences: ["swimming"] },
    [
      record("beach", "Open Beach", "beach", 41.88, 12.5, {
        tags: ["coast"],
        sources: TWO_FAMILIES,
      }),
    ],
  );
  const swim = role(out, "swimming_coast_option");
  assert.equal(swim.status, "filled");
  assert.equal(swim.candidates[0].origin, "external_open");
  assert.equal(swim.candidates[0].confidence, "medium");
  assert.ok(swim.candidates[0].attribution.some((entry) => entry.source_family === "map"));
});

test("dedupe and reconciliation carry through to planner-facing candidates", () => {
  const out = decide(
    city([
      item({
        id: "coordless-view",
        name: "Coordless View",
        lat: undefined,
        lng: undefined,
        wikidata: "Q100",
      }),
    ]),
    { preferences: ["scenic"] },
    [
      record("external-view", "Coordless View", "viewpoint", 41.91, 12.51, {
        tags: ["utsikt"],
        sources: [
          { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/100" },
          { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: "https://www.wikidata.org/wiki/Q100" },
        ],
      }),
    ],
  );
  const scenic = role(out, "scenic_anchor");
  assert.equal(scenic.candidates[0].candidate_id, "coordless-view");
  assert.deepEqual(scenic.candidates[0].reconciliation.filled, ["coordinates"]);
  assert.equal(scenic.candidates[0].coordinates.lat, 41.91);
});

test("lens and optional anchor are carried into role ranking without route sequencing", () => {
  const localOut = decide(
    city([
      item({ id: "classic", name: "Classic View", tags: ["utsikt", "classic"], lat: 41.9, lng: 12.49 }),
      item({ id: "local", name: "Local View", tags: ["utsikt", "local"], lat: 41.901, lng: 12.491 }),
    ]),
    { preferences: ["scenic"], lens: "local" },
  );
  assert.equal(role(localOut, "scenic_anchor").candidates[0].candidate_id, "local");
  assert.ok(role(localOut, "scenic_anchor").candidates[0].lens_reasons.includes("lens_local_neighborhood"));

  const nearOut = decide(
    city([
      item({ id: "far-food", name: "Far Food", kind: "restaurant", tags: ["mat"], lat: 42.1, lng: 12.7 }),
      item({ id: "near-food", name: "Near Food", kind: "restaurant", tags: ["mat"], lat: 41.9001, lng: 12.4901 }),
    ]),
    { preferences: ["food"], anchor: { lat: 41.9, lng: 12.49, label: "anchor" } },
  );
  assert.equal(role(nearOut, "food_anchor").candidates[0].candidate_id, "near-food");
});

test("cross-role overlap is candidate-level and coffee is not automatically a full food anchor", () => {
  const out = decide(
    city([
      item({
        id: "rooftop",
        name: "Rooftop Bar",
        kind: "rooftop-bar",
        tags: ["utsikt", "vin", "cocktail"],
      }),
      item({
        id: "coffee",
        name: "Coffee Place",
        kind: "cafe",
        tags: ["coffee", "fika"],
      }),
    ]),
    { preferences: ["bars", "scenic", "coffee", "food"] },
  );
  const barCandidate = role(out, "evening_bar_option").candidates.find((entry) => entry.candidate_id === "rooftop");
  assert.ok(barCandidate.also_covers.some((entry) => entry.role === "scenic_anchor"));

  const coffee = role(out, "coffee_fika_stop");
  assert.equal(coffee.status, "filled");
  assert.equal(coffee.candidates[0].candidate_id, "coffee");

  const foodCandidate = role(out, "food_anchor").candidates.find((entry) => entry.candidate_id === "coffee");
  assert.equal(foodCandidate.candidate_status, "partial");
});

test("sparse and agnostic contexts remain honest about missing roles", () => {
  const sparse = decide(
    city([]),
    { preferences: ["scenic"] },
    [
      record("view", "Open View", "viewpoint", 41.9, 12.49, {
        tags: ["utsikt"],
        sources: TWO_FAMILIES,
      }),
    ],
  );
  assert.equal(role(sparse, "scenic_anchor").status, "partial");
  assert.equal(role(sparse, "food_anchor").status, "missing");
  assert.equal(role(sparse, "food_anchor").candidates.length, 0);
  assert.equal(role(sparse, "coffee_fika_stop").status, "missing");
  assert.equal(role(sparse, "coffee_fika_stop").candidates.length, 0);

  const agnostic = buildAgnosticCityContext({ lat: 55.6, lng: 13.0, todayIsoDate: () => DATE });
  const agnosticOut = decide(
    agnostic,
    { preferences: ["food"] },
    [
      record("agnostic-food", "Agnostic Food", "restaurant", 55.6, 13.0, {
        tags: ["mat"],
        sources: TWO_FAMILIES,
      }),
    ],
  );
  assert.equal(agnosticOut.density, "absent");
  assert.equal(role(agnosticOut, "food_anchor").status, "partial");
  assert.equal(role(agnosticOut, "scenic_anchor").status, "missing");
  assert.equal(role(agnosticOut, "scenic_anchor").candidates.length, 0);
});

test("roles with no relevant candidates stay missing instead of fallback", () => {
  const out = decide(
    city([
      item({
        id: "church",
        name: "Church Stop",
        kind: "church",
        tags: ["kultur"],
      }),
      item({
        id: "market",
        name: "Market Stop",
        kind: "market",
        tags: ["marknad"],
      }),
    ]),
    { preferences: ["swimming"] },
  );

  const swim = role(out, "swimming_coast_option");
  assert.equal(swim.status, "missing");
  assert.equal(swim.candidates.length, 0);
});

test("weak, popularity-only, and structural candidates do not fill user-facing roles", () => {
  const out = decide(
    city([
      item({
        id: "structural",
        name: "Structural District",
        kind: "district-group",
        structuralRouteAnchor: true,
        tags: ["utsikt"],
      }),
    ]),
    { preferences: ["bars"] },
    [
      record("weak-bar", "Weak Bar", "bar", 41.9, 12.49, {
        tags: ["nattliv"],
        sources: SINGLE_FAMILY,
      }),
      {
        ...record("hyped-bar", "Hyped Bar", "bar", 41.91, 12.5, {
          tags: ["nattliv"],
          sources: SINGLE_FAMILY,
        }),
        popularity: { count: 99999, rating: 4.9 },
      },
    ],
  );
  const evening = role(out, "evening_bar_option");
  assert.equal(evening.status, "missing");
  assert.equal(evening.candidates.length, 0);
});
