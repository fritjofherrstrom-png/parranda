"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const APP_ROOT = path.resolve(__dirname, "..");
const DEFAULT_MANIFEST_PATH = path.join(APP_ROOT, "config", "reviewed-event-feeds.json");

const FULL_PROFILE_FLAGS = Object.freeze({
  PARRANDA_NEW_ANYWHERE: "enabled",
  PARRANDA_NEW_LANDING: "enabled",
  PARRANDA_PLACE_RESOLVER: "enabled",
  PARRANDA_WIKIDATA_PLACE_RESOLVER: "enabled",
  PARRANDA_OPEN_DATA_LOADER: "enabled",
  PARRANDA_WIKIDATA_SOURCE: "enabled",
  PARRANDA_AGNOSTIC_ENGINE_COMPOSE: "enabled",
  PARRANDA_AGNOSTIC_EVENTS: "enabled",
  PARRANDA_QUALIFIED_SOURCE_RUNTIME: "enabled",
});

function loadReviewedEventFeeds(manifestPath = DEFAULT_MANIFEST_PATH) {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("reviewed_event_feeds_unavailable");
  }
  for (const [index, feed] of parsed.entries()) {
    if (!feed || typeof feed !== "object" || !feed.id || !feed.adapter || !feed.endpoint) {
      throw new Error(`reviewed_event_feed_invalid:${index}`);
    }
    if (String(feed.status || "").toLowerCase() !== "active") {
      throw new Error(`reviewed_event_feed_inactive:${feed.id}`);
    }
  }
  return parsed;
}

function buildFullDevEnvironment(baseEnv = process.env, options = {}) {
  const manifestPath = options.manifestPath || DEFAULT_MANIFEST_PATH;
  const feeds = loadReviewedEventFeeds(manifestPath);
  const cacheDir =
    options.cacheDir ||
    nonEmpty(baseEnv.PARRANDA_CACHE_DIR) ||
    path.join(os.tmpdir(), "parranda-dev-full-cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  return {
    ...baseEnv,
    ...FULL_PROFILE_FLAGS,
    PARRANDA_CACHE_DIR: cacheDir,
    PARRANDA_EVENT_FEEDS: JSON.stringify(feeds),
  };
}

function runFullDevServer(options = {}) {
  const env = buildFullDevEnvironment(process.env, options);
  const child = spawn(process.execPath, [path.join(APP_ROOT, "server.js")], {
    cwd: APP_ROOT,
    env,
    stdio: "inherit",
  });

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => forward("SIGINT"));
  process.once("SIGTERM", () => forward("SIGTERM"));
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
  return child;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

if (require.main === module) runFullDevServer();

module.exports = {
  DEFAULT_MANIFEST_PATH,
  FULL_PROFILE_FLAGS,
  buildFullDevEnvironment,
  loadReviewedEventFeeds,
  runFullDevServer,
};
