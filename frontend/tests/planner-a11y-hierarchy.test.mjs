/**
 * The day page for keyboard and screen-reader readers, and the order a reader
 * meets it in: the day first, then what to do with it.
 *
 * - Adjust and Done swap places in the DOM; focus follows to the counterpart.
 * - A mounted status line says when a day is ready (and is cleared while a
 *   recompose runs, so the next arrival is announced again).
 * - The title is the page's h1; the sections below it are h2, dayparts h3.
 * - Maps, Save and Share come after the stops, not between title and map.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const PLACE_URL = "http://localhost/anywhere?place=Testville&lang=en";

const stop = (id, label, lat, daypart) => ({ id, label, lat, lng: 13, type: "museum", daypart });

function composedDay() {
  const stops = [stop("a", "Place a", 55.6, "morning"), stop("b", "Place b", 55.601, "afternoon"), stop("c", "Place c", 55.602, "afternoon")];
  return {
    days: [{
      date: "2026-09-25",
      experimental_agnostic_route_applied: true,
      primary_route: {
        id: "__agnostic_compose__",
        main_stops: stops,
        estimated_km: 2.1,
        legs: [],
        map_route_points: [],
        map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })),
        confidence: "low",
      },
      alternatives: [],
    }],
    place_structure: {
      provenance: "agnostic_anchor",
      area_count: 1,
      district_day: { areas: [{ center: { lat: 55.6, lng: 13 }, stops: [] }], legs: [], covered_intents: [], missing_intents: [] },
    },
    agnostic_route_output_experiment: { promotion: { promote: true, readiness: "promotable" } },
  };
}

async function planner(t) {
  const h = await mountPlanner({ url: PLACE_URL });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const compose = h.fetchMock.pending().find((call) => call.url.startsWith("/api/route-recommendations"));
  assert.ok(compose, "the planner composes on arrival");
  await h.fetchMock.respond(compose, composedDay());
  await h.clock.advance(50);
  return h;
}

const button = (h, name) =>
  [...h.container.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
const click = (h, element) => h.act(() => element.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true })));

test("Adjust hands focus to Done and back, so the keyboard is never dropped", async (t) => {
  const h = await planner(t);
  const adjust = button(h, "Adjust");
  adjust.focus();
  await click(h, adjust);
  const done = button(h, "Done");
  assert.ok(done, "the panel opens");
  assert.equal(h.window.document.activeElement, done, "focus moves to Done");
  assert.ok(h.window.document.getElementById(done.getAttribute("aria-controls")), "Done names the panel it closes");
  await click(h, done);
  assert.equal(h.window.document.activeElement, button(h, "Adjust"), "focus returns to Adjust");
});

test("a mounted status line announces the composed day", async (t) => {
  const h = await planner(t);
  const statuses = [...h.container.querySelectorAll('[role="status"]')].map((s) => s.textContent.trim());
  assert.ok(statuses.includes("A day in Testville is ready: 3 stops."), JSON.stringify(statuses));
});

test("one h1, then h2 sections and h3 dayparts", async (t) => {
  const h = await planner(t);
  const headings = [...h.container.querySelectorAll("h1, h2, h3")].map((e) => `${e.tagName} ${e.textContent.trim()}`);
  assert.equal(headings.filter((x) => x.startsWith("H1")).length, 1, JSON.stringify(headings));
  assert.match(headings[0], /^H1 A day in Testville/);
  assert.ok(headings.includes("H2 The stops, in order"), JSON.stringify(headings));
  assert.ok(headings.includes("H3 Morning") && headings.includes("H3 Afternoon"), JSON.stringify(headings));
});

test("Maps, Save and Share follow the stops", async (t) => {
  const h = await planner(t);
  const route = h.container.querySelector('section[aria-label="The route"]');
  const actions = h.container.querySelector('section[aria-label="Take the day with you"]');
  assert.ok(route && actions, "both sections render");
  assert.ok(route.compareDocumentPosition(actions) & h.window.Node.DOCUMENT_POSITION_FOLLOWING, "actions come after the route");
  assert.ok(actions.querySelector('a[href*="google.com/maps/dir/"]'), "the Maps link is with the actions");
  assert.ok(actions.querySelector('button[aria-label="Save this day"]'), "Save is with the actions");
  assert.equal(h.container.querySelector("header").querySelector('a[href*="google.com/maps/dir/"]'), null, "the title block carries no Maps link");
  assert.match(actions.textContent, /Google Maps works out the walking path/);
});
