// A stop number drawn beside its coordinate (screen-space layout) is tied back
// to the coordinate by a callout: a dot on the coordinate and a line to where
// the number is drawn. Pure GeoJSON for a map layer, so it lies beneath every
// number and never covers one.
import test from "node:test";
import assert from "node:assert/strict";
import { screenCallouts, screenMarkerPresentation } from "../src/lib/route-map-presentation.mjs";

// A flat test projection: 1 px per 0.001° around (0, 0), y down.
const unproject = ([x, y]) => ({ lng: x / 1000, lat: -y / 1000 });
const anchorAt = ({ x, y }) => ({ lat: -y / 1000, lng: x / 1000 });

test("only displaced numbers get a callout, from their own coordinate to where they are drawn", () => {
  // Three stops a few px apart in a small map, as in a dense old town on a phone.
  const points = [{ x: 160, y: 90 }, { x: 166, y: 92 }, { x: 171, y: 88 }, { x: 60, y: 140 }];
  const anchors = points.map(anchorAt);
  const offsets = screenMarkerPresentation(points, { width: 340, height: 190 });
  const moved = offsets.map((o) => Math.hypot(o.shift_x_px, o.shift_y_px) > 0.5);
  assert.deepEqual(moved, [false, true, true, false], "the cluster spreads; the lone stop stays put");

  const callouts = screenCallouts({ anchors, points, offsets, unproject });
  const lines = callouts.features.filter((f) => f.geometry.type === "LineString");
  const dots = callouts.features.filter((f) => f.geometry.type === "Point");
  assert.deepEqual(lines.map((f) => f.properties.stop), [1, 2]);
  assert.deepEqual(dots.map((f) => f.properties.stop), [1, 2]);
  for (const line of lines) {
    const i = line.properties.stop;
    const [from, to] = line.geometry.coordinates;
    assert.deepEqual(from, [anchors[i].lng, anchors[i].lat], "the callout starts on the stop's own coordinate");
    const drawn = unproject([points[i].x + offsets[i].shift_x_px, points[i].y + offsets[i].shift_y_px]);
    assert.deepEqual(to, [drawn.lng, drawn.lat], "and ends where the number is drawn");
  }
  assert.equal(JSON.stringify(points), JSON.stringify([{ x: 160, y: 90 }, { x: 166, y: 92 }, { x: 171, y: 88 }, { x: 60, y: 140 }]));
});

test("no layout, no callouts: an impossible layout moved no number", () => {
  const points = [{ x: 10, y: 10 }];
  assert.deepEqual(screenCallouts({ anchors: points.map(anchorAt), points, offsets: null, unproject }).features, []);
  assert.deepEqual(
    screenCallouts({ anchors: [{ lat: NaN, lng: 0 }], points, offsets: [{ shift_x_px: 30, shift_y_px: 0 }], unproject }).features,
    [],
    "a stop without a usable coordinate gets no callout",
  );
});
