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
  rankEligible,
} = require("../candidates/candidate-pool");
const { scoreCandidateFit } = require("../candidates/fit-scorer");
const { calibrateSource } = require("../candidates/source-calibration");

const ROLE_SPEC = Object.freeze({
  scenic_anchor: { intents: ["scenic"], slot: "anchor", gate: "may_anchor_route" },
  food_anchor: { intents: ["food"], slot: "anchor", gate: "may_anchor_route" },
  coffee_fika_stop: { intents: ["coffee"], slot: "stop", gate: "may_influence_routes" },
  evening_bar_option: { intents: ["bars"], slot: "option", gate: "may_influence_routes" },
  swimming_coast_option: { intents: ["swimming"], slot: "option", gate: "may_influence_routes" },
  vintage_second_hand_option: { intents: ["second_hand"], slot: "option", gate: "may_influence_routes" },
});

const ROLE_ORDER = Object.freeze(Object.keys(ROLE_SPEC));
const STATUS_RANK = Object.freeze({ missing: 0, fallback: 1, partial: 2, filled: 3 });
const DEFAULT_LIMIT_PER_ROLE = 3;
const MAX_LIMIT_PER_ROLE = 5;

function selectPlannerRoleCandidates(cityConfig, payload = {}, helpers = {}) {
  const limitPerRole = clampLimit(payload.limitPerRole ?? payload.limit_per_role);
  const candidatePool = buildEligibleCandidatePool(cityConfig, payload, helpers);
  const requestedIntents = new Set(candidatePool.normalized.intents || []);

  const roleEntries = {};
  for (const [role, spec] of Object.entries(ROLE_SPEC)) {
    roleEntries[role] = buildRankedEntriesForRole(spec, candidatePool);
  }

  const roles = ROLE_ORDER.map((role) => {
    const spec = ROLE_SPEC[role];
    const entries = roleEntries[role];
    const candidates = entries.slice(0, limitPerRole).map((entry) =>
      formatRoleCandidate(entry, role, roleEntries),
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
  };
}

function buildRankedEntriesForRole(spec, candidatePool) {
  const entries = candidatePool.pool
    .map(({ candidate, derived, gates, evidence }) => {
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
        candidate_status: candidateStatusForRole({ fit, gates, spec }),
      };
    })
    .filter((entry) => entry && entry.candidate_status !== "missing");

  const byStatus = {
    filled: entries.filter((entry) => entry.candidate_status === "filled"),
    partial: entries.filter((entry) => entry.candidate_status === "partial"),
    fallback: entries.filter((entry) => entry.candidate_status === "fallback"),
  };

  return [
    ...rankEligible(byStatus.filled),
    ...rankEligible(byStatus.partial),
    ...rankEligible(byStatus.fallback),
  ];
}

function candidateStatusForRole({ fit, gates, spec }) {
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
  if (gates.may_show_as_nearby === true) {
    return "fallback";
  }
  return "missing";
}

function formatRoleCandidate(entry, role, roleEntries) {
  const { candidate, derived, fit, gates, calibration, candidate_status } = entry;
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
    lens_reasons: fit.dimensions?.local?.reasons || [],
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
    also_covers: alsoCovers(candidate.id, role, roleEntries),
  };
}

function alsoCovers(candidateId, currentRole, roleEntries) {
  const covers = [];
  for (const [role, entries] of Object.entries(roleEntries)) {
    if (role === currentRole) continue;
    const entry = entries.find((candidateEntry) => candidateEntry.candidate.id === candidateId);
    if (!entry || entry.candidate_status === "fallback") continue;
    covers.push({
      role,
      status: entry.candidate_status,
      match: coversAny(entry.fit.covered_preferences, ROLE_SPEC[role].intents) ? "covered" : "partial",
    });
  }
  return covers;
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
  candidateStatusForRole,
  selectPlannerRoleCandidates,
};
