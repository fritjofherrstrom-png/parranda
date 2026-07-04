/**
 * Saved-day retention rules — pure, so the identity/dedupe/cap logic is tested
 * without a DOM or localStorage.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildSavedEntry, upsertSaved, removeSaved, SAVED_CAP } from "../src/lib/anywhere-storage.mjs";

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
