/**
 * @typedef {{ lat: number, lng: number }} CityPoint
 *
 * @typedef {{
 *   routeTemplates: unknown[],
 *   allItems: unknown[],
 *   findItemByName: (name: string) => unknown
 * }} CityCatalog
 *
 * @typedef {{
 *   geocodeQuery: (...args: unknown[]) => Promise<unknown>,
 *   fetchWeatherForDates: (dates: string[], anchor?: CityPoint) => Promise<Record<string, unknown>>,
 *   getCityPulse: (...args: unknown[]) => Promise<unknown>,
 *   getDateSignals: (...args: unknown[]) => Promise<unknown>,
 *   fetchLiveEventsForDates: (...args: unknown[]) => Promise<unknown>
 * }} CityServices
 *
 * @typedef {{
 *   defaultProvider: string,
 *   osrmBaseUrl?: string,
 *   truthPassTopCandidates: number,
 *   requestTimeoutMs: number
 * }} CityWalkingConfig
 *
 * @typedef {{
 *   areaDefinitions: Record<string, { label: string, macro: string }>,
 *   macroAreaLabels: Record<string, string>,
 *   tuning: Record<string, unknown>
 * }} CityRoutingConfig
 *
 * @typedef {{
 *   key: string,
 *   label: string,
 *   timezone: string,
 *   locale: string,
 *   currency: string,
 *   center: CityPoint,
 *   todayIsoDate: () => string,
 *   catalog: CityCatalog,
 *   services: CityServices,
 *   walking: CityWalkingConfig,
 *   routing: CityRoutingConfig,
 *   searchLabel?: string,
 *   editorialAreaLabel?: string,
 *   fallbackLabel?: string
 * }} CityConfig
 */

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} måste vara en icke-tom sträng`);
  }
}

function assertFunction(value, label) {
  if (typeof value !== "function") {
    throw new Error(`${label} måste vara en funktion`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} måste vara ett objekt`);
  }
}

function assertPositiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} måste vara ett positivt nummer`);
  }
}

/**
 * @param {CityConfig} cityConfig
 * @returns {CityConfig}
 */
function validateCityConfig(cityConfig) {
  assertObject(cityConfig, "City config");
  assertNonEmptyString(cityConfig.key, "city.key");
  assertNonEmptyString(cityConfig.label, `city(${cityConfig.key}).label`);
  assertNonEmptyString(cityConfig.timezone, `city(${cityConfig.key}).timezone`);
  assertNonEmptyString(cityConfig.locale, `city(${cityConfig.key}).locale`);
  assertNonEmptyString(cityConfig.currency, `city(${cityConfig.key}).currency`);
  assertFunction(cityConfig.todayIsoDate, `city(${cityConfig.key}).todayIsoDate`);

  assertObject(cityConfig.center, `city(${cityConfig.key}).center`);
  assertPositiveNumber(cityConfig.center.lat, `city(${cityConfig.key}).center.lat`);
  assertPositiveNumber(cityConfig.center.lng, `city(${cityConfig.key}).center.lng`);

  assertObject(cityConfig.catalog, `city(${cityConfig.key}).catalog`);
  if (!Array.isArray(cityConfig.catalog.routeTemplates)) {
    throw new Error(`city(${cityConfig.key}).catalog.routeTemplates måste vara en array`);
  }
  if (!Array.isArray(cityConfig.catalog.allItems)) {
    throw new Error(`city(${cityConfig.key}).catalog.allItems måste vara en array`);
  }
  assertFunction(cityConfig.catalog.findItemByName, `city(${cityConfig.key}).catalog.findItemByName`);

  assertObject(cityConfig.services, `city(${cityConfig.key}).services`);
  [
    "geocodeQuery",
    "fetchWeatherForDates",
    "getCityPulse",
    "getDateSignals",
    "fetchLiveEventsForDates",
  ].forEach((serviceKey) => {
    assertFunction(
      cityConfig.services[serviceKey],
      `city(${cityConfig.key}).services.${serviceKey}`,
    );
  });

  assertObject(cityConfig.walking, `city(${cityConfig.key}).walking`);
  assertNonEmptyString(
    cityConfig.walking.defaultProvider,
    `city(${cityConfig.key}).walking.defaultProvider`,
  );
  assertPositiveNumber(
    cityConfig.walking.truthPassTopCandidates,
    `city(${cityConfig.key}).walking.truthPassTopCandidates`,
  );
  assertPositiveNumber(
    cityConfig.walking.requestTimeoutMs,
    `city(${cityConfig.key}).walking.requestTimeoutMs`,
  );

  assertObject(cityConfig.routing, `city(${cityConfig.key}).routing`);
  assertObject(
    cityConfig.routing.areaDefinitions,
    `city(${cityConfig.key}).routing.areaDefinitions`,
  );
  assertObject(
    cityConfig.routing.macroAreaLabels,
    `city(${cityConfig.key}).routing.macroAreaLabels`,
  );
  assertObject(cityConfig.routing.tuning, `city(${cityConfig.key}).routing.tuning`);

  return cityConfig;
}

module.exports = {
  validateCityConfig,
};
