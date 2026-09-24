/**
 * Test-suite network guard, preloaded by `npm test`
 * (`node --require ./tests/helpers/no-live-network.js --test`; the runner
 * forwards the preload to every test-file process).
 *
 * The suite must be deterministic: no live network in test suites
 * (docs/PARRANDA_ENGINE_GOALS.md, review rule 3). Most providers are
 * fail-soft, so a stray live call does not fail by itself: offline it
 * quietly degrades, in CI it quietly reads real, changing data. This guard
 * makes every non-loopback connection fail at once AND fails the test file
 * with a message naming the target, so new live calls cannot creep back in.
 *
 * Loopback (the suite's own local servers) is always allowed. Explicit opt-ins:
 *   - PARRANDA_TEST_LIVE_NETWORK=enabled lifts the guard for tests that
 *     genuinely need a real service (they gate themselves on the same flag).
 *   - The host of PARRANDA_TEST_DATABASE_URL is allowed, so the disposable
 *     Postgres test keeps working when that database is explicitly configured.
 */

const net = require("node:net");

const INSTALLED = Symbol.for("parranda.tests.noLiveNetwork");

function databaseHost() {
  try {
    return new URL(process.env.PARRANDA_TEST_DATABASE_URL || "").hostname.toLowerCase() || null;
  } catch (_error) {
    return null;
  }
}

function isAllowedHost(host) {
  const value = String(host || "localhost").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "" || value === "localhost" || value.endsWith(".localhost")) return true;
  if (value === "::1" || value === "0.0.0.0" || value === "::") return true;
  if ((net.isIPv4(value) && value.startsWith("127.")) || value.startsWith("::ffff:127.")) return true;
  return value === databaseHost();
}

function liveNetworkError(target) {
  const error = new Error(
    `Live network is disabled in the test suite: ${target}. Inject a fetcher or fixture ` +
      "instead, or gate the test behind PARRANDA_TEST_LIVE_NETWORK=enabled.",
  );
  error.code = "PARRANDA_TEST_LIVE_NETWORK";
  return error;
}

// The caller gets an ordinary network failure, but fail-soft code must not be
// able to swallow the violation: rethrow it outside the caller's try/catch,
// where node:test reports it against the running test file.
function reportViolation(error) {
  process.nextTick(() => {
    throw error;
  });
}

function socketTarget(args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (options && typeof options === "object") {
    return options.path ? null : { host: options.host, port: options.port };
  }
  if (typeof options === "number" || /^\d+$/.test(String(options))) {
    return { host: typeof args[1] === "string" ? args[1] : "localhost", port: options };
  }
  return null; // A string path is a local IPC socket.
}

function installGuard() {
  const realFetch = globalThis.fetch;
  if (typeof realFetch === "function") {
    globalThis.fetch = function guardedFetch(input, init) {
      let url;
      try {
        url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      } catch (_error) {
        return realFetch.call(this, input, init);
      }
      if (isAllowedHost(url.hostname)) return realFetch.call(this, input, init);
      const error = liveNetworkError(`${init?.method || input?.method || "GET"} ${url.href}`);
      reportViolation(error);
      return Promise.reject(new TypeError("fetch failed", { cause: error }));
    };
  }

  // Every other TCP client (http/https, drivers) connects through here.
  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const target = socketTarget(args);
    if (!target || isAllowedHost(target.host)) return realConnect.apply(this, args);
    const error = liveNetworkError(`connect ${target.host}:${target.port}`);
    reportViolation(error);
    process.nextTick(() => this.destroy(error));
    return this;
  };
}

if (process.env.PARRANDA_TEST_LIVE_NETWORK !== "enabled" && !globalThis[INSTALLED]) {
  globalThis[INSTALLED] = true;
  installGuard();
}
