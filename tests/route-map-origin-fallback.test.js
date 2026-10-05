"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("origin hints hide in crowded fallback and recover without moving geographic anchors", async () => {
  const { screenMarkerPresentation } = await import("../frontend/src/lib/route-map-presentation.mjs");
  const source = fs.readFileSync(path.join(__dirname, "../frontend/src/components/planner/RouteMap.tsx"), "utf8");
  const body = source.match(/layoutRef\.current = \(\) => \{([\s\S]*?)\n  \};/)[1];
  const layout = new Function("refs", `const { instanceRef, badgesRef, frameRef, mapRef, setLayoutCrowded, screenMarkerPresentation, controlBoxes } = refs; ${body}`);
  let visible = false, crowded = false;
  const moves = [], anchors = [];
  const badge = { lat: 55.6, lng: 13, move: (...args) => moves.push(args), showOrigin: value => { visible = value; } };
  const refs = {
    instanceRef: { current: { map: { project: anchor => { anchors.push(anchor); return { x: 100, y: 100 }; } } } },
    badgesRef: { current: [badge] }, frameRef: { current: {} },
    mapRef: { current: { clientWidth: 390, clientHeight: 300 } },
    setLayoutCrowded: value => { crowded = value; }, screenMarkerPresentation,
    controlBoxes: () => [{ left: 80, top: 80, right: 120, bottom: 120 }],
  };
  layout(refs);
  assert.equal(crowded, false);
  assert.equal(visible, true, "safe displacement retains its optional coordinate hint");
  const safeMoves = moves.length;
  refs.mapRef.current.clientWidth = 20;
  layout(refs);
  assert.equal(crowded, true);
  assert.equal(visible, false, "impossible layout must not retain an old visible hint");
  assert.equal(moves.length, safeMoves, "fallback does not invent marker offsets");
  refs.mapRef.current.clientWidth = 390;
  layout(refs);
  assert.equal(crowded, false);
  assert.equal(visible, true);
  assert.deepEqual(anchors, [[13, 55.6], [13, 55.6], [13, 55.6]]);
  assert.deepEqual([badge.lng, badge.lat], [13, 55.6]);
});
