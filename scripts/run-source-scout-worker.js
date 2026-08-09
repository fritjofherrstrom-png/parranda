#!/usr/bin/env node
"use strict";

const {
  discoverLocalEventSourcesForPlace,
} = require("../server/pulse-sources/place-event-source-scout");
const {
  createOperatorRuntime,
} = require("./scout-local-event-sources");

const MAX_BATCH_SIZE = 5;
const MIN_INTERVAL_MS = 30_000;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

async function runScoutWorkerBatch({
  catalog,
  runtime,
  limit = 1,
  discover = discoverLocalEventSourcesForPlace,
} = {}) {
  if (!catalog || typeof catalog.claimScoutTarget !== "function") {
    return { status: "unavailable", reason: "source_catalog_unavailable", claimed: 0, completed: 0, failed: 0 };
  }
  const batchLimit = clampInteger(limit, 1, MAX_BATCH_SIZE);
  const summary = { status: "ok", claimed: 0, completed: 0, failed: 0, results: [] };

  for (let index = 0; index < batchLimit; index += 1) {
    const target = await catalog.claimScoutTarget();
    if (!target) break;
    summary.claimed += 1;
    const outcome = await scoutTarget({ target, catalog, runtime, discover });
    summary.results.push(outcome);
    if (outcome.status === "completed") summary.completed += 1;
    else summary.failed += 1;
  }
  if (!summary.claimed) summary.status = "idle";
  else if (summary.failed) summary.status = summary.completed ? "partial" : "failed";
  return summary;
}

async function scoutTarget({ target, catalog, runtime, discover }) {
  let result;
  try {
    result = await discover({
      placeQuery: target.place_label,
      // Reuse the resolver-attested target snapshot. The worker must not
      // reinterpret the user's original query or drift to another homonym.
      placeResolver: async () => [{
        label: target.place_label,
        lat: target.anchor.lat,
        lng: target.anchor.lng,
        confidence: "high",
        provenance: "source_catalog_scout_target",
        admin_context: target.place_context,
        spatial_scope: target.spatial_scope,
      }],
      openDataLoader: runtime?.openDataLoader,
      sourceScout: runtime?.sourceScout,
      bounds: target.spatial_scope?.bounds || null,
      cache: runtime?.scoutCache || null,
      scoutOptions: runtime?.scoutOptions || {},
    });
  } catch (_error) {
    result = { status: "failed", reasons: ["source_scout_worker_failed"] };
  }

  const reason = compactReason(result);
  if (["blocked", "failed", "unavailable"].includes(result?.status)) {
    const failed = await catalog.failScoutTarget(target, reason);
    return { target_key: target.target_key, status: "failed", reason, catalog_status: failed.status };
  }
  if (result?.status === "empty") {
    const completed = await catalog.completeScoutTarget(target, reason);
    return {
      target_key: target.target_key,
      status: completed?.status === "completed" ? "completed" : "failed",
      reason,
      profile_key: null,
      catalog_status: completed?.status || "failed",
    };
  }
  if (!result?.source_profile) {
    const failed = await catalog.failScoutTarget(target, "source_profile_unavailable");
    return {
      target_key: target.target_key,
      status: "failed",
      reason: "source_profile_unavailable",
      catalog_status: failed.status,
    };
  }

  const recorded = await catalog.recordDiscovery(result.source_profile);
  if (recorded?.status !== "recorded") {
    const failed = await catalog.failScoutTarget(target, recorded?.reason || "source_catalog_write_failed");
    return {
      target_key: target.target_key,
      status: "failed",
      reason: recorded?.reason || "source_catalog_write_failed",
      catalog_status: failed.status,
    };
  }
  const completed = await catalog.completeScoutTarget(target, reason);
  return {
    target_key: target.target_key,
    status: completed?.status === "completed" ? "completed" : "failed",
    reason,
    profile_key: recorded.profile_key,
    catalog_status: completed?.status || "failed",
  };
}

async function main(argv = process.argv.slice(2), options = {}) {
  const parsed = parseArguments(argv);
  const output = options.output || process.stdout;
  const errorOutput = options.errorOutput || process.stderr;
  if (parsed.errors.length) {
    errorOutput.write("Usage: node scripts/run-source-scout-worker.js [--watch] [--limit 1-5] [--interval-ms >=30000]\n");
    return 1;
  }
  const runtime = options.runtime || createOperatorRuntime(options.env || process.env);
  const catalog = options.catalog || runtime.sourceCatalog;
  const waitForNextPoll = options.wait || ((ms) => wait(ms, options.signal));
  if (!catalog) {
    writeJson(output, { status: "unavailable", reason: "source_catalog_unavailable" });
    return 1;
  }

  if (!parsed.watch) {
    const result = await runScoutWorkerBatch({ catalog, runtime, limit: parsed.limit, discover: options.discover });
    writeJson(output, result);
    if (typeof catalog.close === "function") await catalog.close();
    return result.status === "failed" || result.status === "unavailable" ? 1 : 0;
  }

  const shouldStop = options.shouldStop || (() => false);
  do {
    writeJson(output, await runScoutWorkerBatch({ catalog, runtime, limit: parsed.limit, discover: options.discover }));
    if (shouldStop()) break;
    await waitForNextPoll(parsed.intervalMs);
  } while (!shouldStop());
  if (typeof catalog.close === "function") await catalog.close();
  return 0;
}

function parseArguments(argv = []) {
  const parsed = { watch: false, limit: 1, intervalMs: DEFAULT_INTERVAL_MS, errors: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--watch") {
      parsed.watch = true;
      continue;
    }
    if (argument === "--limit" || argument === "--interval-ms") {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value)) parsed.errors.push(`invalid_${argument.slice(2)}`);
      else if (argument === "--limit" && (value < 1 || value > MAX_BATCH_SIZE)) parsed.errors.push("invalid_limit");
      else if (argument === "--interval-ms" && value < MIN_INTERVAL_MS) parsed.errors.push("invalid_interval_ms");
      else if (argument === "--limit") parsed.limit = Math.floor(value);
      else parsed.intervalMs = Math.floor(value);
      index += 1;
      continue;
    }
    parsed.errors.push("unknown_argument");
  }
  return parsed;
}

function compactReason(result) {
  const reason = Array.isArray(result?.reasons) ? result.reasons[0] : null;
  const token = typeof reason === "string" ? reason.trim().toLowerCase() : "";
  return /^[a-z0-9_:-]{1,120}$/.test(token) ? token : "source_scout_completed";
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(Number(value) || min)));
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function writeJson(output, value) {
  output.write(`${JSON.stringify(value)}\n`);
}

if (require.main === module) {
  let stopping = false;
  const stopController = new AbortController();
  const stop = () => {
    stopping = true;
    stopController.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  main(process.argv.slice(2), {
    shouldStop: () => stopping,
    signal: stopController.signal,
  }).then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.stderr.write("Source scout worker failed safely.\n");
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  MAX_BATCH_SIZE,
  MIN_INTERVAL_MS,
  main,
  parseArguments,
  runScoutWorkerBatch,
  scoutTarget,
};
