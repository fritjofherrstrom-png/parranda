/**
 * Google Maps deep-link builders — coords are the source of truth, nothing is
 * fabricated, and a long day samples down to a valid waypoint count.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mapsPlaceUrl, mapsWalkingRouteUrl, dayStops, primaryRouteStops } from "../src/lib/maps-links.mjs";

test("mapsPlaceUrl pins real coords, and refuses a coordless stop (no fabrication)", () => {
  assert.equal(mapsPlaceUrl({ lat: 41.15, lng: -8.61 }), "https://www.google.com/maps/search/?api=1&query=41.15,-8.61");
  assert.equal(mapsPlaceUrl({ name: "Ghost" }), null);
  assert.equal(mapsPlaceUrl(null), null);
});

test("mapsWalkingRouteUrl builds an ordered walking route; needs >= 2 coord stops", () => {
  assert.equal(mapsWalkingRouteUrl([{ lat: 1, lng: 1 }]), null);
  const url = mapsWalkingRouteUrl([
    { lat: 1, lng: 1 },
    { lat: 2, lng: 2 },
    { lat: 3, lng: 3 },
  ]);
  const u = new URL(url);
  assert.equal(u.searchParams.get("origin"), "1,1");
  assert.equal(u.searchParams.get("destination"), "3,3");
  assert.equal(u.searchParams.get("waypoints"), "2,2");
  assert.equal(u.searchParams.get("travelmode"), "walking");
});

test("a long day samples down to <= 8 waypoints but keeps first + last", () => {
  const stops = Array.from({ length: 20 }, (_, i) => ({ lat: i, lng: i }));
  const u = new URL(mapsWalkingRouteUrl(stops));
  assert.equal(u.searchParams.get("origin"), "0,0");
  assert.equal(u.searchParams.get("destination"), "19,19");
  const waypoints = u.searchParams.get("waypoints").split("|");
  assert.ok(waypoints.length <= 8, "waypoints capped for the consumer Maps URL");
});

test("dayStops flattens districts in visit order, coordless stops included as-is for filtering downstream", () => {
  const day = {
    areas: [
      { stops: [{ name: "A", lat: 1, lng: 1 }] },
      { stops: [{ name: "B", lat: 2, lng: 2 }, { name: "C", lat: 3, lng: 3 }] },
    ],
  };
  const stops = dayStops(day);
  assert.deepEqual(stops.map((s) => s.name), ["A", "B", "C"]);
  // End-to-end: the route URL is built from the flattened day.
  const u = new URL(mapsWalkingRouteUrl(stops));
  assert.equal(u.searchParams.get("origin"), "1,1");
  assert.equal(u.searchParams.get("destination"), "3,3");
});

test("primaryRouteStops reads the returned route, not contextual district candidates", () => {
  const response = {
    days: [
      {
        primary_route: {
          main_stops: [
            { id: "route-1", lat: 1, lng: 1 },
            { id: "route-2", lat: 2, lng: 2 },
          ],
        },
      },
    ],
    place_structure: {
      district_day: {
        areas: [
          {
            stops: [
              { id: "context-1", lat: 10, lng: 10 },
              { id: "context-2", lat: 20, lng: 20 },
              { id: "context-3", lat: 30, lng: 30 },
            ],
          },
        ],
      },
    },
  };

  assert.deepEqual(primaryRouteStops(response).map((s) => s.id), ["route-1", "route-2"]);
  assert.deepEqual(dayStops(response.place_structure.district_day).map((s) => s.id), [
    "context-1",
    "context-2",
    "context-3",
  ]);
});
