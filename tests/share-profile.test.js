/**
 * The share profile is a security decision expressed as configuration: the
 * server binds to loopback SO THAT the forwarded client address can be trusted
 * for per-client limits. These tests pin that pair together — splitting them
 * (public bind + trusted header) is what would let anyone forge the header and
 * evade the guard entirely.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const path = require("node:path");

const { buildShareEnvironment, DEFAULT_CACHE_DIR } = require("../scripts/share");
const { guardSettings } = require("../server/lib/public-access-guard");

const baseEnv = () => ({ PATH: process.env.PATH, HOME: os.homedir() });

test("sharing binds to loopback and only then trusts one forwarded hop", () => {
  const env = buildShareEnvironment(baseEnv(), { cacheDir: path.join(os.tmpdir(), "parranda-share-test") });

  assert.equal(env.HOST, "127.0.0.1", "the tunnel must be the only way in");
  assert.equal(env.PARRANDA_TRUST_PROXY_HOPS, "1");
  assert.equal(
    guardSettings(env).trustedHops,
    1,
    "the guard reads the hop count, so limits count against the real visitor",
  );
});

test("the shared profile keeps the public guard on", () => {
  const settings = guardSettings(buildShareEnvironment(baseEnv(), { cacheDir: path.join(os.tmpdir(), "p-share-2") }));
  assert.equal(settings.enabled, true);
  assert.ok(settings.max > 0 && settings.maxConcurrent > 0);
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
