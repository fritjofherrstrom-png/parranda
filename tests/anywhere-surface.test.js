/**
 * The /labs/anywhere any-place ALPHA surface, server-side:
 *   - it serves a neutral alpha shell (EN + SV) with an `anywhereMode` bootstrap
 *     and NO recognized-city identity;
 *   - a registered city still serves its normal city shell (unchanged);
 *   - a freeform `place` + the agnostic flags (no `city`) engages the agnostic
 *     engine and carries a provenance-tagged `place_structure`.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { buildApp } = require("../server/app");
const { externalRecord, makeLoader, mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;

function get(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => resolve({ status: r.statusCode, body: d }));
    }).on("error", reject);
  });
}

function post(server, path, body) {
  const { port } = server.address();
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => resolve({ status: r.statusCode, body: JSON.parse(d) }));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function bootstrapOf(html) {
  const m = html.match(/window\.__PARRANDA_CITY__\s*=\s*(\{[\s\S]*?\});/);
  return m ? JSON.parse(m[1]) : null;
}

async function withServer(opts, run) {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp(opts).listen(0);
  try {
    await run(server);
  } finally {
    await new Promise((r) => server.close(r));
    global.fetch = ORIGINAL_FETCH;
  }
}

test("a registered city still serves its normal city shell (not the alpha)", async () => {
  await withServer({}, async (server) => {
    const res = await get(server, "/barcelona?lang=en");
    assert.equal(res.status, 200);
    const b = bootstrapOf(res.body);
    assert.ok(b, "city bootstrap present");
    assert.equal(b.key, "barcelona");
    assert.notEqual(b.anywhereMode, true, "registered city is NOT in anywhere mode");
  });
});

test("an unknown place serves the neutral alpha shell with an anywhere bootstrap (EN + SV)", async () => {
  await withServer({}, async (server) => {
    for (const [lang, expectLead] of [["en", /open data/i], ["sv", /öppna data/i]]) {
      const res = await get(server, `/labs/anywhere?place=Tbilisi&planner=open&lang=${lang}`);
      assert.equal(res.status, 200);
      const b = bootstrapOf(res.body);
      assert.equal(b.anywhereMode, true);
      assert.equal(b.key, "anywhere", "no recognized-city identity is assigned");
      assert.equal(b.label, "Tbilisi", "the typed place is the visible label");
      assert.equal(b.requestedKey, null, "no registered city key leaks in");
      assert.match(res.body, expectLead, `${lang} alpha copy present`);
      // No leftover shell template tokens.
      assert.doesNotMatch(res.body, /__PARRANDA_(HERO|PLANNER|WILDCARD|TITLE)/, "all shell tokens filled");
    }
  });
});

test("a freeform place + agnostic flags (no city) engages the engine and tags place_structure provenance", async () => {
  // Two districts ~1.3 km apart around the resolved anchor; deterministic loader.
  const anchor = { lat: 41.15, lng: -8.61 };
  const records = [
    externalRecord("f1", "Taverna A", "restaurant", 41.15, -8.61, ["food", "restaurant"]),
    externalRecord("f2", "Taverna B", "restaurant", 41.1506, -8.61, ["food", "restaurant"]),
    externalRecord("f3", "Taverna C", "restaurant", 41.15, -8.6106, ["food", "restaurant"]),
    externalRecord("v1", "Mirador A", "viewpoint", 41.1617, -8.61, ["views", "viewpoint"]),
    externalRecord("v2", "Mirador B", "viewpoint", 41.1623, -8.61, ["views", "viewpoint"]),
    externalRecord("v3", "Mirador C", "viewpoint", 41.1617, -8.6106, ["views", "viewpoint"]),
  ];
  const placeResolver = async (q) => [{ label: `Resolved ${q}`, lat: anchor.lat, lng: anchor.lng, confidence: "high", provenance: "test_geocoder" }];

  await withServer({ openDataLoader: makeLoader(records), placeResolver }, async (server) => {
    const res = await post(server, "/api/route-recommendations?lang=en", {
      place: "Anytown",
      place_query: "Anytown",
      dates: ["2026-06-23"],
      preferences: ["food", "views"],
      experimental_agnostic_route_output: 1,
      include_external_candidates: 1,
      agnostic_engine_compose: 1,
      // NO city
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.agnostic_route_output_experiment, "the agnostic engine path engaged");
    const ps = res.body.place_structure;
    assert.ok(ps, "place_structure delivered for the freeform place");
    assert.equal(ps.provenance, "agnostic_anchor", "structure is tagged to the resolved anchor, not a baseline");
    assert.ok(ps.area_count >= 2, "both districts derived from the loaded candidates");
  });
});

test("the alpha route does NOT treat a recognized city sent as `place` (it stays freeform/no-city)", async () => {
  // `city` is never the place query; sending no `city` keeps it on the agnostic path.
  const placeResolver = async () => [{ label: "Resolved", lat: 41.15, lng: -8.61, confidence: "high", provenance: "t" }];
  await withServer({ openDataLoader: makeLoader([]), placeResolver }, async (server) => {
    const res = await post(server, "/api/route-recommendations?lang=en", {
      place: "Somewhere",
      dates: ["2026-06-23"],
      preferences: ["food"],
      experimental_agnostic_route_output: 1,
      include_external_candidates: 1,
      agnostic_engine_compose: 1,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.agnostic_route_output_experiment, "freeform place runs the agnostic experiment");
  });
});
