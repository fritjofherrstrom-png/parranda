"use strict";

/**
 * `npm run share` — run Parranda as a real, shareable server on this machine.
 *
 * The hosting model is deliberately local-first: THIS machine is the server, and
 * a tunnel gives it a public HTTPS address. The application and cache remain on
 * this machine; the tunnel provider only carries encrypted traffic to it.
 *
 * Two differences from `npm run dev:full` matter, and both are security:
 *
 *  1. It binds to LOOPBACK, not 0.0.0.0. The tunnel is then the only way in,
 *     which makes an explicitly reviewed tunnel identity seam possible —
 *  2. ...and the inbound public guard is explicitly enabled. Its safe default
 *     identity is the direct tunnel peer; Cloudflare visitor identity is only
 *     trusted when the operator selects that documented mode.
 *
 * Never pair a public bind with a trusted visitor header: callers could forge
 * the identity and evade the limits. Share mode owns the safe loopback bind.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const { buildFullDevEnvironment } = require("./dev-full");
const { guardSettings } = require("../server/lib/public-access-guard");

const APP_ROOT = path.resolve(__dirname, "..");
const DEFAULT_PORT = 8000;
// A real, durable cache directory — the biggest advantage of self-hosting over
// a free cloud tier, where the cache is wiped on every restart.
const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".parranda", "source-cache");

// PATH lookup rather than a shell probe: spawning a shell to ask "do you have
// this?" both costs a process per check and trips Node's shell-argument
// deprecation warning, which would print on every single `npm run share`.
function has(command) {
  return String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => {
      try {
        fs.accessSync(path.join(dir, command), fs.constants.X_OK);
        return true;
      } catch (_error) {
        return false;
      }
    });
}

// The Mac app ships the CLI inside its bundle and only puts a launcher on PATH
// if you enable CLI integration, so "not on PATH" does not mean "not installed".
const MAC_APP_TAILSCALE = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

function findTailscale() {
  if (has("tailscale")) return "tailscale";
  if (fs.existsSync(MAC_APP_TAILSCALE)) return MAC_APP_TAILSCALE;
  return null;
}

function buildShareEnvironment(baseEnv = process.env, options = {}) {
  const cacheDir = options.cacheDir || baseEnv.PARRANDA_CACHE_DIR || DEFAULT_CACHE_DIR;
  const env = buildFullDevEnvironment(baseEnv, { cacheDir });
  return {
    ...env,
    HOST: "127.0.0.1",
    PORT: String(options.port || baseEnv.PORT || DEFAULT_PORT),
    PARRANDA_PUBLIC_GUARD: "enabled",
    // Direct is intentionally conservative for Tailscale/custom tunnels. Set
    // PARRANDA_PUBLIC_CLIENT_IDENTITY=cloudflare only behind Cloudflare Tunnel.
    PARRANDA_PUBLIC_CLIENT_IDENTITY: baseEnv.PARRANDA_PUBLIC_CLIENT_IDENTITY || "direct",
    PARRANDA_TRUST_PROXY_HOPS: baseEnv.PARRANDA_TRUST_PROXY_HOPS || "0",
    PARRANDA_CACHE_DIR: cacheDir,
    PARRANDA_RUNTIME_PROFILE: "share",
    PARRANDA_BUILD_SHA: baseEnv.PARRANDA_BUILD_SHA || currentBuildSha(),
  };
}

function currentBuildSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: APP_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_error) {
    return "unknown";
  }
}

function describeTunnel(port = DEFAULT_PORT) {
  const tailscale = findTailscale();
  if (tailscale) {
    return {
      ready: true,
      lines: [
        "Tailscale is installed. In a SECOND terminal, publish this server:",
        "",
        `    ${tailscale} funnel ${port}`,
        "",
        "That prints your public https://<machine>.<tailnet>.ts.net address —",
        "a stable link you can send to friends. Stop sharing with:",
        "",
        `    ${tailscale} funnel --https=443 off`,
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
      "",
      "Then open the app, sign in, and enable CLI integration in its settings",
      "(that creates /usr/local/bin/tailscale). Finally:",
      "",
      `    tailscale funnel ${port}`,
      "",
      "See docs/SELF_HOSTING.md for the full walkthrough and the always-on setup.",
    ],
  };
}

function banner(env) {
  const settings = guardSettings(env);
  const tunnel = describeTunnel(env.PORT);
  const lines = [
    "",
    "  Parranda — sharing from this machine",
    "  ────────────────────────────────────",
    `  Local:        http://127.0.0.1:${env.PORT}  (loopback only, by design)`,
    `  Cache:        ${env.PARRANDA_CACHE_DIR}  (durable across restarts)`,
    `  Build:        ${env.PARRANDA_BUILD_SHA}`,
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
  currentBuildSha,
  describeTunnel,
  runShareServer,
};
