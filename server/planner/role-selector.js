/**
 * Planner role selector v0.
 *
 * Helper-only bridge from the Candidate Intelligence Spine to future Planner /
 * Your Day composition. It does NOT sequence routes or change public Planner
 * output; it returns role-safe candidate reservoirs with trust/why metadata.
 */

const {
  buildEligibleCandidatePool,
  candidateOrigin,
  candidateProvenance,
  operationalViabilityRank,
  rankEligible,
} = require("../candidates/candidate-pool");
const { scoreCandidateFit } = require("../candidates/fit-scorer");
const { calibrateSource } = require("../candidates/source-calibration");
const { normalizeWalkingTargetBand } = require("../place-candidates/day-capacity");
const {
  distanceKm,
  sanitizeCandidateReachPolicy,
} = require("./candidate-reach-policy");

const ROLE_SPEC = Object.freeze({
  scenic_anchor: { intents: ["scenic"], slot: "anchor", gate: "may_anchor_route", primaryTypes: ["viewpoint", "lookout", "overlook"] },
  food_anchor: { intents: ["food"], slot: "anchor", gate: "may_anchor_route", primaryTypes: ["restaurant"] },
  coffee_fika_stop: { intents: ["coffee"], slot: "stop", gate: "may_influence_routes", primaryTypes: ["cafe"] },
  evening_bar_option: { intents: ["bars"], slot: "option", gate: "may_influence_routes", primaryTypes: ["bar"] },
  swimming_coast_option: { intents: ["swimming"], slot: "option", gate: "may_influence_routes", primaryTypes: ["beach"] },
  vintage_second_hand_option: { intents: ["second_hand"], slot: "option", gate: "may_influence_routes", primaryTypes: ["vintage-shop"] },
});

// #277/#278 — roles that exist ONLY in the flag-gated agnostic route-output
// experiment (activated by the same experimentalAdmitCandidate seam as #270/#272).
// The `museums` and `markets` intents + matching loader types already existed;
// without route roles those requested preferences were silently dropped. Kept OUT
// of the shared ROLE_SPEC so citypack/default planner-role enumeration (and its
// inspect sidecars) are byte-identical.
const EXPERIMENT_ROLE_SPEC = Object.freeze({
  culture_stop: { intents: ["museums"], slot: "stop", gate: "may_influence_routes", primaryTypes: ["museum", "gallery"] },
  market_stop: { intents: ["markets"], slot: "stop", gate: "may_influence_routes", primaryTypes: ["market", "event_market"] },
  green_walk_stop: { intents: ["green"], slot: "stop", gate: "may_influence_routes", primaryTypes: ["park", "garden", "promenade"] },
});

// #272 — generic local-feel preference (agnostic experiment only). Within a
// status bucket, external candidates order by: non-chain primary-type (0),
// non-chain secondary (1), chain primary (2), chain secondary (3). The chain
// signal is the OSM brand tag carried by the loader — never name matching.
// Chains are demoted, NEVER banned: they remain valid sparse fallbacks.
// Non-external candidates always rank 0, so curated/citypack flows and any
// path without the experiment seam are byte-identical.
function localFeelRank(spec, candidate) {
  if (candidate.candidate_origin !== "external_open") return 0;
  const chain = candidate.chain === true;
  const primary = Array.isArray(spec.primaryTypes) && spec.primaryTypes.includes(String(candidate.type || "").toLowerCase());
  if (!chain && primary) return 0;
  if (!chain && !primary) return 1;
  if (chain && primary) return 2;
  return 3;
}

function localFeelReasons(spec, candidate) {
  if (candidate.candidate_origin !== "external_open") return [];
  const reasons = [];
  if (candidate.chain === true) reasons.push("chain_candidate");
  if (Array.isArray(spec.primaryTypes) && !spec.primaryTypes.includes(String(candidate.type || "").toLowerCase())) {
    reasons.push("secondary_type_for_role");
  }
  return reasons;
}

const ROLE_ORDER = Object.freeze(Object.keys(ROLE_SPEC));
const STATUS_RANK = Object.freeze({ missing: 0, fallback: 1, partial: 2, filled: 3 });
const DEFAULT_LIMIT_PER_ROLE = 3;
const MAX_LIMIT_PER_ROLE = 5;
// Once the trusted reservoir can cover several different planner roles with
// non-chain places, a chain-only role is no longer a genuine sparse-context
// fallback. Keep it inspectable, but do not auto-compose it into the day.
const LOCAL_BREADTH_FOR_CHAIN_FALLBACK = 3;
const MAX_CAPACITY_FRONTIER_CANDIDATES = 2;
const MIN_CAPACITY_FRONTIER_GAIN_KM = 0.3;
const WALKING_TARGET_TO_SPREAD_FACTOR = 0.55;

function selectPlannerRoleCandidates(cityConfig, payload = {}, helpers = {}) {
  const limitPerRole = clampLimit(payload.limitPerRole ?? payload.limit_per_role);
  const candidatePool = buildEligibleCandidatePool(cityConfig, payload, helpers);
  const reachSelection = applyCandidateReachPolicy(candidatePool, helpers.candidateReachPolicy);
  const roleCandidatePool = reachSelection.candidatePool;
  const requestedIntents = new Set(candidatePool.normalized.intents || []);

  // Local-feel preference activates through the same seam as #270 admission:
  // only the agnostic route-output experiment injects this helper, so every
  // other caller (default Planner, Blitz, Pulse, citypack inspect) is untouched.
  const localFeelActive = typeof helpers.experimentalAdmitCandidate === "function";

  // Experiment-only roles (#277) join the set ONLY on the agnostic experiment
  // path; every other caller sees exactly the shared ROLE_SPEC.
  const activeRoleSpec = localFeelActive ? { ...ROLE_SPEC, ...EXPERIMENT_ROLE_SPEC } : ROLE_SPEC;
  const activeRoleOrder = Object.keys(activeRoleSpec);

  const roleEntries = {};
  for (const [role, spec] of Object.entries(activeRoleSpec)) {
    roleEntries[role] = buildRankedEntriesForRole(spec, roleCandidatePool, localFeelActive);
  }
  if (localFeelActive) {
    applyReservoirChainFallbackPolicy(roleEntries);
  }

  const roleRelevantCandidateCount = uniqueEntryCandidateCount(Object.values(roleEntries).flat());

  const roles = activeRoleOrder.map((role) => {
    const spec = activeRoleSpec[role];
    const entries = roleEntries[role];
    const candidates = entries.slice(0, limitPerRole).map((entry) =>
      formatRoleCandidate(entry, role, roleEntries, activeRoleSpec),
    );
    const status = strongestStatus(candidates);
    return {
      role,
      slot: spec.slot,
      gate: spec.gate,
      requested: spec.intents.some((intent) => requestedIntents.has(intent)),
      status,
      planner_usable: status === "filled" || status === "partial",
      candidates,
    };
  });
  const roleSurfaceCandidateCount = new Set(
    roles.flatMap((entry) => entry.candidates.map((candidate) => candidate.candidate_id).filter(Boolean)),
  ).size;
  const capacityFrontierActive = localFeelActive && Boolean(normalizeWalkingTargetBand(helpers.walkingTargetBand));
  const capacityFrontierCandidates = capacityFrontierActive
    ? buildCapacityFrontierCandidates({
        roles,
        roleEntries,
        roleSpec: activeRoleSpec,
        origin: candidatePool.context.origin,
        walkingTargetBand: helpers.walkingTargetBand,
      })
    : [];
  const availabilitySummary = candidatePool.availability_summary || null;

  return {
    city: cityConfig.key,
    density: candidatePool.density,
    lens: candidatePool.context.lens,
    context: {
      date: candidatePool.context.date || null,
      now: candidatePool.context.now_iso || null,
      time_band: candidatePool.context.timeBand || null,
    },
    requested_preferences: candidatePool.normalized.intents || [],
    roles,
    summary: summarizeRoles(roles),
    pipeline_summary: {
      identity_resolved_candidate_count: candidatePool.allCandidates.length,
      eligible_pool_candidate_count: candidatePool.pool.length,
      rejected_candidate_count: candidatePool.rejected.length,
      availability_evaluated_candidate_count: availabilitySummary?.evaluated_candidate_count || 0,
      availability_excluded_candidate_count: availabilitySummary?.excluded_candidate_count || 0,
      availability_unresolved_candidate_count: availabilitySummary?.unresolved_candidate_count || 0,
      role_relevant_candidate_count: roleRelevantCandidateCount,
      role_surface_candidate_count: roleSurfaceCandidateCount,
      ...(capacityFrontierActive
        ? { capacity_frontier_candidate_count: capacityFrontierCandidates.length }
        : {}),
    },
    ...(availabilitySummary
      ? { availability_summary: { ...availabilitySummary } }
      : {}),
    ...(reachSelection.summary ? { reach_policy: reachSelection.summary } : {}),
    ...(capacityFrontierCandidates.length
      ? { capacity_frontier_candidates: capacityFrontierCandidates }
      : {}),
  };
}

// The public role lists remain strict top-N by status and shared ranking. For
// the agnostic engine only, retain a separate bounded frontier from the full
// already-gated role entries when those top-N lists are too geographically
// compressed for the trusted walking target. These candidates never change a
// role winner and never bypass status, local-feel, availability or admission
// gates; the route engine may still reject them as incoherent or unnecessary.
function buildCapacityFrontierCandidates({
  roles,
  roleEntries,
  roleSpec,
  origin,
  walkingTargetBand,
}) {
  const band = normalizeWalkingTargetBand(walkingTargetBand);
  if (!band || !validCoordinates(origin)) return [];
  const spreadBand = walkingTargetSpreadBand(band);
  const surfacedIds = new Set(
    roles.flatMap((role) => role.candidates.map((candidate) => candidate.candidate_id).filter(Boolean)),
  );
  const points = roles
    .flatMap((role) => role.candidates.map((candidate) => candidate.coordinates))
    .filter(validCoordinates);
  if (points.length < 2 || candidateSpanKm(points) >= spreadBand.floorKm) return [];

  const eligible = [];
  const seen = new Set();
  for (const [role, entries] of Object.entries(roleEntries)) {
    const spec = roleSpec[role];
    if (!spec || (spec.slot !== "anchor" && spec.slot !== "stop")) continue;
    const strongest = strongestFrontierEntries(entries);
    for (const entry of strongest) {
      const id = entry?.candidate?.id;
      if (!id || surfacedIds.has(id) || seen.has(id) || !validCoordinates(entry.candidate)) continue;
      seen.add(id);
      eligible.push({ role, entry, coordinates: { lat: entry.candidate.lat, lng: entry.candidate.lng } });
    }
  }

  const selected = [];
  while (
    eligible.length &&
    selected.length < MAX_CAPACITY_FRONTIER_CANDIDATES &&
    candidateSpanKm(points) < spreadBand.floorKm
  ) {
    const currentSpan = candidateSpanKm(points);
    eligible.sort((left, right) => compareCapacityFrontier(left, right, points, spreadBand));
    const next = eligible.shift();
    const nextSpan = candidateSpanKm([...points, next.coordinates]);
    if (nextSpan < currentSpan + MIN_CAPACITY_FRONTIER_GAIN_KM) break;
    points.push(next.coordinates);
    selected.push({
      role: next.role,
      ...formatRoleCandidate(next.entry, next.role, roleEntries, roleSpec),
      capacity_reason: "walking_target_frontier",
    });
  }
  return selected;
}

function walkingTargetSpreadBand(band) {
  return {
    targetKm: band.targetKm * WALKING_TARGET_TO_SPREAD_FACTOR,
    floorKm: band.floorKm * WALKING_TARGET_TO_SPREAD_FACTOR,
    ceilingKm: band.ceilingKm * WALKING_TARGET_TO_SPREAD_FACTOR,
  };
}

function strongestFrontierEntries(entries) {
  const eligible = (Array.isArray(entries) ? entries : []).filter(
    (entry) =>
      (entry.candidate_status === "filled" || entry.candidate_status === "partial") &&
      entry.availability?.eligible !== false &&
      entry.candidate?.chain !== true &&
      !(entry.experimental_admission && entry.experimental_admission.allowed === true),
  );
  const strongestStatus = eligible.reduce(
    (rank, entry) => Math.max(rank, STATUS_RANK[entry.candidate_status] || 0),
    0,
  );
  let tier = eligible.filter((entry) => (STATUS_RANK[entry.candidate_status] || 0) === strongestStatus);
  const covering = tier.filter(
    (entry) => Array.isArray(entry.fit?.covered_preferences) && entry.fit.covered_preferences.length > 0,
  );
  if (covering.length) tier = covering;
  const operationalRank = tier.reduce(
    (best, entry) => Math.min(best, operationalViabilityRank(entry)),
    Number.POSITIVE_INFINITY,
  );
  tier = tier.filter((entry) => operationalViabilityRank(entry) === operationalRank);
  const localRank = tier.reduce(
    (best, entry) => Math.min(best, Number.isFinite(entry.local_feel_rank) ? entry.local_feel_rank : 0),
    Number.POSITIVE_INFINITY,
  );
  return tier.filter(
    (entry) => (Number.isFinite(entry.local_feel_rank) ? entry.local_feel_rank : 0) === localRank,
  );
}

function compareCapacityFrontier(left, right, points, band) {
  const rank = (candidate) => {
    const span = candidateSpanKm([...points, candidate.coordinates]);
    const reachesFloor = span >= band.floorKm;
    return [
      reachesFloor ? 0 : 1,
      reachesFloor && span <= band.ceilingKm ? 0 : 1,
      reachesFloor ? Math.abs(span - band.targetKm) : -span,
      String(candidate.entry.candidate.id),
    ];
  };
  const leftRank = rank(left);
  const rightRank = rank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] === rightRank[index]) continue;
    return leftRank[index] < rightRank[index] ? -1 : 1;
  }
  return 0;
}

function candidateSpanKm(points) {
  let span = 0;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      span = Math.max(span, distanceKm(points[left], points[right]));
    }
  }
  return span;
}

function applyCandidateReachPolicy(candidatePool, value) {
  const policy = sanitizeCandidateReachPolicy(value);
  const origin = candidatePool?.context?.origin;
  if (!policy || !validCoordinates(origin)) {
    return { candidatePool, summary: null };
  }

  const excluded = [];
  const pool = candidatePool.pool.filter((entry) => {
    const candidate = entry?.candidate;
    const candidateCoords = validCoordinates(candidate)
      ? { lat: candidate.lat, lng: candidate.lng }
      : null;
    const withinReach =
      candidateCoords && distanceKm(origin, candidateCoords) <= policy.max_origin_distance_km;
    if (!withinReach) excluded.push(candidate?.id || null);
    return withinReach;
  });
  return {
    candidatePool: { ...candidatePool, pool },
    summary: {
      ...policy,
      applied: true,
      eligible_candidate_count: pool.length,
      excluded_candidate_count: excluded.length,
    },
  };
}

function validCoordinates(value) {
  return Boolean(value) && Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

function uniqueEntryCandidateCount(entries) {
  return new Set(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => entry?.candidate?.id)
      .filter(Boolean),
  ).size;
}

function applyReservoirChainFallbackPolicy(roleEntries = {}) {
  const hasUsableNonChain = (entry) =>
    entry &&
    entry.candidate_status !== "fallback" &&
    entry.candidate_status !== "missing" &&
    entry.availability?.eligible !== false &&
    Number(entry.local_feel_rank) < 2;
  const rolesWithLocalOptions = Object.values(roleEntries).filter((entries) =>
    Array.isArray(entries) && entries.some(hasUsableNonChain),
  );
  const distinctLocalCandidateIds = new Set(
    rolesWithLocalOptions.flatMap((entries) =>
      entries.filter(hasUsableNonChain).map((entry) => entry.candidate?.id).filter(Boolean),
    ),
  );
  if (
    rolesWithLocalOptions.length < LOCAL_BREADTH_FOR_CHAIN_FALLBACK ||
    distinctLocalCandidateIds.size < LOCAL_BREADTH_FOR_CHAIN_FALLBACK
  ) {
    return;
  }

  for (const entries of Object.values(roleEntries)) {
    if (!Array.isArray(entries)) continue;
    const hasStrongLocalOption = entries.some(
      (entry) =>
        hasUsableNonChain(entry) &&
        Array.isArray(entry.fit?.covered_preferences) &&
        entry.fit.covered_preferences.length > 0,
    );
    if (hasStrongLocalOption) continue;
    for (const entry of entries) {
      if (
        Number(entry.local_feel_rank) >= 2 &&
        entry.candidate_status !== "fallback" &&
        entry.candidate_status !== "missing"
      ) {
        entry.candidate_status = "fallback";
        entry.local_feel_reasons = [
          ...(Array.isArray(entry.local_feel_reasons) ? entry.local_feel_reasons : []),
          "chain_not_auto_composed_with_broad_local_reservoir",
        ];
      }
    }
    // buildRankedEntriesForRole sorted before this cross-role policy had the
    // reservoir breadth needed to act. Restore the public status-tier contract
    // after demotion while preserving the existing order within each tier.
    entries.sort((a, b) => STATUS_RANK[b.candidate_status] - STATUS_RANK[a.candidate_status]);
  }
}

function buildRankedEntriesForRole(spec, candidatePool, localFeelActive = false) {
  const entries = candidatePool.pool
    .map(({ candidate, derived, gates, evidence, availability, operational, experimental_admission }) => {
      const fit = scoreCandidateFit({
        candidate,
        userIntents: spec.intents,
        userModifiers: candidatePool.normalized.modifiers,
        context: candidatePool.context,
      });
      const covered = coversAny(fit.covered_preferences, spec.intents);
      const adjacent = coversAny(fit.partial_preferences, spec.intents);
      if (!covered && !adjacent) {
        return null;
      }
      const calibration = calibrateSource({
        family: candidate.source_family || (candidate.city_pack_owned ? "catalog" : "map"),
        tier: candidate.trust?.source_tier,
        intents: spec.intents,
        lens: candidatePool.context.lens,
        density: candidatePool.density,
        diversity: derived.provenance_diversity,
        freshness: derived.freshness,
      });
      return {
        candidate,
        derived,
        gates,
        evidence,
        fit,
        calibration,
        availability,
        operational,
        experimental_admission,
        candidate_status: candidateStatusForRole({ fit, gates, spec, experimentalAdmission: experimental_admission }),
        ...(localFeelActive
          ? { local_feel_rank: localFeelRank(spec, candidate), local_feel_reasons: localFeelReasons(spec, candidate) }
          : {}),
      };
    })
    .filter((entry) => entry && entry.candidate_status !== "missing");

  // Experimentally admitted entries (shared gates rejected them; the agnostic
  // experiment admitted them anyway) rank AFTER every gate-passing entry of the
  // same status: a candidate that actually cleared the shared gates must never
  // lose its role to an admitted one on fit score alone.
  const isAdmitted = (entry) => entry.experimental_admission && entry.experimental_admission.allowed === true;
  const byStatus = {
    filled: entries.filter((entry) => entry.candidate_status === "filled"),
    partial: entries.filter((entry) => entry.candidate_status === "partial" && !isAdmitted(entry)),
    partialAdmitted: entries.filter((entry) => entry.candidate_status === "partial" && isAdmitted(entry)),
    fallback: entries.filter((entry) => entry.candidate_status === "fallback"),
  };

  // #272 — within each status bucket, order by coverage FIRST (a candidate that
  // actually covers the role's intent always beats an adjacent-only one — local
  // feel must never trump coverage), THEN local-feel tier, THEN fit. Inactive
  // seam → plain rankEligible, exactly today's order.
  const rankByLocalFeel = (bucket) => {
    if (!localFeelActive) return rankEligible(bucket);
    const covers = (entry) => Array.isArray(entry.fit.covered_preferences) && entry.fit.covered_preferences.length > 0;
    const groups = new Map();
    for (const entry of bucket) {
      const feel = Number.isFinite(entry.local_feel_rank) ? entry.local_feel_rank : 0;
      const key = `${covers(entry) ? 0 : 1}:${operationalViabilityRank(entry)}:${feel}`;
      const group = groups.get(key) || [];
      group.push(entry);
      groups.set(key, group);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => compareRankKey(a, b))
      .flatMap(([, group]) => rankEligible(group));
  };

  return [
    ...rankByLocalFeel(byStatus.filled),
    ...rankByLocalFeel(byStatus.partial),
    ...rankByLocalFeel(byStatus.partialAdmitted),
    ...rankByLocalFeel(byStatus.fallback),
  ];
}

function candidateStatusForRole({ fit, gates, spec, experimentalAdmission = null }) {
  const covered = coversAny(fit.covered_preferences, spec.intents);
  const adjacent = coversAny(fit.partial_preferences, spec.intents);
  if (!covered && !adjacent) {
    return "missing";
  }
  if (covered && gates[spec.gate] === true) {
    return "filled";
  }
  if (gates.may_influence_routes === true) {
    return "partial";
  }
  if (experimentalAdmission && experimentalAdmission.allowed === true && (covered || adjacent)) {
    return "partial";
  }
  if (gates.may_show_as_nearby === true) {
    return "fallback";
  }
  return "missing";
}

function formatRoleCandidate(entry, role, roleEntries, roleSpec = ROLE_SPEC) {
  const { candidate, derived, fit, gates, calibration, candidate_status, experimental_admission, availability, operational } = entry;
  const provenance = candidateProvenance(candidate, derived);
  return {
    candidate_id: candidate.id,
    label: candidate.label,
    type: candidate.type,
    candidate_kind: candidate.candidate_kind,
    candidate_status,
    planner_usable: candidate_status === "filled" || candidate_status === "partial",
    origin: candidateOrigin(candidate),
    confidence: derived.existence_confidence || candidate.trust?.confidence || null,
    provenance,
    attribution: provenance.attribution,
    covered_preferences: fit.covered_preferences,
    partial_preferences: fit.partial_preferences,
    missing_preferences: fit.missing_preferences,
    fit_reasons: fit.reasons,
    // #272 — present ONLY when the experiment seam is active (entry carries the
    // rank); default/citypack role payloads stay byte-identical.
    ...(Number.isFinite(entry.local_feel_rank)
      ? {
          local_feel_rank: entry.local_feel_rank,
          local_feel_reasons: entry.local_feel_reasons || [],
          chain: entry.candidate.chain === true,
          brand: typeof entry.candidate.brand === "string" ? entry.candidate.brand : null,
        }
      : {}),
    experimental_admission: sanitizeExperimentalAdmission(experimental_admission),
    lens_reasons: fit.dimensions?.local?.reasons || [],
    // Surface the already-computed weather/time fit reasons (e.g.
    // "rain_favors_indoor", "time_match:evening") so downstream context can
    // honestly explain how trusted weather/time influenced this candidate.
    weather_reasons: fit.dimensions?.weather?.reasons || [],
    time_reasons: fit.dimensions?.time?.reasons || [],
    gates: {
      may_anchor_route: gates.may_anchor_route === true,
      may_influence_routes: gates.may_influence_routes === true,
      may_show_as_nearby: gates.may_show_as_nearby === true,
      reasons: gates.reasons || [],
    },
    reconciliation: candidate.reconciliation || provenance.reconciliation || null,
    coordinates: Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)
      ? { lat: candidate.lat, lng: candidate.lng }
      : null,
    calibration: calibration
      ? { level: calibration.level, influence: calibration.influence, reasons: calibration.reasons }
      : null,
    ...(availability ? { availability: { ...availability } } : {}),
    ...(operational ? { operational_viability: { ...operational, reasons: [...operational.reasons] } } : {}),
    also_covers: alsoCovers(candidate.id, role, roleEntries, roleSpec),
  };
}

function compareRankKey(a, b) {
  const left = a.split(":").map(Number);
  const right = b.split(":").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff) return diff;
  }
  return 0;
}

function alsoCovers(candidateId, currentRole, roleEntries, roleSpec = ROLE_SPEC) {
  const covers = [];
  for (const [role, entries] of Object.entries(roleEntries)) {
    if (role === currentRole) continue;
    const spec = roleSpec[role];
    if (!spec) continue;
    const entry = entries.find((candidateEntry) => candidateEntry.candidate.id === candidateId);
    if (!entry || entry.candidate_status === "fallback") continue;
    covers.push({
      role,
      status: entry.candidate_status,
      match: coversAny(entry.fit.covered_preferences, spec.intents) ? "covered" : "partial",
    });
  }
  return covers;
}

function sanitizeExperimentalAdmission(admission) {
  if (!admission || admission.allowed !== true) return null;
  return {
    allowed: true,
    policy: admission.policy || "experimental_inferred_external",
    reasons: Array.isArray(admission.reasons) ? admission.reasons : [],
    gate_reasons: Array.isArray(admission.gate_reasons) ? admission.gate_reasons : [],
  };
}

function strongestStatus(candidates) {
  return candidates.reduce((best, candidate) => {
    const status = candidate.candidate_status || "fallback";
    return STATUS_RANK[status] > STATUS_RANK[best] ? status : best;
  }, "missing");
}

function summarizeRoles(roles) {
  return roles.reduce(
    (summary, role) => {
      summary.by_status[role.status] = (summary.by_status[role.status] || 0) + 1;
      if (role.requested) summary.requested_roles.push(role.role);
      if (role.planner_usable) summary.planner_usable_roles.push(role.role);
      return summary;
    },
    { by_status: {}, requested_roles: [], planner_usable_roles: [] },
  );
}

function coversAny(values = [], intents = []) {
  return intents.some((intent) => values.includes(intent));
}

function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT_PER_ROLE;
  return Math.max(1, Math.min(MAX_LIMIT_PER_ROLE, Math.trunc(parsed)));
}

module.exports = {
  DEFAULT_LIMIT_PER_ROLE,
  MAX_LIMIT_PER_ROLE,
  ROLE_ORDER,
  ROLE_SPEC,
  LOCAL_BREADTH_FOR_CHAIN_FALLBACK,
  candidateStatusForRole,
  selectPlannerRoleCandidates,
};
