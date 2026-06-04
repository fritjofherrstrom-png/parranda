const assert = require("node:assert/strict");
const test = require("node:test");

const { buildEligibleCandidatePool } = require("../server/candidates/candidate-pool");
const { selectPlannerRoleCandidates } = require("../server/planner/role-selector");

const DATE = "2026-06-03";
const TWO_FAMILIES = [
  { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/1" },
  { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: "https://www.wikidata.org/wiki/Q1" },
];

function city(items = []) {
  return {
    key: "public-injection-test",
    label: "Public Injection Test",
    timezone: "Europe/Rome",
    center: { lat: 41.9, lng: 12.49 },
    catalog: { allItems: items, routeTemplates: [] },
    routing: { areaDefinitions: {} },
    todayIsoDate: () => DATE,
  };
}

function record(id, name, type, lat, lng, { tags = [], sources = TWO_FAMILIES } = {}) {
  return { id, name, type, lat, lng, tags, sources };
}

function loaderOf(records) {
  return () => records.map((entry) => ({ ...entry }));
}

function role(out, roleName) {
  const found = out.roles.find((entry) => entry.role === roleName);
  assert.ok(found, `missing role ${roleName}`);
  return found;
}

test("public-looking payload.external_provider is ignored while trusted helpers.external_provider works", () => {
  const thin = city([]);
  const records = [
    record("external-food", "External Food", "restaurant", 41.901, 12.491, {
      tags: ["mat"],
      sources: TWO_FAMILIES,
    }),
  ];
  const payload = {
    date: DATE,
    include_external_candidates: 1,
    preferences: ["food"],
    // Public callers must not be able to smuggle loader/dataset injection through
    // the payload shape. Only the trusted third helpers argument may carry this.
    external_provider: { dataset: loaderOf(records) },
  };

  const publicPool = buildEligibleCandidatePool(thin, payload);
  assert.equal(publicPool.providerSpecs.length, 2);
  assert.equal(publicPool.pool.length, 0);

  const publicOut = selectPlannerRoleCandidates(thin, payload);
  assert.equal(role(publicOut, "food_anchor").status, "missing");
  assert.equal(role(publicOut, "food_anchor").candidates.length, 0);

  const trustedHelpers = { external_provider: { dataset: loaderOf(records) } };
  const trustedPool = buildEligibleCandidatePool(thin, payload, trustedHelpers);
  assert.equal(trustedPool.pool.length, 1);

  const trustedOut = selectPlannerRoleCandidates(thin, payload, trustedHelpers);
  assert.equal(role(trustedOut, "food_anchor").status, "partial");
  assert.equal(role(trustedOut, "food_anchor").candidates[0].candidate_id, "external-food");
});
