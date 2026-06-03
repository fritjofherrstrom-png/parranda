/**
 * Endpoint-level tests for the /api/blitz candidate_mode flag seam.
 *
 * The unit tests in blitz-candidate-mode.test.js cover the engine. These lock
 * the *wiring*: the HTTP path must remain opt-in and must surface the
 * candidate-spine engine fields when the flag is set.
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

test("POST /api/blitz without candidate_mode returns legacy shape (no experimental fields)", async () => {
  const server = buildApp().listen(0);
  try {
    const response = await postJson(server, "/api/blitz", {
      city: "rome",
      date: "2026-06-03",
      preferences: ["second_hand"],
    });
    assert.equal(response.status, 200);
    const body = response.body;
    assert.equal(body.experimental, undefined);
    assert.equal(body.candidate_mode, undefined);
    assert.equal(body.engine, undefined);
    // legacy-only fields present
    assert.ok(body.best_move, "legacy best_move missing");
    assert.ok(body.memory, "legacy memory missing");
    assert.equal(body.reroll_supported, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /api/blitz?candidate_mode=1 returns the candidate-spine engine response", async () => {
  const server = buildApp().listen(0);
  try {
    const response = await postJson(server, "/api/blitz?candidate_mode=1", {
      city: "rome",
      date: "2026-06-03",
      preferences: ["views"],
    });
    assert.equal(response.status, 200);
    const body = response.body;
    assert.equal(body.experimental, true);
    assert.equal(body.candidate_mode, true);
    assert.equal(body.engine, "candidate-spine-blitz-v1");
    // candidate-mode shape: a real next move + inspect block
    assert.ok(body.best_move, "candidate best_move missing");
    assert.equal(body.best_move.match_tier, "primary");
    assert.ok(
      body.best_move.covered_preferences.includes("scenic"),
      "should canonicalize 'views' → scenic",
    );
    assert.ok(body.inspect, "inspect block missing");
    assert.ok(body.inspect.bypass.default_blitz_bypassed === true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("body candidate_mode flag also opts in (parity with query)", async () => {
  const server = buildApp().listen(0);
  try {
    const response = await postJson(server, "/api/blitz", {
      city: "rome",
      date: "2026-06-03",
      candidate_mode: 1,
      preferences: ["second_hand"],
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.experimental, true);
    assert.equal(response.body.engine, "candidate-spine-blitz-v1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("an unknown candidate_mode value does NOT opt in (strict truthy set)", async () => {
  const server = buildApp().listen(0);
  try {
    const response = await postJson(server, "/api/blitz?candidate_mode=enabled", {
      city: "rome",
      date: "2026-06-03",
      preferences: ["scenic"],
    });
    assert.equal(response.status, 200);
    // unknown token → falls through to legacy
    assert.equal(response.body.experimental, undefined);
    assert.ok(response.body.memory);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
