const test = require("node:test");
const assert = require("node:assert/strict");
const {
  composeAgnosticRouteOutput,
} = require("../server/planner/agnostic-route-output");

const origin = { lat: 46, lng: 8 };
const records = [
  ["kitchen", "restaurant", 0.001],
  ["museum", "museum", 0.002],
  ["other-kitchen", "restaurant", 0.022],
].map(([id, type, north]) => ({
  id,
  name: id,
  type,
  lat: 46 + north,
  lng: 8.001,
  tags: [],
  chain: false,
  sources: [
    {
      provider: "map",
      family: "map",
      tier: "inferred",
      url: "https://example.test/" + id,
    },
  ],
}));
function compose(extra = {}) {
  return composeAgnosticRouteOutput({
    coords: origin,
    baselineResult: { days: [] },
    externalRequested: true,
    openDataLoader: async () => records,
    preferences: ["food", "culture"],
    date: "2026-09-20",
    todayIsoDate: () => "2026-09-14",
    weatherProvider: async () => null,
    walkingKmTarget: 6,
    anchorMode: "coordinates",
    distanceMode: "soft_target",
    synthesizeVia: "engine",
    ...extra,
  });
}
function provider(cost, calls) {
  return {
    session: () => ({
      async route(points) {
        calls.push(structuredClone(points));
        const km = cost(points);
        if (km === null) return { status: "no_path" };
        return {
          status: "ok",
          source: "valhalla_pedestrian",
          estimatedKm: km,
          legs: points.slice(1).map((p, i) => ({
            distance_km: km / (points.length - 1),
            estimated_walk_minutes: (km * 12) / (points.length - 1),
          })),
          pathPoints: points.map((p) => ({ lat: p.lat, lng: p.lng })),
          snapDistances: points.map(() => 0),
        };
      },
    }),
  };
}
test("network detour changes the chosen same-role identity, not merely the map decoration", async () => {
  const before = await compose();
  assert.ok(
    before.result.days[0].primary_route.main_stops.some(
      (s) => s.id === "other-kitchen",
    ),
  );
  const calls = [];
  const after = await compose({
    networkWalkingProvider: provider(
      (points) => (points.some((p) => p.lat > 46.02) ? 12 : 4.5),
      calls,
    ),
  });
  const route = after.result.days[0]?.primary_route;
  assert.equal(route?.routing_source, "valhalla_pedestrian");
  assert.equal(route.estimated_km, 4.5);
  assert.deepEqual(
    new Set(route.main_stops.map((s) => s.id)),
    new Set(["kitchen", "museum"]),
  );
  assert.deepEqual(
    route.map_path_points,
    calls.at(-1).map((p) => ({ lat: p.lat, lng: p.lng })),
  );
  assert.equal(
    route.legs.reduce((n, l) => n + l.distance_km, 0),
    4.5,
  );
  assert.equal(
    after.experiment.constraint_negotiation.walking.status,
    "within_requested_band",
  );
  assert.ok(calls.length <= 4);
});
test("unreachable chains never come back as heuristic network successes", async () => {
  const calls = [];
  const result = await compose({
    networkWalkingProvider: provider(() => null, calls),
  });
  assert.equal(result.result.days.length, 0);
  assert.ok(
    result.experiment.eligibility.blockers.includes(
      "network_walking_unavailable",
    ),
  );
});
test("already fitting network route does not spend queries chasing more distance", async () => {
  const calls = [];
  const result = await compose({
    networkWalkingProvider: provider(() => 4, calls),
  });
  assert.equal(result.result.days[0].primary_route.estimated_km, 4);
  assert.equal(calls.length, 1);
});
test("typed-place geometry excludes the discovery anchor; coordinate geometry retains it", async () => {
  for (const anchorMode of ["place", "coordinates"]) {
    const calls = [];
    const result = await compose({
      anchorMode,
      networkWalkingProvider: provider(() => 4, calls),
    });
    const route = result.result.days[0].primary_route;
    assert.equal(
      calls[0].some((p) => p.lat === 46 && p.lng === 8),
      anchorMode === "coordinates",
    );
    assert.deepEqual(calls[0], route.map_route_points);
  }
});

test("network cost cannot replace independently corroborated food with single-family food", async () => {
  const trusted = structuredClone(records);
  trusted.at(-1).sources.push({
    provider: "official",
    family: "official",
    tier: "official",
    url: "https://example.test/official",
  });
  const calls = [];
  const result = await compose({
    openDataLoader: async () => trusted,
    networkWalkingProvider: provider(
      (points) => (points.some((p) => p.lat > 46.02) ? null : 4.5),
      calls,
    ),
  });
  assert.equal(
    result.result.days.length,
    0,
    "do not weaken role trust to dodge the barrier",
  );
});

test("pins are not silently exchanged and cannot bypass the network safety caps", async () => {
  const result = await compose({
    pinnedStopIds: ["other-kitchen"],
    networkWalkingProvider: provider(() => 30, []),
  });
  assert.equal(result.result.days.length, 0);
  assert.ok(
    result.experiment.eligibility.blockers.includes(
      "network_walking_unavailable",
    ),
  );
});

test("a pin is not blamed when the measured baseline is already equally long", async () => {
  const result = await compose({
    pinnedStopIds: ["other-kitchen"],
    networkWalkingProvider: provider(() => 12, []),
  });
  assert.equal(result.result.days[0]?.primary_route.estimated_km, 12);
});

test("an unknown pin cannot impose a new walking ceiling on the day", async () => {
  const result = await compose({
    pinnedStopIds: ["unknown"],
    networkWalkingProvider: provider(() => 12, []),
  });
  assert.equal(result.result.days[0]?.primary_route.estimated_km, 12);
});

test("public Planner publishes network truth once, with identical inspect geometry and no private alternatives", async () => {
  const { buildApp } = require("../server/app");
  const {
    requestJson,
    mockStableWeatherFetch,
  } = require("./helpers/planner-reservoir-compare");
  const old = global.fetch;
  global.fetch = mockStableWeatherFetch();
  let loads = 0;
  const calls = [];
  const server = buildApp({
    openDataLoader: async () => {
      loads++;
      return records;
    },
    networkWalkingProvider: provider(
      (points) => (points.some((p) => p.lat > 46.02) ? 12 : 4.5),
      calls,
    ),
  }).listen(0);
  try {
    const body = {
      ...origin,
      dates: ["2026-09-20"],
      preferences: ["food", "culture"],
      walking_km_target: 6,
      include_external_candidates: 1,
      experimental_agnostic_route_output: 1,
      agnostic_engine_compose: 1,
    };
    const send = async (query) => {
      const response = await old(
        `http://127.0.0.1:${server.address().port}/api/route-recommendations?lang=en${query}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Prefer: "respond-async",
          },
          body: JSON.stringify(body),
        },
      );
      assert.equal(response.status, 200);
      return { body: await response.json() };
    };
    const first = await send("");
    const inspect = await send("&inspect=route_output");
    const route = first.body.days[0].primary_route;
    assert.equal(route.routing_source, "valhalla_pedestrian");
    assert.equal(route.estimated_km, 4.5);
    assert.deepEqual(route, inspect.body.days[0].primary_route);
    assert.equal(loads, 2);
    assert.ok(calls.length <= 8);
    for (const forbidden of [
      "walking_fit_candidates",
      "composedDays",
      "routing.example.test",
    ])
      assert.equal(JSON.stringify(first.body).includes(forbidden), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = old;
  }
});

test("public payload cannot opt in or replace the server walking provider", async () => {
  const { buildApp } = require("../server/app");
  const {
    requestJson,
    mockStableWeatherFetch,
  } = require("./helpers/planner-reservoir-compare");
  const old = global.fetch;
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({
    openDataLoader: async () => records,
    networkWalkingProvider: null,
  }).listen(0);
  try {
    const result = await requestJson(server, {
      path: "/api/route-recommendations?lang=en",
      body: {
        ...origin,
        dates: ["2026-09-20"],
        preferences: ["food", "culture"],
        walking_km_target: 6,
        include_external_candidates: 1,
        experimental_agnostic_route_output: 1,
        agnostic_engine_compose: 1,
        networkWalkingProvider: { endpoint: "https://attacker.test/route" },
        network_walking: "enabled",
        walking_geometry: { kind: "pedestrian_network" },
        routing_source: "valhalla_pedestrian",
      },
    });
    assert.equal(
      result.body.days[0].primary_route.routing_source,
      "agnostic_compose",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = old;
  }
});

test("a real lifecycle DELETE closes the outstanding native routing response", async () => {
  const http = require("node:http");
  const { buildApp } = require("../server/app");
  const {
    createValhallaWalkingProvider,
  } = require("../server/valhalla-walking");
  const {
    SOURCE_COMPLETION,
  } = require("../server/place-candidates/background-source");
  const {
    mockStableWeatherFetch,
  } = require("./helpers/planner-reservoir-compare");
  const native = global.fetch;
  global.fetch = mockStableWeatherFetch();
  let accept, closed, releaseSupply;
  const received = new Promise((r) => {
    accept = r;
  });
  const disconnected = new Promise((r) => {
    closed = r;
  });
  const upstream = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"trip":');
    res.once("close", closed);
    accept();
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const completion = new Promise((r) => {
    releaseSupply = r;
  });
  const server = buildApp({
    openDataLoader: async () => {
      const pending = [];
      Object.defineProperty(pending, SOURCE_COMPLETION, { value: completion });
      return pending;
    },
    networkWalkingProvider: createValhallaWalkingProvider({
      endpoint: `http://127.0.0.1:${upstream.address().port}/route`,
      fetcher: native,
    }),
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let timeout;
  try {
    const initial = await native(base + "/api/route-recommendations?lang=en", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "respond-async" },
      body: JSON.stringify({
        ...origin,
        dates: ["2026-09-20"],
        preferences: ["food", "culture"],
        walking_km_target: 6,
        include_external_candidates: 1,
        experimental_agnostic_route_output: 1,
        agnostic_engine_compose: 1,
      }),
    });
    assert.equal(initial.status, 202);
    const token = (await initial.json()).planner_lifecycle.token;
    releaseSupply(records);
    await received;
    const deleted = await native(base + "/api/planner-status", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(deleted.status, 204);
    await Promise.race([
      disconnected,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(Error("routing socket remained open")),
          1500,
        );
      }),
    ]);
    const stale = await native(base + "/api/planner-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(stale.status, 410);
  } finally {
    clearTimeout(timeout);
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((r) => server.close(r)),
      new Promise((r) => upstream.close(r)),
    ]);
    global.fetch = native;
  }
});
