/**
 * Day-level source-aware dayflow context.
 *
 * Makes "Your Day" explain WHY it leans the way it does, using the same
 * source-backed interpretation that drives Pulse — so the two never disagree.
 *
 * This is an EXPLANATION layer, not a second scoring path. Route scoring already
 * reads weather (see weatherScore in route-engine). This module reuses the
 * weather-context provider's interpreter (interpretWeatherForDayflow) to produce
 * one coherent, source-attributed read of the day, plus a compact note about a
 * genuinely route-proximate live event when the existing live matching already
 * found one.
 *
 * Product constraints, enforced structurally:
 *   - Weather is CONTEXT, never a stop/place/event. The weather read carries no
 *     coordinates and produces no candidate — it only explains a lean.
 *   - A source URL alone is not a place. Live context is used only when the
 *     route/live matcher already bound an event to this route with a finite
 *     distance (best_route_id + route_distance_km), i.e. a trustworthy
 *     route-proximate event.
 *   - Weak/vague signals stay quiet. Boring weather yields no weather read, and
 *     when nothing meaningful is present the whole dayflow_context is null.
 */

const { interpretWeatherForDayflow } = require("../pulse-sources/weather-context-provider");

// Map the weather interpreter's signal_kind → how the day should lean. The lean
// is the single machine-readable summary the UI and future scoring can key on.
const KIND_TO_LEAN = {
  rain: "indoor",
  heat: "shaded",
  cold: "indoor",
  wind: "sheltered",
  outdoor_window: "outdoor",
};

// A live event is only "route-proximate enough to mention" within this radius.
// Matches the spirit of the route/live matcher, which already prefers near events.
const LIVE_PROXIMITY_KM = 0.7;

/**
 * Build the day-level dayflow_context, or null when nothing meaningful applies.
 *
 * @param {Object} params
 * @param {Object|null} params.weather        Normalized weather (server/weather.js shape)
 * @param {Array}       params.liveEvents     Route-annotated live events for the day
 * @param {Object|null} params.primaryRoute   The day's chosen route (for id matching)
 * @param {string}      params.date
 * @param {Object}      params.cityConfig
 * @param {string}      params.lang
 * @returns {Object|null}
 */
function buildDayflowContext({
  weather = null,
  liveEvents = [],
  primaryRoute = null,
  date = null,
  cityConfig = null,
  lang = "en",
} = {}) {
  const weatherRead = buildWeatherRead({ weather, date, cityConfig, lang });
  const liveRead = buildLiveRead({ liveEvents, primaryRoute, lang });

  // Silence is the default: if neither the weather nor a route-proximate live
  // event says anything meaningful, there is no dayflow context to surface.
  if (!weatherRead && !liveRead) {
    return null;
  }

  const reasons = [];
  if (weatherRead) reasons.push(`weather_${weatherRead.kind}`);
  if (liveRead) reasons.push("route_proximate_live_event");

  const lean = weatherRead ? KIND_TO_LEAN[weatherRead.kind] || "neutral" : "neutral";

  return {
    lean,
    headline: weatherRead ? weatherRead.headline : liveRead.headline,
    weather: weatherRead,
    live: liveRead,
    reasons,
  };
}

function buildWeatherRead({ weather, date, cityConfig, lang }) {
  const signal = interpretWeatherForDayflow(weather, { date, cityConfig, lang });
  if (!signal) {
    return null;
  }
  const parrandaOwned = signal.parranda_owned || {};
  const sourceOwned = signal.source_owned || {};
  const kind = parrandaOwned.signal_kind || null;
  if (!kind) {
    return null;
  }

  return {
    kind,
    headline: signal.title,
    reason: signal.reason || parrandaOwned.dayflow_reason || null,
    pitch: signal.editorial_pitch || null,
    // Provenance: enough to trace the read back to its source and conditions,
    // without dumping a raw API payload. Mirrors source_provider_signal.
    provenance: {
      provider_id: "generic-open-meteo-weather",
      role: "weather_context",
      signal_type: "weather_shift",
      signal_kind: kind,
      confidence: signal.confidence || null,
      source: sourceOwned.weather_source || "open-meteo",
      stale: Boolean(sourceOwned.weather_stale),
      observed: {
        condition: sourceOwned.condition ?? null,
        max_temp: sourceOwned.max_temp ?? null,
        apparent_temp_max: sourceOwned.apparent_temp_max ?? null,
        precipitation_probability_max: sourceOwned.precipitation_probability_max ?? null,
        precipitation_sum: sourceOwned.precipitation_sum ?? null,
        wind_speed_max: sourceOwned.wind_speed_max ?? null,
      },
    },
  };
}

function buildLiveRead({ liveEvents, primaryRoute, lang }) {
  if (!Array.isArray(liveEvents) || !liveEvents.length || !primaryRoute) {
    return null;
  }
  const isEnglish = String(lang).toLowerCase() !== "sv";

  // Only events the live matcher already bound to THIS route, with a finite,
  // close distance. A source URL or a far event is not route-proximate context.
  const proximate = liveEvents
    .filter(
      (event) =>
        event &&
        event.best_route_id === primaryRoute.id &&
        Number.isFinite(event.route_distance_km) &&
        event.route_distance_km <= LIVE_PROXIMITY_KM &&
        firstString(event.title),
    )
    .sort((left, right) => (left.route_distance_km ?? 99) - (right.route_distance_km ?? 99));

  if (!proximate.length) {
    return null;
  }

  const nearest = proximate[0];
  const headline = isEnglish
    ? `A live happening sits right on today's route${nearest.venue ? ` near ${nearest.venue}` : ""}.`
    : `Något live ligger precis vid dagens rutt${nearest.venue ? ` nära ${nearest.venue}` : ""}.`;

  return {
    count: proximate.length,
    nearest_km: nearest.route_distance_km,
    headline,
    nearest: {
      title: nearest.title,
      venue: nearest.venue || null,
      route_distance_km: nearest.route_distance_km,
      source_id: nearest.source_id || nearest.source_event_id || null,
      source_label: nearest.source_label || null,
      source_confidence: nearest.source_confidence || null,
    },
  };
}

function firstString(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

module.exports = {
  buildDayflowContext,
  KIND_TO_LEAN,
  LIVE_PROXIMITY_KM,
};
