"use strict";

/**
 * /anywhere route ownership after the old-stack retirement
 * (docs/FRONTEND_MIGRATION_CONTRACT.md "Retired surfaces"): the new frontend is
 * the SOLE owner — no flags, no fallback shell. A missing build fails loudly
 * (503), never silently serves a wrong page. /labs/anywhere is an unconditional
 * redirect that preserves its inputs.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildApp } = require("../server/app");

function get(server, requestPath) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path: requestPath }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

function makeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-anywhere-dist-"));
  fs.mkdirSync(path.join(dir, "anywhere"), { recursive: true });
  fs.mkdirSync(path.join(dir, "_astro"), { recursive: true });
  fs.writeFileSync(path.join(dir, "anywhere", "index.html"), '<!doctype html><html lang="en"><body>NEW-FRONTEND-ANYWHERE</body></html>');
  fs.writeFileSync(path.join(dir, "_astro", "app.js"), "console.log('island');");
  return dir;
}

async function withServer(options, run) {
  const server = buildApp(options).listen(0);
  try {
    await run(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("/anywhere serves the new frontend unconditionally — no flag, request-time lang honored", async () => {
  const dist = makeDist();
  try {
    await withServer({ anywhereV2Dir: dist }, async (server) => {
      const page = await get(server, "/anywhere?place=Lyon&lang=sv");
      assert.equal(page.status, 200);
      assert.match(page.body, /NEW-FRONTEND-ANYWHERE/);
      assert.match(page.body, /<html lang="sv">/);

      const asset = await get(server, "/_astro/app.js");
      assert.equal(asset.status, 200);
      assert.match(asset.body, /island/);

      const defaultLang = await get(server, "/anywhere?place=Lyon");
      assert.match(defaultLang.body, /<html lang="en">/, "EN default per the language contract");
      const invalidLang = await get(server, "/anywhere?place=Lyon&lang=fr");
      assert.match(invalidLang.body, /<html lang="en">/, "unknown lang falls back to EN");
    });
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("/labs/anywhere is an unconditional redirect that preserves place/planner/lang", async () => {
  const dist = makeDist();
  try {
    await withServer({ anywhereV2Dir: dist }, async (server) => {
      const labs = await get(server, "/labs/anywhere?place=Lyon&planner=open&lang=sv");
      assert.equal(labs.status, 302);
      assert.equal(labs.headers.location, "/anywhere?place=Lyon&planner=open&lang=sv");

      const bare = await get(server, "/labs/anywhere");
      assert.equal(bare.status, 302);
      assert.equal(bare.headers.location, "/anywhere?lang=en");
    });
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("a missing build fails LOUDLY (503) — never a silently wrong page", async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-anywhere-empty-"));
  try {
    await withServer({ anywhereV2Dir: emptyDir }, async (server) => {
      const page = await get(server, "/anywhere");
      assert.equal(page.status, 503);
      assert.match(page.body, /Frontend build missing/);
      assert.doesNotMatch(page.body, /__PARRANDA_CITY__/, "no city-shell masquerading as the planner");
    });
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});
