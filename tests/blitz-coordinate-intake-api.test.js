/**
 * Endpoint-level tests for the /api/blitz coordinate intake seam (#236).
 *
 * Locks the wiring that lets candidate_mode reach the agnostic context from an
 * HTTP request: coordinate parsing, agnostic-vs-city selection, fail-closed
 * behaviour without a trusted loader, and continued public-payload safety.
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
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          resolve({ status: response.statusCode, body: data ? JSON.parse(data) : null });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function withServer(run) {
  const server = buildApp().listen(0);
  try {
    return await run(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// --- existing behaviour stays unchanged ------------------------------------

test("existing city candidate_mode behaviour is unchanged when no coords are sent", async () => {
  await withServer(async (server) => {
    const response = await postJson(server, "/api/blitz?candidate_mode=1", {
      city: "rome",
      date: "2026-06-03",
      preferences: ["scenic"],
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.agnostic_context.used, false);
    assert.equal(response.body.city, "rome");
    assert.equal(response.body.context.catalog_density, "rich");
    assert.equal(response.body.best_move.origin, "curated_catalog");
  });
});

test("recognized city + coords: city wins, agnostic NOT used (coords feed origin only)", async () => {
  await withServer(async (server) => {
    const response = await postJson(server, "/api/blitz?candidate_mode=1", {
      city: "rome",
      lat: 59.5,
      lng: 18.0, // Stockholm coords — must not displace Rome
      date: "2026-06-03",
      preferences: ["scenic"],
    });
    assert.equal(response.body.agnostic_context.used, false);
    assert.equal(response.body.city, "rome");
  });
});

test("default Blitz (no candidate_mode) ignores coords and stays untouched", async () => {
  await withServer(async (server) => {
    const response = await postJson(server, "/api/blitz", {
      lat: 41.9,
      lng: 12.5,
      date: "2026-06-03",
      preferences: ["scenic"],
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.experimental, undefined);
    assert.equal(response.body.agnostic_context.used, false);
    // legacy fields still present
    assert.ok(response.body.best_move);
    assert.ok(response.body.memory);
  });
});

// --- agnostic path is reachable from HTTP ----------------------------------

test("coord-only + candidate_mode reaches the agnostic path", async () => {
  await withServer(async (server) => {
    const response = await postJson(server, "/api/blitz?candidate_mode=1", {
      lat: 59.5,
      lng: 18.0,
      date: "2026-06-03",
      preferences: ["scenic"],
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.agnostic_context.used, true);
    assert.equal(response.body.agnostic_context.reason, "no_city_requested");
    assert.equal(response.body.agnostic_context.lat, 59.5);
    assert.equal(response.body.agnostic_context.lng, 18.0);
    assert.equal(response.body.context.catalog_density, "absent");
    assert.equal(response.body.context.agnostic, true);
  });
});

test("query-string lat/lng are also accepted", async () => {
  await withServer(async (server) => {
    const response = await postJson(
      server,
      "/api/blitz?candidate_mode=1&lat=37.1&lng=25.4",
      { date: "2026-06-03", preferences: ["scenic"] },
    );
    assert.equal(response.body.agnostic_context.used, true);
    assert.equal(response.body.agnostic_context.lat, 37.1);
  });
});

test("origin.lat/origin.lng shape also works", async () => {
  await withServer(async (server) => {
    const response = await postJson(server, "/api/blitz?candidate_mode=1", {
      origin: { lat: 37.1, lng: 25.4 },
      date: "2026-06-03",
      preferences: ["scenic"],
    });
    assert.equal(response.body.agnostic_context.used, true);
    assert.equal(response.body.agnostic_context.lat, 37.1);
  });
});

test("unknown city + coords falls through to agnostic (reason: city_fallback)", async () => {
  await withServer(async (server) => {
    const response = await postJson(server, "/api/blitz?candidate_mode=1", {
      city: "naxos", // unknown
      lat: 37.1,
      lng: 25.4,
      date: "2026-06-03",
      preferences: ["scenic"],
    });
    assert.equal(response.body.agnostic_context.used, true);
    assert.equal(response.body.agnostic_context.reason, "city_fallback");
    assert.equal(response.body.context.catalog_density, "absent");
  });
});

// --- fail-closed honesty ----------------------------------------------------

test("coord-only without a trusted loader fails closed honestly (no_candidates)", async () => {
  await withServer(async (server) => {
    const response = await postJson(server, "/api/blitz?candidate_mode=1", {
      lat: 59.5,
      lng: 18.0,
      preferences: ["scenic"],
    });
    assert.equal(response.body.best_move, null);
    assert.equal(response.body.backup_option, null);
    assert.equal(response.body.reason, "no_candidates");
    // honest confidence — never citypack
    assert.equal(response.body.confidence.level, null);
    assert.equal(response.body.confidence.label, "no_usable_move");
  });
});

test("even with include_external_candidates, coord-only fails closed (no public injection)", async () => {
  await withServer(async (server) => {
    const response = await postJson(
      server,
      "/api/blitz?candidate_mode=1&include_external_candidates=1",
      { lat: 59.5, lng: 18.0, preferences: ["swimming"] },
    );
    assert.equal(response.body.agnostic_context.used, true);
    assert.equal(response.body.best_move, null);
    assert.equal(response.body.reason, "no_candidates");
  });
});

test("public `external_dataset` payload is still ignored (no public injection seam)", async () => {
  await withServer(async (server) => {
    const malicious = [
      {
        id: "fake",
        name: "Fake Beach",
        type: "beach",
        lat: 59.5,
        lng: 18.0,
        sources: [
          { provider: "osm", family: "map", tier: "inferred" },
          { provider: "opendata", family: "official", tier: "inferred" },
        ],
      },
    ];
    const response = await postJson(
      server,
      "/api/blitz?candidate_mode=1&include_external_candidates=1",
      { lat: 59.5, lng: 18.0, preferences: ["swimming"], external_dataset: malicious },
    );
    // payload-injected datasets MUST NOT surface as candidates
    assert.equal(response.body.best_move, null);
    assert.equal(response.body.reason, "no_candidates");
  });
});

// --- invalid coordinate behaviour ------------------------------------------

test("invalid coords are predictably ignored (fall through to default city)", async () => {
  await withServer(async (server) => {
    const response = await postJson(server, "/api/blitz?candidate_mode=1", {
      lat: 999,
      lng: "not-a-number",
      preferences: ["scenic"],
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.agnostic_context.used, false);
    // fall-through to default city behaviour — never crashes
    assert.ok(response.body.city);
  });
});

test("partial coords (only lat) are ignored", async () => {
  await withServer(async (server) => {
    const response = await postJson(server, "/api/blitz?candidate_mode=1", {
      lat: 41.9,
      preferences: ["scenic"],
    });
    assert.equal(response.body.agnostic_context.used, false);
  });
});

test("out-of-range lng (e.g. 181) is rejected as invalid", async () => {
  await withServer(async (server) => {
    const response = await postJson(server, "/api/blitz?candidate_mode=1", {
      lat: 41.9,
      lng: 181,
      preferences: ["scenic"],
    });
    assert.equal(response.body.agnostic_context.used, false);
  });
});
