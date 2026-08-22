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

test("the ledger reaches the request, scoped to the anchor", () => {
  assert.match(component, /excludedCandidateIds: excludedOverride \?\? scopedLedger\.ids,/);
});

test("changing the ledger recomposes the day", () => {
  // Without excludedIds in the deps, dismissing does nothing until the user
  // happens to touch some other control.
  assert.match(component, /\}, \[selected, dayOffset, walkKey, excludedIds\]\);/);
});

test("a silent upgrade carries the ledger, so dismissed places cannot return", () => {
  assert.match(component, /const effectiveExcluded = excludedOverride \?\? scopedLedger\.ids;/);
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

// --------------------------------------------------------------------------
// A dismissal belongs to the geography it was made in.
//
// The ledger was component-global, so "not this one" in one place followed the
// user to the next. Candidate ids are loader-issued and not guaranteed unique
// across providers, so that could silently filter an unrelated candidate — and
// even when it matched nothing, the UI still claimed a dismissal the user never
// made there.
// --------------------------------------------------------------------------

import { anchorKey, scopeExcludedToAnchor } from "../src/lib/recompose-retention.mjs";

test("the ledger survives a recompose of the same place", () => {
  const key = anchorKey({ place: "Trogir" });
  const scoped = scopeExcludedToAnchor({ ids: ["osm-way-1"], ledgerAnchorKey: key, nextAnchorKey: key });

  assert.equal(scoped.applies, true);
  assert.deepEqual(scoped.ids, ["osm-way-1"]);
});

test("the ledger does not follow the user to another place", () => {
  const scoped = scopeExcludedToAnchor({
    ids: ["cafe-0"],
    ledgerAnchorKey: anchorKey({ place: "Trogir" }),
    nextAnchorKey: anchorKey({ place: "Kotor" }),
  });

  assert.equal(scoped.applies, false);
  assert.deepEqual(scoped.ids, [], "a generic id must not filter an unrelated candidate elsewhere");
});

test("GPS jitter is still the same place, real movement is not", () => {
  const here = anchorKey({ coords: { lat: 43.51730, lng: 16.25064 } });
  const jitter = anchorKey({ coords: { lat: 43.51742, lng: 16.25091 } });
  const elsewhere = anchorKey({ coords: { lat: 42.42440, lng: 18.77120 } });

  assert.equal(scopeExcludedToAnchor({ ids: ["a"], ledgerAnchorKey: here, nextAnchorKey: jitter }).applies, true);
  assert.equal(scopeExcludedToAnchor({ ids: ["a"], ledgerAnchorKey: here, nextAnchorKey: elsewhere }).applies, false);
});

test("an unstamped ledger is never applied", () => {
  // No anchor recorded means we cannot say which geography it belongs to.
  const scoped = scopeExcludedToAnchor({ ids: ["a"], ledgerAnchorKey: null, nextAnchorKey: anchorKey({ place: "X" }) });
  assert.equal(scoped.applies, false);
  assert.deepEqual(scoped.ids, []);
});

test("the component scopes the ledger and clears it on a new place", () => {
  assert.match(component, /excludedAnchorKeyRef\.current = displayedAnchorKeyRef\.current;/);
  assert.match(component, /const scopedLedger = scopeExcludedToAnchor\(\{/);
  // The request must send the SCOPED list, never the raw component state.
  assert.match(component, /excludedCandidateIds: excludedOverride \?\? scopedLedger\.ids,/);
  assert.match(component, /excludedOverride \?\? scopedLedger\.ids;/);
  // And the visible "N dismissed" line must follow, not linger for a place
  // where nothing was dismissed.
  assert.match(component, /if \(!scopedLedger\.applies\) \{[\s\S]{0,160}setExcludedIds\(\[\]\);/);
});

test("restoring another place's saved day drops the ledger", () => {
  // Restoring is the one in-session path that changes geography WITHOUT a
  // compose, so the clear in execute() never runs for it. Found by trying to
  // exercise a real place change on staging.
  const restore = component.slice(component.indexOf("function restoreEntry"));
  const body = restore.slice(0, restore.indexOf("setPhase(\"done\")"));
  assert.match(body, /scopeExcludedToAnchor\(\{/, "restore must scope the ledger");
  assert.match(body, /nextAnchorKey: restoredAnchorKey/);
  assert.match(body, /setExcludedIds\(\[\]\)/);
});
