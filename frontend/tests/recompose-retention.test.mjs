import assert from "node:assert/strict";
import test from "node:test";

import {
  anchorKey,
  planRecomposeRetention,
  staleDayNotice,
} from "../src/lib/recompose-retention.mjs";

const SAME = { place: "Somewhere" };

test("a valid day for the same anchor is held while the next one composes", () => {
  for (const status of ["composed", "composed_limited"]) {
    const plan = planRecomposeRetention({
      previousStatus: status,
      previousAnchorKey: anchorKey(SAME),
      nextAnchorKey: anchorKey(SAME),
    });
    assert.equal(plan.keepPrevious, true, status);
    assert.equal(plan.reason, "same_anchor_recompose", status);
  }
});

test("a day for another place is never held over", () => {
  const plan = planRecomposeRetention({
    previousStatus: "composed",
    previousAnchorKey: anchorKey({ place: "Somewhere" }),
    nextAnchorKey: anchorKey({ place: "Elsewhere" }),
  });

  assert.equal(plan.keepPrevious, false);
  assert.equal(plan.reason, "anchor_changed");
});

test("only an actual day is worth holding", () => {
  for (const status of ["structure_only", "unavailable", null]) {
    const plan = planRecomposeRetention({
      previousStatus: status,
      previousAnchorKey: anchorKey(SAME),
      nextAnchorKey: anchorKey(SAME),
    });
    assert.equal(plan.keepPrevious, false, String(status));
  }
});

test("a silent upgrade never tears the screen down", () => {
  const plan = planRecomposeRetention({ silent: true, previousStatus: null });
  assert.equal(plan.keepPrevious, true);
  assert.equal(plan.reason, "silent_upgrade_keeps_day");
});

test("GPS jitter is the same anchor; real movement is not", () => {
  const a = anchorKey({ coords: { lat: 55.60412, lng: 13.00337 } });
  const jitter = anchorKey({ coords: { lat: 55.60388, lng: 13.00291 } });
  const moved = anchorKey({ coords: { lat: 55.6412, lng: 13.0337 } });

  assert.equal(a, jitter, "~40 m of GPS noise is not a new place");
  assert.notEqual(a, moved);

  assert.equal(
    planRecomposeRetention({ previousStatus: "composed", previousAnchorKey: a, nextAnchorKey: jitter }).keepPrevious,
    true,
  );
  assert.equal(
    planRecomposeRetention({ previousStatus: "composed", previousAnchorKey: a, nextAnchorKey: moved }).keepPrevious,
    false,
  );
});

test("an unusable anchor never matches, in either direction", () => {
  assert.equal(anchorKey(null), null);
  assert.equal(anchorKey({ place: "   " }), null);
  assert.equal(anchorKey({ coords: { lat: NaN, lng: 1 } }), null);
  assert.equal(
    planRecomposeRetention({ previousStatus: "composed", previousAnchorKey: null, nextAnchorKey: null }).keepPrevious,
    false,
  );
});

test("a held day is always labelled, and only while it is actually not current", () => {
  assert.equal(staleDayNotice({ isStale: true, phase: "loading" }), "updating");
  assert.equal(staleDayNotice({ isStale: true, phase: "error" }), "update_failed");
  // Once a verdict lands the day is current again — no label.
  assert.equal(staleDayNotice({ isStale: false, phase: "loading" }), null);
  assert.equal(staleDayNotice({ isStale: false, phase: "done" }), null);
  assert.equal(staleDayNotice({ isStale: true, phase: "done" }), null);
});

// --------------------------------------------------------------------------
// The policy above is pure and easy to get right. The WIRING is what actually
// broke the product, so guard the four places the component must honour it.
// (Same source-contract technique the scout suite uses for city-agnosticism.)
// --------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const component = readFileSync(
  fileURLToPath(new URL("../src/components/AnywherePlanner.tsx", import.meta.url)),
  "utf8",
);

test("the compose teardown only clears the day when retention says so", () => {
  // The bug this slice fixes: an UNCONDITIONAL clear before the fetch.
  const guarded = /if \(!retention\.keepPrevious\) \{\s*\n\s*setClassification\(null\);\s*\n\s*setSafeResponse\(null\);/;
  assert.match(component, guarded, "the pre-fetch clear must be behind the retention guard");

  // And the guard must be computed from the policy, not re-implemented inline.
  assert.match(component, /planRecomposeRetention\(\{/);
  assert.match(component, /previousAnchorKey: displayedAnchorKeyRef\.current/);
  // The key is computed once and shared with the ledger scoping below it.
  assert.match(component, /const nextAnchorKey = anchorKey\(anchor\);/);
  assert.match(component, /nextAnchorKey,\n\s*\}\);/);
});

test("a landed verdict replaces the held day atomically", () => {
  // classification + response + anchor + the commitments this day answered +
  // un-stale, with nothing else interleaved. The applied snapshot belongs
  // inside the swap: it is the record of WHICH commitments the new day was
  // asked about, and it is only ever true of a day that actually came back.
  //
  // Asserted as an ORDER of statements rather than one long regex, so a
  // clarifying comment between two of them cannot fail the test.
  const block = component.slice(
    component.indexOf("setClassification(cls);"),
    component.indexOf('setPhase("done");', component.indexOf("setClassification(cls);")),
  );
  const order = [
    "setClassification(cls);",
    "setSafeResponse(safe);",
    "displayedAnchorKeyRef.current = anchorKey(anchor);",
    "setAppliedPins(decision.isComposedStatus(cls.status) ? sentPins : []);",
    "setDayIsStale(false);",
  ];
  let cursor = -1;
  for (const statement of order) {
    const at = block.indexOf(statement, cursor + 1);
    assert.ok(at > cursor, `${statement} must land in the swap, after the statement before it`);
    cursor = at;
  }
});

test("a refusal drops the held day rather than leaving it answering", () => {
  const refusal =
    /if \(refusal\) \{[\s\S]{0,320}?setClassification\(null\);[\s\S]{0,200}?displayedAnchorKeyRef\.current = null;[\s\S]{0,400}?setDayIsStale\(false\);/;
  assert.match(component, refusal, "a service refusal must clear the held day");
  // ...and it must clear what the day answered too, or the pins from the
  // request that never landed get judged against zero stops.
  const block = component.slice(component.indexOf("if (refusal) {"), component.indexOf("if (!response.ok) throw"));
  assert.match(block, /setAppliedPins\(\[\]\);/);
});

test("the full-page loader never doubles up with a held day", () => {
  assert.match(component, /\{phase === "loading" && !staleNotice && \(/);
  // And the held day must be visibly labelled while it is not current.
  assert.match(component, /staleNotice === "updating"/);
  assert.match(component, /staleNotice === "update_failed"/);
});
