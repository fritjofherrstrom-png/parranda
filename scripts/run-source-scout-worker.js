#!/usr/bin/env node
"use strict";

const {
  discoverLocalEventSourcesForPlace,
} = require("../server/pulse-sources/place-event-source-scout");
const {
  createOperatorRuntime,
} = require("./scout-local-event-sources");
const {
  buildSourceDiscoveryHealth,
} = require("../server/pulse-sources/source-discovery-health");
const {
  collectReviewedPlaceFeedOutcome,
} = require("../server/place-candidates/schema-org-place-source");

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
  if (typeof catalog.claimApprovedPlaceSourceRefresh === "function") {
    const refreshTarget = await catalog.claimApprovedPlaceSourceRefresh();
    if (refreshTarget) {
      const refresh = await runApprovedPlaceSourceRefresh({
        catalog,
        runtime,
        target: refreshTarget,
        collect: runtime?.collectReviewedPlaceFeedOutcome,
      });
      summary.place_source_refresh = refresh;
      if (!["completed", "idle"].includes(refresh.status)) summary.failed += 1;
    }
  }
  if (!summary.claimed && !summary.place_source_refresh) summary.status = "idle";
  else if (summary.failed) summary.status = summary.completed ? "partial" : "failed";
  return summary;
}

async function runApprovedPlaceSourceRefresh({
  catalog,
  runtime = {},
  target,
  now = runtime?.now ? runtime.now() : new Date(),
  collect = collectReviewedPlaceFeedOutcome,
} = {}) {
  if (!target || typeof catalog?.recordApprovedPlaceSourceOutcome !== "function") {
    return { status: "unavailable", reason: "approved_place_source_refresh_unavailable" };
  }
  const observedAt = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(observedAt.getTime()) || typeof collect !== "function") {
    return { status: "failed", reason: "approved_place_source_refresh_invalid" };
  }
  let collected;
  try {
    collected = await collect(target.feed, {
      fetcher: runtime?.fetcher,
      timeoutMs: runtime?.placeSourceTimeoutMs,
      maxBytes: runtime?.placeSourceMaxBytes,
    });
  } catch (_error) {
    collected = { status: "failed", records: [] };
  }
  const status = ["ok", "empty"].includes(collected?.status) ? collected.status : "failed";
  const records = status === "ok"
    ? (Array.isArray(collected.records) ? collected.records : []).map((record) => ({
        ...record,
        source_profile_key: target.profile_key,
        source_profile_revision: target.profile_revision,
        source_approval_key: target.approval_key,
        source_feed_id: target.source_id,
        source_adapter: target.feed?.adapter,
        source_adapter_contract_revision: target.feed?.adapter_contract_revision,
        source_identity: target.feed?.source_identity,
        source_observed_at: observedAt.toISOString(),
      }))
    : [];
  const persisted = await catalog.recordApprovedPlaceSourceOutcome(target, {
    status,
    records,
    observed_at: observedAt.toISOString(),
    reason: status === "failed" ? "source_fetch_failed" : "source_fetch_complete",
  });
  return {
    profile_key: target.profile_key,
    source_id: target.source_id,
    status: persisted?.status || "failed",
    candidate_count: Number(persisted?.candidate_count) || 0,
    ...(persisted?.retry_at ? { retry_at: persisted.retry_at } : {}),
    ...(persisted?.reason ? { reason: persisted.reason } : {}),
  };
}

async function scoutTarget({ target, catalog, runtime, discover }) {
  const observedAt = runtime?.now ? runtime.now() : new Date();
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
      sourceSearch: runtime?.sourceSearch,
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
    const discoveryHealth = buildSourceDiscoveryHealth({ result, observedAt });
    const failed = await catalog.failScoutTarget(target, reason, { discoveryHealth });
    return {
      target_key: target.target_key,
      status: "failed",
      reason,
      catalog_status: failed.status,
      discovery_status: discoveryHealth.status,
    };
  }
  if (result?.status === "empty") {
    const discoveryHealth = buildSourceDiscoveryHealth({ result, observedAt });
    // An empty run has two very different causes. A clean search that found
    // nothing is an answer, and the target waits out the normal refresh. A
    // search that asked to be retried and found nothing is not an answer.
    if (searchRetryRequired(result?.source_search)) {
      const retried = await catalog.failScoutTarget(target, reason, { discoveryHealth });
      return {
        target_key: target.target_key,
        status: "retry_scheduled",
        reason,
        profile_key: null,
        catalog_status: retried.status,
        discovery_status: discoveryHealth.status,
        ...(retried.retry_at ? { retry_at: retried.retry_at } : {}),
      };
    }
    const completed = await catalog.completeScoutTarget(target, reason, { discoveryHealth });
    return {
      target_key: target.target_key,
      status: completed?.status === "completed" ? "completed" : "failed",
      reason,
      profile_key: null,
      catalog_status: completed?.status || "failed",
      discovery_status: discoveryHealth.status,
    };
  }
  if (!result?.source_profile) {
    const discoveryHealth = buildSourceDiscoveryHealth({
      result: { ...result, status: "failed", reasons: ["source_profile_unavailable"] },
      observedAt,
    });
    const failed = await catalog.failScoutTarget(target, "source_profile_unavailable", { discoveryHealth });
    return {
      target_key: target.target_key,
      status: "failed",
      reason: "source_profile_unavailable",
      catalog_status: failed.status,
      discovery_status: discoveryHealth.status,
    };
  }

  let profile = result.source_profile;
  let qualificationStatus = "not_run";
  let placeQualificationStatus = "not_run";
  let qualificationNow = null;
  if (typeof runtime?.sourceQualifier === "function") {
    try {
      qualificationNow = observedAt;
      const manifests = await attachTrustedTimezone(
        result.manifest_candidates,
        {
          timezoneResolver: runtime.timezoneResolver,
          anchor: target.anchor,
          now: qualificationNow,
        },
      );
      const previousQualification = typeof catalog.loadSourceQualification === "function"
        ? await catalog.loadSourceQualification(profile.profile_key)
        : null;
      const qualified = await runtime.sourceQualifier({
        profile,
        manifests,
        previousQualification,
        anchor: target.anchor,
        spatialScope: target.spatial_scope,
        placeContext: target.place_context,
        now: qualificationNow,
        fetcher: runtime.fetcher,
        venueResolver: runtime.placeResolver,
      });
      if (qualified?.profile) profile = qualified.profile;
      qualificationStatus = qualified?.qualification?.status || "unavailable";
    } catch (_error) {
      qualificationStatus = "failed";
    }
  }

  if (typeof runtime?.placeSourceQualifier === "function") {
    try {
      qualificationNow = qualificationNow || observedAt;
      const previousQualification = typeof catalog.loadPlaceSourceQualification === "function"
        ? await catalog.loadPlaceSourceQualification(profile.profile_key)
        : null;
      const qualified = await runtime.placeSourceQualifier({
        profile,
        manifests: result.place_manifest_candidates,
        previousQualification,
        anchor: target.anchor,
        spatialScope: target.spatial_scope,
        placeContext: target.place_context,
        now: qualificationNow,
        fetcher: runtime.fetcher,
      });
      if (qualified?.profile) profile = qualified.profile;
      placeQualificationStatus = qualified?.qualification?.status || "unavailable";
    } catch (_error) {
      placeQualificationStatus = "failed";
    }
  }

  const discoveryHealth = buildSourceDiscoveryHealth({
    result: { ...result, source_profile: profile },
    qualificationStatus,
    placeQualificationStatus,
    observedAt: qualificationNow || observedAt,
  });
  profile = { ...profile, discovery_health: discoveryHealth };

  const recorded = await catalog.recordDiscovery(profile);
  if (recorded?.status !== "recorded") {
    const failed = await catalog.failScoutTarget(
      target,
      recorded?.reason || "source_catalog_write_failed",
      { discoveryHealth },
    );
    return {
      target_key: target.target_key,
      status: "failed",
      reason: recorded?.reason || "source_catalog_write_failed",
      catalog_status: failed.status,
    };
  }
  // The discovery evidence is already recorded above and is kept. What is
  // still open is the source search, so the target returns on bounded backoff
  // rather than the ordinary refresh. Completing here would let unrelated
  // scout success hide a search that never ran.
  if (searchRetryRequired(result?.source_search)) {
    const retried = await catalog.failScoutTarget(target, reason, { discoveryHealth });
    return {
      target_key: target.target_key,
      status: "retry_scheduled",
      reason,
      profile_key: recorded.profile_key,
      catalog_status: retried.status,
      qualification_status: qualificationStatus,
      place_qualification_status: placeQualificationStatus,
      discovery_status: discoveryHealth.status,
      ...(retried.retry_at ? { retry_at: retried.retry_at } : {}),
    };
  }
  const completionOptions = [qualificationStatus, placeQualificationStatus].includes("observing")
    ? { nextAttemptAt: nextQualificationProbeAt(qualificationNow), discoveryHealth }
    : { discoveryHealth };
  const completed = await catalog.completeScoutTarget(target, reason, completionOptions);
  return {
    target_key: target.target_key,
    status: completed?.status === "completed" ? "completed" : "failed",
    reason,
    profile_key: recorded.profile_key,
    catalog_status: completed?.status || "failed",
    qualification_status: qualificationStatus,
    place_qualification_status: placeQualificationStatus,
    discovery_status: discoveryHealth.status,
  };
}

/**
 * The source-search retry invariant.
 *
 * A search that asked to be retried and produced no usable seed is a hole in
 * this target's evidence, whatever else the run achieved. Unrelated scout work
 * succeeding — trusted place records, a recorded profile, review state — does
 * not fill that hole, so it must not silently absorb it into the ordinary
 * multi-day refresh.
 *
 * Deliberately narrow: a search that retained usable seeds has already given
 * us something to work with, and a clean zero-result search is a real
 * observation rather than provider trouble. Neither retries.
 */
function searchRetryRequired(search) {
  if (!search || typeof search !== "object") return false;
  if (search.retry_recommended !== true) return false;
  return usableSearchSeedCount(search) === 0;
}

function usableSearchSeedCount(search) {
  for (const value of [search.accepted_seed_count, search.seed_count]) {
    const count = Number(value);
    if (Number.isFinite(count)) return Math.max(0, count);
  }
  return 0;
}

function nextQualificationProbeAt(value) {
  const observedAt = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(observedAt.getTime())) return null;
  return new Date(Date.UTC(
    observedAt.getUTCFullYear(),
    observedAt.getUTCMonth(),
    observedAt.getUTCDate() + 1,
    0,
    5,
  ));
}

async function attachTrustedTimezone(manifests, { timezoneResolver, anchor, now } = {}) {
  const rows = Array.isArray(manifests) ? manifests : [];
  if (!rows.some((manifest) => !manifest?.timezone) || typeof timezoneResolver !== "function") {
    return rows;
  }
  let resolution;
  try {
    resolution = await timezoneResolver(anchor, now);
  } catch (_error) {
    return rows;
  }
  const timezone = validIanaTimezone(resolution?.timezone);
  if (!timezone || resolution?.timezone_source !== "weather_provider_auto") return rows;
  return rows.map((manifest) => manifest?.timezone
    ? manifest
    : {
        ...manifest,
        timezone,
        review: {
          ...(manifest?.review || {}),
          timezone_source: "weather_provider_auto",
          timezone_trust: "derived_from_weather_provider",
        },
      });
}

function validIanaTimezone(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format(0);
    return value.trim();
  } catch (_error) {
    return null;
  }
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
  runApprovedPlaceSourceRefresh,
  scoutTarget,
  attachTrustedTimezone,
  nextQualificationProbeAt,
};
