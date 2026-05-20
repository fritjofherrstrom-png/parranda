const { normalizeLanguage } = require("../ui-i18n");

/**
 * Build the EngineContext for a single buildCityPulse() invocation.
 *
 * `now` is treated as a real moment in time. Generators that decide
 * "right now" relevance must read `cityNow` (the city-local breakdown)
 * rather than calling Date methods directly, so behaviour stays correct
 * across timezones.
 *
 * @param {Object} options
 * @param {Object} options.cityConfig    Validated city config
 * @param {string} options.date          ISO date string (city-local)
 * @param {Date}   [options.now]         Defaults to new Date()
 * @param {Object} [options.weather]
 * @param {any[]}  [options.events]
 * @param {string} [options.lang]
 * @returns {import("./types").EngineContext}
 */
function buildEngineContext({
  cityConfig,
  date,
  now,
  weather,
  events,
  lang,
}) {
  if (!cityConfig || typeof cityConfig !== "object") {
    throw new TypeError("buildEngineContext: cityConfig is required");
  }
  if (!date || typeof date !== "string") {
    throw new TypeError("buildEngineContext: date is required");
  }

  const timezone = cityConfig.timezone;
  if (!timezone || typeof timezone !== "string") {
    throw new TypeError("buildEngineContext: cityConfig.timezone is required");
  }

  const resolvedNow = now instanceof Date ? now : new Date();
  const cityNow = buildCityNow(resolvedNow, timezone);

  return {
    city: cityConfig,
    date,
    now: resolvedNow,
    cityNow,
    timezone,
    center: cityConfig.center || null,
    weather: weather || null,
    events: Array.isArray(events) ? events : [],
    lang: normalizeLanguage(lang),
  };
}

/**
 * Decompose a Date into city-local parts using Intl.DateTimeFormat.
 * Returns plain numbers so generators can do arithmetic without
 * juggling timezone offsets manually.
 *
 * @param {Date}   instant
 * @param {string} timezone   IANA tz string
 */
function buildCityNow(instant, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const weekday = weekdayShortToNumber(parts.weekday);

  return {
    year,
    month,
    day,
    weekday,
    hour,
    minute,
    second,
    totalMinutes: hour * 60 + minute,
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function weekdayShortToNumber(short) {
  switch (String(short || "").slice(0, 3)) {
    case "Sun":
      return 0;
    case "Mon":
      return 1;
    case "Tue":
      return 2;
    case "Wed":
      return 3;
    case "Thu":
      return 4;
    case "Fri":
      return 5;
    case "Sat":
      return 6;
    default:
      return null;
  }
}

module.exports = {
  buildEngineContext,
  buildCityNow,
};
