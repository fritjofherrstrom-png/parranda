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
 */

const fs = require("node:fs");
const path = require("node:path");

const { createSourceCache } = require("../server/place-candidates/source-cache");

const {
  buildLocalEventDiscoveryQueries,
  extractEventWebsiteSeeds,
  scoutLocalEventSources,
} = require("../server/pulse-sources/local-event-source-scout");

async function main(argv = process.argv.slice(2)) {
  const inputPath = argv.find((arg) => !arg.startsWith("--"));
  if (!inputPath) {
    process.stderr.write(
      "Usage: node scripts/scout-local-event-sources.js input.json [--live]\n",
    );
    process.exitCode = 1;
    return;
  }

  let input;
  try {
    input = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
  } catch (_error) {
    process.stderr.write("Could not read a valid scout input JSON file.\n");
    process.exitCode = 1;
    return;
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

  if (!argv.includes("--live")) {
    process.stdout.write(
      JSON.stringify(
        {
          status: "plan_only",
          live_network_used: false,
          discovery_queries: buildLocalEventDiscoveryQueries(base),
          trusted_website_seeds: seeds,
          reasons: ["pass_--live_to_probe_reviewed_public_seeds"],
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const configuredTtlMs = Number(
    process.env.PARRANDA_EVENT_SOURCE_SCOUT_CACHE_TTL_MS,
  );
  const cache = createSourceCache({
    namespace: "local-event-source-scout",
    dir: process.env.PARRANDA_CACHE_DIR || null,
    ttlMs:
      Number.isFinite(configuredTtlMs) && configuredTtlMs > 0
        ? configuredTtlMs
        : undefined,
  });
  const result = await scoutLocalEventSources({ ...base, cache });
  process.stdout.write(
    JSON.stringify({ ...result, live_network_used: true }, null, 2) + "\n",
  );
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write("Source scout failed safely.\n");
    process.exitCode = 1;
  });
}

module.exports = { main };
