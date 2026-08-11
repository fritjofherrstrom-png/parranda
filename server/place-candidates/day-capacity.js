const MIN_DAY_CAPACITY_RECORDS = 3;
const MIN_DAY_CAPACITY_CATEGORIES = 3;
const MIN_CAPACITY_SPAN_IMPROVEMENT_KM = 0.3;

// Parranda type -> coarse candidate family. Kept next to the capacity logic so
// source balancing and day-capacity checks share one vocabulary.
const TYPE_CATEGORY = Object.freeze({
  viewpoint: "scenic", park: "scenic", garden: "scenic", promenade: "scenic", castle: "scenic",
  restaurant: "food", "street-food": "food",
  cafe: "coffee",
  bar: "bars",
  market: "market",
  museum: "culture", gallery: "culture",
  beach: "swimming",
  "vintage-shop": "vintage",
});

// A large record count can still describe one compact block. That is useful
// supply, but it cannot honestly support a longer walking-day request. This
// profile stays deliberately conservative: only named, coordinate-bearing,
// non-chain records in distinct Parranda categories may prove day capacity.
// It never claims a route distance; it only decides whether one bounded wider
// source query is justified before composition begins.
function dayCapacityProfile(records, { origin = null, walkingTargetBand = null } = {}) {
  const band = normalizeWalkingTargetBand(walkingTargetBand);
  const eligible = dedupeCapacityRecords(records).filter(
    (record) => record.chain !== true && record.operational_status !== "inactive",
  );
  const categories = new Set(eligible.map((record) => TYPE_CATEGORY[record.type]).filter(Boolean));
  let candidateSpanKm = 0;
  for (let left = 0; left < eligible.length; left += 1) {
    for (let right = left + 1; right < eligible.length; right += 1) {
      if (TYPE_CATEGORY[eligible[left].type] === TYPE_CATEGORY[eligible[right].type]) continue;
      candidateSpanKm = Math.max(candidateSpanKm, distanceKm(eligible[left], eligible[right]));
    }
  }

  const anchorReachKm = Number.isFinite(origin?.lat) && Number.isFinite(origin?.lng)
    ? eligible.reduce((max, record) => Math.max(max, distanceKm(origin, record)), 0)
    : 0;
  const enoughIndependentSupply =
    eligible.length >= MIN_DAY_CAPACITY_RECORDS && categories.size >= MIN_DAY_CAPACITY_CATEGORIES;

  return {
    target_km: roundKm(band?.targetKm),
    target_floor_km: roundKm(band?.floorKm),
    independent_candidate_count: eligible.length,
    category_count: categories.size,
    candidate_span_km: roundKm(candidateSpanKm),
    anchor_reach_km: roundKm(anchorReachKm),
    can_support_target: band
      ? enoughIndependentSupply && candidateSpanKm >= band.floorKm
      : null,
  };
}

// Keep at most two bounded frontier records when a walking target is active.
// This prevents proximity sorting from discarding every farther independent
// place before the planner gets a chance to evaluate a coherent longer day.
// Frontier records still have to be non-chain, operationally eligible, and in
// different Parranda categories; this is not a popularity or distance boost.
function preserveCapacityFrontier(selected, ranked, limit, origin, walkingTargetBand) {
  const band = normalizeWalkingTargetBand(walkingTargetBand);
  if (!band || !Number.isFinite(origin?.lat) || !Number.isFinite(origin?.lng)) return selected;
  const eligible = dedupeCapacityRecords(ranked).filter(
    (record) => record.chain !== true && record.operational_status !== "inactive",
  );
  const pair = selectCapacityFrontierPair(eligible, band);
  if (!pair.length) return selected;

  const output = [...selected];
  const frontierIds = new Set(pair.map((record) => record.id));
  for (const record of pair) {
    if (output.some((item) => item.id === record.id)) continue;
    if (output.length < limit) {
      output.push(record);
      continue;
    }
    const category = TYPE_CATEGORY[record.type];
    let replacement = -1;
    for (let index = output.length - 1; index >= 0; index -= 1) {
      if (frontierIds.has(output[index].id)) continue;
      if (TYPE_CATEGORY[output[index].type] === category) {
        replacement = index;
        break;
      }
    }
    if (replacement < 0) {
      const counts = categoryCounts(output);
      for (let index = output.length - 1; index >= 0; index -= 1) {
        const existingCategory = TYPE_CATEGORY[output[index].type];
        if (!frontierIds.has(output[index].id) && counts.get(existingCategory) > 1) {
          replacement = index;
          break;
        }
      }
    }
    if (replacement >= 0) output[replacement] = record;
  }
  return output;
}

function selectCapacityFrontierPair(records, band) {
  let best = null;
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      if (TYPE_CATEGORY[records[left].type] === TYPE_CATEGORY[records[right].type]) continue;
      const spanKm = distanceKm(records[left], records[right]);
      if (!Number.isFinite(spanKm)) continue;
      const reachesFloor = spanKm >= band.floorKm;
      const withinCeiling = spanKm <= band.ceilingKm;
      const rank = [
        reachesFloor ? 0 : 1,
        reachesFloor && withinCeiling ? 0 : 1,
        reachesFloor ? Math.abs(spanKm - band.targetKm) : -spanKm,
        String(records[left].id),
        String(records[right].id),
      ];
      if (!best || compareTuple(rank, best.rank) < 0) best = { rank, pair: [records[left], records[right]] };
    }
  }
  return best?.pair || [];
}

function compareTuple(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === right[index]) continue;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function categoryCounts(records) {
  const counts = new Map();
  for (const record of records) {
    const category = TYPE_CATEGORY[record.type] || "other";
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return counts;
}

function dedupeCapacityRecords(records) {
  const output = [];
  const seen = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    if (!Number.isFinite(record?.lat) || !Number.isFinite(record?.lng)) continue;
    const key = `${record.lat.toFixed(4)},${record.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(record);
  }
  return output;
}

function normalizeWalkingTargetBand(value) {
  if (!value || typeof value !== "object") return null;
  const targetKm = Number(value.targetKm);
  const floorKm = Number(value.floorKm);
  const ceilingKm = Number(value.ceilingKm);
  if (
    !Number.isFinite(targetKm) || targetKm <= 0 || targetKm > 12 ||
    !Number.isFinite(floorKm) || floorKm <= 0 || floorKm > targetKm ||
    !Number.isFinite(ceilingKm) || ceilingKm < targetKm || ceilingKm > 15
  ) {
    return null;
  }
  return { targetKm, floorKm, ceilingKm };
}

function distanceKm(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function roundKm(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

module.exports = {
  TYPE_CATEGORY,
  MIN_CAPACITY_SPAN_IMPROVEMENT_KM,
  dayCapacityProfile,
  normalizeWalkingTargetBand,
  preserveCapacityFrontier,
};
