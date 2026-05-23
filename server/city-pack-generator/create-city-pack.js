const fs = require("node:fs");
const path = require("node:path");

const VALID_VISIBILITIES = new Set(["preview", "internal"]);
const REQUIRED_FIELDS = ["key", "label", "timezone", "locale", "currency", "lat", "lng"];

function createCityPackSkeleton(options = {}) {
  const normalized = normalizeOptions(options);
  const files = buildCityPackFiles(normalized);
  const targetDir = path.join(normalized.outputRoot, normalized.key);
  const filePlans = files.map((file) => ({
    path: path.join(targetDir, file.name),
    content: file.content,
  }));

  if (normalized.dryRun) {
    return {
      city: normalized,
      targetDir,
      files: filePlans.map((file) => file.path),
      written: false,
    };
  }

  if (fs.existsSync(targetDir)) {
    if (!normalized.force) {
      throw new Error(
        `City folder already exists: ${targetDir}. Pass --force to overwrite generated skeleton files.`,
      );
    }
  }

  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of filePlans) {
    fs.writeFileSync(file.path, file.content, "utf8");
  }

  return {
    city: normalized,
    targetDir,
    files: filePlans.map((file) => file.path),
    written: true,
  };
}

function normalizeOptions(options = {}) {
  const missing = REQUIRED_FIELDS.filter((field) => options[field] === undefined || options[field] === "");
  if (missing.length) {
    throw new Error(`Missing required option(s): ${missing.join(", ")}`);
  }

  const key = String(options.key).trim();
  validateCityKey(key);

  const label = requireNonEmptyString(options.label, "label");
  const timezone = requireNonEmptyString(options.timezone, "timezone");
  const locale = requireNonEmptyString(options.locale, "locale");
  const currency = requireNonEmptyString(options.currency, "currency");
  const lat = parseCoordinate(options.lat, "lat", -90, 90);
  const lng = parseCoordinate(options.lng, "lng", -180, 180);
  const visibility = String(options.visibility || "preview").trim();
  if (!VALID_VISIBILITIES.has(visibility)) {
    throw new Error("visibility must be preview or internal");
  }

  const outputRoot = path.resolve(
    options.outputRoot || path.join(process.cwd(), "server", "cities"),
  );

  return {
    key,
    constantPrefix: buildConstantPrefix(key),
    label,
    timezone,
    locale,
    currency,
    lat,
    lng,
    visibility,
    outputRoot,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
  };
}

function buildCityPackFiles(city) {
  return [
    {
      name: "catalog.js",
      content: buildCatalogFile(city),
    },
    {
      name: "index.js",
      content: buildIndexFile(city),
    },
  ];
}

function buildCatalogFile(city) {
  return `const routeTemplates = [];
const allItems = [];

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function findItemByName(name) {
  const normalized = normalize(name);
  if (!normalized) return null;
  return (
    allItems.find((item) => normalize(item.name) === normalized) ||
    allItems.find((item) => (item.searchTerms || []).some((term) => normalize(term) === normalized)) ||
    null
  );
}

module.exports = {
  routeTemplates,
  allItems,
  findItemByName,
};
`;
}

function buildIndexFile(city) {
  const prefix = city.constantPrefix;

  return `const cityCatalog = require("./catalog");

const ${prefix}_KEY = ${formatString(city.key)};
const ${prefix}_LABEL = ${formatString(city.label)};
const ${prefix}_TIMEZONE = ${formatString(city.timezone)};
const ${prefix}_LOCALE = ${formatString(city.locale)};
const ${prefix}_CURRENCY = ${formatString(city.currency)};
const ${prefix}_CENTER = { lat: ${formatNumber(city.lat)}, lng: ${formatNumber(city.lng)} };

const noopServices = optionalRequire("../noop-services");
const geocoding = optionalRequire("../../geocoding");
const weather = optionalRequire("../../weather");

const ${lowerCamel(prefix)}Editorial = createEditorialService(${prefix}_LABEL);
const geocodeQuery = createGeocodeQuery();

function todayIsoDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ${prefix}_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return \`\${values.year}-\${values.month}-\${values.day}\`;
}

function optionalRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (_error) {
    return null;
  }
}

function createEditorialService(cityLabel) {
  if (noopServices?.createNoopEditorialService) {
    return noopServices.createNoopEditorialService({ cityLabel });
  }

  return {
    getCityPulse(dateString) {
      return {
        date: dateString || null,
        weekday_label: null,
        date_label: null,
        headline: \`\${cityLabel} is in preview\`,
        subhead: \`Curated Pulse is not ready for \${cityLabel} yet.\`,
        note: null,
        footer_note: null,
        _noop: true,
        items: [],
        moments: [],
        official_events: [],
        wildcards: [],
      };
    },
    getDateSignals() {
      return [];
    },
  };
}

function createGeocodeQuery() {
  if (geocoding?.buildGeocodeQuery) {
    return geocoding.buildGeocodeQuery({
      items: cityCatalog.allItems,
      findByName: cityCatalog.findItemByName,
      searchLabel: ${prefix}_LABEL,
      countryLabel: ${prefix}_LABEL,
      defaultAreaLabel: ${prefix}_LABEL,
      userAgent: \`Parranda \${${prefix}_LABEL}/1.0 (citypack-skeleton)\`,
    });
  }

  return async function geocodeQuery() {
    return [];
  };
}

async function fetchWeatherForDates(dates, anchor = ${prefix}_CENTER) {
  if (weather?.fetchWeatherForDates) {
    return weather.fetchWeatherForDates(dates, anchor, { timezone: ${prefix}_TIMEZONE });
  }

  const safeDates = Array.isArray(dates) ? dates : [];
  return safeDates.reduce((accumulator, date) => {
    accumulator[date] = null;
    return accumulator;
  }, {});
}

function fetchLiveEventsForDates(dates = []) {
  if (noopServices?.createNoopLiveEventsService) {
    return noopServices.createNoopLiveEventsService()(dates);
  }

  const safeDates = Array.isArray(dates) ? dates : [];
  return Promise.resolve(
    safeDates.reduce((accumulator, date) => {
      accumulator[date] = [];
      return accumulator;
    }, {}),
  );
}

module.exports = {
  key: ${prefix}_KEY,
  label: ${prefix}_LABEL,
  visibility: ${formatString(city.visibility)},
  timezone: ${prefix}_TIMEZONE,
  locale: ${prefix}_LOCALE,
  currency: ${prefix}_CURRENCY,
  searchLabel: ${prefix}_LABEL,
  editorialAreaLabel: ${prefix}_LABEL,
  fallbackLabel: ${prefix}_LABEL,
  center: ${prefix}_CENTER,
  todayIsoDate,
  catalog: {
    routeTemplates: cityCatalog.routeTemplates,
    allItems: cityCatalog.allItems,
    findItemByName: cityCatalog.findItemByName,
  },
  services: {
    geocodeQuery,
    fetchWeatherForDates,
    getCityPulse: ${lowerCamel(prefix)}Editorial.getCityPulse,
    getDateSignals: ${lowerCamel(prefix)}Editorial.getDateSignals,
    fetchLiveEventsForDates,
    signalGenerators: [],
  },
  walking: {
    defaultProvider: "heuristic",
    truthPassTopCandidates: 4,
    requestTimeoutMs: 3500,
  },
  routing: {
    areaDefinitions: {
      center: { label: "Center", macro: "center" },
    },
    macroAreaLabels: {
      center: "Center",
    },
    tuning: {},
  },
  localTruth: {
    calendar: [],
    rules: [],
  },
};
`;
}

function validateCityKey(key) {
  if (!/^[a-z][a-z0-9-]*$/.test(key)) {
    throw new Error(
      "city key must use lowercase letters, numbers, and hyphens only, and must start with a letter",
    );
  }
  if (key.includes("..") || key.includes("/") || key.includes("\\")) {
    throw new Error("city key cannot include path traversal or slashes");
  }
}

function requireNonEmptyString(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return normalized;
}

function parseCoordinate(value, label, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be a valid coordinate between ${min} and ${max}`);
  }
  return parsed;
}

function buildConstantPrefix(key) {
  return key
    .split("-")
    .map((part) => part.toUpperCase())
    .join("_");
}

function lowerCamel(constantPrefix) {
  return constantPrefix
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_match, char) => char.toUpperCase());
}

function formatString(value) {
  return JSON.stringify(value);
}

function formatNumber(value) {
  return Number(value).toString();
}

module.exports = {
  buildCityPackFiles,
  createCityPackSkeleton,
  normalizeOptions,
  validateCityKey,
};
