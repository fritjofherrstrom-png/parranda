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

test("near-me sentences use near you while named anchors retain in-place copy", async () => {
  for (const lang of ["en", "sv"]) {
    for (const named of [false, true]) {
      const h = await mountPlanner({
        url: `http://localhost/anywhere?anchor=near&lang=${lang}`,
        props: { lang },
        sessionStorage: { "parranda:anchor:coords": { lat: 55.6, lng: 13 } },
      });
      try {
        await h.clock.advance(500);
        const context = lang === "en" ? (named ? "in Testville" : "near you") : (named ? "i Testville" : "nära dig");
        assert.equal(h.container.querySelector("h1").textContent, `${lang === "en" ? "Your day" : "Din dag"} ${lang === "en" ? "near you" : "nära dig"}`);
        const compose = h.fetchMock.pending().find((call) => call.url.startsWith("/api/route-recommendations"));
        assert.ok(compose, "coordinates compose without another permission prompt");
        await h.fetchMock.respond(compose, { ...composedDay(), ...(named ? { resolved_place_label: "Testville, Region, Country" } : {}) });
        await h.clock.advance(50);
        const expected = lang === "en" ? `A day ${context} is ready: 3 stops.` : `En dag ${context} är klar: 3 stopp.`;
        assert.ok([...h.container.querySelectorAll('[role="status"]')].some((s) => s.textContent === expected), expected);
      } finally {
        await h.unmount();
      }
    }
  }
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

test("a place with no day says so as a status, not silently", async (t) => {
  const h = await mountPlanner({ url: PLACE_URL });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const compose = h.fetchMock.pending().find((call) => call.url.startsWith("/api/route-recommendations"));
  await h.fetchMock.respond(compose, { days: [], agnostic_route_output_experiment: { promotion: { promote: false, readiness: "non_promotable" } } });
  await h.clock.advance(50);
  const statuses = [...h.container.querySelectorAll('[role="status"]')].map((s) => s.textContent.trim());
  assert.ok(statuses.some((s) => /couldn't compose a day|couldn't pin down/.test(s)), JSON.stringify(statuses));
  assert.equal(h.container.querySelectorAll("h1").length, 1, "the page is still named");
});

test("the pre-mounted status receives final unavailable copy without another failure region", async () => {
  const resolved = { status: "resolved", resolved: { label: "Testville, Region, Country" } };
  const cases = [
    { intake: { status: "unresolved" }, expected: "Parranda couldn't pin down “Testville” right now. Try another spelling or add a country or region — nothing is invented in its place." },
    { intake: resolved, expected: "Parranda couldn't compose a day for Testville yet — nothing is invented in its place." },
    { intake: resolved, candidate_readiness: { real_place_count: 2 }, readiness_blockers: ["insufficient_geocoded_candidates"], expected: "Parranda found 2 real places near Testville, but not enough for a reliable day yet — nothing is invented in its place." },
    { intake: resolved, candidate_readiness: { real_place_count: 8 }, readiness_blockers: ["walking_validation_failed"], expected: "Parranda couldn't compose a day for Testville yet — nothing is invented in its place." },
  ];
  for (const { expected, ...experiment } of cases) {
    const h = await mountPlanner({ url: PLACE_URL });
    try {
      const status = h.container.querySelector('p[role="status"].sr-only');
      assert.ok(status, "the result region exists before completion");
      assert.equal(status.textContent, "");
      await h.clock.advance(500);
      const compose = h.fetchMock.pending().find((call) => call.url.startsWith("/api/route-recommendations"));
      await h.fetchMock.respond(compose, { days: [], agnostic_route_output_experiment: experiment });
      await h.clock.advance(50);
      assert.equal(h.container.querySelector('p[role="status"].sr-only'), status, "the original node survives completion");
      assert.equal(status.textContent, expected, "the mounted region receives the classified absence");
      const failureRegions = [...h.container.querySelectorAll('[role="status"], [aria-live], [role="alert"]')].filter((node) => node.textContent.includes(expected));
      assert.deepEqual(failureRegions, [status], "only one live region carries the failure");
      assert.ok([...h.container.querySelectorAll("div")].some((node) => node.textContent === expected && !node.closest('[role="status"], [aria-live], [role="alert"]')), "the notice remains visible outside the live region");
      assert.equal(h.container.querySelector("h1").textContent, "Your day in Testville");
    } finally {
      await h.unmount();
    }
  }
});

test("choices, service refusals and pending upgrades keep their own truthful status", async () => {
  const resolved = { status: "resolved", resolved: { label: "Testville" } };
  const cases = [
    { body: { days: [], agnostic_route_output_experiment: { intake: { status: "unresolved", candidates: [{ label: "Testville, Country", selection_id: "choice-token" }] } } }, expected: "Which place do you mean?" },
    { body: { days: [], agnostic_route_output_experiment: { intake: { status: "unresolved", blockers: ["place_selection_invalid"] } } }, expected: "Your previous place choice needs confirming again." },
    { body: { error: "busy", retry_after_seconds: 5 }, httpStatus: 429, expected: "Parranda is composing as many days as it safely can right now. Try again shortly." },
    { body: { error: "rate_limited", retry_after_seconds: 12 }, httpStatus: 429, expected: "Parranda needs to pause new requests briefly — try again in about 12 seconds." },
    { body: { days: [], live_events: { pending: true }, agnostic_route_output_experiment: { intake: resolved, source_status: { status: "error_failed_closed" } } }, upgrade: true, expected: "Reading more from the sources — updates automatically in a moment." },
  ];
  for (const { body, httpStatus = 200, expected, upgrade } of cases) {
    const h = await mountPlanner({ url: PLACE_URL });
    try {
      const status = h.container.querySelector('p[role="status"].sr-only');
      await h.clock.advance(500);
      await h.fetchMock.respond(h.fetchMock.pending().find((call) => call.url.startsWith("/api/route-recommendations")), body, httpStatus);
      await h.clock.advance(50);
      assert.equal(status.textContent, "", "no final failure or ready announcement replaces the real status");
      assert.ok(h.text().includes(expected), h.text());
      assert.doesNotMatch(h.text(), /couldn't pin down|couldn't compose a day/);
      if (upgrade) {
        await h.clock.advance(9000);
        const followup = h.fetchMock.pending().find((call) => call.url.startsWith("/api/route-recommendations"));
        assert.ok(followup, "the pending upgrade follows through");
        await h.fetchMock.respond(followup, { days: [], agnostic_route_output_experiment: { intake: resolved } });
        await h.clock.advance(50);
        assert.equal(h.container.querySelector('p[role="status"].sr-only'), status);
        assert.match(status.textContent, /couldn't compose a day for Testville/);
      } else {
        assert.ok([...h.container.querySelectorAll('[role="status"]')].some((node) => node !== status && node.textContent === expected), "the original choices/refusal surface still owns its status");
      }
    } finally {
      await h.unmount();
    }
  }
});

test("how the day was assembled is one closed line beside the map", async (t) => {
  const h = await planner(t);
  const route = h.container.querySelector('section[aria-label="The route"]');
  const about = route.querySelectorAll("details");
  assert.equal(about.length, 1);
  assert.equal(about[0].open, false);
  assert.match(about[0].textContent, /Built from source-backed places/);
  assert.doesNotMatch(h.container.querySelector("header").textContent, /source-backed/);
});
