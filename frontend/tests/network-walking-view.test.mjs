import assert from "node:assert/strict";
import test from "node:test";
import { mountPlanner } from "./helpers/planner-harness.mjs";

test("mounted Planner distinguishes network estimates with fixed attribution, never raw provider copy", async () => {
  const h = await mountPlanner({
    url: "http://localhost/anywhere?place=Example&lang=en",
  });
  try {
    await h.clock.advance(500);
    const first = h.fetchMock.pending()[0];
    const day = {
      days: [
        {
          date: "2026-09-20",
          experimental_agnostic_route_applied: true,
          primary_route: {
            id: "__agnostic_compose__",
            title: "Plan",
            summary: "source-backed",
            estimated_km: 4.5,
            routing_source: "valhalla_pedestrian",
            walking_geometry: {
              kind: "pedestrian_network",
              attribution: "DO NOT RENDER",
              attribution_url: "javascript:alert(1)",
            },
            main_stops: ["one", "two"].map((id, i) => ({
              id,
              label: id,
              lat: 46 + i * 0.001,
              lng: 8,
              type: "museum",
              trust: { source_tier: "inferred", confidence: "low" },
              provenance: { attribution: [] },
            })),
            legs: [],
            map_route_points: [],
            map_path_points: [],
            confidence: "low",
          },
          alternatives: [],
        },
      ],
      agnostic_route_output_experiment: { promotion: { promote: true } },
    };
    await h.fetchMock.respond(first, day);
    await h.clock.advance(50);
    assert.match(h.text(), /Calculated walking paths/);
    assert.match(h.text(), /not confirmed access or live navigation/);
    assert.doesNotMatch(h.text(), /DO NOT RENDER/);
    const attribution = [...h.container.querySelectorAll("a")].find(
      (a) => a.textContent === "© OpenStreetMap",
    );
    assert.equal(attribution?.href, "https://www.openstreetmap.org/copyright");
  } finally {
    await h.unmount();
  }
});
