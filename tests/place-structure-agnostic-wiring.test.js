/**
 * place_structure on the AGNOSTIC (any-city) path — the real arc: type a city we
 * have NO citypack for → its districts are derived + a day composed across them →
 * delivered on the route response. Generic, deterministic, no city-specific code:
 * the candidates come from an injected loader (stands in for live OSM/Wikidata),
 * the place is coordinates-only with NO recognized city, and the same
 * `place_structure` field/shape is used as on the recognized-city path.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { buildApp } = require("../server/app");
const { externalRecord, makeLoader, mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;
const FLAG = "experimental_agnostic_route_output=1&include_external_candidates=1";

function post(server, body) {
  const { port } = server.address();
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(JSON.parse(d)));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Two real districts ~1.3 km apart, no citypack: a food quarter and a viewpoint
// cluster. Each cluster's members sit within a walking link of one another.
function twoDistrictAnyCity() {
  return [
    externalRecord("f1", "Taverna A", "restaurant", 40.0000, -3.0000, ["food", "restaurant"]),
    externalRecord("f2", "Taverna B", "restaurant", 40.0006, -3.0000, ["food", "restaurant"]),
    externalRecord("f3", "Taverna C", "restaurant", 40.0000, -3.0006, ["food", "restaurant"]),
    externalRecord("v1", "Mirador A", "viewpoint", 40.0117, -3.0000, ["views", "viewpoint"]),
    externalRecord("v2", "Mirador B", "viewpoint", 40.0123, -3.0000, ["views", "viewpoint"]),
    externalRecord("v3", "Mirador C", "viewpoint", 40.0117, -3.0006, ["views", "viewpoint"]),
  ];
}

async function withServer(openDataLoader, run) {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader }).listen(0);
  try {
    return await run(server);
  } finally {
    await new Promise((r) => server.close(r));
    global.fetch = ORIGINAL_FETCH;
  }
}

test("an unknown city (coords only, NO citypack) gets place_structure with districts + a composed day", async () => {
  await withServer(makeLoader(twoDistrictAnyCity()), async (server) => {
    const body = {
      city: "nowhere-uncharted-xyz", // not a recognized city → the agnostic path
      lat: 40.006, // trusted coord intake (body.lat/lng), no citypack
      lng: -3.0003,
      dates: ["2026-06-23"],
      preferences: ["food", "views"],
      include_external_candidates: 1,
    };
    const res = await post(server, body);

    // It went through the agnostic (any-city) path, not a citypack.
    assert.ok(res.agnostic_route_output_experiment, "agnostic experiment present (no citypack path)");

    // The district intelligence is DELIVERED on the response.
    const ps = res.place_structure;
    assert.ok(ps, "place_structure delivered for an unknown city");
    assert.ok(ps.area_count >= 2, "both districts derived from the live candidate pool");

    // A day composed ACROSS the districts, covering the requested intents, honest.
    assert.deepEqual(ps.district_day.covered_intents.slice().sort(), ["food", "views"]);
    assert.deepEqual(ps.district_day.missing_intents, []);
    assert.equal(ps.district_day.areas.length, 2, "two complementary districts in the day");
    assert.equal(ps.district_day.legs.length, 1, "one honest inter-district leg");
    assert.ok(ps.district_day.legs[0].distance_km > 0.5, "a real walking distance between districts");

    // The stops are the INJECTED loader's candidates (f*/v*), proving this is the
    // agnostic source pool around the anchor — not some fallback city's catalog.
    const allStops = ps.district_day.areas.flatMap((a) => a.stop_ids);
    assert.ok(
      allStops.some((id) => id.startsWith("f")) && allStops.some((id) => id.startsWith("v")),
      "stops come from the loaded source candidates",
    );
  });
});

test("an unknown city with NO external candidates requested omits place_structure (trust boundary)", async () => {
  await withServer(makeLoader(twoDistrictAnyCity()), async (server) => {
    const { port } = server.address();
    const payload = JSON.stringify({
      city: "nowhere-uncharted-xyz",
      lat: 40.006,
      lng: -3.0003,
      dates: ["2026-06-23"],
      preferences: ["food", "views"],
      // include_external_candidates intentionally absent → loader must not run
    });
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/route-recommendations?lang=en&experimental_agnostic_route_output=1",
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        },
        (r) => {
          let d = "";
          r.on("data", (c) => (d += c));
          r.on("end", () => resolve(JSON.parse(d)));
        },
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
    // No external opt-in → no source candidates → no fabricated structure.
    assert.equal(res.place_structure, undefined);
  });
});
