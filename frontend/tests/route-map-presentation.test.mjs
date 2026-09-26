import assert from "node:assert/strict";
import test from "node:test";

import { routeMarkerPresentation, routePathIsSketch } from "../src/lib/route-map-presentation.mjs";

test("a path made only of the route's own waypoints is a sketch, not a street line", () => {
  const stops = [
    { lat: 55.6042, lng: 13.0035 },
    { lat: 55.6071, lng: 12.9998 },
    { lat: 55.601, lng: 12.9935 },
  ];
  // The heuristic router returns exactly the waypoints.
  assert.equal(routePathIsSketch(stops, 3), true);
  // A published start and end are waypoints too.
  assert.equal(routePathIsSketch([{ lat: 55.6, lng: 13 }, ...stops, { lat: 55.6, lng: 13 }], 3), true);
  // Street geometry carries the turns between the stops.
  const streets = [];
  for (let i = 0; i < 12; i += 1) streets.push({ lat: 55.6 + i * 0.0005, lng: 13 - i * 0.0004 });
  assert.equal(routePathIsSketch(streets, 3), false);
});

test("an unreadable or missing path reads as a sketch — never as street geometry", () => {
  assert.equal(routePathIsSketch(null, 3), true);
  assert.equal(routePathIsSketch([], 0), true);
  assert.equal(routePathIsSketch([{ lat: 1, lng: 2 }], 1), true);
  assert.equal(routePathIsSketch([{ lat: "x", lng: 2 }, { lat: null, lng: 3 }, { lat: 1, lng: 2 }], 1), true);
});

test("far-apart route markers stay on their exact visual anchor", () => {
  assert.deepEqual(
    routeMarkerPresentation([
      { lat: 59.3293, lng: 18.0686 },
      { lat: 59.3138, lng: 18.0732 },
    ]),
    [
      { shift_x_px: 0, shift_y_px: 0, clustered: false },
      { shift_x_px: 0, shift_y_px: 0, clustered: false },
    ],
  );
});

test("nearby route markers get deterministic non-overlapping badge offsets", () => {
  const stops = [
    { id: "first", lat: 50.08745, lng: 14.42067 },
    { id: "second", lat: 50.0876, lng: 14.4208 },
    { id: "third", lat: 50.0877, lng: 14.4206 },
  ];
  const before = structuredClone(stops);
  const first = routeMarkerPresentation(stops);
  const second = routeMarkerPresentation(stops);

  assert.deepEqual(first, second);
  assert.deepEqual(stops, before, "presentation must not mutate route coordinates");
  assert.ok(first.every((entry) => entry.clustered));
  assert.equal(new Set(first.map((entry) => `${entry.shift_x_px}:${entry.shift_y_px}`)).size, 3);
  for (let i = 0; i < first.length; i += 1) {
    for (let j = i + 1; j < first.length; j += 1) {
      assert.ok(
        Math.hypot(first[i].shift_x_px - first[j].shift_x_px, first[i].shift_y_px - first[j].shift_y_px) >= 44,
        "clustered 44px badges should have enough presentation separation",
      );
    }
  }
});

test("marker presentation is independent of city and candidate labels", () => {
  const coordinates = [
    { lat: 43.2965, lng: 5.3698 },
    { lat: 43.2966, lng: 5.3699 },
  ];
  const renamed = coordinates.map((point, index) => ({ ...point, label: index ? "B" : "A" }));
  assert.deepEqual(routeMarkerPresentation(coordinates), routeMarkerPresentation(renamed));
});
