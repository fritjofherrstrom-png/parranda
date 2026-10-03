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
