// A published source_completion describes the immutable answer, not a live
// source job. Incomplete evidence cannot judge the place thin; recovery stays
// the same explicit question and never silently replaces the published day.
import assert from "node:assert/strict";
import test from "node:test";
import { mountPlanner } from "./helpers/planner-harness.mjs";
import * as sourceNotes from "../src/lib/day-limitations.mjs";
const { limitationNote } = sourceNotes;

const PLACE_URL = "http://localhost/anywhere?place=Testville&lang=en";
const stop = (id, label, lat) => ({ id, label, lat, lng: 13, type: "museum", daypart: "midday", tags: [] });
const pending = { status: "partial", reason: "bounded_lifecycle_snapshot", pending: 1, completed: 0, failed: 1 };
const complete = { status: "complete", reason: null, pending: 0, completed: 1, failed: 0 };

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
      source_status: { status: "loaded:10", error: sourceCompletion.status === 'partial' || sourceCompletion.failed > 0 ? "fetch_error" : null,
        collection: { selection_reason: sourceCompletion.status === 'partial' ? "loader_error" : null, source_completion: sourceCompletion } },
    },
  };
}
const thinDay = (sc) => day([stop("a", "Halle", 55.6), stop("b", "Square", 55.601)], sc);
const fullerDay = () => day([stop("a", "Halle", 55.6), stop("b", "Square", 55.601), stop("c", "Le Ceni", 55.602), stop("d", "Musée", 55.603)], complete);
const composeCalls = (h) => h.fetchMock.calls.filter((call) => call.url.startsWith("/api/route-recommendations"));
const buttonNamed = (h, name) => [...h.container.querySelectorAll("button")].find((b) => b.textContent.trim() === name);

test("historically incomplete source evidence cannot judge the place thin", () => {
  const t = (sv, en) => en;
  const caps = ["capped_by_thin_day", "capped_by_below_planner_candidate_threshold"];
  assert.equal(sourceNotes.sourcesIncomplete?.(pending), true);
  assert.equal(sourceNotes.sourcesIncomplete?.(complete), false);
  assert.equal(sourceNotes.sourcesIncomplete?.({ status: "partial", pending: 0 }), true, "pending is a snapshot count, not proof that evidence is complete");
  assert.equal(sourceNotes.sourcesIncomplete?.({ status: "complete", failed: 1 }), true, "a failed source leaves incomplete place evidence");
  assert.equal(sourceNotes.sourcesIncomplete?.(null), false);
  assert.match(limitationNote(caps, 2, t), /few places to choose between here/i);
  const arriving = limitationNote(caps, 2, t, { sourcesIncomplete: true });
  assert.doesNotMatch(arriving, /few places/i, "the place is not judged from incomplete evidence");
  assert.match(arriving, /A shorter day — 2 stops/, "what the day contains right now is still said");
});

test("a published partial day states historical incompleteness and offers an explicit update", async (t) => {
  const h = await mountPlanner({ url: PLACE_URL });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], thinDay(pending));
  await h.clock.advance(50);
  assert.match(h.text(), /Not every place could be loaded, so there may be more than the ones shown/);
  assert.doesNotMatch(h.text(), /More places are on their way|still fetching|update in a moment/i);
  assert.doesNotMatch(h.text(), /few places to choose between here/i);
  const update = buttonNamed(h, "Look for more places");
  assert.ok(update, h.text());

  await h.clock.advance(120000);
  assert.equal(composeCalls(h).length, 1, "nothing replaces the day on its own");

  await h.act(() => update.dispatchEvent(new h.window.Event("click", { bubbles: true })));
  await h.clock.advance(50);
  assert.equal(composeCalls(h).length, 2);
  assert.deepEqual(composeCalls(h)[1].body, composeCalls(h)[0].body, "the same question again");
  assert.match(h.text(), /Halle/, "the published day remains while its deliberate update is pending");
  assert.match(h.text(), /Square/);
  await h.fetchMock.respond(composeCalls(h)[1], fullerDay());
  await h.clock.advance(50);
  assert.match(h.text(), /Le Ceni/);
  assert.doesNotMatch(h.text(), /Not every place|More places are on their way/);
  assert.match(h.text(), /Looked for more places: /, "what the look found is said, not swapped in silently");
});

test("a day whose sources have all answered keeps its honest thin-day note and no update offer", async (t) => {
  const h = await mountPlanner({ url: PLACE_URL });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], thinDay(complete));
  await h.clock.advance(50);
  assert.match(h.text(), /few places to choose between here/i);
  assert.doesNotMatch(h.text(), /More places are on their way/);
  assert.equal(buttonNamed(h, "Look for more places"), undefined);
});

test("a no-route terminal snapshot states incomplete evidence without judging the place or promising a route", async (t) => {
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
  assert.match(h.text(), /Parranda kunde inte bygga en dag här just nu/);
  assert.match(h.text(), /ofullständigt när svaret skapades/);
  assert.doesNotMatch(h.text(), /är på väg|hämtas fortfarande|snart.*rutt/);
  assert.doesNotMatch(h.text(), /med dina val/);
  assert.doesNotMatch(h.text(), /inte tillräckligt för en pålitlig dag/, "the place is not judged on incomplete evidence");
  const retry = buttonNamed(h, "Försök igen");
  assert.ok(retry, h.text());
  await h.act(() => retry.dispatchEvent(new h.window.Event("click", { bubbles: true })));
  await h.clock.advance(50);
  assert.equal(composeCalls(h).length, 2);
});


test("a partial published day with no pending count still suppresses thin-place judgement", async t => {
  const h = await mountPlanner({ url: PLACE_URL });
  t.after(() => h.unmount());
  await h.fetchMock.respond(composeCalls(h)[0], thinDay({ status: "partial", pending: 0, failed: 0 }));
  assert.match(h.text(), /Not every place could be loaded/);
  assert.doesNotMatch(h.text(), /few places to choose between here|on their way|still fetching/i);
  assert.ok(buttonNamed(h, "Look for more places"));
  await h.clock.advance(120000);
  assert.equal(composeCalls(h).length, 1);
});

test("a published day preserves the primary-source failure even when all background jobs succeeded", async t => {
  const h=await mountPlanner({url:PLACE_URL});t.after(()=>h.unmount());
  const response=thinDay(complete);
  response.agnostic_route_output_experiment.source_status.error='provider_unavailable';
  await h.fetchMock.respond(composeCalls(h)[0],response);
  assert.match(h.text(),/Not every place could be loaded/);
  assert.match(h.text(),/Halle/);
  assert.doesNotMatch(h.text(),/few places to choose between here|on their way|still fetching/i);
  assert.ok(buttonNamed(h,'Look for more places'));
  await h.clock.advance(120000);
  assert.equal(composeCalls(h).length,1,'a failed primary does not start another acquisition automatically');
});
