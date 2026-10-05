/**
 * "You are here" on the day's line: where a position sits among the stations,
 * read only from the stops' own coordinates in route order.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { distanceKm, lineProgress } from "../src/lib/line-progress.mjs";

// Four stations due east along a parallel, roughly 640 m apart.
const LINE = [
  { lat: 55.6, lng: 13.0 },
  { lat: 55.6, lng: 13.01 },
  { lat: 55.6, lng: 13.02 },
  { lat: 55.6, lng: 13.03 },
];

test("distance is the great-circle distance in km", () => {
  const km = distanceKm(LINE[0], LINE[1]);
  assert.ok(km > 0.6 && km < 0.66, `${km}`);
});

test("standing at a station says so", () => {
  assert.deepEqual(lineProgress(LINE, { lat: 55.6003, lng: 13.0101 }), { state: "at", index: 1 });
});

test("between two stations, the next one is the one ahead", () => {
  const p = lineProgress(LINE, { lat: 55.6002, lng: 13.016 });
  assert.equal(p.state, "toward");
  assert.equal(p.next, 2);
  assert.ok(p.toNextKm > 0.2 && p.toNextKm < 0.3, `${p.toNextKm}`);
});

test("before the first station, the first station is next", () => {
  const p = lineProgress(LINE, { lat: 55.6, lng: 12.995 });
  assert.equal(p.state, "toward");
  assert.equal(p.next, 0);
});

test("far from every segment is off the line, never assigned to one", () => {
  assert.deepEqual(lineProgress(LINE, { lat: 55.65, lng: 13.015 }), { state: "off" });
});

test("stops without coordinates keep their place in the order", () => {
  const withGap = [LINE[0], { label: "no coordinates" }, LINE[2], LINE[3]];
  const p = lineProgress(withGap, { lat: 55.6002, lng: 13.016 });
  assert.equal(p.state, "toward");
  assert.equal(p.next, 2, "the index is the stop's own position in the route");
});

test("a segment across the antimeridian stays short", () => {
  const across = [
    { lat: 0, lng: 179.99 },
    { lat: 0, lng: -179.99 },
  ];
  const middle = lineProgress(across, { lat: 0, lng: 180 });
  assert.equal(middle.state, "toward");
  assert.equal(middle.next, 1, "half way across, the station ahead is next");
  assert.deepEqual(
    lineProgress(across, { lat: 0, lng: 0 }),
    { state: "off" },
    "the far side of the globe is not on a line two kilometres long",
  );
});

test("nothing to measure is no answer", () => {
  assert.equal(lineProgress(LINE, null), null);
  assert.equal(lineProgress([], { lat: 1, lng: 1 }), null);
  assert.equal(lineProgress([{ label: "x" }], { lat: 1, lng: 1 }), null);
});
