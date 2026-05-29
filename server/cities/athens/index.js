const cityCatalog = require("./catalog");
const { sourceCandidates } = require("./source-candidates");

const ATHENS_KEY = "athens";
const ATHENS_LABEL = "Athens";
const ATHENS_TIMEZONE = "Europe/Athens";
const ATHENS_LOCALE = "el-GR";
const ATHENS_CURRENCY = "EUR";
const ATHENS_CENTER = { lat: 37.9838, lng: 23.7275 };

const noopServices = optionalRequire("../noop-services");
const geocoding = optionalRequire("../../geocoding");
const weather = optionalRequire("../../weather");

const athensEditorial = createEditorialService(ATHENS_LABEL);
const geocodeQuery = createGeocodeQuery();

function todayIsoDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATHENS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function optionalRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (_error) {
    return null;
  }
}

function createEditorialService(cityLabel) {
  if (noopServices?.createNoopEditorialService) {
    return noopServices.createNoopEditorialService({ cityLabel });
  }

  return {
    getCityPulse(dateString) {
      return {
        date: dateString || null,
        weekday_label: null,
        date_label: null,
        headline: `${cityLabel} is in preview`,
        subhead: `Curated Pulse is not ready for ${cityLabel} yet.`,
        note: null,
        footer_note: null,
        _noop: true,
        items: [],
        moments: [],
        official_events: [],
        wildcards: [],
      };
    },
    getDateSignals() {
      return [];
    },
  };
}

function createGeocodeQuery() {
  if (geocoding?.buildGeocodeQuery) {
    return geocoding.buildGeocodeQuery({
      items: cityCatalog.allItems,
      findByName: cityCatalog.findItemByName,
      searchLabel: ATHENS_LABEL,
      countryLabel: ATHENS_LABEL,
      defaultAreaLabel: ATHENS_LABEL,
      userAgent: `Parranda ${ATHENS_LABEL}/1.0 (citypack-skeleton)`,
    });
  }

  return async function geocodeQuery() {
    return [];
  };
}

async function fetchWeatherForDates(dates, anchor = ATHENS_CENTER) {
  if (weather?.fetchWeatherForDates) {
    return weather.fetchWeatherForDates(dates, anchor, { timezone: ATHENS_TIMEZONE });
  }

  const safeDates = Array.isArray(dates) ? dates : [];
  return safeDates.reduce((accumulator, date) => {
    accumulator[date] = null;
    return accumulator;
  }, {});
}

function fetchLiveEventsForDates(dates = []) {
  if (noopServices?.createNoopLiveEventsService) {
    return noopServices.createNoopLiveEventsService()(dates);
  }

  const safeDates = Array.isArray(dates) ? dates : [];
  return Promise.resolve(
    safeDates.reduce((accumulator, date) => {
      accumulator[date] = [];
      return accumulator;
    }, {}),
  );
}

module.exports = {
  key: ATHENS_KEY,
  label: ATHENS_LABEL,
  visibility: "preview",
  timezone: ATHENS_TIMEZONE,
  locale: ATHENS_LOCALE,
  currency: ATHENS_CURRENCY,
  searchLabel: ATHENS_LABEL,
  editorialAreaLabel: ATHENS_LABEL,
  fallbackLabel: ATHENS_LABEL,
  center: ATHENS_CENTER,
  todayIsoDate,
  catalog: {
    routeTemplates: cityCatalog.routeTemplates,
    allItems: cityCatalog.allItems,
    provenanceById: cityCatalog.provenanceById,
    findItemByName: cityCatalog.findItemByName,
  },
  // Provisional source candidates: REAL, unverified places the agnostic-compose
  // path may use as honest low-confidence fill when a thin neighborhood's
  // verified pool runs out. Kept OUT of `catalog` so they never count as
  // verified items, never seed the route spine, and never inflate readiness.
  sourceCandidates,
  services: {
    geocodeQuery,
    fetchWeatherForDates,
    getCityPulse: athensEditorial.getCityPulse,
    getDateSignals: athensEditorial.getDateSignals,
    fetchLiveEventsForDates,
    signalGenerators: [],
  },
  walking: {
    defaultProvider: "heuristic",
    truthPassTopCandidates: 4,
    requestTimeoutMs: 3500,
  },
  routing: {
    areaDefinitions: {
      "monastiraki-psyrri": { label: "Monastiraki & Psyrri", macro: "central" },
      "kolonaki-lycabettus": { label: "Kolonaki & Lycabettus", macro: "northeast" },
      "gazi-kerameikos": { label: "Gazi & Kerameikos", macro: "west" },
      "koukaki-makrygianni": { label: "Koukaki & Makrygianni", macro: "south" },
      "exarchia": { label: "Exarchia", macro: "central-north" },
      "pangrati-mets": { label: "Pangrati & Mets", macro: "east" },
      "kypseli": { label: "Kypseli", macro: "north" },
    },
    macroAreaLabels: {
      central: "Central Athens",
      northeast: "Northeast Athens",
      west: "West Athens",
      south: "South Athens",
      "central-north": "Central-North Athens",
      east: "East Athens",
      north: "North Athens",
    },
    tuning: {},
  },
  localTruth: {
    calendar: [],
    rules: [],
  },
};
