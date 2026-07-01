/**
 * place_structure wiring — the route response carries the agnostic district
 * intelligence (structure + composed district day) ADDITIVELY, without mutating
 * the route. Deterministic: derived from the city's curated candidate pool, no
 * network (no loader injected).
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApp } = require("../server/app");
const { requestJson, mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;

function withServer(run) {
  return async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp().listen(0); // no loader → pure curated candidate pool
    try {
      await run(server);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  };
}

test(
  "a recognized-city route carries place_structure (districts + district day) AND the route is unchanged",
  withServer(async (server) => {
    const response = await requestJson(server, {
      path: "/api/route-recommendations?lang=en",
      body: { city: "rome", dates: ["2026-06-23"], preferences: ["scenic", "food"] },
    });
    // The route itself is still a real route (additive field, no mutation).
    assert.ok(response.body.days && response.body.days[0] && response.body.days[0].primary_route, "primary route present");
    // place_structure is attached and well-formed.
    const ps = response.body.place_structure;
    assert.ok(ps, "place_structure attached");
    assert.ok(ps.area_count >= 1, "at least one district derived from the candidate pool");
    assert.ok(Array.isArray(ps.areas) && ps.areas.length === ps.area_count);
    // The composed district day reports coverage honestly (arrays always present).
    assert.ok(Array.isArray(ps.district_day.covered_intents));
    assert.ok(Array.isArray(ps.district_day.missing_intents));
    assert.ok(Array.isArray(ps.district_day.areas));
    // Output is data (ids/tokens/numbers), never prose: each area has a center + member stops.
    for (const area of ps.district_day.areas) {
      assert.ok(area.center && Number.isFinite(area.center.lat) && Number.isFinite(area.center.lng));
      assert.ok(Array.isArray(area.stop_ids));
    }
  }),
);

test(
  "place_structure never breaks the route — a city with too few placed candidates simply omits it",
  withServer(async (server) => {
    // A nonsense/empty city falls back; the response must still be valid and must
    // not throw, with place_structure simply absent rather than fabricated.
    const response = await requestJson(server, {
      path: "/api/route-recommendations?lang=en",
      body: { city: "nowhere-unknown-xyz", dates: ["2026-06-23"], preferences: ["food"] },
    });
    assert.equal(response.status, 200);
    assert.ok(response.body, "response body present");
    // HONESTY: an unknown city falls back to a default city's catalogue, but the
    // response must NOT present that fallback city's districts as the typed place.
    // The recognized-city structure is gated to genuinely recognized cities; the
    // agnostic path (not exercised here — no loader) supplies the real one or none.
    assert.notEqual(
      response.body.place_structure && response.body.place_structure.provenance,
      "recognized_city",
      "a fallback city must never masquerade as the typed place's structure",
    );
  }),
);
