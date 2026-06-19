const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApp } = require("../server/app");
const {
  externalRecord,
  makeLoader,
  requestJson,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;
const DATE = "2026-05-25";
const FILL_FLAGS = "experimental_agnostic_route_output=1&agnostic_engine_compose=1&include_external_candidates=1&planner_inspect=1";

function withServer(openDataLoader, run) {
  return async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({ openDataLoader }).listen(0);
    try {
      await run(server);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  };
}

function routeBody(extra = {}) {
  return {
    city: "athens",
    dates: [DATE],
    include_external_candidates: 1,
    ...extra,
  };
}

function findRole(responseBody, role) {
  return responseBody.planner_roles.roles.find((entry) => entry.role === role);
}

test(
  "thin registered city can use trusted agnostic source-backed candidates as supplemental role fill",
  withServer(makeLoader([
    externalRecord("ath-ext-swim-1", "Central Athens Swim", "beach", 37.976, 23.725, ["swimming"]),
  ]), async (server) => {
    const response = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FILL_FLAGS}`,
      body: routeBody({ preferences: ["swimming"] }),
    });

    const fill = response.body.registered_city_candidate_fill;
    assert.equal(fill.used, true);
    assert.equal(fill.reason, "thin_registered_city_source_fill");
    assert.equal(fill.catalog_density, "thin");
    assert.deepEqual(fill.candidate_ids, ["ath-ext-swim-1"]);

    const swimming = findRole(response.body, "swimming_coast_option");
    assert.equal(swimming.status, "filled");
    assert.equal(swimming.requested, true);
    assert.equal(swimming.candidates[0].candidate_id, "ath-ext-swim-1");
    assert.equal(swimming.candidates[0].origin, "external_open");
    assert.equal(swimming.candidates[0].planner_usable, true);
    assert.equal(swimming.candidates[0].provenance.human_verified, false);
    assert.ok(swimming.candidates[0].attribution.length >= 1);
  }),
);

test(
  "curated Athens candidates remain ahead of comparable source-backed fill",
  withServer(makeLoader([
    externalRecord("ath-ext-cafe-1", "External Cafe", "cafe", 37.976, 23.725, ["coffee"]),
  ]), async (server) => {
    const response = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FILL_FLAGS}`,
      body: routeBody({ preferences: ["coffee"] }),
    });

    const fill = response.body.registered_city_candidate_fill;
    assert.equal(fill.used, false);
    assert.equal(fill.reason, "curated_candidates_satisfied_roles");

    const coffee = findRole(response.body, "coffee_fika_stop");
    assert.equal(coffee.status, "filled");
    assert.equal(coffee.candidates[0].origin, "curated_catalog");
    assert.notEqual(coffee.candidates[0].candidate_id, "ath-ext-cafe-1");
    assert.ok(
      coffee.candidates.some((candidate) => candidate.candidate_id === "ath-ext-cafe-1"),
      "external candidate may be visible in the reservoir, but not outrank curated fit",
    );
  }),
);

test(
  "rich registered citypacks do not activate registered-city agnostic fill",
  withServer(makeLoader([
    externalRecord("rome-ext-swim-1", "Rome Test Swim", "beach", 41.9, 12.49, ["swimming"]),
  ]), async (server) => {
    const response = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FILL_FLAGS}`,
      body: { city: "rome", dates: [DATE], preferences: ["swimming"], include_external_candidates: 1 },
    });

    assert.equal(response.body.registered_city_candidate_fill, undefined);
    assert.equal(response.body.city, "rome");
    assert.ok(Array.isArray(response.body.days));
  }),
);

test(
  "public payload cannot inject source-backed candidates into registered city fill",
  withServer(null, async (server) => {
    const response = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FILL_FLAGS}`,
      body: routeBody({
        preferences: ["swimming"],
        external_provider: {
          dataset: [
            externalRecord("evil-public-stop", "Payload Beach", "beach", 37.976, 23.725, ["swimming"]),
          ],
        },
        sourceCandidates: [
          { id: "evil-source-candidate", label: "Payload Source Candidate", lat: 37.976, lng: 23.725 },
        ],
      }),
    });

    const fill = response.body.registered_city_candidate_fill;
    assert.equal(fill.used, false);
    assert.equal(fill.reason, "no_trusted_external_provider");

    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes("evil-public-stop"), false);
    assert.equal(serialized.includes("evil-source-candidate"), false);
  }),
);
