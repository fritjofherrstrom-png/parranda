/**
 * Google Maps deep-link builders — coords remain the trust gate, named stops
 * search for their real listing, and long days keep a valid waypoint count.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mapsPlaceUrl, mapsWalkingRouteUrl, dayStops, primaryRouteStops } from "../src/lib/maps-links.mjs";
import * as maps from "../src/lib/maps-links.mjs";

function coordinatesInLink(link) {
  const params = new URL(link).searchParams;
  assert.equal(params.get('api'), '1');
  assert.equal(params.get('travelmode'), 'walking');
  const waypoints = params.get('waypoints')?.split('|') ?? [];
  assert.ok(waypoints.length <= 3, 'each part fits the mobile-browser waypoint limit');
  return [params.get('origin'), ...waypoints, params.get('destination')];
}

test('a long walking handoff preserves every stop in mobile-safe parts with shared endpoints', () => {
  const stops = Array.from({ length: 20 }, (_, i) => ({ lat: 50 + i / 100, lng: 10 + i / 100 }));
  const links = maps.mapsWalkingRouteUrls(stops);
  const points = links.flatMap((link, i) => coordinatesInLink(link).slice(i ? 1 : 0));
  assert.deepEqual(points, stops.map(s => `${s.lat},${s.lng}`));
  assert.equal(mapsWalkingRouteUrl(stops), null, 'a single URL must not silently drop stops');
});

test('segmentation preserves a near-me loop, woven stop and intermediate revisits', () => {
  const anchor = { lat: 50, lng: 10 };
  const stops = [
    { lat: 50.01, lng: 10.01 }, anchor,
    { lat: 50.02, lng: 10.02, candidate_kind: 'live_event' },
    { lat: 50.03, lng: 10.03 }, { lat: 50.04, lng: 10.04 },
  ];
  const links = maps.mapsWalkingRouteUrls(stops, { origin: anchor, destination: anchor });
  assert.deepEqual(links.flatMap((link, i) => coordinatesInLink(link).slice(i ? 1 : 0)),
    [anchor, ...stops, anchor].map(s => `${s.lat},${s.lng}`));
});

test('an incomplete or invalid route cannot be presented as a complete Maps handoff', () => {
  for (const invalid of [{}, { lat: 91, lng: 10 }, { lat: 50, lng: 181 }, { lat: NaN, lng: 10 }]) {
    const stops = [{ lat: 50, lng: 10 }, invalid, { lat: 50.1, lng: 10.1 }];
    assert.equal(mapsWalkingRouteUrl(stops), null);
    assert.deepEqual(maps.mapsWalkingRouteUrls(stops), []);
  }
});

test("mapsPlaceUrl searches for a named real place in context and keeps a coordinate fallback", () => {
  const named = new URL(
    mapsPlaceUrl(
      { name: "Bergengrenska Trädgården", lat: 55.5555171, lng: 14.3487202 },
      "Simrishamn, Sverige",
    ),
  );
  assert.equal(named.searchParams.get("query"), "Bergengrenska Trädgården, Simrishamn, Sverige");

  assert.equal(mapsPlaceUrl({ lat: 41.15, lng: -8.61 }), "https://www.google.com/maps/search/?api=1&query=41.15,-8.61");
  assert.equal(mapsPlaceUrl({ name: "Ghost" }), null);
  assert.equal(mapsPlaceUrl(null), null);
});

test("mapsPlaceUrl carries trusted address/area context without duplicating identical fields", () => {
  const url = new URL(
    mapsPlaceUrl(
      { label: "Karins", address: "Storgatan 2", area: "Centrum", lat: 55.55, lng: 14.35 },
      "Simrishamn",
    ),
  );
  assert.equal(url.searchParams.get("query"), "Karins, Storgatan 2, Centrum, Simrishamn");

  const deduped = new URL(mapsPlaceUrl({ name: "Karins", area: "Simrishamn", lat: 55.55, lng: 14.35 }, "simrishamn"));
  assert.equal(deduped.searchParams.get("query"), "Karins, Simrishamn");
});

test("mapsPlaceUrl applies the same place-search contract across arbitrary cities", () => {
  const fixtures = [
    { name: "Folkets park", context: "Malmö, Sverige" },
    { name: "Museo Carducci", context: "Bologna, Italia" },
    { name: "Archaeological Museum of Naxos", context: "Naxos, Greece" },
  ];

  for (const fixture of fixtures) {
    const url = new URL(mapsPlaceUrl({ name: fixture.name, lat: 1, lng: 1 }, fixture.context));
    assert.equal(url.searchParams.get("query"), `${fixture.name}, ${fixture.context}`);
  }
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

test("a trusted near-me anchor frames the route without changing stop order", () => {
  const anchor = { lat: 59.3293, lng: 18.0686 };
  const u = new URL(
    mapsWalkingRouteUrl(
      [
        { lat: 59.332, lng: 18.064 },
        { lat: 59.337, lng: 18.075 },
      ],
      { origin: anchor, destination: anchor },
    ),
  );

  assert.equal(u.searchParams.get("origin"), "59.3293,18.0686");
  assert.equal(u.searchParams.get("destination"), "59.3293,18.0686");
  assert.equal(u.searchParams.get("waypoints"), "59.332,18.064|59.337,18.075");
  assert.equal(u.searchParams.get("travelmode"), "walking");
});

test("an anchored one-stop route stays useful while empty or anchor-only routes fail closed", () => {
  const anchor = { lat: 59.3293, lng: 18.0686 };
  const oneStop = new URL(
    mapsWalkingRouteUrl([{ lat: 59.332, lng: 18.064 }], { origin: anchor, destination: anchor }),
  );
  assert.equal(oneStop.searchParams.get("waypoints"), "59.332,18.064");
  assert.equal(mapsWalkingRouteUrl([], { origin: anchor, destination: anchor }), null);
  assert.equal(mapsWalkingRouteUrl([anchor], { origin: anchor, destination: anchor }), null);
});

test("five points fit one portable link; six split with no gaps", () => {
  const stops = Array.from({ length: 6 }, (_, i) => ({ lat: i, lng: i }));
  assert.deepEqual(coordinatesInLink(mapsWalkingRouteUrl(stops.slice(0, 5))), ['0,0', '1,1', '2,2', '3,3', '4,4']);
  const links = maps.mapsWalkingRouteUrls(stops);
  assert.equal(links.length, 2);
  assert.deepEqual(coordinatesInLink(links[1]), ['4,4', '5,5']);
});

test("adjacent shared coordinates add no leg but nonadjacent return visits survive", () => {
  const a = { lat: 1, lng: 1 }, b = { lat: 2, lng: 2 };
  assert.deepEqual(coordinatesInLink(mapsWalkingRouteUrl([a, a, b, a], { origin: a, destination: a })), ['1,1', '2,2', '1,1']);
  assert.deepEqual(maps.mapsWalkingRouteUrls([a, b], { origin: { lat: 91, lng: 0 } }), []);
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
