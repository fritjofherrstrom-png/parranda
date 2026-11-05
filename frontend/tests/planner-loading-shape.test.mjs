/**
 * While a day composes, the screen holds the day's own shape.
 *
 * The placeholder used to show a tall map ABOVE the stops — the layout before
 * "on a phone the day comes first" (StopLine). The day then landed in a
 * different order: the stops jumped up, the map jumped down, and on wide
 * screens everything jumped sideways into two columns. Seen on an iPhone
 * (Göteborg, 22 Oct 2026). The shape now follows the day it stands for.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const CHOSEN_PLACE_URL = "http://localhost/anywhere?place=Testville%2C+Testshire%2C+Testland&place_ref=n123&lang=en";

const wideScreen = {
  matchMedia: (query) => ({
    matches: query === "(min-width: 64rem)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }),
};

function composedDay() {
  const stops = [
    { id: "a", label: "Place a", lat: 55.6, lng: 13, type: "museum", covered_preferences: ["museums"] },
    { id: "b", label: "Place b", lat: 55.601, lng: 13, type: "restaurant", covered_preferences: ["food"] },
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
    agnostic_route_output_experiment: { promotion: { promote: true, readiness: "promotable" } },
  };
}

async function composing(t, injected = {}) {
  const h = await mountPlanner({ url: CHOSEN_PLACE_URL, injected });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const compose = h.fetchMock.pending().find((call) => call.url.startsWith("/api/route-recommendations"));
  assert.ok(compose, "the planner composes on arrival");
  return { h, compose };
}

const shape = (h, part) => h.container.querySelector(`[data-day-shape="${part}"]`);
const follows = (earlier, later) => Boolean(earlier.compareDocumentPosition(later) & 4 /* DOCUMENT_POSITION_FOLLOWING */);

test("on a phone the shape is the day's order: heading, the map's overview, then the stops", async (t) => {
  const { h } = await composing(t);
  const heading = shape(h, "heading");
  const stations = shape(h, "stations");
  const map = shape(h, "map");
  assert.ok(heading && stations && map, "heading, stations and map are all held");
  assert.ok(follows(heading, map), "the overview follows the heading, as in the day itself");
  assert.ok(follows(map, stations), "the stops follow the overview");
  assert.equal(shape(h, "map-column"), null, "no wide-screen column on a phone");
});

test("the shape is silent and moves as one slow sheen, never blinking or flashing ember", async (t) => {
  const { h } = await composing(t);
  for (const part of ["heading", "stations", "map"]) {
    assert.ok(shape(h, part).closest('[aria-hidden="true"]'), `${part} is decorative`);
    assert.equal(shape(h, part).textContent.trim(), "", `${part} carries no text, number or place`);
  }
  // A whole block pulsing on and off read as blinking; a still grey page read
  // as broken; ember stations lighting in turn read as hectic.
  assert.equal(h.container.querySelector("main .animate-pulse, main [class*='motion-safe:animate-pulse']"), null);
  assert.equal(h.container.querySelector("main [class*='parranda-trace'], main [data-day-shape] [class*='ember']"), null);
  const shapes = [...h.container.querySelectorAll("main [aria-hidden='true'] .skeleton")];
  assert.ok(shapes.length >= 15, `every placeholder shape carries the sheen (${shapes.length})`);
  for (const element of shapes) assert.match(element.className, /motion-safe:animate-\[parranda-sheen_2\.8s_ease-in-out_infinite\]/);
  // The stations breathe instead: a soft wave down the line, a beat apart.
  const stations = [...shape(h, "stations").querySelectorAll("[data-day-station]")];
  assert.equal(stations.length, 5, "five stations");
  for (const station of stations) assert.match(station.className, /motion-safe:animate-\[parranda-breathe_2\.8s_ease-in-out_infinite\]/);
  assert.deepEqual(stations.map((station) => station.style.animationDelay), ["0ms", "300ms", "600ms", "900ms", "1200ms"]);
  // The status line is still the one thing a reader hears.
  assert.match(h.container.querySelector('main [aria-live="polite"]').textContent, /Finding the place/);
});

test("a wide screen holds both columns while composing, and the map takes its frame", async (t) => {
  const { h, compose } = await composing(t, wideScreen);
  const column = shape(h, "map-column");
  assert.ok(column, "the map's column is held beside the day");
  assert.equal(column.getAttribute("aria-hidden"), "true");
  assert.equal(column.parentElement, h.container.querySelector("main").parentElement, "it is the grid's second column");
  assert.equal(shape(h, "map"), null, "no map inside the day's column on a wide screen");

  await h.fetchMock.respond(compose, composedDay());
  await h.clock.advance(50);

  assert.equal(shape(h, "map-column"), null, "the placeholder gives way");
  assert.ok(h.container.querySelector('aside[aria-label="Map of the day"]'), "the day's map stands in the same column");
});

test("a chosen place reads by its own name while the day composes", async (t) => {
  // "Testville, Testshire, Testland" wrapped onto two lines and then shrank to
  // "Testville" once the resolver answered, moving everything below it.
  const { h } = await composing(t);
  const pill = h.container.querySelector("main").textContent;
  assert.match(pill, /Testville/);
  assert.doesNotMatch(pill, /Testshire/);
});

test("while the day composes the wordmark stays still and the status line carries the drawing ring", async (t) => {
  // A drawing wordmark, a walker and the skeleton all moving at once read as
  // too busy (iPhone, 23 Oct 2026): the ring moved down to the status line.
  const { h, compose } = await composing(t);
  const wordmark = () => h.container.querySelector("nav a[aria-label] > [aria-hidden='true']");
  assert.equal(wordmark().tagName, "SPAN");
  assert.doesNotMatch(wordmark().className, /animate-/, "the wordmark's ring never moves");
  const status = h.container.querySelector('main [aria-live="polite"]');
  const ring = status.querySelector("svg[data-ring-mark]");
  assert.ok(ring, "the status line carries the drawing ring");
  assert.equal(ring.getAttribute("aria-hidden"), "true");
  assert.match(ring.querySelector("circle[pathLength]").getAttribute("class"), /parranda-mark-draw/);
  assert.equal(h.container.querySelector("[data-walk-mark], [data-brand-mark]"), null);

  await h.fetchMock.respond(compose, composedDay());
  await h.clock.advance(50);
  assert.equal(wordmark().tagName, "SPAN");
  assert.doesNotMatch(wordmark().className, /animate-/);
});
