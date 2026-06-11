const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildWeatherUrl,
  fetchWeatherForDates,
  resetWeatherCache,
  summarizeWeather,
} = require("../server/weather");

const ANCHOR = { lat: 41.3874, lng: 2.1686 };

function weatherPayload(date, overrides = {}) {
  return {
    ...(overrides.timezone ? { timezone: overrides.timezone } : {}),
    ...(Number.isFinite(overrides.utcOffsetSeconds)
      ? { utc_offset_seconds: overrides.utcOffsetSeconds }
      : {}),
    ...(overrides.timezoneAbbreviation
      ? { timezone_abbreviation: overrides.timezoneAbbreviation }
      : {}),
    daily: {
      time: [date],
      weathercode: [overrides.code ?? 1],
      temperature_2m_max: [overrides.maxTemp ?? 24],
      temperature_2m_min: [overrides.minTemp ?? 16],
      precipitation_probability_max: [overrides.precipProbability ?? 20],
      precipitation_sum: [overrides.precipitationSum ?? 0],
      wind_speed_10m_max: [overrides.windSpeed ?? 11],
      uv_index_max: [overrides.uvIndex ?? 6],
      apparent_temperature_max: [overrides.apparentTemp ?? 25],
    },
    current: {
      temperature_2m: overrides.currentTemp ?? 21,
      weather_code: overrides.currentCode ?? 1,
      is_day: 1,
    },
  };
}

test.afterEach(() => {
  resetWeatherCache();
});

test("summarizeWeather keeps coarse weather buckets stable", () => {
  assert.equal(summarizeWeather(0), "sun");
  assert.equal(summarizeWeather(3), "clouds");
  assert.equal(summarizeWeather(61), "rain");
  assert.equal(summarizeWeather(95), "mixed");
});

test("buildWeatherUrl sorts dates and includes richer Open-Meteo fields", () => {
  const request = buildWeatherUrl(["2027-06-16", "2027-06-14", "bad-date"], ANCHOR, {
    timezone: "Europe/Madrid",
  });

  assert.equal(request.startDate, "2027-06-14");
  assert.equal(request.endDate, "2027-06-16");
  assert.equal(request.timezone, "Europe/Madrid");
  assert.equal(request.url.searchParams.get("start_date"), "2027-06-14");
  assert.equal(request.url.searchParams.get("end_date"), "2027-06-16");
  assert.match(request.url.searchParams.get("daily"), /precipitation_probability_max/);
  assert.match(request.url.searchParams.get("daily"), /wind_speed_10m_max/);
  assert.match(request.url.searchParams.get("daily"), /uv_index_max/);
});

test("buildWeatherUrl uses Open-Meteo auto timezone when no explicit timezone is passed", () => {
  const request = buildWeatherUrl(["2027-06-14"], ANCHOR);

  assert.equal(request.timezone, "auto");
  assert.equal(request.timezoneMode, "auto");
  assert.equal(request.url.searchParams.get("timezone"), "auto");
});

test("buildWeatherUrl keeps explicit timezone path explicit", () => {
  const request = buildWeatherUrl(["2027-06-14"], ANCHOR, {
    timezone: "Europe/Madrid",
  });

  assert.equal(request.timezone, "Europe/Madrid");
  assert.equal(request.timezoneMode, "explicit");
  assert.equal(request.url.searchParams.get("timezone"), "Europe/Madrid");
});

test("fetchWeatherForDates returns safe empty object for empty/invalid date input", async () => {
  assert.deepEqual(await fetchWeatherForDates([], ANCHOR), {});
  assert.deepEqual(await fetchWeatherForDates(null, ANCHOR), {});
  assert.deepEqual(await fetchWeatherForDates(["not-a-date"], ANCHOR), {});
});

test("fetchWeatherForDates still validates anchor when dates are usable", async () => {
  await assert.rejects(
    () => fetchWeatherForDates(["2027-06-14"], { lat: 200, lng: 2 }),
    /Weather anchor\.lat/,
  );
});

test("fetchWeatherForDates normalizes richer weather metadata", async () => {
  const result = await fetchWeatherForDates(["2027-06-14"], ANCHOR, {
    timezone: "Europe/Madrid",
    fetchWeatherJson: async () => weatherPayload("2027-06-14", { code: 61, precipProbability: 80 }),
  });

  assert.equal(result["2027-06-14"].condition, "rain");
  assert.equal(result["2027-06-14"].maxTemp, 24);
  assert.equal(result["2027-06-14"].precipitationProbabilityMax, 80);
  assert.equal(result["2027-06-14"].source, "open-meteo");
  assert.equal(result["2027-06-14"].stale, false);
  assert.equal(result["2027-06-14"].confidence, "medium");
});

test("fetchWeatherForDates preserves valid auto timezone metadata on date weather", async () => {
  const result = await fetchWeatherForDates(["2027-06-14"], ANCHOR, {
    fetchWeatherJson: async (url) => {
      assert.equal(url.searchParams.get("timezone"), "auto");
      return weatherPayload("2027-06-14", {
        timezone: "Europe/Athens",
        utcOffsetSeconds: 10800,
        timezoneAbbreviation: "EEST",
      });
    },
  });

  assert.deepEqual(result["2027-06-14"].timezone_resolution, {
    timezone: "Europe/Athens",
    timezone_source: "weather_provider_auto",
    utc_offset_seconds: 10800,
    timezone_abbreviation: "EEST",
  });
});

test("fetchWeatherForDates ignores invalid or missing auto timezone metadata", async () => {
  const invalid = await fetchWeatherForDates(["2027-06-14"], ANCHOR, {
    fetchWeatherJson: async () => weatherPayload("2027-06-14", { timezone: "Not/AZone" }),
  });
  assert.equal(invalid["2027-06-14"].timezone_resolution, undefined);

  resetWeatherCache();
  const missing = await fetchWeatherForDates(["2027-06-14"], ANCHOR, {
    fetchWeatherJson: async () => weatherPayload("2027-06-14"),
  });
  assert.equal(missing["2027-06-14"].timezone_resolution, undefined);
});

test("fetchWeatherForDates explicit timezone path does not attach auto metadata", async () => {
  const result = await fetchWeatherForDates(["2027-06-14"], ANCHOR, {
    timezone: "Europe/Madrid",
    fetchWeatherJson: async (url) => {
      assert.equal(url.searchParams.get("timezone"), "Europe/Madrid");
      return weatherPayload("2027-06-14", { timezone: "Europe/Madrid" });
    },
  });

  assert.equal(result["2027-06-14"].timezone_resolution, undefined);
});

test("fetchWeatherForDates caches same anchor/timezone/date window", async () => {
  let calls = 0;
  const context = {
    timezone: "Europe/Madrid",
    fetchWeatherJson: async () => {
      calls += 1;
      return weatherPayload("2027-06-14");
    },
  };

  await fetchWeatherForDates(["2027-06-14"], ANCHOR, context);
  await fetchWeatherForDates(["2027-06-14"], ANCHOR, context);

  assert.equal(calls, 1);
});

test("different date windows fetch independently", async () => {
  let calls = 0;
  const context = {
    timezone: "Europe/Madrid",
    fetchWeatherJson: async () => {
      calls += 1;
      return calls === 1 ? weatherPayload("2027-06-14") : weatherPayload("2027-06-20");
    },
  };

  const first = await fetchWeatherForDates(["2027-06-14"], ANCHOR, context);
  const second = await fetchWeatherForDates(["2027-06-20"], ANCHOR, context);

  assert.equal(calls, 2);
  assert.equal(first["2027-06-14"].maxTemp, 24);
  assert.equal(second["2027-06-20"].maxTemp, 24);
});

test("concurrent different date windows do not share in-flight promise", async () => {
  let calls = 0;
  const context = {
    timezone: "Europe/Madrid",
    fetchWeatherJson: async () => {
      calls += 1;
      return calls === 1
        ? weatherPayload("2027-07-01", { maxTemp: 26 })
        : weatherPayload("2027-07-10", { maxTemp: 31 });
    },
  };

  const [a, b] = await Promise.all([
    fetchWeatherForDates(["2027-07-01"], ANCHOR, context),
    fetchWeatherForDates(["2027-07-10"], ANCHOR, context),
  ]);

  assert.equal(calls, 2);
  assert.equal(a["2027-07-01"].maxTemp, 26);
  assert.equal(b["2027-07-10"].maxTemp, 31);
});

test("provider failure returns safe null buckets without cached data", async () => {
  const result = await fetchWeatherForDates(["2027-06-14"], ANCHOR, {
    timezone: "Europe/Madrid",
    fetchWeatherJson: async () => {
      throw new Error("provider down");
    },
  });

  assert.deepEqual(result, { "2027-06-14": null });
});

test("fresh cached weather returns without provider refetch", async () => {
  let calls = 0;
  await fetchWeatherForDates(["2027-06-14"], ANCHOR, {
    timezone: "Europe/Madrid",
    fetchWeatherJson: async () => {
      calls += 1;
      return weatherPayload("2027-06-14", { maxTemp: 28 });
    },
  });

  const result = await fetchWeatherForDates(["2027-06-14"], ANCHOR, {
    timezone: "Europe/Madrid",
    fetchWeatherJson: async () => {
      calls += 1;
      throw new Error("provider down");
    },
  });

  assert.equal(calls, 1);
  assert.equal(result["2027-06-14"].maxTemp, 28);
  assert.equal(result["2027-06-14"].stale, false);
});
