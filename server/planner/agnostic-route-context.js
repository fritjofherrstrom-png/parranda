/**
 * Agnostic route context (#262) — trusted time + weather context for the
 * any-place route experiment.
 *
 * Resolves a TRUSTED context for a coordinate anchor and date so it can both
 * (a) influence candidate composition through the existing candidate-pool inputs
 * (weather + time band) and (b) be surfaced honestly under
 * `agnostic_route_output_experiment.context`.
 *
 * Hard rules:
 *   - Public payload weather/time/signals are NEVER consulted here — only the
 *     server-injected `weatherProvider` and `clock`.
 *   - Weather-first / timezone-gated: weather works for any coordinates; time-of-day
 *     / golden-hour / city-rhythm run ONLY when a trusted IANA timezone is known.
 *     Resolver-attested timezone is preferred; otherwise the trusted weather
 *     provider may supply an auto-resolved IANA timezone. This is labeled as
 *     `weather_provider_auto`, never as resolver-attested. No public payload
 *     timezone is trusted.
 *   - Live-event scraping is OUT: `live` is always { available:false }. No live
 *     event becomes a route stop.
 *   - Fail-SOFT: every part is guarded; a missing/erroring provider or unknown
 *     timezone never throws and never blocks the route. Context is NOT an
 *     eligibility/walking substitute.
 *   - Estimates only — no ETA, no opening hours, no "best/optimal" claims.
 *
 * Pure except for the awaited injected weather provider. Deterministic given its
 * inputs (inject a fixed `clock` + deterministic `weatherProvider` in tests).
 */

const { buildEngineContext } = require("../pulse-engine/context");
const goldenHourGenerator = require("../pulse-engine/generators/golden-hour");
const cityRhythmGenerator = require("../pulse-engine/generators/city-rhythm");
const { interpretWeatherForDayflow } = require("../pulse-sources/weather-context-provider");
const { resolveTimeBandFromHour } = require("../candidates/candidate-pool");

const { fetchWeatherForDates } = require("../weather");

// Fit-reason tokens that prove WHICH part of the trusted context reached scoring.
const WEATHER_FIT_PREFIXES = ["rain_", "sun_", "hot_", "requested_waterfront"];
const TIME_FIT_PREFIXES = ["time_match", "time_mismatch", "golden_hour", "requested_golden_hour"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isValidIanaTimezone(tz) {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    // Throws RangeError on an unknown/invalid zone.
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch (_error) {
    return false;
  }
}

function safeGenerate(generator, context) {
  try {
    const out = generator(context);
    return Array.isArray(out) ? out : [];
  } catch (_error) {
    return [];
  }
}

function summarizeComputedSignal(signal) {
  return {
    type: signal.type || signal.signal_type || null,
    headline: signal.safe_headline || signal.title || signal.headline || null,
    confidence: "computed",
    source: "computed_pulse",
    provenance: "computed_from_coordinates_and_time",
  };
}

// #262 — keep the agnostic weather read non-comparative. The shared weather copy
// can say a route "reads best"; that conflicts with this experiment's no
// best/optimal/fastest/shortest route claims, so we sanitize it locally (the
// shared copy is left intact for other surfaces).
function sanitizeAgnosticCopy(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/\breads best\b/gi, "works more reliably")
    .replace(/\b(best|optimal|fastest|shortest)\b/gi, "reliable");
}

function summarizeWeatherRead(signal) {
  return {
    kind: signal.parranda_owned?.signal_kind || null,
    headline: sanitizeAgnosticCopy(signal.title || null),
    reason: sanitizeAgnosticCopy(signal.reason || null),
    confidence: signal.confidence || "medium",
    provenance: {
      signal_type: "weather_shift",
      source: signal.source_owned?.weather_source || "open-meteo",
      stale: Boolean(signal.source_owned?.weather_stale),
    },
  };
}

/**
 * The default trusted weather seam: a thin adapter over the existing
 * `fetchWeatherForDates(dates, anchor, options)` (keyed by date). Tests inject a
 * deterministic provider instead. Returns the single date's weather object (the
 * camelCase shape `interpretWeatherForDayflow` / the fit-scorer already read) or null.
 */
function defaultWeatherProvider({ lat, lng, date, timezone } = {}) {
  const options = timezone ? { timezone } : {};
  return fetchWeatherForDates([date], { lat, lng }, options)
    .then((byDate) => (byDate && byDate[date]) || null)
    .catch(() => null);
}

function resolveWeatherTimezone(weather) {
  const resolution = weather && typeof weather === "object" ? weather.timezone_resolution : null;
  const timezone = typeof resolution?.timezone === "string" ? resolution.timezone.trim() : "";
  if (!isValidIanaTimezone(timezone)) {
    return null;
  }

  return {
    timezone,
    timezoneSource: "weather_provider_auto",
    timezoneTrust: "derived_from_weather_provider",
  };
}

function resolveTrustedTimezone({ trustedTimezone, weather }) {
  if (isValidIanaTimezone(trustedTimezone)) {
    return {
      timezone: trustedTimezone.trim(),
      timezoneKnown: true,
      timezoneSource: "resolver_attested",
      timezoneTrust: "resolver_attested",
    };
  }

  const weatherTimezone = resolveWeatherTimezone(weather);
  if (weatherTimezone) {
    return {
      ...weatherTimezone,
      timezoneKnown: true,
    };
  }

  return {
    timezone: null,
    timezoneKnown: false,
    timezoneSource: null,
    timezoneTrust: "unavailable",
  };
}

/**
 * @returns {Promise<{ weather: object|null, hour: number|null, now: string|null,
 *   timeBand: string|null, timezoneKnown: boolean, contextBlock: object }>}
 */
async function resolveAgnosticContext({
  coords,
  date,
  trustedTimezone = null,
  weatherProvider = null,
  clock = null,
  lang = "en",
  cityLabel = "Nearby",
} = {}) {
  const lat = coords ? Number(coords.lat) : NaN;
  const lng = coords ? Number(coords.lng) : NaN;

  // --- Weather (any-place, fail-soft) ---
  let weather = null;
  let weatherStatus = "unavailable";
  let weatherRead = null;
  try {
    const provider = typeof weatherProvider === "function" ? weatherProvider : defaultWeatherProvider;
    if (Number.isFinite(lat) && Number.isFinite(lng) && date) {
      const explicitTimezone = isValidIanaTimezone(trustedTimezone) ? trustedTimezone.trim() : null;
      const resolved = await provider({
        lat,
        lng,
        date,
        ...(explicitTimezone ? { timezone: explicitTimezone } : {}),
      });
      if (resolved && typeof resolved === "object") {
        weather = resolved;
        const signal = interpretWeatherForDayflow(resolved, { date, cityConfig: { key: "agnostic-area" }, lang });
        if (signal) {
          weatherStatus = "resolved";
          weatherRead = summarizeWeatherRead(signal);
        } else {
          // Weather present but nothing dayflow-relevant (boring weather — honest silence).
          weatherStatus = "no_signal";
        }
      }
    }
  } catch (_error) {
    weather = null;
    weatherStatus = "unavailable";
    weatherRead = null;
  }

  const { timezone, timezoneKnown, timezoneSource, timezoneTrust } = resolveTrustedTimezone({
    trustedTimezone,
    weather,
  });

  // --- Time (tz-gated) ---
  let cityNow = null;
  let timeBand = null;
  let nowIso = null;
  let requestedDateIsToday = null;
  let computedSignals = [];
  if (timezoneKnown && date) {
    try {
      const instant = typeof clock === "function" ? clock() : new Date();
      const tzCityConfig = { key: "agnostic-area", label: cityLabel, timezone, center: { lat, lng } };
      const engineContext = buildEngineContext({
        cityConfig: tzCityConfig,
        date,
        now: instant instanceof Date ? instant : new Date(),
        weather: null,
        events: [],
        lang,
      });
      cityNow = engineContext.cityNow;
      nowIso = `${cityNow.isoDate}T${pad2(cityNow.hour)}:${pad2(cityNow.minute)}:00`;
      requestedDateIsToday = cityNow.isoDate === date;
      if (requestedDateIsToday) {
        timeBand = resolveTimeBandFromHour(cityNow.hour);
        // These signals describe the current local moment. A future/past
        // selected date has no requested clock time, so applying today's hour
        // would be fabricated context rather than useful planning evidence.
        computedSignals = [
          ...safeGenerate(goldenHourGenerator, engineContext),
          ...safeGenerate(cityRhythmGenerator, engineContext),
        ].map(summarizeComputedSignal);
      }
    } catch (_error) {
      cityNow = null;
      timeBand = null;
      nowIso = null;
      requestedDateIsToday = null;
      computedSignals = [];
    }
  }

  // #262 — top-level status reflects ACTUAL context availability (honest, never a
  // route gate). Weather is "available" when a trusted weather object resolved
  // (dayflow-relevant or boring); time is "available" when a trusted timezone is
  // known. `skipped` is reserved for hard-blocker paths (set by the caller).
  const weatherAvailable = weatherStatus === "resolved" || weatherStatus === "no_signal";
  const timeAvailable = timezoneKnown;
  let status;
  if (weatherAvailable && timeAvailable) status = "available";
  else if (weatherAvailable || timeAvailable) status = "partial";
  else status = "unavailable";

  const contextBlock = {
    status,
    time: {
      timezone,
      timezone_known: timezoneKnown,
      timezone_source: timezoneSource,
      timezone_trust: timezoneTrust,
      status: timezoneKnown
        ? requestedDateIsToday
          ? "resolved"
          : "selected_date_unanchored"
        : "timezone_unavailable",
      now: nowIso,
      time_band: timeBand,
      requested_date_is_today: timezoneKnown ? requestedDateIsToday : null,
    },
    weather: { status: weatherStatus, read: weatherRead },
    computed_signals: computedSignals,
    live: { available: false, reason: "no_any_place_live_source" },
    influence: {
      weather_fed_into_selection: Boolean(weather),
      time_fed_into_selection: requestedDateIsToday === true,
      // Populated by the caller from the SELECTED candidates' fit reasons, so the
      // output explains exactly how the trusted context influenced composition.
      weather_fit_reasons: [],
      time_fit_reasons: [],
    },
  };

  return {
    weather,
    hour: requestedDateIsToday && cityNow ? cityNow.hour : null,
    now: nowIso,
    timeBand,
    timezoneKnown,
    timeAppliesToRequestedDate: requestedDateIsToday === true,
    contextBlock,
  };
}

/**
 * Extract the weather/time fit reasons that actually appeared on the SELECTED
 * candidates, so `context.influence` honestly explains the trusted context's
 * effect on composition. Matches the candidate combination's selected ids back to
 * the planner role candidates (which carry `weather_reasons` / `time_reasons`).
 */
function collectInfluenceReasons(plannerRoles, candidateCombination) {
  const selectedIds = new Set(
    (Array.isArray(candidateCombination?.selected) ? candidateCombination.selected : [])
      .map((entry) => entry.candidate_id)
      .filter(Boolean),
  );
  const weatherReasons = [];
  const timeReasons = [];
  const roles = Array.isArray(plannerRoles?.roles) ? plannerRoles.roles : [];
  for (const role of roles) {
    for (const candidate of role.candidates || []) {
      if (!selectedIds.has(candidate.candidate_id)) continue;
      weatherReasons.push(...(Array.isArray(candidate.weather_reasons) ? candidate.weather_reasons : []));
      timeReasons.push(...(Array.isArray(candidate.time_reasons) ? candidate.time_reasons : []));
    }
  }
  const weather = [...new Set(weatherReasons.filter((r) => WEATHER_FIT_PREFIXES.some((p) => String(r).startsWith(p))))].sort();
  const time = [...new Set(timeReasons.filter((r) => TIME_FIT_PREFIXES.some((p) => String(r).startsWith(p))))].sort();
  return { weather, time };
}

module.exports = {
  resolveAgnosticContext,
  collectInfluenceReasons,
  defaultWeatherProvider,
  isValidIanaTimezone,
  resolveWeatherTimezone,
};
