const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveDefaultWalkingRuntime, createBoundedWalkingRouter } = require("../server/walking-runtime");

const environment = {
  PARRANDA_WALKING_PROVIDER: "osrm",
  PARRANDA_OSRM_URL: "https://routing.openstreetmap.de/routed-foot/",
};
const points = [{ label: "A", lat: 55.6, lng: 13 }, { label: "B", lat: 55.601, lng: 13.001 }];
function responseFor(path = points) {
  return new Response(JSON.stringify({
    code: "Ok",
    waypoints: path.map(({ lat, lng }) => ({ location: [lng, lat], distance: 0 })),
    routes: [{
      distance: 200, duration: 180,
      legs: [{ distance: 200, duration: 180 }],
      geometry: { type: "LineString", coordinates: path.map(({ lat, lng }) => [lng, lat]) },
    }],
  }));
}

test("walking runtime is disabled without an explicit trusted pedestrian endpoint", () => {
  for (const env of [{}, { PARRANDA_WALKING_PROVIDER: "osrm" },
    { ...environment, PARRANDA_OSRM_URL: "https://router.project-osrm.org/" },
    { ...environment, PARRANDA_OSRM_URL: "https://operator.example/routes/" }]) {
    assert.deepEqual(resolveDefaultWalkingRuntime(env), { walkingRouter: null, walkingConfig: null });
  }
});

test("walking runtime resolves FOSSGIS foot and explicitly declared operator-owned graphs", () => {
  const runtime = resolveDefaultWalkingRuntime(environment);
  assert.equal(typeof runtime.walkingRouter, "function");
  assert.equal(runtime.walkingConfig.transportMode, "foot");
  assert.equal(runtime.walkingConfig.attribution.label, "FOSSGIS routing");
  assert.equal(runtime.walkingConfig.attribution.fixMapUrl, "https://www.openstreetmap.org/fixthemap");
  const operator = resolveDefaultWalkingRuntime({ ...environment,
    PARRANDA_OSRM_URL: "https://operator.example/walking/",
    PARRANDA_OSRM_TRANSPORT_MODE: "foot",
  });
  assert.equal(typeof operator.walkingRouter, "function");
  assert.equal(operator.walkingConfig.osrmBaseUrl, "https://operator.example/walking/");
});

test("default runtime construction shares one process-wide provider budget and cache", () => {
  const first = resolveDefaultWalkingRuntime(environment);
  const second = resolveDefaultWalkingRuntime({ ...environment });
  assert.equal(first.walkingRouter, second.walkingRouter);
});

test("walking runtime rejects unsafe or ambiguous endpoint forms", () => {
  for (const url of ["file:///tmp/router", "https://name:secret@operator.example/", "https://operator.example/?profile=foot",
    "https://routing.openstreetmap.de/routed-car/", "http://routing.openstreetmap.de/routed-foot/",
    "https://router.project-osrm.org/"]) {
    assert.deepEqual(resolveDefaultWalkingRuntime({ ...environment, PARRANDA_OSRM_URL: url,
      PARRANDA_OSRM_TRANSPORT_MODE: "foot" }), { walkingRouter: null, walkingConfig: null });
  }
});

test("walking runtime coalesces and caches the ordered chain without leaking mutable output", async () => {
  let calls = 0;
  let complete;
  const fetchImpl = async () => { calls += 1; await new Promise(resolve => { complete = resolve; }); return responseFor(); };
  const config = resolveDefaultWalkingRuntime(environment).walkingConfig;
  const router = createBoundedWalkingRouter(config, { fetchImpl });
  const first = router(points);
  const second = router(points);
  assert.equal(calls, 1);
  complete();
  const [a, b] = await Promise.all([first, second]);
  a.pathPoints[0].lat = 0;
  assert.equal(b.pathPoints[0].lat, points[0].lat);
  const cached = await router(points.map((p, i) => ({ ...p, label: `Changed ${i}` })));
  assert.equal(calls, 1);
  assert.equal(cached.legs[0].from_label, "Changed 0");
  assert.equal(cached.mode, "walking");
  assert.equal(cached.attribution.label, "FOSSGIS routing");
});

test("walking runtime bounds concurrent distinct requests and the one-second provider interval", async () => {
  let now = 1000;
  let calls = 0;
  let complete;
  const fetchImpl = async () => { calls += 1; await new Promise(resolve => { complete = resolve; }); return responseFor(); };
  const config = resolveDefaultWalkingRuntime(environment).walkingConfig;
  const router = createBoundedWalkingRouter(config, { fetchImpl, now: () => now });
  const active = router(points);
  const other = [{ lat: 55.61, lng: 13 }, { lat: 55.611, lng: 13.001 }];
  assert.equal((await router(other)).source, "heuristic");
  assert.equal(calls, 1);
  complete();
  await active;
  assert.equal((await router(other)).source, "heuristic");
  now = 2000;
  const next = router(other);
  assert.equal(calls, 2);
  complete();
  await next;
});

test("walking runtime expires and bounds the geometry cache", async () => {
  let now = 1000;
  let calls = 0;
  const config = resolveDefaultWalkingRuntime(environment).walkingConfig;
  const router = createBoundedWalkingRouter(config, { now: () => now, maxEntries: 2, ttlMs: 10000,
    fetchImpl: async (url) => {
      calls += 1;
      const chain = new URL(url).pathname.split("/").at(-1).split(";").map(pair => {
        const [lng, lat] = pair.split(",").map(Number); return { lat, lng };
      });
      return responseFor(chain);
    },
  });
  const chains = [points, points.map(p => ({ ...p, lat: p.lat + .01 })), points.map(p => ({ ...p, lat: p.lat + .02 }))];
  for (const chain of chains) { await router(chain); now += 1000; }
  await router(points);
  assert.equal(calls, 4);
  now += 11000;
  await router(points);
  assert.equal(calls, 5);
});
