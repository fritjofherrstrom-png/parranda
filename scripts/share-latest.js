"use strict";

/**
 * Keep a dedicated share checkout on the latest fast-forwarded origin/main.
 *
 * The supervisor never switches branches, rewrites history or touches a dirty
 * checkout. It fetches first, stops the app only when a newer descendant commit
 * exists, fast-forwards, refreshes runtime dependencies when required, and then
 * starts a new share process. The tunnel is separate, so its URL stays connected
 * while the app restarts behind the fixed local port.
 */

const path = require("node:path");
const { once } = require("node:events");
const { spawn } = require("node:child_process");

const APP_ROOT = path.resolve(__dirname, "..");
const DEFAULT_POLL_MS = 60_000;
const MIN_POLL_MS = 15_000;
const MAX_POLL_MS = 15 * 60_000;
const COMMAND_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 12_000;

function normalizePollMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.trunc(number)));
}

function classifyLatestState({ branch, dirty, head, remote, remoteIsDescendant }) {
  if (branch !== "main") return { status: "blocked", reason: "share_checkout_not_main" };
  if (dirty) return { status: "blocked", reason: "share_checkout_dirty" };
  if (!remote) return { status: "remote_unavailable", reason: "origin_main_unavailable" };
  if (head === remote) return { status: "up_to_date", reason: "origin_main_current" };
  if (remoteIsDescendant !== true) return { status: "blocked", reason: "share_checkout_diverged" };
  return { status: "update_ready", reason: "new_origin_main", from: head, to: remote };
}

async function inspectLatestMain({ run = runCommand, cwd = APP_ROOT } = {}) {
  const branch = await gitOutput(run, ["branch", "--show-current"], { cwd });
  const dirty = Boolean(await gitOutput(run, ["status", "--porcelain"], { cwd }));
  const localState = classifyLatestState({ branch, dirty, head: null, remote: null });
  if (localState.status === "blocked") return localState;

  const head = await gitOutput(run, ["rev-parse", "HEAD"], { cwd });
  try {
    await run("git", ["fetch", "--quiet", "origin", "main"], { cwd });
  } catch (_error) {
    return { status: "remote_unavailable", reason: "origin_main_fetch_failed", head };
  }

  const remote = await gitOutput(run, ["rev-parse", "origin/main"], { cwd });
  if (head === remote) return classifyLatestState({ branch, dirty, head, remote, remoteIsDescendant: true });

  const ancestor = await run("git", ["merge-base", "--is-ancestor", head, remote], {
    cwd,
    allowedExitCodes: [0, 1],
  });
  const state = classifyLatestState({
    branch,
    dirty,
    head,
    remote,
    remoteIsDescendant: ancestor.code === 0,
  });
  if (state.status !== "update_ready") return state;

  const changed = await gitOutput(run, ["diff", "--name-only", head, remote], { cwd });
  return {
    ...state,
    changed_files: changed.split("\n").map((entry) => entry.trim()).filter(Boolean),
  };
}

async function applyLatestMain(state, { run = runCommand, cwd = APP_ROOT } = {}) {
  if (state?.status !== "update_ready") return { updated: false };
  await run("git", ["merge", "--ff-only", "origin/main"], { cwd });
  const rootDependenciesChanged = state.changed_files.some(
    (file) => file === "package.json" || file === "package-lock.json",
  );
  if (rootDependenciesChanged) {
    await run("npm", ["ci", "--omit=dev"], { cwd, timeoutMs: 5 * 60_000 });
  }
  return { updated: true, from: state.from, to: state.to, dependencies_refreshed: rootDependenciesChanged };
}

function spawnShare({ spawnImpl = spawn, cwd = APP_ROOT, env = process.env } = {}) {
  return spawnImpl(process.execPath, [path.join(cwd, "scripts", "share.js")], {
    cwd,
    env: { ...env, PARRANDA_SHARE_LATEST: "enabled" },
    stdio: "inherit",
  });
}

async function stopShare(child, timeoutMs = STOP_TIMEOUT_MS) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    timer.unref?.();
  });
  await Promise.race([once(child, "exit"), timeout]);
}

async function runShareLatest(options = {}) {
  const cwd = options.cwd || APP_ROOT;
  const run = options.run || runCommand;
  const spawnImpl = options.spawnImpl || spawn;
  const inspect = options.inspect || (() => inspectLatestMain({ run, cwd }));
  const apply = options.apply || ((state) => applyLatestMain(state, { run, cwd }));
  const pollMs = normalizePollMs(options.pollMs ?? process.env.PARRANDA_SHARE_POLL_MS);
  let child = null;
  let updating = false;
  let shuttingDown = false;

  const start = () => {
    child = spawnShare({ spawnImpl, cwd, env: options.env || process.env });
    child.once("exit", (code, signal) => {
      child = null;
      if (shuttingDown || updating) return;
      console.error(`[share:latest] app exited (${signal || code}); restarting in 2s`);
      setTimeout(start, 2_000);
    });
  };

  const initial = await inspect();
  if (initial.status === "blocked") throw new Error(initial.reason);
  if (initial.status === "update_ready") await apply(initial);
  if (initial.status === "remote_unavailable") {
    console.error(`[share:latest] ${initial.reason}; serving current clean main`);
  }
  start();
  console.log(`[share:latest] watching origin/main every ${Math.round(pollMs / 1000)}s`);

  const check = async () => {
    if (updating || shuttingDown) return;
    updating = true;
    try {
      const state = await inspect();
      if (state.status === "blocked") {
        console.error(`[share:latest] ${state.reason}; current build remains online`);
        return;
      }
      if (state.status !== "update_ready") return;
      console.log(`[share:latest] updating ${state.from.slice(0, 12)} -> ${state.to.slice(0, 12)}`);
      await stopShare(child);
      child = null;
      await apply(state);
      start();
    } catch (error) {
      console.error(`[share:latest] update failed: ${error?.code || "update_failed"}`);
      if (!child && !shuttingDown) start();
    } finally {
      updating = false;
    }
  };

  const interval = setInterval(check, pollMs);
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(interval);
    await stopShare(child);
    if (options.setExitCode !== false) process.exitCode = signal === "SIGINT" ? 130 : 143;
  };
  if (options.registerSignals !== false) {
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  }
  return { child, interval, check, shutdown };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || APP_ROOT,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs || COMMAND_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      const allowed = options.allowedExitCodes || [0];
      if (allowed.includes(code)) return resolve({ code, stdout, stderr });
      const error = new Error(`${command}_failed`);
      error.code = `${command}_failed`;
      error.exitCode = code;
      reject(error);
    });
  });
}

async function gitOutput(run, args, options) {
  const result = await run("git", args, options);
  return String(result.stdout || "").trim();
}

if (require.main === module) {
  runShareLatest().catch((error) => {
    console.error(`[share:latest] refused to start: ${error?.message || "startup_failed"}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_POLL_MS,
  applyLatestMain,
  classifyLatestState,
  inspectLatestMain,
  normalizePollMs,
  runShareLatest,
  spawnShare,
  stopShare,
};
