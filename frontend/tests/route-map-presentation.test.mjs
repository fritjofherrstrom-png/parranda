import assert from "node:assert/strict";
import test from "node:test";

import { routeDisplayPath, routeMarkerPresentation, routePathIsSketch } from "../src/lib/route-map-presentation.mjs";

const walkingGeometry = { geometrySource: "osrm", geometryMode: "walking" };

test("heuristic and unidentified geometry leave an overview with pins only", () => {
  const stops = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0.01, lng: 0.01 }];
  const before = structuredClone(stops);
  for (const options of [undefined, { sketch: true, routingSource: "heuristic" },
    { geometrySource: "heuristic", geometryMode: "walking" }, { geometrySource: "osrm" },
    { geometrySource: "agnostic_compose", geometryMode: "walking" }]) {
    assert.deepEqual(routeDisplayPath(stops, options), [], "no display-only connector may imply a walking path");
  }
  assert.deepEqual(stops, before, "pins-only fallback preserves source coordinates");
});

test("dense geometry without an explicit walking mode cannot become a street line", () => {
  const dense = Array.from({ length: 20 }, (_, i) => ({ lat: 55.6 + i * 0.0002, lng: 13 + (i % 2) * 0.0004 }));
  assert.deepEqual(routeDisplayPath(dense), []);
  assert.deepEqual(routeDisplayPath(dense, { geometrySource: "osrm", geometryMode: "driving" }), []);
  assert.deepEqual(routeDisplayPath(dense, { geometrySource: "osrm", geometryMode: null }), []);
});

test("explicit pedestrian geometry retains every coordinate without smoothing", () => {
  const streets = [{ lat: 55.6, lng: 13 }, { lat: 55.6002, lng: 13 },
    { lat: 55.6002, lng: 13.001 }, { lat: 55.601, lng: 13.001 }];
  const before = structuredClone(streets);
  assert.deepEqual(routeDisplayPath(streets, walkingGeometry), streets);
  assert.deepEqual(streets, before);
});

test("a short explicit walking segment is real geometry even with only two points", () => {
  const short = [{ lat: 55.6, lng: 13 }, { lat: 55.6002, lng: 13 }];
  assert.deepEqual(routeDisplayPath(short, walkingGeometry), short);
});

test("malformed pedestrian geometry never joins the remaining valid points", () => {
  const valid = [{ lat: 55.6, lng: 13 }, { lat: 55.6002, lng: 13 }];
  for (const bad of [null, { lat: NaN, lng: 12 }, { lat: "55", lng: 12 },
    { lat: 91, lng: 0 }, { lat: 0, lng: 181 }]) {
    assert.deepEqual(routeDisplayPath([valid[0], bad, valid[1]], walkingGeometry), []);
  }
  for (const points of [null, [], [valid[0]]]) assert.deepEqual(routeDisplayPath(points, walkingGeometry), []);
});

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
  // Extra points alone never establish a pedestrian path.
  const streets = [];
  for (let i = 0; i < 12; i += 1) streets.push({ lat: 55.6 + i * 0.0005, lng: 13 - i * 0.0004 });
  assert.equal(routePathIsSketch(streets, 3), true);
  assert.equal(routePathIsSketch(streets, 3, walkingGeometry), false);
  assert.equal(routePathIsSketch(stops.slice(0, 2), 3, walkingGeometry), false);
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
