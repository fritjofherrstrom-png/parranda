const { routeWalkingPath } = require("./walking-router");

const MIN_INTERVAL_MS = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;
const defaultRuntimes = new Map();

// This configuration is operator-owned. Request payloads cannot select a
// provider, attest a transport profile or provide an endpoint/attribution.
function resolveDefaultWalkingRuntime(env = process.env, dependencies) {
  const disabled = { walkingRouter: null, walkingConfig: null };
  if (env.PARRANDA_WALKING_PROVIDER !== "osrm" || !env.PARRANDA_OSRM_URL) return disabled;
  let endpoint;
  try { endpoint = new URL(env.PARRANDA_OSRM_URL); } catch (_) { return disabled; }
  if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || endpoint.hostname === "router.project-osrm.org") return disabled;
  if (!endpoint.pathname.endsWith("/")) endpoint.pathname += "/";
  const fossgis = endpoint.hostname === "routing.openstreetmap.de";
  if (fossgis ? endpoint.origin !== "https://routing.openstreetmap.de" || endpoint.pathname !== "/routed-foot/"
    : env.PARRANDA_OSRM_TRANSPORT_MODE !== "foot") return disabled;
  if (dependencies === undefined && defaultRuntimes.has(endpoint.href)) return defaultRuntimes.get(endpoint.href);
  // Operator configuration is normally static. Bound the registry as well as
  // each cache, without evicting an endpoint's existing rate budget.
  if (dependencies === undefined && defaultRuntimes.size >= 16) return disabled;
  const walkingConfig = Object.freeze({
    defaultProvider: "osrm",
    transportMode: "foot",
    osrmBaseUrl: endpoint.href,
    requestTimeoutMs: 4500,
    ...(fossgis ? { attribution: Object.freeze({
      label: "FOSSGIS routing",
      url: "https://routing.openstreetmap.de/about.html",
      fixMapUrl: "https://www.openstreetmap.org/fixthemap",
    }) } : {}),
  });
  const runtime = { walkingConfig, walkingRouter: createBoundedWalkingRouter(walkingConfig, dependencies) };
  if (dependencies === undefined) defaultRuntimes.set(endpoint.href, runtime);
  return runtime;
}

function createBoundedWalkingRouter(walkingConfig, {
  fetchImpl = globalThis.fetch,
  now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  maxEntries = MAX_CACHE_ENTRIES,
  ttlMs = CACHE_TTL_MS,
} = {}) {
  const cache = new Map();
  const cacheBound = Number.isInteger(maxEntries) ? Math.max(1, Math.min(MAX_CACHE_ENTRIES, maxEntries)) : MAX_CACHE_ENTRIES;
  const lifetime = Number.isFinite(ttlMs) ? Math.max(1, Math.min(CACHE_TTL_MS, ttlMs)) : CACHE_TTL_MS;
  let active = null;
  let lastStarted = -Infinity;
  const fallback = points => routeWalkingPath(points).then(result => ({ ...result, fallbackUsed: true }));
  const copyFor = (result, points) => {
    const copy = structuredClone(result);
    copy.legs.forEach((leg, index) => {
      leg.from_label = points[index]?.label || (index === 0 ? "Start" : `Stopp ${index + 1}`);
      leg.to_label = points[index + 1]?.label || `Stopp ${index + 2}`;
    });
    return copy;
  };

  return async function walkingRouter(points, { waitForRateSlot = false } = {}) {
    const key = JSON.stringify(points.map(point => [point.lng, point.lat]));
    const instant = now();
    for (const [oldKey, entry] of cache) if (entry.expiresAt <= instant) cache.delete(oldKey);
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key); cache.set(key, cached);
      return copyFor(cached.result, points);
    }
    if (active?.key === key) return copyFor(await active.promise, points);
    // No queue for a busy provider. A comparison of two finished plans can
    // wait once for an idle cooldown, then recheck the shared budget.
    if (active) return fallback(points);
    const cooldown = MIN_INTERVAL_MS - (instant - lastStarted);
    if (cooldown > 0) {
      if (!waitForRateSlot || cooldown > MIN_INTERVAL_MS) return fallback(points);
      await wait(cooldown);
      return walkingRouter(points);
    }
    lastStarted = instant;
    const pending = routeWalkingPath(points, { walkingConfig, fetchImpl });
    active = { key, promise: pending };
    try {
      const result = await pending;
      if (result.source === "osrm" && result.mode === "walking" && !result.fallbackUsed) {
        cache.set(key, { result: structuredClone(result), expiresAt: now() + lifetime });
        while (cache.size > cacheBound) cache.delete(cache.keys().next().value);
      }
      return copyFor(result, points);
    } finally { active = null; }
  };
}

module.exports = { resolveDefaultWalkingRuntime, createBoundedWalkingRouter };
