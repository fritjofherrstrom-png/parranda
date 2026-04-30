const test = require("node:test");
const assert = require("node:assert/strict");

const rome = require("../server/cities/rome");
const { cityConfigs, getCityConfig, normalizeCityKey } = require("../server/cities");
const { validateCityConfig } = require("../server/cities/contract");

test("rome uppfyller city-kontraktet", () => {
  assert.doesNotThrow(() => validateCityConfig(rome));
  assert.equal(cityConfigs.rome.key, "rome");
  assert.equal(cityConfigs.rome.timezone, "Europe/Rome");
  assert.equal(cityConfigs.rome.locale, "sv-SE");
  assert.equal(cityConfigs.rome.currency, "EUR");
});

test("city-registret faller tillbaka till rome på okända nycklar", () => {
  assert.equal(normalizeCityKey("ROME"), "rome");
  assert.equal(getCityConfig("unknown-city").key, "rome");
  assert.equal(getCityConfig().key, "rome");
});

test("city-kontraktet stoppar trasiga city packs tidigt", () => {
  assert.throws(
    () =>
      validateCityConfig({
        key: "broken",
        label: "Broken",
        timezone: "Europe/Stockholm",
        locale: "sv-SE",
        currency: "EUR",
        center: { lat: 1, lng: 2 },
        todayIsoDate: () => "2026-04-30",
        catalog: {
          routeTemplates: [],
          allItems: [],
          findItemByName: () => null,
        },
        services: {
          geocodeQuery: async () => ({}),
          fetchWeatherForDates: async () => ({}),
          getCityPulse: async () => ({}),
          getDateSignals: async () => [],
        },
        walking: {
          defaultProvider: "heuristic",
          truthPassTopCandidates: 5,
          requestTimeoutMs: 4500,
        },
        routing: {
          areaDefinitions: {},
          macroAreaLabels: {},
          tuning: {},
        },
      }),
    /fetchLiveEventsForDates/,
  );
});
