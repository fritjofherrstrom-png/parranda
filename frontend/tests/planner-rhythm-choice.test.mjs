/**
 * Day rhythm is one three-step scale (Easy · Balanced · Full) plus "Let
 * Parranda choose", which is not a fourth step. Each tap sends one compose with
 * the existing payload value; the note under the scale says what the engine
 * does with the choice. Mounted component with controlled responses.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const day = (ids) => ({
  days: [{
    experimental_agnostic_route_applied: true,
    primary_route: {
      id: "__agnostic_compose__",
      main_stops: ids.map((id) => ({ id, label: `Place ${id}`, lat: 55.6, lng: 13, type: "museum" })),
      estimated_km: 1.2, legs: [], map_path_points: [], confidence: "low",
    },
    alternatives: [],
  }],
  agnostic_route_output_experiment: { promotion: { promote: true, readiness: "promotable" } },
});
const composeCalls = (h) => h.fetchMock.calls.filter((call) => call.url.startsWith("/api/route-recommendations"));
const buttons = (h) => [...h.container.querySelectorAll("button")];
const named = (h, re) => buttons(h).find((b) => re.test((b.getAttribute("aria-label") || b.textContent).trim()));
const click = (h, element) => h.act(() => element.dispatchEvent(new h.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));

async function openAdjust(t, lang = "en") {
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Testville&planner=open&lang=${lang}` });
  t.after(() => h.unmount());
  h.document.addEventListener("click", (event) => event.preventDefault());
  await h.clock.advance(500);
  await h.fetchMock.respond(composeCalls(h)[0], day(["a", "b"]));
  await h.clock.advance(50);
  await click(h, named(h, lang === "en" ? /^Adjust/ : /^Justera/));
  return h;
}

test("the scale has three steps and 'Let Parranda choose' sits apart from it", async (t) => {
  const h = await openAdjust(t);
  const scale = h.container.querySelector('[role="group"][aria-label="Day rhythm"]');
  assert.deepEqual([...scale.querySelectorAll("button")].map((b) => [b.textContent, b.getAttribute("aria-pressed")]), [
    ["Easy", "false"],
    ["Balanced", "true"],
    ["Full", "false"],
  ]);
  const free = named(h, /^Let Parranda choose$/);
  assert.ok(free, "the free choice is offered");
  assert.equal(scale.contains(free), false, "and is not a fourth step of the scale");
  assert.equal(free.getAttribute("aria-pressed"), "false");
  assert.match(h.text(), /Balanced: A few stops with room in between\./);
});

test("a step sends one compose with the existing value, and its note follows the choice", async (t) => {
  const h = await openAdjust(t);
  await click(h, named(h, /^Full$/));
  await h.clock.advance(450);
  const calls = composeCalls(h);
  assert.equal(calls.length, 2, "one recompose");
  assert.equal(calls[1].body.day_rhythm, "full");
  assert.equal(named(h, /^Full$/).getAttribute("aria-pressed"), "true");
  assert.match(h.text(), /Full: As many stops as the day holds\./);
  await click(h, named(h, /^Full$/));
  await h.clock.advance(450);
  assert.equal(composeCalls(h).length, 2, "tapping the current step sends nothing");
});

test("'Let Parranda choose' sends free, presses no step, and says how the day is built", async (t) => {
  const h = await openAdjust(t, "sv");
  await click(h, named(h, /^Låt Parranda välja$/));
  await h.clock.advance(450);
  assert.equal(composeCalls(h)[1].body.day_rhythm, "free");
  const scale = h.container.querySelector('[role="group"][aria-label="Dagens rytm"]');
  assert.deepEqual([...scale.querySelectorAll("button")].map((b) => b.getAttribute("aria-pressed")), ["false", "false", "false"]);
  assert.equal(named(h, /Låt Parranda välja$/).getAttribute("aria-pressed"), "true");
  assert.match(h.text(), /Parranda väljer: Anpassar rytmen efter möjliga stopp och tiden som finns\./);
});
