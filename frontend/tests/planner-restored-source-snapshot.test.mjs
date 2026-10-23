import assert from "node:assert/strict";
import test from "node:test";
import { mountPlanner } from "./helpers/planner-harness.mjs";
import { LAST_KEY, buildSavedEntry } from "../src/lib/anywhere-storage.mjs";
import { buildAnywherePayload } from "../src/lib/anywhere-payload.mjs";
import { buildCommitmentSnapshot } from "../src/lib/commitment-snapshot.mjs";
import { anchorKey } from "../src/lib/recompose-retention.mjs";

const pending = { status: "partial", reason: "bounded_lifecycle_snapshot", pending: 1, completed: 0, failed: 1 };
const snapshot = {
  days: [{ date: "2026-08-23", experimental_agnostic_route_applied: true,
    primary_route: { id: "__agnostic_compose__", main_stops: [
      { id: "a", label: "Museum", lat: 55.6, lng: 13, type: "museum", tags: [] },
      { id: "b", label: "Square", lat: 55.601, lng: 13, type: "museum", tags: [] },
    ], estimated_km: 0.9, legs: [], map_route_points: [], map_path_points: [] }, alternatives: [] }],
  agnostic_route_output_experiment: {
    intake: { status: "resolved", resolved: { label: "Testville" } },
    promotion: { promote: true, readiness: "promotable_limited" },
    source_status: { status: "loaded:10", collection: { source_completion: pending } },
  },
};
function saved(inputs = {}) {
  const entry = buildSavedEntry({ place: "Testville", dateIso: "2026-08-23", savedAt: "2026-08-23T12:00:00Z",
    safeResponse: snapshot, classification: { status: "composed_limited", placeLabel: "Testville", limitations: [] },
    inputs: { place: "Testville", mode: "typed", selected: ["culture", "green"], walkKey: "full", dayOffset: 1, ...inputs } });
  entry.commitments = buildCommitmentSnapshot({ anchorKey: anchorKey({ place: "Testville" }), dayKey: entry.id,
    entries: { a: { kind: "pin", label: "Museum" }, excluded: { kind: "exclude", label: "Excluded" } },
    appliedPins: [{ id: "a", kind: "pin", label: "Museum" }] });
  return entry;
}
const calls = h => h.fetchMock.calls.filter(c => c.url.startsWith("/api/route-recommendations"));
const button = (h, name) => [...h.container.querySelectorAll("button")].find(b => b.textContent.trim() === name);
async function restored(entry) {
  const h = await mountPlanner({ url: "http://localhost/anywhere?restore=last&lang=en", storage: { [LAST_KEY]: entry } });

  // mountPlanner has already flushed React restoration. Compare DOM absence
  // as a boolean: formatting a failed DOM-node equality traverses React fiber
  // graphs and can terminate before TAP reports the actual assertion.
  assert.equal(calls(h).length, 0, "restoration must never auto-compose");
  return h;
}
for (const [name, mutate] of [
  ["GPS without persisted coordinates", e => { e.inputs.mode = "near_me"; }],
  ["missing saved date", e => { e.dateIso = null; }],
  ["impossible saved date", e => { e.dateIso = "2026-02-30"; }],
  ["missing saved inputs", e => { e.inputs = null; }],
  ["malformed place identity", e => { e.inputs.placeRef = "bad-ref"; }],
]) {
  test(`unsafe restored snapshot (${name}) offers explicit replanning, never an inert or guessed-anchor retry`, async () => {
    const entry = saved();
    mutate(entry);
    const h = await restored(entry);
    try {
      assert.ok(!button(h, "Look for more places"), "do not advertise an unsafe retry");
      assert.ok(!button(h, "rebuild for fresh events"), "do not silently use today's date or GPS");
      const replan = [...h.container.querySelectorAll("a")].find(a => a.textContent.trim() === "Choose a starting point and date");
      assert.ok(replan, "give the reader a real replanning path");
      assert.equal(replan.getAttribute("href"), "/?lang=en");
      assert.match(h.text(), /cannot safely update this saved day/i);
      assert.equal(calls(h).length, 0);
    } finally { await h.unmount(); }
  });
}

test("restored typed snapshot updates its saved date, preferences, rhythm and scoped commitments", async () => {
  const entry = saved({ placeSelection: "selected-testville" });
  const h = await restored(entry);
  try {
    const update = button(h, "Look for more places");
    assert.ok(update);
    await h.act(() => update.dispatchEvent(new h.window.Event("click", { bubbles: true })));
    await h.clock.advance(500);
    assert.equal(calls(h).length, 1, "the restored update must send a compose, not silently return");
    assert.deepEqual(calls(h)[0].body, buildAnywherePayload({ place: "Testville", placeSelection: "selected-testville",
      dates: ["2026-08-23"], preferences: ["culture", "green"], dayRhythm: "full",
      pinnedCandidateIds: ["a"], excludedCandidateIds: ["excluded"] }));
  } finally { await h.unmount(); }
});

test("unsafe restored snapshot without a route still provides historical source copy and replanning", async () => {
  const entry = saved();
  entry.inputs.mode = "near_me";
  entry.safeResponse = { ...snapshot, days: [] };
  entry.classification = { status: "unavailable", placeLabel: "Testville", limitations: [] };
  const h = await restored(entry);
  try {
    assert.match(h.text(), /incomplete when the response was produced/i);
    assert.doesNotMatch(h.text(), /More places are on their way|still being fetched/i);
    assert.ok(!button(h, "Try again"), "no guessed-anchor source retry");
    const link = [...h.container.querySelectorAll("a")].find(a => a.textContent.trim() === "Choose a starting point and date");
    assert.ok(link);
    assert.equal(link.getAttribute("href"), "/?lang=en");
  } finally { await h.unmount(); }
});

test("restored source completion describes the saved snapshot, not a still-running source", async () => {
  const h = await restored(saved());
  try {
    assert.match(h.text(), /Not every place could be loaded/i);
    assert.doesNotMatch(h.text(), /More places are on their way|still fetching|update in a moment/i);
    await h.clock.advance(8000);
    assert.equal(calls(h).length, 0, "a frozen source completion never schedules a compose");
    assert.ok(button(h, "Look for more places"), "a genuine saved request can be explicitly looked at again");
  } finally { await h.unmount(); }
});
