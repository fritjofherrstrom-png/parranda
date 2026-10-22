/**
 * An adjustment's rebuild is said where the reader is.
 *
 * The only sign used to be a small grey "Updating your day …" beside the
 * heading — below the screen while Adjust is open on a phone — and the new
 * pick read "· not in this day" against the old day being replaced (staging,
 * Stockholm + Coffee, 22 Oct 2026). Now the panel says it, the tapped chip
 * carries it, the day traces its line again and the new pick is pending.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const PLACE_URL = "http://localhost/anywhere?place=Testville&lang=en";

function stop(id, label, lat, extra = {}) {
  return { id, label, lat, lng: 13, type: "museum", ...extra };
}

function composedDay(stops) {
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
    agnostic_route_output_experiment: { promotion: { promote: true, readiness: "promotable" } },
  };
}

const FIRST_DAY = composedDay([
  stop("a", "Place a", 55.6, { covered_preferences: ["museums"] }),
  stop("b", "Place b", 55.601, { type: "restaurant", covered_preferences: ["food"] }),
  stop("c", "Place c", 55.602, { type: "park", covered_preferences: ["scenic"] }),
]);
const REBUILT_DAY = composedDay([
  stop("a", "Place a", 55.6, { covered_preferences: ["museums"] }),
  stop("d", "Cafe d", 55.6005, { type: "cafe", covered_preferences: ["fika"] }),
  stop("b", "Place b", 55.601, { type: "restaurant", covered_preferences: ["food"] }),
  stop("c", "Place c", 55.602, { type: "park", covered_preferences: ["scenic"] }),
]);

const button = (h, pattern) => [...h.container.querySelectorAll("button")].find((b) => pattern.test(b.textContent || ""));
async function click(h, target) {
  assert.ok(target, "the control under test exists");
  await h.act(() => {
    target.dispatchEvent(new h.window.Event("click", { bubbles: true }));
  });
}
const composeCalls = (h) => h.fetchMock.pending().filter((call) => call.url.startsWith("/api/route-recommendations"));
const panelStatus = (h) => h.container.querySelector("[data-adjust-rebuild]");
const picks = (h) =>
  [...(h.container.querySelector('ul[aria-label="Your picks in this day"]')?.children ?? [])].map((li) =>
    li.textContent.replace(/\s+/g, " ").trim(),
  );

/** A day on screen, Adjust open, Coffee tapped, and its rebuild sent but not answered. */
async function rebuildingWithCoffee(t) {
  const h = await mountPlanner({ url: PLACE_URL });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], FIRST_DAY);
  await h.clock.advance(50);
  await click(h, button(h, /^Adjust/));
  await click(h, button(h, /Coffee/));
  await h.clock.advance(400);
  const rebuild = composeCalls(h).at(-1);
  assert.ok(rebuild, "the adjustment rebuilds the day");
  return { h, rebuild };
}

test("the panel says the day is rebuilding, and the tapped chip carries it", async (t) => {
  const { h } = await rebuildingWithCoffee(t);
  assert.equal(panelStatus(h)?.dataset.adjustRebuild, "updating");
  assert.match(panelStatus(h).textContent, /Updating your day/);
  // One "working" sign everywhere it is said: the loading day's walker.
  assert.ok(panelStatus(h).querySelector("[data-walk-mark]"));
  assert.ok(h.container.querySelector('main header [aria-live="polite"] [data-walk-mark]'), "the heading chip walks too");
  assert.match(button(h, /Coffee/).className, /parranda-ring/, "the choice that caused the wait is marked");
  assert.doesNotMatch(button(h, /Culture/).className, /parranda-ring/, "only that choice");
});

test("the day on screen stays, traces its line again, and the new pick is pending, not missing", async (t) => {
  const { h } = await rebuildingWithCoffee(t);
  const route = h.container.querySelector('section[aria-label="The route"]');
  assert.equal(route.dataset.rebuilding, "true");
  assert.match(h.text(), /Place a/, "never a silent swap: the old day is still there");
  // One slow wash down a quiet line; stations no longer flash ember in turn,
  // which read as hectic on an iPhone (23 Oct 2026).
  const line = route.querySelector("ol");
  assert.match(line.className, /(^|\s)route-redraw(\s|$)/);
  assert.doesNotMatch(line.className, /before:bg-parranda-ember/);
  const stations = route.querySelectorAll("ol > li .h-11.w-11");
  assert.ok(stations.length >= 3);
  for (const station of stations) assert.doesNotMatch(station.className, /ember|animate-/);
  assert.ok(picks(h).includes("Coffee · finding places …"), picks(h).join(" | "));
  const pending = [...h.container.querySelectorAll('ul[aria-label="Your picks in this day"] > li')].find((li) => /Coffee/.test(li.textContent));
  assert.ok(pending.querySelector("[data-walk-mark]"));
  assert.doesNotMatch(picks(h).join(" | "), /Coffee · not in this day/, "the old day never answered Coffee");
});

test("once rebuilt, the panel says what changed and the new stop is marked", async (t) => {
  const { h, rebuild } = await rebuildingWithCoffee(t);
  await h.fetchMock.respond(rebuild, REBUILT_DAY);
  await h.clock.advance(50);
  assert.equal(panelStatus(h)?.dataset.adjustRebuild, "updated");
  // What the route did; the chips above already show what the reader set, and
  // the change line under the panel names both (with Undo), said once there.
  assert.equal(panelStatus(h).textContent, "Updated: +1 stop");
  assert.match(h.text(), /Changed: \+ Coffee · \+1 stop/);
  assert.equal(h.container.querySelector('section[aria-label="The route"]').dataset.rebuilding, undefined);
  const rows = [...h.container.querySelectorAll('ol[aria-label="The stops, in order"] > li')].map((li) => li.textContent);
  assert.match(rows.find((row) => row.includes("Cafe d")), /new/);
  assert.doesNotMatch(rows.find((row) => row.includes("Place a")), /\bnew\b/);
  assert.equal(button(h, /Coffee/).className.includes("parranda-ring"), false, "the ring ends with the wait");
});
