const { buildEngineContext } = require("./context");
const { normalizeSignal } = require("./normalize");
const { scoreSignals } = require("./rank");
const liveEventsGenerator = require("./generators/live-events");
const goldenHourGenerator = require("./generators/golden-hour");

/**
 * Engine-level generators that run for every city. A generator is only
 * useful here if it can honestly produce signals from city-agnostic
 * inputs (live events, weather, lat/lng + date). The list is short on
 * purpose — new generators must be backed by real sources or rules.
 */
const CITY_AGNOSTIC_GENERATORS = [liveEventsGenerator, goldenHourGenerator];

/**
 * Build a city's Pulse for a given moment.
 *
 * Runs city-agnostic generators + the city's own signalGenerators,
 * normalizes their output into PulseSignal[], ranks, and returns a
 * stable shape ready for the API.
 *
 * @param {Object} cityConfig
 * @param {Object} options
 * @param {string} options.date
 * @param {Date}   [options.now]
 * @param {string} [options.lang]
 */
async function buildCityPulse(cityConfig, options = {}) {
  const { date, now, lang } = options;

  const [weather, events] = await Promise.all([
    safeFetchWeather(cityConfig, date),
    safeFetchLiveEvents(cityConfig, date),
  ]);

  const context = buildEngineContext({
    cityConfig,
    date,
    now,
    weather: weather || null,
    events: events || [],
    lang,
  });

  const generators = [
    ...CITY_AGNOSTIC_GENERATORS,
    ...readCitySignalGenerators(cityConfig),
  ];

  const rawSignals = [];
  for (const generator of generators) {
    try {
      const result = await Promise.resolve(generator(context));
      if (Array.isArray(result)) {
        for (const raw of result) {
          if (raw) rawSignals.push(raw);
        }
      }
    } catch (error) {
      // A misbehaving generator must not break the whole engine.
      // Log to stderr so it surfaces in tests/CI without crashing.
      // eslint-disable-next-line no-console
      console.error(
        `pulse-engine: generator threw (${generator.generatorId || "anonymous"}):`,
        error?.message || error,
      );
    }
  }

  const normalized = rawSignals
    .map((raw) => normalizeSignal(raw, context))
    .filter(Boolean);

  const ranked = scoreSignals(normalized, context);

  return {
    city: context.city.key,
    date: context.date,
    requested_at: context.now.toISOString(),
    timezone: context.timezone,
    lang: context.lang,
    signals: ranked,
    weather: context.weather,
    events: context.events,
  };
}

function readCitySignalGenerators(cityConfig) {
  const list = cityConfig?.services?.signalGenerators;
  if (!Array.isArray(list)) return [];
  return list.filter((entry) => typeof entry === "function");
}

async function safeFetchWeather(cityConfig, date) {
  const fetcher = cityConfig?.services?.fetchWeatherForDates;
  if (typeof fetcher !== "function" || !date) return null;
  try {
    const byDate = await fetcher([date], cityConfig.center);
    if (byDate && typeof byDate === "object") {
      return byDate[date] || null;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

async function safeFetchLiveEvents(cityConfig, date) {
  const fetcher = cityConfig?.services?.fetchLiveEventsForDates;
  if (typeof fetcher !== "function" || !date) return [];
  try {
    const byDate = await fetcher([date], {});
    if (byDate && typeof byDate === "object") {
      const list = byDate[date];
      return Array.isArray(list) ? list : [];
    }
    return [];
  } catch (_error) {
    return [];
  }
}

module.exports = {
  buildCityPulse,
  CITY_AGNOSTIC_GENERATORS,
};
