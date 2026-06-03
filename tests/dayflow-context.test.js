const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDayflowContext,
  KIND_TO_LEAN,
  LIVE_PROXIMITY_KM,
} = require("../server/planner/dayflow-context");
const { generateRecommendations } = require("../server/route-engine");
const romeCity = require("../server/cities/rome");

const CITY = { key: "rome", center: { lat: 41.9, lng: 12.5 } };
const DATE = "2026-07-20";

const BORING = {
  condition: "clouds",
  maxTemp: 21,
  minTemp: 14,
  apparentTempMax: 20,
  precipitationProbabilityMax: 10,
  precipitationSum: 0,
  windSpeedMax: 12,
  uvIndexMax: 4,
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

const ROUTE = { id: "route-abc", title: "Trastevere loop" };

function liveEvent(overrides = {}) {
  return {
    title: "Jazz at Monk",
    venue: "Monk Roma",
    best_route_id: ROUTE.id,
    route_distance_km: 0.3,
    source_id: "rome-some-feed",
    source_label: "Some Feed",
    source_confidence: "medium",
    ...overrides,
  };
}

// --- Boring weather stays silent ---------------------------------------------

test("boring weather with no live events yields null (no dayflow noise)", () => {
  const ctx = buildDayflowContext({
    weather: BORING,
    liveEvents: [],
    primaryRoute: ROUTE,
    date: DATE,
    cityConfig: CITY,
    lang: "en",
  });
  assert.equal(ctx, null);
});

test("no weather and no live events yields null", () => {
  assert.equal(
    buildDayflowContext({ weather: null, liveEvents: [], primaryRoute: ROUTE, date: DATE, cityConfig: CITY, lang: "en" }),
    null,
  );
});

// --- Meaningful weather → explained lean + provenance ------------------------

test("meaningful weather produces a lean, headline, and source provenance", () => {
  const cases = [
    [RAIN, "rain", "indoor"],
    [HEAT, "heat", "shaded"],
    [WIND, "wind", "sheltered"],
    [OUTDOOR, "outdoor_window", "outdoor"],
  ];
  for (const [weather, kind, lean] of cases) {
    const ctx = buildDayflowContext({
      weather,
      liveEvents: [],
      primaryRoute: ROUTE,
      date: DATE,
      cityConfig: CITY,
      lang: "en",
    });
    assert.ok(ctx, `${kind} should produce a dayflow context`);
    assert.equal(ctx.lean, lean, `${kind} → lean ${lean}`);
    assert.equal(ctx.weather.kind, kind);
    assert.ok(ctx.weather.headline && ctx.weather.headline.length > 0);
    assert.ok(ctx.weather.reason && ctx.weather.reason.length > 0);
    assert.deepEqual(ctx.reasons, [`weather_${kind}`]);

    // Provenance is preserved for trust/debugging.
    const prov = ctx.weather.provenance;
    assert.equal(prov.provider_id, "generic-open-meteo-weather");
    assert.equal(prov.role, "weather_context");
    assert.equal(prov.signal_type, "weather_shift");
    assert.equal(prov.signal_kind, kind);
    assert.equal(prov.source, "open-meteo");
    assert.ok(prov.observed, "provenance carries the observed conditions");

    // Weather is context, never a place: no coordinates anywhere in the read.
    assert.equal(ctx.weather.lat, undefined);
    assert.equal(ctx.weather.lng, undefined);
    assert.ok(!("venue" in ctx.weather));
  }
});

test("KIND_TO_LEAN covers every interpreter signal kind", () => {
  for (const kind of ["rain", "heat", "cold", "wind", "outdoor_window"]) {
    assert.ok(KIND_TO_LEAN[kind], `lean defined for ${kind}`);
  }
});

test("dayflow weather copy is localized for sv and en", () => {
  const en = buildDayflowContext({ weather: RAIN, liveEvents: [], primaryRoute: ROUTE, date: DATE, cityConfig: CITY, lang: "en" });
  const sv = buildDayflowContext({ weather: RAIN, liveEvents: [], primaryRoute: ROUTE, date: DATE, cityConfig: CITY, lang: "sv" });
  assert.notEqual(en.weather.headline, sv.weather.headline);
  assert.match(en.weather.headline, /rain/i);
  assert.match(sv.weather.headline, /regn/i);
});

// --- Live context only when route-proximate and trustworthy ------------------

test("a route-proximate live event is surfaced as live context", () => {
  const ctx = buildDayflowContext({
    weather: BORING, // boring weather → weather read is null
    liveEvents: [liveEvent({ route_distance_km: 0.25 })],
    primaryRoute: ROUTE,
    date: DATE,
    cityConfig: CITY,
    lang: "en",
  });
  assert.ok(ctx, "a proximate live event alone should produce context");
  assert.equal(ctx.weather, null, "boring weather stays silent");
  assert.ok(ctx.live, "live read present");
  assert.equal(ctx.live.count, 1);
  assert.equal(ctx.live.nearest.title, "Jazz at Monk");
  assert.equal(ctx.live.nearest.source_id, "rome-some-feed");
  assert.deepEqual(ctx.reasons, ["route_proximate_live_event"]);
});

test("a far live event is NOT used as context", () => {
  const ctx = buildDayflowContext({
    weather: BORING,
    liveEvents: [liveEvent({ route_distance_km: LIVE_PROXIMITY_KM + 0.5 })],
    primaryRoute: ROUTE,
    date: DATE,
    cityConfig: CITY,
    lang: "en",
  });
  assert.equal(ctx, null, "a distant event must not create dayflow context");
});

test("a live event bound to a different route is NOT used", () => {
  const ctx = buildDayflowContext({
    weather: BORING,
    liveEvents: [liveEvent({ best_route_id: "some-other-route" })],
    primaryRoute: ROUTE,
    date: DATE,
    cityConfig: CITY,
    lang: "en",
  });
  assert.equal(ctx, null);
});

test("a live event without a finite distance (URL/place only) is NOT used", () => {
  const ctx = buildDayflowContext({
    weather: BORING,
    liveEvents: [liveEvent({ route_distance_km: null })],
    primaryRoute: ROUTE,
    date: DATE,
    cityConfig: CITY,
    lang: "en",
  });
  assert.equal(ctx, null, "no finite proximity → not trustworthy route context");
});

test("live context requires a primary route (no route → no live read)", () => {
  const ctx = buildDayflowContext({
    weather: BORING,
    liveEvents: [liveEvent()],
    primaryRoute: null,
    date: DATE,
    cityConfig: CITY,
    lang: "en",
  });
  assert.equal(ctx, null);
});

// --- Weather + live combine -------------------------------------------------

test("meaningful weather and a proximate live event combine into one read", () => {
  const ctx = buildDayflowContext({
    weather: RAIN,
    liveEvents: [liveEvent({ route_distance_km: 0.2 })],
    primaryRoute: ROUTE,
    date: DATE,
    cityConfig: CITY,
    lang: "en",
  });
  assert.ok(ctx);
  assert.equal(ctx.lean, "indoor");
  assert.ok(ctx.weather);
  assert.ok(ctx.live);
  assert.deepEqual(ctx.reasons, ["weather_rain", "route_proximate_live_event"]);
  // Headline leads with the weather read (the stronger dayflow driver).
  assert.equal(ctx.headline, ctx.weather.headline);
});

// --- Weather-only day with no route (extreme weather still explains) ---------

test("meaningful weather with no route still explains the day (weather-only)", () => {
  const ctx = buildDayflowContext({
    weather: HEAT,
    liveEvents: [],
    primaryRoute: null,
    date: DATE,
    cityConfig: CITY,
    lang: "en",
  });
  assert.ok(ctx);
  assert.equal(ctx.lean, "shaded");
  assert.equal(ctx.live, null);
});

// --- Integration: dayflow_context reaches the day in generateRecommendations -

function withInjectedWeather(weatherByDate) {
  // Preserve the original fetcher so test order doesn't pollute later tests.
  const original = romeCity.services.fetchWeatherForDates;
  romeCity.services.fetchWeatherForDates = async (dates) =>
    Object.fromEntries(dates.map((date) => [date, weatherByDate[date] ?? null]));
  return () => {
    romeCity.services.fetchWeatherForDates = original;
  };
}

function quietFetch() {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, async json() { return {}; }, async text() { return ""; } });
  return () => {
    global.fetch = original;
  };
}

const ROUTE_PAYLOAD = {
  city: "rome",
  dates: [DATE],
  start: { type: "preset", label: "Trastevere" },
  end: { type: "preset", label: "Monti" },
  walkingKmTarget: 8,
  preferences: ["mat", "kultur"],
  lang: "en",
};

test("integration: rain weather attaches dayflow_context to the day with provenance", async () => {
  const restoreWeather = withInjectedWeather({ [DATE]: RAIN });
  const restoreFetch = quietFetch();
  try {
    const result = await generateRecommendations(ROUTE_PAYLOAD);
    const day = result.days[0];
    assert.ok(day.dayflow_context, "rain day must carry a dayflow_context");
    assert.equal(day.dayflow_context.lean, "indoor");
    assert.equal(day.dayflow_context.weather.kind, "rain");
    assert.equal(day.dayflow_context.weather.provenance.provider_id, "generic-open-meteo-weather");
    assert.equal(day.dayflow_context.weather.provenance.signal_type, "weather_shift");
    assert.equal(day.dayflow_context.weather.provenance.observed.precipitation_probability_max, 80);
  } finally {
    restoreWeather();
    restoreFetch();
  }
});

test("integration: boring weather attaches no dayflow_context (silence)", async () => {
  const restoreWeather = withInjectedWeather({ [DATE]: BORING });
  const restoreFetch = quietFetch();
  try {
    const result = await generateRecommendations(ROUTE_PAYLOAD);
    const day = result.days[0];
    assert.equal(day.dayflow_context, null, "boring weather → no dayflow_context");
  } finally {
    restoreWeather();
    restoreFetch();
  }
});

test("integration: heat weather → shaded lean", async () => {
  const restoreWeather = withInjectedWeather({ [DATE]: HEAT });
  const restoreFetch = quietFetch();
  try {
    const result = await generateRecommendations(ROUTE_PAYLOAD);
    const day = result.days[0];
    assert.ok(day.dayflow_context);
    assert.equal(day.dayflow_context.lean, "shaded");
    assert.equal(day.dayflow_context.weather.kind, "heat");
  } finally {
    restoreWeather();
    restoreFetch();
  }
});

test("integration: weather context never becomes a stop / place / live event in the day output", async () => {
  const restoreWeather = withInjectedWeather({ [DATE]: RAIN });
  const restoreFetch = quietFetch();
  try {
    const result = await generateRecommendations(ROUTE_PAYLOAD);
    const day = result.days[0];
    // No main_stop or live_event matches the dayflow weather kind/title.
    const weatherTitle = day.dayflow_context.weather.headline;
    const mainStopTitles = (day.primary_route?.main_stops || []).map((s) => s.label || s.name || "");
    assert.ok(
      !mainStopTitles.includes(weatherTitle),
      "weather headline must not appear as a route stop",
    );
    const liveTitles = (day.live_events || []).map((e) => e.title || "");
    assert.ok(
      !liveTitles.includes(weatherTitle),
      "weather headline must not appear as a live event",
    );
    // The route engine's existing weather_note may still apply (additive change).
  } finally {
    restoreWeather();
    restoreFetch();
  }
});
