const MIN_DAY_CAPACITY_RECORDS = 3;
const MIN_DAY_CAPACITY_CATEGORIES = 3;
const MIN_CAPACITY_SPAN_IMPROVEMENT_KM = 0.3;
// The aperture a day is collected from, when the caller says nothing about how
// far the user wants to walk. It is a FLOOR, not the answer: see
// budgetAwareRadiusKm below.
//
// This constant used to be the whole story, justified as "1.5 km reach catches
// the scenic/cultural/second-hand places that cluster outside a tight centre".
// Product QA across Stockholm, Malmö, Ystad and Kivik measured that claim and
// it does not hold for a long day: a 9 km request drew from exactly the same
// 1.5 km disc as a 4 km request, so candidate span could not exceed ~3 km,
// `can_support_target` was false in 84 of 87 scenarios that reported it, and a
// longer budget produced a longer route in ZERO of 60 comparable groups.
const DEFAULT_WALKING_REACH_KM = 1.5;
// A day is a loop back to where it started, so the useful reach from the anchor
// is roughly a quarter of the distance walked: span ~= 2 * radius ~= target / 2,
// leaving the rest of the budget for the legs between stops. Below the default
// this changes nothing (a short day keeps today's aperture); above it the disc
// grows with the ask and stays inside the reviewed ceiling. Generic — derived
// from the requested budget alone, never from a place.
const WALKING_REACH_PER_TARGET_KM = 0.25;
const MAX_WALKING_REACH_KM = 5.0;
// Distance rings (km from the anchor) that describe the walkable disc for every
// sampled source. They are walking-reach thresholds shared by every request,
// never places: thirds of the default 1.5 km reach resolve the near-anchor,
// 2.25 km and 3 km are the reach of a 9 km and a 12 km (maximum) day — 3 km is
// also the exact-anchor candidate reach — and the last ring is open-ended.
const WALKING_REACH_RING_EDGES_KM = Object.freeze([0.5, 1, 1.5, 2.25, 3]);

// Parranda type -> coarse candidate family. Kept next to the capacity logic so
// source balancing and day-capacity checks share one vocabulary.
const TYPE_CATEGORY = Object.freeze({
  viewpoint: "scenic", park: "scenic", garden: "scenic", promenade: "scenic", castle: "scenic",
  "historic-site": "scenic", monument: "scenic", lighthouse: "scenic",
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

/**
 * How far from the anchor to collect candidates for a day of `targetKm`.
 *
 * A day returns to where it began, so the reach that matters is about a quarter
 * of the distance walked — that puts the candidate span at roughly half the
 * budget and leaves the rest for the legs between stops. Never narrower than
 * the default (a short day is unchanged) and never past the reviewed ceiling.
 *
 * Depends only on the requested budget: no place, no city, no source. Every
 * place source that samples a walkable disc (Overpass, the Overture directory)
 * shares this one definition so their samples describe the same disc.
 */
function budgetAwareRadiusKm(walkingTargetBand, defaultRadiusKm = DEFAULT_WALKING_REACH_KM) {
  const targetKm = Number(walkingTargetBand?.targetKm);
  if (!Number.isFinite(targetKm) || targetKm <= 0) return defaultRadiusKm;
  const reachKm = Math.max(defaultRadiusKm, targetKm * WALKING_REACH_PER_TARGET_KM);
  return Math.max(0.1, Math.min(MAX_WALKING_REACH_KM, reachKm));
}

function walkingReachRing(distanceKmValue) {
  const index = WALKING_REACH_RING_EDGES_KM.findIndex((edge) => distanceKmValue < edge);
  return index < 0 ? WALKING_REACH_RING_EDGES_KM.length : index;
}

/**
 * Order candidate records across the walkable disc instead of nearest-first.
 *
 * Items are grouped by (distance ring, stratum) and taken by weighted
 * round-robin: the k-th item of a group is worth (k + 1) / weight. Rings inside
 * the walking reach weigh 1, the next ring out 0.5 and anything farther 0.25,
 * so a longer day draws deeper into the disc while a short day stays near and
 * still keeps a frontier. `compare` orders items inside a group; `weightOf`
 * may favour whole groups (for example a requested intent). A sampled source
 * that keeps only the nearest N records describes a few hundred metres of a
 * dense centre, whatever budget was asked for. Pure and deterministic.
 */
function interleaveAcrossWalkingReach(items, {
  walkingTargetBand,
  ringOf,
  stratumOf = () => "",
  weightOf = () => 1,
  compare,
}) {
  const reachKm = budgetAwareRadiusKm(walkingTargetBand);
  const innerKm = (ring) => (ring <= 0 ? 0 : WALKING_REACH_RING_EDGES_KM[ring - 1]);
  const ringWeight = (ring) => {
    if (innerKm(ring) < reachKm) return 1;
    return innerKm(ring - 1) < reachKm ? 0.5 : 0.25;
  };
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const ring = ringOf(item);
    const key = `${ring}|${stratumOf(item)}`;
    if (!groups.has(key)) groups.set(key, { ring, members: [] });
    groups.get(key).members.push(item);
  }
  const prioritized = [];
  for (const { ring, members } of groups.values()) {
    members.sort(compare);
    const weight = ringWeight(ring) * weightOf(members);
    members.forEach((item, rank) => prioritized.push({ item, ring, priority: (rank + 1) / weight }));
  }
  return prioritized
    .sort((left, right) => left.priority - right.priority || left.ring - right.ring || compare(left.item, right.item))
    .map(({ item }) => item);
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
  DEFAULT_WALKING_REACH_KM,
  MAX_WALKING_REACH_KM,
  WALKING_REACH_RING_EDGES_KM,
  budgetAwareRadiusKm,
  walkingReachRing,
  interleaveAcrossWalkingReach,
  dayCapacityProfile,
  normalizeWalkingTargetBand,
  preserveCapacityFrontier,
};
