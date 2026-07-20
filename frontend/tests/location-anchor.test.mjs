/**
 * Location-anchor handoff (design handoff §1): the landing picks the day's
 * geographic anchor once; when it's the user's position, coordinates travel
 * landing → planner via sessionStorage, NEVER the URL (personal data). One-shot
 * consume so a reload re-asks; permission requested only on an explicit gesture.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storeAnchorCoords, consumeAnchorCoords, requestPosition } from "../src/lib/location-anchor.mjs";

const landingSource = readFileSync(new URL("../src/components/LandingHero.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../src/components/AnywherePlanner.tsx", import.meta.url), "utf8");

function withStorage(run) {
  const store = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  try {
    run(store);
  } finally {
    delete globalThis.window;
  }
}

test("coords round-trip through sessionStorage and are consumed exactly once", () => {
  withStorage(() => {
    assert.equal(storeAnchorCoords({ lat: 45.76, lng: 4.83 }), true);
    const first = consumeAnchorCoords();
    assert.deepEqual(first, { lat: 45.76, lng: 4.83 });
    assert.equal(consumeAnchorCoords(), null, "one-shot: a reload must re-ask, never reuse a stale position");
  });
});

test("invalid or missing coords never store and never surface a position", () => {
  withStorage(() => {
    assert.equal(storeAnchorCoords(null), false);
    assert.equal(storeAnchorCoords({ lat: "x", lng: 4 }), false);
    assert.equal(consumeAnchorCoords(), null);
  });
});

test("requestPosition resolves real coords, maps a denial, and needs support", async () => {
  const ok = await requestPosition({
    getCurrentPosition: (res) => res({ coords: { latitude: 1, longitude: 2 } }),
  });
  assert.deepEqual(ok, { lat: 1, lng: 2 });

  await assert.rejects(
    () => requestPosition({ getCurrentPosition: (_r, rej) => rej({ code: 1 }) }),
    (e) => e.code === "denied",
  );
  await assert.rejects(() => requestPosition(null), (e) => e.code === "unsupported");
});

test("the landing chooses the anchor once — coords never enter the URL", () => {
  // Success navigates with the non-sensitive flag only; coords went to storage.
  assert.match(landingSource, /storeAnchorCoords\(coords\)/);
  assert.match(landingSource, /\/anywhere\?anchor=near&planner=open&lang=/);
  assert.doesNotMatch(landingSource, /anywhere\?[^"'`]*lat=/, "coordinates must never be a URL param");
  // Permission is requested on the explicit tap; denial stays on the landing.
  assert.match(landingSource, /onClick=\{useLocation\}/);
  assert.match(landingSource, /Location was blocked/);
  assert.match(landingSource, /Positionen blockerades/);
});

test("the planner consumes the handoff and never re-prompts on arrival", () => {
  assert.match(plannerSource, /get\("anchor"\) === "near"/);
  assert.match(plannerSource, /consumeAnchorCoords\(\)/);
  assert.match(plannerSource, /execute\(\{ coords \}, \{\}\)/);
});

test("the trusted anchor stays memory-only and frames Maps without entering persistence", () => {
  assert.match(plannerSource, /setRouteAnchorCoords\(anchor\.coords \?\? null\)/);
  assert.match(plannerSource, /origin: routeAnchorCoords, destination: routeAnchorCoords/);
  assert.doesNotMatch(plannerSource, /inputs:\s*\{[^}]*routeAnchorCoords/);
  assert.doesNotMatch(plannerSource, /writeLS\([^)]*routeAnchorCoords/);
});
