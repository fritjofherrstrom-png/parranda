/**
 * Generic weather-context source provider.
 *
 * This is Parranda's first city-AGNOSTIC source provider. Unlike the
 * Barcelona Open Data agenda provider (one city, one official feed), this
 * provider works for any city that exposes a `center` and a
 * `fetchWeatherForDates` service. It proves the source registry can back
 * agnostic intelligence, not just per-city feeds.
 *
 * It produces source-backed SIGNALS, never events. A weather signal carries
 * no coordinates and no known place, so the display-gate layer structurally
 * forbids it from becoming a live event, place candidate, nearby claim, or
 * route stop — it can only show as Pulse context.
 *
 * Product principle: Parranda is not a weather app. Weather matters only when
 * it changes the user's dayflow. The interpreter below stays SILENT on boring,
 * normal weather and emits at most one signal — the single most dayflow-
 * relevant shift — when conditions actually change the plan:
 *
 *   - rain that changes route planning
 *   - strong heat or cold that changes comfort
 *   - high wind that affects coast / views / outdoor plans
 *   - an unusually good outdoor / view / coast window
 *
 * Data source: reuses server/weather.js (Open-Meteo) via the city's own
 * `services.fetchWeatherForDates`, so a single /api/city-pulse request makes
 * no duplicate weather network calls — the engine already fetches the same
 * day's weather and both share the 30-minute weather cache.
 *
 * Source honesty: Open-Meteo's free API is licensed for non-commercial use
 * with fair-use rate limits (CC BY 4.0; see
 * docs/PULSE_SOURCE_PROVIDER_REGISTRY.md → "Source honesty"). This provider is
 * wired `status: "active"` for product development; commercial deployment would
 * require an Open-Meteo paid plan or an equivalent licensed provider.
 */

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");

const WEATHER_CONTEXT_PROVIDER_ID = "generic-open-meteo-weather";

const weatherContextDescriptor = {
  id: WEATHER_CONTEXT_PROVIDER_ID,
  label: "Open-Meteo weather context",
  // city is the generic sentinel; the registry recognizes it as city-agnostic
  // and createWeatherContextProvider stamps the real city per cityConfig so one
  // provider object serves every city.
  city: GENERIC_PROVIDER_CITY,
  role: "weather_context",
  sourceType: "weather",
  sourceUrl: "https://open-meteo.com/",
  status: "active",
  intendedUse: "pulse",
  supportedLanguages: ["en", "sv"],
  updateCadence: "hourly",
  parsingRisk: "low",
  trust: {
    source_tier: "verified",
    confidence: "medium",
    human_verified: false,
    freshness: "fresh",
  },
  cachePolicy: {
    // The underlying fetch (server/weather.js) owns a 30-minute memory cache.
    kind: "memory",
    ttlSeconds: 1800,
  },
  sourceOwnedFields: [
    "condition",
    "max_temp",
    "min_temp",
    "apparent_temp_max",
    "precipitation_probability_max",
    "precipitation_sum",
    "wind_speed_max",
    "uv_index_max",
    "weather_source",
    "weather_stale",
  ],
  parrandaOwnedFields: ["signal_kind", "dayflow_reason"],
};

/**
 * Factory. Returns a provider spec whose descriptor is bound to the given
 * city. The registry calls spec.create(cityConfig, context) → { collect }.
 */
function createWeatherContextProvider(providerOptions = {}) {
  return {
    descriptor: weatherContextDescriptor,
    create(cityConfig, context = {}) {
      const descriptor = {
        ...weatherContextDescriptor,
        city: cityConfig?.key || weatherContextDescriptor.city,
      };
      return {
        descriptor,
        async collect(collectionContext = {}) {
          const date =
            collectionContext.date || context.date || providerOptions.date || null;
          if (!date) {
            return { events: [], signals: [] };
          }

          const fetchWeatherForDates =
            collectionContext.fetchWeatherForDates ||
            context.fetchWeatherForDates ||
            providerOptions.fetchWeatherForDates ||
            cityConfig?.services?.fetchWeatherForDates;

          if (typeof fetchWeatherForDates !== "function") {
            return { events: [], signals: [] };
          }

          let weather = null;
          try {
            const byDate = await fetchWeatherForDates([date], cityConfig?.center);
            weather = byDate && typeof byDate === "object" ? byDate[date] || null : null;
          } catch (_error) {
            // Fail-safe: a weather fetch failure must never break Pulse.
            return { events: [], signals: [] };
          }

          const lang = collectionContext.lang || context.lang || providerOptions.lang || "en";
          const signal = interpretWeatherForDayflow(weather, { date, cityConfig, lang });
          return {
            events: [],
            signals: signal ? [signal] : [],
          };
        },
      };
    },
  };
}

/**
 * Thresholds for "this changes the day". Deliberately conservative so normal
 * weather stays silent. Kept city-agnostic — no per-city tuning.
 */
const THRESHOLDS = {
  rainProbability: 55, // % chance of precipitation that warrants a route note
  rainSum: 2, // mm of precipitation that warrants a route note
  hotApparent: 31, // °C apparent — comfort/heat shift
  coldMax: 8, // °C daily max — comfort/cold shift
  windCoast: 38, // km/h max wind — affects coast/views/outdoor
  pleasantMin: 19, // °C — lower bound of an unusually good outdoor window
  pleasantMax: 27, // °C — upper bound before heat takes over
  lowRainForOutdoor: 20, // % — an outdoor window needs low rain risk
};

/**
 * Interpret a normalized weather object (server/weather.js shape) into at most
 * one dayflow signal, or null when the weather is unremarkable.
 *
 * Priority order is by how strongly the condition forces a plan change:
 *   rain > heat > cold > wind > unusually-good-outdoor-window.
 */
function interpretWeatherForDayflow(weather, { date, cityConfig, lang }) {
  if (!weather || typeof weather !== "object") {
    return null;
  }

  const rainProb = numberOrNull(weather.precipitationProbabilityMax);
  const rainSum = numberOrNull(weather.precipitationSum);
  const apparent = numberOrNull(weather.apparentTempMax);
  const maxTemp = numberOrNull(weather.maxTemp);
  const wind = numberOrNull(weather.windSpeedMax);
  const condition = String(weather.condition || "").toLowerCase();
  const isEnglish = String(lang).toLowerCase() !== "sv";

  const rainy =
    condition === "rain" ||
    (rainProb !== null && rainProb >= THRESHOLDS.rainProbability) ||
    (rainSum !== null && rainSum >= THRESHOLDS.rainSum);
  const hot = apparent !== null && apparent >= THRESHOLDS.hotApparent;
  const cold = maxTemp !== null && maxTemp <= THRESHOLDS.coldMax;
  const windy = wind !== null && wind >= THRESHOLDS.windCoast;
  const outdoorWindow =
    !rainy &&
    !windy &&
    maxTemp !== null &&
    maxTemp >= THRESHOLDS.pleasantMin &&
    maxTemp <= THRESHOLDS.pleasantMax &&
    (rainProb === null || rainProb <= THRESHOLDS.lowRainForOutdoor) &&
    condition === "sun";

  let kind = null;
  if (rainy) kind = "rain";
  else if (hot) kind = "heat";
  else if (cold) kind = "cold";
  else if (windy) kind = "wind";
  else if (outdoorWindow) kind = "outdoor_window";

  if (!kind) {
    return null; // boring, normal weather — stay silent
  }

  const copy = buildSignalCopy(kind, { isEnglish, weather });
  const sourceOwned = {
    condition: weather.condition || null,
    max_temp: maxTemp,
    min_temp: numberOrNull(weather.minTemp),
    apparent_temp_max: apparent,
    precipitation_probability_max: rainProb,
    precipitation_sum: rainSum,
    wind_speed_max: wind,
    uv_index_max: numberOrNull(weather.uvIndexMax),
    weather_source: weather.source || "open-meteo",
    weather_stale: Boolean(weather.stale),
  };

  return {
    // The registry's normalizeEventId prefixes this with `${descriptor.id}:`,
    // so the raw id here stays unprefixed to avoid a doubled provider id.
    id: `${cityConfig?.key || "city"}:${date}:${kind}`,
    type: "weather_shift",
    signal_type: "weather_shift",
    title: copy.title,
    blurb: copy.blurb,
    reason: copy.reason,
    why_it_matters: copy.reason,
    editorial_pitch: copy.pitch,
    kindLabel: copy.kindLabel,
    // No coordinates and no place: the display-gate layer keeps this as Pulse
    // context only — never an event, place candidate, nearby claim, or route stop.
    source_owned: sourceOwned,
    parranda_owned: {
      signal_kind: kind,
      dayflow_reason: copy.reason,
    },
    // Confidence rides the weather forecast's own confidence (stale forecasts
    // degrade). Used by the display gate + signal-quality classifier.
    confidence: weather.stale ? "low" : "medium",
  };
}

function buildSignalCopy(kind, { isEnglish, weather }) {
  const maxTemp = numberOrNull(weather.maxTemp);
  const apparent = numberOrNull(weather.apparentTempMax);
  const tempLabel = maxTemp !== null ? `${Math.round(maxTemp)}°` : null;

  switch (kind) {
    case "rain":
      return {
        kindLabel: isEnglish ? "Rain" : "Regn",
        title: isEnglish ? "Rain is likely — plan a more indoor route" : "Regn troligt – planera en mer inomhusrutt",
        blurb: isEnglish
          ? "Today leans wet. Favour covered stops, markets, and short hops between indoor places over long open-air stretches."
          : "Dagen lutar åt blött. Välj skyddade stopp, marknader och korta hopp mellan inomhusplatser framför långa sträckor ute.",
        reason: isEnglish
          ? "Rain changes which route reads best — an indoor-leaning plan holds up better than an open-air one today."
          : "Regn ändrar vilken rutt som funkar bäst – en mer inomhusinriktad plan håller bättre än en utomhus idag.",
        pitch: isEnglish
          ? "Let covered stops carry the day instead of long outdoor stretches."
          : "Låt skyddade stopp bära dagen i stället för långa utomhussträckor.",
      };
    case "heat":
      return {
        kindLabel: isEnglish ? "Heat" : "Värme",
        title: isEnglish
          ? `Strong heat${apparent !== null ? ` — feels like ${Math.round(apparent)}°` : ""}`
          : `Stark värme${apparent !== null ? ` – känns som ${Math.round(apparent)}°` : ""}`,
        blurb: isEnglish
          ? "Midday will be intense. Front-load shade, indoor stops, and water; push open-air walking toward the cooler evening."
          : "Mitt på dagen blir intensivt. Tidigarelägg skugga, inomhusstopp och vatten; skjut utomhuspromenader mot den svalare kvällen.",
        reason: isEnglish
          ? "Strong heat changes comfort and timing — the plan works better shifted around the midday peak."
          : "Stark värme ändrar komfort och timing – planen fungerar bättre förskjuten runt middagstoppen.",
        pitch: isEnglish
          ? "Shift the open-air parts toward the cooler evening."
          : "Förskjut utomhusdelarna mot den svalare kvällen.",
      };
    case "cold":
      return {
        kindLabel: isEnglish ? "Cold" : "Kyla",
        title: isEnglish
          ? `Cold day${tempLabel ? ` — around ${tempLabel}` : ""}`
          : `Kall dag${tempLabel ? ` – runt ${tempLabel}` : ""}`,
        blurb: isEnglish
          ? "It stays cold. Build the day around warm indoor anchors and shorter outdoor legs between them."
          : "Det förblir kallt. Bygg dagen runt varma inomhusankare och kortare utomhusben mellan dem.",
        reason: isEnglish
          ? "Cold changes comfort — shorter outdoor legs between warm stops read better than a long exposed route."
          : "Kyla ändrar komforten – kortare utomhusben mellan varma stopp funkar bättre än en lång utsatt rutt.",
        pitch: isEnglish
          ? "Anchor the day on warm indoor stops."
          : "Förankra dagen i varma inomhusstopp.",
      };
    case "wind":
      return {
        kindLabel: isEnglish ? "Wind" : "Vind",
        title: isEnglish ? "Strong wind — coast and high views will be exposed" : "Stark vind – kust och höga utsikter blir utsatta",
        blurb: isEnglish
          ? "Expect gusty conditions. Sheltered streets and indoor stops beat exposed seafronts, terraces, and high viewpoints today."
          : "Räkna med byig vind. Skyddade gator och inomhusstopp slår utsatta strandpromenader, terrasser och höga utsiktspunkter idag.",
        reason: isEnglish
          ? "High wind affects coast, terraces, and viewpoints — a more sheltered plan holds up better."
          : "Stark vind påverkar kust, terrasser och utsiktspunkter – en mer skyddad plan håller bättre.",
        pitch: isEnglish
          ? "Trade exposed viewpoints for sheltered streets today."
          : "Byt utsatta utsiktspunkter mot skyddade gator idag.",
      };
    case "outdoor_window":
    default:
      return {
        kindLabel: isEnglish ? "Clear" : "Klart",
        title: isEnglish
          ? `Unusually good outdoor day${tempLabel ? ` — ${tempLabel} and clear` : ""}`
          : `Ovanligt bra utedag${tempLabel ? ` – ${tempLabel} och klart` : ""}`,
        blurb: isEnglish
          ? "Clear and comfortable. This is a day to lean into views, coast, terraces, and open-air stops while it lasts."
          : "Klart och behagligt. Det här är en dag att satsa på utsikter, kust, terrasser och utomhusstopp medan det varar.",
        reason: isEnglish
          ? "An unusually good window favours outdoor and view stops over an indoor-heavy plan."
          : "Ett ovanligt bra fönster gynnar utomhus- och utsiktsstopp framför en inomhustung plan.",
        pitch: isEnglish
          ? "Let views and open-air stops shape the day while the window holds."
          : "Låt utsikter och utomhusstopp forma dagen medan fönstret håller.",
      };
  }
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

module.exports = {
  WEATHER_CONTEXT_PROVIDER_ID,
  weatherContextDescriptor,
  createWeatherContextProvider,
  interpretWeatherForDayflow,
  THRESHOLDS,
};
