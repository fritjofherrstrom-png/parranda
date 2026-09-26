/**
 * Blitz is offered only where it can answer, and says only what is true: "near
 * you" when the anchor is the reader's position, the place's name otherwise,
 * and "your day stays as it is" only when there is a day on screen. A typed
 * place Parranda could not pin down says so, with a way forward, instead of
 * pointing at Blitz.
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
      intake: { status: "resolved", resolved: { label: "Testville, Region", lat: 55.6, lng: 13 } },
      promotion: { promote: true, readiness: "promotable" },
    },
  };
}

const unresolved = {
  days: [],
  agnostic_route_output_experiment: {
    intake: { mode: "place", query: "Nowhereville", status: "unresolved", resolved: null, blockers: ["place_not_resolved"] },
    source_status: { status: "no_anchor", anchor: null },
  },
};

const resolvedButEmpty = {
  days: [],
  agnostic_route_output_experiment: {
    intake: { mode: "coordinates", status: "resolved", resolved: { label: null, lat: 55.6, lng: 13 } },
    source_status: { status: "error_failed_closed" },
  },
};

const blitzButton = (h) => [...h.container.querySelectorAll("button")].find((b) => /Blitz/.test(b.textContent));
const click = (h, element) =>
  h.act(() => {
    element.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });

async function planner(t, url, response, { status = 200, sessionStorage = {} } = {}) {
  const h = await mountPlanner({ url, sessionStorage });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const compose = h.fetchMock.pending().find((call) => call.url.startsWith("/api/route-recommendations"));
  assert.ok(compose, "the planner composes on arrival");
  await h.fetchMock.respond(compose, response, status);
  await h.clock.advance(50);
  return h;
}

test("a typed place's Blitz names the place, and promises the day only when there is one", async (t) => {
  const h = await planner(t, "http://localhost/anywhere?place=Testville&lang=en", composedDay());
  assert.ok(blitzButton(h), "Blitz is offered beside a composed day");
  assert.match(h.text(), /One next move in Testville, right now — your day stays as it is\./);
  assert.doesNotMatch(h.text(), /near you/);

  await click(h, blitzButton(h));
  const call = h.fetchMock.pending().find((c) => c.url.includes("/api/blitz"));
  await h.fetchMock.respond(call, { contract: "anywhere_contextual_blitz_v1", status: "blocked", reasons: ["no_candidates"] });
  assert.match(h.text(), /No sufficiently reliable next move was found in Testville right now\. Your day is unchanged\./);
});

test("a near-me day's Blitz is about the reader's position", async (t) => {
  const h = await planner(t, "http://localhost/anywhere?anchor=near&planner=open&lang=sv", composedDay(), {
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } },
  });
  assert.match(h.text(), /Ett nästa drag nära dig, just nu — din dag ändras inte\./);
});

test("without a day on screen, Blitz makes no promise about one", async (t) => {
  const h = await planner(t, "http://localhost/anywhere?anchor=near&planner=open&lang=en", resolvedButEmpty, {
    sessionStorage: { [COORDS_KEY]: { lat: 55.6, lng: 13 } },
  });
  assert.match(h.text(), /Parranda couldn't compose a day near you yet/);
  assert.match(h.text(), /One next move near you, right now\./);
  assert.doesNotMatch(h.text(), /your day stays as it is|Your day is unchanged/);

  await click(h, blitzButton(h));
  const call = h.fetchMock.pending().find((c) => c.url.includes("/api/blitz"));
  await h.fetchMock.respond(call, { contract: "anywhere_contextual_blitz_v1", status: "blocked", reasons: ["no_candidates"] });
  assert.match(h.text(), /No sufficiently reliable next move was found near you right now\./);
  assert.doesNotMatch(h.text(), /Your day is unchanged/);
});

test("a typed place Parranda could not pin down says so, offers a way forward, and no Blitz", async (t) => {
  const h = await planner(t, "http://localhost/anywhere?place=Nowhereville&lang=en", unresolved);
  assert.match(h.text(), /Parranda couldn't pin down “Nowhereville” right now\. Try another spelling or add a country or region/);
  assert.doesNotMatch(h.text(), /couldn't compose a day/);
  const another = [...h.container.querySelectorAll("a")].find((a) => a.textContent === "Choose another place");
  assert.ok(another, "the notice offers a way forward");
  assert.equal(another.getAttribute("href"), "/?lang=en");
  assert.equal(blitzButton(h), undefined, "Blitz has no place to read, so it is not offered");
});

test("a capacity refusal is not followed by an offer that asks the same server", async (t) => {
  const h = await planner(t, "http://localhost/anywhere?place=Testville&lang=en", { error: "busy" }, { status: 429 });
  assert.match(h.text(), /Parranda is composing as many days as it safely can right now/);
  assert.equal(blitzButton(h), undefined);
});

test("a stop kind this build has no words for gets no chip, never a raw token", async (t) => {
  const response = composedDay();
  response.days[0].primary_route.main_stops[0].type = "church";
  response.days[0].primary_route.main_stops[1].type = "some_new_engine_kind";
  const h = await planner(t, "http://localhost/anywhere?place=Testville&lang=sv", response);
  const route = h.container.querySelector('section[aria-label="Rutten"]').textContent;
  assert.match(route, /Kyrka/);
  assert.doesNotMatch(route, /some_new_engine_kind|church/);
});
