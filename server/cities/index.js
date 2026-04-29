const rome = require("./rome");

const cityConfigs = {
  rome,
};

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
};
