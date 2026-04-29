const catalog = require("../catalog");
const { geocodeQuery } = require("../geocoding");
const { fetchWeatherForDates, ROME_CENTER } = require("../weather");
const { getCityPulse, getDateSignals, getRomeTodayIsoDate } = require("../editorial-calendar");
const { fetchLiveEventsForDates } = require("../live-events");

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  key: "rome",
  label: "Rom",
  searchLabel: "Rome",
  editorialAreaLabel: "Rom",
  fallbackLabel: "Centro Storico",
  center: ROME_CENTER,
  todayIsoDate: getRomeTodayIsoDate,
  catalog: {
    routeTemplates: catalog.routeTemplates,
    allItems: catalog.allItems,
    findItemByName: catalog.findItemByName,
  },
  services: {
    geocodeQuery,
    fetchWeatherForDates,
    getCityPulse,
    getDateSignals,
    fetchLiveEventsForDates,
  },
  walking: {
    defaultProvider: process.env.PARRANDA_WALKING_PROVIDER || "heuristic",
    osrmBaseUrl: process.env.PARRANDA_OSRM_URL || "https://router.project-osrm.org",
    truthPassTopCandidates: parsePositiveInteger(process.env.PARRANDA_TRUTH_TOP_CANDIDATES, 5),
    requestTimeoutMs: parsePositiveInteger(process.env.PARRANDA_WALKING_TIMEOUT_MS, 4500),
  },
};
