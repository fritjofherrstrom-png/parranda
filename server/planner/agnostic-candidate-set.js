/**
 * Constrained candidate-set selection for agnostic compose.
 *
 * The role reservoir supplies a trusted spine plus bounded alternatives. This
 * helper evaluates those alternatives as WHOLE day sets before the route engine
 * sequences and walking-validates them. It is intentionally not a router: all
 * distances are conservative straight-line diagnostics, and the route engine
 * remains authoritative for order, walking geometry and public route truth.
 */

const { daypartSlotForRole } = require("./agnostic-route-ordering");
const { resolveAgnosticWalkingTargetBand } = require("./agnostic-walking-target");

const DEFAULT_POOL_LIMIT = 12;
const MAX_SET_SIZE = 6;
const WALKING_DISTANCE_FACTOR = 1.22;
// A walking preset is a product target, not only a ceiling. Below 60% the
// selected day is honestly under-filled unless stronger request coverage wins.

function selectAgnosticCandidateSet({
  rankedCandidates = [],
  desiredCount = 0,
  requestedPreferences = [],
  start = null,
  end = null,
  shape = "loop",
  targetKm = null,
  poolLimit = DEFAULT_POOL_LIMIT,
} = {}) {
  const preferences = normalizePreferences(requestedPreferences);
  const rankedPool = uniqueRankedCandidates(rankedCandidates)
    .filter(({ item }) => finitePoint(item))
    .sort(compareRankedCandidates);
  const pool = buildEvaluationPool(
    rankedPool,
    preferences,
    clampInteger(poolLimit, DEFAULT_POOL_LIMIT, DEFAULT_POOL_LIMIT),
  );
  const count = Math.min(pool.length, clampInteger(desiredCount, pool.length, MAX_SET_SIZE));
  if (!count) return { selected: [], diagnostics: emptyDiagnostics() };
  if (pool.length <= count) {
    const selected = pool.map(({ item }) => item);
    return {
      selected,
      diagnostics: describeSet(pool, preferences, {
        start,
        end,
        shape,
        targetKm,
      }),
    };
  }

  let best = null;
  for (const subset of combinations(pool, count)) {
    const diagnostics = describeSet(subset, preferences, { start, end, shape, targetKm });
    const score = scoreSet(diagnostics);
    const idKey = subset.map(({ item }) => stableId(item)).sort().join("|");
    if (!best || compareTuple(score, best.score) > 0 || (compareTuple(score, best.score) === 0 && idKey < best.idKey)) {
      best = { subset, diagnostics, score, idKey };
    }
  }

  return {
    selected: best ? best.subset.map(({ item }) => item) : [],
    diagnostics: best ? best.diagnostics : emptyDiagnostics(),
  };
}

function describeSet(entries, preferences, { start, end, shape, targetKm }) {
  const exactByPreference = new Map(preferences.map((preference) => [preference, 0]));
  const partialByPreference = new Map(preferences.map((preference) => [preference, 0]));
  const spineRoles = new Set();
  const roles = new Set();
  const dayparts = new Set();
  const families = new Map();
  let spineCount = 0;
  let chainCount = 0;
  let localQuality = 0;
  let trustQuality = 0;
  let operationalQuality = 0;
  let individualScore = 0;

  for (const { item, score } of entries) {
    const covered = candidatePreferences(item, "coveredPreferences", "covered_preferences");
    const partial = candidatePreferences(item, "partialPreferences", "partial_preferences");
    for (const preference of preferences) {
      if (covered.includes(preference)) exactByPreference.set(preference, exactByPreference.get(preference) + 1);
      else if (partial.includes(preference)) partialByPreference.set(preference, partialByPreference.get(preference) + 1);
    }

    const candidateRoles = routeRoles(item);
    for (const role of candidateRoles) {
      roles.add(role);
      dayparts.add(daypartSlotForRole(role));
      if (item.reservoirSpine === true) spineRoles.add(role);
    }
    if (item.reservoirSpine === true) spineCount += 1;
    if (item.chain === true) chainCount += 1;
    const family = candidateFamily(item);
    if (family) families.set(family, (families.get(family) || 0) + 1);
    const feelRank = Number.isFinite(item.localFeelRank) ? item.localFeelRank : item.chain === true ? 2 : 0;
    localQuality += Math.max(0, 3 - feelRank);
    trustQuality += candidateTrustRank(item);
    operationalQuality += operationalRank(item);
    individualScore += Number.isFinite(score) ? score : 0;
  }

  const exactPreferenceCount = [...exactByPreference.values()].filter((count) => count > 0).length;
  const partialPreferenceCount = [...partialByPreference.entries()].filter(
    ([preference, count]) => count > 0 && exactByPreference.get(preference) === 0,
  ).length;
  const boundedExactHits = [...exactByPreference.values()].reduce((sum, count) => sum + Math.min(2, count), 0);
  const geometry = approximateDayGeometry(entries.map(({ item }) => item), { start, end, shape });
  const target = Number.isFinite(targetKm) && targetKm > 0 ? targetKm : null;
  const targetBand = resolveAgnosticWalkingTargetBand(target);
  const budgetLimit = targetBand?.ceilingKm ?? null;
  const targetFloor = targetBand?.floorKm ?? null;
  const withinBudget = budgetLimit === null || geometry.estimated_km <= budgetLimit;
  const withinTargetBand =
    targetFloor === null || (geometry.estimated_km >= targetFloor && geometry.estimated_km <= budgetLimit);
  const overBudgetKm = budgetLimit === null ? 0 : Math.max(0, geometry.estimated_km - budgetLimit);
  const underTargetKm = targetFloor === null ? 0 : Math.max(0, targetFloor - geometry.estimated_km);
  // Preserve compactness when no target exists; with a target, prefer the
  // closest coherent set rather than automatically collapsing to the shortest.
  const targetDistanceKm = target === null ? geometry.estimated_km : Math.abs(target - geometry.estimated_km);
  const duplicateFamilyCount = [...families.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const coveredPreferences = preferences.filter((preference) => exactByPreference.get(preference) > 0);
  const partialPreferences = preferences.filter(
    (preference) => exactByPreference.get(preference) === 0 && partialByPreference.get(preference) > 0,
  );
  const missingPreferences = preferences.filter(
    (preference) => exactByPreference.get(preference) === 0 && partialByPreference.get(preference) === 0,
  );

  return {
    exact_preference_count: exactPreferenceCount,
    partial_preference_count: partialPreferenceCount,
    bounded_exact_hits: boundedExactHits,
    spine_role_count: spineRoles.size,
    spine_candidate_count: spineCount,
    role_count: roles.size,
    daypart_count: dayparts.size,
    unique_family_count: families.size,
    duplicate_family_count: duplicateFamilyCount,
    chain_count: chainCount,
    local_quality: localQuality,
    trust_quality: trustQuality,
    operational_quality: operationalQuality,
    within_budget: withinBudget,
    within_target_band: withinTargetBand,
    target_floor_km: round(targetFloor),
    over_budget_km: round(overBudgetKm),
    under_target_km: round(underTargetKm),
    target_distance_km: round(targetDistanceKm),
    estimated_km: geometry.estimated_km,
    longest_leg_km: geometry.longest_leg_km,
    individual_score: round(individualScore),
    ordered_candidate_ids: geometry.ordered_candidate_ids,
    covered_preferences: coveredPreferences,
    partial_preferences: partialPreferences,
    missing_preferences: missingPreferences,
  };
}

// Higher is better. Coverage and the reservoir's admitted spine are hard
// product constraints. Geometry then rejects implausible sets before marginal
// trust/score gains, while a farther candidate may still win when it adds a
// genuinely missing requested preference or daypart.
function scoreSet(diagnostics) {
  return [
    diagnostics.exact_preference_count,
    diagnostics.spine_role_count,
    diagnostics.partial_preference_count,
    diagnostics.within_budget ? 1 : 0,
    diagnostics.daypart_count,
    diagnostics.within_target_band ? 1 : 0,
    diagnostics.bounded_exact_hits,
    diagnostics.role_count,
    diagnostics.unique_family_count,
    diagnostics.local_quality,
    diagnostics.operational_quality,
    diagnostics.trust_quality,
    -diagnostics.duplicate_family_count,
    -diagnostics.chain_count,
    -diagnostics.over_budget_km,
    -diagnostics.under_target_km,
    -diagnostics.target_distance_km,
    -diagnostics.longest_leg_km,
    diagnostics.individual_score,
    diagnostics.spine_candidate_count,
  ];
}

function approximateDayGeometry(items, { start, end, shape }) {
  const byDaypart = new Map();
  for (const item of items) {
    const slot = Math.min(...routeRoles(item).map(daypartSlotForRole), 2);
    if (!byDaypart.has(slot)) byDaypart.set(slot, []);
    byDaypart.get(slot).push(item);
  }

  const ordered = [];
  let cursor = finitePoint(start);
  for (const slot of [...byDaypart.keys()].sort((left, right) => left - right)) {
    const remaining = byDaypart.get(slot).slice();
    while (remaining.length) {
      let index = 0;
      if (cursor) {
        for (let candidateIndex = 1; candidateIndex < remaining.length; candidateIndex += 1) {
          const candidateDistance = haversineKm(cursor, remaining[candidateIndex]);
          const currentDistance = haversineKm(cursor, remaining[index]);
          if (
            candidateDistance < currentDistance ||
            (candidateDistance === currentDistance && stableId(remaining[candidateIndex]) < stableId(remaining[index]))
          ) {
            index = candidateIndex;
          }
        }
      } else {
        remaining.sort((left, right) => stableId(left).localeCompare(stableId(right)));
      }
      const [next] = remaining.splice(index, 1);
      ordered.push(next);
      cursor = next;
    }
  }

  const points = [];
  if (finitePoint(start)) points.push(start);
  points.push(...ordered);
  if (shape === "arc" && finitePoint(end)) points.push(end);
  else if (shape === "loop" && finitePoint(start)) points.push(start);

  let total = 0;
  let longest = 0;
  for (let index = 1; index < points.length; index += 1) {
    const leg = haversineKm(points[index - 1], points[index]) * WALKING_DISTANCE_FACTOR;
    total += leg;
    longest = Math.max(longest, leg);
  }
  return {
    estimated_km: round(total),
    longest_leg_km: round(longest),
    ordered_candidate_ids: ordered.map(stableId),
  };
}

function candidatePreferences(item, camelKey, snakeKey) {
  const hasExplicitFit = Array.isArray(item?.[camelKey]) || Array.isArray(item?.[snakeKey]);
  const values = Array.isArray(item?.[camelKey])
    ? item[camelKey]
    : Array.isArray(item?.[snakeKey])
      ? item[snakeKey]
      : camelKey === "coveredPreferences" && !hasExplicitFit && Array.isArray(item?.tags)
        ? item.tags
        : [];
  return values.map(normalizeToken).filter(Boolean);
}

function buildEvaluationPool(ranked, preferences, limit) {
  const requestedRepresentatives = [];
  for (const preference of preferences) {
    const exact = ranked.find(({ item }) =>
      candidatePreferences(item, "coveredPreferences", "covered_preferences").includes(preference),
    );
    const adjacent = exact
      ? null
      : ranked.find(({ item }) =>
          candidatePreferences(item, "partialPreferences", "partial_preferences").includes(preference),
        );
    if (exact || adjacent) requestedRepresentatives.push(exact || adjacent);
  }

  const selected = [];
  const seen = new Set();
  for (const entry of [...requestedRepresentatives, ...ranked]) {
    const id = stableId(entry.item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    selected.push(entry);
    if (selected.length >= limit) break;
  }
  return selected;
}

function compareRankedCandidates(left, right) {
  return right.score - left.score || stableId(left.item).localeCompare(stableId(right.item));
}

function candidateFamily(item) {
  return normalizeToken(item?.type || item?.candidateKind || item?.candidate_kind || routeRoles(item)[0]);
}

function routeRoles(item) {
  const roles = Array.isArray(item?.routeRoles)
    ? item.routeRoles
    : Array.isArray(item?.route_roles)
      ? item.route_roles
      : item?.role
        ? [item.role]
        : [];
  return [...new Set(roles.map(normalizeToken).filter(Boolean))];
}

function candidateTrustRank(item) {
  const confidence = item?.trust?.confidence || item?.confidence;
  const confidenceRank = { high: 3, strong: 3, medium: 2, low: 1, needs_review: 0 }[String(confidence)] || 0;
  return confidenceRank + (item?.trust?.human_verified === true ? 2 : 0) + (item?.candidateOrigin === "curated_catalog" ? 2 : 0);
}

function operationalRank(item) {
  const rank = Number.isFinite(item?.operationalViabilityRank)
    ? item.operationalViabilityRank
    : Number.isFinite(item?.operational_viability?.rank)
      ? item.operational_viability.rank
      : null;
  return rank === null ? 0 : Math.max(0, 3 - rank);
}

function uniqueRankedCandidates(entries) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const item = entry?.item;
    const id = stableId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ item, score: Number(entry.score) || 0 });
  }
  return out;
}

function* combinations(values, size, start = 0, prefix = []) {
  if (prefix.length === size) {
    yield prefix;
    return;
  }
  for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
    yield* combinations(values, size, index + 1, [...prefix, values[index]]);
  }
}

function compareTuple(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function normalizePreferences(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeToken).filter(Boolean))];
}

function normalizeToken(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function stableId(item) {
  const id = item?.id || item?.candidate_id || item?.place_id;
  return id == null ? "" : String(id);
}

function finitePoint(value) {
  return value && Number.isFinite(value.lat) && Number.isFinite(value.lng) ? value : null;
}

function haversineKm(left, right) {
  const leftPoint = finitePoint(left);
  const rightPoint = finitePoint(right);
  if (!leftPoint || !rightPoint) return Number.POSITIVE_INFINITY;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = toRad(leftPoint.lat);
  const lat2 = toRad(rightPoint.lat);
  const dLat = toRad(rightPoint.lat - leftPoint.lat);
  const dLng = toRad(rightPoint.lng - leftPoint.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function clampInteger(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return Math.min(Math.max(0, fallback), max);
  return Math.min(Math.trunc(number), max);
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

function emptyDiagnostics() {
  return {
    exact_preference_count: 0,
    partial_preference_count: 0,
    bounded_exact_hits: 0,
    spine_role_count: 0,
    spine_candidate_count: 0,
    role_count: 0,
    daypart_count: 0,
    unique_family_count: 0,
    duplicate_family_count: 0,
    chain_count: 0,
    local_quality: 0,
    trust_quality: 0,
    operational_quality: 0,
    within_budget: true,
    within_target_band: true,
    target_floor_km: 0,
    over_budget_km: 0,
    under_target_km: 0,
    target_distance_km: 0,
    estimated_km: 0,
    longest_leg_km: 0,
    individual_score: 0,
    ordered_candidate_ids: [],
    covered_preferences: [],
    partial_preferences: [],
    missing_preferences: [],
  };
}

module.exports = {
  selectAgnosticCandidateSet,
};
