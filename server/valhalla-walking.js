"use strict";

const { distanceKm } = require("./planner/candidate-reach-policy");

const LIMITS = Object.freeze({
  requests: 4,
  points: 10,
  requestMs: 5000,
  totalMs: 12000,
  responseBytes: 512 * 1024,
  shapePoints: 4096,
  concurrency: 2,
  ttlMs: 15 * 60 * 1000,
  cacheEntries: 64,
  cacheBytes: 4 * 1024 * 1024,
  snapMetres: 100,
});
const unavailable = () => ({ status: "unavailable" });
const finitePoint = (p) =>
  p &&
  Number.isFinite(p.lat) &&
  Math.abs(p.lat) <= 90 &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lng) <= 180;
const nonnegative = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

function operatorEndpoint(value) {
  try {
    const url = new URL(value);
    // Only deployment-owned configuration can reach this function. Private
    // HTTPS endpoints are intentional; HTTP is loopback-only. No public demo,
    // query credentials, redirects or endpoint inference.
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith("/route")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

// Valhalla's native JSON shape is polyline6, not GeoJSON. Decode with strict
// byte/component/point bounds; never substitute straight lines on bad data.
function decodeShape(value) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > LIMITS.responseBytes
  )
    throw Error("shape");
  let i = 0,
    lat = 0,
    lng = 0;
  const out = [];
  function component() {
    let n = 0,
      shift = 0;
    for (let count = 0; count < 6; count++) {
      if (i >= value.length) throw Error("shape");
      const b = value.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) throw Error("shape");
      n += (b & 31) * 2 ** shift;
      if (b < 32) return n % 2 ? -(n + 1) / 2 : n / 2;
      shift += 5;
    }
    throw Error("shape");
  }
  while (i < value.length) {
    lat += component();
    lng += component();
    const point = { lat: lat / 1e6, lng: lng / 1e6 };
    if (!finitePoint(point) || out.length >= LIMITS.shapePoints)
      throw Error("shape");
    out.push(point);
  }
  if (out.length < 2) throw Error("shape");
  return out;
}

function normalizeTrip(payload, points) {
  const trip = payload?.trip;
  if (
    trip?.status !== 0 ||
    trip.units !== "kilometers" ||
    !Array.isArray(trip.legs) ||
    trip.legs.length !== points.length - 1 ||
    !nonnegative(trip.summary?.length) ||
    !nonnegative(trip.summary?.time) ||
    trip.summary.has_ferry !== false
  )
    return unavailable();
  const legs = [],
    pathPoints = [],
    snapDistances = [];
  let km = 0,
    seconds = 0;
  try {
    for (let i = 0; i < trip.legs.length; i++) {
      const leg = trip.legs[i],
        s = leg.summary;
      if (
        !nonnegative(s?.length) ||
        !nonnegative(s?.time) ||
        s.has_ferry !== false ||
        !Array.isArray(leg.maneuvers) ||
        !leg.maneuvers.length ||
        leg.maneuvers.some(
          (m) => !m || m.ferry === true || m.travel_mode !== "pedestrian",
        )
      )
        return unavailable();
      const path = decodeShape(leg.shape);
      const start = distanceKm(points[i], path[0]) * 1000,
        end = distanceKm(points[i + 1], path.at(-1)) * 1000;
      if (
        start > LIMITS.snapMetres ||
        end > LIMITS.snapMetres ||
        pathPoints.length + path.length > LIMITS.shapePoints
      )
        return unavailable();
      // Snapping a POI is not evidence that the gap is walkable. Preserve the
      // original stop coordinates and report the bounded gap separately.
      if (pathPoints.length && distanceKm(pathPoints.at(-1), path[0]) > 0.005)
        return unavailable();
      if (s.length + 0.02 < distanceKm(path[0], path.at(-1)))
        return unavailable();
      const shapeKm = path
        .slice(1)
        .reduce((sum, p, index) => sum + distanceKm(path[index], p), 0);
      // Small serialization/simplification differences are expected; a cost
      // for a materially different geometry must not become the map's distance.
      if (Math.abs(shapeKm - s.length) > Math.max(0.05, s.length * 0.1))
        return unavailable();
      pathPoints.push(...(i ? path.slice(1) : path));
      snapDistances.push(start, end);
      legs.push({ distance_km: s.length, estimated_walk_minutes: s.time / 60 });
      km += s.length;
      seconds += s.time;
    }
  } catch {
    return unavailable();
  }
  if (
    Math.abs(km - trip.summary.length) > 0.02 ||
    Math.abs(seconds - trip.summary.time) > 2
  )
    return unavailable();
  return {
    status: "ok",
    source: "valhalla_pedestrian",
    estimatedKm: km,
    legs,
    pathPoints,
    snapDistances,
  };
}

async function readJson(response, signal) {
  const type = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (
    !response.ok ||
    type !== "application/json" ||
    Number(response.headers.get("content-length")) > LIMITS.responseBytes ||
    !response.body
  ) {
    await response.body?.cancel();
    throw Error("response");
  }
  const reader = response.body.getReader(),
    chunks = [];
  let bytes = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIMITS.responseBytes) throw Error("bytes");
      chunks.push(Buffer.from(value));
    }
    signal.throwIfAborted();
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
  }
}

function createValhallaWalkingProvider({
  endpoint,
  fetcher = fetch,
  // All state is process-local: monotonic durations keep the hard deadline
  // and TTL independent of wall-clock/NTP adjustments.
  now = () => performance.now(),
} = {}) {
  const url = operatorEndpoint(endpoint);
  const cache = new Map(),
    jobs = new Map();
  let active = 0,
    cacheBytes = 0;
  function cacheRead(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expires <= now()) {
      cache.delete(key);
      cacheBytes -= entry.bytes;
      return null;
    }
    return structuredClone(entry.value);
  }
  function cacheWrite(key, value) {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    while (
      cache.size >= LIMITS.cacheEntries ||
      cacheBytes + bytes > LIMITS.cacheBytes
    ) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) return;
      cacheBytes -= cache.get(oldest).bytes;
      cache.delete(oldest);
    }
    cache.set(key, { value, bytes, expires: now() + LIMITS.ttlMs });
    cacheBytes += bytes;
  }
  function start(key, points) {
    const controller = new AbortController();
    const job = { controller, owners: 0, promise: null };
    const timer = setTimeout(() => controller.abort(), LIMITS.requestMs);
    active++;
    job.promise = Promise.resolve()
      .then(async () => {
        controller.signal.throwIfAborted();
        const response = await fetcher(url, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            locations: points.map((p) => ({
              lat: p.lat,
              lon: p.lng,
              type: "break",
              search_cutoff: 100,
              radius: 50,
            })),
            costing: "pedestrian",
            costing_options: { pedestrian: { use_ferry: 0, walking_speed: 5 } },
            units: "kilometers",
            // Older Valhalla releases report false ferry summaries with
            // directions_type=none (#6151). Require pedestrian maneuvers as
            // independent response checks, then discard all instructions.
            directions_type: "maneuvers",
          }),
        });
        if (response.redirected || (response.url && response.url !== url)) {
          await response.body?.cancel();
          return unavailable();
        }
        const result = normalizeTrip(
          await readJson(response, controller.signal),
          points,
        );
        controller.signal.throwIfAborted();
        if (result.status === "ok") cacheWrite(key, result);
        return result;
      })
      .catch(() => unavailable())
      .finally(() => {
        clearTimeout(timer);
        active--;
        if (jobs.get(key) === job) jobs.delete(key);
      });
    jobs.set(key, job);
    return job;
  }
  async function consume(key, points, signal) {
    signal.throwIfAborted();
    const hit = cacheRead(key);
    if (hit) return hit;
    let job = jobs.get(key);
    if (!job) {
      if (active >= LIMITS.concurrency) return unavailable();
      job = start(key, points);
    }
    job.owners++;
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return structuredClone(await Promise.race([job.promise, cancelled]));
    } finally {
      signal.removeEventListener("abort", abort);
      job.owners--;
      if (!job.owners) {
        job.controller.abort();
        if (jobs.get(key) === job) jobs.delete(key);
      }
    }
  }
  return {
    configured: Boolean(url),
    session({ signal } = {}) {
      let calls = 0,
        started = null;
      return {
        async route(points) {
          signal?.throwIfAborted();
          if (started === null) started = now();
          if (
            !url ||
            !Array.isArray(points) ||
            points.length < 2 ||
            points.length > LIMITS.points ||
            !points.every(finitePoint) ||
            ++calls > LIMITS.requests
          )
            return unavailable();
          const remaining = LIMITS.totalMs - (now() - started);
          if (remaining <= 0) return unavailable();
          const controller = new AbortController(),
            timer = setTimeout(() => controller.abort(), remaining);
          const combined = signal
            ? AbortSignal.any([signal, controller.signal])
            : controller.signal;
          const key = JSON.stringify(points.map((p) => [p.lat, p.lng]));
          try {
            return await consume(key, points, combined);
          } catch (error) {
            signal?.throwIfAborted();
            return unavailable();
          } finally {
            clearTimeout(timer);
          }
        },
      };
    },
  };
}

function resolveNetworkWalkingProvider(env = process.env) {
  if (env.PARRANDA_NETWORK_WALKING !== "enabled") return null;
  return createValhallaWalkingProvider({
    endpoint: env.PARRANDA_VALHALLA_ROUTE_URL,
  });
}
module.exports = {
  createValhallaWalkingProvider,
  resolveNetworkWalkingProvider,
  LIMITS,
};
