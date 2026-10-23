"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("pins stay on their places: a crowded fallback invents no offsets and anchors never move", async () => {
  const { screenPinPresentation } = await import("../frontend/src/lib/route-map-presentation.mjs");
  const source = fs.readFileSync(path.join(__dirname, "../frontend/src/components/planner/RouteMap.tsx"), "utf8");
  const body = source.match(/layoutRef\.current = \(\) => \{([\s\S]*?)\n  \};/)[1];
  const layout = new Function("refs", `const { instanceRef, badgesRef, frameRef, mapRef, setLayoutCrowded, screenPinPresentation, controlBoxes, pinShiftsRef, focusAfterSplitRef, syncGroupPins, fittedZoomRef } = refs; ${body}`);
  let visible = null, crowded = false;
  const moves = [], anchors = [];
  const badge = { lat: 55.6, lng: 13, move: (...args) => moves.push(args), showOrigin: value => { visible = value; }, setGrouped: () => {}, focus: () => {} };
  const refs = {
    instanceRef: { current: { map: { project: anchor => { anchors.push(anchor); return { x: 100, y: 100 }; } } } },
    badgesRef: { current: [badge] }, frameRef: { current: {} },
    mapRef: { current: { clientWidth: 390, clientHeight: 300 } },
    setLayoutCrowded: value => { crowded = value; }, screenPinPresentation,
    // A map control right over the stop: the pin stays on its place.
    controlBoxes: () => [{ left: 80, top: 80, right: 120, bottom: 120 }],
    pinShiftsRef: { current: new Map() }, focusAfterSplitRef: { current: null }, syncGroupPins: () => {}, fittedZoomRef: { current: -Infinity },
  };
  layout(refs);
  assert.equal(crowded, false);
  assert.deepEqual(moves.at(-1).slice(0, 2), [0, 0], "the pin is drawn on its stop, partly under the control");
  assert.equal(visible, false, "no separate origin dot: the pin itself marks the place");
  const placedMoves = moves.length;
  refs.mapRef.current.clientWidth = 20;
  layout(refs);
  assert.equal(crowded, true);
  assert.equal(moves.length, placedMoves, "an impossible layout does not invent marker offsets");
  refs.mapRef.current.clientWidth = 390;
  layout(refs);
  assert.equal(crowded, false);
  assert.deepEqual(anchors, [[13, 55.6], [13, 55.6], [13, 55.6]]);
  assert.deepEqual([badge.lng, badge.lat], [13, 55.6]);
});
