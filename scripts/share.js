"use strict";

/**
 * `npm run share` — run Parranda as a real, shareable server on this machine.
 *
 * The hosting model is deliberately local-first: THIS machine is the server, and
 * a tunnel gives it a public HTTPS address. No hosting company holds the app, no
 * account is required to run it, and the cache lives on a real disk instead of a
 * host's ephemeral /tmp — so a place looked up once stays fast for everyone.
 *
 * Two differences from `npm run dev:full` matter, and both are security:
 *
 *  1. It binds to LOOPBACK, not 0.0.0.0. The tunnel is then the only way in,
 *     which is what makes the forwarded client address trustworthy —
 *  2. ...so PARRANDA_TRUST_PROXY_HOPS=1 is set, letting the public-access guard
 *     count its per-client limits against the real visitor instead of lumping
 *     every request under the tunnel's own address.
 *
 * Reversing that pair (public bind + trusted header) would let anyone forge the
 * header and evade the limits, so they are set together, here, and not left to
 * be remembered.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { buildFullDevEnvironment } = require("./dev-full");
const { guardSettings } = require("../server/lib/public-access-guard");

const APP_ROOT = path.resolve(__dirname, "..");
const DEFAULT_PORT = 8000;
// A real, durable cache directory — the biggest advantage of self-hosting over
// a free cloud tier, where the cache is wiped on every restart.
const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".parranda", "source-cache");

function has(command) {
  return spawnSync("command", ["-v", command], { shell: true, stdio: "ignore" }).status === 0;
}

function buildShareEnvironment(baseEnv = process.env, options = {}) {
  const cacheDir = options.cacheDir || baseEnv.PARRANDA_CACHE_DIR || DEFAULT_CACHE_DIR;
  const env = buildFullDevEnvironment(baseEnv, { cacheDir });
  return {
    ...env,
    HOST: "127.0.0.1",
    PORT: String(options.port || baseEnv.PORT || DEFAULT_PORT),
    // See the header: loopback bind and trusted-hop count are one decision.
    PARRANDA_TRUST_PROXY_HOPS: "1",
    PARRANDA_CACHE_DIR: cacheDir,
  };
}

function describeTunnel() {
  if (has("tailscale")) {
    return {
      ready: true,
      lines: [
        "Tailscale is installed. In a SECOND terminal, publish this server:",
        "",
        "    tailscale funnel 8000",
        "",
        "That prints your public https://<machine>.<tailnet>.ts.net address —",
        "a stable link you can send to friends. Stop sharing with:",
        "",
        "    tailscale funnel --https=443 off",
      ],
    };
  }
  return {
    ready: false,
    lines: [
      "No tunnel tool found yet. To give this server a public HTTPS address,",
      "install Tailscale and turn on Funnel (free, no card, sign in with GitHub):",
      "",
      "    brew install --cask tailscale",
      "    tailscale up",
      "    tailscale funnel 8000",
      "",
      "See docs/SELF_HOSTING.md for the full walkthrough and the always-on setup.",
    ],
  };
}

function banner(env) {
  const settings = guardSettings(env);
  const tunnel = describeTunnel();
  const lines = [
    "",
    "  Parranda — sharing from this machine",
    "  ────────────────────────────────────",
    `  Local:        http://127.0.0.1:${env.PORT}  (loopback only, by design)`,
    `  Cache:        ${env.PARRANDA_CACHE_DIR}  (durable across restarts)`,
    `  Live sources: open data loader, place resolvers, Wikidata, events — all on`,
    settings.enabled
      ? `  Guard:        ${settings.max} upstream requests/client per ${Math.round(settings.windowMs / 1000)}s, ${settings.maxConcurrent} concurrent`
      : "  Guard:        DISABLED — do not expose this publicly",
    "",
    ...tunnel.lines.map((line) => (line ? `  ${line}` : "")),
    "",
  ];
  return lines.join("\n");
}

function runShareServer(options = {}) {
  const env = buildShareEnvironment(process.env, options);
  fs.mkdirSync(env.PARRANDA_CACHE_DIR, { recursive: true });

  const frontendBuild = path.join(APP_ROOT, "frontend", "dist", "anywhere", "index.html");
  if (!fs.existsSync(frontendBuild)) {
    console.error("Frontend build missing (frontend/dist). Run: npm --prefix frontend run build");
    process.exitCode = 1;
    return null;
  }

  console.log(banner(env));

  // A server that sleeps is not a shared app. `caffeinate -i` holds off idle
  // sleep for exactly as long as this process lives — Ctrl-C gives the Mac its
  // normal sleep behavior back. Announced above rather than done silently.
  const useCaffeinate = process.platform === "darwin" && has("caffeinate") && options.keepAwake !== false;
  const command = useCaffeinate ? "caffeinate" : process.execPath;
  const args = useCaffeinate
    ? ["-i", process.execPath, path.join(APP_ROOT, "server.js")]
    : [path.join(APP_ROOT, "server.js")];
  if (useCaffeinate) console.log("  Holding this Mac awake while sharing (Ctrl-C restores normal sleep).\n");

  const child = spawn(command, args, { cwd: APP_ROOT, env, stdio: "inherit" });

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

if (require.main === module) runShareServer();

module.exports = {
  DEFAULT_CACHE_DIR,
  buildShareEnvironment,
  describeTunnel,
  runShareServer,
};
