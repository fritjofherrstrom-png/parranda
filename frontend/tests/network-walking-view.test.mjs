import assert from "node:assert/strict";
import test from "node:test";
import { mountPlanner } from "./helpers/planner-harness.mjs";

for (const lang of ["en", "sv"]) test(`mounted Planner formats network minutes in rows and details (${lang}) with fixed attribution`, async () => {
  const h = await mountPlanner({
    url: `http://localhost/anywhere?place=Example&lang=${lang}`,
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
            legs: [{ from_label: "one", to_label: "two", distance_km: 1.022, estimated_walk_minutes: 12.355366666666667 }],
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
    assert.match(h.text(), lang === "en" ? /Calculated walking paths/ : /Beräknade gångvägar/);
    assert.match(h.text(), lang === "en" ? /not confirmed access or live navigation/ : /inte bekräftad framkomlighet/);
    assert.match(h.text(), /≈ 12 min/);
    assert.doesNotMatch(h.text(), /12\.355/);
    const stop = [...h.container.querySelectorAll("button")].find(b => b.textContent.includes("two"));
    assert.ok(stop);
    await h.act(() => stop.click());
    assert.equal((h.text().match(/≈ 12 min/g) || []).length, 2, "row and expanded details share the presentation");
    assert.equal(day.days[0].primary_route.legs[0].estimated_walk_minutes, 12.355366666666667, "raw measurement stays intact");
    assert.doesNotMatch(h.text(), /DO NOT RENDER/);
    const attribution = [...h.container.querySelectorAll("a")].find(
      (a) => a.textContent === "© OpenStreetMap",
    );
    assert.equal(attribution?.href, "https://www.openstreetmap.org/copyright");
  } finally {
    await h.unmount();
  }
});
