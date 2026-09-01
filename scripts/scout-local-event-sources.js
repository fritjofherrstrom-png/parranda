#!/usr/bin/env node
"use strict";

/**
 * Operator/background harness for the bounded local-event source scout.
 *
 * Without --live it prints only the discovery query/seed plan. Network probing
 * is explicit and never part of normal tests or the user request path.
 *
 * Usage:
 *   node scripts/scout-local-event-sources.js scout-input.json
 *   node scripts/scout-local-event-sources.js scout-input.json --live
 *   node scripts/scout-local-event-sources.js --place "Place name" --live
 */

const fs = require("node:fs");
const path = require("node:path");

const { createSourceCache } = require("../server/place-candidates/source-cache");
const {
  createNominatimPlaceResolver,
} = require("../server/place-candidates/place-resolver");
const {
  createOpenDataLoader,
} = require("../server/place-candidates/open-data-loader");
const {
  createWikidataSource,
} = require("../server/place-candidates/wikidata-source");

const {
  buildLocalSourceDiscoveryQueries,
  extractEventWebsiteSeeds,
  scoutLocalEventSources,
} = require("../server/pulse-sources/local-event-source-scout");
const {
  discoverLocalEventSourcesForPlace,
} = require("../server/pulse-sources/place-event-source-scout");
const {
  resolveDefaultSourceProfileCatalog,
} = require("../server/pulse-sources/source-profile-catalog");
const {
  qualifyDiscoveredSourceProfile,
} = require("../server/pulse-sources/source-qualification");
const {
  qualifyDiscoveredPlaceSourceProfile,
} = require("../server/pulse-sources/place-source-qualification");
const {
  resolveDefaultSourceSearch,
} = require("../server/pulse-sources/source-search-provider");
const { fetchWeatherForDates } = require("../server/weather");

const USAGE = [
  "Usage:",
  "  node scripts/scout-local-event-sources.js input.json [--live]",
  '  node scripts/scout-local-event-sources.js --place "Place name" --live [--catalog] [--term local-term] [--intent intent]',
  "",
].join("\n");

async function main(argv = process.argv.slice(2), options = {}) {
  const output = options.output || process.stdout;
  const errorOutput = options.errorOutput || process.stderr;
  const parsed = parseArguments(argv);
  if (parsed.errors.length || (!parsed.inputPath && !parsed.place)) {
    errorOutput.write(USAGE);
    return 1;
  }

  if (parsed.place) {
    if (!parsed.live) {
      writeJson(output, {
        status: "plan_only",
        live_network_used: false,
        place_query: parsed.place,
        discovery_queries: buildLocalSourceDiscoveryQueries({
          place: { label: parsed.place },
          intentHints: parsed.intentHints,
          localDiscoveryTerms: parsed.localDiscoveryTerms,
        }),
        trusted_website_seeds: [],
        reasons: ["pass_--live_to_resolve_place_and_probe_sources"],
      });
      return 0;
    }

    const runtime =
      options.runtime || createOperatorRuntime(options.env || process.env);
    const result = await discoverLocalEventSourcesForPlace({
      placeQuery: parsed.place,
      placeResolver: runtime.placeResolver,
      openDataLoader: runtime.openDataLoader,
      sourceSearch: runtime.sourceSearch,
      sourceScout: runtime.sourceScout || scoutLocalEventSources,
      intentHints: parsed.intentHints,
      localDiscoveryTerms: parsed.localDiscoveryTerms,
      cache: runtime.scoutCache,
      scoutOptions: runtime.scoutOptions,
    });
    const catalogWrite = parsed.catalog
      ? await recordDiscoveryInCatalog(result, runtime.sourceCatalog)
      : null;
    writeJson(output, {
      ...result,
      live_network_used: true,
      ...(catalogWrite ? { catalog_write: catalogWrite } : {}),
    });
    return catalogWrite?.status === "failed" || catalogWrite?.status === "unavailable" ? 1 : 0;
  }

  let input;
  try {
    input = JSON.parse(fs.readFileSync(path.resolve(parsed.inputPath), "utf8"));
  } catch (_error) {
    errorOutput.write("Could not read a valid scout input JSON file.\n");
    return 1;
  }

  const recordSeeds = extractEventWebsiteSeeds(input.records);
  const seeds = [...(Array.isArray(input.seeds) ? input.seeds : []), ...recordSeeds];
  const base = {
    place: input.place || {},
    anchor: input.anchor || null,
    bounds: input.bounds || null,
    intentHints: Array.isArray(input.intent_hints) ? input.intent_hints : [],
    localDiscoveryTerms: Array.isArray(input.local_discovery_terms)
      ? input.local_discovery_terms
      : [],
    seeds,
  };

  if (!parsed.live) {
    writeJson(output, {
      status: "plan_only",
      live_network_used: false,
      discovery_queries: buildLocalSourceDiscoveryQueries(base),
      trusted_website_seeds: seeds,
      reasons: ["pass_--live_to_probe_reviewed_public_seeds"],
    });
    return 0;
  }

  const env = options.env || process.env;
  const configuredTtlMs = Number(env.PARRANDA_EVENT_SOURCE_SCOUT_CACHE_TTL_MS);
  const cache = createSourceCache({
    namespace: "local-event-source-scout",
    dir: env.PARRANDA_CACHE_DIR || null,
    ttlMs:
      Number.isFinite(configuredTtlMs) && configuredTtlMs > 0
        ? configuredTtlMs
        : undefined,
  });
  const result = await scoutLocalEventSources({ ...base, cache });
  writeJson(output, { ...result, live_network_used: true });
  return 0;
}

function parseArguments(argv = []) {
  const parsed = {
    live: false,
    catalog: false,
    place: null,
    inputPath: null,
    intentHints: [],
    localDiscoveryTerms: [],
    errors: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--live") {
      parsed.live = true;
      continue;
    }
    if (argument === "--catalog") {
      parsed.catalog = true;
      continue;
    }
    if (["--place", "--term", "--intent"].includes(argument)) {
      const value = argv[index + 1];
      if (typeof value !== "string" || !value.trim() || value.startsWith("--")) {
        parsed.errors.push(`missing_value:${argument.slice(2)}`);
        continue;
      }
      index += 1;
      if (argument === "--place") parsed.place = value.trim();
      if (argument === "--term") parsed.localDiscoveryTerms.push(value.trim());
      if (argument === "--intent") parsed.intentHints.push(value.trim());
      continue;
    }
    if (argument.startsWith("--")) {
      parsed.errors.push(`unknown_option:${argument.slice(2)}`);
      continue;
    }
    if (parsed.inputPath) {
      parsed.errors.push("multiple_input_files");
    } else {
      parsed.inputPath = argument;
    }
  }
  if (parsed.place && parsed.inputPath) parsed.errors.push("place_and_input_file_conflict");
  if (parsed.catalog && (!parsed.place || !parsed.live)) {
    parsed.errors.push("catalog_requires_live_place_mode");
  }
  return parsed;
}

function createOperatorRuntime(env = process.env) {
  const cacheDir = env.PARRANDA_CACHE_DIR || null;
  const configuredTtlMs = Number(env.PARRANDA_SOURCE_CACHE_TTL_MS);
  const ttlMs =
    Number.isFinite(configuredTtlMs) && configuredTtlMs > 0
      ? configuredTtlMs
      : undefined;
  const resolverRaw = createNominatimPlaceResolver({
    userAgent:
      env.PARRANDA_PLACE_RESOLVER_USER_AGENT ||
      "Parranda-Source-Scout/1.0 (+https://github.com/fritjofherrstrom-png/parranda)",
    endpoint: env.PARRANDA_PLACE_RESOLVER_ENDPOINT || undefined,
    timeoutMs: Number(env.PARRANDA_PLACE_RESOLVER_TIMEOUT_MS) || undefined,
  });
  const resolverCache = createSourceCache({
    namespace: "source-scout-place-resolver",
    dir: cacheDir,
    ttlMs,
  });
  const placeResolver =
    typeof resolverRaw === "function"
      ? (query) =>
          resolverCache.get(
            String(query).trim().toLocaleLowerCase("en-US"),
            () => resolverRaw(query),
            { shouldStore: (value) => Array.isArray(value) && value.length > 0 },
          )
      : null;

  const overpassCache = createSourceCache({
    namespace: "source-scout-overpass",
    dir: cacheDir,
    ttlMs,
  });
  const overpassEndpoints = String(env.PARRANDA_OVERPASS_ENDPOINTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const osmLoader = createOpenDataLoader({
    cache: overpassCache,
    ...(overpassEndpoints.length ? { endpoints: overpassEndpoints } : {}),
  });
  const labelLanguages = String(env.PARRANDA_WIKIDATA_LABEL_LANGS || "en")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const wikiRaw = createWikidataSource({ labelLanguages });
  const wikiCache = createSourceCache({
    namespace: "source-scout-wikidata",
    dir: cacheDir,
    ttlMs,
  });
  const wikiLoader =
    typeof wikiRaw === "function"
      ? ({ lat, lng }) =>
          wikiCache.get(
            `${lat.toFixed(3)},${lng.toFixed(3)}`,
            () => wikiRaw({ lat, lng }),
            { shouldStore: (value) => Array.isArray(value) && value.length > 0 },
          )
      : null;

  const scoutCache = createSourceCache({
    namespace: "local-event-source-scout",
    dir: cacheDir,
    ttlMs: Number(env.PARRANDA_EVENT_SOURCE_SCOUT_CACHE_TTL_MS) || undefined,
  });
  const sourceSearchCache = createSourceCache({
    namespace: "source-search-searxng",
    dir: cacheDir,
    ttlMs: Number(env.PARRANDA_SOURCE_SEARCH_CACHE_TTL_MS) || ttlMs,
  });
  return {
    placeResolver,
    openDataLoader:
      typeof osmLoader === "function" || typeof wikiLoader === "function"
        ? composeOperatorLoaders(osmLoader, wikiLoader)
        : null,
    sourceScout: scoutLocalEventSources,
    sourceSearch: resolveDefaultSourceSearch(env, { cache: sourceSearchCache }),
    sourceQualifier: qualifyDiscoveredSourceProfile,
    placeSourceQualifier: qualifyDiscoveredPlaceSourceProfile,
    timezoneResolver: createWeatherTimezoneResolver(),
    scoutCache,
    sourceCatalog: resolveDefaultSourceProfileCatalog(env),
  };
}

function createWeatherTimezoneResolver({ fetchWeather = fetchWeatherForDates } = {}) {
  return async function resolveTrustedTimezone(anchor, now = new Date()) {
    if (!Number.isFinite(anchor?.lat) || !Number.isFinite(anchor?.lng)) return null;
    const date = now instanceof Date && Number.isFinite(now.getTime())
      ? now.toISOString().slice(0, 10)
      : new Date(now).toISOString().slice(0, 10);
    try {
      const weather = await fetchWeather([date], anchor, { timezone: "auto" });
      const resolution = weather?.[date]?.timezone_resolution;
      return resolution?.timezone_source === "weather_provider_auto" &&
        typeof resolution.timezone === "string"
        ? {
            timezone: resolution.timezone,
            timezone_source: "weather_provider_auto",
            timezone_trust: "derived_from_weather_provider",
          }
        : null;
    } catch (_error) {
      return null;
    }
  };
}

async function recordDiscoveryInCatalog(result, catalog) {
  if (!catalog || typeof catalog.recordDiscovery !== "function") {
    return { status: "unavailable", reason: "source_catalog_unavailable" };
  }
  if (!result?.source_profile) {
    return { status: "failed", reason: "source_profile_unavailable" };
  }
  return catalog.recordDiscovery(result.source_profile);
}

function composeOperatorLoaders(osmLoader, wikiLoader) {
  return async function loadOperatorPlaceRecords(anchor) {
    const [osmResult, wikiResult] = await Promise.allSettled([
      typeof osmLoader === "function" ? osmLoader(anchor) : Promise.resolve([]),
      typeof wikiLoader === "function" ? wikiLoader(anchor) : Promise.resolve([]),
    ]);
    const osm = osmResult.status === "fulfilled" && Array.isArray(osmResult.value)
      ? osmResult.value
      : [];
    const wiki = wikiResult.status === "fulfilled" && Array.isArray(wikiResult.value)
      ? wikiResult.value
      : [];
    const records = [...osm, ...wiki];
    const osmStatus = typeof osm.loader_status === "string" ? osm.loader_status : null;
    const failed =
      osmResult.status === "rejected" ||
      (osmStatus && osmStatus.startsWith("error") && wiki.length === 0);
    Object.defineProperty(records, "loader_status", {
      value: failed ? "error_failed_closed" : `loaded:${records.length}`,
    });
    Object.defineProperty(records, "loader_error", {
      value: failed ? (osm.loader_error || "fetch_error") : null,
    });
    return records;
  };
}

function writeJson(output, value) {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.stderr.write("Source scout failed safely.\n");
    process.exitCode = 1;
  });
}

module.exports = {
  composeOperatorLoaders,
  createOperatorRuntime,
  createWeatherTimezoneResolver,
  main,
  parseArguments,
  recordDiscoveryInCatalog,
};
