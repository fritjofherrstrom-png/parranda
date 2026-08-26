const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { buildApp } = require("../server/app");

const originalFetch = global.fetch;

function mockJsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return payload;
    },
  };
}

function mockStableWeatherFetch() {
  return async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.open-meteo.com") {
      const start = new Date(`${parsed.searchParams.get("start_date")}T12:00:00`);
      const end = new Date(`${parsed.searchParams.get("end_date")}T12:00:00`);
      const time = [];
      const weathercode = [];
      const temperature_2m_max = [];
      const temperature_2m_min = [];
      for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        time.push(cursor.toISOString().slice(0, 10));
        weathercode.push(0);
        temperature_2m_max.push(24);
        temperature_2m_min.push(14);
      }
      return mockJsonResponse({
        daily: { time, weathercode, temperature_2m_max, temperature_2m_min },
        current: { temperature_2m: 19.2, weather_code: 1, is_day: 1 },
      });
    }
    throw new Error(`Unexpected fetch during planner-candidate-roles API test: ${url}`);
  };
}

async function requestJson(server, { method = "GET", path = "/", body } = {}) {
  const { port } = server.address();
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : undefined,
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode, body: data ? JSON.parse(data) : null });
        });
      },
    );
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function externalRecord(id, name, type, lat, lng, tags = []) {
  return {
    id,
    name,
    type,
    lat,
    lng,
    tags,
    sources: [
      { provider: "osm", family: "map", tier: "inferred", url: `https://www.openstreetmap.org/node/${id}` },
      { provider: "wikidata", family: "open_knowledge", tier: "inferred", url: `https://www.wikidata.org/wiki/Q${Math.abs(hash(id))}` },
    ],
  };
}

function hash(value) {
  return String(value)
    .split("")
    .reduce((total, char) => (total * 31 + char.charCodeAt(0)) | 0, 1);
}

const ATHENS_BODY = {
  city: "athens",
  dates: ["2026-05-25"],
  start: { type: "auto" },
  end: { type: "auto" },
  walking_km_target: 7,
  preferences: ["kultur", "mat", "kväll"],
  distance_mode: "soft_target",
  budget_tier: "standard",
};

const ROME_SWIMMING_BODY = {
  city: "rome",
  dates: ["2026-05-25"],
  start: { type: "auto" },
  end: { type: "auto" },
  walking_km_target: 7,
  preferences: ["swimming"],
  distance_mode: "soft_target",
  budget_tier: "standard",
};

function primaryRouteShape(responseBody) {
  const route = responseBody.days?.[0]?.primary_route || {};
  return {
    id: route.id || null,
    stops: (route.main_stops || []).map((stop) => stop.id),
    alternatives: (responseBody.days?.[0]?.alternatives || []).map((routeOption) => routeOption.id || null),
  };
}

test("route recommendations omit planner role inspect data by default", async () => {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: null }).listen(0);
  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: ATHENS_BODY,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.planner_roles, undefined);
    assert.equal(response.body.dayflow_honesty, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
  }
});

test("inspect flag adds plan-scoped role coverage and honesty without changing route output", async () => {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: null }).listen(0);
  try {
    const base = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: ATHENS_BODY,
    });
    const inspected = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: {
        ...ATHENS_BODY,
        planner_inspect: true,
        include_candidate_roles: true,
      },
    });

    assert.equal(inspected.status, 200);
    assert.equal(inspected.body.planner_roles.scope, "plan");
    assert.equal(inspected.body.planner_roles.roles.length, 6);
    assert.equal(inspected.body.planner_roles.context.date, "2026-05-25");
    assert.ok(inspected.body.planner_roles.roles.every((role) => "planner_usable" in role));
    assert.ok(["full", "partial", "sparse", "fallback_heavy"].includes(inspected.body.dayflow_honesty.day_status));
    const publicInspectJson = JSON.stringify(inspected.body.planner_roles);
    assert.doesNotMatch(
      publicInspectJson,
      /commitment_rescuable_ids|pin_rescuable_candidate_ids/,
      "private ranked-tail rescue bookkeeping must not cross the inspect API boundary",
    );
    assert.deepEqual(primaryRouteShape(inspected.body), primaryRouteShape(base.body));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
  }
});

test("public payload external_provider is ignored, but trusted openDataLoader can fill external role candidates", async () => {
  global.fetch = mockStableWeatherFetch();
  const externalBeach = externalRecord("external-beach", "External Beach", "beach", 37.93, 23.68, ["coast"]);
  const publicServer = buildApp({ openDataLoader: null }).listen(0);
  try {
    const publicResponse = await requestJson(publicServer, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: {
        ...ATHENS_BODY,
        planner_inspect: true,
        include_candidate_roles: true,
        include_external_candidates: 1,
        preferences: ["swimming"],
        external_provider: { dataset: [externalBeach] },
      },
    });

    assert.equal(publicResponse.status, 200);
    const publicSwim = publicResponse.body.planner_roles.roles.find((role) => role.role === "swimming_coast_option");
    assert.equal(publicResponse.body.planner_roles.source_status[0].status, "no_loader_configured");
    assert.equal(publicSwim.candidates.some((candidate) => candidate.candidate_id === "external-beach"), false);
  } finally {
    await new Promise((resolve) => publicServer.close(resolve));
  }

  const trustedServer = buildApp({ openDataLoader: async () => [externalBeach] }).listen(0);
  try {
    const trustedResponse = await requestJson(trustedServer, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: {
        ...ATHENS_BODY,
        planner_inspect: true,
        include_candidate_roles: true,
        include_external_candidates: 1,
        preferences: ["swimming"],
        external_provider: { dataset: [] },
      },
    });

    assert.equal(trustedResponse.status, 200);
    const trustedSwim = trustedResponse.body.planner_roles.roles.find((role) => role.role === "swimming_coast_option");
    assert.equal(trustedResponse.body.planner_roles.source_status[0].status, "loaded:1");
    assert.equal(trustedResponse.body.planner_roles.density, "thin");
    assert.ok(trustedSwim.candidates.some((candidate) => candidate.candidate_id === "external-beach"));
    assert.ok(trustedResponse.body.dayflow_honesty.quality_flags.includes("external_only_swimming_coast_option"));
  } finally {
    await new Promise((resolve) => trustedServer.close(resolve));
    global.fetch = originalFetch;
  }
});

test("rich citypack density stays curated-derived when external candidates are inspected", async () => {
  global.fetch = mockStableWeatherFetch();
  const externalBeach = externalRecord("external-barcelona-beach", "External Barcelona Beach", "beach", 41.39, 2.19, ["coast"]);
  const server = buildApp({ openDataLoader: async () => [externalBeach] }).listen(0);
  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: {
        city: "barcelona",
        dates: ["2026-05-25"],
        start: { type: "auto" },
        end: { type: "auto" },
        walking_km_target: 7,
        preferences: ["swimming"],
        planner_inspect: true,
        include_candidate_roles: true,
        include_external_candidates: 1,
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.planner_roles.density, "rich");
    assert.equal(response.body.dayflow_honesty.quality_flags.includes("thin_catalog_density"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
  }
});

test("unknown lens remains neutral in planner role inspect", async () => {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: null }).listen(0);
  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: {
        ...ATHENS_BODY,
        planner_inspect: true,
        include_candidate_roles: true,
        lens: "not-a-lens",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.planner_roles.lens, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
  }
});

test("Rome swimming inspect reports genuinely unavailable role as missing without changing route output", async () => {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: null }).listen(0);
  try {
    const base = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: ROME_SWIMMING_BODY,
    });
    const inspected = await requestJson(server, {
      method: "POST",
      path: "/api/route-recommendations?lang=en",
      body: {
        ...ROME_SWIMMING_BODY,
        planner_inspect: true,
        include_candidate_roles: true,
      },
    });

    assert.equal(inspected.status, 200);
    const swim = inspected.body.planner_roles.roles.find((role) => role.role === "swimming_coast_option");
    assert.equal(swim.status, "missing");
    assert.equal(swim.candidates.length, 0);
    assert.ok(inspected.body.dayflow_honesty.role_coverage.missing.includes("swimming_coast_option"));
    assert.notEqual(inspected.body.dayflow_honesty.day_status, "full");
    assert.deepEqual(primaryRouteShape(inspected.body), primaryRouteShape(base.body));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
  }
});
