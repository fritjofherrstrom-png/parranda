const LOW_CONFIDENCE = new Set(["low", "needs_review", null, undefined]);

function summarizeDayflowHonesty(plannerRoles = {}, options = {}) {
  const roles = Array.isArray(plannerRoles.roles) ? plannerRoles.roles : [];
  const requestedPreferences = unique([
    ...(Array.isArray(plannerRoles.requested_preferences) ? plannerRoles.requested_preferences : []),
    ...(Array.isArray(options.requested_preferences) ? options.requested_preferences : []),
  ]);
  const roleCoverage = buildRoleCoverage(roles);
  const uniqueCandidates = uniqueRoleCandidates(roles);
  const preferenceCoverage = buildPreferenceCoverage({ roles, requestedPreferences });
  const trustSummary = buildTrustSummary(uniqueCandidates);
  const timeSummary = buildTimeSummary({ plannerRoles, roles });
  const qualityFlags = buildQualityFlags({
    roles,
    density: plannerRoles.density,
    trustSummary,
    timeSummary,
  });
  const dayStatus = classifyDayStatus({ roles, roleCoverage });

  return {
    day_status: dayStatus,
    role_coverage: roleCoverage,
    preference_coverage: preferenceCoverage,
    trust_summary: trustSummary,
    time_summary: timeSummary,
    quality_flags: qualityFlags,
    reasons: buildReasons({ dayStatus, roleCoverage, preferenceCoverage, trustSummary, plannerRoles }),
  };
}

function buildRoleCoverage(roles) {
  return roles.reduce(
    (coverage, role) => {
      const status = ["filled", "partial", "fallback", "missing"].includes(role.status)
        ? role.status
        : "missing";
      coverage[status].push(role.role);
      return coverage;
    },
    { filled: [], partial: [], missing: [], fallback: [] },
  );
}

function buildPreferenceCoverage({ roles, requestedPreferences }) {
  const covered = new Set();
  const partial = new Set();

  for (const role of roles) {
    for (const candidate of role.candidates || []) {
      if (candidate.planner_usable !== true) continue;
      for (const pref of candidate.covered_preferences || []) covered.add(pref);
      for (const pref of candidate.partial_preferences || []) partial.add(pref);
    }
  }

  for (const pref of covered) {
    partial.delete(pref);
  }

  const requested = requestedPreferences.length ? requestedPreferences : [...covered, ...partial];
  const missing = requested.filter((pref) => !covered.has(pref) && !partial.has(pref));

  return {
    covered_preferences: [...covered].sort(),
    partial_preferences: [...partial].sort(),
    missing_preferences: unique(missing).sort(),
  };
}

function buildTrustSummary(candidates) {
  return candidates.reduce(
    (summary, candidate) => {
      if (candidate.origin === "curated_catalog") {
        summary.curated_count += 1;
      } else {
        summary.external_count += 1;
      }
      if (LOW_CONFIDENCE.has(candidate.confidence)) {
        summary.low_confidence_count += 1;
      }
      if (candidate.provenance?.human_verified === true) {
        summary.human_verified_count += 1;
      }
      return summary;
    },
    { curated_count: 0, external_count: 0, low_confidence_count: 0, human_verified_count: 0 },
  );
}

function buildTimeSummary({ plannerRoles, roles }) {
  const matched = new Set();
  const mismatched = new Set();
  const missing = new Set();

  for (const role of roles) {
    const candidates = (role.candidates || []).filter((candidate) => candidate.planner_usable === true);
    if (!candidates.length) continue;
    const reasons = candidates.flatMap((candidate) => candidate.fit_reasons || []);
    if (reasons.some(isTimeMatchReason)) {
      matched.add(role.role);
    }
    if (reasons.some((reason) => String(reason).startsWith("time_mismatch:"))) {
      mismatched.add(role.role);
    }
    if (!reasons.some(isAnyTimeReason)) {
      missing.add(role.role);
    }
  }

  return {
    date: plannerRoles.context?.date || null,
    now: plannerRoles.context?.now || null,
    time_band: plannerRoles.context?.time_band || null,
    time_matched_roles: [...matched].sort(),
    time_mismatched_roles: [...mismatched].sort(),
    missing_time_data_roles: [...missing].sort(),
  };
}

function buildQualityFlags({ roles, density, trustSummary, timeSummary }) {
  const flags = new Set();
  if (density === "thin" || density === "absent") {
    flags.add("thin_catalog_density");
  }
  if (trustSummary.external_count > 0 && trustSummary.curated_count === 0) {
    flags.add("source_backed_only");
  }
  if (trustSummary.low_confidence_count > 0) {
    flags.add("low_confidence_candidates");
  }

  for (const role of roles) {
    if (role.status === "missing") flags.add(`missing_${role.role}`);
    if (role.status === "fallback") flags.add(`fallback_${role.role}`);
    if (role.status === "partial") flags.add(`partial_${role.role}`);
    const usable = (role.candidates || []).filter((candidate) => candidate.planner_usable === true);
    if (usable.length && usable.every((candidate) => candidate.origin !== "curated_catalog")) {
      flags.add(`external_only_${role.role}`);
    }
  }

  for (const role of timeSummary.time_matched_roles) {
    flags.add(`${role}_time_matched`);
  }
  for (const role of timeSummary.time_mismatched_roles) {
    flags.add(`time_mismatch_${role}`);
  }
  if (timeSummary.missing_time_data_roles.length) {
    flags.add("missing_time_data");
  }

  return [...flags].sort();
}

function classifyDayStatus({ roles, roleCoverage }) {
  const requestedRoles = roles.filter((role) => role.requested === true);
  const targetRoles = requestedRoles.length ? requestedRoles : roles;
  const targetFilled = targetRoles.length > 0 && targetRoles.every((role) => role.status === "filled");
  if (targetFilled) return "full";

  const usableCount = roleCoverage.filled.length + roleCoverage.partial.length;
  if (usableCount === 0 && roleCoverage.fallback.length > 0) return "fallback_heavy";
  if (usableCount === 0) return "sparse";
  if (roleCoverage.fallback.length > usableCount) return "fallback_heavy";
  return "partial";
}

function buildReasons({ dayStatus, roleCoverage, preferenceCoverage, trustSummary, plannerRoles }) {
  const reasons = [`day_status:${dayStatus}`];
  if (plannerRoles.density) reasons.push(`catalog_density:${plannerRoles.density}`);
  if (roleCoverage.filled.length) reasons.push(`filled_roles:${roleCoverage.filled.length}`);
  if (roleCoverage.partial.length) reasons.push(`partial_roles:${roleCoverage.partial.length}`);
  if (roleCoverage.fallback.length) reasons.push(`fallback_roles:${roleCoverage.fallback.length}`);
  if (roleCoverage.missing.length) reasons.push(`missing_roles:${roleCoverage.missing.length}`);
  if (preferenceCoverage.missing_preferences.length) {
    reasons.push(`missing_preferences:${preferenceCoverage.missing_preferences.join(",")}`);
  }
  if (trustSummary.external_count > 0) reasons.push(`external_candidates:${trustSummary.external_count}`);
  if (trustSummary.curated_count > 0) reasons.push(`curated_candidates:${trustSummary.curated_count}`);
  return reasons;
}

function uniqueRoleCandidates(roles) {
  const byId = new Map();
  for (const role of roles) {
    for (const candidate of role.candidates || []) {
      const key = candidate.candidate_id || `${role.role}:${candidate.label || ""}`;
      if (!byId.has(key)) byId.set(key, candidate);
    }
  }
  return [...byId.values()];
}

function isTimeMatchReason(reason) {
  const value = String(reason || "");
  return (
    value.startsWith("time_match:") ||
    value === "golden_hour_window" ||
    value === "requested_golden_hour"
  );
}

function isAnyTimeReason(reason) {
  const value = String(reason || "");
  return (
    value.startsWith("time_match:") ||
    value.startsWith("time_mismatch:") ||
    value === "golden_hour_window" ||
    value === "requested_golden_hour"
  );
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined).map(String))];
}

module.exports = {
  summarizeDayflowHonesty,
};
