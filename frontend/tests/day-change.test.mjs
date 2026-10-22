import assert from "node:assert/strict";
import test from "node:test";

import { dayChangeSegments, describeDayChange } from "../src/lib/day-change.mjs";
import { liveOccurrenceId } from "../../server/planner/live-occurrence-choice.js";

function entry({ stops = [], km = null, walkKey = "balanced", dayOffset = 0, selected = ["food", "culture"], preferencePriority = [] } = {}) {
  return {
    inputs: { walkKey, dayOffset, selected, preferencePriority },
    safeResponse: {
      days: [{ primary_route: { main_stops: stops, ...(km === null ? {} : { estimated_km: km }) } }],
    },
  };
}
const stop = (id, label) => ({ id, label });
function liveStop(start, overrides = {}) {
  const event = { id: "same-series", source_provider_id: "controlled-source", timezone: "Europe/Helsinki",
    starts_at: `2026-10-17T${start}:00:00Z`, ...overrides };
  return { id: `live-event-${event.id}`, label: "Source concert", is_live_event: true,
    live_occurrence_id: liveOccurrenceId(event), ...overrides };
}
const labels = (lang) => ({
  lang,
  walkLabel: (key) => ({ calm: lang === "sv" ? "Lugn" : "Easy", balanced: lang === "sv" ? "Lagom" : "Balanced", full: lang === "sv" ? "Fylld" : "Full" })[key] ?? key,
  pickLabel: (key) => ({ food: "Food & drink", culture: "Culture", views: "Views" })[key] ?? key,
  dayLabel: (offset) => (offset === 0 ? (lang === "sv" ? "Idag" : "Today") : lang === "sv" ? "Imorgon" : "Tomorrow"),
});

test("a fuller day that changes the route names the inputs and counts the stops and distance", () => {
  const change = describeDayChange(
    entry({ stops: [stop("a", "Place a"), stop("b", "Place b")], km: 1.2 }),
    entry({ stops: [stop("a", "Place a"), stop("c", "Place c"), stop("d", "Place d")], km: 4.8, walkKey: "full" }),
  );
  assert.deepEqual(change.stops.added, ["Place c", "Place d"]);
  assert.deepEqual(change.stops.removed, ["Place b"]);
  assert.equal(change.stops.kept, 1);
  assert.equal(change.routeChanged, true);
  assert.deepEqual(dayChangeSegments(change, labels("en")), [
    "Balanced → Full",
    "1 stop swapped",
    "+1 stop",
    "1.2 → 4.8 km",
  ]);
  assert.deepEqual(dayChangeSegments(change, labels("sv")), [
    "Lagom → Fylld",
    "1 stopp bytt",
    "+1 stopp",
    "1,2 → 4,8 km",
  ]);
});

test("a change that leaves the day as it was says so instead of staying silent", () => {
  const stops = [stop("a", "Place a"), stop("b", "Place b")];
  const change = describeDayChange(entry({ stops, km: 0.4 }), entry({ stops, km: 0.4, walkKey: "full" }));
  assert.equal(change.routeChanged, false);
  assert.deepEqual(dayChangeSegments(change, labels("sv")), ["Lagom → Fylld", "samma stopp och sträcka"]);
});

test("stops are matched by id, so a renamed label is not a new stop", () => {
  const change = describeDayChange(
    entry({ stops: [stop("a", "Place a")], km: 1 }),
    entry({ stops: [stop("a", "Place A (renamed)")], km: 1 }),
  );
  assert.deepEqual(change.stops.added, []);
  assert.deepEqual(change.stops.removed, []);
  assert.equal(change.routeChanged, false);
});

test("different source occurrences of one series count as one swapped Live stop", () => {
  const before = liveStop("18");
  const after = liveStop("19");
  assert.equal(before.id, after.id, "the source series keeps its existing route id");
  assert.notEqual(before.live_occurrence_id, after.live_occurrence_id);
  const change = describeDayChange(entry({ stops: [before], km: 1 }), entry({ stops: [after], km: 1 }));
  assert.equal(change.routeChanged, true, "a different source start is a different actual visit");
  assert.equal(change.stops.kept, 0);
  assert.equal(change.cause, "live", "the newly selected occurrence is a real Live addition");
  assert.deepEqual(dayChangeSegments(change, labels("en")), ["Live: event added", "1 stop swapped"]);
  assert.deepEqual(dayChangeSegments(change, labels("sv")), ["Live: evenemang tillagt", "1 stopp bytt"]);
});

test("the same source occurrence stays the same when its label or end time changes", () => {
  const before = liveStop("18", { ends_at: "2026-10-17T20:00:00Z" });
  const after = liveStop("18", { label: "Updated source concert", ends_at: "2026-10-17T21:00:00Z" });
  assert.equal(before.live_occurrence_id, after.live_occurrence_id);
  const change = describeDayChange(entry({ stops: [before], km: 1 }), entry({ stops: [after], km: 1 }));
  assert.equal(change.routeChanged, false);
  assert.equal(change.stops.kept, 1);
  assert.deepEqual(dayChangeSegments(change, labels("en")), ["same stops and distance"]);
});

test("ordinary places and malformed legacy Live metadata retain place-id matching", () => {
  for (const extra of [
    { is_live_event: false, live_occurrence_id: liveStop("18").live_occurrence_id },
    { is_live_event: true, live_occurrence_id: "not-an-occurrence" },
  ]) {
    const before = { ...stop("a", "A"), ...extra };
    const after = { ...before, label: "Renamed", live_occurrence_id: liveStop("19").live_occurrence_id };
    if (extra.is_live_event) after.live_occurrence_id = "also-invalid";
    const change = describeDayChange(entry({ stops: [before] }), entry({ stops: [after] }));
    assert.equal(change.routeChanged, false);
  }
});

test("stops without an id fall back to their visible name", () => {
  const change = describeDayChange(
    entry({ stops: [{ label: "Kungsparken" }], km: 1 }),
    entry({ stops: [{ label: "kungsparken" }, { label: "Slottsskogen" }], km: 2 }),
  );
  assert.deepEqual(change.stops.added, ["Slottsskogen"]);
  assert.deepEqual(change.stops.removed, []);
});

test("the same stops in a new order are reported as a new order", () => {
  const change = describeDayChange(
    entry({ stops: [stop("a", "A"), stop("b", "B")], km: 2 }),
    entry({ stops: [stop("b", "B"), stop("a", "A")], km: 2 }),
  );
  assert.equal(change.stops.reordered, true);
  assert.deepEqual(dayChangeSegments(change, labels("en")), ["same stops, new order"]);
});

test("picks and day are named in the page's words, added before removed", () => {
  const change = describeDayChange(
    entry({ stops: [stop("a", "A")], km: 1, selected: ["food", "culture"] }),
    entry({ stops: [stop("a", "A"), stop("v", "View")], km: 2, selected: ["food", "views"], dayOffset: 1 }),
  );
  assert.deepEqual(dayChangeSegments(change, labels("en")).slice(0, 3), ["Today → Tomorrow", "+ Views", "− Culture"]);
});

test("a change that produced no route says so, so the previous day is worth offering back", () => {
  const change = describeDayChange(entry({ stops: [stop("a", "A")], km: 1 }), entry({ stops: [], selected: ["views"] }));
  assert.equal(change.hasRoute, false);
  assert.deepEqual(dayChangeSegments(change, labels("sv")).at(-1), "ingen rutt för det här valet");
});

test("the line counts stops instead of naming them, so it stays one short line", () => {
  const change = describeDayChange(
    entry({ stops: [], km: 0 }),
    entry({ stops: [stop("a", "A"), stop("b", "B"), stop("c", "C"), stop("d", "D")], km: 5 }),
  );
  assert.deepEqual(dayChangeSegments(change, labels("en")).slice(-2), ["+4 stops", "< 0.1 → 5 km"]);
  assert.deepEqual(dayChangeSegments(change, labels("sv")).slice(-2), ["+4 stopp", "< 0,1 → 5 km"]);
  const swap = describeDayChange(entry({ stops: [stop("a", "A"), stop("b", "B"), stop("c", "C")], km: 1 }),
    entry({ stops: [stop("d", "D"), stop("e", "E"), stop("f", "F")], km: 1 }));
  assert.deepEqual(dayChangeSegments(swap, labels("sv")), ["3 stopp bytta"]);
});

test("nothing to describe is an empty list, never a throw", () => {
  assert.deepEqual(dayChangeSegments(null), []);
  const change = describeDayChange(null, null);
  assert.equal(change.hasRoute, false);
  assert.equal(change.km, null);
});

test("an ordinary priority recomposition attributes a newly added source occurrence to Live", () => {
  const places = [stop("a", "Place a"), stop("b", "Place b")];
  const before = entry({ stops: places, km: 1.6 });
  const after = entry({ stops: [...places, liveStop("18")], km: 4.1, preferencePriority: ["views"] });
  const change = describeDayChange(before, after);
  assert.equal(change.cause, "live", "fresh composition must identify the actual Live addition without a caller hint");
  assert.deepEqual(change.inputs.picksAdded, []);
  assert.deepEqual(dayChangeSegments(change, labels("en")), ["Live: event added", "+1 stop", "1.6 → 4.1 km"]);
  assert.deepEqual(dayChangeSegments(change, labels("sv")), ["Live: evenemang tillagt", "+1 stopp", "1,6 → 4,1 km"]);
});

test("a later patch retains Live attribution when compared with the original day", () => {
  const place = stop("a", "Place a");
  const before = entry({ stops: [place], km: 1.2 });
  const upgraded = entry({ stops: [place, liveStop("18")], km: 1.9 });
  assert.equal(describeDayChange(before, upgraded, { cause: "live" }).cause, "live");
  const patched = entry({ stops: [place, liveStop("18", { label: "Updated source concert", ends_at: "2026-10-17T21:00:00Z" })], km: 1.9 });
  const change = describeDayChange(before, patched);
  assert.equal(change.cause, "live", "a later patch cannot hide the Live addition still present against the original baseline");
  assert.equal(dayChangeSegments(change, labels("en"))[0], "Live: event added");
});

test("an already present occurrence does not attribute ordinary place changes to Live", () => {
  const before = entry({ stops: [stop("a", "Place a"), liveStop("18")], km: 1.2 });
  const after = entry({ stops: [stop("b", "Place b"), liveStop("18", { label: "Updated source concert" })], km: 1.9,
    preferencePriority: ["views"] });
  const change = describeDayChange(before, after);
  assert.equal(change.cause, null);
  assert.deepEqual(dayChangeSegments(change, labels("en")), ["1 stop swapped", "1.2 → 1.9 km"]);
});

test("event-like names, ids and malformed or non-Live occurrence metadata do not prove a Live addition", () => {
  const invalidDate = `live:2026-02-31:${"a".repeat(32)}`;
  for (const added of [
    stop("live-event-concert", "Live: source concert"),
    liveStop("18", { is_live_event: false }),
    liveStop("18", { is_live_event: undefined }),
    liveStop("18", { live_occurrence_id: "not-an-occurrence" }),
    liveStop("18", { live_occurrence_id: invalidDate }),
  ]) {
    const change = describeDayChange(entry({ stops: [stop("a", "Place a")] }), entry({ stops: [stop("a", "Place a"), added] }));
    assert.equal(change.cause, null, JSON.stringify(added));
    assert.deepEqual(dayChangeSegments(change, labels("en")), ["+1 stop"]);
  }
});

test("a server-applied Live upgrade says Live moved the day, with the same inputs", () => {
  const before = entry({ stops: [stop("a", "Place a")], km: 1.2 });
  const after = entry({ stops: [stop("a", "Place a"), stop("live-event-e1", "Late concert")], km: 1.9 });
  const change = describeDayChange(before, after, { cause: "live" });
  assert.equal(change.cause, "live");
  assert.deepEqual(change.inputs.picksAdded, []);
  assert.deepEqual(dayChangeSegments(change, labels("en")).slice(0, 1), ["Live: event added"]);
  assert.deepEqual(dayChangeSegments(change, labels("sv")).slice(0, 1), ["Live: evenemang tillagt"]);
  assert.equal(dayChangeSegments(change, labels("en")).join(" · "), "Live: event added · +1 stop · 1.2 → 1.9 km");
  assert.equal(describeDayChange(before, after).cause, null, "a legacy stop id alone cannot prove a Live occurrence");
});
