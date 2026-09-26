/**
 * Switching language reopens the day that is on screen — with the adjustments
 * made since the page loaded, not only what its URL said on arrival. A near-me
 * day keeps its position across the switch (handed over in storage, never in
 * the URL), and speaks the page's language from its very first request.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const COORDS_KEY = "parranda:anchor:coords";

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
const languageLink = (h, code) =>
  [...h.container.querySelectorAll('[role="group"] a')].find((a) => a.textContent === code);
const click = (h, element) =>
  h.act(() => {
    element.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });

async function arrive(t, url, { sessionStorage = {} } = {}) {
  const h = await mountPlanner({ url, sessionStorage });
  t.after(() => h.unmount());
  // A link click must not try to navigate the test document.
  h.document.addEventListener("click", (event) => event.preventDefault());
  await h.clock.advance(500);
  return h;
}

test("the language link carries the adjustments made after the page loaded", async (t) => {
  const h = await arrive(t, "http://localhost/anywhere?place=Testville&lang=en");
  await h.fetchMock.respond(h.fetchMock.pending()[0], composedDay());
  await h.clock.advance(50);

  await click(h, button(h, /^Adjust/));
  await click(h, button(h, /^Long/));
  await click(h, button(h, /^Tomorrow$/));
  await click(h, button(h, /Views/));

  const params = new URLSearchParams(languageLink(h, "SV").getAttribute("href"));
  assert.equal(params.get("place"), "Testville");
  assert.equal(params.get("km"), "long", "the walking length chosen on the page");
  assert.equal(params.get("day"), "1", "the day chosen on the page");
  assert.equal(params.get("prefs"), "food,culture", "the picks as they are now");
  assert.equal(params.get("lang"), "sv");
});

test("a curated day's language link keeps its city identity", async (t) => {
  const h = await arrive(t, "http://localhost/anywhere?city=rome&place=Rome&planner=open&lang=en");
  const params = new URLSearchParams(languageLink(h, "SV").getAttribute("href"));
  assert.equal(params.get("city"), "rome");
  assert.equal(params.get("lang"), "sv");
});

test("a Swedish near-me day asks in Swedish and names the reader's position", async (t) => {
  const h = await arrive(t, "http://localhost/anywhere?anchor=near&planner=open&lang=sv", {
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } },
  });
  const [call] = composeCalls(h);
  assert.ok(call, "the handed-over position composes on arrival");
  assert.equal(call.url, "/api/route-recommendations?lang=sv", "the request carries the page's language, not the build's");
  await h.fetchMock.respond(call, composedDay());
  await h.clock.advance(50);

  assert.match(h.container.querySelector("header h2").textContent, /^En dag nära dig$/);
  assert.match(h.text(), /Nära dig · idag/);
  assert.doesNotMatch(h.text(), /your position|din position/i, "no baked-in label, in either language");
});

test("switching language on a near-me day hands the position to the next page, not the URL", async (t) => {
  const h = await arrive(t, "http://localhost/anywhere?anchor=near&planner=open&lang=en", {
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } },
  });
  await h.fetchMock.respond(composeCalls(h)[0], composedDay());
  await h.clock.advance(50);
  assert.equal(h.window.sessionStorage.getItem(COORDS_KEY), null, "arrival consumed the handoff");

  const swedish = languageLink(h, "SV");
  const params = new URLSearchParams(swedish.getAttribute("href"));
  assert.equal(params.get("anchor"), "near");
  assert.equal(params.get("lang"), "sv");
  assert.ok(![...params.keys()].some((key) => /lat|lng|coord/.test(key)), "coordinates never enter the URL");

  await click(h, swedish);
  const stored = JSON.parse(h.window.sessionStorage.getItem(COORDS_KEY));
  assert.deepEqual({ lat: stored.lat, lng: stored.lng }, { lat: 55.6, lng: 13 });
});

test("a restored near-me snapshot, with no position in memory, switches language by restoring itself", async (t) => {
  const first = await mountPlanner({
    url: "http://localhost/anywhere?anchor=near&planner=open&lang=en",
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } },
  });
  await first.clock.advance(500);
  await first.fetchMock.respond(composeCalls(first)[0], composedDay());
  const stored = first.readStorage("parranda:anywhere:last");
  assert.ok(stored, "the composed near-me day was kept for a reload");
  await first.unmount();

  const h = await mountPlanner({ url: "http://localhost/anywhere?lang=en", storage: { "parranda:anywhere:last": stored } });
  t.after(() => h.unmount());
  h.document.addEventListener("click", (event) => event.preventDefault());
  await h.clock.advance(50);
  assert.match(h.text(), /Saved day/, "the snapshot is on screen");
  assert.equal(languageLink(h, "SV").getAttribute("href"), "?lang=sv", "nothing to hand over: the snapshot restores itself");
  await click(h, languageLink(h, "SV"));
  assert.equal(h.window.sessionStorage.getItem(COORDS_KEY), null);
});

test("going home from a near-me day leaves no position behind", async (t) => {
  const h = await arrive(t, "http://localhost/anywhere?anchor=near&planner=open&lang=en", {
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } },
  });
  await h.fetchMock.respond(composeCalls(h)[0], composedDay());
  await click(h, h.container.querySelector('a[aria-label="Parranda — home"]'));
  assert.equal(h.window.sessionStorage.getItem(COORDS_KEY), null);
});

test("a near-me page without a position offers to share it again, and only asks on the tap", async (t) => {
  let asked = 0;
  const h = await arrive(t, "http://localhost/anywhere?anchor=near&planner=open&lang=en");
  Object.defineProperty(h.window.navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: (ok) => { asked += 1; ok({ coords: { latitude: 55.61, longitude: 13.01 } }); } },
  });
  assert.equal(composeCalls(h).length, 0, "nothing composes without a position");
  assert.equal(asked, 0, "arrival never asks for the position");
  assert.match(h.text(), /Your position isn't kept when the page reloads/);

  await click(h, button(h, /^Use my location$/));
  await h.clock.advance(10);
  assert.equal(asked, 1);
  const [call] = composeCalls(h);
  assert.ok(call, "the shared position composes the day");
  assert.equal(call.body.lat, 55.61);
});

test("a blocked position on the planner says so and stays put", async (t) => {
  const h = await arrive(t, "http://localhost/anywhere?anchor=near&planner=open&lang=sv");
  Object.defineProperty(h.window.navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) },
  });
  await click(h, button(h, /^Använd min position$/));
  await h.clock.advance(10);
  assert.match(h.text(), /Positionen blockerades/);
  assert.equal(composeCalls(h).length, 0);
});
