"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("origin callouts clear in crowded fallback and recover without moving geographic anchors", async () => {
  const { screenCallouts, screenMarkerPresentation } = await import("../frontend/src/lib/route-map-presentation.mjs");
  const source = fs.readFileSync(path.join(__dirname, "../frontend/src/components/planner/RouteMap.tsx"), "utf8");
  const body = source.match(/layoutRef\.current = \(\) => \{([\s\S]*?)\n  \};/)[1];
  const layout = new Function(
    "refs",
    `const { instanceRef, badgesRef, frameRef, mapRef, setLayoutCrowded, screenMarkerPresentation, screenCallouts, controlBoxes, CALLOUT_SOURCE } = refs; ${body}`,
  );
  let crowded = false;
  let callouts = null;
  const moves = [], anchors = [], sources = [];
  const badge = { lat: 55.6, lng: 13, move: (...args) => moves.push(args) };
  const map = {
    project: (anchor) => { anchors.push(anchor); return { x: 100, y: 100 }; },
    unproject: ([x, y]) => ({ lng: 13 + (x - 100) / 1000, lat: 55.6 - (y - 100) / 1000 }),
    getSource: (id) => { sources.push(id); return { setData: (data) => { callouts = data; } }; },
  };
  const refs = {
    instanceRef: { current: { map } },
    badgesRef: { current: [badge] }, frameRef: { current: {} },
    mapRef: { current: { clientWidth: 390, clientHeight: 300 } },
    setLayoutCrowded: (value) => { crowded = value; }, screenMarkerPresentation, screenCallouts,
    controlBoxes: () => [{ left: 80, top: 80, right: 120, bottom: 120 }],
    CALLOUT_SOURCE: "parranda-callouts",
  };
  const kinds = () => callouts.features.map((feature) => feature.geometry.type).sort();
  layout(refs);
  assert.equal(crowded, false);
  assert.deepEqual(kinds(), ["LineString", "Point"], "a displaced number keeps a callout to its coordinate");
  assert.deepEqual(callouts.features.find((f) => f.geometry.type === "Point").geometry.coordinates, [13, 55.6]);
  const safeMoves = moves.length;
  refs.mapRef.current.clientWidth = 20;
  layout(refs);
  assert.equal(crowded, true);
  assert.deepEqual(callouts.features, [], "an impossible layout must not retain an old callout");
  assert.equal(moves.length, safeMoves, "fallback does not invent marker offsets");
  refs.mapRef.current.clientWidth = 390;
  layout(refs);
  assert.equal(crowded, false);
  assert.deepEqual(kinds(), ["LineString", "Point"]);
  assert.deepEqual(anchors, [[13, 55.6], [13, 55.6], [13, 55.6]]);
  assert.deepEqual([badge.lng, badge.lat], [13, 55.6]);
  assert.deepEqual([...new Set(sources)], ["parranda-callouts"]);
});
