/**
 * The address bar carries the day as adjusted, so a reload reopens that day
 * instead of the arrival's inputs. A restored snapshot keeps its own address.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";
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

test("an adjustment is written to the address, and reloading that address composes the adjusted day", async (t) => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&planner=open&lang=en" });
  h.document.addEventListener("click", (event) => event.preventDefault());
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], composedDay());
  await h.clock.advance(50);

  await click(h, button(h, /^Adjust/));
  await click(h, button(h, /^Easy/));
  await click(h, button(h, /^Tomorrow/));
  await h.clock.advance(450);
  const address = new URLSearchParams(h.window.location.search);
  assert.equal(h.window.location.pathname, "/anywhere");
  assert.equal(address.get("place"), "Testville");
  assert.equal(address.get("rhythm"), "calm");
  assert.equal(address.get("day"), "1");
  assert.equal(address.get("lang"), "en");
  const search = h.window.location.search;
  await h.unmount();

  const reloaded = await mount(t, `http://localhost/anywhere${search}`);
  await reloaded.clock.advance(500);
  const [arrival] = composeCalls(reloaded);
  assert.equal(arrival.body.place, "Testville");
  assert.equal(arrival.body.day_rhythm, "calm");
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
