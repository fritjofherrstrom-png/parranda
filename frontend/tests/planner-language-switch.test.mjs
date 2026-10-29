/**
 * Language follows the accepted answer, not draft controls or just the arrival
 * URL. A position-based answer restores its private exact view without turning
 * published geometry into another reusable GPS-consent handoff.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mountPlanner } from "./helpers/planner-harness.mjs";

const COORDS_KEY = "parranda:anchor:coords";
const LAST = "parranda:anywhere:last";

function composedDay(dateIso) {
  assert.match(dateIso, /^\d{4}-\d{2}-\d{2}$/, "fixture date comes from the actual request");
  const stops = [
    { id: "a", label: "Place a", lat: 55.6, lng: 13, type: "museum" },
    { id: "b", label: "Place b", lat: 55.601, lng: 13, type: "restaurant" },
  ];
  return {
    days: [{
      date: dateIso,
      experimental_agnostic_route_applied: true,
      primary_route: {
        id: "__agnostic_compose__", main_stops: stops, estimated_km: 1.2, legs: [],
        // This fixture was composed from the explicit 55.6,13 handoff below.
        // Its published start is display evidence, never a fresh position fix.
        map_route_points: [{ lat: 55.6, lng: 13, role: "start" },
          ...stops.map(({ lat, lng, label }) => ({ lat, lng, label, role: "stop" }))],
        map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })), confidence: "low",
      },
      alternatives: [],
    }],
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: null, lat: 55.6, lng: 13 } },
      promotion: { promote: true, readiness: "promotable" },
    },
  };
}
const composeCalls = h => h.fetchMock.calls.filter(call => call.url.startsWith("/api/route-recommendations"));
const button = (h, name) => [...h.container.querySelectorAll("button")]
  .find(b => name.test((b.getAttribute("aria-label") || b.textContent).trim()));
const languageLink = (h, code) => [...h.container.querySelectorAll('[role="group"] a')].find(a => a.textContent === code);
const click = (h, element) => h.act(() => {
  assert.ok(element, "the actual offered control exists");
  element.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
});
const answerDay = (h, call) => h.fetchMock.respond(call, composedDay(call.body.dates[0]));
const browserStorage = storage => Object.fromEntries(Array.from({ length: storage.length }, (_, index) => {
  const key = storage.key(index);
  return [key, JSON.parse(storage.getItem(key))];
}));
async function arrive(t, url, { sessionStorage = {} } = {}) {
  const h = await mountPlanner({ url, sessionStorage });
  t.after(() => h.unmount());
  h.document.addEventListener("click", event => event.preventDefault());
  await h.clock.advance(500);
  return h;
}

test("the language link follows accepted adjustments, never unanswered draft controls", async t => {
  const h = await arrive(t, "http://localhost/anywhere?place=Testville&lang=en");
  await answerDay(h, composeCalls(h)[0]);
  await h.clock.advance(50);
  const acceptedHref = languageLink(h, "SV").getAttribute("href");
  await click(h, button(h, /^Adjust/));
  await click(h, button(h, /^Full/));
  await click(h, button(h, /^Tomorrow$/));
  await click(h, button(h, /Views/));
  assert.equal(languageLink(h, "SV").getAttribute("href"), acceptedHref,
    "draft controls cannot replace the on-screen publication's language target");
  await h.clock.advance(450);
  const adjustment = composeCalls(h).at(-1);
  assert.equal(adjustment.body.day_rhythm, "full");
  assert.deepEqual(adjustment.body.preferences, ["food", "culture"]);
  await answerDay(h, adjustment);
  await h.clock.advance(50);
  const params = new URL(languageLink(h, "SV").href).searchParams;
  assert.equal(params.get("place"), "Testville");
  assert.equal(params.get("rhythm"), "full");
  assert.equal(params.has("km"), false, "rhythm is not a kilometer goal");
  assert.equal(params.get("day"), "1");
  assert.equal(params.get("prefs"), "food,culture");
  assert.equal(params.get("lang"), "sv");
  assert.match(params.get("view"), /^[a-f0-9]{32}$/);
});

test("a legacy city day's language link keeps its place on the shared planner", async t => {
  const h = await arrive(t, "http://localhost/anywhere?city=rome&place=Rome&planner=open&lang=en");
  const params = new URLSearchParams(languageLink(h, "SV").getAttribute("href"));
  assert.equal(params.has("city"), false);
  assert.equal(params.get("place"), "Rome");
  assert.equal(params.get("lang"), "sv");
});

test("a Swedish near-me day asks in Swedish and names the reader's position", async t => {
  const h = await arrive(t, "http://localhost/anywhere?anchor=near&planner=open&lang=sv", {
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } },
  });
  const [call] = composeCalls(h);
  assert.ok(call, "the handed-over position composes on arrival");
  assert.equal(call.url, "/api/route-recommendations?lang=sv&include_live_completion=1&include_live_route_upgrade=1",
    "the request carries the page's language and does not opt coordinates into sharing");
  await answerDay(h, call);
  await h.clock.advance(50);
  assert.equal(h.container.querySelector("header h1").textContent, "nära dig");
  assert.match(h.text(), /Nära dig · idag/);
  assert.equal(call.body.place, undefined);
  assert.doesNotMatch(h.text(), /your position/i);
  assert.match(h.text(), /Start: Din position · Slut: Din position/);
});

test("switching language on a near-me day restores its exact view without another GPS handoff", async t => {
  let first = await mountPlanner({ url: "http://localhost/anywhere?anchor=near&planner=open&lang=en",
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } } });
  let next = null;
  t.after(async () => { if (next) await next.unmount(); if (first) await first.unmount(); });
  first.document.addEventListener("click", event => event.preventDefault());
  await first.clock.advance(500);
  await answerDay(first, composeCalls(first)[0]);
  await first.clock.advance(50);
  assert.equal(first.window.sessionStorage.getItem(COORDS_KEY), null, "arrival consumed the handoff");
  const swedish = languageLink(first, "SV");
  const target = swedish.href;
  const params = new URL(target).searchParams;
  assert.equal(params.get("anchor"), "near");
  assert.equal(params.get("lang"), "sv");
  assert.match(params.get("view"), /^[a-f0-9]{32}$/);
  assert.ok(![...params.keys()].some(key => /lat|lng|coord/.test(key)), "coordinates never enter the URL");
  const before = first.readStorage(LAST);
  await click(first, swedish);
  assert.equal(first.window.sessionStorage.getItem(COORDS_KEY), null, "display permission is not fresh GPS consent");
  const storage = browserStorage(first.window.localStorage);
  const sessionStorage = browserStorage(first.window.sessionStorage);
  await first.unmount(); first = null;
  next = await mountPlanner({ url: target, storage, sessionStorage, props: { lang: "sv" }, navigationType: "navigate" });
  await next.clock.advance(1000);
  assert.equal(next.fetchMock.calls.length, 0, "language navigation does not acquire or recompose");
  assert.match(next.text(), /Place a/);
  assert.match(next.text(), /Place b/);
  assert.deepEqual(next.readStorage(LAST).safeResponse.days, before.safeResponse.days);
  assert.equal(next.window.sessionStorage.getItem(COORDS_KEY), null);
});

test("a restored near-me snapshot without a position switches language through its exact saved view", async t => {
  let first = await mountPlanner({ url: "http://localhost/anywhere?anchor=near&planner=open&lang=en",
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } } });
  let saved = null, next = null;
  t.after(async () => { if (next) await next.unmount(); if (saved) await saved.unmount(); if (first) await first.unmount(); });
  await first.clock.advance(500);
  await answerDay(first, composeCalls(first)[0]);
  const stored = first.readStorage(LAST);
  assert.ok(stored, "the actual composed position day was remembered");
  await first.unmount(); first = null;
  saved = await mountPlanner({ url: "http://localhost/anywhere?restore=last&lang=en", storage: { [LAST]: stored } });
  saved.document.addEventListener("click", event => event.preventDefault());
  await saved.clock.advance(50);
  assert.match(saved.text(), /Saved day/);
  const target = languageLink(saved, "SV").href;
  const params = new URL(target).searchParams;
  assert.equal(params.get("restore"), "last");
  assert.equal(params.get("lang"), "sv");
  assert.match(params.get("view"), /^[a-f0-9]{32}$/, "the saved answer, not mutable global LAST, owns navigation");
  await click(saved, languageLink(saved, "SV"));
  assert.equal(saved.window.sessionStorage.getItem(COORDS_KEY), null);
  const storage = browserStorage(saved.window.localStorage);
  const sessionStorage = browserStorage(saved.window.sessionStorage);
  await saved.unmount(); saved = null;
  next = await mountPlanner({ url: target, storage, sessionStorage, props: { lang: "sv" }, navigationType: "navigate" });
  await next.clock.advance(500);
  assert.equal(next.fetchMock.calls.length, 0);
  assert.match(next.text(), /Sparad dag/);
  assert.match(next.text(), /Place a/);
  assert.equal(next.window.sessionStorage.getItem(COORDS_KEY), null);
});

test("going home from a near-me day leaves no position behind", async t => {
  const h = await arrive(t, "http://localhost/anywhere?anchor=near&planner=open&lang=en", {
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } },
  });
  await answerDay(h, composeCalls(h)[0]);
  await click(h, h.container.querySelector('a[aria-label="Parranda — home"]'));
  assert.equal(h.window.sessionStorage.getItem(COORDS_KEY), null);
});

test("a near-me page without a position offers to share it again, and only asks on the tap", async t => {
  let asked = 0;
  const h = await arrive(t, "http://localhost/anywhere?anchor=near&planner=open&lang=en");
  Object.defineProperty(h.window.navigator, "geolocation", { configurable: true,
    value: { getCurrentPosition: ok => { asked++; ok({ coords: { latitude: 55.61, longitude: 13.01 } }); } } });
  assert.equal(composeCalls(h).length, 0);
  assert.equal(asked, 0, "arrival never asks for the position");
  assert.match(h.text(), /Your position isn't kept when the page reloads/);
  await click(h, button(h, /^Use my location$/));
  await h.clock.advance(10);
  assert.equal(asked, 1);
  const [call] = composeCalls(h);
  assert.ok(call);
  assert.equal(call.body.lat, 55.61);
});

test("a blocked position on the planner says so and stays put", async t => {
  const h = await arrive(t, "http://localhost/anywhere?anchor=near&planner=open&lang=sv");
  Object.defineProperty(h.window.navigator, "geolocation", { configurable: true,
    value: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) } });
  await click(h, button(h, /^Använd min position$/));
  await h.clock.advance(10);
  assert.match(h.text(), /Positionen blockerades/);
  assert.equal(composeCalls(h).length, 0);
});
