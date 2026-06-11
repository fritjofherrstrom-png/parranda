/**
 * Agnostic route ordering experiment.
 *
 * Converts the candidate-combination role order into a conservative proximity
 * sequence for the flag-gated any-place route-output experiment. This helper is
 * deliberately small and pure:
 *   - it never fetches;
 *   - it never mutates the input body;
 *   - it never claims an optimal/fast route;
 *   - the caller must still validate the produced order against walking budget.
 */

function buildAgnosticRouteOrdering({ adaptedBody } = {}) {
  const body = adaptedBody && typeof adaptedBody === "object" ? adaptedBody : {};
  const stops = Array.isArray(body.stops) ? body.stops : [];
  const originalIds = stops.map(stableStopId).filter(Boolean);
  const base = {
    applied: false,
    changed: false,
    source: "trusted_candidate_pool+candidate_role_order",
    confidence: "role_order",
    original_stop_ids: originalIds,
    ordered_stop_ids: originalIds,
    reasons: [],
  };

  if (stops.length < 3) {
    return { adaptedBody: cloneAdaptedBody(body, stops), ordering: { ...base, reasons: ["stop_count_below_sequence_threshold"] } };
  }

  if (!stops.every(hasStableCoordinatesAndId)) {
    return { adaptedBody: cloneAdaptedBody(body, stops), ordering: { ...base, reasons: ["incomplete_stable_candidate_coordinates"] } };
  }

  if (new Set(originalIds).size !== originalIds.length) {
    return { adaptedBody: cloneAdaptedBody(body, stops), ordering: { ...base, reasons: ["duplicate_candidate_ids"] } };
  }

  const orderedStops = proximitySequence(stops);
  const orderedIds = orderedStops.map(stableStopId).filter(Boolean);
  const changed = orderedIds.join("|") !== originalIds.join("|");
  if (!changed) {
    return {
      adaptedBody: cloneAdaptedBody(body, stops),
      ordering: {
        ...base,
        ordered_stop_ids: orderedIds,
        reasons: ["candidate_role_order_already_local"],
      },
    };
  }

  return {
    adaptedBody: cloneAdaptedBody(body, orderedStops),
    ordering: {
      applied: true,
      changed: true,
      source: "trusted_candidate_pool+role_order+proximity_sequence",
      confidence: "walking_budget_candidate",
      original_stop_ids: originalIds,
      ordered_stop_ids: orderedIds,
      reasons: ["proximity_sequence_applied", "requires_walking_budget_validation"],
    },
  };
}

function cloneAdaptedBody(body, stops) {
  const clonedStops = stops.map((stop) => cloneStop(stop));
  return {
    ...body,
    stops: clonedStops,
    stop_ids: clonedStops.map(stableStopId).filter(Boolean),
    target_roles: clonedStops.map((stop) => stop.role).filter(Boolean),
  };
}

function cloneStop(stop) {
  return {
    ...stop,
    coordinates:
      stop && stop.coordinates
        ? {
            ...stop.coordinates,
          }
        : stop && stop.coordinates,
  };
}

function proximitySequence(stops) {
  const remaining = stops.map((stop, index) => ({ stop, index }));
  const ordered = [remaining.shift()];

  while (remaining.length) {
    const current = ordered[ordered.length - 1].stop;
    let nextIndex = 0;
    let nextScore = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      const score = distanceKm(current.coordinates, candidate.stop.coordinates);
      if (score < nextScore || (score === nextScore && candidate.index < remaining[nextIndex].index)) {
        nextScore = score;
        nextIndex = i;
      }
    }
    ordered.push(remaining.splice(nextIndex, 1)[0]);
  }

  return ordered.map((entry) => entry.stop);
}

function hasStableCoordinatesAndId(stop) {
  const coords = stop && stop.coordinates;
  return Boolean(
    stableStopId(stop) &&
      coords &&
      Number.isFinite(coords.lat) &&
      Number.isFinite(coords.lng) &&
      coords.lat >= -90 &&
      coords.lat <= 90 &&
      coords.lng >= -180 &&
      coords.lng <= 180,
  );
}

function stableStopId(stop) {
  const id = stop && (stop.candidate_id || stop.id || stop.place_id);
  if (typeof id === "string" && id.trim()) return id.trim();
  if (Number.isFinite(id)) return String(id);
  return null;
}

function distanceKm(a, b) {
  if (!a || !b) return Infinity;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

module.exports = {
  buildAgnosticRouteOrdering,
  stableStopId,
};
