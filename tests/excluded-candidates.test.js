"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_EXCLUDED_IDS,
  excludedCandidateSummary,
  parseExcludedCandidateIds,
  withoutExcludedCandidates,
} = require("../server/planner/excluded-candidates");

function loaderOf(records, metadata = {}) {
  return async () => {
    const out = records.slice();
    for (const [k, v] of Object.entries(metadata)) out[k] = v;
    return out;
  };
}

// --------------------------------------------------------------------------
// The trust boundary. A public payload may subtract and nothing else.
// --------------------------------------------------------------------------

test("only ids we could have issued are accepted", () => {
  assert.deepEqual(
    parseExcludedCandidateIds(["cafe-0", "way:12345", "node.7", "A-B_c"]),
    ["cafe-0", "way:12345", "node.7", "A-B_c"],
  );
  // Anything shaped like injection, a path, or a sentence is dropped outright.
  assert.deepEqual(
    parseExcludedCandidateIds([
      "", "   ", "../etc/passwd", "a b", "<script>", "id;DROP", "'or'1'='1",
      null, 42, {}, [], "-leading-dash", "x".repeat(200),
    ]),
    [],
  );
});

test("the ledger is deduped and bounded", () => {
  assert.deepEqual(parseExcludedCandidateIds(["a-1", "a-1", "a-1"]), ["a-1"]);
  const many = Array.from({ length: MAX_EXCLUDED_IDS + 25 }, (_, i) => `cafe-${i}`);
  assert.equal(parseExcludedCandidateIds(many).length, MAX_EXCLUDED_IDS);
  assert.deepEqual(parseExcludedCandidateIds(undefined), []);
  assert.deepEqual(parseExcludedCandidateIds("cafe-0"), []);
});

test("an empty ledger returns the loader untouched", () => {
  const base = loaderOf([{ id: "a" }]);
  // Byte-identical default path: no wrapper, no behaviour change.
  assert.equal(withoutExcludedCandidates(base, []), base);
  assert.equal(withoutExcludedCandidates(base, undefined), base);
});

test("dismissed records never reach the caller, and metadata survives", async () => {
  const loader = withoutExcludedCandidates(
    loaderOf([{ id: "cafe-0" }, { id: "park-1" }, { id: "way:9" }], {
      loader_status: "ok",
      loader_metadata: { cache: { served_stale: false } },
    }),
    ["cafe-0", "way:9"],
  );

  const records = await loader({ lat: 1, lng: 2 });

  assert.deepEqual(records.map((r) => r.id), ["park-1"]);
  // The honesty layer reads these off the array; filtering must not drop them.
  assert.equal(records.loader_status, "ok");
  assert.deepEqual(records.loader_metadata, { cache: { served_stale: false } });
});

test("exclusion can only subtract — it never adds or reorders", async () => {
  const original = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const loader = withoutExcludedCandidates(loaderOf(original), ["b"]);
  const records = await loader({});

  assert.deepEqual(records.map((r) => r.id), ["a", "c"], "order is preserved");
  assert.ok(records.every((r) => original.includes(r)), "no record is synthesized");
});

test("a loader failure shape is passed through, never turned into an empty success", async () => {
  const failing = async () => ({ loader_status: "error_failed_closed", loader_error: "overpass_down" });
  const wrapped = withoutExcludedCandidates(failing, ["a"]);
  const result = await wrapped({});

  // Silently converting this to [] would read as "this place has nothing".
  assert.equal(Array.isArray(result), false);
  assert.equal(result.loader_status, "error_failed_closed");
});

test("excluding everything yields an empty supply, not a substitute", async () => {
  const loader = withoutExcludedCandidates(loaderOf([{ id: "a" }, { id: "b" }]), ["a", "b"]);
  const records = await loader({});

  // Downstream honesty gates then report an absent day. Nothing is invented.
  assert.deepEqual(records, []);
});

test("the public echo is a count, never the ids themselves", () => {
  const summary = excludedCandidateSummary(["cafe-0", "park-1"]);
  assert.deepEqual(summary, { requested_count: 2 });
  assert.equal(JSON.stringify(summary).includes("cafe-0"), false);
});

test("the module is pure: no network, no clock, no place rules", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../server/planner/excluded-candidates"), "utf8");
  assert.ok(!/\bfetch\b|require\(["']node:(?!.*$)|Date\.now|new Date\b/.test(source));
  assert.ok(!/athens|rome|barcelona/i.test(source));
});
