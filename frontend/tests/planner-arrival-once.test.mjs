/**
 * One arrival, one compose — and a position chosen once is never asked for
 * again in the background.
 *
 * A share or language link carries the day's inputs. Adopting them on arrival
 * is not an adjustment: the arrival compose already carries them, so no second,
 * identical compose follows. A real change in Adjust still recomposes. On a
 * near-me day, recomposing reuses the position the user chose; the browser is
 * asked only from the explicit "Use my location" tap — never in the background,
 * where a refusal (a revoked or "ask every time" permission) would cost the day.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const COORDS_KEY = "parranda:anchor:coords";
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

/**
 * A browser geolocation that counts every request. "grant" answers with a
 * position, "deny" refuses (a revoked permission), and "prompt" never answers
 * (an "ask every time" permission: the prompt sits there, unanswered).
 */
function geolocation(h, answer) {
  const asked = { count: 0 };
  Object.defineProperty(h.window.navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok, fail) => {
        asked.count += 1;
        if (answer === "deny") fail({ code: 1 });
        else if (answer === "grant") ok({ coords: { latitude: 55.61, longitude: 13.01 } });
      },
    },
  });
  return asked;
}

async function mount(t, url, options = {}) {
  const h = await mountPlanner({ url, ...options });
  t.after(() => h.unmount());
  h.document.addEventListener("click", (event) => event.preventDefault());
  return h;
}

test("a link that carries the day's inputs composes exactly once for them", async (t) => {
  const h = await mount(t, "http://localhost/anywhere?place=Testville&planner=open&prefs=food%2Cculture&km=long&day=1&lang=en");
  await h.clock.advance(500);
  const calls = composeCalls(h);
  assert.equal(calls.length, 1, "the arrival compose");
  assert.equal(calls[0].body.walking_km_target, 9);
  assert.deepEqual(calls[0].body.preferences, ["food", "culture"]);
  await h.fetchMock.respond(calls[0], composedDay());
  await h.clock.advance(2000);
  assert.equal(composeCalls(h).length, 1, "adopting the link's inputs is not an adjustment");
});

test("a curated language link with the default picks composes once, answered or not", async (t) => {
  const h = await mount(t, "http://localhost/anywhere?city=rome&place=Rome&planner=open&prefs=food%2Cculture%2Cviews&lang=en");
  await h.clock.advance(2500);
  assert.equal(composeCalls(h).length, 1);
});

// Whether or not the arrival adopted anything, the first real change in Adjust
// recomposes — the arrival's skip is spent on the arrival, never on the user.
for (const [arrival, url, picks] of [
  ["a link whose inputs differ from the defaults", "?place=Testville&planner=open&prefs=food%2Cculture&km=long&lang=en", ["food", "culture"]],
  ["a language link with the default picks", "?city=rome&place=Rome&planner=open&prefs=food%2Cculture%2Cviews&lang=en", ["food", "culture", "views"]],
  ["the landing's plain link", "?place=Testville&planner=open&lang=en", ["food", "culture", "views"]],
]) {
  test(`a real adjustment after ${arrival} still recomposes`, async (t) => {
    const h = await mount(t, `http://localhost/anywhere${url}`);
    await h.clock.advance(500);
    assert.equal(composeCalls(h).length, 1, "the arrival compose");
    await h.fetchMock.respond(composeCalls(h)[0], composedDay());
    await h.clock.advance(50);

    await click(h, button(h, /^Adjust/));
    await click(h, button(h, /^Short/));
    await h.clock.advance(450);
    const calls = composeCalls(h);
    assert.equal(calls.length, 2, "one recompose for the change");
    assert.equal(calls[1].body.walking_km_target, 4);
    assert.deepEqual(calls[1].body.preferences, picks, "the arrival's picks stay");
  });
}

for (const permission of ["deny", "prompt"]) {
  test(`a language switch on a near-me day reuses the handed-over position (permission: ${permission})`, async (t) => {
    // The language link a near-me day produces, with Adjust's picks and length
    // on it; the position itself arrives in storage.
    const h = await mount(t, "http://localhost/anywhere?planner=open&prefs=food%2Cculture&km=long&lang=sv&anchor=near", {
      sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } },
    });
    const asked = geolocation(h, permission);
    await h.clock.advance(500);
    const calls = composeCalls(h);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/route-recommendations?lang=sv");
    assert.deepEqual([calls[0].body.lat, calls[0].body.lng], [55.6, 13]);
    assert.equal(calls[0].body.walking_km_target, 9);
    await h.fetchMock.respond(calls[0], composedDay());
    await h.clock.advance(2000);

    assert.equal(asked.count, 0, "the browser is never asked in the background");
    assert.equal(composeCalls(h).length, 1, "no second compose either");
    assert.match(h.container.querySelector("header h2").textContent, /^En dag nära dig$/);
    assert.match(h.text(), /Nära dig · idag/);
    assert.doesNotMatch(h.text(), /Platsdelning nekades|Planera en dag var som helst/);
  });
}

test("adjusting a near-me day reuses the chosen position and asks no one", async (t) => {
  const h = await mount(t, "http://localhost/anywhere?anchor=near&planner=open&lang=en", {
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } },
  });
  const asked = geolocation(h, "grant");
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], composedDay());
  await h.clock.advance(50);

  await click(h, button(h, /^Adjust/));
  await click(h, button(h, /^Long/));
  await h.clock.advance(450);
  const calls = composeCalls(h);
  assert.equal(calls.length, 2, "the adjustment recomposes");
  assert.deepEqual([calls[1].body.lat, calls[1].body.lng], [55.6, 13], "around the same position");
  assert.equal(calls[1].body.walking_km_target, 9);
  assert.equal(asked.count, 0);
});

test("a restored near-me day asks for the position only on the explicit tap", async (t) => {
  const first = await mountPlanner({
    url: "http://localhost/anywhere?anchor=near&planner=open&lang=en",
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } },
  });
  await first.clock.advance(500);
  await first.fetchMock.respond(composeCalls(first)[0], composedDay());
  const stored = first.readStorage(LAST_KEY);
  await first.unmount();

  const h = await mount(t, "http://localhost/anywhere?lang=en", { storage: { [LAST_KEY]: stored } });
  const asked = geolocation(h, "grant");
  await h.clock.advance(50);
  assert.match(h.text(), /Saved day/, "the snapshot is on screen");

  await click(h, button(h, /^rebuild for fresh events$/));
  await h.clock.advance(100);
  assert.equal(asked.count, 0, "a rebuild does not ask in the background");
  assert.equal(composeCalls(h).length, 0);
  assert.match(h.text(), /Your position isn't kept when the page reloads/);

  await click(h, button(h, /^Use my location$/));
  await h.clock.advance(10);
  assert.equal(asked.count, 1, "the tap asks");
  const [call] = composeCalls(h);
  assert.deepEqual([call.body.lat, call.body.lng], [55.61, 13.01]);
});

test("refusing the new consent after a reload leaves no empty place and no day", async (t) => {
  const h = await mount(t, "http://localhost/anywhere?anchor=near&planner=open&lang=sv");
  const asked = geolocation(h, "deny");
  await h.clock.advance(100);
  assert.equal(asked.count, 0, "arrival without a position does not ask");
  assert.match(h.text(), /Din position följer inte med när sidan laddas om/);

  await click(h, button(h, /^Använd min position$/));
  await h.clock.advance(10);
  assert.equal(asked.count, 1);
  assert.equal(composeCalls(h).length, 0);
  assert.match(h.text(), /Positionen blockerades — byt till en stad eller plats i stället\./);
  assert.match(h.text(), /Nära dig · idag/, "still a near-me page");
  assert.doesNotMatch(h.text(), /för\s+ännu|for\s+yet|Planera en dag var som helst|En dag i|En dag nära dig/);
});
