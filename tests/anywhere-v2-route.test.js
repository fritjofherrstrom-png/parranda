/**
 * /anywhere route takeover (docs/FRONTEND_MIGRATION_CONTRACT.md) — explicit,
 * reversible, contract-gated:
 *   - flag OFF (default): /anywhere falls through to today's behavior, the
 *     landing declares anywhereV2=false → unknowns still go to /labs/anywhere;
 *   - flag ON + built surface present: /anywhere serves the NEW frontend page,
 *     /_astro assets serve, the landing declares anywhereV2=true;
 *   - flag ON but NO build: honest fall-through (never a broken page);
 *   - /labs/anywhere is untouched in every mode (the rollback surface).
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

test("flag ON + build present: /anywhere serves the new frontend, assets serve, landing declares v2", async () => {
  const dist = makeDist();
  try {
    await withServer({ anywhereV2Enabled: true, anywhereV2Dir: dist }, async (server) => {
      const page = await get(server, "/anywhere?place=Lyon&lang=sv");
      assert.equal(page.status, 200);
      assert.match(page.body, /NEW-FRONTEND-ANYWHERE/);
      assert.match(page.body, /<html lang="sv">/);

      const asset = await get(server, "/_astro/app.js");
      assert.equal(asset.status, 200);
      assert.match(asset.body, /island/);

      const landing = await get(server, "/?lang=en");
      assert.match(landing.body, /window\.__PARRANDA_ANYWHERE_V2__ = true;/);

      // Promoted default: the labs doorway funnels into the ONE canonical
      // surface, inputs preserved.
      const labs = await get(server, "/labs/anywhere?place=Lyon&planner=open&lang=sv");
      assert.equal(labs.status, 302);
      assert.equal(labs.headers.location, "/anywhere?place=Lyon&planner=open&lang=sv");
    });
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("PROMOTED DEFAULT: no flag needed — /anywhere serves the new frontend when the build exists", async () => {
  const dist = makeDist();
  const priorEnv = process.env.PARRANDA_NEW_ANYWHERE;
  delete process.env.PARRANDA_NEW_ANYWHERE;
  try {
    await withServer({ anywhereV2Dir: dist }, async (server) => {
      const page = await get(server, "/anywhere?place=Lyon");
      assert.equal(page.status, 200);
      assert.match(page.body, /NEW-FRONTEND-ANYWHERE/, "default ownership: the promoted surface serves with no env set");
    });
  } finally {
    if (priorEnv !== undefined) process.env.PARRANDA_NEW_ANYWHERE = priorEnv;
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("flag ON + build present: /anywhere keeps English as default html lang", async () => {
  const dist = makeDist();
  try {
    await withServer({ anywhereV2Enabled: true, anywhereV2Dir: dist }, async (server) => {
      const defaultPage = await get(server, "/anywhere?place=Lyon");
      assert.equal(defaultPage.status, 200);
      assert.match(defaultPage.body, /<html lang="en">/);

      const invalidLangPage = await get(server, "/anywhere?place=Lyon&lang=fr");
      assert.equal(invalidLangPage.status, 200);
      assert.match(invalidLangPage.body, /<html lang="en">/);
    });
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("opt-out (PARRANDA_NEW_ANYWHERE=disabled): /anywhere falls back to the prior behavior; landing declares v2=false", async () => {
  await withServer({ anywhereV2Enabled: false }, async (server) => {
    const page = await get(server, "/anywhere");
    assert.equal(page.status, 200);
    // Today's behavior: the catch-all city shell (bootstrap present), NOT the new page.
    assert.doesNotMatch(page.body, /NEW-FRONTEND-ANYWHERE/);
    assert.match(page.body, /window\.__PARRANDA_CITY__/);

    const landing = await get(server, "/");
    assert.match(landing.body, /window\.__PARRANDA_ANYWHERE_V2__ = false;/);

    // Today's behavior for unknown paths is the city-shell catch-all — the point
    // is that the ISLAND ASSET is not served when the takeover is off.
    const asset = await get(server, "/_astro/app.js");
    assert.doesNotMatch(asset.body, /island/);
  });
});

test("flag ON but NO build present: honest fall-through, never a broken page", async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-anywhere-empty-"));
  try {
    await withServer({ anywhereV2Enabled: true, anywhereV2Dir: emptyDir }, async (server) => {
      const page = await get(server, "/anywhere");
      assert.equal(page.status, 200);
      assert.doesNotMatch(page.body, /NEW-FRONTEND-ANYWHERE/);
      assert.match(page.body, /window\.__PARRANDA_CITY__/);

      const landing = await get(server, "/");
      assert.match(landing.body, /window\.__PARRANDA_ANYWHERE_V2__ = false;/, "landing must not point at a missing surface");
    });
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});
