/**
 * Facts on the line that hold for the whole day are said once.
 * Component evidence with controlled responses, not live-provider acceptance.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mountPlanner } from "./helpers/planner-harness.mjs";
import { componentSource } from "./helpers/planner-source.mjs";

function day(types) {
  const stops = types.map((type, i) => ({
    id: `stop-${i}`, label: `Published stop ${i + 1}`, lat: 50 + i * 0.001, lng: 10, type,
    provenance: { attribution: [{ provider_id: "osm", label: "OSM" }] },
  }));
  return {
    days: [{ experimental_agnostic_route_applied: true, primary_route: {
      id: "__agnostic_compose__", title: "Published day", main_stops: stops,
      estimated_km: 2, map_path_points: [], legs: [], confidence: "low",
    }, alternatives: [] }],
    agnostic_route_output_experiment: { promotion: { promote: true } },
  };
}

async function planner(t, types) {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=en" });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day(types));
  return h.container.querySelector('section[aria-label="The route"]').textContent;
}

test("no hours for any stop is said once, not on every station", async (t) => {
  const route = await planner(t, ["museum", "museum", "gallery"]);
  assert.match(route, /The sources give no opening hours for today's stops on the chosen day/);
  assert.doesNotMatch(route, /Hours unknown/);
});

test("when only some stops lack hours, exactly those stops say so", async (t) => {
  const route = await planner(t, ["museum", "park", "park"]);
  assert.doesNotMatch(route, /The sources give no opening hours/);
  assert.equal(route.match(/Hours unknown/g)?.length, 1);
});

test("following the day asks for the position only on a tap, and keeps it nowhere", () => {
  const hook = componentSource("planner/useFollowPosition.ts");
  // The watch starts only while following and is always cleared.
  assert.match(hook, /if \(!following\) \{[\s\S]{0,80}return;/);
  assert.match(hook, /return \(\) => geolocation\.clearWatch\(id\);/);
  assert.doesNotMatch(hook, /localStorage|sessionStorage|fetch\(|URLSearchParams/);
  // Offered only for today's day, from an explicit pressed button.
  const line = componentSource("planner/StopLine.tsx");
  assert.match(line, /const canFollow = follow\.supported && dayOffset === 0;/);
  assert.match(line, /aria-pressed=\{following\}/);
});

test("following ends when the chosen day is no longer today", async (t) => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=en" });
  t.after(() => h.unmount());
  const watches = [];
  const clears = [];
  Object.defineProperty(h.window.navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition(onPosition) {
        const id = 40 + watches.length;
        watches.push(id);
        onPosition({ coords: { latitude: 50, longitude: 10 } });
        return id;
      },
      clearWatch(id) { clears.push(id); },
    },
  });
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day(["museum", "park", "park"]));
  await h.clock.advance(50);
  const button = (pattern) => [...h.container.querySelectorAll("button")].find((b) => pattern.test(b.textContent));
  const click = (control) => {
    assert.ok(control, "control exists");
    return h.act(() => control.dispatchEvent(new h.window.Event("click", { bubbles: true })));
  };

  await click(button(/^Follow the day$/));
  assert.deepEqual(watches, [40]);
  assert.match(h.text(), /You're at Published stop 1/);

  await click(button(/Adjust/));
  await click(button(/^Tomorrow$/));
  assert.deepEqual(clears, [40], "the watch ends as soon as the day is not today");
  await h.clock.advance(500);
  const compose = h.fetchMock.pending().find((c) => c.url.includes("/api/route-recommendations"));
  assert.ok(compose, "tomorrow is composed");
  await h.fetchMock.respond(compose, day(["museum", "park", "park"]));
  assert.deepEqual(watches, [40], "no new watch for tomorrow");
  assert.doesNotMatch(h.text(), /You're at|Stop following|Follow the day/);

  if (!button(/^Today$/)) await click(button(/Adjust/));
  await click(button(/^Today$/));
  await h.clock.advance(500);
  const back = h.fetchMock.pending().find((c) => c.url.includes("/api/route-recommendations"));
  if (back) await h.fetchMock.respond(back, day(["museum", "park", "park"]));
  assert.deepEqual(watches, [40], "back on today, following waits for a new tap");
  assert.ok(button(/^Follow the day$/), "the follow control is offered again");
});

test("each stop's kind is a compact badge under the name, apart from its hours", async (t) => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=en" });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day(["restaurant", "gallery", "park"]));
  const route = h.container.querySelector('section[aria-label="The route"]');
  const badges = [...route.querySelectorAll("[data-stop-category]")];
  assert.deepEqual(badges.map((b) => [b.dataset.stopCategory, b.textContent]), [
    ["food", "Restaurant"],
    ["culture", "Gallery"],
    ["nature", "Park"],
  ]);
  for (const badge of badges) {
    assert.equal(badge.closest("button")?.getAttribute("aria-expanded"), "false", "the badge sits inside the one row disclosure");
    assert.equal(badge.querySelector("button, a"), null, "the badge is information, not a control");
    assert.doesNotMatch(badge.textContent, /Hours unknown/, "hours never read as part of the category");
  }
  // The restaurant and gallery have no hours (the park needs none): the status
  // sits beside the badge, not inside it.
  assert.equal(route.textContent.match(/Hours unknown/g)?.length, 2);
});

test("a kind this build has no words for shows no badge", async (t) => {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=sv" });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day(["museum", "not-a-known-kind", "park"]));
  const route = h.container.querySelector('section[aria-label="Rutten"]');
  assert.deepEqual([...route.querySelectorAll("[data-stop-category]")].map((b) => b.textContent), ["Museum", "Park"]);
});
