const testCityCatalog = require("./catalog");
const { createNoopEditorialService, createNoopLiveEventsService } = require("../noop-services");
const { buildGeocodeQuery } = require("../../geocoding");
const { fetchWeatherForDates } = require("../../weather");

const TEST_CITY_KEY = "test-city";
const TEST_CITY_LABEL = "Test City";
const TEST_CITY_TIMEZONE = "America/Mexico_City";
const TEST_CITY_LOCALE = "en-US";
const TEST_CITY_CURRENCY = "MXN";
const TEST_CITY_CENTER = { lat: 19.4326, lng: -99.1332 };
const TEST_CITY_COUNTRY = "Testland";

const testCityEditorial = createNoopEditorialService({
  cityLabel: TEST_CITY_LABEL,
});

const geocodeQuery = buildGeocodeQuery({
  items: testCityCatalog.allItems,
  findByName: testCityCatalog.findItemByName,
  searchLabel: TEST_CITY_LABEL,
  countryLabel: TEST_CITY_COUNTRY,
  defaultAreaLabel: TEST_CITY_LABEL,
  userAgent: "Parranda Test City/1.0",
});

function todayIsoDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TEST_CITY_TIMEZONE,
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
  key: TEST_CITY_KEY,
  label: TEST_CITY_LABEL,
  visibility: "internal",
  timezone: TEST_CITY_TIMEZONE,
  locale: TEST_CITY_LOCALE,
  currency: TEST_CITY_CURRENCY,
  searchLabel: TEST_CITY_LABEL,
  editorialAreaLabel: TEST_CITY_LABEL,
  fallbackLabel: "Old Town",
  center: TEST_CITY_CENTER,
  todayIsoDate,
  catalog: {
    routeTemplates: testCityCatalog.routeTemplates,
    allItems: testCityCatalog.allItems,
    findItemByName: testCityCatalog.findItemByName,
  },
  services: {
    geocodeQuery,
    fetchWeatherForDates(dates, anchor = TEST_CITY_CENTER) {
      return fetchWeatherForDates(dates, anchor, { timezone: TEST_CITY_TIMEZONE });
    },
    getCityPulse: testCityEditorial.getCityPulse,
    getDateSignals: testCityEditorial.getDateSignals,
    fetchLiveEventsForDates: createNoopLiveEventsService(),
  },
  walking: {
    defaultProvider: "heuristic",
    truthPassTopCandidates: 4,
    requestTimeoutMs: 3500,
  },
  routing: {
    areaDefinitions: {
      "old-town": { label: "Old Town", macro: "center" },
      riverfront: { label: "Riverfront", macro: "west" },
      "market-quarter": { label: "Market Quarter", macro: "south" },
      north: { label: "North", macro: "north" },
      south: { label: "South", macro: "south" },
    },
    macroAreaLabels: {
      center: "centrala Test City",
      west: "riverfront Test City",
      north: "norra Test City",
      south: "södra Test City",
    },
    tuning: {},
  },
};
