/**
 * "Let Parranda choose" (experimental): off unless the flag is on; when chosen
 * the compose carries intent_mode with no picks and the free rhythm; the
 * server's picks show as status labels with their reasons; taking over opens
 * Adjust with those picks as the reader's own. Mounted planner, controlled
 * responses.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const day = (ids, experiment = {}) => ({
  days: [{
    experimental_agnostic_route_applied: true,
    primary_route: {
      id: "__agnostic_compose__",
      main_stops: ids.map((id) => ({ id, label: `Place ${id}`, lat: 55.6, lng: 13, type: "museum" })),
      estimated_km: 1.2, legs: [], map_path_points: [], confidence: "low",
    },
    alternatives: [],
  }],
  agnostic_route_output_experiment: { promotion: { promote: true, readiness: "promotable" }, ...experiment },
});
const choice = {
  mode: "parranda_chooses",
  status: "chosen",
  auto_intents: [
    { intent: "food", reasons: ["strong_local_supply", "fits_evening", "rain_favors_indoor"], evidence: { usable_count: 5, counted_up_to: 6 } },
    { intent: "nightlife", reasons: ["strong_local_supply", "fits_evening"], evidence: { usable_count: 4, counted_up_to: 6 } },
  ],
  not_chosen: [],
  context: { time_band: "evening", weather: "rain", live_event: "none", pick_budget: "variation" },
  notes: [],
};
const composeCalls = (h) => h.fetchMock.calls.filter((call) => call.url.startsWith("/api/route-recommendations"));
const buttons = (h) => [...h.container.querySelectorAll("button")];
const named = (h, re) => buttons(h).find((b) => re.test((b.getAttribute("aria-label") || b.textContent).trim()));
const click = (h, element) => h.act(() => element.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));

async function arrive(t, query = "") {
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Testville&planner=open&lang=en${query}` });
  t.after(() => h.unmount());
  h.document.addEventListener("click", (event) => event.preventDefault());
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], day(["a", "b"]));
  await h.clock.advance(50);
  return h;
}

test("without the flag nothing changes: no offer, no intent_mode", async (t) => {
  const h = await arrive(t);
  assert.equal(named(h, /^Let Parranda choose the day$/), undefined);
  assert.equal("intent_mode" in composeCalls(h)[0].body, false);
});

test("Parranda chooses: one compose with intent_mode, its picks as labels, and a one-tap take-over", async (t) => {
  const h = await arrive(t, "&parranda_chooses=1");
  assert.equal("intent_mode" in composeCalls(h)[0].body, false, "the arrival compose is the ordinary one");
  await click(h, named(h, /^Let Parranda choose the day$/));
  assert.match(h.text(), /Choosing from the places, the time and the weather/, "no stale verdict while the choice is on its way");
  await h.clock.advance(450);
  const calls = composeCalls(h);
  assert.equal(calls.length, 2, "one recompose");
  assert.equal(calls[1].body.intent_mode, "parranda_chooses");
  assert.deepEqual(calls[1].body.preferences, []);
  assert.equal(calls[1].body.day_rhythm, "free");

  await h.fetchMock.respond(calls[1], day(["r1", "b1"], { parranda_chooses: choice }));
  await h.clock.advance(50);
  const section = h.container.querySelector('section[aria-label="Parranda\'s choice"]');
  assert.ok(section, "the choice is shown");
  assert.match(section.textContent, /Parranda chose/);
  const labels = [...section.querySelectorAll("li")].map((li) => li.textContent);
  assert.deepEqual(labels, ["Food & drink· Indoors while it rains", "Nightlife· Suits the evening"]);
  assert.equal(section.querySelectorAll("li button").length, 0, "status labels, not controls");
  assert.match(h.text(), /Parranda chooses · Day rhythm: Parranda chooses/, "the summary line says who chose");

  await click(h, named(h, /^Take over the picks$/));
  await h.clock.advance(450);
  const takeOver = composeCalls(h)[2];
  assert.deepEqual(takeOver.body.preferences, ["food", "nightlife"]);
  assert.equal("intent_mode" in takeOver.body, false, "the reader's own picks now");
  assert.equal(named(h, /^Food & drink$/).getAttribute("aria-pressed"), "true", "Adjust opens with the picks preselected");
  assert.equal(named(h, /^Nightlife$/).getAttribute("aria-pressed"), "true");
  assert.equal(named(h, /^Culture$/).getAttribute("aria-pressed"), "false");
  assert.ok(named(h, /^Let Parranda choose the day$/), "the offer is back once the reader took over");
});

test("a pick of the reader's own ends the mode", async (t) => {
  const h = await arrive(t, "&parranda_chooses=1");
  await click(h, named(h, /^Let Parranda choose the day$/));
  await h.clock.advance(450);
  await h.fetchMock.respond(composeCalls(h)[1], day(["r1", "b1"], { parranda_chooses: choice }));
  await h.clock.advance(50);
  await click(h, named(h, /^Adjust/));
  await click(h, named(h, /^Views$/));
  await h.clock.advance(450);
  const next = composeCalls(h)[2];
  assert.deepEqual(next.body.preferences, ["views"]);
  assert.equal("intent_mode" in next.body, false);
});
