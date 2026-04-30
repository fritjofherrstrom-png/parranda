const rome = require("./rome");
const { validateCityConfig } = require("./contract");

function buildCityRegistry(configs) {
  return Object.values(configs).reduce((registry, cityConfig) => {
    const validated = validateCityConfig(cityConfig);
    registry[validated.key] = validated;
    return registry;
  }, {});
}

const cityConfigs = buildCityRegistry({
  rome,
});

function normalizeCityKey(city) {
  return String(city || "rome").trim().toLowerCase() || "rome";
}

function getCityConfig(city) {
  const cityKey = normalizeCityKey(city);
  return cityConfigs[cityKey] || cityConfigs.rome;
}

module.exports = {
  getCityConfig,
  normalizeCityKey,
  cityConfigs,
};
