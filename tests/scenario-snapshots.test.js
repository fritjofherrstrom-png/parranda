const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { generateRecommendations } = require("../server/route-engine");
const { resetLiveEventsCache } = require("../server/live-events");

const originalFetch = global.fetch;
const snapshotDir = path.join(__dirname, "scenarios", "rome");
const shouldUpdateSnapshots = process.env.PARRANDA_UPDATE_SCENARIOS === "1";

function mockJsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function createStableScenarioFetch(weatherCodeByDate = {}) {
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
        const isoDate = cursor.toISOString().slice(0, 10);
        time.push(isoDate);
        weathercode.push(weatherCodeByDate[isoDate] ?? 0);
        temperature_2m_max.push(24);
        temperature_2m_min.push(14);
      }

      return mockJsonResponse({
        daily: {
          time,
          weathercode,
          temperature_2m_max,
          temperature_2m_min,
        },
        current: {
          temperature_2m: 19.2,
          weather_code: 1,
          is_day: 1,
        },
      });
    }

    if (parsed.hostname === "www.turismoroma.it") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return "<div></div>";
        },
      };
    }

    throw new Error(`Unexpected fetch during scenario snapshot test: ${url}`);
  };
}

function roundMetric(value) {
  if (!Number.isFinite(Number(value))) {
    return null;
  }

  return Number(Number(value).toFixed(1));
}

function normalizeLeg(leg = {}) {
  return {
    from: leg.from_label || null,
    to: leg.to_label || null,
    km: roundMetric(leg.distance_km),
    minutes: Number.isFinite(Number(leg.estimated_walk_minutes))
      ? Number(leg.estimated_walk_minutes)
      : null,
  };
}

function normalizePrimaryRoute(route = {}) {
  return {
    id: route.id || null,
    start: route.start_label || null,
    end: route.end_label || null,
    shape: route.route_shape || null,
    day_profile: route.day_profile || null,
    anchor_zone: route.anchor_zone || null,
    routing_source: route.routing_source || null,
    estimated_km: roundMetric(route.estimated_km),
    longest_leg_km: roundMetric(route.longest_leg_km),
    longest_leg_minutes: Number.isFinite(Number(route.longest_leg_minutes))
      ? Number(route.longest_leg_minutes)
      : null,
    average_leg_minutes: Number.isFinite(Number(route.average_leg_minutes))
      ? Number(route.average_leg_minutes)
      : null,
    stops: (route.main_stops || []).map((stop) => ({
      label: stop.label,
      area: stop.area,
      live: Boolean(stop.is_live_event),
    })),
    legs: (route.legs || []).map(normalizeLeg),
  };
}

function normalizeAlternative(route = {}) {
  return {
    id: route.id || null,
    start: route.start_label || null,
    end: route.end_label || null,
    shape: route.route_shape || null,
    day_profile: route.day_profile || null,
    anchor_zone: route.anchor_zone || null,
    stops: (route.main_stops || []).map((stop) => stop.label),
  };
}

function normalizeScenarioResult(result = {}) {
  return {
    resolved_start: result.resolved_start?.label || null,
    resolved_end: result.resolved_end?.label || null,
    resolved_home_base: result.resolved_home_base?.label || null,
    days: (result.days || []).map((day) => ({
      date: day.date,
      primary: normalizePrimaryRoute(day.primary_route),
      alternative_count: Array.isArray(day.alternatives) ? day.alternatives.length : 0,
      alternatives: (day.alternatives || []).map(normalizeAlternative),
    })),
  };
}

function readSnapshot(name) {
  const filePath = path.join(snapshotDir, `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeSnapshot(name, value) {
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

async function assertScenarioSnapshot(name, payload, weatherCodes = {}) {
  global.fetch = createStableScenarioFetch(weatherCodes);
  const actual = normalizeScenarioResult(await generateRecommendations(payload));

  if (shouldUpdateSnapshots) {
    writeSnapshot(name, actual);
    return;
  }

  const expected = readSnapshot(name);
  assert.deepStrictEqual(actual, expected);
}

const scenarioMatrix = [
  {
    name: "auto-open-party-arc",
    payload: {
      dates: ["2026-04-19"],
      start: { type: "auto" },
      end: { type: "auto" },
      walkingKmTarget: 14,
      preferences: ["öl", "vin", "hidden gems", "nattliv", "kväll", "party"],
      optimizerMode: "bar-hop",
      modifier: "party",
      distanceMode: "no_limit",
    },
  },
  {
    name: "manual-garbatella-testaccio-lowkey",
    payload: {
      dates: ["2026-04-19"],
      start: { type: "preset", label: "Garbatella" },
      end: { type: "preset", label: "Testaccio" },
      walkingKmTarget: 7,
      preferences: ["vin", "mat", "hidden gems", "low-key"],
      modifier: "low_key",
    },
  },
  {
    name: "manual-monti-loop-wine",
    payload: {
      dates: ["2026-04-18"],
      start: { type: "preset", label: "Monti" },
      end: { type: "preset", label: "Monti" },
      walkingKmTarget: 7,
      preferences: ["vin", "mat", "hidden gems"],
      optimizerMode: "wine-crawl",
    },
    weatherCodes: {
      "2026-04-18": 0,
    },
  },
  {
    name: "manual-trastevere-monti-barhop",
    payload: {
      dates: ["2026-04-18"],
      start: { type: "preset", label: "Trastevere" },
      end: { type: "preset", label: "Monti" },
      walkingKmTarget: 8,
      preferences: ["öl", "vin", "hidden gems", "nattliv", "kväll"],
      optimizerMode: "bar-hop",
    },
    weatherCodes: {
      "2026-04-18": 0,
    },
  },
];

test.after(() => {
  global.fetch = originalFetch;
});

test.afterEach(() => {
  resetLiveEventsCache();
});

scenarioMatrix.forEach(({ name, payload, weatherCodes }) => {
  test(`scenario snapshot: ${name}`, async () => {
    await assertScenarioSnapshot(name, payload, weatherCodes);
  });
});
