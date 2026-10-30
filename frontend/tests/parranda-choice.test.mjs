import assert from "node:assert/strict";
import test from "node:test";

import { buildAnywherePayload } from "../src/lib/anywhere-payload.mjs";
import { PARRANDA_CHOOSES_FLAG_KEY, parrandaChoiceView, readParrandaChoosesFlag } from "../src/lib/parranda-choice.mjs";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  };
}

test("the experiment flag is off by default and follows the URL, then memory", () => {
  assert.equal(readParrandaChoosesFlag({ search: "", storage: memoryStorage() }), false);
  const storage = memoryStorage();
  assert.equal(readParrandaChoosesFlag({ search: "?parranda_chooses=1", storage }), true);
  assert.equal(storage.map.get(PARRANDA_CHOOSES_FLAG_KEY), "1");
  assert.equal(readParrandaChoosesFlag({ search: "?place=x", storage }), true, "remembered");
  assert.equal(readParrandaChoosesFlag({ search: "?parranda_chooses=0", storage }), false);
  assert.equal(readParrandaChoosesFlag({ search: "", storage }), false, "forgotten");
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
  assert.equal(readParrandaChoosesFlag({ search: "", storage: throwing }), false);
  assert.equal(readParrandaChoosesFlag({ search: "?parranda_chooses=1", storage: throwing }), true, "the URL still decides");
});

test("intent_mode is sent only when chosen and only without the reader's own picks", () => {
  const base = { place: "Testville", dates: ["2026-10-22"], dayRhythm: "free" };
  assert.equal("intent_mode" in buildAnywherePayload({ ...base, preferences: [] }), false, "default request unchanged");
  assert.equal(buildAnywherePayload({ ...base, preferences: [], intentMode: "parranda_chooses" }).intent_mode, "parranda_chooses");
  assert.equal("intent_mode" in buildAnywherePayload({ ...base, preferences: ["food"], intentMode: "parranda_chooses" }), false,
    "explicit picks win");
  assert.equal("intent_mode" in buildAnywherePayload({ ...base, preferences: [], intentMode: "surprise" }), false);
});

const block = (extra = {}) => ({
  mode: "parranda_chooses",
  status: "chosen",
  auto_intents: [
    { intent: "food", reasons: ["strong_local_supply", "fits_evening", "rain_favors_indoor"], evidence: { usable_count: 5, counted_up_to: 6 } },
    { intent: "green", reasons: ["enough_local_supply", "independently_corroborated"], evidence: { usable_count: 6, counted_up_to: 6 } },
    { intent: "culture", reasons: ["matches_live_event_today", "fits_afternoon"], evidence: { usable_count: 3 } },
  ],
  notes: [],
  ...extra,
});

test("each pick gets its label and its most telling server reason", () => {
  const en = parrandaChoiceView(block(), "en");
  assert.deepEqual(en.picks, [
    { key: "food", label: "Food & drink", reason: "Indoors while it rains" },
    { key: "green", label: "Green & walks", reason: "6+ places nearby" },
    { key: "culture", label: "Culture", reason: "Fits tonight's event" },
  ]);
  assert.equal(en.note, null);
  const sv = parrandaChoiceView(block(), "sv");
  assert.equal(sv.picks[0].reason, "Inomhus när det regnar");
  assert.equal(sv.picks[1].reason, "6+ platser i närheten");
});

test("thin, empty and fallen-back choices say so; other blocks show nothing", () => {
  assert.match(parrandaChoiceView(block({ status: "thin_supply" }), "en").note, /fewer directions/);
  assert.match(parrandaChoiceView(block({ status: "thin_supply", auto_intents: [] }), "en").note, /Too few places/);
  assert.match(parrandaChoiceView(block({ status: "no_supported_interest", auto_intents: [] }), "sv").note, /För få platser/);
  assert.match(parrandaChoiceView(block({ status: "focus_fell_back_to_varied_day" }), "en").note, /mixed day/);
  assert.equal(parrandaChoiceView(block({ status: "ignored_explicit_preferences", auto_intents: [] }), "en"), null);
  assert.equal(parrandaChoiceView(null), null);
  assert.equal(parrandaChoiceView({ mode: "other", status: "chosen" }), null);
  const unknown = parrandaChoiceView(block({ auto_intents: [{ intent: "made_up", reasons: [] }, { intent: "fika", reasons: ["new_code"] }] }), "en");
  assert.deepEqual(unknown.picks, [{ key: "fika", label: "Coffee", reason: null }], "unknown interests are dropped, unknown reasons stay silent");
});
