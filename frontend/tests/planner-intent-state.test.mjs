import test from "node:test";
import assert from "node:assert/strict";
import * as intent from "../../shared/planner-intent.mjs";
import { ANYWHERE_PREFERENCES } from "../src/lib/anywhere-payload.mjs";

const defaults = ["food", "culture", "views"];

test("priority normalization preserves neutral legacy defaults and only known selected keys", () => {
  assert.deepEqual(intent.PLANNER_PREFERENCE_KEYS, ANYWHERE_PREFERENCES.map(({ key }) => key));
  for (const value of [undefined, null, [], "food,culture,views", ["unknown"], ["fika"]]) {
    assert.deepEqual(intent.normalizePreferencePriority(value, defaults), []);
  }
  assert.deepEqual(intent.normalizePreferencePriority(["views", "views", "unknown", "food"], defaults),
    ["views", "food", "culture"]);
  assert.deepEqual(intent.normalizePreferencePriority(["culture"], ["food", "evil", "culture", "food"]),
    ["culture", "food"]);
  assert.deepEqual(intent.normalizePreferencePriority(["food"], null), []);
});

test("the first genuinely new selection outranks neutral defaults without reordering their selection", () => {
  const before = { selected: [...defaults], preferencePriority: [] };
  const after = intent.togglePreferenceSelection(before, "fika");
  assert.deepEqual(after, {
    selected: ["food", "culture", "views", "fika"],
    preferencePriority: ["fika", "food", "culture", "views"],
  });
  assert.deepEqual(before, { selected: defaults, preferencePriority: [] }, "state transitions are immutable");
});

test("new choices append after an existing explicit priority", () => {
  assert.deepEqual(intent.togglePreferenceSelection({
    selected: ["food", "views"], preferencePriority: ["views", "food"],
  }, "culture"), {
    selected: ["food", "views", "culture"], preferencePriority: ["views", "food", "culture"],
  });
});

test("deselection compacts explicit ranks but leaves a neutral selection neutral", () => {
  assert.deepEqual(intent.togglePreferenceSelection({ selected: defaults, preferencePriority: [] }, "food"),
    { selected: ["culture", "views"], preferencePriority: [] });
  assert.deepEqual(intent.togglePreferenceSelection({
    selected: defaults, preferencePriority: ["views", "food", "culture"],
  }, "food"), { selected: ["culture", "views"], preferencePriority: ["views", "culture"] });
  assert.deepEqual(intent.togglePreferenceSelection({ selected: ["food"], preferencePriority: ["food"] }, "food"),
    { selected: [], preferencePriority: [] });
});

test("selection rejects unknown keys and does not mutate malformed input", () => {
  assert.deepEqual(intent.togglePreferenceSelection({ selected: defaults }, "scenic"),
    { selected: defaults, preferencePriority: [] });
  assert.deepEqual(intent.togglePreferenceSelection({ selected: ["food", "food", "evil"], preferencePriority: [] }, null),
    { selected: ["food"], preferencePriority: [] });
  assert.deepEqual(intent.togglePreferenceSelection(undefined, "green"),
    { selected: ["green"], preferencePriority: ["green"] });
});

test("promotion from neutral makes only the chosen selected interest first", () => {
  const state = { selected: defaults, preferencePriority: [] };
  assert.deepEqual(intent.promotePreference(state, "culture"), {
    selected: defaults, preferencePriority: ["culture", "food", "views"],
  });
  assert.deepEqual(state, { selected: defaults, preferencePriority: [] });
});

test("promotion moves an explicitly ranked interest one step rather than changing route or chip order", () => {
  const state = { selected: defaults, preferencePriority: ["views", "food", "culture"] };
  assert.deepEqual(intent.promotePreference(state, "culture"), {
    selected: defaults, preferencePriority: ["views", "culture", "food"],
  });
  assert.deepEqual(intent.promotePreference(state, "views"), state, "rank one is already first");
  assert.deepEqual(intent.promotePreference(state, "fika"), state, "unselected interests cannot be promoted");
  assert.deepEqual(intent.promotePreference(state, "unknown"), state);
  assert.deepEqual(state.preferencePriority, ["views", "food", "culture"]);
});

const edit = (overrides = {}) => ({
  version: 1, action: "replace", candidate_id: "poi:old",
  retained_candidate_ids: ["poi:z", "poi:a"], target_stop_count: 3, slot_index: 1,
  replacement_preference: "culture", removed_candidate_ids: ["poi:old"], ...overrides,
});

test("day-edit canonicalization preserves retained order, strips provenance and sorts the removed set", () => {
  const raw = edit({ removed_candidate_ids: ["poi:other", "poi:old"], provenance: { verified: true }, token: "secret" });
  const actual = intent.normalizeDayEdit(raw);
  assert.deepEqual(actual, edit({ removed_candidate_ids: ["poi:old", "poi:other"] }));
  assert.deepEqual(intent.normalizeDayEdit(actual), actual, "canonicalization is idempotent");
  assert.equal(Object.getPrototypeOf(actual), Object.prototype);
  raw.retained_candidate_ids.reverse();
  raw.removed_candidate_ids.reverse();
  assert.deepEqual(actual.retained_candidate_ids, ["poi:z", "poi:a"]);
});

test("day-edit accepts exact edge bounds including removing the final stop", () => {
  assert.deepEqual(intent.normalizeDayEdit(edit({ action: "remove", retained_candidate_ids: [],
    target_stop_count: 0, slot_index: 0, replacement_preference: null })),
    edit({ action: "remove", retained_candidate_ids: [], target_stop_count: 0, slot_index: 0, replacement_preference: null }));
  const maximum = edit({ candidate_id: "x".repeat(200), action: "remove",
    retained_candidate_ids: ["0", "1", "2", "3", "4", "5"], target_stop_count: 6, slot_index: 5,
    removed_candidate_ids: Array.from({ length: 12 }, (_, i) => `gone:${String(i).padStart(2, "0")}`) });
  assert.deepEqual(intent.normalizeDayEdit(maximum), maximum);
  assert.deepEqual(intent.normalizeDayEdit(Object.assign(Object.create(null), edit())), edit());
});

test("day-edit rejects malformed schema, overlaps, duplicate IDs and inconsistent counts", () => {
  const malformed = [
    undefined, null, [], "edit", new Date(), Object.create(edit()),
    edit({ version: 2 }), edit({ version: "1" }), edit({ action: "append" }),
    edit({ candidate_id: "" }), edit({ candidate_id: " " }), edit({ candidate_id: " poi:old" }),
    edit({ candidate_id: "x".repeat(201) }), edit({ candidate_id: "poi:\nold" }),
    edit({ retained_candidate_ids: ["poi:old"] }), edit({ retained_candidate_ids: ["poi:a", "poi:a"] }),
    edit({ removed_candidate_ids: ["poi:a"] }), edit({ removed_candidate_ids: ["poi:old", "poi:old"] }),
    edit({ removed_candidate_ids: Array.from({ length: 13 }, (_, i) => `gone:${i}`) }),
    edit({ retained_candidate_ids: Array.from({ length: 7 }, (_, i) => `kept:${i}`) }),
    edit({ retained_candidate_ids: "poi:a" }), edit({ removed_candidate_ids: null }),
    edit({ retained_candidate_ids: new Array(2) }), edit({ removed_candidate_ids: new Array(1) }),
    edit({ removed_candidate_ids: [null] }), edit({ retained_candidate_ids: [" "] }),
    edit({ target_stop_count: 2 }), edit({ target_stop_count: 7 }), edit({ target_stop_count: -1 }),
    edit({ target_stop_count: 3.5 }), edit({ target_stop_count: "3" }),
    edit({ slot_index: -1 }), edit({ slot_index: 6 }), edit({ slot_index: 1.5 }), edit({ slot_index: "1" }),
    edit({ replacement_preference: "scenic" }), edit({ replacement_preference: undefined }),
    ...[null, 1, 0, "true", "false", {}, []].map(preserve_retained => edit({ preserve_retained })),
  ];
  for (const bad of malformed) assert.equal(intent.normalizeDayEdit(bad), null, String(bad));
});

test("day-edit preserves only explicit false for later Adjust", () => {
  assert.deepEqual(intent.normalizeDayEdit(edit({ preserve_retained: false })), edit({ preserve_retained: false }));
  assert.deepEqual(intent.normalizeDayEdit(edit({ preserve_retained: true })), edit());
  assert.deepEqual(intent.normalizeDayEdit(edit()), edit());
});
