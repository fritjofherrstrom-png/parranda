const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { generateRecommendations } = require("../server/route-engine");
const { resetLiveEventsCache } = require("../server/live-events");

const originalFetch = global.fetch;
const scenariosRoot = path.join(__dirname, "scenarios");
const shouldUpdateSnapshots = process.env.PARRANDA_UPDATE_SCENARIOS === "1";

function snapshotDirForCity(city) {
  return path.join(scenariosRoot, city);
}

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

    if (parsed.hostname === "www.turismoroma.it" || parsed.hostname === "opendata-ajuntament.barcelona.cat" || parsed.hostname === "agenda.cultura.gencat.cat") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return "<div></div>";
        },
        async json() {
          return { result: { records: [] }, items: [] };
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

function normalizePrimaryRoute(route) {
  if (!route) {
    return null;
  }
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

function readSnapshot(city, name) {
  const filePath = path.join(snapshotDirForCity(city), `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeSnapshot(city, name, value) {
  const dir = snapshotDirForCity(city);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

async function assertScenarioSnapshot(city, name, payload, weatherCodes = {}) {
  global.fetch = createStableScenarioFetch(weatherCodes);
  const actual = normalizeScenarioResult(await generateRecommendations(payload));

  if (shouldUpdateSnapshots) {
    writeSnapshot(city, name, actual);
    return;
  }

  const expected = readSnapshot(city, name);
  assert.deepStrictEqual(actual, expected);
}

const scenarioMatrix = [
  {
    city: "rome",
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
    city: "rome",
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
    city: "rome",
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
    city: "rome",
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
  // Barcelona scenarios — locked here so catalog-depth and route-diversity
  // changes show up as explicit snapshot diffs instead of silent Planner
  // behavior shifts. The second-hand snapshots now prove new vintage density
  // is reachable through the existing shared route path, while the five-day
  // stress case still captures a known limitation: long repeated vintage
  // requests can eventually drift into a non-vintage template once the current
  // route-template set runs out of strong second-hand variants.
  {
    city: "barcelona",
    name: "auto-second-hand-multi-day",
    payload: {
      city: "barcelona",
      dates: ["2026-05-23", "2026-05-24", "2026-05-25"],
      start: { type: "auto" },
      end: { type: "auto" },
      walkingKmTarget: 6,
      preferences: ["vintage", "shopping", "lokalt"],
      legPacing: "balanced",
      distanceMode: "soft_target",
      budgetTier: "standard",
      lang: "en",
    },
  },
  {
    city: "barcelona",
    name: "auto-second-hand-five-day-stress",
    payload: {
      city: "barcelona",
      dates: [
        "2026-05-23",
        "2026-05-24",
        "2026-05-25",
        "2026-05-26",
        "2026-05-27",
      ],
      start: { type: "auto" },
      end: { type: "auto" },
      walkingKmTarget: 6,
      preferences: ["vintage", "shopping", "lokalt"],
      legPacing: "balanced",
      distanceMode: "soft_target",
      budgetTier: "standard",
      lang: "en",
    },
  },
  {
    city: "barcelona",
    name: "manual-raval-vintage-loop",
    payload: {
      city: "barcelona",
      dates: ["2026-05-26"],
      start: { type: "auto" },
      end: { type: "auto" },
      walkingKmTarget: 5,
      preferences: ["vintage", "second_hand", "shopping"],
      legPacing: "balanced",
      distanceMode: "soft_target",
      budgetTier: "standard",
      lang: "en",
    },
  },
  // Athens thin-citypack compose — Athens is a registered preview city with
  // real catalog items but 0 curated route templates. This snapshot locks the
  // agnostic-compose shape: a low-confidence loop built ENTIRELY from Athens
  // catalog items (routing_source "agnostic_compose"), never a fallback city's
  // geography. The first time real route templates are added it should flip to
  // template-driven routing and surface here as a clear diff.
  {
    city: "athens",
    name: "preview-zero-state",
    payload: {
      city: "athens",
      dates: ["2026-05-25"],
      start: { type: "auto" },
      end: { type: "auto" },
      walkingKmTarget: 7,
      preferences: ["kultur", "mat", "kväll"],
      legPacing: "balanced",
      distanceMode: "soft_target",
      budgetTier: "standard",
      lang: "en",
    },
  },
  {
    city: "barcelona",
    name: "manual-gracia-sant-antoni-arc",
    payload: {
      city: "barcelona",
      dates: ["2026-05-27"],
      start: { type: "preset", label: "Gràcia" },
      end: { type: "preset", label: "Sant Antoni" },
      walkingKmTarget: 7,
      preferences: ["mat", "vin", "aperitivo", "lokalt"],
      legPacing: "balanced",
      distanceMode: "soft_target",
      budgetTier: "standard",
      lang: "en",
    },
  },
];

test.after(() => {
  global.fetch = originalFetch;
});

test.afterEach(() => {
  resetLiveEventsCache();
});

scenarioMatrix.forEach(({ city, name, payload, weatherCodes }) => {
  test(`scenario snapshot: ${city}/${name}`, async () => {
    await assertScenarioSnapshot(city, name, payload, weatherCodes);
  });
});
