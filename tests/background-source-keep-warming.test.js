"use strict";

// A slow directory sample (Overture) keeps warming after the request that
// started it gives up, so the next request reads the cached answer instead of
// starting over and timing out again (Paris, 5 km cold: 66 s, 2026-10-22).
const assert = require("node:assert/strict");
const test = require("node:test");

const { createBackgroundSource, SOURCE_COMPLETION } = require("../server/place-candidates/background-source");
const { QUERY_TIMEOUT_MS } = require("../server/place-candidates/bounded-overture-query");

function memoryCache() {
  const store = new Map();
  return {
    peek: (key) => store.get(key) || null,
    async get(key, producer, { shouldStore = () => true } = {}) {
      if (store.has(key)) return store.get(key);
      const value = await producer();
      if (shouldStore(value)) store.set(key, value);
      return value;
    },
  };
}

function slowProducer() {
  let finish;
  const calls = [];
  const load = (anchor) => new Promise((resolve, reject) => {
    calls.push(anchor);
    anchor.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    finish = () => resolve([{ id: "place-1" }]);
  });
  return { load, calls, finish: () => finish() };
}

test("a keep-warming source finishes and caches after its only requester gives up", async () => {
  const producer = slowProducer();
  const cache = memoryCache();
  const source = createBackgroundSource({ cache, keyFor: () => "paris", load: producer.load, keepWarming: true });
  const requester = new AbortController();
  const pending = source.load({ lat: 48.857, lng: 2.352 }, { signal: requester.signal });
  requester.abort();
  assert.equal(producer.calls[0].signal.aborted, false, "the producer is not cancelled with the request");
  producer.finish();
  assert.deepEqual(await pending[SOURCE_COMPLETION], [{ id: "place-1" }]);
  assert.deepEqual(source.load({ lat: 48.857, lng: 2.352 }, { signal: new AbortController().signal }), [{ id: "place-1" }],
    "the next request reads the warmed answer without starting over");
  assert.equal(producer.calls.length, 1);
});

test("an ordinary background source is still cancelled when its last requester leaves", async () => {
  const producer = slowProducer();
  const cache = memoryCache();
  const source = createBackgroundSource({ cache, keyFor: () => "x", load: producer.load });
  const requester = new AbortController();
  const pending = source.load({ lat: 1, lng: 1 }, { signal: requester.signal });
  requester.abort();
  assert.equal(producer.calls[0].signal.aborted, true);
  const value = await pending[SOURCE_COMPLETION];
  assert.equal(value.source_error, "fetch_error");
  assert.equal(cache.peek("x"), null, "nothing is cached from cancelled work");
});

test("the Overture query budget fits a dense centre's measured cold window", () => {
  // Measured cold: 66 s from a Swedish home connection, 55.5 s on the Pi with
  // four transfer workers (#635). The budget must exceed both.
  assert.ok(QUERY_TIMEOUT_MS > 66000, `${QUERY_TIMEOUT_MS} ms exceeds the measured 66 s`);
  const source = require("node:fs").readFileSync(require.resolve("../server/place-candidates/open-data-loader.js"), "utf8");
  assert.match(source, /createBackgroundSource\(\{\s*cache,\s*keyFor,\s*keepWarming: true,/);
});
