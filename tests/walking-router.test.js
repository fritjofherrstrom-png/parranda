const test = require("node:test");
const assert = require("node:assert/strict");

const { routeWalkingPath } = require("../server/walking-router");

const originalFetch = global.fetch;

const samplePoints = [
  { label: "Trastevere", lat: 41.8885, lng: 12.4678 },
  { label: "Monti", lat: 41.8946, lng: 12.4951 },
  { label: "San Lorenzo", lat: 41.8999, lng: 12.5162 },
];

test.afterEach(() => {
  global.fetch = originalFetch;
});

const footConfig = {
  defaultProvider: "osrm",
  osrmBaseUrl: "https://routing.openstreetmap.de/routed-foot/",
  transportMode: "foot",
  requestTimeoutMs: 100,
};

function osrmPayload() {
  return {
    code: "Ok",
    waypoints: samplePoints.map(({ lat, lng }) => ({ location: [lng, lat], distance: 0 })),
    routes: [{
      distance: 5000,
      duration: 3600,
      legs: [{ distance: 3000, duration: 2100 }, { distance: 2000, duration: 1500 }],
      geometry: { type: "LineString", coordinates: samplePoints.map(({ lat, lng }) => [lng, lat]) },
    }],
  };
}

function payloadResponse(payload) {
  return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
}

test("walking-router använder heuristik som säker default", async () => {
  const result = await routeWalkingPath(samplePoints, {
    walkingConfig: {
      defaultProvider: "heuristic",
    },
  });

  assert.equal(result.source, "heuristic");
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.legs.length, samplePoints.length - 1);
  assert.ok(result.legs.every((leg) => Number.isFinite(leg.distance_km)));
  assert.ok(result.pathPoints.length >= samplePoints.length);
});

test("walking-router faller tillbaka till heuristik om osrm inte svarar", async () => {
  global.fetch = async () => {
    throw new Error("OSRM down");
  };

  const result = await routeWalkingPath(samplePoints, {
    walkingConfig: {
      defaultProvider: "osrm",
      osrmBaseUrl: "https://router.project-osrm.org",
      requestTimeoutMs: 10,
    },
  });

  assert.equal(result.source, "heuristic");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.legs.length, samplePoints.length - 1);
});

test("walking-router preserves the pedestrian service prefix and ordered coordinates in one request", async () => {
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return payloadResponse(osrmPayload());
  };
  const result = await routeWalkingPath(samplePoints, { walkingConfig: footConfig });
  assert.equal(requests.length, 1);
  const url = new URL(requests[0].url);
  assert.equal(url.pathname, "/routed-foot/route/v1/foot/12.4678,41.8885;12.4951,41.8946;12.5162,41.8999");
  assert.equal(url.searchParams.get("geometries"), "geojson");
  assert.equal(url.searchParams.get("overview"), "full");
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(result.source, "osrm");
  assert.equal(result.mode, "walking");
  assert.equal(result.estimatedKm, 5);
  assert.equal(result.legs.length, 2);
  assert.deepEqual(result.pathPoints, samplePoints.map(({ lat, lng }) => ({ lat, lng })));
});

test("walking-router does not call an unattested OSRM graph a pedestrian route", async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; return payloadResponse(osrmPayload()); };
  const result = await routeWalkingPath(samplePoints, {
    walkingConfig: { ...footConfig, transportMode: undefined },
  });
  assert.equal(calls, 0);
  assert.equal(result.source, "heuristic");
  assert.equal(result.mode, undefined);
  assert.equal(result.fallbackUsed, true);
});

test("walking-router rejects the known FOSSGIS car service even with a foot declaration", async () => {
  let calls = 0;
  global.fetch = async () => { calls += 1; return payloadResponse(osrmPayload()); };
  const result = await routeWalkingPath(samplePoints, {
    walkingConfig: { ...footConfig, osrmBaseUrl: "https://routing.openstreetmap.de/routed-car/" },
  });
  assert.equal(calls, 0);
  assert.equal(result.source, "heuristic");
  assert.equal(result.fallbackUsed, true);
});

for (const [name, mutate] of [
  ["missing route geometry", (p) => { delete p.routes[0].geometry; }],
  ["wrong geometry type", (p) => { p.routes[0].geometry.type = "Polygon"; }],
  ["out-of-range geometry", (p) => { p.routes[0].geometry.coordinates[1] = [12, 100]; }],
  ["malformed coordinate", (p) => { p.routes[0].geometry.coordinates[1] = [null, 41]; }],
  ["wrong number of legs", (p) => { p.routes[0].legs.pop(); }],
  ["missing leg duration", (p) => { delete p.routes[0].legs[0].duration; }],
  ["negative leg metric", (p) => { p.routes[0].legs[0].distance = -1; }],
  ["contradictory distance total", (p) => { p.routes[0].distance = 50; }],
  ["contradictory duration total", (p) => { p.routes[0].duration = 1; }],
  ["remote waypoint snap", (p) => { p.waypoints[1].location = [13, 42]; }],
  ["missing waypoint", (p) => { p.waypoints.pop(); }],
  ["no route code", (p) => { p.code = "NoRoute"; }],
]) {
  test(`walking-router falls back honestly for ${name}`, async () => {
    const payload = osrmPayload();
    mutate(payload);
    global.fetch = async () => payloadResponse(payload);
    const result = await routeWalkingPath(samplePoints, { walkingConfig: footConfig });
    assert.equal(result.source, "heuristic");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.mode, undefined);
    assert.equal(result.attribution, undefined);
  });
}

test("walking-router bounds the response body", async () => {
  global.fetch = async () => payloadResponse({ ...osrmPayload(), padding: "x".repeat(1024 * 1024 + 1) });
  const result = await routeWalkingPath(samplePoints, { walkingConfig: footConfig });
  assert.equal(result.source, "heuristic");
  assert.equal(result.fallbackUsed, true);
});

test("walking-router cancels unsuccessful response bodies", async () => {
  let cancelled = false;
  global.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 });
  const result = await routeWalkingPath(samplePoints, { walkingConfig: footConfig });
  assert.equal(result.source, "heuristic");
  assert.equal(result.fallbackUsed, true);
  assert.equal(cancelled, true);
});

test("walking-router bounds an uncooperative fetch as well as a normal aborted fetch", { timeout: 500 }, async () => {
  global.fetch = async () => new Promise(() => {});
  const result = await routeWalkingPath(samplePoints, { walkingConfig: { ...footConfig, requestTimeoutMs: 10 } });
  assert.equal(result.source, "heuristic");
  assert.equal(result.fallbackUsed, true);
});

test("walking-router rejects oversized geometry even inside the byte bound", async () => {
  const payload = osrmPayload();
  payload.routes[0].geometry.coordinates = Array.from({ length: 8193 }, () => [12.4678, 41.8885]);
  global.fetch = async () => payloadResponse(payload);
  const result = await routeWalkingPath(samplePoints, { walkingConfig: footConfig });
  assert.equal(result.source, "heuristic");
  assert.equal(result.fallbackUsed, true);
});

test("walking-router's deadline includes response-body reads", { timeout: 500 }, async () => {
  global.fetch = async () => new Response(new ReadableStream({ start() {} }));
  const result = await routeWalkingPath(samplePoints, { walkingConfig: { ...footConfig, requestTimeoutMs: 10 } });
  assert.equal(result.source, "heuristic");
  assert.equal(result.fallbackUsed, true);
});
