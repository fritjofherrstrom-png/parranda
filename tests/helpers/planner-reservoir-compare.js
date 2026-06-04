/**
 * Test-only helper for #248 planner reservoir QA / comparison scenarios.
 *
 * Drives /api/route-recommendations deterministically (mocked weather, injected
 * open-data loader — no live network) and compares inspect vs default responses.
 * Production architecture is untouched.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const { buildApp } = require("../../server/app");

const ORIGINAL_FETCH = global.fetch;

function mockJsonResponse(payload) {
  return { ok: true, status: 200, statusText: "OK", async json() { return payload; } };
}

// Deterministic weather; throws on any non-weather URL so a stray live network
// call fails the test loudly.
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
    throw new Error(`Unexpected live network during planner reservoir QA: ${url}`);
  };
}

function hash(value) {
  return String(value).split("").reduce((total, char) => (total * 31 + char.charCodeAt(0)) | 0, 1);
}

// An open-data record corroborated by OSM + Wikidata (two families → eligible).
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

function makeLoader(records) {
  return async () => records.map((record) => ({ ...record }));
}

function routeBody(city, preferences = [], extra = {}) {
  return {
    city,
    dates: ["2026-05-25"],
    start: { type: "auto" },
    end: { type: "auto" },
    walking_km_target: 7,
    preferences,
    distance_mode: "soft_target",
    budget_tier: "standard",
    ...extra,
  };
}

function primaryRouteShape(body) {
  const route = body.days?.[0]?.primary_route || {};
  return {
    id: route.id || null,
    stops: (route.main_stops || []).map((stop) => stop.id),
    alternatives: (body.days?.[0]?.alternatives || []).map((option) => option.id || null),
  };
}

async function requestJson(server, { method = "POST", path = "/", body } = {}) {
  const { port } = server.address();
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : undefined,
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => resolve({ status: response.statusCode, body: data ? JSON.parse(data) : null }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Run a route request with and without the inspect flag, assert the route is
 * untouched, and return both responses. `query` is appended to the inspect call.
 */
async function compareInspectVsDefault({ openDataLoader = null, body, query = "planner_inspect=1" }) {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader }).listen(0);
  try {
    const def = await requestJson(server, { path: "/api/route-recommendations?lang=en", body });
    const inspected = await requestJson(server, { path: `/api/route-recommendations?lang=en&${query}`, body });

    assert.equal(def.status, 200, "default request should succeed");
    assert.equal(inspected.status, 200, "inspect request should succeed");

    // Default omits the sidecar entirely.
    assert.equal(def.body.planner_roles, undefined, "default must omit planner_roles");
    assert.equal(def.body.dayflow_honesty, undefined, "default must omit dayflow_honesty");

    // Inspect must NOT change the route output.
    assert.deepEqual(
      primaryRouteShape(inspected.body),
      primaryRouteShape(def.body),
      "inspect must not change selected route / stops / alternatives",
    );

    // Sidecar invariants.
    const pr = inspected.body.planner_roles;
    assert.ok(pr, "inspect must include planner_roles");
    assert.equal(pr.scope, "plan", "planner_roles.scope must be 'plan'");
    assert.equal(pr.roles.length, 6, "all six role slots must be present");
    assert.ok(inspected.body.dayflow_honesty, "inspect must include dayflow_honesty");

    return { def: def.body, inspected: inspected.body, planner_roles: pr, dayflow: inspected.body.dayflow_honesty };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = ORIGINAL_FETCH;
  }
}

function roleByName(plannerRoles, role) {
  return plannerRoles.roles.find((entry) => entry.role === role);
}

function originsInRole(plannerRoles, role) {
  return (roleByName(plannerRoles, role)?.candidates || []).map((candidate) => candidate.origin);
}

module.exports = {
  compareInspectVsDefault,
  requestJson,
  externalRecord,
  makeLoader,
  routeBody,
  primaryRouteShape,
  mockStableWeatherFetch,
  roleByName,
  originsInRole,
};
