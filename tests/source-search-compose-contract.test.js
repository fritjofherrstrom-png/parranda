"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("production scout worker forwards operator search timeout and pacing without changing defaults", () => {
  const compose = fs.readFileSync(path.join(__dirname, "..", "compose.production.yml"), "utf8");
  const worker = compose.split("  source-scout-worker:")[1]?.split("  caddy:")[0] || "";
  assert.match(worker, /PARRANDA_SOURCE_SEARCH_TIMEOUT_MS:\s*\$\{PARRANDA_SOURCE_SEARCH_TIMEOUT_MS:-7000\}/);
  assert.match(worker, /PARRANDA_SOURCE_SEARCH_PACE_MS:\s*\$\{PARRANDA_SOURCE_SEARCH_PACE_MS:-250\}/);
  assert.match(worker, /PARRANDA_SOURCE_SEARCH:\s*\$\{PARRANDA_SOURCE_SEARCH:-disabled\}/);
});
