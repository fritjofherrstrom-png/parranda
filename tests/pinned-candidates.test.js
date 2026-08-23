"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_PINNED_IDS,
  applyPinnedSelection,
  parsePinnedCandidateIds,
  summarizePinnedOutcome,
} = require("../server/planner/pinned-candidates");

test("only ids we could have issued are accepted", () => {
  assert.deepEqual(parsePinnedCandidateIds(["osm-way-1", "wikidata-Q7"]), ["osm-way-1", "wikidata-Q7"]);
  assert.deepEqual(
    parsePinnedCandidateIds(["", "  ", "../etc", "a b", "<script>", null, 7, {}, "-lead"]),
    [],
  );
});

test("the ledger is deduped and bounded", () => {
  assert.deepEqual(parsePinnedCandidateIds(["a-1", "a-1"]), ["a-1"]);
  const many = Array.from({ length: MAX_PINNED_IDS + 10 }, (_, i) => `p-${i}`);
  assert.equal(parsePinnedCandidateIds(many).length, MAX_PINNED_IDS);
});

test("a pin selects within the pool and never adds to it", () => {
  const pool = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const out = applyPinnedSelection([pool[0]], pool, ["c"]);

  assert.deepEqual(out.map((s) => s.id), ["c", "a"]);
  // Every stop is a pool member by reference: the pin selects, it never mints.
  assert.ok(out.every((s) => pool.includes(s)), "no stop is synthesized");
});

test("a pin outside the pool has nothing to force — the gate holds structurally", () => {
  const pool = [{ id: "a" }];
  // "gated-out" is simply absent from the pool; there is no code path that
  // could resurrect it, which is why this is a property rather than a check.
  assert.deepEqual(applyPinnedSelection([{ id: "a" }], pool, ["gated-out"]).map((s) => s.id), ["a"]);
});

test("pinning something already chosen changes nothing", () => {
  const selected = [{ id: "a" }, { id: "b" }];
  assert.equal(applyPinnedSelection(selected, selected, ["a"]), selected);
});

test("no pins returns the selection untouched", () => {
  const selected = [{ id: "a" }];
  assert.equal(applyPinnedSelection(selected, [{ id: "a" }, { id: "b" }], []), selected);
});

test("a pin is matched on any id the stop carries", () => {
  const pool = [{ candidate_id: "cand-1" }, { place_id: "place-2" }];
  assert.equal(applyPinnedSelection([], pool, ["cand-1"]).length, 1);
  assert.equal(applyPinnedSelection([], pool, ["place-2"]).length, 1);
});

test("the outcome is derived from the day, not from the intention", () => {
  // What matters is what the composed day actually contains — an unhonoured pin
  // is a fact about the output.
  assert.deepEqual(summarizePinnedOutcome(["a", "b"], [{ id: "a" }]), {
    requested_count: 2,
    honored_count: 1,
    unhonored_count: 1,
  });
  assert.deepEqual(summarizePinnedOutcome([], [{ id: "a" }]), {
    requested_count: 0,
    honored_count: 0,
    unhonored_count: 0,
  });
});

test("the module is pure: no network, no clock, no place rules", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../server/planner/pinned-candidates"), "utf8");
  assert.ok(!/\bfetch\b|Date\.now|new Date\b/.test(source));
  assert.ok(!/athens|rome|barcelona/i.test(source));
});

// --------------------------------------------------------------------------
// The per-role ranking cut.
//
// Found on staging: a pinned place that WAS loaded, gated and ranked for its
// role still could not be kept, because two better-scoring places filled the
// role's top-N and the cut removed it before anything downstream could hoist
// it. The engine reported it honestly as unhonoured — but the reason was a
// ranking bound, not a trust one, and nothing the user could see or act on.
// --------------------------------------------------------------------------

const { keepPinnedEntriesInRole } = require("../server/planner/role-selector");

const entry = (id) => ({ candidate: { id } });

test("an unpinned role keeps exactly its top-N, unchanged", () => {
  const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
  assert.deepStrictEqual(
    keepPinnedEntriesInRole(entries, 3, new Set()).map((e) => e.candidate.id),
    ["a", "b", "c"],
  );
  // No pins at all must be byte-identical to the old slice.
  assert.deepStrictEqual(keepPinnedEntriesInRole(entries, 3, null), entries.slice(0, 3));
});

test("a pinned entry below the cut is re-admitted", () => {
  const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
  assert.deepStrictEqual(
    keepPinnedEntriesInRole(entries, 3, new Set(["d"])).map((e) => e.candidate.id),
    ["a", "b", "c", "d"],
  );
});

test("re-admission never reorders or displaces the ranking", () => {
  // The pin joins the role's options; it does not become the role's choice.
  const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
  const kept = keepPinnedEntriesInRole(entries, 3, new Set(["d"]));
  assert.deepStrictEqual(kept.slice(0, 3), entries.slice(0, 3));
  assert.strictEqual(kept[3], entries[3], "the rescued entry is the ranked one, not a copy");
});

test("a pin already above the cut adds nothing", () => {
  const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
  assert.deepStrictEqual(
    keepPinnedEntriesInRole(entries, 3, new Set(["b"])).map((e) => e.candidate.id),
    ["a", "b", "c"],
  );
});

test("a pin this role never ranked stays out", () => {
  // Re-admission draws ONLY from the entries the gates already ranked for the
  // role — a pin cannot introduce a place or move it into a role it fails.
  const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
  assert.deepStrictEqual(
    keepPinnedEntriesInRole(entries, 3, new Set(["zzz"])).map((e) => e.candidate.id),
    ["a", "b", "c"],
  );
});

test("a role shorter than the cut is returned untouched", () => {
  const entries = [entry("a"), entry("b")];
  assert.deepStrictEqual(keepPinnedEntriesInRole(entries, 3, new Set(["a"])), entries.slice(0, 3));
});

test("the agnostic role payload carries the pins", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../server/planner/agnostic-route-output.js"), "utf8");
  assert.match(source, /pinnedIds: Array\.isArray\(pinnedStopIds\) \? pinnedStopIds : \[\],/);
  const roleSource = fs.readFileSync(require.resolve("../server/planner/role-selector.js"), "utf8");
  assert.match(roleSource, /keepPinnedEntriesInRole\(entries, limitPerRole, pinnedIds\)/);
});
