/**
 * Restoring used to drop the ledger outright, and that was honest: saved days
 * carried no record of what they were composed under, so a same-place snapshot
 * would have inherited whatever the live ledger happened to hold.
 *
 * Persisting it does not relax that rule — it gives the day something to answer
 * WITH. Everything below is about when a stored record is allowed to speak for
 * the stops on screen, and the default at every fork is silence.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMITMENT_SNAPSHOT_VERSION,
  MAX_SNAPSHOT_EXCLUSIONS,
  MAX_SNAPSHOT_PINS,
  buildCommitmentSnapshot,
  readCommitmentSnapshot,
} from "../src/lib/commitment-snapshot.mjs";

const KEY = "place:trogir";
const entries = { a: { kind: "pin", label: "Alpha" }, b: { kind: "exclude", label: "Beta" } };
const appliedPins = [{ id: "a", kind: "pin", label: "Alpha" }];

test("a day records the ledger it carried and the verdict it got back", () => {
  const snapshot = buildCommitmentSnapshot({ anchorKey: KEY, entries, appliedPins });
  assert.equal(snapshot.version, COMMITMENT_SNAPSHOT_VERSION);
  assert.equal(snapshot.anchorKey, KEY);
  assert.deepEqual(snapshot.entries, entries);
  assert.deepEqual(snapshot.appliedPins, appliedPins);
});

test("the record is a copy, not a view of the live ledger", () => {
  // A day that has already been answered must not change afterwards because
  // the user edited something else.
  const live = { a: { kind: "pin", label: "Alpha" } };
  const snapshot = buildCommitmentSnapshot({ anchorKey: KEY, entries: live, appliedPins: [] });
  live.a.label = "Renamed";
  live.c = { kind: "pin", label: "Later" };
  assert.deepEqual(snapshot.entries, { a: { kind: "pin", label: "Alpha" } });
});

test("a day with nothing to say records nothing", () => {
  assert.equal(buildCommitmentSnapshot({ anchorKey: KEY, entries: {}, appliedPins: [] }), null);
  // And without an anchor there is no scope to record it against.
  assert.equal(buildCommitmentSnapshot({ anchorKey: null, entries, appliedPins }), null);
});

test("a record only speaks for its own anchor", () => {
  const snapshot = buildCommitmentSnapshot({ anchorKey: KEY, entries, appliedPins });
  const same = readCommitmentSnapshot(snapshot, { anchorKey: KEY });
  assert.equal(same.applies, true);
  assert.deepEqual(same.entries, entries);
  assert.deepEqual(same.appliedPins, appliedPins);

  const elsewhere = readCommitmentSnapshot(snapshot, { anchorKey: "place:kotor" });
  assert.equal(elsewhere.applies, false);
  assert.equal(elsewhere.reason, "anchor_changed");
  assert.deepEqual(elsewhere.entries, {});
  assert.deepEqual(elsewhere.appliedPins, []);
});

test("a day saved before this existed carries no commitments", () => {
  // The whole installed base, and the reason failing closed had to be the
  // default rather than an error case.
  for (const legacy of [null, undefined, {}, { entries, appliedPins }]) {
    const read = readCommitmentSnapshot(legacy, { anchorKey: KEY });
    assert.equal(read.applies, false, `${JSON.stringify(legacy)} must not apply`);
    assert.deepEqual(read.entries, {});
  }
  assert.equal(readCommitmentSnapshot(null, { anchorKey: KEY }).reason, "absent");
  assert.equal(
    readCommitmentSnapshot({ version: 999, anchorKey: KEY, entries, appliedPins }, { anchorKey: KEY }).reason,
    "version_mismatch",
    "an unknown version is refused, never guessed at",
  );
});

test("malformed storage fails closed rather than part-way", () => {
  // localStorage is editable by anyone with the console open, and a truncated
  // write is indistinguishable from a hostile one.
  const cases = [
    "not an object",
    42,
    { version: COMMITMENT_SNAPSHOT_VERSION },
    { version: COMMITMENT_SNAPSHOT_VERSION, anchorKey: "", entries, appliedPins },
    { version: COMMITMENT_SNAPSHOT_VERSION, anchorKey: KEY, entries: "nope", appliedPins: "nope" },
    { version: COMMITMENT_SNAPSHOT_VERSION, anchorKey: KEY, entries: { a: { kind: "sudo" } }, appliedPins: [] },
  ];
  for (const bad of cases) {
    const read = readCommitmentSnapshot(bad, { anchorKey: KEY });
    assert.equal(read.applies, false, `${JSON.stringify(bad)} must not apply`);
    assert.deepEqual(read.entries, {});
    assert.deepEqual(read.appliedPins, []);
  }
});

test("a record that has been tampered with is re-normalised, not trusted", () => {
  // Read applies the same rules as write, so anything that would not have been
  // written cannot be read back in.
  const tampered = {
    version: COMMITMENT_SNAPSHOT_VERSION,
    anchorKey: KEY,
    entries: { good: { kind: "pin", label: "Good" }, bad: { kind: "elevate", label: "Bad" } },
    appliedPins: [{ id: "good", kind: "pin", label: "Good" }, { id: "", kind: "pin", label: "Ghost" }],
  };
  const read = readCommitmentSnapshot(tampered, { anchorKey: KEY });
  assert.equal(read.applies, true);
  assert.deepEqual(Object.keys(read.entries), ["good"], "the unknown kind is dropped, not honoured");
  assert.deepEqual(read.appliedPins.map((p) => p.id), ["good"]);
});

test("storage stays bounded, in the same shape the server would accept", () => {
  // This sits in localStorage beside up to SAVED_CAP days, and a ledger is user
  // input. Storing more than the server would ever take is storage spent on
  // something that could not be sent.
  const many = {};
  for (let i = 0; i < MAX_SNAPSHOT_PINS + 20; i += 1) many[`pin-${i}`] = { kind: "pin", label: `P${i}` };
  for (let i = 0; i < MAX_SNAPSHOT_EXCLUSIONS + 20; i += 1) many[`ex-${i}`] = { kind: "exclude", label: `E${i}` };
  const snapshot = buildCommitmentSnapshot({
    anchorKey: KEY,
    entries: many,
    appliedPins: Array.from({ length: MAX_SNAPSHOT_PINS + 20 }, (_, i) => ({ id: `pin-${i}`, kind: "pin", label: "x" })),
  });

  const kinds = Object.values(snapshot.entries).map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === "pin").length, MAX_SNAPSHOT_PINS);
  assert.equal(kinds.filter((k) => k === "exclude").length, MAX_SNAPSHOT_EXCLUSIONS);
  assert.equal(snapshot.appliedPins.length, MAX_SNAPSHOT_PINS);

  const longLabel = buildCommitmentSnapshot({
    anchorKey: KEY,
    entries: { a: { kind: "pin", label: "x".repeat(5000) } },
    appliedPins: [],
  });
  assert.ok(longLabel.entries.a.label.length <= 120, "labels cannot grow without bound either");
});
