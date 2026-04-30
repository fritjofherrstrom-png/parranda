const rome = require("./rome");
const testCity = require("./test-city");
const { validateCityConfig } = require("./contract");
const DEFAULT_CITY_KEY = "rome";

function buildCityRegistry(configs) {
  return Object.values(configs).reduce((registry, cityConfig) => {
    const validated = validateCityConfig(cityConfig);
    registry[validated.key] = validated;
    return registry;
  }, {});
}

const cityConfigs = buildCityRegistry({
  rome,
  [testCity.key]: testCity,
});

function normalizeCityKey(city) {
  return String(city || "").trim().toLowerCase();
}

function resolveCityConfig(city, options = {}) {
  const { fallbackKey = DEFAULT_CITY_KEY, allowFallback = true } = options;
  const requestedKey = normalizeCityKey(city) || null;
  const matchedKey = requestedKey && cityConfigs[requestedKey] ? requestedKey : null;
  const defaultKey = cityConfigs[fallbackKey] ? fallbackKey : DEFAULT_CITY_KEY;

  if (matchedKey) {
    return {
      requestedKey,
      matchedKey,
      resolvedKey: matchedKey,
      cityConfig: cityConfigs[matchedKey],
      found: true,
      fallbackUsed: false,
      defaultUsed: false,
    };
  }

  if (!allowFallback) {
    return {
      requestedKey,
      matchedKey: null,
      resolvedKey: null,
      cityConfig: null,
      found: false,
      fallbackUsed: false,
      defaultUsed: false,
    };
  }

  return {
    requestedKey,
    matchedKey: null,
    resolvedKey: defaultKey,
    cityConfig: cityConfigs[defaultKey],
    found: false,
    fallbackUsed: Boolean(requestedKey),
    defaultUsed: !requestedKey,
  };
}

function getCityConfig(city, options = {}) {
  return resolveCityConfig(city, options).cityConfig;
}

module.exports = {
  getCityConfig,
  normalizeCityKey,
  resolveCityConfig,
  cityConfigs,
};
