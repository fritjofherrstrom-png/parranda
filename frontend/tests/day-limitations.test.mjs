import assert from "node:assert/strict";
import test from "node:test";

import { limitationNote } from "../src/lib/day-limitations.mjs";

const en = (_sv, enText) => enText;
const sv = (svText) => svText;

test("a thin day names the number of stops it can stand behind", () => {
  assert.equal(limitationNote(["capped_by_thin_day"], 2, en), "A shorter day — 2 stops we can stand behind.");
  assert.equal(limitationNote(["capped_by_thin_day"], 1, en), "A shorter day — 1 stop we can stand behind.");
});

test("no limitations means no sentence at all", () => {
  assert.equal(limitationNote([], 4, en), "");
  assert.equal(limitationNote(undefined, 4, en), "");
  assert.equal(limitationNote(null, 4, en), "");
});

test("at most two limitations are shown, most consequential first", () => {
  const note = limitationNote(
    [
      "capped_by_partial_context",
      "capped_by_heuristic_walking",
      "capped_by_thin_day",
      "capped_by_unresolved_roles",
    ],
    2,
    en,
  );

  assert.equal(note, "A shorter day — 2 stops we can stand behind. Some kinds of stop we could not find.");
  // The lower-value caveats are dropped rather than stacked.
  assert.ok(!note.includes("day context"));
  assert.ok(!note.includes("estimates"));
});

test("copy is available in both languages and never invents a time", () => {
  const note = limitationNote(["capped_by_thin_day", "capped_by_role_order_fallback"], 3, sv);
  assert.ok(note.startsWith("En kortare dag"));
  assert.doesNotMatch(note, /\d{1,2}[:.]\d{2}/);
});

test("an unknown cap is ignored rather than rendered raw", () => {
  assert.equal(limitationNote(["capped_by_something_new"], 3, en), "");
  assert.equal(limitationNote(["capped_by_something_new", "capped_by_thin_day"], 3, en),
    "A shorter day — 3 stops we can stand behind.");
});

test("the partial-intent cap yields no sentence — a specific surface owns that message", () => {
  // The route section already names the missing intents by label. Repeating a
  // vague version beside a specific one is worse than silence.
  assert.equal(limitationNote(["capped_by_requested_intent_partial"], 3, en), "");
  // It also must not suppress a genuine caveat that shares the day.
  assert.equal(
    limitationNote(["capped_by_requested_intent_partial", "capped_by_thin_day"], 2, en),
    "A shorter day — 2 stops we can stand behind.",
  );
});
