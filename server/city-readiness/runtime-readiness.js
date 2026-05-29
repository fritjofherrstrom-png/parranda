const { inspectCityPack } = require("./inspect-city-pack");

// inspectCityPack walks the full catalog; cache per stable cityConfig singleton
// so a request never re-inspects a large pack (e.g. Rome) more than once.
const reportCache = new WeakMap();

function getCachedReport(cityConfig) {
  if (!cityConfig || typeof cityConfig !== "object") {
    return null;
  }
  if (reportCache.has(cityConfig)) {
    return reportCache.get(cityConfig);
  }
  let report = null;
  try {
    report = inspectCityPack(cityConfig);
  } catch (error) {
    report = null;
  }
  reportCache.set(cityConfig, report);
  return report;
}

// Runtime honesty signal for a planning result. Generic and citypack-agnostic:
// driven by catalog/template presence and whether routes were actually produced,
// never by per-city hardcoding.
function classifyRuntimeReadiness(cityConfig, resolution = {}, options = {}) {
  const report = getCachedReport(cityConfig);
  const templateCount = report?.catalog?.route_template_count ?? 0;
  const itemCount = report?.catalog?.item_count ?? 0;
  const routedDayCount = Number.isFinite(options.routedDayCount) ? options.routedDayCount : null;

  let signal;
  if (templateCount === 0) {
    signal = "source_enrichment_needed";
  } else if (routedDayCount === 0) {
    signal = "source_enrichment_needed";
  } else {
    signal = "ready";
  }

  return {
    status: report?.status || "partial",
    signal,
    requested_city: resolution.requestedKey || cityConfig?.key || null,
    resolved_city: cityConfig?.key || null,
    fallback_used: Boolean(resolution.fallbackUsed),
    catalog: {
      item_count: itemCount,
      route_template_count: templateCount,
    },
  };
}

// Honesty block for a city that was explicitly requested but is not registered.
// We do NOT pretend to plan it as the fallback city.
function buildUnsupportedCityReadiness(resolution = {}) {
  const requestedCity =
    typeof resolution === "string" ? resolution : resolution.requestedKey || null;
  return {
    status: "unsupported_city",
    signal: "unsupported_city",
    requested_city: requestedCity,
    resolved_city: null,
    fallback_used: true,
    catalog: {
      item_count: 0,
      route_template_count: 0,
    },
  };
}

function buildUnsupportedCityResult(resolution = {}, dates = []) {
  const requestedCity =
    typeof resolution === "string" ? resolution : resolution.requestedKey || null;
  return {
    city: requestedCity,
    days: (Array.isArray(dates) ? dates : []).map((date) => ({
      date,
      date_signals: [],
      live_events: [],
      primary_route: null,
      alternatives: [],
    })),
    resolved_home_base: null,
    resolved_start: null,
    resolved_end: null,
    readiness: buildUnsupportedCityReadiness(resolution),
  };
}

module.exports = {
  classifyRuntimeReadiness,
  buildUnsupportedCityReadiness,
  buildUnsupportedCityResult,
};
