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
 *     / golden-hour / city-rhythm run ONLY when a trusted IANA timezone is known
 *     (resolver-provided). When unknown, time is omitted with `timezone_unavailable`.
 *     No coordinate→timezone lookup.
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

function summarizeWeatherRead(signal) {
  return {
    kind: signal.parranda_owned?.signal_kind || null,
    headline: signal.title || null,
    reason: signal.reason || null,
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
  return fetchWeatherForDates([date], { lat, lng }, { timezone })
    .then((byDate) => (byDate && byDate[date]) || null)
    .catch(() => null);
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
  const timezoneKnown = isValidIanaTimezone(trustedTimezone);
  const timezone = timezoneKnown ? trustedTimezone : null;

  // --- Time (tz-gated) ---
  let cityNow = null;
  let timeBand = null;
  let nowIso = null;
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
      timeBand = resolveTimeBandFromHour(cityNow.hour);
      nowIso = `${cityNow.isoDate}T${pad2(cityNow.hour)}:${pad2(cityNow.minute)}:00`;
      // PURE coordinate+time signals — no scraping, no citypack.
      computedSignals = [
        ...safeGenerate(goldenHourGenerator, engineContext),
        ...safeGenerate(cityRhythmGenerator, engineContext),
      ].map(summarizeComputedSignal);
    } catch (_error) {
      cityNow = null;
      timeBand = null;
      nowIso = null;
      computedSignals = [];
    }
  }

  // --- Weather (any-place, fail-soft) ---
  let weather = null;
  let weatherStatus = "unavailable";
  let weatherRead = null;
  try {
    const provider = typeof weatherProvider === "function" ? weatherProvider : defaultWeatherProvider;
    if (Number.isFinite(lat) && Number.isFinite(lng) && date) {
      const resolved = await provider({ lat, lng, date, timezone: timezone || "UTC" });
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

  const contextBlock = {
    status: "resolved",
    time: {
      timezone,
      timezone_known: timezoneKnown,
      status: timezoneKnown ? "resolved" : "timezone_unavailable",
      now: nowIso,
      time_band: timeBand,
    },
    weather: { status: weatherStatus, read: weatherRead },
    computed_signals: computedSignals,
    live: { available: false, reason: "no_any_place_live_source" },
    influence: {
      weather_fed_into_selection: Boolean(weather),
      time_fed_into_selection: timezoneKnown,
      // Populated by the caller from the SELECTED candidates' fit reasons, so the
      // output explains exactly how the trusted context influenced composition.
      weather_fit_reasons: [],
      time_fit_reasons: [],
    },
  };

  return {
    weather,
    hour: cityNow ? cityNow.hour : null,
    now: nowIso,
    timeBand,
    timezoneKnown,
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
};
