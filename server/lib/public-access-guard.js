/**
 * Public-exposure guard — what makes it safe to put Parranda on a public URL.
 *
 * Parranda is a polite client of donated public infrastructure: Nominatim asks
 * for ~1 req/sec and a real User-Agent, Overpass for restraint. The engine
 * honors both OUTBOUND (per-instance rate gates, TTL + file caches, fail-closed
 * retries). None of that helps if the INBOUND side is unbounded: one crawler on
 * a public URL can fan out into thousands of distinct anchors, and the ban that
 * follows lands on the operator's IP — taking the app down and burning a shared
 * commons for everyone else.
 *
 * So this module bounds the inbound side:
 *   - a per-client fixed-window limit on the endpoints that reach upstream,
 *   - a global concurrency gate, so a burst can never queue more upstream work
 *     than the machine (and the upstream's patience) can absorb.
 *
 * The gate is the load-bearing one: even bounded upstream queues become slow
 * under a public burst. Capping concurrency rejects excess work at the door
 * instead of moving that pressure into the resolver/loader queues.
 *
 * Defaults are far above real human use — a person planning days never trips
 * them. The guard is explicit rather than global: `npm run share` enables it,
 * while normal deployments retain their existing traffic contract. Cheap
 * surfaces (health, static, catalog search) are deliberately not limited.
 */

// Endpoints whose work reaches donated upstream infrastructure (Nominatim,
// Overpass, Wikidata, municipal feeds) or costs real CPU. Exact paths only —
// a prefix match would quietly cover future routes nobody weighed. The one
// prefix rule (`/media/`, below) was weighed on its own and counts differently.
const { isIP } = require("node:net");

const UPSTREAM_COST_PATHS = new Set([
  "/api/route-recommendations",
  "/api/geocode",
  "/api/place-suggestions",
  "/api/city-pulse",
  "/api/live-events",
  "/api/place-details",
  "/api/blitz",
]);

// Prefix rules, each weighed on its own. `/media/` serves place photos from our
// own origin (server/place-media/media-bytes.js): a cache hit costs nothing
// upstream, so the guard does not count requests here. It hands the route an
// admission check instead, and the route calls it only when it is about to
// fetch from Wikimedia — only real upstream misses spend the caller's budget.
// Media misses have their own allowance (a day loads up to ~10 photos at a
// time) and their own upstream concurrency cap inside the route, so they never
// take day-composition slots.
const UPSTREAM_COST_PREFIXES = Object.freeze(["/media/"]);
const UPSTREAM_MISS_ADMISSION = "parrandaAdmitUpstreamMiss";
// A cold day asks for up to ~10 row tiles plus the figures of the stops a
// reader opens. Well under the ~10-a-burst Wikimedia allows one IP, and the
// route paces every upstream start for the whole process on top of this.
const DEFAULT_MEDIA_MISSES_PER_WINDOW = 20;

/**
 * The path as Express routes it: Express matches case-insensitively and
 * ignores a trailing slash, so "/MEDIA/c/…" and "/api/geocode/" reach the same
 * handlers and must meet the same rules.
 */
function routedPath(path) {
  const value = String(path || "").toLowerCase().replace(/\/+$/, "");
  return value || "/";
}

function upstreamCostPrefix(path) {
  const value = String(path || "").toLowerCase();
  return UPSTREAM_COST_PREFIXES.find((prefix) => value.startsWith(prefix)) || null;
}

const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_PER_WINDOW = 20;
// Headroom for a shared link: a handful of friends opening the app at the same
// moment must all get a day, not a refusal. Upstream stays protected without a
// tight cap here — the place resolver keeps its own serial ~1.1 s gate, Overpass
// results are cached and de-duped, and the per-visitor limit above still bounds
// any single caller.
const DEFAULT_MAX_CONCURRENT = 8;
// Bound the key table so a spoofed-header flood cannot grow it without limit.
// Far above the plausible number of distinct real clients on a shared link.
const MAX_TRACKED_CLIENTS = 5000;

function positiveInt(raw, fallback) {
  const value = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeInt(raw, fallback) {
  const value = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * The client identity a limit is counted against.
 *
 * X-Forwarded-For is CLIENT-CONTROLLED unless a trusted proxy rewrote it, so
 * trusting it blindly would let one caller mint a fresh identity per request
 * and evade every limit. It is read only when the operator declares how many
 * trusted hops sit in front (PARRANDA_TRUST_PROXY_HOPS), and then only the
 * entry that trusted hop appended — never the caller-supplied head of the list.
 *
 * Pair a non-zero hop count with binding the server to loopback, so the trusted
 * tunnel is genuinely the only way in.
 */
function validHeaderIp(raw) {
  const value = String(Array.isArray(raw) ? raw[0] : raw || "").trim();
  return isIP(value) ? value : null;
}

function clientKey(request, identity = {}) {
  const direct = (request?.socket?.remoteAddress || "").trim() || "unknown";
  const options = typeof identity === "number"
    ? { mode: identity > 0 ? "xff" : "direct", trustedHops: identity }
    : identity || {};
  if (options.mode === "cloudflare") {
    return validHeaderIp(request?.headers?.["cf-connecting-ip"]) || direct;
  }
  if (options.mode !== "xff" || options.trustedHops <= 0) return direct;
  const raw = request?.headers?.["x-forwarded-for"];
  const chain = String(Array.isArray(raw) ? raw.join(",") : raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!chain.length) return direct;
  // The right-most entry was appended by the nearest proxy; walking `trustedHops`
  // in from the right lands on the address that proxy observed.
  const index = chain.length - options.trustedHops;
  return validHeaderIp(chain[Math.max(0, Math.min(index, chain.length - 1))]) || direct;
}

/**
 * Fixed-window counter. Chosen over a token bucket because the honest answer to
 * "when may I retry?" is exact here — the window's own end — so Retry-After is
 * a fact rather than an estimate.
 */
function createFixedWindowLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  max = DEFAULT_MAX_PER_WINDOW,
  maxTrackedClients = MAX_TRACKED_CLIENTS,
  now = () => Date.now(),
} = {}) {
  const windows = new Map();
  const trackedLimit = positiveInt(maxTrackedClients, MAX_TRACKED_CLIENTS);
  let nextSweepAt = Infinity;

  function sweep(current) {
    if (current < nextSweepAt) return;
    nextSweepAt = Infinity;
    for (const [key, entry] of windows) {
      if (entry.resetAt <= current) windows.delete(key);
      else nextSweepAt = Math.min(nextSweepAt, entry.resetAt);
    }
  }

  return {
    check(key) {
      const current = now();
      let entry = windows.get(key);
      if (!entry || entry.resetAt <= current) {
        if (entry) windows.delete(key);
        // Expired windows leave first. If every tracked window is still live,
        // evict the oldest inserted window. The next-expiry marker avoids an
        // O(n) full-table scan for every new identity in an address flood.
        sweep(current);
        if (windows.size >= trackedLimit && !windows.has(key)) {
          const evictionKey = windows.keys().next().value;
          if (evictionKey !== undefined) windows.delete(evictionKey);
        }
        entry = { count: 0, resetAt: current + windowMs };
        windows.set(key, entry);
        nextSweepAt = Math.min(nextSweepAt, entry.resetAt);
      }
      entry.count += 1;
      if (entry.count > max) {
        return {
          allowed: false,
          retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - current) / 1000)),
          remaining: 0,
        };
      }
      return { allowed: true, retryAfterSec: 0, remaining: max - entry.count };
    },
    // Test/introspection seam; never used to make decisions.
    size() {
      return windows.size;
    },
  };
}

/** Global in-flight cap. Returns false when the gate is full — never queues. */
function createConcurrencyGate({ max = DEFAULT_MAX_CONCURRENT } = {}) {
  let active = 0;
  return {
    tryAcquire() {
      if (active >= max) return false;
      active += 1;
      return true;
    },
    release() {
      if (active > 0) active -= 1;
    },
    active() {
      return active;
    },
  };
}

/** Whether PARRANDA_PUBLIC_GUARD turns the guard on. */
function publicGuardEnabled(env = {}) {
  return guardSettings(env).enabled;
}

function guardSettings(env = {}) {
  const enabled = String(env.PARRANDA_PUBLIC_GUARD ?? "").trim().toLowerCase();
  const requestedIdentity = String(env.PARRANDA_PUBLIC_CLIENT_IDENTITY ?? "direct").trim().toLowerCase();
  const identityMode = ["cloudflare", "xff"].includes(requestedIdentity) ? requestedIdentity : "direct";
  return {
    // This is a share-profile capability, not a silent change to every deploy.
    enabled: enabled === "enabled" || enabled === "1" || enabled === "true",
    windowMs: positiveInt(env.PARRANDA_PUBLIC_GUARD_WINDOW_MS, DEFAULT_WINDOW_MS),
    max: positiveInt(env.PARRANDA_PUBLIC_GUARD_MAX, DEFAULT_MAX_PER_WINDOW),
    mediaMax: positiveInt(env.PARRANDA_PUBLIC_GUARD_MEDIA_MAX, DEFAULT_MEDIA_MISSES_PER_WINDOW),
    maxConcurrent: positiveInt(env.PARRANDA_PUBLIC_GUARD_CONCURRENCY, DEFAULT_MAX_CONCURRENT),
    trustedHops: nonNegativeInt(env.PARRANDA_TRUST_PROXY_HOPS, 0),
    identityMode,
  };
}

/**
 * Express middleware enforcing both bounds on upstream-touching endpoints.
 * Refusals are honest and machine-readable: a real 429 with Retry-After, never
 * a silent empty result that would read as "we looked and found nothing".
 */
function createPublicAccessGuard({ env = process.env, now = () => Date.now() } = {}) {
  const settings = guardSettings(env);
  const limiter = createFixedWindowLimiter({ windowMs: settings.windowMs, max: settings.max, now });
  // Prefix lookups have their own budget; typing must not spend day-composition allowances.
  const suggestionLimiter = createFixedWindowLimiter({ windowMs: settings.windowMs, max: 60, now });
  const gate = createConcurrencyGate({ max: settings.maxConcurrent });
  const mediaLimiter = createFixedWindowLimiter({ windowMs: settings.windowMs, max: settings.mediaMax, now });

  function middleware(request, response, next) {
    if (settings.enabled && upstreamCostPrefix(request.path) === "/media/") {
      const key = clientKey(request, { mode: settings.identityMode, trustedHops: settings.trustedHops });
      let verdict = null;
      // Called by the route only for a real upstream miss; at most one count per request.
      request[UPSTREAM_MISS_ADMISSION] = () => {
        verdict ??= mediaLimiter.check(key);
        return verdict;
      };
      next();
      return;
    }
    const routed = routedPath(request.path);
    if (!settings.enabled || !UPSTREAM_COST_PATHS.has(routed)) {
      next();
      return;
    }

    if (!gate.tryAcquire()) {
      response
        .status(429)
        .set("Retry-After", "5")
        .json({
          error: "busy",
          detail: "Parranda is composing as many days as it safely can right now. Try again in a moment.",
          retry_after_seconds: 5,
        });
      return;
    }

    const verdict = (routed === '/api/place-suggestions' ? suggestionLimiter : limiter).check(clientKey(request, {
      mode: settings.identityMode,
      trustedHops: settings.trustedHops,
    }));
    if (!verdict.allowed) {
      gate.release();
      response
        .status(429)
        .set("Retry-After", String(verdict.retryAfterSec))
        .json({
          error: "rate_limited",
          detail: "Too many requests from this client. Parranda paces itself to stay a good citizen of the open data it depends on.",
          retry_after_seconds: verdict.retryAfterSec,
        });
      return;
    }

    // Release exactly once, whichever way the response ends (finish, client
    // abort, or error) — a leaked slot would shrink the gate permanently.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      gate.release();
    };
    response.once("finish", release);
    response.once("close", release);

    next();
  }

  middleware.settings = settings;
  middleware.gate = gate;
  middleware.limiter = limiter;
  middleware.mediaLimiter = mediaLimiter;
  return middleware;
}

module.exports = {
  UPSTREAM_COST_PATHS,
  UPSTREAM_COST_PREFIXES,
  UPSTREAM_MISS_ADMISSION,
  upstreamCostPrefix,
  routedPath,
  publicGuardEnabled,
  clientKey,
  createFixedWindowLimiter,
  createConcurrencyGate,
  createPublicAccessGuard,
  guardSettings,
};
