import assert from "node:assert/strict";
import test from "node:test";

import { routeDisplayPath, routeMarkerPresentation, routePathIsSketch } from "../src/lib/route-map-presentation.mjs";

test("an overview connects the original stops in order with shallow display curves", () => {
  const stops = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0.01, lng: 0.01 }];
  const before = structuredClone(stops);
  const displayed = routeDisplayPath(stops, { sketch: true, routingSource: "heuristic" });

  assert.ok(Array.isArray(displayed) && displayed.length > stops.length, "overview needs a curved display path");
  let lastIndex = -1;
  for (const stop of stops) {
    const index = displayed.findIndex((point, pointIndex) => pointIndex > lastIndex && point.lat === stop.lat && point.lng === stop.lng);
    assert.ok(index > lastIndex, "every original stop remains an exact endpoint in route order");
    lastIndex = index;
  }
  assert.deepEqual(displayed[0], stops[0]);
  assert.deepEqual(displayed.at(-1), stops.at(-1));
  const firstLeg = displayed.slice(0, displayed.findIndex((point) => point.lat === stops[1].lat && point.lng === stops[1].lng) + 1);
  assert.ok(firstLeg.some((point) => Math.abs(point.lat) > 0.0001), "the line between stops is not ruler straight");
  assert.ok(firstLeg.every((point) => point.lng >= 0 && point.lng <= 0.01 && Math.abs(point.lat) <= 0.0013), "the bow stays local and does not backtrack");
  assert.deepEqual(stops, before, "display curves must not rewrite route data");
  assert.deepEqual(displayed, routeDisplayPath(stops, { sketch: true, routingSource: "heuristic" }), "same input gives same sketch");
});

test("street walking geometry remains exactly as supplied", () => {
  const streets = Array.from({ length: 20 }, (_, i) => ({ lat: 55.6 + i * 0.0002, lng: 13 + (i % 2) * 0.0004 }));
  assert.deepEqual(routeDisplayPath(streets, { sketch: false }), streets);
  assert.deepEqual(routeDisplayPath(streets), streets, "smoothing requires an explicit sketch classification");
});

test('sparse real or unidentified geometry is never bowed by the conservative sketch classifier', () => {
  const sparse = [{lat:55.6,lng:13}, {lat:55.6002,lng:13.0001}, {lat:55.6002,lng:13.0005}, {lat:55.6005,lng:13.0005}, {lat:55.6007,lng:13.0007}];
  const sketch = routePathIsSketch(sparse, 3);
  assert.equal(sketch, true, 'the conservative point-count classifier is not enough evidence to curve a path');
  for (const routingSource of ['osrm', 'another-street-provider', undefined]) {
    assert.deepEqual(routeDisplayPath(sparse, {sketch, routingSource}), sparse);
  }
});

test("display paths safely handle empty, invalid and duplicate coordinates", () => {
  assert.deepEqual(routeDisplayPath(null, { sketch: true, routingSource: "heuristic" }), []);
  const same = [{ lat: 59.3, lng: 18.1 }, { lat: 59.3, lng: 18.1 }];
  assert.deepEqual(routeDisplayPath(same, { sketch: true, routingSource: "heuristic" }), same);
  const displayed = routeDisplayPath([
    null, { lat: NaN, lng: 12 }, { lat: "55", lng: 12 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 },
    { lat: 0, lng: 0 }, { lat: 0, lng: 0.01 },
  ], { sketch: true, routingSource: "heuristic" });
  assert.ok(Array.isArray(displayed) && displayed.length > 2);
  assert.ok(displayed.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180));
});

test("smoothing is bounded and leaves dateline and polar legs alone", () => {
  for (const points of [
    [{ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 }],
    [{ lat: 0, lng: 179.999 }, { lat: -0.1, lng: 179.999 }],
    [{ lat: 86, lng: 0 }, { lat: 86, lng: 0.01 }],
    [{ lat: 0, lng: 0 }, { lat: 50, lng: 60 }],
    Array.from({ length: 150 }, (_, i) => ({ lat: 0, lng: i * 0.001 })),
  ]) assert.deepEqual(routeDisplayPath(points, { sketch: true, routingSource: "heuristic" }), points);
  const points = Array.from({ length: 128 }, (_, i) => ({ lat: 0, lng: i * 0.001 }));
  const displayed = routeDisplayPath(points, { sketch: true, routingSource: "heuristic" });
  assert.ok(Array.isArray(displayed) && displayed.length <= 2048, "a sketch must not create unbounded map geometry");
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
