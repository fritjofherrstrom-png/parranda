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

async function buildOsrmWalkingResult(points, walkingConfig = {}) {
  const baseUrl = walkingConfig.osrmBaseUrl || "https://router.project-osrm.org";
  const timeoutMs = walkingConfig.requestTimeoutMs || 4500;
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(";");
  const url = new URL(`/route/v1/foot/${coordinates}`, baseUrl);

  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");
  url.searchParams.set("annotations", "false");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`OSRM failed with status ${response.status}`);
    }

    const payload = await response.json();
    const route = payload.routes?.[0];

    if (!route) {
      throw new Error("OSRM returned no route");
    }

    const pathPoints = Array.isArray(route.geometry?.coordinates)
      ? route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
      : points.map((point) => ({ lat: point.lat, lng: point.lng }));

    const rawLegs = Array.isArray(route.legs) && route.legs.length
      ? route.legs
      : points.slice(1).map(() => null);
    const legs = rawLegs.map((leg, index) => {
      const fallbackDistanceKm = Number((haversineKm(points[index], points[index + 1]) * 1.22).toFixed(1));
      const distanceKm =
        typeof leg?.distance === "number"
          ? Number((leg.distance / 1000).toFixed(1))
          : fallbackDistanceKm;
      const walkMinutes =
        typeof leg?.duration === "number"
          ? Math.max(2, Math.round(leg.duration / 60))
          : estimatedWalkMinutes(distanceKm);

      return {
        from_label: toPointLabel(points[index], index === 0 ? "Start" : `Stopp ${index}`),
        to_label: toPointLabel(points[index + 1], `Stopp ${index + 1}`),
        distance_km: distanceKm,
        estimated_walk_minutes: walkMinutes,
      };
    });

    return {
      source: "osrm",
      estimatedKm: Number(((route.distance || 0) / 1000).toFixed(1)),
      legs,
      pathPoints,
      fallbackUsed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function routeWalkingPath(points, { walkingConfig = {} } = {}) {
  const fallback = buildHeuristicWalkingResult(points);
  const preferredProvider = walkingConfig.defaultProvider || "heuristic";

  if (preferredProvider !== "osrm" || points.length < 2) {
    return fallback;
  }

  try {
    return await buildOsrmWalkingResult(points, walkingConfig);
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
