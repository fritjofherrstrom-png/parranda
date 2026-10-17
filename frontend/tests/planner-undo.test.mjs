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
import dayPolicy from "../../server/planner/day-composition-policy.js";

function stop(id, extra = {}) {
  return { id, label: `Place ${id}`, lat: 55.6, lng: 13, type: "museum", covered_preferences: ["culture"], commitment_eligible: true, ...extra };
}

function composedDay(stopIds, km, dayEdit = null) {
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
      // Controlled transport acknowledgement, not evidence of provider supply.
      ...(dayEdit ? { day_edit: dayPolicy.dayEditOutcome(dayEdit, stops) } : {}),
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

async function adjustRhythm(h, name) {
  if (!buttonNamed(h, /^Full/)) await click(h, buttonNamed(h, /^Adjust/));
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
  await adjustRhythm(h, /^Full/);
  const calls = composeCalls(h);
  assert.equal(calls.length, 2, "one recompose for the change");
  assert.equal(calls[1].body.day_rhythm, "full");
  assert.equal(calls[1].body.walking_km_target, undefined);
  assert.equal(calls[1].body.distance_mode, "no_limit");
  assert.equal(changeNote(h), null, "nothing is claimed while the new day is on its way");

  await h.fetchMock.respond(calls[1], composedDay(["a", "c", "d"], 4.8));
  await h.clock.advance(50);
  assert.equal(
    changeNote(h),
    "Changed: Balanced → Full · 1 stop swapped · +1 stop · 1.2 → 4.8 km",
  );
  assert.ok(buttonNamed(h, /^Undo this change$/));
});

test("a change that leaves the day as it was says so", async (t) => {
  const h = await arrive(t);
  await adjustRhythm(h, /^Full/);
  await h.fetchMock.respond(composeCalls(h)[1], composedDay(["a", "b"], 1.2));
  await h.clock.advance(50);
  assert.equal(changeNote(h), "Changed: Balanced → Full · same stops and distance");
});

test("undo puts the previous day and its inputs back without composing", async (t) => {
  const h = await arrive(t);
  await adjustRhythm(h, /^Full/);
  await h.fetchMock.respond(composeCalls(h)[1], composedDay(["a", "c", "d"], 4.8));
  await h.clock.advance(50);
  assert.deepEqual(routeStopNames(h).slice(0, 3), ["Place a", "Place c", "Place d"]);

  await click(h, buttonNamed(h, /^Undo this change$/));
  await h.clock.advance(2000);

  assert.equal(composeCalls(h).length, 2, "undo asks the server nothing");
  assert.deepEqual(routeStopNames(h).slice(0, 2), ["Place a", "Place b"]);
  assert.doesNotMatch(h.text(), /Place c/);
  assert.match(h.text(), /≈ 1\.2 km on foot/);
  assert.equal(buttonNamed(h, /^Balanced/).getAttribute("aria-pressed"), "true", "the rhythm it was composed for is back");
  assert.equal(changeNote(h), null, "the account went with the change it described");
  assert.doesNotMatch(h.text(), /Saved day/, "the day put back is not a saved snapshot");

  // The echo is spent on the undo itself: the next real change recomposes.
  await adjustRhythm(h, /^Easy/);
  assert.equal(composeCalls(h).length, 3);
  assert.equal(composeCalls(h)[2].body.day_rhythm, "calm");
});

test("undo returns to the day on screen, not to a request still in flight", async (t) => {
  const h = await arrive(t);
  await adjustRhythm(h, /^Full/);
  // A second change before the first answer lands: the day to return to is
  // still the arrival's.
  await adjustRhythm(h, /^Easy/);
  const calls = composeCalls(h);
  assert.equal(calls.length, 3);
  assert.ok(calls[1].aborted, "the older request gave way");
  await h.fetchMock.respond(calls[2], composedDay(["e"], 0.6));
  await h.clock.advance(50);
  assert.match(changeNote(h), /^Changed: Balanced → Easy · 1 stop swapped · −1 stop · 1\.2 → 0\.6 km$/);

  await click(h, buttonNamed(h, /^Undo this change$/));
  await h.clock.advance(1000);
  assert.deepEqual(routeStopNames(h).slice(0, 2), ["Place a", "Place b"]);
  assert.equal(buttonNamed(h, /^Balanced/).getAttribute("aria-pressed"), "true");
});

test("a replaced stop comes back with its day, and Undo forgets the exclusion and applied edit", async (t) => {
  const h = await arrive(t);
  const previous = h.readStorage("parranda:anywhere:last");
  await click(h, [...h.container.querySelectorAll("button")].find((b) => /Place b/.test(b.textContent || "")));
  const replace = buttonNamed(h, /^Replace$/);
  assert.ok(Boolean(replace), "the real, distinct Replace action exists");
  await click(h, replace);
  await h.clock.advance(450);
  const calls = composeCalls(h);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.excluded_candidate_ids, ["b"]);
  assert.deepEqual(calls[1].body.day_edit, {
    version: 1, action: "replace", candidate_id: "b", retained_candidate_ids: ["a"],
    target_stop_count: 2, slot_index: 1, replacement_preference: "culture", removed_candidate_ids: [],
  });
  await h.fetchMock.respond(calls[1], composedDay(["a", "c"], 1.4, calls[1].body.day_edit));
  await h.clock.advance(50);
  assert.ok([...h.container.querySelectorAll('[role="status"] p')].some(p => p.textContent.trim() === "Replaced"),
    "the explicit edit is acknowledged beside its Undo control");

  assert.match(h.text(), /1 place dismissed/, "precondition: the ledger shows the dismissal");
  assert.deepEqual(routeStopNames(h).slice(0, 2), ["Place a", "Place c"], "replacement preserves the other stop and the count");
  const replaced = h.readStorage("parranda:anywhere:last");
  assert.deepEqual(replaced.safeResponse.days[0].primary_route.main_stops.map(stop => stop.id), ["a", "c"]);
  assert.equal(replaced.safeResponse.days[0].primary_route.estimated_km, 1.4);
  assert.equal(replaced.inputs.dayEdit.action, "remove", "saved state retains the applied answer rather than replaying Replace");
  assert.deepEqual(replaced.inputs.dayEdit.retained_candidate_ids, ["a", "c"]);

  await click(h, buttonNamed(h, /^Undo this change$/));
  await h.clock.advance(1000);
  assert.equal(composeCalls(h).length, 2);
  assert.deepEqual(routeStopNames(h).slice(0, 2), ["Place a", "Place b"]);
  assert.doesNotMatch(h.text(), /place dismissed/, "the restored day was composed with no dismissal");
  assert.deepEqual(h.readStorage("parranda:anywhere:last"), previous, "Undo restores the exact original snapshot, inputs and ledger");
  assert.equal(new URL(h.window.location.href).searchParams.has("edit"), false);

  // The next compose carries the ledger the restored day answered: nothing.
  await adjustRhythm(h, /^Full/);
  assert.equal(composeCalls(h).length, 3);
  assert.equal(composeCalls(h)[2].body.excluded_candidate_ids, undefined);
  assert.equal(composeCalls(h)[2].body.day_edit, undefined, "the old replacement cannot survive Undo into another adjustment");
});

test("a change that leaves no route says so and offers the day back", async (t) => {
  const h = await arrive(t);
  await adjustRhythm(h, /^Full/);
  await h.fetchMock.respond(composeCalls(h)[1], structureOnly());
  await h.clock.advance(50);
  assert.match(changeNote(h), /^Changed: Balanced → Full · no route for this choice/);
  await click(h, buttonNamed(h, /^Undo this change$/));
  await h.clock.advance(1000);
  assert.deepEqual(routeStopNames(h).slice(0, 2), ["Place a", "Place b"]);
  assert.equal(composeCalls(h).length, 2);
});
