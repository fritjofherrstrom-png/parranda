/**
 * The day view's hierarchy, as a reader meets it.
 *
 * What the day CONTAINS (its stops, what it did for each pick, a thin day)
 * leads; how the day was ASSEMBLED (estimates, where the places came from, how
 * the local time was known) is stated beside the route evidence it qualifies.
 * Nothing true is dropped — each fact has one place, and it is said once.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const PLACE_URL = "http://localhost/anywhere?place=Testville&lang=en";

function stop(id, label, lat, extra = {}) {
  return { id, label, lat, lng: 13, type: "museum", ...extra };
}

/** A composed day with the fields the header and route card read. */
function composedDay({
  stops = [
    stop("a", "Place a", 55.6, { covered_preferences: ["museums"] }),
    stop("b", "Place b", 55.601, { type: "restaurant", covered_preferences: ["food"] }),
    stop("c", "Place c", 55.602, { type: "park", partial_preferences: ["scenic"] }),
  ],
  caps = [],
  pathPoints = null,
  sourceBacked = true,
} = {}) {
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
        map_path_points: pathPoints ?? stops.map(({ lat, lng }) => ({ lat, lng })),
        confidence: "low",
      },
      alternatives: [],
    }],
    ...(sourceBacked
      ? {
          place_structure: {
            provenance: "agnostic_anchor",
            area_count: 1,
            district_day: { areas: [{ center: { lat: 55.6, lng: 13 }, stops: [] }], legs: [], covered_intents: [], missing_intents: [] },
          },
        }
      : {}),
    agnostic_route_output_experiment: {
      promotion: caps.length
        ? { promote: true, readiness: "promotable_limited", qualifying_caps: caps }
        : { promote: true, readiness: "promotable" },
    },
  };
}

async function plannerWith(t, response, url = PLACE_URL) {
  const h = await mountPlanner({ url });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const compose = h.fetchMock.pending().find((call) => call.url.startsWith("/api/route-recommendations"));
  assert.ok(compose, "the planner composes on arrival");
  await h.fetchMock.respond(compose, response);
  await h.clock.advance(50);
  return h;
}

const header = (h) => h.container.querySelector("header");
const routeCard = (h) => h.container.querySelector('section[aria-label="The route"]');
const picks = (h) =>
  [...(h.container.querySelector('ul[aria-label="Your picks in this day"]')?.children ?? [])].map((li) =>
    li.textContent.replace(/\s+/g, " ").trim(),
  );

test("the header says what the route did for each pick, in the pick's own words", async (t) => {
  const h = await plannerWith(t, composedDay());

  assert.deepEqual(picks(h), [
    "Food & drink — in this day",
    "Culture — in this day",
    "Views · partly",
  ]);
  // Said once: the old foot-of-card line is gone.
  assert.doesNotMatch(h.text(), /Partly covered by today's route/);
});

test("a pick no stop covers is named as missing, not silently dropped", async (t) => {
  const h = await plannerWith(
    t,
    composedDay({
      stops: [
        stop("a", "Place a", 55.6, { covered_preferences: ["museums"] }),
        stop("b", "Place b", 55.601, { type: "restaurant", covered_preferences: ["food"] }),
      ],
    }),
  );

  assert.deepEqual(picks(h), ["Food & drink — in this day", "Culture — in this day", "Views · not in this day"]);
});

test("without stop-level coverage evidence the header claims nothing about the picks", async (t) => {
  const h = await plannerWith(
    t,
    composedDay({ stops: [stop("a", "Place a", 55.6), stop("b", "Place b", 55.601)] }),
  );

  assert.equal(h.container.querySelector('ul[aria-label="Your picks in this day"]'), null);
});

test("how the day was assembled sits with the route evidence, said once", async (t) => {
  const h = await plannerWith(
    t,
    composedDay({ caps: ["capped_by_external_only_sources", "capped_by_derived_timezone", "capped_by_heuristic_walking"] }),
  );

  // The trust line leads, under the title.
  assert.match(header(h).textContent, /Built from source-backed places — Parranda does not have full curation here yet/);
  // Assembly caveats are not stacked under the title...
  assert.doesNotMatch(header(h).textContent, /Local time|external sources|estimates/);
  // ...they are stated beside the map and its estimates, without repeating
  // what the trust line and the estimates sentence already say.
  const card = routeCard(h).textContent;
  assert.match(card, /Distances and walking times are estimates\./);
  assert.match(card, /Local time is inferred from the location\./);
  assert.doesNotMatch(card, /external sources|walking distances are estimates/i);
});

test("a day without source-backed provenance still names where its places came from", async (t) => {
  const h = await plannerWith(
    t,
    composedDay({ caps: ["capped_by_external_only_sources"], sourceBacked: false }),
  );

  assert.doesNotMatch(header(h).textContent, /Built from source-backed places/);
  assert.match(routeCard(h).textContent, /Places come from external sources\./);
});

test("what the day contains still leads: a thin day says so under the title", async (t) => {
  const h = await plannerWith(
    t,
    composedDay({
      stops: [stop("a", "Place a", 55.6), stop("b", "Place b", 55.601)],
      caps: ["capped_by_thin_day", "capped_by_derived_timezone"],
    }),
  );

  assert.match(header(h).textContent, /A shorter day — 2 stops we can stand behind\./);
  assert.doesNotMatch(header(h).textContent, /Local time/);
});

test("the map caption calls a straight-line sketch what it is", async (t) => {
  const h = await plannerWith(t, composedDay());
  assert.match(routeCard(h).textContent, /The dotted line shows the order of the stops, not the streets\./);
});

test("a route with walking geometry makes no sketch claim", async (t) => {
  const streets = Array.from({ length: 14 }, (_, i) => ({ lat: 55.6 + i * 0.0002, lng: 13 + (i % 3) * 0.0002 }));
  const h = await plannerWith(t, composedDay({ pathPoints: streets }));

  assert.doesNotMatch(routeCard(h).textContent, /dotted line/);
  assert.match(routeCard(h).textContent, /Distances and walking times are estimates\./);
});

test("saved days follow the day instead of pushing it down", async (t) => {
  const h = await plannerWith(t, composedDay());
  const save = h.container.querySelector('button[aria-label="Save this day"]');
  assert.ok(save, "the day can be saved");
  await h.act(() => save.dispatchEvent(new h.window.Event("click", { bubbles: true })));

  const saved = [...h.container.querySelectorAll("section")].find((section) => /Saved days/.test(section.textContent));
  assert.ok(saved, "the saved list renders");
  const FOLLOWING = h.window.Node.DOCUMENT_POSITION_FOLLOWING;
  assert.ok(header(h).compareDocumentPosition(saved) & FOLLOWING, "after the day header");
  assert.ok(routeCard(h).compareDocumentPosition(saved) & FOLLOWING, "after the route");
  assert.ok(h.container.querySelector('button[aria-label="Day is saved"]'), "and the save control says so");
});

test("switching language keeps the day's own inputs", async (t) => {
  const h = await plannerWith(t, composedDay(), "http://localhost/anywhere?place=Testville&prefs=food,culture&lang=en");
  const languages = h.container.querySelector('[role="group"][aria-label="Language"]');
  assert.ok(languages, "the planner offers a language switch");
  const swedish = [...languages.querySelectorAll("a")].find((a) => a.textContent === "SV");
  const params = new URLSearchParams(swedish.getAttribute("href"));
  assert.equal(params.get("place"), "Testville");
  assert.equal(params.get("prefs"), "food,culture");
  assert.equal(params.get("lang"), "sv");
  const english = [...languages.querySelectorAll("a")].find((a) => a.textContent === "EN");
  assert.equal(english.getAttribute("aria-current"), "true", "the current language is marked");
});

const pendingLifecycle = (token) => ({
  planner_lifecycle: {
    version: 1,
    state: "warm_pending",
    token,
    retry_after_ms: 3000,
    remaining_ms: 50000,
    max_polls: 20,
  },
});

test("leaving through the wordmark cancels server work, as Change place does", async (t) => {
  const token = "d".repeat(48);
  const h = await mountPlanner({ url: PLACE_URL });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], pendingLifecycle(token), 202);

  const home = h.container.querySelector('a[aria-label="Parranda — home"]');
  assert.ok(home, "the wordmark leads home");
  assert.equal(home.getAttribute("href"), "/?lang=en");
  h.document.addEventListener("click", (event) => event.preventDefault());
  await h.act(() => {
    home.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });

  const deletes = h.fetchMock.calls.filter((call) => call.url === "/api/planner-status" && call.method === "DELETE");
  assert.deepEqual(deletes.map(({ body, keepalive }) => ({ body, keepalive })), [{ body: { token }, keepalive: true }]);
});

test("a day planned for tomorrow never calls its route today's", async (t) => {
  const response = composedDay();
  response.days[0].primary_route.main_stops.push({
    id: "live-event-ev-1",
    label: "Quay concert",
    lat: 55.603,
    lng: 13,
    daypart: "evening",
    is_live_event: true,
    event_id: "ev-1",
    starts_at: "2026-09-26T18:00:00Z",
    timezone: "Europe/Stockholm",
  });
  response.live_events = { coverage: "covered", tonight: [], this_week: [] };
  const h = await plannerWith(t, response, "http://localhost/anywhere?place=Testville&day=1&lang=en");

  assert.match(routeCard(h).textContent, /Added to tomorrow's route/);
  assert.match(h.text(), /Quay concert · Included in tomorrow's route/);
  assert.doesNotMatch(h.text(), /today's route/);
});
