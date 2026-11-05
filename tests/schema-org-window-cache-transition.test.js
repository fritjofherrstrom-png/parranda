"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { eventCacheKey } = require("../server/place-candidates/agnostic-event-supply");
const { spatialScopeCacheKey } = require("../server/place-candidates/spatial-scope");
const { createSourceCache } = require("../server/place-candidates/source-cache");

const ANCHOR = { lat: 48.5, lng: 2.5 };
const NOW = "2030-05-12T09:00:00Z";
const DATE = "2030-05-12";
const IDS = ["fixture-programme"];

function prefixPolicyKey() {
  return createHash("sha256").update(JSON.stringify([
    "agnostic-events-v24", "48.50000", "2.50000", NOW.slice(0, 13),
    3000, spatialScopeCacheKey(null), IDS.join(","), DATE, "tonight", [],
  ])).digest("hex");
}

test("injected and restarted event caches cannot replay the previous archive-prefix acquisition policy", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "schema-window-cache-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cache = createSourceCache({ namespace: "operator-events", dir: directory, ttlMs: 60000 });
  const prior = prefixPolicyKey();
  await cache.get(prior, async () => ({ policy: "archive-prefix", rows: [] }));
  const filename = path.join(directory, "operator-events", `${prior}.json`);
  const before = fs.readFileSync(filename, "utf8");
  const current = eventCacheKey(ANCHOR, NOW, IDS, 3000, null, DATE);
  let collections = 0;
  const fresh = await cache.get(current, async () => {
    collections += 1;
    return { policy: "source-window-selection", rows: ["source-backed-future-record"] };
  });
  assert.equal(fresh.policy, "source-window-selection", "the unchanged selected source IDs must not replay a pre-correction empty programme");
  assert.equal(collections, 1);
  const restarted = createSourceCache({ namespace: "operator-events", dir: directory, ttlMs: 60000 });
  assert.deepEqual(await restarted.get(current, async () => assert.fail("current semantic policy should survive restart")), fresh);
  assert.equal(fs.readFileSync(filename, "utf8"), before, "do not rewrite or renew historical cache evidence");
});
