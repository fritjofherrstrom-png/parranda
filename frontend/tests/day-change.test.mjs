import assert from "node:assert/strict";
import test from "node:test";

import { dayChangeSegments, describeDayChange } from "../src/lib/day-change.mjs";

function entry({ stops = [], km = null, walkKey = "balanced", dayOffset = 0, selected = ["food", "culture"] } = {}) {
  return {
    inputs: { walkKey, dayOffset, selected },
    safeResponse: {
      days: [{ primary_route: { main_stops: stops, ...(km === null ? {} : { estimated_km: km }) } }],
    },
  };
}
const stop = (id, label) => ({ id, label });
const labels = (lang) => ({
  lang,
  walkLabel: (key) => ({ calm: lang === "sv" ? "Lugn" : "Easy", balanced: lang === "sv" ? "Lagom" : "Balanced", full: lang === "sv" ? "Fylld" : "Full" })[key] ?? key,
  pickLabel: (key) => ({ food: "Food & drink", culture: "Culture", views: "Views" })[key] ?? key,
  dayLabel: (offset) => (offset === 0 ? (lang === "sv" ? "Idag" : "Today") : lang === "sv" ? "Imorgon" : "Tomorrow"),
});

test("a fuller day that changes the route names the inputs, the distance and the stops", () => {
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
    "1.2 km → 4.8 km",
    "+2 stops: Place c, Place d",
    "−1: Place b",
  ]);
  assert.deepEqual(dayChangeSegments(change, labels("sv")), [
    "Lagom → Fylld",
    "1,2 km → 4,8 km",
    "+2 stopp: Place c, Place d",
    "−1: Place b",
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

test("long lists name two stops and count the rest", () => {
  const change = describeDayChange(
    entry({ stops: [], km: 0 }),
    entry({ stops: [stop("a", "A"), stop("b", "B"), stop("c", "C"), stop("d", "D")], km: 5 }),
  );
  assert.equal(dayChangeSegments(change, labels("en")).at(-1), "+4 stops: A, B and 2 more");
  assert.equal(dayChangeSegments(change, labels("sv")).at(-1), "+4 stopp: A, B och 2 till");
});

test("nothing to describe is an empty list, never a throw", () => {
  assert.deepEqual(dayChangeSegments(null), []);
  const change = describeDayChange(null, null);
  assert.equal(change.hasRoute, false);
  assert.equal(change.km, null);
});

test("a server-applied Live upgrade says Live moved the day, with the same inputs", () => {
  const before = entry({ stops: [stop("a", "Place a")], km: 1.2 });
  const after = entry({ stops: [stop("a", "Place a"), stop("live-event-e1", "Late concert")], km: 1.9 });
  const change = describeDayChange(before, after, { cause: "live" });
  assert.equal(change.cause, "live");
  assert.deepEqual(change.inputs.picksAdded, []);
  assert.deepEqual(dayChangeSegments(change, labels("en")).slice(0, 1), ["Live: event added"]);
  assert.deepEqual(dayChangeSegments(change, labels("sv")).slice(0, 1), ["Live: evenemang tillagt"]);
  assert.match(dayChangeSegments(change, labels("en")).join(" · "), /\+1 stop: Late concert/);
  assert.equal(describeDayChange(before, after).cause, null, "an adjustment has no cause of its own");
});
