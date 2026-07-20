/**
 * Planner candidate combination / proximity helper v0 (#250).
 *
 * The role reservoir (#245) answers each role independently ("scenic_anchor: A,
 * food_anchor: B"). It does NOT say whether A and B form a geographically
 * coherent set worth composing a day from. This pure helper adds that missing
 * bridge: it selects ONE coherent candidate set across the target roles and
 * reports approximate geometry diagnostics.
 *
 * HARD FRAMING: the result is a future-consumption candidate set, NOT a route.
 *   - No routing APIs, no walking-route inference, no travel-time estimates.
 *   - Geometry is approximate (haversine) and conservative; the route engine
 *     keeps the final say on real walking budget / sequencing.
 *   - It never mutates planner output, main_stops, or the input objects.
 *
 * Selection philosophy (lexicographic — role safety before geometry):
 *   1. role coverage (which target roles can be filled at all)
 *   2. status tier (filled > partial) — geometry can NEVER override this
 *   3. geometric coherence (compact cluster preferred)
 *   4. source confidence
 *   5. curated-first when otherwise comparable
 *   6. fewer duplicated venues across roles
 *   7. stable deterministic tie-break by candidate id
 *
 * `selected[]` only ever contains planner-usable (filled/partial) candidates;
 * fallback-only or empty roles surface in `unresolved_roles` so a `ready`
 * combination can never lean on a fallback.
 */

const { resolveHonestyTargetRoles } = require("./dayflow-honesty");

const DEFAULT_TOP_K = 3;
// All six v0 roles × topK=3 = 729 combinations — cheap. The cap exists only
// as a runaway-guard for future role-set growth; it never silently drops a
// requested role (any capped-out requested role surfaces as unresolved with
// reason "capped_out", and a capped result cannot be `ready`).
const DEFAULT_MAX_TARGET_ROLES = 6;
// Conservative, documented coherence thresholds (km, max pairwise distance).
const STRONG_KM = 1.2; // compact, easily-walkable cluster
const OK_KM = 2.5; // plausible city-scale cluster
const GEO_PRECISION = 3; // round km before any comparison → cross-platform determinism
const STATUS_WEIGHT = { filled: 2, partial: 1 };

function buildCandidateCombination(plannerRoles = {}, dayflowHonesty = {}, options = {}) {
  const roles = Array.isArray(plannerRoles.roles) ? plannerRoles.roles : [];
  const topK = clampPositive(options.topK, DEFAULT_TOP_K, 5);
  const maxTargetRoles = clampPositive(options.maxTargetRoles, DEFAULT_MAX_TARGET_ROLES, 6);
  const origin = resolveCoords(options.origin) || resolveCoords(plannerRoles.context?.origin);
  const strongKm = Number.isFinite(options.strongKm) ? options.strongKm : STRONG_KM;
  const okKm = Number.isFinite(options.okKm) ? options.okKm : OK_KM;

  const { kept: targetRoles, dropped: cappedOut } = capTargetRoles(
    resolveHonestyTargetRoles(roles),
    maxTargetRoles,
  );

  // Partition target roles into: those with planner-usable options, those that
  // only have fallback candidates, and those with nothing.
  const usableByRole = [];
  const unresolved = cappedOut.map((role) => ({ role: role.role, reason: "capped_out" }));
  for (const role of targetRoles) {
    const usable = plannerUsableOptionsForRole(role).slice(0, topK);
    if (usable.length) {
      usableByRole.push({ role: role.role, slot: role.slot, options: usable });
    } else {
      const hasFallback = (role.candidates || []).some((c) => c.candidate_status === "fallback");
      unresolved.push({ role: role.role, reason: hasFallback ? "fallback_only" : "no_candidate" });
    }
  }

  if (!usableByRole.length) {
    return emptyResult({ status: "insufficient", unresolved, reason: "no_usable_target_role" });
  }

  const best = chooseBestCombination(usableByRole, { origin, strongKm, okKm });
  const geometry = best.geometry;
  const duplicateRoleCoverage = findDuplicateRoleCoverage(best.picks);

  const status = classifyStatus({ unresolved, geometry, hasSelection: best.picks.length > 0 });
  const qualityFlags = buildQualityFlags({ unresolved, geometry, duplicateRoleCoverage, picks: best.picks });

  return {
    status,
    selected: best.picks.map((pick) => formatSelected(pick)),
    unresolved_roles: unresolved,
    duplicate_role_coverage: duplicateRoleCoverage,
    geometry_summary: geometry,
    quality_flags: qualityFlags,
    reasons: buildReasons({ status, usableByRole, unresolved, geometry, duplicateRoleCoverage }),
  };
}

// Shared trust-tier primitive for every consumer of the role reservoir. The
// combination picker and the engine-depth bridge must agree: weaker admitted,
// adjacent, or chain candidates cannot re-enter merely because a consumer asks
// for more than one option.
function plannerUsableOptionsForRole(role = {}) {
  const usableAll = (Array.isArray(role.candidates) ? role.candidates : []).filter(
    (candidate) =>
      candidate.planner_usable === true &&
      candidate.candidate_status !== "fallback" &&
      candidate.availability?.eligible !== false,
  );
  const gatePassing = usableAll.filter(
    (candidate) => !(candidate.experimental_admission && candidate.experimental_admission.allowed === true),
  );
  const trustTier = gatePassing.length ? gatePassing : usableAll;

  if (!trustTier.some((candidate) => Number.isFinite(candidate.local_feel_rank))) {
    return trustTier;
  }

  const covers = (candidate) =>
    Array.isArray(candidate.covered_preferences) && candidate.covered_preferences.length > 0;
  const covering = trustTier.filter(covers);
  const coveragePool = covering.length ? covering : trustTier;
  const operationalRanks = coveragePool
    .map((candidate) => candidate?.operational_viability?.rank)
    .filter(Number.isFinite);
  const bestOperationalRank = operationalRanks.length ? Math.min(...operationalRanks) : null;
  const operationalPool = bestOperationalRank === null
    ? coveragePool
    : coveragePool.filter((candidate) => candidate?.operational_viability?.rank === bestOperationalRank);
  const feelRank = (candidate) =>
    Number.isFinite(candidate.local_feel_rank) ? candidate.local_feel_rank : 0;
  const bestFeel = operationalPool.reduce((best, candidate) => Math.min(best, feelRank(candidate)), 3);
  return operationalPool.filter((candidate) => feelRank(candidate) === bestFeel);
}

// --- combination search ----------------------------------------------------

function chooseBestCombination(usableByRole, geoOpts) {
  let best = null;
  for (const combo of cartesian(usableByRole)) {
    const geometry = summarizeGeometry(combo, geoOpts);
    const score = scoreCombination(combo, geometry);
    if (!best) {
      best = { picks: combo, geometry, score, idKey: comboIdKey(combo) };
      continue;
    }
    const cmp = compareScore(score, best.score);
    if (cmp > 0) {
      best = { picks: combo, geometry, score, idKey: comboIdKey(combo) };
    } else if (cmp === 0) {
      // 7. deterministic final tie-break: lexicographic by sorted candidate ids
      // so caller order can never change the winner.
      const idKey = comboIdKey(combo);
      if (idKey < best.idKey) {
        best = { picks: combo, geometry, score, idKey };
      }
    }
  }
  return best;
}

function comboIdKey(combo) {
  return combo
    .map((pick) => String(pick.candidate.candidate_id || ""))
    .sort()
    .join("|");
}

// combo = [{ role, slot, candidate }]
function* cartesian(usableByRole) {
  if (!usableByRole.length) return;
  const indices = usableByRole.map(() => 0);
  while (true) {
    yield usableByRole.map((entry, i) => ({ role: entry.role, slot: entry.slot, candidate: entry.options[indices[i]] }));
    let dim = usableByRole.length - 1;
    while (dim >= 0) {
      indices[dim] += 1;
      if (indices[dim] < usableByRole[dim].options.length) break;
      indices[dim] = 0;
      dim -= 1;
    }
    if (dim < 0) break;
  }
}

// Lexicographic score tuple (all "higher is better").
function scoreCombination(combo, geometry) {
  const statusTier = combo.reduce((sum, p) => sum + (STATUS_WEIGHT[p.candidate.candidate_status] || 0), 0);
  const confidence = combo.reduce((sum, p) => sum + confidenceRank(p.candidate.confidence), 0);
  const curated = combo.filter((p) => p.candidate.origin === "curated_catalog").length;
  const distinctVenues = new Set(combo.map((p) => p.candidate.candidate_id)).size;
  return [
    statusTier, // 2. status tier (geometry can never override this)
    -geometry.max_pairwise_km, // 3. geometry: smaller spread is better (rounded → deterministic)
    confidence, // 4. confidence
    curated, // 5. curated-first
    distinctVenues, // 6. fewer duplicate venues = more distinct = higher
  ];
}

function compareScore(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  // 7. Final candidate-id tie-break is handled by chooseBestCombination().
  return 0;
}

// --- geometry --------------------------------------------------------------

function summarizeGeometry(combo, { origin, strongKm, okKm }) {
  const geocoded = combo.map((p) => resolveCoords(p.candidate.coordinates)).filter(Boolean);
  const candidateCount = combo.length;
  const geocodedCount = geocoded.length;

  // Addition: a single point has no spread; only MISSING coordinates make a
  // combination "incomplete".
  let maxPairwise = 0;
  let totalPairwise = 0;
  let pairCount = 0;
  for (let i = 0; i < geocoded.length; i += 1) {
    for (let j = i + 1; j < geocoded.length; j += 1) {
      const km = haversineKm(geocoded[i], geocoded[j]);
      maxPairwise = Math.max(maxPairwise, km);
      totalPairwise += km;
      pairCount += 1;
    }
  }
  const centroid = geocoded.length ? meanCoords(geocoded) : null;

  let coherence;
  const reasons = [];
  if (geocodedCount < candidateCount) {
    coherence = "incomplete";
    reasons.push("missing_coordinates");
  } else if (maxPairwise <= strongKm) {
    coherence = "strong";
    reasons.push(geocodedCount <= 1 ? "single_point" : "compact_cluster");
  } else if (maxPairwise <= okKm) {
    coherence = "ok";
    reasons.push("plausible_city_walk");
  } else {
    coherence = "weak";
    reasons.push("too_spread_out");
  }

  const summary = {
    candidate_count: candidateCount,
    geocoded_count: geocodedCount,
    max_pairwise_km: round(maxPairwise),
    average_pairwise_km: round(pairCount ? totalPairwise / pairCount : 0),
    centroid: centroid ? { lat: round(centroid.lat, 5), lng: round(centroid.lng, 5) } : null,
    coherence,
    reasons,
  };
  // Addition: expose origin→centroid distance when an origin is known. Not a
  // gate in v0 — a cluster can be compact yet far from the user.
  if (origin && centroid) {
    summary.origin_distance_km = round(haversineKm(origin, centroid));
  }
  return summary;
}

// --- classification --------------------------------------------------------

function classifyStatus({ unresolved, geometry, hasSelection }) {
  if (!hasSelection) return "insufficient";
  if (geometry.coherence === "weak") return "weak_geometry";
  if (geometry.coherence === "incomplete") return "partial";
  if (unresolved.length) return "partial";
  return "ready";
}

function findDuplicateRoleCoverage(picks) {
  const byId = new Map();
  for (const pick of picks) {
    const list = byId.get(pick.candidate.candidate_id) || [];
    list.push(pick.role);
    byId.set(pick.candidate.candidate_id, list);
  }
  return [...byId.entries()]
    .filter(([, roleList]) => roleList.length > 1)
    .map(([candidate_id, roleList]) => ({ candidate_id, roles: roleList }));
}

function buildQualityFlags({ unresolved, geometry, duplicateRoleCoverage, picks }) {
  const flags = new Set();
  if (geometry.coherence === "weak") flags.add("weak_geometry");
  if (geometry.coherence === "incomplete") flags.add("incomplete_geometry_missing_coordinates");
  for (const role of unresolved) {
    if (role.reason === "fallback_only") flags.add(`fallback_only_${role.role}`);
    else if (role.reason === "capped_out") flags.add(`capped_out_${role.role}`);
    else flags.add(`missing_${role.role}`);
  }
  if (duplicateRoleCoverage.length) flags.add("duplicate_role_coverage");
  if (picks.length && picks.every((p) => p.candidate.origin !== "curated_catalog")) {
    flags.add("external_only_combination");
  }
  if (picks.length === 1) flags.add("single_role_combination");
  return [...flags].sort();
}

function buildReasons({ status, usableByRole, unresolved, geometry, duplicateRoleCoverage }) {
  const reasons = [`status:${status}`, `coherence:${geometry.coherence}`, `roles_selected:${usableByRole.length}`];
  if (unresolved.length) reasons.push(`unresolved:${unresolved.map((r) => r.role).join(",")}`);
  if (duplicateRoleCoverage.length) reasons.push(`duplicate_venues:${duplicateRoleCoverage.length}`);
  if (Number.isFinite(geometry.origin_distance_km)) reasons.push(`origin_distance_km:${geometry.origin_distance_km}`);
  return reasons;
}

function formatSelected(pick) {
  const c = pick.candidate;
  const reasons = Array.isArray(c.fit_reasons) ? c.fit_reasons.slice(0, 6) : [];
  // #272 honesty: with tier-restricted options, a selected chain means no
  // non-chain option could fill this role — say so on the stop itself. The
  // rank exists only in the agnostic experiment path.
  if (Number.isFinite(c.local_feel_rank) && c.local_feel_rank >= 2) {
    reasons.push("chain_fallback_no_local_option");
  }
  if (Array.isArray(c.local_feel_reasons) && c.local_feel_reasons.length) {
    for (const reason of c.local_feel_reasons) {
      if (!reasons.includes(reason)) reasons.push(reason);
    }
  }
  const localFeelReasons = [
    ...(Array.isArray(c.local_feel_reasons) ? c.local_feel_reasons : []),
    ...(Number.isFinite(c.local_feel_rank) && c.local_feel_rank >= 2 ? ["chain_fallback_no_local_option"] : []),
  ];
  return {
    role: pick.role,
    candidate_id: c.candidate_id,
    label: c.label,
    candidate_status: c.candidate_status,
    planner_usable: c.planner_usable === true,
    origin: c.origin,
    confidence: c.confidence,
    coordinates: resolveCoords(c.coordinates),
    also_covers: Array.isArray(c.also_covers) ? c.also_covers : [],
    reasons,
    // Present only when the agnostic experiment seam computed the rank.
    ...(Number.isFinite(c.local_feel_rank)
      ? { local_feel_rank: c.local_feel_rank, local_feel_reasons: localFeelReasons }
      : {}),
    experimental_admission: c.experimental_admission || null,
  };
}

function emptyResult({ status, unresolved, reason }) {
  return {
    status,
    selected: [],
    unresolved_roles: unresolved,
    duplicate_role_coverage: [],
    geometry_summary: {
      candidate_count: 0,
      geocoded_count: 0,
      max_pairwise_km: 0,
      average_pairwise_km: 0,
      centroid: null,
      coherence: "incomplete",
      reasons: ["no_selection"],
    },
    quality_flags: unresolved
      .map((r) => {
        if (r.reason === "fallback_only") return `fallback_only_${r.role}`;
        if (r.reason === "capped_out") return `capped_out_${r.role}`;
        return `missing_${r.role}`;
      })
      .sort(),
    reasons: [`status:${status}`, reason],
  };
}

// --- helpers ---------------------------------------------------------------

function capTargetRoles(targetRoles, max) {
  if (targetRoles.length <= max) return { kept: targetRoles, dropped: [] };
  // Anchors first (slot === "anchor"), then the rest in their existing order.
  // Anything beyond the cap surfaces as `dropped` — capped-out REQUESTED roles
  // must become explicit unresolved so the result can never be `ready`.
  const anchors = targetRoles.filter((r) => r.slot === "anchor");
  const rest = targetRoles.filter((r) => r.slot !== "anchor");
  const ordered = [...anchors, ...rest];
  return { kept: ordered.slice(0, max), dropped: ordered.slice(max) };
}

function confidenceRank(value) {
  return { high: 3, medium: 2, low: 1, needs_review: 0 }[String(value)] ?? 0;
}

function resolveCoords(value) {
  if (!value || typeof value !== "object") return null;
  if (Number.isFinite(value.lat) && Number.isFinite(value.lng)) return { lat: value.lat, lng: value.lng };
  return null;
}

function meanCoords(coords) {
  const lat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
  return { lat, lng };
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function round(value, precision = GEO_PRECISION) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clampPositive(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

module.exports = {
  DEFAULT_TOP_K,
  DEFAULT_MAX_TARGET_ROLES,
  STRONG_KM,
  OK_KM,
  buildCandidateCombination,
  plannerUsableOptionsForRole,
};
