const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateOperationalViability,
} = require("../server/place-candidates/operational-viability");
const {
  buildEligibleCandidatePool,
} = require("../server/candidates/candidate-pool");
const {
  selectPlannerRoleCandidates,
} = require("../server/planner/role-selector");
const {
  plannerUsableOptionsForRole,
} = require("../server/planner/candidate-combination");
const {
  admitExperimentalInferredExternalCandidate,
} = require("../server/planner/agnostic-route-output");
const {
  buildAgnosticCityContext,
} = require("../server/candidates/agnostic-context");
const {
  mapOsmElement,
} = require("../server/place-candidates/open-data-loader");

const DATE = "2026-07-20";
const ORIGIN = { lat: 59.3293, lng: 18.0686 };

function city() {
  return buildAgnosticCityContext({
    key: "agnostic-engine-area",
    label: "Resolved place",
    lat: ORIGIN.lat,
    lng: ORIGIN.lng,
    todayIsoDate: () => DATE,
  });
}

function source(id, overrides = {}) {
  return {
    id,
    name: id,
    type: "restaurant",
    lat: ORIGIN.lat,
    lng: ORIGIN.lng,
    tags: ["mat"],
    sources: [
      {
        provider: "osm",
        family: "map",
        tier: "inferred",
        url: `https://www.openstreetmap.org/node/${id}`,
      },
    ],
    ...overrides,
  };
}

function selectorHelpers(dataset) {
  return {
    resolveNowContext: () => ({
      date: DATE,
      hour: 13,
      weekday: 1,
      now_iso: `${DATE}T13:00:00Z`,
    }),
    resolveTimeBand: () => "midday",
    external_provider: { dataset },
    experimentalAdmitCandidate: admitExperimentalInferredExternalCandidate,
  };
}

test("operational viability separates hard inactivity, active evidence, and durable public space", () => {
  const inactive = evaluateOperationalViability({
    candidate: {
      type: "restaurant",
      operational_status: "inactive",
      operational_reasons: ["osm_lifecycle_disused"],
    },
  });
  assert.equal(inactive.route_eligible, false);
  assert.equal(inactive.status, "inactive");
  assert.ok(inactive.reasons.includes("osm_lifecycle_disused"));

  const sourceIndicated = evaluateOperationalViability({
    candidate: { type: "cafe", website: "https://cafe.example/" },
  });
  assert.equal(sourceIndicated.status, "source_indicated_active");
  assert.equal(sourceIndicated.route_eligible, true);

  const corroborated = evaluateOperationalViability({
    candidate: { type: "bar" },
    derived: { provenance_diversity: 2 },
  });
  assert.equal(corroborated.status, "corroborated_active");

  const park = evaluateOperationalViability({ candidate: { type: "park" } });
  assert.equal(park.status, "not_applicable");
  assert.equal(park.route_eligible, true);
});

test("hard lifecycle evidence is rejected before experimental admission", () => {
  const record = mapOsmElement({
    type: "node",
    id: 901,
    lat: ORIGIN.lat,
    lon: ORIGIN.lng,
    tags: {
      name: "Inactive fixture",
      amenity: "restaurant",
      abandoned: "yes",
    },
  });
  const pool = buildEligibleCandidatePool(
    city(),
    { include_external_candidates: 1, preferences: ["food"], origin: ORIGIN },
    selectorHelpers([record]),
  );

  assert.equal(record.operational_status, "inactive");
  assert.equal(pool.pool.some((entry) => entry.candidate.id === record.id), false);
  assert.deepEqual(
    pool.rejected.find((entry) => entry.id === record.id),
    {
      id: record.id,
      label: record.name,
      origin: "external_open",
      reason: "operational_place_inactive",
    },
  );
});

test("an explicit closed schedule is a hard fact even without loader-specific metadata", () => {
  const viability = evaluateOperationalViability({
    candidate: { type: "bar", opening_hours: "closed" },
  });

  assert.equal(viability.status, "inactive");
  assert.equal(viability.route_eligible, false);
  assert.ok(viability.reasons.includes("operational_schedule_explicitly_closed"));
});

test("source-indicated operational candidate outranks a closer unknown candidate", () => {
  const unknown = source("unknown-nearby");
  const active = source("active-farther", {
    lat: ORIGIN.lat + 0.01,
    lng: ORIGIN.lng + 0.01,
    opening_hours: "Mo-Su 10:00-22:00",
    operational_status: "source_indicated_active",
    operational_reasons: ["operational_opening_hours_present"],
  });
  const result = selectPlannerRoleCandidates(
    city(),
    {
      include_external_candidates: 1,
      preferences: ["food"],
      origin: ORIGIN,
    },
    selectorHelpers([unknown, active]),
  );
  const food = result.roles.find((role) => role.role === "food_anchor");

  assert.deepEqual(
    food.candidates.map((candidate) => candidate.candidate_id),
    ["active-farther", "unknown-nearby"],
  );
  assert.equal(food.candidates[0].operational_viability.status, "source_indicated_active");
  assert.equal(food.candidates[1].operational_viability.status, "unknown");
  assert.deepEqual(
    plannerUsableOptionsForRole(food).map((candidate) => candidate.candidate_id),
    ["active-farther"],
    "geometry composition must not reintroduce an unknown business when active evidence exists",
  );
});

test("a lone unknown operational candidate remains an honest sparse fallback", () => {
  const result = selectPlannerRoleCandidates(
    city(),
    { include_external_candidates: 1, preferences: ["food"], origin: ORIGIN },
    selectorHelpers([source("only-source-backed-option")]),
  );
  const food = result.roles.find((role) => role.role === "food_anchor");

  assert.equal(food.status, "partial");
  assert.equal(food.candidates[0].operational_viability.status, "unknown");
  assert.deepEqual(
    plannerUsableOptionsForRole(food).map((candidate) => candidate.candidate_id),
    ["only-source-backed-option"],
  );
});

test("public-looking operational fields do not alter trusted candidate viability", () => {
  const result = selectPlannerRoleCandidates(
    city(),
    {
      include_external_candidates: 1,
      preferences: ["food"],
      origin: ORIGIN,
      operational_status: "verified_active",
      operational_reasons: ["payload_claim"],
    },
    selectorHelpers([source("trusted-helper-record")]),
  );
  const food = result.roles.find((role) => role.role === "food_anchor");

  assert.equal(food.candidates[0].operational_viability.status, "unknown");
  assert.ok(!food.candidates[0].operational_viability.reasons.includes("payload_claim"));
});
