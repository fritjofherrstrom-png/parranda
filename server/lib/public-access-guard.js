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
 * The gate is the load-bearing one: the resolver's serial ~1.1 s rate gate has
 * an unbounded queue, so N concurrent composes mean the last caller waits N×1.1 s.
 * Capping concurrency bounds that queue at the door instead.
 *
 * Defaults are far above real human use — a person planning days never trips
 * them — and the guard is ON by default, so a deployment is safe before anyone
 * remembers to configure it. Cheap surfaces (health, static, catalog search)
 * are deliberately not limited.
 */

// Endpoints whose work reaches donated upstream infrastructure (Nominatim,
// Overpass, Wikidata, municipal feeds) or costs real CPU. Exact paths only —
// a prefix match would quietly cover future routes nobody weighed.
const UPSTREAM_COST_PATHS = new Set([
  "/api/route-recommendations",
  "/api/geocode",
  "/api/city-pulse",
  "/api/live-events",
  "/api/place-details",
  "/api/blitz",
]);

const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_PER_WINDOW = 20;
const DEFAULT_MAX_CONCURRENT = 3;
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
function clientKey(request, trustedHops = 0) {
  const direct = (request?.socket?.remoteAddress || "").trim() || "unknown";
  if (trustedHops <= 0) return direct;
  const raw = request?.headers?.["x-forwarded-for"];
  const chain = String(Array.isArray(raw) ? raw.join(",") : raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!chain.length) return direct;
  // The right-most entry was appended by the nearest proxy; walking `trustedHops`
  // in from the right lands on the address that proxy observed.
  const index = chain.length - trustedHops;
  return chain[Math.max(0, Math.min(index, chain.length - 1))] || direct;
}

/**
 * Fixed-window counter. Chosen over a token bucket because the honest answer to
 * "when may I retry?" is exact here — the window's own end — so Retry-After is
 * a fact rather than an estimate.
 */
function createFixedWindowLimiter({ windowMs = DEFAULT_WINDOW_MS, max = DEFAULT_MAX_PER_WINDOW, now = () => Date.now() } = {}) {
  const windows = new Map();

  function sweep(current) {
    for (const [key, entry] of windows) {
      if (entry.resetAt <= current) windows.delete(key);
    }
  }

  return {
    check(key) {
      const current = now();
      let entry = windows.get(key);
      if (!entry || entry.resetAt <= current) {
        // Sweeping only when a window rolls keeps this O(1) amortized per call.
        if (windows.size >= MAX_TRACKED_CLIENTS) sweep(current);
        entry = { count: 0, resetAt: current + windowMs };
        windows.set(key, entry);
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

function guardSettings(env = {}) {
  const disabled = String(env.PARRANDA_PUBLIC_GUARD ?? "").trim().toLowerCase();
  return {
    // Secure by default: only an explicit opt-out turns the guard off, and that
    // exists for single-user local runs and deterministic tests.
    enabled: !(disabled === "disabled" || disabled === "0" || disabled === "false"),
    windowMs: positiveInt(env.PARRANDA_PUBLIC_GUARD_WINDOW_MS, DEFAULT_WINDOW_MS),
    max: positiveInt(env.PARRANDA_PUBLIC_GUARD_MAX, DEFAULT_MAX_PER_WINDOW),
    maxConcurrent: positiveInt(env.PARRANDA_PUBLIC_GUARD_CONCURRENCY, DEFAULT_MAX_CONCURRENT),
    trustedHops: nonNegativeInt(env.PARRANDA_TRUST_PROXY_HOPS, 0),
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
  const gate = createConcurrencyGate({ max: settings.maxConcurrent });

  function middleware(request, response, next) {
    if (!settings.enabled || !UPSTREAM_COST_PATHS.has(request.path)) {
      next();
      return;
    }

    const verdict = limiter.check(clientKey(request, settings.trustedHops));
    if (!verdict.allowed) {
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
  return middleware;
}

module.exports = {
  UPSTREAM_COST_PATHS,
  clientKey,
  createFixedWindowLimiter,
  createConcurrencyGate,
  createPublicAccessGuard,
  guardSettings,
};
