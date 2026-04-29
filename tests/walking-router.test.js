const test = require("node:test");
const assert = require("node:assert/strict");

const { routeWalkingPath } = require("../server/walking-router");

const originalFetch = global.fetch;

const samplePoints = [
  { label: "Trastevere", lat: 41.8885, lng: 12.4678 },
  { label: "Monti", lat: 41.8946, lng: 12.4951 },
  { label: "San Lorenzo", lat: 41.8999, lng: 12.5162 },
];

test.after(() => {
  global.fetch = originalFetch;
});

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
