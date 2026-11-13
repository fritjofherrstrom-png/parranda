/**
 * Keep is a pin, not a rebuild.
 *
 * Staging QA, 12 Nov 2026 (main 2590f540): Keep on the first stop of a Malmö
 * day re-composed the whole day. The route came back in reverse order with a
 * Live event woven in and 2 km more to walk (3.3 → 5.3 km), and the receipt
 * said "Live: event added · +1 stop" without naming the stop that was kept.
 *
 * The stop the reader keeps is already in the day on screen, so that day
 * already answers the pin. Keeping it records the commitment for every later
 * adjustment and says so; it does not ask the server for a new day.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { mountPlanner } from "./helpers/planner-harness.mjs";
import { LAST_KEY } from "../src/lib/anywhere-storage.mjs";

const DATE = "2026-10-14";
const STAGING_STOPS = [
  ["bagaren", "Bagaren och Bonden", "cafe"],
  ["pappas", "Pappas Flickor", "cafe"],
  ["teater", "Teatermuseet", "museum"],
  ["italiano", "V Italiano Moderno", "restaurant"],
  ["slott", "Slottsträdgården", "garden"],
];

function stop([id, label, type], index) {
  return { id, label, type, lat: 55.6 + index * 0.002, lng: 13.0, tags: [],
    trust: { source_tier: "inferred", confidence: "low" } };
}

function day(stops, { km = 3.3, live = null, extra = {} } = {}) {
  return {
    days: [{
      date: DATE,
      experimental_agnostic_route_applied: true,
      primary_route: {
        id: "__agnostic_compose__", title: "Plan", summary: "s", estimated_km: km,
        main_stops: [...stops.map(stop), ...(live ? [live] : [])],
        map_route_points: [], map_path_points: [], legs: [], confidence: "low",
      },
      alternatives: [],
    }],
    agnostic_route_output_experiment: { promotion: { promote: true }, intake: { query: "Malmö" },
      source_status: { anchor: { lat: 55.6, lng: 13.0 } } },
    ...extra,
  };
}

// What the Keep re-compose actually returned on staging: the same places in
// reverse, plus a woven Live event at the end, 2 km longer.
const LIVE_STOP = {
  id: "live-event-concert", label: "Evening concert", is_live_event: true, event_id: "concert",
  live_occurrence_id: `live:${DATE}:${"c".repeat(32)}`, live_choice_eligible: true,
  starts_at: `${DATE}T18:00:00Z`, timezone: "Europe/Stockholm", lat: 55.61, lng: 13.01,
  source: { label: "Published source", url: "https://example.org/concert" },
};
const recomposedOnStaging = () => day([...STAGING_STOPS].reverse(), { km: 5.3, live: LIVE_STOP });

const routeCalls = (h) => h.fetchMock.calls.filter((c) => c.url.includes("route-recommendations"));
const KNOWN = [...STAGING_STOPS.map(([, label]) => label), "Evening concert", "Ribersborg"];
// Each rendered stop row by the place it names, in order (a kept row also
// carries its "Kept" badge, which is not a different stop).
const shownStops = (h) => [...h.container.querySelectorAll('ol[aria-label="The stops, in order"] > li')]
  .map((li) => KNOWN.find((name) => li.textContent.includes(name)) ?? li.textContent);
const button = (h, re) => [...h.container.querySelectorAll("button")].find((b) => re.test(b.textContent || "") ||
  re.test(b.getAttribute("aria-label") || ""));
async function click(h, re) {
  const target = button(h, re);
  assert.ok(target, `${re} exists: ${h.text().slice(0, 400)}`);
  await h.act(() => target.dispatchEvent(new h.window.Event("click", { bubbles: true })));
}
function freezeDate(t) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(`${DATE}T10:00:00Z`) });
}

async function plannerWithDay(t, response = day(STAGING_STOPS), options = {}) {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Malm%C3%B6&lang=en", ...options });
  let closed = false;
  h.close = async () => {
    if (closed) return;
    closed = true;
    await h.unmount();
  };
  t.after(() => h.close());
  await h.clock.advance(500);
  const [arrival] = routeCalls(h);
  assert.ok(arrival, "the planner composes on arrival");
  await h.fetchMock.respond(arrival, response);
  await h.clock.advance(50);
  return h;
}

/** The stop row's own disclosure, the control the reader opens to reach Keep. */
const disclosure = (h, name) => [...h.container.querySelectorAll("button[aria-controls]")]
  .find((b) => b.textContent.includes(name));
async function keepFirstStop(h) {
  const row = disclosure(h, "Bagaren och Bonden");
  assert.ok(row, "the first stop's disclosure exists");
  await h.act(() => row.dispatchEvent(new h.window.Event("click", { bubbles: true })));
  await click(h, /Keep this one/);
}

/** Answer any compose that left, the way staging answered the Keep. */
async function answerLikeStaging(h) {
  for (const call of h.fetchMock.pending().filter((c) => c.url.includes("route-recommendations"))) {
    await h.fetchMock.respond(call, recomposedOnStaging()).catch(() => {});
  }
  await h.clock.advance(50);
}

test("Keep on a settled day pins the stop and composes nothing", async (t) => {
  freezeDate(t);
  const h = await plannerWithDay(t);
  const before = shownStops(h);
  assert.equal(before.length, 5, "precondition: the five-stop day");

  await keepFirstStop(h);
  await h.clock.advance(1000);
  await answerLikeStaging(h);
  await h.clock.advance(12000);

  assert.equal(routeCalls(h).length, 1, "Keep sends no new compose");
  assert.deepEqual(shownStops(h), before, "same stops, same order");
  assert.doesNotMatch(h.text(), /Evening concert/, "no Live event is woven in");
  assert.doesNotMatch(h.text(), /5\.3 km/);
  assert.doesNotMatch(h.text(), /Live: event added/);
  assert.match(h.text(), /Kept: Bagaren och Bonden/, "the receipt names the kept stop");
  assert.doesNotMatch(h.text(), /Changed:/, "and claims no other change");
  assert.match(h.text(), /1 place kept/);
  assert.match(shownStops(h)[0], /Bagaren och Bonden/, "the kept stop is still the first stop");
});

test("the kept stop is remembered for reload and carried by the next adjustment", async (t) => {
  freezeDate(t);
  const h = await plannerWithDay(t);
  await keepFirstStop(h);
  await h.clock.advance(1000);

  const entry = h.readStorage(LAST_KEY);
  assert.deepEqual(entry.commitments.entries.bagaren, { kind: "pin", label: "Bagaren och Bonden" });
  assert.deepEqual(entry.commitments.appliedPins, [{ id: "bagaren", kind: "pin", label: "Bagaren och Bonden" }]);
  assert.equal(entry.safeResponse.days[0].primary_route.main_stops[0].id, "bagaren", "the remembered day is unchanged");

  // An adjustment the reader does make carries the Keep.
  await click(h, /^Adjust$/);
  await click(h, /^Full$/);
  await h.clock.advance(400);
  assert.equal(routeCalls(h).length, 2, "the adjustment composes");
  assert.deepEqual(routeCalls(h).at(-1).body.pinned_candidate_ids, ["bagaren"]);
  const url = h.window.location.href;
  await h.close();

  // A reload asks the same question again, with the Keep in it.
  const reloaded = await mountPlanner({ url, storage: { [LAST_KEY]: entry }, navigationType: "reload" });
  t.after(() => reloaded.unmount());
  await reloaded.clock.advance(500);
  assert.deepEqual(routeCalls(reloaded)[0]?.body.pinned_candidate_ids, ["bagaren"]);
});

test("Undo on the Kept receipt releases the stop without composing", async (t) => {
  freezeDate(t);
  const h = await plannerWithDay(t);
  const before = shownStops(h);
  await keepFirstStop(h);
  await h.clock.advance(1000);
  assert.match(h.text(), /Kept: Bagaren och Bonden/);

  await click(h, /^Undo$/);
  await h.clock.advance(1000);

  assert.equal(routeCalls(h).length, 1, "Undo of a Keep composes nothing");
  assert.deepEqual(shownStops(h), before);
  assert.doesNotMatch(h.text(), /1 place kept/);
  assert.doesNotMatch(h.text(), /Kept: /);
  const row = disclosure(h, "Bagaren och Bonden");
  if (row.getAttribute("aria-expanded") !== "true") await h.act(() => row.dispatchEvent(new h.window.Event("click", { bubbles: true })));
  assert.ok(button(h, /Keep this one/), "the stop can be kept again");
  assert.equal(h.readStorage(LAST_KEY).commitments, null, "the remembered day holds no Keep");
});

test("the day's pending Live upgrade is not installed over a Keep made after its compose", async (t) => {
  freezeDate(t);
  const wire = JSON.parse(readFileSync(new URL("./fixtures/live-wire-81d2ad7.json", import.meta.url), "utf8")).fixtures;
  const pendingLive = { coverage: "covered", pending: true, tonight: [], this_week: [] };
  const h = await plannerWithDay(t, day(STAGING_STOPS, { extra: { live_events: pendingLive,
    live_completion: { version: 1, token: "t".repeat(48), expires_in_ms: 120000, route_upgrade: "explicit_request" } } }));
  const before = shownStops(h);

  await keepFirstStop(h);
  await h.clock.advance(2000);
  const read = h.fetchMock.pending().find((c) => c.url === "/api/planner-live-completion");
  assert.ok(read, "the day keeps following its own Live result after a Keep");
  await h.fetchMock.respond(read, structuredClone(wire.completion_ready.body));
  await h.clock.advance(50);
  const upgrade = h.fetchMock.pending().find((c) => c.url === "/api/planner-live-route-upgrade");
  if (upgrade) await h.fetchMock.respond(upgrade, structuredClone(wire.upgrade_applied.body));
  await h.clock.advance(50);

  assert.equal(upgrade, undefined, "an upgrade for the request before the Keep is not even asked for");
  assert.match(h.text(), /Concert/, "the Live result still reaches the Live list");
  assert.deepEqual(shownStops(h), before, "the kept day stays as it is");
  assert.doesNotMatch(h.text(), /Live: event added/);
  assert.match(h.text(), /Kept: Bagaren och Bonden/);
  await h.clock.advance(120000);
  assert.equal(routeCalls(h).length, 1);
});

test("a Keep made while an update is already on its way joins it, and the receipt names it", async (t) => {
  freezeDate(t);
  const h = await plannerWithDay(t);
  await click(h, /^Adjust$/);
  await click(h, /^Full$/);
  await keepFirstStop(h);
  await h.clock.advance(400);

  assert.equal(routeCalls(h).length, 2, "one compose for both");
  const update = routeCalls(h).at(-1);
  assert.deepEqual(update.body.pinned_candidate_ids, ["bagaren"]);
  await h.fetchMock.respond(update, day([...STAGING_STOPS, ["extra", "Ribersborg", "beach"]], { km: 4.1 }));
  await h.clock.advance(50);

  assert.match(h.text(), /Kept: Bagaren och Bonden · Changed: .*\+1 stop · 3\.3 → 4\.1 km/,
    "the kept stop is named, and every other change is stated beside it");
});
