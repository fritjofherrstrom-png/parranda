/**
 * Agnostic route ordering experiment.
 *
 * Sequences the candidate-combination role order for the flag-gated any-place
 * route-output experiment. Ordering is daypart-PRIMARY (a day should read
 * morning → evening: coffee/scenic earlier, the food anchor mid-day, an evening
 * bar last) with proximity as the SECONDARY tie-break WITHIN a daypart slot and
 * across slot transitions. This is deliberately NOT a TSP / shortest-route
 * optimizer: it trades a little walking for a day that makes sense, and the
 * caller still validates the produced order against the walking budget.
 *
 * This helper is small and pure:
 *   - it never fetches;
 *   - it never mutates the input body;
 *   - it never claims an optimal/fast route;
 *   - it never consults public payload — only the trusted candidate stops.
 */

// Role → daypart slot rank (lower = earlier in the day). Generic and
// deterministic; no city-specific logic, no clock dependency. Stops sharing a
// slot are ordered by proximity. Unknown roles land in the neutral midday slot.
const DAYPART_SLOT = {
  coffee_fika_stop: 0, // morning fika
  scenic_anchor: 1, // daytime walk (park / viewpoint / waterfront)
  swimming_coast_option: 1,
  vintage_second_hand_option: 1,
  food_anchor: 2, // the day's main meal (lunch / dinner)
  evening_bar_option: 3, // evening
};
const DEFAULT_SLOT = 2;

function daypartSlot(stop) {
  const role = stop && typeof stop.role === "string" ? stop.role : "";
  return Object.prototype.hasOwnProperty.call(DAYPART_SLOT, role) ? DAYPART_SLOT[role] : DEFAULT_SLOT;
}

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

  const { orderedStops, proximityReordered } = daypartProximitySequence(stops);
  const orderedIds = orderedStops.map(stableStopId).filter(Boolean);
  const changed = orderedIds.join("|") !== originalIds.join("|");
  if (!changed) {
    return {
      adaptedBody: cloneAdaptedBody(body, stops),
      ordering: {
        ...base,
        ordered_stop_ids: orderedIds,
        reasons: ["candidate_role_order_already_daypart_coherent"],
      },
    };
  }

  const reasons = ["daypart_sequence_applied"];
  if (proximityReordered) reasons.push("proximity_within_daypart");
  reasons.push("requires_walking_budget_validation");
  return {
    adaptedBody: cloneAdaptedBody(body, orderedStops),
    ordering: {
      applied: true,
      changed: true,
      source: "trusted_candidate_pool+daypart_rhythm+proximity_sequence",
      confidence: "walking_budget_candidate",
      original_stop_ids: originalIds,
      ordered_stop_ids: orderedIds,
      reasons,
    },
  };
}

// Daypart-primary, proximity-secondary sequencing. Slots are walked in
// ascending daypart rank; within a slot, stops are chained by nearest-neighbour
// starting from the stop closest to where the previous slot ended (so the walk
// stays sensible across the day). Pure and deterministic given the input order.
function daypartProximitySequence(stops) {
  const slots = new Map();
  for (const stop of stops) {
    const slot = daypartSlot(stop);
    if (!slots.has(slot)) slots.set(slot, []);
    slots.get(slot).push(stop);
  }
  const slotRanks = [...slots.keys()].sort((a, b) => a - b);

  const ordered = [];
  let proximityReordered = false;
  let anchor = null; // last placed stop — the start point for the next slot's chain
  for (const rank of slotRanks) {
    const bucket = slots.get(rank);
    // Start each slot from the bucket member nearest the previous anchor (or the
    // role-order-first member for the very first slot), then nearest-neighbour
    // within the slot.
    const chained = proximityChain(bucket, anchor);
    if (chainReordered(bucket, chained)) proximityReordered = true;
    ordered.push(...chained);
    anchor = chained[chained.length - 1];
  }
  return { orderedStops: ordered, proximityReordered };
}

// Nearest-neighbour chain over `bucket`, starting from the member closest to
// `anchor` (or the first member when anchor is null). Preserves input order on
// exact ties for determinism.
function proximityChain(bucket, anchor) {
  if (bucket.length <= 1) return bucket.slice();
  const remaining = bucket.map((stop, index) => ({ stop, index }));
  let startPos = 0;
  if (anchor && anchor.coordinates) {
    let best = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const d = distanceKm(anchor.coordinates, remaining[i].stop.coordinates);
      if (d < best) {
        best = d;
        startPos = i;
      }
    }
  }
  const ordered = [remaining.splice(startPos, 1)[0]];
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

function chainReordered(before, after) {
  for (let i = 0; i < before.length; i += 1) {
    if (stableStopId(before[i]) !== stableStopId(after[i])) return true;
  }
  return false;
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
