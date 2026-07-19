/**
 * Live-sheet scope×time query building (design handoff §3B) against the server's
 * live_event_query_v1 contract (#390). These are the pure rules; the firewall —
 * that this only ever produces an EVENTS query — is enforced here and in the
 * island contract test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { availableLiveScopes, buildLiveEventsQuery, liveEventsTimeWindow } from "../src/lib/live-events-query.mjs";

test("the UI time key maps to the contract's time window", () => {
  assert.equal(liveEventsTimeWindow("tonight"), "tonight");
  assert.equal(liveEventsTimeWindow("week"), "this_week");
});

test("scope options are contextual (handoff annotations)", () => {
  // A route present → near_route + a separate near_me consent.
  assert.deepEqual(availableLiveScopes({ hasRoute: true, routePointCount: 5 }), ["near_route", "near_me"]);
  // No route → around_place + near_me.
  assert.deepEqual(availableLiveScopes({ hasRoute: false, routePointCount: 0 }), ["around_place", "near_me"]);
  // A coords-anchored day collapses to a single "Near you" (near_route, no
  // re-consent) when the route is usable...
  assert.deepEqual(availableLiveScopes({ coordsAnchoredDay: true, hasRoute: true, routePointCount: 4 }), ["near_route"]);
  // ...and only falls back to near_me when there is no usable route.
  assert.deepEqual(availableLiveScopes({ coordsAnchoredDay: true, hasRoute: false, routePointCount: 0 }), ["near_me"]);
  // A "route" of one point cannot form a corridor → treated as no route.
  assert.deepEqual(availableLiveScopes({ hasRoute: true, routePointCount: 1 }), ["around_place", "near_me"]);
});

test("near_route sends the corridor points; fewer than two is an honest error", () => {
  const points = [
    { lat: 60.17, lng: 24.94 },
    { lat: 60.18, lng: 24.95 },
    { lat: 60.19, lng: 24.96 },
  ];
  const q = buildLiveEventsQuery({ scope: "near_route", time: "tonight", routePoints: points, preferences: ["food"] });
  assert.equal(q.error, undefined);
  assert.equal(q.body.scope, "near_route");
  assert.equal(q.body.time, "tonight");
  assert.deepEqual(q.body.route_points, points);
  assert.deepEqual(q.body.preferences, ["food"]);
  assert.ok(!("anchor" in q.body), "near_route carries no single anchor");

  // Non-finite points are dropped; if fewer than two survive it errors, never
  // sends a degenerate corridor.
  const bad = buildLiveEventsQuery({ scope: "near_route", time: "week", routePoints: [{ lat: 1, lng: 2 }, { lat: "x", lng: 3 }] });
  assert.equal(bad.error, "near_route_requires_route_points");
  assert.equal(bad.body, undefined);
});

test("near_route caps the corridor at the contract's 24 points", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ lat: 60 + i * 0.001, lng: 24 + i * 0.001 }));
  const q = buildLiveEventsQuery({ scope: "near_route", time: "tonight", routePoints: many });
  assert.equal(q.body.route_points.length, 24);
});

test("around_place / near_me send an anchor coordinate; a missing one errors", () => {
  const around = buildLiveEventsQuery({ scope: "around_place", time: "week", anchorCoord: { lat: 45.76, lng: 4.83 } });
  assert.deepEqual(around.body.anchor, { lat: 45.76, lng: 4.83 });
  assert.equal(around.body.time, "this_week");
  assert.ok(!("route_points" in around.body));

  const nearMe = buildLiveEventsQuery({ scope: "near_me", time: "tonight", nearMeCoords: { lat: 1, lng: 2 } });
  assert.deepEqual(nearMe.body.anchor, { lat: 1, lng: 2 });

  // near_me reads its OWN coords, not the day anchor — proving the two consents
  // are separate: an around_place anchor must never satisfy a near_me query.
  const noPos = buildLiveEventsQuery({ scope: "near_me", time: "tonight", anchorCoord: { lat: 9, lng: 9 }, nearMeCoords: null });
  assert.equal(noPos.error, "near_me_requires_position");
  assert.equal(buildLiveEventsQuery({ scope: "around_place", time: "tonight", anchorCoord: null }).error, "around_place_requires_anchor");
});

test("preferences are string-cleaned; an unknown scope errors", () => {
  const q = buildLiveEventsQuery({ scope: "around_place", time: "tonight", anchorCoord: { lat: 1, lng: 2 }, preferences: ["food", "", 7, "views"] });
  assert.deepEqual(q.body.preferences, ["food", "views"]);
  assert.equal(buildLiveEventsQuery({ scope: "elsewhere", time: "tonight" }).error, "invalid_live_event_scope");
});
