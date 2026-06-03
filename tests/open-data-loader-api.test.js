/**
 * Endpoint tests for the #237 open-data loader seam.
 *
 * The trusted loader is injected via buildApp({ openDataLoader }) — the same
 * server-side channel production uses (env-gated). It is NEVER reachable from
 * the request payload. Tests use deterministic injected loaders; no live
 * network.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { buildApp } = require("../server/app");

async function postJson(server, path, body) {
  const { port } = server.address();
  const payload = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (response) => {
        let data = "";
        response.on("data", (c) => (data += c));
        response.on("end", () => resolve({ status: response.statusCode, body: data ? JSON.parse(data) : null }));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function withServer(appOptions, run) {
  const server = buildApp(appOptions).listen(0);
  try {
    return await run(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// A deterministic loader returning a corroborated (OSM + Wikidata) viewpoint.
function corroboratedLoader() {
  return async ({ lat, lng }) => [
    {
      id: "osm-node-42",
      name: "Open Belvedere",
      type: "viewpoint",
      lat,
      lng,
      tags: ["utsikt"],
      sources: [
        { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/42" },
        { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: "https://www.wikidata.org/wiki/Q123" },
      ],
    },
  ];
}

// A single-family (OSM only) loader — must be gated out.
function singleFamilyLoader() {
  return async ({ lat, lng }) => [
    { id: "osm-node-43", name: "Lone Cafe", type: "cafe", lat, lng, tags: [], sources: [{ provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/43" }] },
  ];
}

// --- default behaviour unchanged -------------------------------------------

test("default Blitz (no candidate_mode) is unchanged even with a loader configured", async () => {
  await withServer({ openDataLoader: corroboratedLoader() }, async (server) => {
    const res = await postJson(server, "/api/blitz", { city: "rome", date: "2026-06-03", preferences: ["scenic"] });
    assert.equal(res.body.experimental, undefined);
    assert.ok(res.body.best_move);
    assert.ok(res.body.memory);
  });
});

test("city candidate_mode is unchanged (loader not consulted for a recognized city)", async () => {
  let loaderCalled = false;
  const loader = async (args) => {
    loaderCalled = true;
    return corroboratedLoader()(args);
  };
  await withServer({ openDataLoader: loader }, async (server) => {
    const res = await postJson(server, "/api/blitz?candidate_mode=1&include_external_candidates=1", { city: "rome", lat: 41.9, lng: 12.5, date: "2026-06-03", preferences: ["scenic"] });
    assert.equal(res.body.agnostic_context.used, false);
    assert.equal(res.body.best_move.origin, "curated_catalog");
    assert.equal(loaderCalled, false); // recognized city → loader never runs
  });
});

// --- coordinate agnostic path ----------------------------------------------

test("coordinate agnostic path WITHOUT a loader fails closed", async () => {
  await withServer({ openDataLoader: null }, async (server) => {
    const res = await postJson(server, "/api/blitz?candidate_mode=1&include_external_candidates=1", { lat: 41.9, lng: 12.5, preferences: ["scenic"] });
    assert.equal(res.body.agnostic_context.used, true);
    assert.equal(res.body.agnostic_context.open_data_loader, "no_loader_configured");
    assert.equal(res.body.best_move, null);
    assert.equal(res.body.reason, "no_candidates");
  });
});

test("coordinate agnostic path WITH a trusted loader produces an eligible source-backed move", async () => {
  await withServer({ openDataLoader: corroboratedLoader() }, async (server) => {
    const res = await postJson(server, "/api/blitz?candidate_mode=1&include_external_candidates=1", { lat: 41.9, lng: 12.5, preferences: ["scenic"] });
    assert.equal(res.body.agnostic_context.used, true);
    assert.equal(res.body.agnostic_context.open_data_loader, "loaded:1");
    assert.equal(res.body.best_move.origin, "external_open");
    assert.ok(res.body.best_move.covered_preferences.includes("scenic"));
    // honest confidence — never citypack-high
    assert.equal(res.body.confidence.label, "source_backed");
    assert.notEqual(res.body.confidence.level, "high");
  });
});

test("loader requires include_external_candidates — agnostic alone does not fetch", async () => {
  let loaderCalled = false;
  const loader = async (args) => {
    loaderCalled = true;
    return corroboratedLoader()(args);
  };
  await withServer({ openDataLoader: loader }, async (server) => {
    const res = await postJson(server, "/api/blitz?candidate_mode=1", { lat: 41.9, lng: 12.5, preferences: ["scenic"] });
    assert.equal(res.body.agnostic_context.used, true);
    assert.equal(loaderCalled, false);
    assert.equal(res.body.best_move, null); // no external → no candidates in an empty catalog
  });
});

// --- source honesty --------------------------------------------------------

test("single-family (OSM-only) records do not become user-facing moves", async () => {
  await withServer({ openDataLoader: singleFamilyLoader() }, async (server) => {
    const res = await postJson(server, "/api/blitz?candidate_mode=1&include_external_candidates=1", { lat: 41.9, lng: 12.5, preferences: ["food"] });
    assert.equal(res.body.agnostic_context.open_data_loader, "loaded:1"); // it WAS loaded…
    assert.equal(res.body.best_move, null); // …but gated out (single family → existence low)
    // collected-but-gated reports the more precise reason
    assert.equal(res.body.reason, "no_eligible_candidates");
    // and the gate rejection is inspectable
    assert.ok(res.body.inspect.rejected_count >= 1);
  });
});

test("public external_dataset payload is ignored (no public injection seam)", async () => {
  const malicious = [
    { id: "evil", name: "Fake", type: "viewpoint", lat: 41.9, lng: 12.5, tags: ["utsikt"], sources: [{ provider: "osm", family: "map", tier: "inferred" }, { provider: "wikidata", family: "open_knowledge", tier: "inferred" }] },
  ];
  // No loader configured AND a malicious payload dataset → still fails closed.
  await withServer({ openDataLoader: null }, async (server) => {
    const res = await postJson(server, "/api/blitz?candidate_mode=1&include_external_candidates=1", { lat: 41.9, lng: 12.5, preferences: ["scenic"], external_dataset: malicious });
    assert.equal(res.body.best_move, null);
    assert.equal(res.body.reason, "no_candidates");
  });
});

test("attribution/provenance is present on a source-backed best_move", async () => {
  await withServer({ openDataLoader: corroboratedLoader() }, async (server) => {
    const res = await postJson(server, "/api/blitz?candidate_mode=1&include_external_candidates=1", { lat: 41.9, lng: 12.5, preferences: ["scenic"] });
    const prov = res.body.best_move.provenance;
    assert.equal(prov.human_verified, false);
    assert.equal(prov.provenance_diversity, 2);
    assert.equal(prov.source_family, "map");
    const families = prov.attribution.map((a) => a.source_family);
    assert.ok(families.includes("map"));
    assert.ok(families.includes("open_knowledge"));
    assert.ok(prov.attribution.some((a) => /openstreetmap\.org/.test(a.url || "")));
    assert.ok(prov.attribution.some((a) => /wikidata\.org/.test(a.url || "")));
  });
});

// --- fetch errors fail closed ----------------------------------------------

test("a loader that throws fails closed (no crash, no hallucinated fallback)", async () => {
  const throwingLoader = async () => {
    throw new Error("network exploded");
  };
  await withServer({ openDataLoader: throwingLoader }, async (server) => {
    const res = await postJson(server, "/api/blitz?candidate_mode=1&include_external_candidates=1", { lat: 41.9, lng: 12.5, preferences: ["scenic"] });
    assert.equal(res.status, 200);
    assert.equal(res.body.agnostic_context.open_data_loader, "error_failed_closed");
    assert.equal(res.body.best_move, null);
    assert.equal(res.body.reason, "no_candidates");
  });
});

test("a loader returning [] reports loaded:0 and fails closed", async () => {
  await withServer({ openDataLoader: async () => [] }, async (server) => {
    const res = await postJson(server, "/api/blitz?candidate_mode=1&include_external_candidates=1", { lat: 41.9, lng: 12.5, preferences: ["scenic"] });
    assert.equal(res.body.agnostic_context.open_data_loader, "loaded:0");
    assert.equal(res.body.best_move, null);
  });
});

test("the endpoint never touches global fetch on the default (no-loader) path", async () => {
  const originalFetch = global.fetch;
  global.fetch = () => {
    throw new Error("no live network allowed in tests");
  };
  try {
    await withServer({ openDataLoader: null }, async (server) => {
      const res = await postJson(server, "/api/blitz?candidate_mode=1&include_external_candidates=1", { lat: 41.9, lng: 12.5, preferences: ["scenic"] });
      assert.equal(res.body.best_move, null); // no fetch, honest fail closed
    });
  } finally {
    global.fetch = originalFetch;
  }
});
