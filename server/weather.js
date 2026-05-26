const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const STALE_TTL_MS = 6 * 60 * 60 * 1000;

let cache = new Map();
let inFlight = new Map();

function summarizeWeather(code) {
  if ([0, 1].includes(code)) {
    return "sun";
  }

  if ([2, 3, 45, 48].includes(code)) {
    return "clouds";
  }

  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return "rain";
  }

  return "mixed";
}

function assertValidAnchor(anchor) {
  const lat = Number(anchor?.lat);
  const lng = Number(anchor?.lng);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Weather anchor.lat måste vara mellan -90 och 90");
  }

  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error("Weather anchor.lng måste vara mellan -180 och 180");
  }

  return { lat, lng };
}

function toIsoDate(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function normalizeDateWindow(dates) {
  const normalized = Array.isArray(dates)
    ? [...new Set(dates.map(toIsoDate).filter(Boolean))].sort()
    : [];

  return {
    dates: normalized,
    startDate: normalized[0] || null,
    endDate: normalized[normalized.length - 1] || null,
  };
}

function normalizeTimezone(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "UTC";
}

function cacheCoord(value) {
  return Number(value).toFixed(4);
}

function buildCacheKey({ anchor, timezone, startDate, endDate }) {
  return [cacheCoord(anchor.lat), cacheCoord(anchor.lng), timezone, startDate, endDate].join("|");
}

function buildWeatherUrl(dates, anchor, options = {}) {
  const weatherAnchor = assertValidAnchor(anchor);
  const dateWindow = normalizeDateWindow(dates);
  if (!dateWindow.dates.length) {
    return null;
  }

  const timezone = normalizeTimezone(options.timezone);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(weatherAnchor.lat));
  url.searchParams.set("longitude", String(weatherAnchor.lng));
  url.searchParams.set(
    "daily",
    [
      "weathercode",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "precipitation_sum",
      "wind_speed_10m_max",
      "uv_index_max",
      "apparent_temperature_max",
    ].join(","),
  );
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("start_date", dateWindow.startDate);
  url.searchParams.set("end_date", dateWindow.endDate);

  return {
    url,
    anchor: weatherAnchor,
    timezone,
    ...dateWindow,
    cacheKey: buildCacheKey({
      anchor: weatherAnchor,
      timezone,
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
    }),
  };
}

async function fetchJsonWithTimeout(url, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Weather failed with status ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function emptyWeatherForDates(dates) {
  return dates.reduce((accumulator, date) => {
    accumulator[date] = null;
    return accumulator;
  }, {});
}

function cloneWeatherResult(result, meta = {}) {
  return Object.fromEntries(
    Object.entries(result || {}).map(([date, weather]) => [
      date,
      weather && typeof weather === "object"
        ? {
            ...weather,
            source: weather.source || "open-meteo",
            fetched_at: meta.fetchedAt || weather.fetched_at || null,
            stale: Boolean(meta.stale),
            confidence: meta.confidence || weather.confidence || "medium",
          }
        : weather,
    ]),
  );
}

function readWeatherCode(daily = {}, index) {
  const weatherCodes = daily.weathercode || daily.weather_code || [];
  return weatherCodes[index];
}

function normalizeWeatherPayload(payload, requestedDates, fetchedAt) {
  const result = {};
  const daily = payload?.daily || {};
  const times = daily.time || [];
  const maxTemps = daily.temperature_2m_max || [];
  const minTemps = daily.temperature_2m_min || [];
  const precipProbability = daily.precipitation_probability_max || [];
  const precipSum = daily.precipitation_sum || [];
  const windMax = daily.wind_speed_10m_max || [];
  const uvMax = daily.uv_index_max || [];
  const apparentMax = daily.apparent_temperature_max || [];
  const current = payload?.current || {};
  const dateSet = new Set(requestedDates);

  times.forEach((date, index) => {
    if (!dateSet.has(date)) {
      return;
    }

    const code = readWeatherCode(daily, index);
    const temp = maxTemps[index];
    const minTemp = minTemps[index];
    const apparentTemp = apparentMax[index];
    const precipitationProbabilityMax = precipProbability[index];
    const precipitationSum = precipSum[index];
    const windSpeedMax = windMax[index];
    const uvIndexMax = uvMax[index];

    result[date] = {
      condition: summarizeWeather(code),
      maxTemp: temp,
      minTemp,
      hot: typeof temp === "number" && temp >= 30,
      pleasant: typeof temp === "number" && temp >= 18 && temp < 30,
      rawCode: code,
      currentTemp: typeof current.temperature_2m === "number" ? current.temperature_2m : null,
      currentCode: typeof current.weather_code === "number" ? current.weather_code : null,
      isDay: typeof current.is_day === "number" ? current.is_day === 1 : null,
      precipitationProbabilityMax:
        typeof precipitationProbabilityMax === "number" ? precipitationProbabilityMax : null,
      precipitationSum: typeof precipitationSum === "number" ? precipitationSum : null,
      windSpeedMax: typeof windSpeedMax === "number" ? windSpeedMax : null,
      uvIndexMax: typeof uvIndexMax === "number" ? uvIndexMax : null,
      apparentTempMax: typeof apparentTemp === "number" ? apparentTemp : null,
      source: "open-meteo",
      fetched_at: fetchedAt,
      stale: false,
      confidence: "medium",
    };
  });

  return result;
}

async function fetchWeatherForDates(dates, anchor, options = {}) {
  const request = buildWeatherUrl(dates, anchor, options);
  if (!request) {
    return {};
  }

  const now = Date.now();
  const cached = cache.get(request.cacheKey);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cloneWeatherResult(cached.items, {
      fetchedAt: cached.fetchedAtIso,
      stale: false,
      confidence: "medium",
    });
  }

  if (inFlight.has(request.cacheKey)) {
    return inFlight.get(request.cacheKey);
  }

  const fetcher = options.fetchWeatherJson || fetchJsonWithTimeout;
  const promise = (async () => {
    try {
      const payload = await fetcher(request.url, { timeoutMs: options.timeoutMs });
      const fetchedAt = new Date().toISOString();
      const items = normalizeWeatherPayload(payload, request.dates, fetchedAt);
      cache.set(request.cacheKey, {
        fetchedAt: Date.now(),
        fetchedAtIso: fetchedAt,
        items,
      });
      return cloneWeatherResult(items, { fetchedAt, stale: false, confidence: "medium" });
    } catch (_error) {
      if (cached && now - cached.fetchedAt < STALE_TTL_MS) {
        return cloneWeatherResult(cached.items, {
          fetchedAt: cached.fetchedAtIso,
          stale: true,
          confidence: "stale",
        });
      }

      return emptyWeatherForDates(request.dates);
    } finally {
      inFlight.delete(request.cacheKey);
    }
  })();

  inFlight.set(request.cacheKey, promise);
  return promise;
}

function resetWeatherCache() {
  cache = new Map();
  inFlight = new Map();
}

module.exports = {
  buildWeatherUrl,
  fetchWeatherForDates,
  resetWeatherCache,
  summarizeWeather,
};
