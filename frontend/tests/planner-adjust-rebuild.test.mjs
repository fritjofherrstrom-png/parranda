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
// The tapped control's ring is the finite theme animation, never a loop: a
// 5 s rebuild used to replay an infinite 2.4 s ring twice (Nov 2026).
const RING = /(^|\s)motion-safe:animate-ring-pending(\s|$)/;
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
  // One "working" sign everywhere it is said: the loading day's drawing ring.
  assert.ok(panelStatus(h).querySelector("[data-ring-mark]"));
  assert.ok(h.container.querySelector('main header [aria-live="polite"] [data-ring-mark]'), "the heading chip carries it too");
  assert.match(button(h, /Coffee/).className, RING, "the choice that caused the wait is marked");
  assert.doesNotMatch(button(h, /Culture/).className, RING, "only that choice");
  assert.doesNotMatch(button(h, /Coffee/).className, /infinite|parranda-ring_/, "the ring is finite, not a loop");
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
  assert.ok(pending.querySelector("[data-ring-mark]"));
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
  assert.match(rows.find((row) => row.includes("Cafe d")), /New/);
  assert.doesNotMatch(rows.find((row) => row.includes("Place a")), /\bnew\b/);
  assert.doesNotMatch(button(h, /Coffee/).className, RING, "the ring ends with the wait");
});

/** A day on screen and Adjust open, nothing queued yet. */
async function dayWithAdjustOpen(t) {
  const h = await mountPlanner({ url: PLACE_URL });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], FIRST_DAY);
  await h.clock.advance(50);
  await click(h, button(h, /^Adjust/));
  return h;
}

test("the tap is answered at once: the ring is on the chip while its rebuild is only queued", async (t) => {
  const h = await dayWithAdjustOpen(t);
  assert.doesNotMatch(button(h, /Coffee/).className, RING, "no ring before anything is asked");
  assert.equal(h.container.querySelectorAll('[class*="animate-ring-pending"]').length, 0, "nothing pending, nothing rebuilding");
  await click(h, button(h, /Coffee/));
  // Inside the 400 ms debounce: no compose has been sent, yet the tap shows.
  assert.equal(composeCalls(h).length, 0, "the compose is still queued");
  assert.match(button(h, /Coffee/).className, RING, "the tapped chip answers before the debounce settles");
  assert.doesNotMatch(button(h, /Culture/).className, RING, "only the tapped chip");
  // Queued is not stale: the day, its line and the panel status stay as they were.
  assert.equal(h.container.querySelector('section[aria-label="The route"]').dataset.rebuilding, undefined);
  assert.notEqual(panelStatus(h)?.dataset.adjustRebuild, "updating");
  await h.clock.advance(200);
  assert.match(button(h, /Coffee/).className, RING, "a quick second look still sees it");
  await h.clock.advance(200);
  assert.equal(composeCalls(h).length, 1, "the debounce still batches, then sends");
  assert.match(button(h, /Coffee/).className, RING, "and the ring carries straight on into the rebuild");
  await h.fetchMock.respond(composeCalls(h)[0], REBUILT_DAY);
  await h.clock.advance(50);
  assert.doesNotMatch(button(h, /Coffee/).className, RING, "the ring ends with the wait");
});

test("a queued adjustment cleared without firing takes its ring with it (leaving the page)", async (t) => {
  const h = await dayWithAdjustOpen(t);
  await click(h, button(h, /Coffee/));
  assert.match(button(h, /Coffee/).className, RING);
  await h.act(() => h.window.dispatchEvent(new h.window.PageTransitionEvent("pagehide", { persisted: true })));
  await h.clock.advance(1000);
  assert.equal(composeCalls(h).length, 0, "the queued compose never fired");
  assert.doesNotMatch(button(h, /Coffee/).className, RING, "no ring for a compose that is not coming");
  assert.equal(h.container.querySelectorAll('[class*="animate-ring-pending"]').length, 0);
});

test("Undo inside the debounce window cancels the queued compose and its ring", async (t) => {
  const { h, rebuild } = await rebuildingWithCoffee(t);
  await h.fetchMock.respond(rebuild, REBUILT_DAY);
  await h.clock.advance(50);
  await click(h, button(h, /Culture/));
  assert.match(button(h, /Culture/).className, RING, "the next tap is answered at once too");
  const undo = button(h, /^Undo/);
  await click(h, undo);
  await h.clock.advance(1000);
  assert.equal(composeCalls(h).length, 0, "Undo's echo and the cancelled debounce compose nothing");
  assert.equal(h.container.querySelectorAll('[class*="animate-ring-pending"]').length, 0, "no ring outlives the queue");
});

// Review, Nov 2026: the second of two quick taps used to clear the queued
// compose AND its pending sign in the click, so the panel committed one
// "not waiting" render that wiped the tapped key, and no ring came back for
// the whole wait (Göteborg, Food then Views 100 ms apart).
test("a second tap inside the debounce moves the ring to it, through the queue and the rebuild", async (t) => {
  const h = await dayWithAdjustOpen(t);
  await click(h, button(h, /Coffee/));
  await h.clock.advance(100);
  // Every class the second chip passes through in the tap's commits: the
  // regression was a commit where neither chip rang, gone again by the next.
  const second = button(h, /Culture/);
  const records = [];
  const observer = new h.window.MutationObserver((batch) => records.push(...batch));
  observer.observe(second, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
  await click(h, second);
  records.push(...observer.takeRecords());
  const passedThrough = [...records.slice(1).map((record) => record.oldValue), second.className];
  observer.disconnect();
  assert.ok(passedThrough.every((value) => RING.test(value)), "rung from the tap's own commit, never a ringless one in between");
  assert.equal(composeCalls(h).length, 0, "still queued");
  assert.match(button(h, /Culture/).className, RING, "the second tap is answered at once");
  assert.doesNotMatch(button(h, /Coffee/).className, RING, "one ring: the last choice");
  await h.clock.advance(200);
  assert.match(button(h, /Culture/).className, RING, "it holds through the queue");
  await h.clock.advance(200);
  assert.equal(composeCalls(h).length, 1, "both taps are one compose");
  assert.match(button(h, /Culture/).className, RING, "and on into the rebuild");
  assert.equal(panelStatus(h)?.dataset.adjustRebuild, "updating");
  await h.fetchMock.respond(composeCalls(h)[0], REBUILT_DAY);
  await h.clock.advance(50);
  assert.equal(h.container.querySelectorAll('[class*="animate-ring-pending"]').length, 0, "the ring ends with the wait");
});

test("three quick taps send one compose and ring the last", async (t) => {
  const h = await dayWithAdjustOpen(t);
  await click(h, button(h, /Coffee/));
  await h.clock.advance(120);
  await click(h, button(h, /Food/));
  await h.clock.advance(120);
  await click(h, button(h, /^Tomorrow$/));
  const ringed = () => [...h.container.querySelectorAll('[class*="animate-ring-pending"]')].map((el) => el.textContent.trim());
  assert.deepEqual(ringed(), ["Tomorrow"]);
  await h.clock.advance(399);
  assert.equal(composeCalls(h).length, 0, "the debounce restarts with each tap");
  assert.deepEqual(ringed(), ["Tomorrow"]);
  await h.clock.advance(1);
  assert.equal(composeCalls(h).length, 1, "one compose for all three");
  assert.deepEqual(ringed(), ["Tomorrow"], "the ring carries on into the rebuild");
});

// A tap that changes nothing (the day or rhythm already chosen) arms no
// compose, so it must not leave a key behind for a later wait to light.
for (const control of [/^Today$/, /^Balanced$/, /Let Parranda choose/]) test(`a no-op tap (${control.source}) never rings a later rebuild it did not cause`, async (t) => {
  const h = await dayWithAdjustOpen(t);
  if (button(h, control)?.getAttribute("aria-pressed") !== "true") {
    // Not the default: choose it first and let that day settle.
    await click(h, button(h, control));
    await h.clock.advance(400);
    assert.equal(composeCalls(h).length, 1);
    await h.fetchMock.respond(composeCalls(h)[0], FIRST_DAY);
    await h.clock.advance(50);
    assert.doesNotMatch(button(h, control).className, RING, "its own wait is over");
  }
  const target = button(h, control);
  assert.equal(target?.getAttribute("aria-pressed"), "true", "already chosen");
  await click(h, target);
  await h.clock.advance(1000);
  assert.equal(composeCalls(h).length, 0, "nothing changed, nothing sent");
  assert.doesNotMatch(button(h, control).className, RING);
  // A compose caused elsewhere: Replace on a stop of the day.
  const disclosure = [...h.container.querySelectorAll("button[aria-controls]")].find((b) => b.textContent.includes("Place a"));
  await click(h, disclosure);
  await click(h, [...h.container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Replace"));
  assert.doesNotMatch(button(h, control).className, RING, "not while it is queued");
  await h.clock.advance(400);
  assert.equal(composeCalls(h).length, 1, "the Replace is sent");
  assert.doesNotMatch(button(h, control).className, RING, "nor while it rebuilds");
});

test("while a change is queued, the panel no longer presents the last result as current", async (t) => {
  const { h, rebuild } = await rebuildingWithCoffee(t);
  await h.fetchMock.respond(rebuild, REBUILT_DAY);
  await h.clock.advance(50);
  assert.equal(panelStatus(h)?.dataset.adjustRebuild, "updated");
  await click(h, button(h, /Culture/));
  assert.match(button(h, /Culture/).className, RING);
  // Booleans, not matches against the whole page: a failing match diffs the
  // entire document text and stalls the runner instead of reporting.
  const text = h.container.textContent;
  assert.equal(panelStatus(h)?.dataset.adjustRebuild ?? null, null, "no 'Updated: …' beside a ringing control");
  assert.equal(/Updated: \+1 stop/.test(text), false, "the last result is not presented as current");
  assert.equal(/Updating your day/.test(text), false, "nor an 'Updating' line before anything is sent");
  assert.equal(/Quick choices, date and rhythm update the day as you change them\.|The day rebuilds as you change it\./.test(text), true, "the neutral hint instead");
  await h.clock.advance(400);
  assert.equal(panelStatus(h)?.dataset.adjustRebuild, "updating", "the rebuild says itself once sent");
});
