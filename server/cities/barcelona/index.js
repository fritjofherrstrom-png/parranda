const barcelonaCatalog = require("./catalog");
const { fetchLiveEventsForDates } = require("./live");
const { createOpenDataBcnAgendaProvider } = require("./open-data-source-provider");
const { createWeatherContextProvider } = require("../../pulse-sources/weather-context-provider");
const barcelonaSources = require("./sources");
const { createNoopEditorialService } = require("../noop-services");
const { buildGeocodeQuery } = require("../../geocoding");
const { fetchWeatherForDates } = require("../../weather");

const BARCELONA_KEY = "barcelona";
const BARCELONA_LABEL = "Barcelona";
const BARCELONA_TIMEZONE = "Europe/Madrid";
const BARCELONA_LOCALE = "es-ES";
const BARCELONA_CURRENCY = "EUR";
const BARCELONA_CENTER = { lat: 41.3874, lng: 2.1686 };
const BARCELONA_COUNTRY = "Spain";

const areaDefinitions = {
  gracia: { label: "Gràcia", macro: "northwest-local" },
  "born-sant-pere-santa-caterina": {
    label: "El Born / Sant Pere / Santa Caterina",
    macro: "old-town",
  },
  gothic: { label: "Gothic Quarter", macro: "old-town" },
  eixample: { label: "Eixample", macro: "central-grid" },
  "sant-antoni": { label: "Sant Antoni", macro: "central-grid" },
  "poble-sec": { label: "Poble-sec", macro: "montjuic-southwest" },
  poblenou: { label: "Poblenou", macro: "coast-east" },
  barceloneta: { label: "Barceloneta", macro: "coast-east" },
  raval: { label: "Raval", macro: "old-town" },
  montjuic: { label: "Montjuïc", macro: "montjuic-southwest" },
  "sants-les-corts": { label: "Sants / Les Corts", macro: "montjuic-southwest" },
  "barri-gotic": { label: "Gothic Quarter", macro: "old-town" },
  "el-born": { label: "El Born / Sant Pere / Santa Caterina", macro: "old-town" },
  "sant-pere": { label: "El Born / Sant Pere / Santa Caterina", macro: "old-town" },
  "santa-caterina": { label: "El Born / Sant Pere / Santa Caterina", macro: "old-town" },
  "les-corts": { label: "Sants / Les Corts", macro: "montjuic-southwest" },
  sants: { label: "Sants / Les Corts", macro: "montjuic-southwest" },
};

const macroAreaLabels = {
  "old-town": "Old Town",
  "central-grid": "Central Grid",
  "northwest-local": "Northwest Local",
  "coast-east": "Coast / East",
  "montjuic-southwest": "Montjuïc / Southwest",
};

const barcelonaEditorial = createNoopEditorialService({
  cityLabel: BARCELONA_LABEL,
});

const geocodeQuery = buildGeocodeQuery({
  items: barcelonaCatalog.allItems,
  findByName: barcelonaCatalog.findItemByName,
  searchLabel: BARCELONA_LABEL,
  countryLabel: BARCELONA_COUNTRY,
  defaultAreaLabel: BARCELONA_LABEL,
  userAgent: "Parranda Barcelona/1.0 (citypack-skeleton)",
});

function todayIsoDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BARCELONA_TIMEZONE,
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

module.exports = {
  key: BARCELONA_KEY,
  label: BARCELONA_LABEL,
  visibility: "beta",
  timezone: BARCELONA_TIMEZONE,
  locale: BARCELONA_LOCALE,
  currency: BARCELONA_CURRENCY,
  searchLabel: BARCELONA_LABEL,
  editorialAreaLabel: BARCELONA_LABEL,
  fallbackLabel: BARCELONA_LABEL,
  center: BARCELONA_CENTER,
  todayIsoDate,
  catalog: {
    routeTemplates: barcelonaCatalog.routeTemplates,
    allItems: barcelonaCatalog.allItems,
    findItemByName: barcelonaCatalog.findItemByName,
  },
  services: {
    geocodeQuery,
    fetchWeatherForDates(dates, anchor = BARCELONA_CENTER) {
      return fetchWeatherForDates(dates, anchor, { timezone: BARCELONA_TIMEZONE });
    },
    getCityPulse: barcelonaEditorial.getCityPulse,
    getDateSignals: barcelonaEditorial.getDateSignals,
    fetchLiveEventsForDates,
    pulseSourceProviders: [
      createOpenDataBcnAgendaProvider(),
      createWeatherContextProvider(),
    ],
    signalGenerators: [],
  },
  walking: {
    defaultProvider: "heuristic",
    truthPassTopCandidates: 4,
    requestTimeoutMs: 3500,
  },
  routing: {
    areaDefinitions,
    macroAreaLabels,
    tuning: {},
  },
  localTruth: {
    calendar: [],
    rules: [],
  },
  sources: barcelonaSources,
};
