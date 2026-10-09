import assert from "node:assert/strict";
import test from "node:test";

import { controlAwareView, paddingOptions } from "../src/lib/route-map-fit.mjs";

// Web Mercator in world pixels (256px tiles), as Leaflet's default CRS.
function project({ lat, lng }, zoom) {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

function unproject({ x, y }, zoom) {
  const scale = 256 * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / scale) * 360 - 180 };
}

// The collapsed map at a 390px viewport, as measured in Chromium: the Leaflet
// container, the zoom bar, the 44px expand button and the attribution.
const PHONE = {
  width: 322,
  height: 190,
  zoom: { left: 10, top: 10, right: 58, bottom: 102 },
  button: { left: 268, top: 10, right: 312, bottom: 54 },
  attribution: { left: 88, top: 173, right: 322, bottom: 190 },
};
const KEEPOUTS = [PHONE.zoom, PHONE.button, PHONE.attribution];
const EDGE = 7;
const GAP = 4;
const MARKER = 15;

function fit(marks, overrides = {}) {
  return controlAwareView({
    marks,
    width: PHONE.width,
    height: PHONE.height,
    keepouts: KEEPOUTS,
    edge: EDGE,
    gap: GAP,
    maxZoom: 15,
    project,
    unproject,
    ...overrides,
  });
}

/** Where each mark's footprint lands in the container under `view`. */
function footprints(view, marks, { width = PHONE.width, height = PHONE.height } = {}) {
  const centre = project(view.center, view.zoom);
  return marks.map((mark) => {
    const point = project(mark, view.zoom);
    const x = point.x - centre.x + width / 2 + (mark.offsetX ?? 0);
    const y = point.y - centre.y + height / 2 + (mark.offsetY ?? 0);
    const radius = mark.radius ?? 0;
    return { left: x - radius, top: y - radius, right: x + radius, bottom: y + radius };
  });
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const onMap = (box, { width = PHONE.width, height = PHONE.height } = {}) =>
  box.left >= 0 && box.top >= 0 && box.right <= width && box.bottom <= height;

function assertClear(view, marks, keepouts = KEEPOUTS) {
  assert.ok(view, "a view is found");
  footprints(view, marks).forEach((box, index) => {
    assert.ok(onMap(box), `mark ${index + 1} stays on the map: ${JSON.stringify(box)}`);
    if (marks[index].avoidControls === false) return;
    for (const control of keepouts) {
      assert.ok(!overlaps(box, control), `mark ${index + 1} ${JSON.stringify(box)} is under ${JSON.stringify(control)}`);
    }
  });
}

const stop = (lat, lng, extra = {}) => ({ lat, lng, radius: MARKER, ...extra });

/** The controls each stop would sit under if the fit ignored them. */
function hiddenWithoutControls(marks) {
  const view = fit(marks, { keepouts: [] });
  const named = { zoom: PHONE.zoom, button: PHONE.button, attribution: PHONE.attribution };
  return footprints(view, marks).flatMap((box, index) =>
    Object.entries(named)
      .filter(([, control]) => overlaps(box, control))
      .map(([name]) => `${index + 1} under ${name}`),
  );
}

// Days shaped like the map, so a fit that ignores the controls fills its
// corners. The last stop is the woven Live event, as the engine appends it.
const NORTH_EAST_DAY = [
  stop(55.5982, 12.9905),
  stop(55.6005, 12.997),
  stop(55.6021, 13.003),
  stop(55.6036, 13.0085),
  stop(55.605, 13.0125),
];
const NORTH_WEST_DAY = [
  stop(55.605, 12.9905),
  stop(55.6036, 12.9945),
  stop(55.6021, 13.0),
  stop(55.6005, 13.006),
  stop(55.5982, 13.0125),
];
const CORNER_DAY = [stop(55.5982, 12.9905), stop(55.605, 12.9905), stop(55.605, 13.0125), stop(55.5982, 13.0125)];

test("the day's north-east stop is kept clear of the expand button", () => {
  assert.deepEqual(hiddenWithoutControls(NORTH_EAST_DAY), ["5 under button"]);
  assertClear(fit(NORTH_EAST_DAY), NORTH_EAST_DAY);
});

test("the day's north-west stop is kept clear of the zoom buttons", () => {
  assert.deepEqual(hiddenWithoutControls(NORTH_WEST_DAY), ["1 under zoom", "5 under attribution"]);
  assertClear(fit(NORTH_WEST_DAY), NORTH_WEST_DAY);
});

test("stops in every corner clear every control at once", () => {
  assert.deepEqual(hiddenWithoutControls(CORNER_DAY), ["2 under zoom", "3 under button", "4 under attribution"]);
  assertClear(fit(CORNER_DAY), CORNER_DAY);
});

test("the closest zoom that keeps every stop clear is chosen, inside a whole level too", () => {
  const view = fit(NORTH_EAST_DAY);
  assert.ok(view.zoom < 15, "this day cannot be shown at the zoom cap");
  // Vector tiles draw sharp between levels: a day that misses the next whole
  // level is not shown at the scale of the level below it.
  assert.ok(view.zoom > Math.floor(view.zoom), `fractional zoom expected, got ${view.zoom}`);
  assertClear(view, NORTH_EAST_DAY);
  const closer = view.zoom + 0.02;
  const points = NORTH_EAST_DAY.map((mark) => project(mark, closer));
  const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) + 2 * MARKER;
  const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)) + 2 * MARKER;
  for (const padding of paddingOptions({ width: PHONE.width, height: PHONE.height, keepouts: KEEPOUTS, edge: EDGE, gap: GAP })) {
    assert.ok(
      width > PHONE.width - padding.left - padding.right || height > PHONE.height - padding.top - padding.bottom,
      `zoom ${closer} would have fit inside ${JSON.stringify(padding)}`,
    );
  }
});

test("a wide day clears the top-right button from below, a tall day from beside it", () => {
  const wide = [stop(55.6, 12.97), stop(55.601, 13.0), stop(55.6, 13.03)];
  const tall = [stop(55.585, 13.0), stop(55.6, 13.001), stop(55.615, 13.0)];
  const wideView = fit(wide);
  const tallView = fit(tall);
  assertClear(wideView, wide);
  assertClear(tallView, tall);
  assert.ok(wideView.padding.top >= PHONE.button.bottom + GAP, "wide: every stop sits below the button");
  assert.ok(wideView.padding.right < PHONE.width - PHONE.button.left, "wide: the full width is used");
  assert.ok(tallView.padding.right >= PHONE.width - PHONE.button.left + GAP, "tall: every stop sits left of the button");
  assert.ok(tallView.padding.top < PHONE.button.bottom, "tall: the full height is used");
});

// A 2 km diagonal day, north-east stop last (the Chromium reproduction's day).
const DIAGONAL_DAY = [
  stop(55.595, 12.99),
  stop(55.598, 12.998),
  stop(55.601, 13.004),
  stop(55.603, 13.01),
  stop(55.606, 13.018),
];

test("a clustered marker is fitted where it is drawn, beside its coordinate", () => {
  // Two stops 80 m apart: route-map-presentation.mjs draws each 36px from
  // their shared centre, the last one up and to the right.
  const day = [
    ...DIAGONAL_DAY.slice(0, 3),
    stop(55.6055, 13.0165, { offsetX: -25, offsetY: 26 }),
    stop(55.6062, 13.0178, { offsetX: 25, offsetY: -26 }),
  ];
  const view = fit(day);
  assertClear(view, day);
  // Fitting the coordinates alone would have put the drawn disc in the corner.
  const naive = fit(day.map(({ offsetX, offsetY, ...mark }) => mark));
  const drawn = footprints(naive, day);
  assert.ok(
    drawn.some((box) => !onMap(box) || KEEPOUTS.some((control) => overlaps(box, control))),
    "the offset is what forces the difference",
  );
});

test("the route line's own points only have to stay on the map", () => {
  // A published end point beyond the last stop, towards the button's corner.
  const withEnd = [...DIAGONAL_DAY, { lat: 55.6085, lng: 13.0235, avoidControls: false }];
  const view = fit(withEnd);
  assertClear(view, withEnd);
  // The line may run under the button; the stops still may not. So the
  // line's end costs the view nothing…
  assert.equal(view.zoom, fit(DIAGONAL_DAY).zoom);
  // …while holding the line to the stops' rule would cost zoom.
  const strict = fit(withEnd.map((mark) => ({ ...mark, avoidControls: true })));
  assert.ok(strict.zoom < view.zoom, `${strict.zoom} < ${view.zoom}`);
});

test("controls off the map, or without size, are ignored", () => {
  const options = paddingOptions({
    width: 300,
    height: 200,
    keepouts: [{ left: 0, top: 0, right: 0, bottom: 0 }, { left: 310, top: 0, right: 340, bottom: 40 }, null],
    edge: 5,
  });
  assert.deepEqual(options, [{ top: 5, right: 5, bottom: 5, left: 5 }]);
});

test("the paddings offered for a phone map clear each control along one side", () => {
  const options = paddingOptions({ width: PHONE.width, height: PHONE.height, keepouts: KEEPOUTS, edge: EDGE, gap: GAP });
  const has = (padding) => options.some((option) => JSON.stringify(option) === JSON.stringify(padding));
  // Beside the zoom bar, below the button, above the attribution…
  assert.ok(has({ top: 58, right: 7, bottom: 21, left: 62 }));
  // …or beside both top controls.
  assert.ok(has({ top: 7, right: 58, bottom: 21, left: 62 }));
  // Never one that is deeper on every side than another.
  for (const a of options) {
    for (const b of options) {
      if (a === b) continue;
      const deeper = ["top", "right", "bottom", "left"].every((side) => a[side] >= b[side]);
      assert.ok(!deeper, `${JSON.stringify(a)} is dominated by ${JSON.stringify(b)}`);
    }
  }
});

test("without a readable map or marks there is no view, so the caller falls back", () => {
  const unreadable = new Proxy(function () {}, { get: () => unreadable, apply: () => unreadable });
  assert.equal(fit([]), null);
  assert.equal(fit(DIAGONAL_DAY, { width: unreadable, height: unreadable }), null);
  assert.equal(fit(DIAGONAL_DAY, { width: 0 }), null);
  assert.equal(fit(DIAGONAL_DAY, { project: () => unreadable }), null);
  assert.equal(fit([{ lat: "x", lng: 13 }]), null);
  // A control over the whole map leaves nowhere to put a stop.
  assert.equal(fit(DIAGONAL_DAY, { keepouts: [{ left: 0, top: 0, right: PHONE.width, bottom: PHONE.height }] }), null);
});
