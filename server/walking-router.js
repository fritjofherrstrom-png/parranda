function toPointLabel(point, fallback) {
  return point?.label || fallback || "Rom";
}

function haversineKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function estimatedWalkMinutes(distanceKm) {
  if (!Number.isFinite(distanceKm)) {
    return null;
  }

  return Math.max(2, Math.round(distanceKm * 12));
}

function buildHeuristicWalkingResult(points) {
  const legs = [];
  const pathPoints = points.map((point) => ({
    lat: point.lat,
    lng: point.lng,
  }));

  for (let index = 1; index < points.length; index += 1) {
    const distanceKm = Number((haversineKm(points[index - 1], points[index]) * 1.22).toFixed(1));
    legs.push({
      from_label: toPointLabel(points[index - 1], index === 1 ? "Start" : `Stopp ${index}`),
      to_label: toPointLabel(points[index], `Stopp ${index + 1}`),
      distance_km: distanceKm,
      estimated_walk_minutes: estimatedWalkMinutes(distanceKm),
    });
  }

  const totalKm = Number(
    legs.reduce((sum, leg) => sum + (Number.isFinite(leg.distance_km) ? leg.distance_km : 0), 0).toFixed(1),
  );

  return {
    source: "heuristic",
    estimatedKm: totalKm,
    legs,
    pathPoints,
    fallbackUsed: false,
  };
}

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PATH_POINTS = 8192;
const MAX_CHAIN_POINTS = 32;
const MAX_SNAP_KM = 0.1;

function validCoordinate(point) {
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

// A profile word in an OSRM URL does not change the preprocessed graph. The
// server operator must attest foot transport; unconfigured demos stay sketches.
function pedestrianEndpoint(config) {
  if (config.transportMode !== "foot" || typeof config.osrmBaseUrl !== "string") throw new Error("Unattested walking graph");
  const base = new URL(config.osrmBaseUrl);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash
    || base.hostname === "router.project-osrm.org") throw new Error("Invalid walking endpoint");
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  if (base.hostname === "routing.openstreetmap.de" &&
    (base.origin !== "https://routing.openstreetmap.de" || base.pathname !== "/routed-foot/")) throw new Error("Wrong FOSSGIS profile");
  return base;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error("Walking request expired"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("Walking request expired"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function readBoundedJson(response, signal) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    Promise.resolve(response.body?.cancel?.()).catch(() => {});
    throw new Error("Walking response too large");
  }
  if (!response.body?.getReader) {
    const text = await abortable(response.text(), signal);
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error("Walking response too large");
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let done = false;
  try {
    while (!done) {
      const part = await abortable(reader.read(), signal);
      done = part.done;
      if (done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Walking response too large");
      chunks.push(Buffer.from(part.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    if (!done) Promise.resolve(reader.cancel()).catch(() => {});
    try { reader.releaseLock(); } catch (_) { /* pending read is cancelled above */ }
  }
}

function finiteMetric(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateOsrmRoute(payload, points) {
  const route = payload?.routes?.[0];
  const geometry = route?.geometry;
  if (payload?.code !== "Ok" || geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates)
    || geometry.coordinates.length < 2 || geometry.coordinates.length > MAX_PATH_POINTS
    || !geometry.coordinates.every(pair => Array.isArray(pair) && pair.length === 2 && validCoordinate({ lat: pair[1], lng: pair[0] }))
    || !Array.isArray(route.legs) || route.legs.length !== points.length - 1
    || !finiteMetric(route.distance) || !finiteMetric(route.duration)
    || !route.legs.every(leg => finiteMetric(leg?.distance) && finiteMetric(leg?.duration))) {
    throw new Error("Invalid walking route");
  }
  for (const metric of ["distance", "duration"]) {
    const sum = route.legs.reduce((value, leg) => value + leg[metric], 0);
    if (Math.abs(sum - route[metric]) > Math.max(1, route[metric] * 0.00001)) throw new Error("Inconsistent walking metrics");
  }
  if (!Array.isArray(payload.waypoints) || payload.waypoints.length !== points.length
    || !payload.waypoints.every((waypoint, index) => {
      const pair = waypoint?.location;
      return Array.isArray(pair) && pair.length === 2 && validCoordinate({ lat: pair[1], lng: pair[0] })
        && finiteMetric(waypoint.distance) && waypoint.distance <= MAX_SNAP_KM * 1000
        && haversineKm(points[index], { lat: pair[1], lng: pair[0] }) <= MAX_SNAP_KM;
    })) throw new Error("Invalid walking waypoint snaps");
  return route;
}

async function buildOsrmWalkingResult(points, walkingConfig = {}, fetchImpl = globalThis.fetch) {
  const baseUrl = pedestrianEndpoint(walkingConfig);
  if (points.length > MAX_CHAIN_POINTS || !points.every(validCoordinate)) throw new Error("Invalid walking chain");
  const timeoutMs = Number.isFinite(walkingConfig.requestTimeoutMs)
    ? Math.max(1, Math.min(10000, walkingConfig.requestTimeoutMs)) : 4500;
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(";");
  const url = new URL(`route/v1/foot/${coordinates}`, baseUrl);

  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");
  url.searchParams.set("annotations", "false");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await abortable(fetchImpl(url, {
      signal: controller.signal,
      redirect: "error",
      headers: {
        Accept: "application/json",
        "User-Agent": walkingConfig.userAgent || "Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)",
      },
    }), controller.signal);

    if (!response.ok) {
      Promise.resolve(response.body?.cancel?.()).catch(() => {});
      throw new Error(`OSRM failed with status ${response.status}`);
    }

    const payload = await readBoundedJson(response, controller.signal);
    const route = validateOsrmRoute(payload, points);
    const pathPoints = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    const legs = route.legs.map((leg, index) => ({
        from_label: toPointLabel(points[index], index === 0 ? "Start" : `Stopp ${index}`),
        to_label: toPointLabel(points[index + 1], `Stopp ${index + 1}`),
        distance_km: Number((leg.distance / 1000).toFixed(1)),
        estimated_walk_minutes: Math.max(2, Math.round(leg.duration / 60)),
    }));

    return {
      source: "osrm",
      mode: "walking",
      ...(walkingConfig.attribution ? { attribution: { ...walkingConfig.attribution } } : {}),
      estimatedKm: Number((route.distance / 1000).toFixed(1)),
      legs,
      pathPoints,
      fallbackUsed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function routeWalkingPath(points, { walkingConfig = {}, fetchImpl = globalThis.fetch } = {}) {
  const fallback = buildHeuristicWalkingResult(points);
  const preferredProvider = walkingConfig.defaultProvider || "heuristic";

  if (preferredProvider !== "osrm" || points.length < 2) {
    return fallback;
  }

  try {
    return await buildOsrmWalkingResult(points, walkingConfig, fetchImpl);
  } catch (_error) {
    return {
      ...fallback,
      fallbackUsed: true,
    };
  }
}

module.exports = {
  routeWalkingPath,
};
