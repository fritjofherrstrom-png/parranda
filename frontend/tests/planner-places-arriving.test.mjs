// When the server publishes a day while one of its place sources is still
// fetching (staging 07456c8, Montmartre: `source_completion` partial with one
// source pending), the page must not call the place thin. It says plainly that
// more places are on their way and offers to update the day — the same
// question again, never a silent replacement.
import assert from "node:assert/strict";
import test from "node:test";
import { mountPlanner } from "./helpers/planner-harness.mjs";
import { limitationNote, placesStillArriving } from "../src/lib/day-limitations.mjs";

const PLACE_URL = "http://localhost/anywhere?place=Testville&lang=en";
const stop = (id, label, lat) => ({ id, label, lat, lng: 13, type: "museum", daypart: "midday", tags: [] });
const pending = { status: "partial", reason: "bounded_lifecycle_snapshot", pending: 1, completed: 0, failed: 1 };
const complete = { status: "complete", reason: null, pending: 0, completed: 1, failed: 1 };

function day(stops, sourceCompletion) {
  return {
    days: [{
      date: "2026-10-10",
      experimental_agnostic_route_applied: true,
      primary_route: { id: "__agnostic_compose__", main_stops: stops, estimated_km: 0.9, legs: [], map_route_points: [], map_path_points: [] },
      alternatives: [],
    }],
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: "Testville" } },
      promotion: { promote: true, readiness: "promotable_limited", qualifying_caps: ["capped_by_thin_day", "capped_by_below_planner_candidate_threshold"] },
      source_status: { status: "loaded:10", error: "fetch_error", collection: { selection_reason: "loader_error", source_completion: sourceCompletion } },
    },
  };
}
const thinDay = (sc) => day([stop("a", "Halle", 55.6), stop("b", "Square", 55.601)], sc);
const fullerDay = () => day([stop("a", "Halle", 55.6), stop("b", "Square", 55.601), stop("c", "Le Ceni", 55.602), stop("d", "Musée", 55.603)], complete);
const composeCalls = (h) => h.fetchMock.calls.filter((call) => call.url.startsWith("/api/route-recommendations"));
const buttonNamed = (h, name) => [...h.container.querySelectorAll("button")].find((b) => b.textContent.trim() === name);

test("a still-fetching source is not called a thin place", () => {
  const t = (sv, en) => en;
  const caps = ["capped_by_thin_day", "capped_by_below_planner_candidate_threshold"];
  assert.equal(placesStillArriving(pending), true);
  assert.equal(placesStillArriving(complete), false);
  assert.equal(placesStillArriving({ status: "partial", pending: 0 }), false, "partial with nothing pending is not arriving");
  assert.equal(placesStillArriving(null), false);
  assert.match(limitationNote(caps, 2, t), /few places to choose between here/i);
  const arriving = limitationNote(caps, 2, t, { placesStillArriving: true });
  assert.doesNotMatch(arriving, /few places/i, "the place is not judged while its sources are still answering");
  assert.match(arriving, /A shorter day — 2 stops/, "what the day contains right now is still said");
});

test("a day published while places are still arriving says so and offers to update it", async (t) => {
  const h = await mountPlanner({ url: PLACE_URL });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], thinDay(pending));
  await h.clock.advance(50);
  assert.match(h.text(), /More places are on their way/);
  assert.match(h.text(), /A source is still fetching places here/);
  assert.doesNotMatch(h.text(), /few places to choose between here/i);
  const update = buttonNamed(h, "Update the day");
  assert.ok(update, h.text());

  await h.clock.advance(120000);
  assert.equal(composeCalls(h).length, 1, "nothing replaces the day on its own");

  await h.act(() => update.dispatchEvent(new h.window.Event("click", { bubbles: true })));
  await h.clock.advance(50);
  assert.equal(composeCalls(h).length, 2);
  assert.deepEqual(composeCalls(h)[1].body, composeCalls(h)[0].body, "the same question again");
  await h.fetchMock.respond(composeCalls(h)[1], fullerDay());
  await h.clock.advance(50);
  assert.match(h.text(), /Le Ceni/);
  assert.doesNotMatch(h.text(), /More places are on their way/);
});

test("a day whose sources have all answered keeps its honest thin-day note and no update offer", async (t) => {
  const h = await mountPlanner({ url: PLACE_URL });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], thinDay(complete));
  await h.clock.advance(50);
  assert.match(h.text(), /few places to choose between here/i);
  assert.doesNotMatch(h.text(), /More places are on their way/);
  assert.equal(buttonNamed(h, "Update the day"), undefined);
});

test("no day yet while places are still arriving: say they are on their way, not that the place has none", async (t) => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=sv" });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], {
    days: [],
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: "Testville" } },
      candidate_readiness: { real_place_count: 3 },
      readiness_blockers: ["insufficient_geocoded_candidates"],
      source_status: { status: "loaded:3", error: "fetch_error", collection: { selection_reason: "loader_error", source_completion: pending } },
    },
  });
  await h.clock.advance(50);
  assert.match(h.text(), /Fler platser är på väg/);
  assert.match(h.text(), /Platserna för Testville hämtas fortfarande/);
  assert.doesNotMatch(h.text(), /med dina val/);
  assert.doesNotMatch(h.text(), /inte tillräckligt för en pålitlig dag/, "the place is not judged on half its sources");
  const retry = buttonNamed(h, "Försök igen");
  assert.ok(retry, h.text());
  await h.act(() => retry.dispatchEvent(new h.window.Event("click", { bubbles: true })));
  await h.clock.advance(50);
  assert.equal(composeCalls(h).length, 2);
});
