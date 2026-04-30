const catalog = require("./catalog");
const { buildGeocodeQuery } = require("../../geocoding");

const geocodeQuery = buildGeocodeQuery({
  items: catalog.allItems,
  findByName: catalog.findItemByName,
  searchLabel: "Rome",
  countryLabel: "Italy",
  defaultAreaLabel: "Rom",
  userAgent: "Parranda Rome/1.0 (route-planner)",
});

module.exports = {
  geocodeQuery,
};
