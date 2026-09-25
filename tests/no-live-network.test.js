"use strict";

// Contract of the suite's network guard (tests/helpers/no-live-network.js).
// Each case runs in a child process because a violation is deliberately
// uncatchable. `.invalid` never resolves (RFC 2606), so even a broken guard
// could not reach a real host from here.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const GUARD = path.join(__dirname, "helpers", "no-live-network.js");
const LIVE_URL = "https://parranda-guard.invalid/feed";

// The child gets only the guard: no inherited preloads, no runner context.
function runWithGuard(source, env = {}) {
  const { NODE_TEST_CONTEXT: _runnerContext, NODE_OPTIONS: _preloads, ...parentEnv } = process.env;
  return spawnSync(process.execPath, ["--require", GUARD, "-e", source], {
    encoding: "utf8",
    env: { ...parentEnv, PARRANDA_TEST_LIVE_NETWORK: "", ...env },
    timeout: 20_000,
  });
}

test("a live fetch is refused at once and fails the process even when the caller swallows it", () => {
  const swallowed = runWithGuard(`
    fetch(${JSON.stringify(LIVE_URL)}).catch(() => {});
  `);
  assert.notEqual(swallowed.status, 0);
  assert.match(swallowed.stderr, /Live network is disabled in the test suite: GET https:\/\/parranda-guard\.invalid\/feed/);

  const observed = runWithGuard(`
    process.on("uncaughtException", (error) => console.log("uncaught", error.code));
    fetch(${JSON.stringify(LIVE_URL)}).then(
      () => console.log("resolved"),
      (error) => console.log("rejected", error.name, error.cause.code),
    );
  `);
  assert.equal(observed.status, 0, observed.stderr);
  assert.match(observed.stdout, /^uncaught PARRANDA_TEST_LIVE_NETWORK$/m);
  assert.match(observed.stdout, /^rejected TypeError PARRANDA_TEST_LIVE_NETWORK$/m);
});

test("a live socket (http/https clients, drivers) is refused the same way", () => {
  const run = runWithGuard(`
    process.on("uncaughtException", (error) => console.log("uncaught", error.code));
    require("node:https").get(${JSON.stringify(LIVE_URL)}).on("error", (error) => console.log("request error", error.code));
  `);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^uncaught PARRANDA_TEST_LIVE_NETWORK$/m);
  assert.match(run.stdout, /^request error PARRANDA_TEST_LIVE_NETWORK$/m);
});

test("loopback servers stay reachable through fetch and http", () => {
  const run = runWithGuard(`
    const http = require("node:http");
    const server = http.createServer((_request, response) => response.end("ok")).listen(0, "127.0.0.1", async () => {
      const { port } = server.address();
      const viaFetch = await (await fetch("http://127.0.0.1:" + port + "/")).text();
      http.get({ host: "localhost", family: 4, port, path: "/" }, (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => {
          console.log(viaFetch, body);
          server.close();
        });
      });
    });
  `);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "ok ok");
});

test("PARRANDA_TEST_LIVE_NETWORK=enabled leaves the network untouched", () => {
  const source = "console.log(globalThis.fetch.name)";
  assert.equal(runWithGuard(source).stdout.trim(), "guardedFetch");
  assert.notEqual(runWithGuard(source, { PARRANDA_TEST_LIVE_NETWORK: "enabled" }).stdout.trim(), "guardedFetch");
});
