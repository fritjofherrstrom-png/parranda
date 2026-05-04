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
 *   id: string,
 *   title?: string,
 *   month: number,
 *   day: number
 * }} CityLocalTruthCalendarEntry
 *
 * @typedef {{
 *   id: string,
 *   type: string,
 *   match?: Record<string, unknown>,
 *   effects?: Record<string, unknown>,
 *   evaluate?: (context: Record<string, unknown>) => Record<string, unknown>
 * }} CityLocalTruthRule
 *
 * @typedef {{
 *   calendar: CityLocalTruthCalendarEntry[],
 *   rules: CityLocalTruthRule[]
 * }} CityLocalTruthConfig
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
 *   localTruth?: CityLocalTruthConfig,
 *   searchLabel?: string,
 *   editorialAreaLabel?: string,
 *   fallbackLabel?: string,
 *   visibility?: string
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

function assertCoordinateInRange(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} måste vara ett giltigt koordinatvärde mellan ${min} och ${max}`);
  }
}

function assertIntegerInRange(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} måste vara ett heltal mellan ${min} och ${max}`);
  }
}

function validateLocalTruthConfig(cityKey, localTruth) {
  assertObject(localTruth, `city(${cityKey}).localTruth`);

  if (!Array.isArray(localTruth.calendar)) {
    throw new Error(`city(${cityKey}).localTruth.calendar måste vara en array`);
  }

  if (!Array.isArray(localTruth.rules)) {
    throw new Error(`city(${cityKey}).localTruth.rules måste vara en array`);
  }

  localTruth.calendar.forEach((entry, index) => {
    assertObject(entry, `city(${cityKey}).localTruth.calendar[${index}]`);
    assertNonEmptyString(entry.id, `city(${cityKey}).localTruth.calendar[${index}].id`);
    assertIntegerInRange(entry.month, 1, 12, `city(${cityKey}).localTruth.calendar[${index}].month`);
    assertIntegerInRange(entry.day, 1, 31, `city(${cityKey}).localTruth.calendar[${index}].day`);
    if (entry.title !== undefined) {
      assertNonEmptyString(entry.title, `city(${cityKey}).localTruth.calendar[${index}].title`);
    }
  });

  localTruth.rules.forEach((rule, index) => {
    assertObject(rule, `city(${cityKey}).localTruth.rules[${index}]`);
    assertNonEmptyString(rule.id, `city(${cityKey}).localTruth.rules[${index}].id`);
    assertNonEmptyString(rule.type, `city(${cityKey}).localTruth.rules[${index}].type`);
    if (rule.match !== undefined) {
      assertObject(rule.match, `city(${cityKey}).localTruth.rules[${index}].match`);
    }
    if (rule.effects !== undefined) {
      assertObject(rule.effects, `city(${cityKey}).localTruth.rules[${index}].effects`);
    }
    if (rule.evaluate !== undefined) {
      assertFunction(rule.evaluate, `city(${cityKey}).localTruth.rules[${index}].evaluate`);
    }
  });
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
  assertCoordinateInRange(cityConfig.center.lat, -90, 90, `city(${cityConfig.key}).center.lat`);
  assertCoordinateInRange(cityConfig.center.lng, -180, 180, `city(${cityConfig.key}).center.lng`);

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

  if (cityConfig.localTruth !== undefined) {
    validateLocalTruthConfig(cityConfig.key, cityConfig.localTruth);
  }

  return cityConfig;
}

module.exports = {
  validateCityConfig,
};
