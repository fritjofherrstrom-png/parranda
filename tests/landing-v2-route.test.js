"use strict";

/**
 * GET / landing takeover (docs/FRONTEND_MIGRATION_CONTRACT.md) — explicit,
 * reversible, contract-gated:
 *   - flag OFF (default): today's server-rendered landing, byte-stable;
 *   - flag ON + built page + /anywhere active: the NEW landing serves, with the
 *     request-time <html lang> and the CITY REGISTRY injected at serve time;
 *   - flag ON but /anywhere NOT active: fall back to today's landing (the new
 *     landing routes freeform places to /anywhere — never point at a missing
 *     surface);
 *   - flag ON but NO build: fall back to today's landing.
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

test("flag ON + build + anywhere active: the NEW landing serves with lang + injected registry", async () => {
  const dist = makeDist();
  try {
    await withServer({ newLandingEnabled: true, anywhereV2Enabled: true, anywhereV2Dir: dist }, async (server) => {
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

test("flag ON but /anywhere NOT active: falls back to today's landing (never point at a missing surface)", async () => {
  const dist = makeDist();
  try {
    await withServer({ newLandingEnabled: true, anywhereV2Enabled: false, anywhereV2Dir: dist }, async (server) => {
      const page = await get(server, "/");
      assert.doesNotMatch(page.body, /NEW-LANDING/);
      assert.match(page.body, /window\.__PARRANDA_ANYWHERE_V2__ = false;/, "today's landing, honest flag");
    });
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("flag ON but NO landing build: falls back to today's landing", async () => {
  const dist = makeDist({ withLanding: false });
  try {
    await withServer({ newLandingEnabled: true, anywhereV2Enabled: true, anywhereV2Dir: dist }, async (server) => {
      const page = await get(server, "/");
      assert.doesNotMatch(page.body, /NEW-LANDING/);
      assert.match(page.body, /window\.__PARRANDA_ANYWHERE_V2__ = true;/);
    });
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("PROMOTED DEFAULT: no flag needed — the new landing serves when built + anywhere active", async () => {
  const dist = makeDist();
  const priorEnv = process.env.PARRANDA_NEW_LANDING;
  delete process.env.PARRANDA_NEW_LANDING;
  try {
    await withServer({ anywhereV2Enabled: true, anywhereV2Dir: dist }, async (server) => {
      const page = await get(server, "/?lang=en");
      assert.match(page.body, /NEW-LANDING/, "default ownership: the promoted landing serves with no env set");
    });
  } finally {
    if (priorEnv !== undefined) process.env.PARRANDA_NEW_LANDING = priorEnv;
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("opt-out (PARRANDA_NEW_LANDING=disabled): the prior landing serves, byte-stable", async () => {
  const dist = makeDist();
  try {
    await withServer({ newLandingEnabled: false, anywhereV2Enabled: true, anywhereV2Dir: dist }, async (server) => {
      const page = await get(server, "/?lang=en");
      assert.doesNotMatch(page.body, /NEW-LANDING/);
      assert.match(page.body, /Next stop\?/, "the rollback landing hero");
    });
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
