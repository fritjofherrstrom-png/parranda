const test = require("node:test");
const assert = require("node:assert/strict");

const rome = require("../server/cities/rome");
const testCity = require("../server/cities/test-city");
const { cityConfigs, getCityConfig, normalizeCityKey, resolveCityConfig } = require("../server/cities");
const { validateCityConfig } = require("../server/cities/contract");

test("rome uppfyller city-kontraktet", () => {
  assert.doesNotThrow(() => validateCityConfig(rome));
  assert.equal(cityConfigs.rome.key, "rome");
  assert.equal(cityConfigs.rome.timezone, "Europe/Rome");
  assert.equal(cityConfigs.rome.locale, "sv-SE");
  assert.equal(cityConfigs.rome.currency, "EUR");
});

test("test-city uppfyller city-kontraktet utan fallback", () => {
  assert.doesNotThrow(() => validateCityConfig(testCity));
  const resolution = resolveCityConfig("test-city", { allowFallback: false });
  assert.equal(resolution.cityConfig.key, "test-city");
  assert.equal(resolution.fallbackUsed, false);
  assert.equal(resolution.found, true);
  assert.equal(getCityConfig("test-city").key, "test-city");
  assert.equal(cityConfigs["test-city"].currency, "MXN");
});

test("test-city är markerad som intern arkitekturstub", () => {
  assert.equal(testCity.visibility, "internal");
  assert.equal(cityConfigs["test-city"].visibility, "internal");
});

test("city-kontraktet accepterar giltiga globala koordinater", () => {
  assert.doesNotThrow(() =>
    validateCityConfig({
      ...rome,
      key: "test-city",
      label: "Test City",
      center: { lat: -34.6037, lng: -58.3816 },
    }),
  );
});

test("city-registret kan avslöja unknown city även när publik fallback används", () => {
  assert.equal(normalizeCityKey("ROME"), "rome");
  const resolution = resolveCityConfig("unknown-city");
  assert.equal(resolution.cityConfig.key, "rome");
  assert.equal(resolution.requestedKey, "unknown-city");
  assert.equal(resolution.fallbackUsed, true);
  assert.equal(resolution.found, false);
  assert.equal(getCityConfig().key, "rome");
});

test("city-registret kan köras utan fallback för interna kontroller", () => {
  const resolution = resolveCityConfig("unknown-city", { allowFallback: false });
  assert.equal(resolution.cityConfig, null);
  assert.equal(resolution.resolvedKey, null);
  assert.equal(resolution.found, false);
  assert.equal(resolution.fallbackUsed, false);
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
