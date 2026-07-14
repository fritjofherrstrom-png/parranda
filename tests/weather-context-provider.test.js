const assert = require("node:assert/strict");
const test = require("node:test");

const { buildCityPulse } = require("../server/pulse-engine");
const {
  WEATHER_CONTEXT_PROVIDER_ID,
  createWeatherContextProvider,
  interpretWeatherForDayflow,
  collectPulseSourcesForCity,
  buildSourceProviderInspect,
} = require("../server/pulse-sources");
const { GENERIC_PROVIDER_CITY } = require("../server/pulse-sources/provider-registry");
const { resetWeatherCache } = require("../server/weather");

const romeCity = require("../server/cities/rome");
const barcelonaCity = require("../server/cities/barcelona");
const athensCity = require("../server/cities/athens");

// --- Helpers -----------------------------------------------------------------

const BORING = {
  condition: "clouds",
  maxTemp: 17,
  minTemp: 12,
  apparentTempMax: 16,
  precipitationProbabilityMax: 10,
  precipitationSum: 0,
  windSpeedMax: 12,
  uvIndexMax: 3,
  source: "open-meteo",
  stale: false,
};

const RAIN = {
  condition: "rain",
  maxTemp: 14,
  minTemp: 9,
  apparentTempMax: 12,
  precipitationProbabilityMax: 80,
  precipitationSum: 6,
  windSpeedMax: 18,
  uvIndexMax: 1,
  source: "open-meteo",
  stale: false,
};

const HEAT = {
  condition: "sun",
  maxTemp: 35,
  minTemp: 26,
  apparentTempMax: 38,
  precipitationProbabilityMax: 0,
  precipitationSum: 0,
  windSpeedMax: 10,
  uvIndexMax: 9,
  source: "open-meteo",
  stale: false,
};

const WIND = {
  condition: "clouds",
  maxTemp: 19,
  minTemp: 13,
  apparentTempMax: 18,
  precipitationProbabilityMax: 15,
  precipitationSum: 0,
  windSpeedMax: 46,
  uvIndexMax: 4,
  source: "open-meteo",
  stale: false,
};

const OUTDOOR = {
  condition: "sun",
  maxTemp: 24,
  minTemp: 16,
  apparentTempMax: 24,
  precipitationProbabilityMax: 5,
  precipitationSum: 0,
  windSpeedMax: 12,
  uvIndexMax: 6,
  source: "open-meteo",
  stale: false,
};

function cityWithWeather(city, weatherForDate, { fail = false } = {}) {
  return {
    ...city,
    services: {
      ...city.services,
      fetchWeatherForDates: async (dates = []) => {
        if (fail) throw new Error("weather network boom");
        return Object.fromEntries(dates.map((date) => [date, weatherForDate]));
      },
      // Keep other sources quiet so assertions isolate weather behavior.
      fetchLiveEventsForDates: async (dates = []) =>
        Object.fromEntries(dates.map((date) => [date, []])),
    },
  };
}

function weatherSignalsOf(pulse) {
  return (pulse.signals || []).filter((signal) => signal.type === "weather_shift");
}

const DATE = "2026-07-20";
const NOW = new Date("2026-07-20T09:00:00Z");

// --- Pure interpreter: boring stays silent, meaningful speaks ----------------

test("interpretWeatherForDayflow returns null for boring, normal weather", () => {
  assert.equal(interpretWeatherForDayflow(BORING, { date: DATE, cityConfig: { key: "rome" }, lang: "en" }), null);
  assert.equal(interpretWeatherForDayflow(null, { date: DATE, cityConfig: { key: "rome" }, lang: "en" }), null);
  assert.equal(interpretWeatherForDayflow({}, { date: DATE, cityConfig: { key: "rome" }, lang: "en" }), null);
});

test("interpretWeatherForDayflow surfaces meaningful weather as a weather_shift signal", () => {
  for (const [label, weather, kind] of [
    ["rain", RAIN, "rain"],
    ["heat", HEAT, "heat"],
    ["wind", WIND, "wind"],
    ["outdoor", OUTDOOR, "outdoor_window"],
  ]) {
    const signal = interpretWeatherForDayflow(weather, { date: DATE, cityConfig: { key: "rome" }, lang: "en" });
    assert.ok(signal, `${label} should produce a signal`);
    assert.equal(signal.type, "weather_shift");
    assert.equal(signal.parranda_owned.signal_kind, kind, `${label} → kind ${kind}`);
    assert.ok(signal.title && signal.title.length > 0, `${label} has a title`);
    assert.ok(signal.reason && signal.reason.length > 0, `${label} explains the dayflow impact`);
    // A weather signal must never carry coordinates or a place.
    assert.equal(signal.lat, undefined);
    assert.equal(signal.lng, undefined);
    assert.equal(signal.venue, undefined);
  }
});

test("interpretWeatherForDayflow localizes copy for sv and en", () => {
  const en = interpretWeatherForDayflow(RAIN, { date: DATE, cityConfig: { key: "rome" }, lang: "en" });
  const sv = interpretWeatherForDayflow(RAIN, { date: DATE, cityConfig: { key: "rome" }, lang: "sv" });
  assert.notEqual(en.title, sv.title);
  assert.match(en.title, /rain/i);
  assert.match(sv.title, /regn/i);
});

// --- Generic across cities ---------------------------------------------------

test("weather provider is generic: same provider produces signals for Rome, Barcelona, and Athens", async () => {
  for (const city of [romeCity, barcelonaCity, athensCity]) {
    const pulse = await buildCityPulse(cityWithWeather(city, HEAT), {
      date: DATE,
      now: NOW,
      lang: "en",
    });
    const weatherSignals = weatherSignalsOf(pulse);
    assert.equal(weatherSignals.length, 1, `${city.key} should produce one weather signal`);
    assert.equal(weatherSignals[0].parranda_owned?.signal_kind || weatherSignals[0].signal_kind, undefined);
    assert.match(weatherSignals[0].title, /heat/i);
    assert.equal(weatherSignals[0].trust_level, "verified");
  }
});

test("weather provider descriptor carries no city-specific branching", () => {
  // The same provider object, collected for different cities, binds to each.
  const provider = createWeatherContextProvider();
  assert.equal(provider.descriptor.id, WEATHER_CONTEXT_PROVIDER_ID);
  assert.equal(provider.descriptor.city, GENERIC_PROVIDER_CITY);
  assert.equal(GENERIC_PROVIDER_CITY, "__generic__");
  const romeBound = provider.create({ key: "rome", center: { lat: 41.9, lng: 12.5 } });
  const athensBound = provider.create({ key: "athens", center: { lat: 37.98, lng: 23.72 } });
  assert.equal(romeBound.descriptor.city, "rome");
  assert.equal(athensBound.descriptor.city, "athens");
});

test("generic provider binds to the collected city with no cross-city leakage", async () => {
  const HEAT_LOCAL = { condition: "sun", maxTemp: 35, apparentTempMax: 38, precipitationProbabilityMax: 0, source: "open-meteo", stale: false };
  for (const key of ["rome", "athens", "barcelona"]) {
    const result = await collectPulseSourcesForCity(
      { key, center: { lat: 1, lng: 1 } },
      {
        providerSpecs: [createWeatherContextProvider()],
        context: {
          date: "2026-07-20",
          dates: ["2026-07-20"],
          lang: "en",
          fetchWeatherForDates: async (dates) => ({ [dates[0]]: HEAT_LOCAL }),
        },
      },
    );
    assert.equal(result.city, key);
    const signal = result.signals[0];
    assert.ok(signal, `${key} produced a signal`);
    // The sentinel city must never leak into the normalized output.
    assert.equal(signal.city, key);
    assert.equal(result.source_status[0].city, key);
    assert.ok(!String(signal.id).includes(GENERIC_PROVIDER_CITY), "signal id must not contain the generic sentinel");
    assert.ok(!String(signal.city).includes(GENERIC_PROVIDER_CITY));
  }
});

test("a non-generic provider whose descriptor city mismatches is still skipped", async () => {
  // The generic escape hatch must not weaken the city gate for real providers.
  const result = await collectPulseSourcesForCity(
    { key: "rome", center: { lat: 1, lng: 1 } },
    {
      providerSpecs: [
        {
          descriptor: {
            id: "barcelona-only-thing",
            label: "BCN only",
            city: "barcelona",
            role: "weather_context",
            sourceType: "weather",
            status: "active",
            intendedUse: "pulse",
            supportedLanguages: ["en"],
            updateCadence: "hourly",
            parsingRisk: "low",
            trust: { source_tier: "verified", confidence: "medium", human_verified: false, freshness: "fresh" },
            cachePolicy: { kind: "memory", ttlSeconds: 60 },
            sourceOwnedFields: ["title"],
          },
          provider: { async collect() { return { events: [], signals: [{ id: "x", title: "leak", type: "weather_shift" }] }; } },
        },
      ],
      context: { date: "2026-07-20", dates: ["2026-07-20"] },
    },
  );
  assert.equal(result.signals.length, 0, "city-mismatched provider must not run");
  assert.equal(result.source_status[0].status, "skipped");
  assert.equal(result.source_status[0].reason, "city_mismatch");
});

test("one city-pulse request makes a single Open-Meteo network call (engine + provider share cache)", async () => {
  resetWeatherCache();
  const originalFetch = global.fetch;
  let httpCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes("api.open-meteo.com")) {
      httpCalls += 1;
      return {
        ok: true,
        async json() {
          return {
            daily: {
              time: [DATE],
              weathercode: [61],
              temperature_2m_max: [14],
              temperature_2m_min: [9],
              precipitation_probability_max: [80],
              precipitation_sum: [6],
              wind_speed_10m_max: [18],
              uv_index_max: [1],
              apparent_temperature_max: [12],
            },
            current: { temperature_2m: 13, weather_code: 61, is_day: 1 },
          };
        },
      };
    }
    return { ok: true, async json() { return {}; }, async text() { return ""; } };
  };

  try {
    // Use the REAL Rome weather service (no injected fetcher) so both the
    // engine's safeFetchWeather and the provider hit server/weather.js.
    const pulse = await buildCityPulse(romeCity, { date: DATE, now: NOW, lang: "en" });
    assert.equal(httpCalls, 1, "engine + weather provider must share one Open-Meteo call");
    assert.equal(weatherSignalsOf(pulse).length, 1, "the shared fetch still produces the rain signal");
  } finally {
    global.fetch = originalFetch;
    resetWeatherCache();
  }
});

// --- Signal threading through the engine --------------------------------------

test("source-backed weather signals are threaded into the ranked Pulse output", async () => {
  const pulse = await buildCityPulse(cityWithWeather(romeCity, RAIN), {
    date: DATE,
    now: NOW,
    lang: "en",
  });
  const weatherSignals = weatherSignalsOf(pulse);
  assert.equal(weatherSignals.length, 1);
  const signal = weatherSignals[0];
  // It passed normalization (trust/freshness/source filled) and quality gating.
  assert.equal(signal.source.kind, "weather");
  assert.equal(signal.freshness, "today");
  assert.equal(signal.trust_level, "verified");
  assert.ok(signal.signal_quality.displayable, "weather signal must be displayable");
  assert.ok(typeof signal.score === "number" && signal.score > 0, "weather signal is ranked");
});

test("ranked weather signal preserves compact source provenance without raw payload leakage", async () => {
  const pulse = await buildCityPulse(cityWithWeather(romeCity, RAIN), {
    date: DATE,
    now: NOW,
    lang: "en",
  });
  const signal = weatherSignalsOf(pulse)[0];
  assert.ok(signal, "expected a ranked weather signal");

  // Provenance rides the ranked signals[] path itself, not only ?inspect=sources.
  const provenance = signal.source_provider_signal;
  assert.ok(provenance, "ranked weather signal must carry source_provider_signal");
  assert.equal(provenance.provider_id, WEATHER_CONTEXT_PROVIDER_ID);
  assert.equal(provenance.role, "weather_context");
  assert.equal(provenance.city, "rome", "provenance city is the bound city, not the generic sentinel");
  assert.equal(provenance.signal_type, "weather_shift");
  assert.equal(provenance.signal_kind, "rain");
  assert.ok(provenance.dayflow_reason && provenance.dayflow_reason.length > 0);

  // The provenance carries the gate proving weather stays Pulse-only.
  assert.equal(provenance.display_gate.may_create_place_candidate, false);
  assert.equal(provenance.display_gate.may_show_as_nearby, false);
  assert.equal(provenance.display_gate.may_influence_routes, false);

  // The generic sentinel must never appear anywhere in the provenance.
  assert.ok(
    !JSON.stringify(provenance).includes(GENERIC_PROVIDER_CITY),
    "generic sentinel must not leak into ranked-signal provenance",
  );
});

// --- Weather never becomes events / place candidates / nearby / routes -------

test("weather signal display gate keeps it as Pulse context only", async () => {
  const pulse = await buildCityPulse(cityWithWeather(barcelonaCity, RAIN), {
    date: DATE,
    now: NOW,
    lang: "en",
    inspectSources: true,
  });
  const row = (pulse.source_provider_inspect.signal_rows || []).find(
    (entry) => entry.signal_type === "weather_shift",
  );
  assert.ok(row, "inspect should include the weather signal row");
  assert.equal(row.display_gate.may_show_in_pulse, true);
  assert.equal(row.display_gate.may_create_place_candidate, false);
  assert.equal(row.display_gate.may_show_as_nearby, false);
  assert.equal(row.display_gate.may_influence_routes, false);
  assert.equal(row.display_gate.may_show_in_live_list, false);
});

test("weather provider produces no events (only signals)", async () => {
  const result = await collectPulseSourcesForCity(
    { key: "rome", center: romeCity.center },
    {
      providerSpecs: [createWeatherContextProvider()],
      context: {
        date: DATE,
        dates: [DATE],
        lang: "en",
        fetchWeatherForDates: async (dates) => ({ [dates[0]]: HEAT }),
      },
    },
  );
  assert.equal(result.events.length, 0, "weather provider must not create events");
  assert.equal(result.signals.length, 1, "weather provider creates exactly one signal");
  assert.equal(result.source_status[0].status, "ok");
  assert.equal(result.source_status[0].events, 0);
  assert.equal(result.source_status[0].signals, 1);
});

// --- Boring weather silence + provider failure fail-safe ---------------------

test("boring weather produces no Pulse signal (no spam)", async () => {
  const pulse = await buildCityPulse(cityWithWeather(romeCity, BORING), {
    date: DATE,
    now: NOW,
    lang: "en",
    inspectSources: true,
  });
  assert.equal(weatherSignalsOf(pulse).length, 0);
  assert.equal(pulse.source_provider_inspect.normalized_signal_count, 0);
  const weatherStatus = pulse.source_status.find((status) => status.id === WEATHER_CONTEXT_PROVIDER_ID);
  assert.equal(weatherStatus.collection_status, "empty");
  assert.equal(weatherStatus.collection_reason, "source_empty");
});

test("weather provider failure is fail-safe and does not break Pulse", async () => {
  const failing = cityWithWeather(romeCity, RAIN, { fail: true });
  const pulse = await buildCityPulse(failing, {
    date: DATE,
    now: NOW,
    lang: "en",
    inspectSources: true,
  });
  // No weather signal, but Pulse still returns a stable shape.
  assert.equal(weatherSignalsOf(pulse).length, 0);
  assert.ok(Array.isArray(pulse.signals), "pulse.signals stays an array");
  assert.ok(Array.isArray(pulse.source_status), "source_status stays an array");
  const weatherStatus = pulse.source_status.find((status) => status.id === WEATHER_CONTEXT_PROVIDER_ID);
  assert.equal(weatherStatus.status, "failed");
  assert.equal(weatherStatus.collection_reason, "source_fetch_failed");
  assert.equal(pulse.city, "rome");
  assert.equal(pulse.date, DATE);
});

// --- Inspect signal summary ---------------------------------------------------

test("inspect mode exposes a capped signal summary without raw payloads", async () => {
  const pulse = await buildCityPulse(cityWithWeather(athensCity, WIND), {
    date: DATE,
    now: NOW,
    lang: "en",
    inspectSources: true,
  });
  const inspect = pulse.source_provider_inspect;
  assert.equal(inspect.normalized_signal_count, 1);
  assert.equal(inspect.returned_signal_rows, 1);
  assert.equal(inspect.truncated_signal_count, 0);
  const row = inspect.signal_rows[0];
  assert.equal(row.signal_type, "weather_shift");
  assert.equal(row.signal_kind, "wind");
  assert.ok(row.dayflow_reason && row.dayflow_reason.length > 0);
  assert.ok(row.confidence);
  // No raw provider payload fields leak through.
  assert.equal(row.raw, undefined);
  assert.equal(row.payload, undefined);
});

test("buildSourceProviderInspect caps signal rows at the documented limit", () => {
  const manySignals = Array.from({ length: 25 }, (_unused, index) => ({
    id: `sig-${index}`,
    signal_type: "weather_shift",
    source_owned: { title: `Signal ${index}` },
    parranda_owned: { signal_kind: "rain", dayflow_reason: "x" },
    display_gate: { may_show_in_pulse: true, reasons: [] },
  }));
  const inspect = buildSourceProviderInspect({
    city: "rome",
    date: DATE,
    normalized_signals: manySignals,
  });
  assert.equal(inspect.normalized_signal_count, 25);
  assert.equal(inspect.returned_signal_rows, 10);
  assert.equal(inspect.truncated_signal_count, 15);
});

// --- Normal city-pulse response remains stable -------------------------------

test("city-pulse response shape is unchanged when the weather provider is silent", async () => {
  const pulse = await buildCityPulse(cityWithWeather(romeCity, BORING), {
    date: DATE,
    now: NOW,
    lang: "en",
  });
  // The canonical top-level keys the API depends on must all still be present.
  for (const key of ["city", "date", "requested_at", "timezone", "lang", "signals", "weather", "events", "source_status"]) {
    assert.ok(key in pulse, `pulse response must include ${key}`);
  }
  assert.equal(pulse.city, "rome");
  assert.ok(Array.isArray(pulse.signals));
});
