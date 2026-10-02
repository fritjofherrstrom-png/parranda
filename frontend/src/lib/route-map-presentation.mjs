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
 * Is the published route line only a sketch of the stop order?
 *
 * A walking router that follows streets returns more geometry than the route's
 * own waypoints; the heuristic estimate returns exactly the waypoints (at most
 * the stops plus a published start and end), joined by straight lines that can
 * cross water, parks and buildings. Drawing those like a street path would claim
 * a walking line Parranda never computed, so the map draws a sketch dotted.
 *
 * Structural only: the answer comes from point counts, never from a place,
 * provider name or label. Anything unreadable counts as a sketch — the
 * conservative reading.
 */
export function routePathIsSketch(pathPoints, stopCount) {
  const points = Array.isArray(pathPoints)
    ? pathPoints.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng))
    : [];
  const stops = Number.isInteger(stopCount) && stopCount > 0 ? stopCount : 0;
  if (points.length < 2) return true;
  return points.length <= stops + 2;
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

/** Place badge footprints in screen space; never mutate geographic anchors. */
export function screenMarkerPresentation(points, { width, height, keepouts = [], radius = 22, gap = 4 } = {}) {
  if (!Array.isArray(points) || !Array.isArray(keepouts) || points.length > 200) return null;
  if (![width, height, radius, gap].every(Number.isFinite) || radius <= 0 || gap < 0 || width < radius * 2 || height < radius * 2) return null;
  const placed = [];
  const result = [];
  const boxes = keepouts.filter(b => b && [b.left, b.top, b.right, b.bottom].every(Number.isFinite) && b.right > b.left && b.bottom > b.top);
  let checked = 0;
  const safe = (x, y) => ++checked <= 20000 && x >= radius + 2 && x <= width - radius - 2 && y >= radius + 2 && y <= height - radius - 2
    && boxes.every(b => x + radius + gap <= b.left || x - radius - gap >= b.right || y + radius + gap <= b.top || y - radius - gap >= b.bottom)
    && placed.every(p => Math.hypot(x - p.x, y - p.y) >= radius * 2 + gap);
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const x = Math.max(radius + 2, Math.min(width - radius - 2, point.x));
    const y = Math.max(radius + 2, Math.min(height - radius - 2, point.y));
    let chosen = safe(x, y) ? { x, y } : null;
    // Bounded square spiral: deterministic, local displacement first, then the
    // rest of the container. No labels, city names or route distances involved.
    const step = 6;
    const rings = Math.min(64, Math.ceil(Math.max(width, height) / step));
    for (let ring = 1; !chosen && ring <= rings && checked < 20000; ring++) {
      const candidates = [];
      for (let k = -ring; k <= ring; k++) {
        candidates.push([ring, k], [-ring, k], [k, ring], [k, -ring]);
      }
      candidates.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
      for (const [dx, dy] of candidates) {
        if (safe(x + dx * step, y + dy * step)) { chosen = { x: x + dx * step, y: y + dy * step }; break; }
      }
    }
    if (!chosen) return null; // Do not silently claim an impossible layout fits.
    placed.push(chosen);
    const shift_x_px = chosen.x - point.x;
    const shift_y_px = chosen.y - point.y;
    result.push({ shift_x_px, shift_y_px, clustered: Math.abs(shift_x_px) > 0.5 || Math.abs(shift_y_px) > 0.5 });
  }
  return result;
}
