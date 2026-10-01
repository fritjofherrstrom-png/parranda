/**
 * An adjustment is never a silent swap, and it can be taken back.
 *
 * Past arrival the day recomposes on its own when an adjustment settles. The
 * replacement says what moved — the inputs, the distance, the stops gained and
 * lost — or that nothing did. "Undo" puts back the day that was on screen, with
 * the inputs and the commitment ledger it was composed under, without asking
 * the server again: the user asked for the day they had, not a new answer to
 * the old question.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

function stop(id, extra = {}) {
  return { id, label: `Place ${id}`, lat: 55.6, lng: 13, type: "museum", commitment_eligible: true, ...extra };
}

function composedDay(stopIds, km) {
  const stops = stopIds.map((id) => stop(id));
  return {
    days: [{
      date: "2026-09-25",
      experimental_agnostic_route_applied: true,
      primary_route: {
        id: "__agnostic_compose__",
        main_stops: stops,
        estimated_km: km,
        legs: [],
        map_route_points: [],
        map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })),
        confidence: "low",
      },
      alternatives: [],
    }],
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: "Testville", lat: 55.6, lng: 13 } },
      promotion: { promote: true, readiness: "promotable" },
    },
  };
}

function structureOnly() {
  return {
    days: [],
    place_structure: {
      provenance: "agnostic_anchor",
      area_count: 1,
      district_day: {
        areas: [{ center: { lat: 55.6, lng: 13 }, stops: [{ id: "x", name: "Place x", lat: 55.6, lng: 13, type: "cafe", tags: [] }] }],
        legs: [],
        covered_intents: [],
        missing_intents: [],
      },
    },
    agnostic_route_output_experiment: { promotion: { promote: false } },
  };
}

const composeCalls = (h) => h.fetchMock.calls.filter((call) => call.url.startsWith("/api/route-recommendations"));
const buttonNamed = (h, name) =>
  [...h.container.querySelectorAll("button")].find((b) => name.test((b.getAttribute("aria-label") || b.textContent).trim()));
const click = (h, element) =>
  h.act(() => {
    element.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
// The account of the last change: the status line that names what changed.
const changeNote = (h) =>
  [...h.container.querySelectorAll('[role="status"] p')]
    .map((p) => p.textContent.replace(/\s+/g, " ").trim())
    .find((text) => /^(Changed|Ändrat):/.test(text)) ?? null;
const routeStopNames = (h) =>
  [...h.container.querySelectorAll("button")]
    .map((b) => (b.textContent || "").match(/Place [a-z]/)?.[0])
    .filter(Boolean);

async function arrive(t, response = composedDay(["a", "b"], 1.2)) {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&planner=open&lang=en" });
  t.after(() => h.unmount());
  h.document.addEventListener("click", (event) => event.preventDefault());
  await h.clock.advance(500);
  assert.equal(composeCalls(h).length, 1, "the arrival compose");
  await h.fetchMock.respond(composeCalls(h)[0], response);
  await h.clock.advance(50);
  return h;
}

async function adjustWalk(h, name) {
  if (!buttonNamed(h, /^Long/)) await click(h, buttonNamed(h, /^Adjust/));
  await click(h, buttonNamed(h, name));
  await h.clock.advance(450);
}

test("arrival offers nothing to undo", async (t) => {
  const h = await arrive(t);
  assert.equal(changeNote(h), null);
  assert.equal(buttonNamed(h, /^Undo this change$/), undefined);
});

test("an adjustment says what it changed in the day", async (t) => {
  const h = await arrive(t);
  await adjustWalk(h, /^Long/);
  const calls = composeCalls(h);
  assert.equal(calls.length, 2, "one recompose for the change");
  assert.equal(calls[1].body.walking_km_target, 9);
  assert.equal(changeNote(h), null, "nothing is claimed while the new day is on its way");

  await h.fetchMock.respond(calls[1], composedDay(["a", "c", "d"], 4.8));
  await h.clock.advance(50);
  assert.equal(
    changeNote(h),
    "Changed: Balanced → Long · 1.2 km → 4.8 km · +2 stops: Place c, Place d · −1: Place b",
  );
  assert.ok(buttonNamed(h, /^Undo this change$/));
});

test("a change that leaves the day as it was says so", async (t) => {
  const h = await arrive(t);
  await adjustWalk(h, /^Long/);
  await h.fetchMock.respond(composeCalls(h)[1], composedDay(["a", "b"], 1.2));
  await h.clock.advance(50);
  assert.equal(changeNote(h), "Changed: Balanced → Long · same stops and distance");
});

test("undo puts the previous day and its inputs back without composing", async (t) => {
  const h = await arrive(t);
  await adjustWalk(h, /^Long/);
  await h.fetchMock.respond(composeCalls(h)[1], composedDay(["a", "c", "d"], 4.8));
  await h.clock.advance(50);
  assert.deepEqual(routeStopNames(h).slice(0, 3), ["Place a", "Place c", "Place d"]);

  await click(h, buttonNamed(h, /^Undo this change$/));
  await h.clock.advance(2000);

  assert.equal(composeCalls(h).length, 2, "undo asks the server nothing");
  assert.deepEqual(routeStopNames(h).slice(0, 2), ["Place a", "Place b"]);
  assert.doesNotMatch(h.text(), /Place c/);
  assert.match(h.text(), /≈ 1\.2 km on foot/);
  assert.equal(buttonNamed(h, /^Balanced/).getAttribute("aria-pressed"), "true", "the walk it was composed for is back");
  assert.equal(changeNote(h), null, "the account went with the change it described");
  assert.doesNotMatch(h.text(), /Saved day/, "the day put back is not a saved snapshot");

  // The echo is spent on the undo itself: the next real change recomposes.
  await adjustWalk(h, /^Short/);
  assert.equal(composeCalls(h).length, 3);
  assert.equal(composeCalls(h)[2].body.walking_km_target, 4);
});

test("undo returns to the day on screen, not to a request still in flight", async (t) => {
  const h = await arrive(t);
  await adjustWalk(h, /^Long/);
  // A second change before the first answer lands: the day to return to is
  // still the arrival's.
  await adjustWalk(h, /^Short/);
  const calls = composeCalls(h);
  assert.equal(calls.length, 3);
  assert.ok(calls[1].aborted, "the older request gave way");
  await h.fetchMock.respond(calls[2], composedDay(["e"], 0.6));
  await h.clock.advance(50);
  assert.match(changeNote(h), /^Changed: Balanced → Short · 1\.2 km → 0\.6 km/);

  await click(h, buttonNamed(h, /^Undo this change$/));
  await h.clock.advance(1000);
  assert.deepEqual(routeStopNames(h).slice(0, 2), ["Place a", "Place b"]);
  assert.equal(buttonNamed(h, /^Balanced/).getAttribute("aria-pressed"), "true");
});

test("a dismissed stop comes back with its day, and the ledger forgets the dismissal", async (t) => {
  const h = await arrive(t);
  await click(h, [...h.container.querySelectorAll("button")].find((b) => /Place b/.test(b.textContent || "")));
  await click(h, buttonNamed(h, /Not this one/));
  await h.clock.advance(450);
  const calls = composeCalls(h);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.excluded_candidate_ids, ["b"]);
  await h.fetchMock.respond(calls[1], composedDay(["a", "c"], 1.4));
  await h.clock.advance(50);
  assert.match(changeNote(h), /\+1 stop: Place c · −1: Place b/);

  assert.match(h.text(), /1 place dismissed/, "precondition: the ledger shows the dismissal");

  await click(h, buttonNamed(h, /^Undo this change$/));
  await h.clock.advance(1000);
  assert.equal(composeCalls(h).length, 2);
  assert.deepEqual(routeStopNames(h).slice(0, 2), ["Place a", "Place b"]);
  assert.doesNotMatch(h.text(), /place dismissed/, "the restored day was composed with no dismissal");

  // The next compose carries the ledger the restored day answered: nothing.
  await adjustWalk(h, /^Long/);
  assert.equal(composeCalls(h).length, 3);
  assert.equal(composeCalls(h)[2].body.excluded_candidate_ids, undefined);
});

test("a change that leaves no route says so and offers the day back", async (t) => {
  const h = await arrive(t);
  await adjustWalk(h, /^Long/);
  await h.fetchMock.respond(composeCalls(h)[1], structureOnly());
  await h.clock.advance(50);
  assert.match(changeNote(h), /^Changed: Balanced → Long · no route for this choice/);
  await click(h, buttonNamed(h, /^Undo this change$/));
  await h.clock.advance(1000);
  assert.deepEqual(routeStopNames(h).slice(0, 2), ["Place a", "Place b"]);
  assert.equal(composeCalls(h).length, 2);
});
