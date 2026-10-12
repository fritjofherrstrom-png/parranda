"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("production web and scout worker forward the operator's local search configuration", () => {
  const compose = fs.readFileSync(path.join(__dirname, "..", "compose.production.yml"), "utf8");
  const worker = compose.split("  source-scout-worker:")[1]?.split("  caddy:")[0] || "";
  const web = compose.split("  web:")[1]?.split("  postgres:")[0] || "";
  for (const service of [web, worker]) {
    assert.match(service, /PARRANDA_SOURCE_SEARCH_TIMEOUT_MS:\s*\$\{PARRANDA_SOURCE_SEARCH_TIMEOUT_MS:-7000\}/);
    assert.match(service, /PARRANDA_SOURCE_SEARCH_PACE_MS:\s*\$\{PARRANDA_SOURCE_SEARCH_PACE_MS:-250\}/);
    assert.match(service, /PARRANDA_SOURCE_SEARCH:\s*\$\{PARRANDA_SOURCE_SEARCH:-disabled\}/);
    assert.match(service, /PARRANDA_SOURCE_SEARCH_ENDPOINT:\s*\$\{PARRANDA_SOURCE_SEARCH_ENDPOINT:-\}/);
    assert.match(service, /PARRANDA_SOURCE_SEARCH_USER_AGENT:\s*\$\{PARRANDA_SOURCE_SEARCH_USER_AGENT:-Parranda self-hosted source search\}/);
  }
  assert.match(web, /PARRANDA_REQUEST_TIME_EVENT_DISCOVERY:\s*\$\{PARRANDA_REQUEST_TIME_EVENT_DISCOVERY:-enabled\}/);
});
