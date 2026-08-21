import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildAnywherePayload } from "../src/lib/anywhere-payload.mjs";

const component = readFileSync(
  fileURLToPath(new URL("../src/components/AnywherePlanner.tsx", import.meta.url)),
  "utf8",
);

test("an empty ledger leaves the request contract untouched", () => {
  const bare = buildAnywherePayload({ place: "Somewhere", dates: ["2026-08-22"] });
  const empty = buildAnywherePayload({ place: "Somewhere", dates: ["2026-08-22"], excludedCandidateIds: [] });

  assert.equal("excluded_candidate_ids" in bare, false);
  assert.equal("excluded_candidate_ids" in empty, false);
  assert.deepEqual(bare, empty);
});

test("a ledger travels as its own field and is copied, not aliased", () => {
  const ledger = ["cafe-0", "way:12"];
  const payload = buildAnywherePayload({ place: "Somewhere", dates: ["2026-08-22"], excludedCandidateIds: ledger });

  assert.deepEqual(payload.excluded_candidate_ids, ["cafe-0", "way:12"]);
  // Mutating the caller's array must not retroactively change a sent payload.
  ledger.push("park-9");
  assert.deepEqual(payload.excluded_candidate_ids, ["cafe-0", "way:12"]);
});

// --------------------------------------------------------------------------
// Wiring. The pure contract above is easy; the ways a ledger silently stops
// working are all in the component.
// --------------------------------------------------------------------------

test("the ledger reaches the request", () => {
  assert.match(component, /excludedCandidateIds: excludedOverride \?\? excludedIds/);
});

test("changing the ledger recomposes the day", () => {
  // Without excludedIds in the deps, dismissing does nothing until the user
  // happens to touch some other control.
  assert.match(component, /\}, \[selected, dayOffset, walkKey, excludedIds\]\);/);
});

test("a silent upgrade carries the ledger, so dismissed places cannot return", () => {
  assert.match(component, /const effectiveExcluded = excludedOverride \?\? excludedIds;/);
  assert.match(component, /excludedOverride: effectiveExcluded,/);
});

test("dismissal is offered only where a real id exists", () => {
  // An index fallback would dismiss whatever later happens to sit in that slot.
  assert.match(component, /const hasRealId = realId\.length > 0;/);
  assert.match(component, /\{hasRealId && \(/);
});

test("the dismissal is reversible", () => {
  assert.match(component, /setExcludedIds\(\[\]\)/);
  assert.match(component, /Ta tillbaka alla|Bring them all back/);
});

test("the way back is visible without opening anything", () => {
  // Found in a real browser run: nested inside the collapsed Adjust panel, the
  // ledger was invisible and the undo unreachable — a dismissal you cannot see
  // is effectively irreversible.
  const ledgerBlock = component.slice(
    component.indexOf("{excludedIds.length > 0 && ("),
    component.indexOf("{phase === \"loading\" && !staleNotice && ("),
  );
  assert.ok(ledgerBlock.includes("Bring them all back"), "the ledger renders above the day, not inside Adjust");
  assert.ok(ledgerBlock.includes('role="status"'));
  // It must not sit inside the day block either: dismissing everything removes
  // the day, and that is exactly when the user needs the way back.
  assert.ok(!/showDay[\s\S]{0,200}excludedIds\.length > 0/.test(component));
});
