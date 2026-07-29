/**
 * The share profile is a security decision expressed as configuration: the
 * server binds to loopback and explicitly enables the inbound guard. Tunnel
 * identity remains conservative unless the operator selects a reviewed mode.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const path = require("node:path");

const { buildShareEnvironment, describeTunnel, DEFAULT_CACHE_DIR } = require("../scripts/share");
const { guardSettings } = require("../server/lib/public-access-guard");

const baseEnv = () => ({ PATH: process.env.PATH, HOME: os.homedir() });

test("sharing binds to loopback and defaults to the safe direct tunnel identity", () => {
  const env = buildShareEnvironment(baseEnv(), { cacheDir: path.join(os.tmpdir(), "parranda-share-test") });

  assert.equal(env.HOST, "127.0.0.1", "the tunnel must be the only way in");
  assert.equal(env.PARRANDA_PUBLIC_GUARD, "enabled");
  assert.equal(env.PARRANDA_PUBLIC_CLIENT_IDENTITY, "direct");
  assert.equal(guardSettings(env).trustedHops, 0);
  assert.equal(guardSettings(env).identityMode, "direct");
});

test("Cloudflare visitor identity is explicit rather than inferred for every tunnel", () => {
  const env = buildShareEnvironment(
    { ...baseEnv(), PARRANDA_PUBLIC_CLIENT_IDENTITY: "cloudflare" },
    { cacheDir: path.join(os.tmpdir(), "p-share-cf") },
  );
  assert.equal(guardSettings(env).identityMode, "cloudflare");
});

test("the shared profile keeps the public guard on", () => {
  const settings = guardSettings(buildShareEnvironment(baseEnv(), { cacheDir: path.join(os.tmpdir(), "p-share-2") }));
  assert.equal(settings.enabled, true);
  assert.ok(settings.max > 0 && settings.maxConcurrent > 0);
});

test("the shared profile identifies its build and runtime profile", () => {
  const env = buildShareEnvironment(baseEnv(), { cacheDir: path.join(os.tmpdir(), "p-share-build") });
  assert.equal(env.PARRANDA_RUNTIME_PROFILE, "share");
  assert.match(env.PARRANDA_BUILD_SHA, /^(?:[0-9a-f]{7,40}|unknown)$/i);
});

test("the cache lives on durable disk, not a temp dir wiped on restart", () => {
  const env = buildShareEnvironment(baseEnv());
  assert.equal(env.PARRANDA_CACHE_DIR, DEFAULT_CACHE_DIR);
  assert.ok(
    DEFAULT_CACHE_DIR.startsWith(os.homedir()),
    "a durable cache is the point of self-hosting — a looked-up place stays fast",
  );
  // An explicit override still wins, so a different disk can be chosen.
  const overridden = buildShareEnvironment({ ...baseEnv(), PARRANDA_CACHE_DIR: "/tmp/elsewhere" });
  assert.equal(overridden.PARRANDA_CACHE_DIR, "/tmp/elsewhere");
});

test("sharing turns on the live sources, otherwise friends get the catalog-only app", () => {
  const env = buildShareEnvironment(baseEnv(), { cacheDir: path.join(os.tmpdir(), "p-share-3") });
  for (const flag of [
    "PARRANDA_OPEN_DATA_LOADER",
    "PARRANDA_PLACE_RESOLVER",
    "PARRANDA_WIKIDATA_PLACE_RESOLVER",
    "PARRANDA_AGNOSTIC_EVENTS",
    "PARRANDA_NEW_ANYWHERE",
  ]) {
    assert.equal(env[flag], "enabled", `${flag} must be on for a real any-place app`);
  }
  assert.ok(env.PARRANDA_EVENT_FEEDS, "reviewed event feeds are loaded from the versioned manifest");
});

test("the tunnel hint names the port actually being shared", () => {
  // A copy-pasteable command is the whole point of the banner; hardcoding 8000
  // while the server listens elsewhere would hand out a broken instruction.
  const { lines } = describeTunnel("9100");
  assert.ok(
    lines.some((line) => line.includes("9100")),
    "the funnel command must match the port in use",
  );
  assert.ok(!lines.some((line) => line.includes("funnel 8000")), "no stale default port");
});
