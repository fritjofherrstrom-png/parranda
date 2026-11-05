/**
 * The address bar carries the day as adjusted, so a reload reopens that day
 * instead of the arrival's inputs. A restored snapshot keeps its own address.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";
import { browserStorage } from "./helpers/exact-navigation-observation.mjs";
import { buildSavedEntry } from "../src/lib/anywhere-storage.mjs";

const LAST_KEY = "parranda:anywhere:last";

function composedDay() {
  const stops = [
    { id: "a", label: "Place a", lat: 55.6, lng: 13, type: "museum" },
    { id: "b", label: "Place b", lat: 55.601, lng: 13, type: "restaurant" },
  ];
  return {
    days: [{
      date: "2026-09-25",
      experimental_agnostic_route_applied: true,
      primary_route: {
        id: "__agnostic_compose__",
        main_stops: stops,
        estimated_km: 1.2,
        legs: [],
        map_route_points: [],
        map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })),
        confidence: "low",
      },
      alternatives: [],
    }],
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: null, lat: 55.6, lng: 13 } },
      promotion: { promote: true, readiness: "promotable" },
    },
  };
}

const composeCalls = (h) => h.fetchMock.calls.filter((call) => call.url.startsWith("/api/route-recommendations"));
const button = (h, name) =>
  [...h.container.querySelectorAll("button")].find((b) => name.test((b.getAttribute("aria-label") || b.textContent).trim()));
const click = (h, element) =>
  h.act(() => {
    element.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });

async function mount(t, url, options = {}) {
  const h = await mountPlanner({ url, ...options });
  t.after(() => h.unmount());
  h.document.addEventListener("click", (event) => event.preventDefault());
  return h;
}

for (const navigationType of ["reload", "back_forward"]) test(`an accepted adjustment owns the address and ${navigationType} restores that exact answer`, async (t) => {
  let h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&planner=open&lang=en" });
  let reloaded;
  t.after(async () => { if (reloaded) await reloaded.unmount(); if (h) await h.unmount(); });
  h.document.addEventListener("click", (event) => event.preventDefault());
  await h.clock.advance(500);
  const initial = composeCalls(h)[0];
  const original = composedDay();
  original.days[0].date = initial.body.dates[0];
  await h.fetchMock.respond(initial, original);
  await h.clock.advance(50);
  const before = h.readStorage(LAST_KEY);
  const beforeAddress = h.window.location.href;

  await click(h, button(h, /^Adjust/));
  await click(h, button(h, /^Relaxed/));
  await click(h, button(h, /^Tomorrow/));
  await h.clock.advance(450);
  const adjusted = composeCalls(h).at(-1);
  assert.equal(adjusted.body.day_rhythm, "calm");
  assert.notDeepEqual(adjusted.body.dates, initial.body.dates);
  assert.deepEqual(h.readStorage(LAST_KEY), before, "pending inputs cannot replace the accepted day");
  assert.equal(h.window.location.href, beforeAddress, "the accepted address stays authoritative while pending");
  const response = composedDay();
  response.days[0].date = adjusted.body.dates[0];
  response.days[0].primary_route.main_stops[0].label = "Accepted adjusted stop";
  await h.fetchMock.respond(adjusted, response);
  await h.clock.advance(50);
  const accepted = h.readStorage(LAST_KEY);
  const address = new URL(h.window.location.href);
  assert.equal(address.pathname, "/anywhere");
  assert.equal(address.searchParams.get("rhythm"), "calm");
  assert.equal(address.searchParams.get("day"), "1");
  assert.equal(address.searchParams.get("lang"), "en");
  assert.equal(accepted.dateIso, adjusted.body.dates[0]);
  assert.equal(accepted.inputs.walkKey, "calm");
  assert.equal(accepted.inputs.place, "Testville");
  const storage = browserStorage(h.window.localStorage);
  const sessionStorage = browserStorage(h.window.sessionStorage);
  const historyState = structuredClone(h.window.history.state);
  await h.unmount(); h = null;

  reloaded = await mountPlanner({ url: address.href, storage, sessionStorage, historyState, navigationType });
  await reloaded.clock.advance(2000);
  assert.equal(reloaded.fetchMock.calls.length, 0, "exact navigation makes no compose or background acquisition");
  assert.match(reloaded.text(), /Accepted adjusted stop/);
  assert.deepEqual(reloaded.readStorage(LAST_KEY), accepted, "restore retains the complete accepted answer and inputs");
  await click(reloaded, button(reloaded, /^Adjust/));
  await click(reloaded, button(reloaded, /^Full/));
  await reloaded.clock.advance(500);
  assert.equal(composeCalls(reloaded).length, 1, "an explicit adjustment still reaches the transport once");
  assert.equal(composeCalls(reloaded)[0].body.day_rhythm, "full");
  assert.deepEqual(composeCalls(reloaded)[0].body.dates, adjusted.body.dates, "ordinary edits keep the restored absolute date");
});

test("a restored snapshot keeps its restore address", async (t) => {
  const stored = buildSavedEntry({
    place: "Testville",
    dateIso: "2026-09-25",
    savedAt: "2026-09-25T09:00:00.000Z",
    safeResponse: composedDay(),
    classification: { status: "composed", hasStructure: false, placeLabel: "Testville" },
    inputs: { place: "Testville", mode: "typed", selected: ["food"], walkKey: "balanced", dayOffset: 0 },
  });
  const h = await mount(t, "http://localhost/anywhere?restore=last&lang=en", { storage: { [LAST_KEY]: stored } });
  await h.clock.advance(100);
  assert.match(h.text(), /Saved day/);
  assert.equal(h.window.location.search, "?restore=last&lang=en");
});
