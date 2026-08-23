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
  assert.match(component, /excludedCandidateIds: excludedOverride \?\? scopedLedger\.excludedIds,/);
});

test("changing the ledger recomposes the day", () => {
  // Without excludedIds in the deps, dismissing does nothing until the user
  // happens to touch some other control.
  assert.match(component, /\}, \[selected, dayOffset, walkKey, commitments\]\);/);
});

test("a silent upgrade carries the ledger, so dismissed places cannot return", () => {
  assert.match(component, /const effectiveExcluded = excludedOverride \?\? scopedLedger\.excludedIds;/);
  assert.match(component, /excludedOverride: effectiveExcluded,/);
});

test("dismissal is offered only where a real id exists", () => {
  // An index fallback would dismiss whatever later happens to sit in that slot.
  assert.match(component, /const hasRealId = realId\.length > 0;/);
  assert.match(component, /\{hasRealId && \(/);
});

test("the dismissal is reversible", () => {
  assert.match(component, /setCommitments\(\{\}\)/);
  assert.match(component, /Börja om utan mina val|Start over without my choices/);
});

test("the way back is visible without opening anything", () => {
  // Found in a real browser run: nested inside the collapsed Adjust panel, the
  // ledger was invisible and the undo unreachable — a dismissal you cannot see
  // is effectively irreversible.
  const ledgerBlock = component.slice(
    component.indexOf("{(excludedCount > 0 || pinnedCount > 0) && ("),
    component.indexOf("{phase === \"loading\" && !staleNotice && ("),
  );
  assert.ok(ledgerBlock.includes("Start over without my choices"), "the ledger renders above the day, not inside Adjust");
  assert.ok(ledgerBlock.includes('role="status"'));
  // It must not sit inside the day block either: dismissing everything removes
  // the day, and that is exactly when the user needs the way back.
  assert.ok(!/showDay[\s\S]{0,200}excludedCount > 0/.test(component));
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

import { anchorKey, scopeCommitmentsToAnchor, unhonouredPins } from "../src/lib/recompose-retention.mjs";

test("the ledger survives a recompose of the same place", () => {
  const key = anchorKey({ place: "Trogir" });
  const scoped = scopeCommitmentsToAnchor({
    entries: { "osm-way-1": { kind: "exclude", label: "A" }, "osm-node-7": { kind: "pin", label: "B" } },
    ledgerAnchorKey: key,
    nextAnchorKey: key,
  });

  assert.equal(scoped.applies, true);
  assert.deepEqual(scoped.excludedIds, ["osm-way-1"]);
  assert.deepEqual(scoped.pinnedIds, ["osm-node-7"]);
});

test("the ledger does not follow the user to another place", () => {
  const scoped = scopeCommitmentsToAnchor({
    entries: { "cafe-0": { kind: "exclude", label: "A" }, "museum-2": { kind: "pin", label: "B" } },
    ledgerAnchorKey: anchorKey({ place: "Trogir" }),
    nextAnchorKey: anchorKey({ place: "Kotor" }),
  });

  assert.equal(scoped.applies, false);
  assert.deepEqual(scoped.excludedIds, [], "a generic id must not filter an unrelated candidate elsewhere");
  assert.deepEqual(scoped.pinnedIds, [], "and a commitment must not force a place into someone else's day");
});

test("GPS jitter is still the same place, real movement is not", () => {
  const here = anchorKey({ coords: { lat: 43.51730, lng: 16.25064 } });
  const jitter = anchorKey({ coords: { lat: 43.51742, lng: 16.25091 } });
  const elsewhere = anchorKey({ coords: { lat: 42.42440, lng: 18.77120 } });

  const entries = { a: { kind: "pin", label: "A" } };
  assert.equal(scopeCommitmentsToAnchor({ entries, ledgerAnchorKey: here, nextAnchorKey: jitter }).applies, true);
  assert.equal(scopeCommitmentsToAnchor({ entries, ledgerAnchorKey: here, nextAnchorKey: elsewhere }).applies, false);
});

test("an unstamped ledger is never applied", () => {
  // No anchor recorded means we cannot say which geography it belongs to.
  const scoped = scopeCommitmentsToAnchor({
    entries: { a: { kind: "exclude", label: "A" } },
    ledgerAnchorKey: null,
    nextAnchorKey: anchorKey({ place: "X" }),
  });
  assert.equal(scoped.applies, false);
  assert.deepEqual(scoped.excludedIds, []);
});

test("the component scopes the ledger and clears it on a new place", () => {
  assert.match(component, /commitmentAnchorKeyRef\.current = displayedAnchorKeyRef\.current;/);
  assert.match(component, /const scopedLedger = scopeCommitmentsToAnchor\(\{/);
  // The request must send the SCOPED list, never the raw component state.
  assert.match(component, /excludedCandidateIds: excludedOverride \?\? scopedLedger\.excludedIds,/);
  assert.match(component, /excludedOverride \?\? scopedLedger\.excludedIds;/);
  // And the visible "N dismissed" line must follow, not linger for a place
  // where nothing was dismissed.
  assert.match(component, /if \(!scopedLedger\.applies\) \{[\s\S]{0,160}setCommitments\(\{\}\);/);
});

test("restoring another place's saved day drops the ledger", () => {
  // Restoring is the one in-session path that changes geography WITHOUT a
  // compose, so the clear in execute() never runs for it. Found by trying to
  // exercise a real place change on staging.
  const restore = component.slice(component.indexOf("function restoreEntry"));
  const body = restore.slice(0, restore.indexOf("setPhase(\"done\")"));
  assert.match(body, /scopeCommitmentsToAnchor\(\{/, "restore must scope the ledger");
  assert.match(body, /nextAnchorKey: restoredAnchorKey/);
  assert.match(body, /setCommitments\(\{\}\)/);
});

// --------------------------------------------------------------------------
// Keep and Add. Two verbs, one commitment: "this must be in the day."
// --------------------------------------------------------------------------

test("pins travel as their own field and leave a bare request untouched", () => {
  const bare = buildAnywherePayload({ place: "Somewhere", dates: ["2026-08-22"] });
  const empty = buildAnywherePayload({ place: "Somewhere", dates: ["2026-08-22"], pinnedCandidateIds: [] });
  assert.equal("pinned_candidate_ids" in bare, false);
  assert.equal("pinned_candidate_ids" in empty, false);
  assert.deepEqual(bare, empty);

  const pins = ["museum-2"];
  const payload = buildAnywherePayload({ place: "Somewhere", dates: ["2026-08-22"], pinnedCandidateIds: pins });
  assert.deepEqual(payload.pinned_candidate_ids, ["museum-2"]);
  pins.push("later-9");
  assert.deepEqual(payload.pinned_candidate_ids, ["museum-2"]);
});

test("both halves of the ledger reach the request", () => {
  const payload = buildAnywherePayload({
    place: "Somewhere",
    dates: ["2026-08-22"],
    excludedCandidateIds: ["cafe-0"],
    pinnedCandidateIds: ["museum-2"],
  });
  assert.deepEqual(payload.excluded_candidate_ids, ["cafe-0"]);
  assert.deepEqual(payload.pinned_candidate_ids, ["museum-2"]);
});

test("the pinned half of the ledger is wired into the request and the retry", () => {
  assert.match(component, /pinnedCandidateIds: pinnedOverride \?\? scopedLedger\.pinnedIds,/);
  // A silent upgrade must carry the pins too, or a kept place quietly drops
  // out of the day the moment a better verdict arrives.
  assert.match(component, /const effectivePinned = pinnedOverride \?\? scopedLedger\.pinnedIds;/);
  assert.match(component, /pinnedOverride: effectivePinned,/);
});

test("exclude and pin cannot contradict each other for the same candidate", () => {
  // Not a runtime check but a representation choice: one map keyed by
  // candidate id holds exactly one commitment, so the newest action replaces
  // the previous one and the server is never handed both at once.
  assert.match(component, /useState<Record<string, \{ kind: "exclude" \| "pin"; label: string \}>>\(\{\}\)/);
  assert.match(component, /setCommitments\(\{ \.\.\.commitments, \[identity\]: \{ kind, label: commitLabel \} \}\)/);

  const both = scopeCommitmentsToAnchor({
    entries: { "museum-2": { kind: "pin", label: "Museum" } },
    ledgerAnchorKey: "place:x",
    nextAnchorKey: "place:x",
  });
  assert.deepEqual(both.pinnedIds, ["museum-2"]);
  assert.deepEqual(both.excludedIds, [], "the same id can never appear on both sides");
});

test("Keep and Add are the same primitive reached from two places", () => {
  assert.match(component, /const dismissStop = \(identity: string, stopLabel: string\) => commit\(identity, "exclude", stopLabel\);/);
  assert.match(component, /const keepStop = \(identity: string, stopLabel: string\) => commit\(identity, "pin", stopLabel\);/);
  // Add, on a candidate the day did not choose, writes the identical commitment.
  assert.match(component, /commit\(candidateId, "pin", name\)/);
});

test("a commitment can be released without starting over", () => {
  assert.match(component, /const releaseCommitment = \(identity: string\) => \{/);
  assert.match(component, /Behålls — släpp|Kept — release/);
  assert.match(component, /Med i dagen — släpp|In my day — release/);
  // And the ledger line states both halves, with one way out of all of them.
  assert.match(component, /1 plats behålls|1 place kept/);
  assert.match(component, /Börja om utan mina val|Start over without my choices/);
});

test("a kept stop is not also offered as dismissable", () => {
  // The two verbs are mutually exclusive, so the panel must not present the
  // contradiction as if it were available.
  assert.match(component, /\{hasRealId && commitments\[stopIdentity\]\?\.kind !== "pin" && \(/);
});

test("Add is offered only against a real candidate id", () => {
  // Pins resolve server-side against the candidates the server itself loaded;
  // an index fallback would pin whatever later happens to sit in that slot.
  assert.match(component, /const candidateId = String\(stop\?\.id \?\? stop\?\.place_id \?\? stop\?\.candidate_id \?\? ""\)\.trim\(\);/);
  assert.match(component, /\{candidateId && \(/);
});

// --------------------------------------------------------------------------
// A pin is a request, not a promise.
//
// Found on staging: two pins went out, the day came back containing neither,
// and the ledger still said "kept" with no explanation. The server had already
// reported unhonored_count honestly — the day on screen was the one lying.
// --------------------------------------------------------------------------

test("a kept place the day does not contain is reported, and named", () => {
  const out = unhonouredPins({
    entries: { "osm-node-1": { kind: "pin", label: "Sokol" }, "osm-node-2": { kind: "pin", label: "Sushimama" } },
    pinnedIds: ["osm-node-1", "osm-node-2"],
    stopIds: ["osm-node-1", "osm-way-9"],
  });
  assert.equal(out.count, 1);
  assert.deepEqual(out.labels, ["Sushimama"]);
});

test("an honoured pin says nothing at all", () => {
  const out = unhonouredPins({
    entries: { "osm-node-1": { kind: "pin", label: "Sokol" } },
    pinnedIds: ["osm-node-1"],
    stopIds: ["osm-node-1", "osm-way-9"],
  });
  assert.equal(out.count, 0);
  assert.deepEqual(out.labels, []);
});

test("a stale day accuses nobody", () => {
  // The stops on screen belong to the previous request; judging a new pin
  // against them would report a failure that has not happened yet.
  const out = unhonouredPins({
    entries: { "osm-node-2": { kind: "pin", label: "Sushimama" } },
    pinnedIds: ["osm-node-2"],
    stopIds: ["osm-way-9"],
    isStale: true,
  });
  assert.equal(out.count, 0);
});

test("the verdict is derived from the rendered day, never from the request", () => {
  // Counting what was asked for would let the notice claim a failure the user
  // cannot see. It must only ever describe the stops on screen.
  assert.match(component, /stopIds: split\.core\.map\(/);
  assert.match(component, /isStale: dayIsStale,/);
  assert.match(component, /\{unkept\.count > 0 && \(/);
  assert.match(component, /Kunde inte få plats i dagen|Could not fit in this day/);
});

test("the notice degrades to a count when a label is missing", () => {
  const out = unhonouredPins({
    entries: {},
    pinnedIds: ["osm-node-2"],
    stopIds: [],
  });
  assert.equal(out.count, 1);
  assert.deepEqual(out.labels, [], "no invented name");
  assert.match(component, /One place you kept could not fit in this day\./);
});
