/**
 * Saved-day retention rules — pure, so the identity/dedupe/cap logic is tested
 * without a DOM or localStorage.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSavedEntry,
  savedEntryId,
  upsertSaved,
  removeSaved,
  SAVED_CAP,
} from "../src/lib/anywhere-storage.mjs";

function entry(place, prefs, savedAt = "2026-07-03T10:00:00Z") {
  return buildSavedEntry({
    place,
    dateIso: "2026-07-03",
    savedAt,
    safeResponse: { place_structure: {} },
    classification: { status: "composed" },
    inputs: { place, mode: "typed", dayOffset: 0, walkKey: "balanced", selected: prefs },
  });
}

test("the id is place + date + sorted preferences (re-saving the same query replaces it)", () => {
  const a = entry("Lyon", ["food", "views"]);
  const b = entry("Lyon", ["views", "food"]); // same set, different order
  assert.equal(a.id, b.id, "preference order does not create a new identity");
  const c = entry("Lyon", ["food"]);
  assert.notEqual(a.id, c.id, "different preferences → different day");
  const d = entry("Porto", ["food", "views"]);
  assert.notEqual(a.id, d.id, "different place → different day");
});

test("walking preset is part of saved-day identity and normalizes fail-closed", () => {
  const base = { place: "Lyon", dateIso: "2026-07-03", selected: ["food"] };
  const balanced = savedEntryId({ ...base, walkKey: "balanced" });
  assert.equal(savedEntryId(base), balanced, "the product default is balanced when old callers omit it");
  assert.equal(savedEntryId({ ...base, walkKey: "unknown" }), balanced, "unknown presets cannot mint identities");
  assert.notEqual(savedEntryId({ ...base, walkKey: "short" }), balanced);
  assert.notEqual(savedEntryId({ ...base, walkKey: "long" }), balanced);

  const short = buildSavedEntry({
    ...base,
    inputs: { selected: base.selected, walkKey: "short" },
  });
  const long = buildSavedEntry({
    ...base,
    inputs: { selected: base.selected, walkKey: "long" },
  });
  assert.notEqual(short.id, long.id, "the entry builder and identity helper share the same effective walk key");

  const variants = upsertSaved(upsertSaved([], short), long);
  assert.equal(variants.length, 2, "short and long variants are retained as separate saved days");
  assert.deepEqual(new Set(variants.map((saved) => saved.id)), new Set([short.id, long.id]));
});

test("legacy saved entries remain readable without rewriting their old id", () => {
  const legacy = { id: "Lyon::2026-07-03::food", place: "Lyon", inputs: { selected: ["food"] } };
  assert.deepEqual(upsertSaved([], legacy), [legacy]);
});

test("a coords day (no place) gets a stable non-empty id + label", () => {
  const e = buildSavedEntry({ dateIso: "2026-07-03", inputs: { selected: ["food"] } });
  assert.ok(e.id.startsWith("pos::"));
  assert.equal(e.label, "Min position");
});

test("upsert is newest-first, de-duplicated by id, and capped", () => {
  let list = [];
  list = upsertSaved(list, entry("Lyon", ["food"], "2026-07-03T10:00:00Z"));
  list = upsertSaved(list, entry("Porto", ["food"], "2026-07-03T11:00:00Z"));
  assert.deepEqual(list.map((e) => e.place), ["Porto", "Lyon"], "newest first");

  // Re-saving Lyon moves it to front, no duplicate.
  list = upsertSaved(list, entry("Lyon", ["food"], "2026-07-03T12:00:00Z"));
  assert.deepEqual(list.map((e) => e.place), ["Lyon", "Porto"]);
  assert.equal(list.length, 2, "no duplicate for the same id");

  // Cap.
  for (let i = 0; i < SAVED_CAP + 5; i += 1) list = upsertSaved(list, entry(`City${i}`, ["food"]));
  assert.equal(list.length, SAVED_CAP, "list is capped");
});

test("removeSaved drops exactly the matching id", () => {
  const a = entry("Lyon", ["food"]);
  const b = entry("Porto", ["food"]);
  const list = removeSaved([a, b], a.id);
  assert.deepEqual(list.map((e) => e.place), ["Porto"]);
});
