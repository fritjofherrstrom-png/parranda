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
const DAY = "Trogir::2026-08-24::culture,food";
const entries = { a: { kind: "pin", label: "Alpha" }, b: { kind: "exclude", label: "Beta" } };
const appliedPins = [{ id: "a", kind: "pin", label: "Alpha" }];
const refusals = [{ id: "a", reason: "walking_budget" }];

test("a day records the ledger it carried and the verdict it got back", () => {
  const snapshot = buildCommitmentSnapshot({ anchorKey: KEY, dayKey: DAY, entries, appliedPins, refusals });
  assert.equal(snapshot.version, COMMITMENT_SNAPSHOT_VERSION);
  assert.equal(snapshot.anchorKey, KEY);
  assert.deepEqual(snapshot.entries, entries);
  assert.deepEqual(snapshot.appliedPins, appliedPins);
  assert.deepEqual(snapshot.refusals, refusals, "the server-owned reason is part of the same frozen verdict");

  const restored = readCommitmentSnapshot(snapshot, { anchorKey: KEY, dayKey: DAY });
  assert.deepEqual(restored.refusals, refusals, "the reason round-trips with its day");
});

test("the record is a copy, not a view of the live ledger", () => {
  // A day that has already been answered must not change afterwards because
  // the user edited something else.
  const live = { a: { kind: "pin", label: "Alpha" } };
  const snapshot = buildCommitmentSnapshot({ anchorKey: KEY, dayKey: DAY, entries: live, appliedPins: [] });
  live.a.label = "Renamed";
  live.c = { kind: "pin", label: "Later" };
  assert.deepEqual(snapshot.entries, { a: { kind: "pin", label: "Alpha" } });
});

test("a day with nothing to say records nothing", () => {
  assert.equal(buildCommitmentSnapshot({ anchorKey: KEY, dayKey: DAY, entries: {}, appliedPins: [] }), null);
  // And without an anchor there is no scope to record it against.
  assert.equal(buildCommitmentSnapshot({ anchorKey: null, dayKey: DAY, entries, appliedPins }), null);
});

test("refusal storage is bounded to this day's applied pins and safe tokens", () => {
  const snapshot = buildCommitmentSnapshot({
    anchorKey: KEY,
    dayKey: DAY,
    entries,
    appliedPins,
    refusals: [
      { id: "other", reason: "walking_budget" },
      { id: "a", reason: "future_reason" },
      { id: "a", reason: "not_selected" },
      { id: "a", reason: "free text is not a token" },
      { id: "a", reason: `x${"_".repeat(80)}` },
    ],
  });

  assert.deepEqual(snapshot.refusals, [
    { id: "a", reason: "future_reason" },
  ], "the first safe server token wins and unrelated or unsafe records are discarded");
});

test("a record only speaks for its own anchor", () => {
  const snapshot = buildCommitmentSnapshot({ anchorKey: KEY, dayKey: DAY, entries, appliedPins });
  const same = readCommitmentSnapshot(snapshot, { anchorKey: KEY, dayKey: DAY });
  assert.equal(same.applies, true);
  assert.deepEqual(same.entries, entries);
  assert.deepEqual(same.appliedPins, appliedPins);

  const elsewhere = readCommitmentSnapshot(snapshot, { anchorKey: "place:kotor", dayKey: DAY });
  assert.equal(elsewhere.applies, false);
  assert.equal(elsewhere.reason, "anchor_changed");
  assert.deepEqual(elsewhere.entries, {});
  assert.deepEqual(elsewhere.appliedPins, []);
});

test("a day saved before this existed carries no commitments", () => {
  // The whole installed base, and the reason failing closed had to be the
  // default rather than an error case.
  for (const legacy of [null, undefined, {}, { entries, appliedPins }]) {
    const read = readCommitmentSnapshot(legacy, { anchorKey: KEY, dayKey: DAY });
    assert.equal(read.applies, false, `${JSON.stringify(legacy)} must not apply`);
    assert.deepEqual(read.entries, {});
  }
  assert.equal(readCommitmentSnapshot(null, { anchorKey: KEY, dayKey: DAY }).reason, "absent");
  assert.equal(
    readCommitmentSnapshot({ version: 999, anchorKey: KEY, dayKey: DAY, entries, appliedPins }, { anchorKey: KEY, dayKey: DAY }).reason,
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
    { version: COMMITMENT_SNAPSHOT_VERSION, anchorKey: "", dayKey: DAY, entries, appliedPins },
    { version: COMMITMENT_SNAPSHOT_VERSION, anchorKey: KEY, dayKey: "", entries, appliedPins },
    { version: COMMITMENT_SNAPSHOT_VERSION, anchorKey: KEY, dayKey: DAY, entries: "nope", appliedPins: "nope" },
    { version: COMMITMENT_SNAPSHOT_VERSION, anchorKey: KEY, dayKey: DAY, entries: { a: { kind: "sudo" } }, appliedPins: [] },
  ];
  for (const bad of cases) {
    const read = readCommitmentSnapshot(bad, { anchorKey: KEY, dayKey: DAY });
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
    dayKey: DAY,
    entries: { good: { kind: "pin", label: "Good" }, bad: { kind: "elevate", label: "Bad" } },
    appliedPins: [{ id: "good", kind: "pin", label: "Good" }, { id: "", kind: "pin", label: "Ghost" }],
  };
  const read = readCommitmentSnapshot(tampered, { anchorKey: KEY, dayKey: DAY });
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
    dayKey: DAY,
    entries: many,
    appliedPins: Array.from({ length: MAX_SNAPSHOT_PINS + 20 }, (_, i) => ({ id: `pin-${i}`, kind: "pin", label: "x" })),
  });

  const kinds = Object.values(snapshot.entries).map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === "pin").length, MAX_SNAPSHOT_PINS);
  assert.equal(kinds.filter((k) => k === "exclude").length, MAX_SNAPSHOT_EXCLUSIONS);
  assert.equal(snapshot.appliedPins.length, MAX_SNAPSHOT_PINS);

  const longLabel = buildCommitmentSnapshot({
    anchorKey: KEY,
    dayKey: DAY,
    entries: { a: { kind: "pin", label: "x".repeat(5000) } },
    appliedPins: [],
  });
  assert.ok(longLabel.entries.a.label.length <= 120, "labels cannot grow without bound either");
});

// --------------------------------------------------------------------------
// The anchor says WHERE. The day key says WHICH DAY at that anchor.
//
// v1 bound only the anchor, so an intact record written for Thursday was
// accepted on Friday's day for the same place, and one written under one set of
// preferences was accepted under another. Same geography, different question —
// and the stops on screen had never answered it.
// --------------------------------------------------------------------------

import { savedEntryId } from "../src/lib/anywhere-storage.mjs";

test("a record does not carry between two days at the same anchor", () => {
  const thursday = savedEntryId({ place: "Trogir", dateIso: "2026-08-24", selected: ["food", "culture"] });
  const friday = savedEntryId({ place: "Trogir", dateIso: "2026-08-25", selected: ["food", "culture"] });
  const otherPrefs = savedEntryId({ place: "Trogir", dateIso: "2026-08-24", selected: ["views"] });
  assert.notEqual(thursday, friday);
  assert.notEqual(thursday, otherPrefs);

  const forThursday = buildCommitmentSnapshot({ anchorKey: KEY, dayKey: thursday, entries, appliedPins });
  const forFriday = buildCommitmentSnapshot({ anchorKey: KEY, dayKey: friday, entries, appliedPins });

  // Each on its own day: fine.
  assert.equal(readCommitmentSnapshot(forThursday, { anchorKey: KEY, dayKey: thursday }).applies, true);
  assert.equal(readCommitmentSnapshot(forFriday, { anchorKey: KEY, dayKey: friday }).applies, true);

  // Swapped between two perfectly valid, same-anchor days: refused both ways.
  const swappedForward = readCommitmentSnapshot(forThursday, { anchorKey: KEY, dayKey: friday });
  assert.equal(swappedForward.applies, false);
  assert.equal(swappedForward.reason, "day_changed");
  assert.deepEqual(swappedForward.entries, {});
  assert.deepEqual(swappedForward.appliedPins, []);
  assert.equal(readCommitmentSnapshot(forFriday, { anchorKey: KEY, dayKey: thursday }).applies, false);

  // Same place, same date, different preferences is also a different day.
  assert.equal(readCommitmentSnapshot(forThursday, { anchorKey: KEY, dayKey: otherPrefs }).reason, "day_changed");
});

test("a v1 record cannot say which day it belongs to, so it carries nothing", () => {
  // Rather than infer a day key for it — which is exactly the inference this
  // module exists to prevent — a v1 snapshot fails closed to no ledger.
  const v1 = { version: 1, anchorKey: KEY, entries, appliedPins };
  const read = readCommitmentSnapshot(v1, { anchorKey: KEY, dayKey: DAY });
  assert.equal(read.applies, false);
  assert.equal(read.reason, "version_mismatch");
  assert.deepEqual(read.entries, {});
});

test("a record without a day key is never written in the first place", () => {
  assert.equal(buildCommitmentSnapshot({ anchorKey: KEY, dayKey: null, entries, appliedPins }), null);
  assert.equal(buildCommitmentSnapshot({ anchorKey: KEY, dayKey: "  ", entries, appliedPins }), null);
});
