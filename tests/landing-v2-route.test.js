"use strict";

/**
 * GET / route ownership after the old-stack retirement
 * (docs/FRONTEND_MIGRATION_CONTRACT.md "Retired surfaces"): the new frontend is
 * the ONLY landing — no flags, no fallback shell. The request-time <html lang>
 * and the serve-time CITY REGISTRY injection are the landing's contract; a
 * missing build fails loudly (503).
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
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

function makeDist({ withLanding = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-landing-dist-"));
  fs.mkdirSync(path.join(dir, "anywhere"), { recursive: true });
  fs.mkdirSync(path.join(dir, "_astro"), { recursive: true });
  fs.writeFileSync(path.join(dir, "anywhere", "index.html"), '<!doctype html><html lang="en"><body>NEW-ANYWHERE</body></html>');
  if (withLanding) {
    fs.writeFileSync(
      path.join(dir, "index.html"),
      '<!doctype html><html lang="en"><head><script>window.__PARRANDA_CITIES__ = "__PARRANDA_LANDING_REGISTRY__";</script></head><body>NEW-LANDING</body></html>',
    );
  }
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

test("GET / serves the new landing unconditionally with lang + injected registry", async () => {
  const dist = makeDist();
  try {
    await withServer({ anywhereV2Dir: dist }, async (server) => {
      const page = await get(server, "/?lang=sv");
      assert.equal(page.status, 200);
      assert.match(page.body, /NEW-LANDING/);
      assert.match(page.body, /<html lang="sv">/);
      // The quoted token is REPLACED with real registry JSON (a city is data).
      assert.doesNotMatch(page.body, /"__PARRANDA_LANDING_REGISTRY__"/);
      assert.match(page.body, /window\.__PARRANDA_CITIES__ = \{/);
      assert.match(page.body, /"barcelona"|"rome"/i, "registry carries the curated cities");

      const defaultLang = await get(server, "/");
      assert.match(defaultLang.body, /<html lang="en">/, "EN default per the language contract");
    });
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("a missing landing build fails LOUDLY (503) — never a silently wrong page", async () => {
  const dist = makeDist({ withLanding: false });
  try {
    await withServer({ anywhereV2Dir: dist }, async (server) => {
      const page = await get(server, "/");
      assert.equal(page.status, 503);
      assert.match(page.body, /Frontend build missing/);
    });
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
