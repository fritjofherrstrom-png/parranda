const EARTH_RADIUS_KM = 6371;

function radians(value) {
  return (value * Math.PI) / 180;
}

function distanceKm(a, b) {
  const lat1 = Number(a?.lat);
  const lng1 = Number(a?.lng);
  const lat2 = Number(b?.lat);
  const lng2 = Number(b?.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;

  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const value = sinLat * sinLat
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(value)));
}

function connectedComponents(stops, collisionDistanceKm) {
  const parent = stops.map((_, index) => index);
  const find = (index) => {
    let current = index;
    while (parent[current] !== current) current = parent[current];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = current;
      index = next;
    }
    return current;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let i = 0; i < stops.length; i += 1) {
    for (let j = i + 1; j < stops.length; j += 1) {
      if (distanceKm(stops[i], stops[j]) <= collisionDistanceKm) union(i, j);
    }
  }

  const groups = new Map();
  stops.forEach((_, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(index);
  });
  return [...groups.values()];
}

/**
 * Produces display-only offsets for route marker badges that would otherwise
 * overlap at ordinary city zoom levels. Geographic coordinates remain the
 * marker anchors and route geometry remains authoritative.
 */
export function routeMarkerPresentation(stops, options = {}) {
  const collisionDistanceKm = Number.isFinite(options.collisionDistanceKm)
    ? Math.max(0, options.collisionDistanceKm)
    : 0.22;
  const radiusPx = Number.isFinite(options.radiusPx)
    ? Math.max(0, options.radiusPx)
    : 36;
  const input = Array.isArray(stops) ? stops : [];
  const result = input.map(() => ({ shift_x_px: 0, shift_y_px: 0, clustered: false }));

  connectedComponents(input, collisionDistanceKm).forEach((indices) => {
    if (indices.length < 2) return;

    const meanLat = indices.reduce((sum, index) => sum + Number(input[index].lat), 0) / indices.length;
    const meanLng = indices.reduce((sum, index) => sum + Number(input[index].lng), 0) / indices.length;
    const cosLat = Math.cos(radians(meanLat));
    const angular = indices.map((stopIndex) => {
      const x = (Number(input[stopIndex].lng) - meanLng) * cosLat;
      const y = -(Number(input[stopIndex].lat) - meanLat);
      return { stopIndex, angle: Math.atan2(y, x), magnitude: Math.hypot(x, y) };
    }).sort((a, b) => a.angle - b.angle || a.stopIndex - b.stopIndex);

    const allCoincident = angular.every((entry) => entry.magnitude < 1e-10);
    let startAngle = -Math.PI / 2;
    if (!allCoincident) {
      const rotations = angular.map((entry, rank) => entry.angle - ((Math.PI * 2 * rank) / angular.length));
      const x = rotations.reduce((sum, angle) => sum + Math.cos(angle), 0);
      const y = rotations.reduce((sum, angle) => sum + Math.sin(angle), 0);
      startAngle = Math.atan2(y, x);
    }

    angular.forEach(({ stopIndex }, rank) => {
      const angle = startAngle + ((Math.PI * 2 * rank) / angular.length);
      result[stopIndex] = {
        shift_x_px: Math.round(Math.cos(angle) * radiusPx),
        shift_y_px: Math.round(Math.sin(angle) * radiusPx),
        clustered: true,
      };
    });
  });

  return result;
}
