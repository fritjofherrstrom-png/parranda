/**
 * Flag-gated A/B route-scoring experiment (#254).
 *
 * Diagnostic only. Scores the existing primary route beside the #253
 * candidate-combination adapter so reviewers can inspect whether the adapter is
 * even eligible for future route-scoring. It must never select, order, mutate,
 * or present the adapter as the public route output.
 */

function buildRouteAbScoringInspect({ city, primaryRoute, routeCandidateAdapter } = {}) {
  const baseline = scoreBaselinePrimaryRoute(primaryRoute);
  const candidate = scoreCandidateCombinationAdapter(routeCandidateAdapter);
  const decision = buildDecision({ baseline, candidate });

  return {
    status: baseline.status === "unavailable" && candidate.status === "unavailable" ? "unavailable" : "scored",
    city: city || null,
    experimental: true,
    route_mutation: false,
    variants: {
      baseline_primary: baseline,
      candidate_combination_adapter: candidate,
    },
    decision,
  };
}

function scoreBaselinePrimaryRoute(route) {
  const stopIds = extractRouteStopIds(route);
  const signals = [];
  const blockers = [];
  let score = 0;

  if (!route) {
    blockers.push("no_primary_route");
  } else {
    score += 30;
    signals.push("primary_route_exists");
  }

  if (stopIds.length >= 2) {
    score += 20;
    signals.push("multi_stop_route");
  } else if (route) {
    blockers.push("too_few_primary_stops");
  }

  if (stopIds.length) {
    score += 15;
    signals.push("stable_stop_ids_present");
  } else if (route) {
    blockers.push("no_stable_stop_ids");
  }

  const trust = route?.trust_summary || {};
  if (trust.confidence === "high") {
    score += 10;
    signals.push("high_trust_summary");
  } else if (trust.confidence) {
    score += 5;
    signals.push(`trust:${trust.confidence}`);
  }

  if (Array.isArray(route?.why_recommended) && route.why_recommended.length) {
    score += 5;
    signals.push("has_why_recommended");
  }

  return {
    kind: "current_primary_route",
    status: route ? "available" : "unavailable",
    route_id: route?.id || null,
    stop_ids: stopIds,
    eligibility: route && stopIds.length >= 2 ? "baseline_available" : "baseline_unavailable",
    score,
    signals: uniqueSorted(signals),
    blockers: uniqueSorted(blockers),
  };
}

function scoreCandidateCombinationAdapter(adapter) {
  const candidate = adapter?.candidate || {};
  const probe = adapter?.scoring_probe || {};
  const stopIds = Array.isArray(candidate.stop_ids) ? candidate.stop_ids.filter(Boolean).map(String) : [];
  const signals = [];
  const blockers = [];
  let score = 0;

  if (!adapter || adapter.status === "unavailable") {
    blockers.push("no_available_adapter_candidate");
  } else {
    score += 20;
    signals.push("adapter_candidate_available");
  }

  if (stopIds.length >= 2) {
    score += 15;
    signals.push("multi_stop_candidate");
  } else if (stopIds.length) {
    score += 5;
    signals.push("single_stop_candidate");
  } else {
    blockers.push("no_candidate_stop_ids");
  }

  if (probe.recommendation) signals.push(`probe:${probe.recommendation}`);
  if (probe.recommendation === "candidate_for_ab_route_scoring") score += 30;
  else if (probe.recommendation === "needs_geometry_validation") blockers.push("needs_geometry_validation");
  else if (probe.recommendation === "not_route_ready") blockers.push("not_route_ready");

  for (const signal of Array.isArray(probe.positive_signals) ? probe.positive_signals : []) {
    signals.push(`probe:${signal}`);
    if (signal === "geometry_ok") score += 10;
    if (signal === "target_roles_covered") score += 10;
    if (signal === "curated_candidates") score += 5;
    if (signal === "trusted_external_gap_fill") score += 5;
  }

  for (const blocker of Array.isArray(probe.blockers) ? probe.blockers : []) {
    blockers.push(`probe:${blocker}`);
    score -= 15;
  }

  for (const negative of Array.isArray(probe.negative_signals) ? probe.negative_signals : []) {
    signals.push(`probe_negative:${negative}`);
    if (negative === "zero_primary_overlap") score -= 5;
    if (negative === "incomplete_coordinates" || negative === "geometry_weak") score -= 10;
  }

  const eligible =
    adapter?.status === "available" &&
    stopIds.length > 0 &&
    probe.recommendation === "candidate_for_ab_route_scoring" &&
    blockers.filter((b) => b.startsWith("probe:")).length === 0;

  return {
    kind: "candidate_combination_adapter",
    status: adapter?.status || "unavailable",
    candidate_id: candidate.id || null,
    stop_ids: stopIds,
    route_claim: false,
    eligibility: eligible ? "eligible_for_ab_scoring" : blockers.length ? "blocked" : "inspect_only",
    score: Math.max(0, score),
    signals: uniqueSorted(signals),
    blockers: uniqueSorted(blockers),
  };
}

function buildDecision({ baseline, candidate }) {
  const reasons = ["diagnostic_only", "default_route_output_preserved"];
  if (candidate.eligibility !== "eligible_for_ab_scoring") reasons.push("candidate_not_eligible");
  if (baseline.status !== "available") reasons.push("baseline_unavailable");
  if (candidate.eligibility === "eligible_for_ab_scoring") reasons.push("candidate_score_observable");

  return {
    mode: "diagnostic_ab_score_only",
    selected_variant: "baseline_primary",
    candidate_score_delta: candidate.score - baseline.score,
    reasons: uniqueSorted(reasons),
  };
}

function extractRouteStopIds(route) {
  const stops = Array.isArray(route?.main_stops) ? route.main_stops : [];
  return stops
    .map((stop) => firstStableId(stop, ["id", "place_id", "candidate_id"]))
    .filter(Boolean)
    .sort();
}

function firstStableId(value, keys) {
  for (const key of keys) {
    const id = value?.[key];
    if (typeof id === "string" && id.trim()) return id.trim();
    if (Number.isFinite(id)) return String(id);
  }
  return null;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

module.exports = {
  buildRouteAbScoringInspect,
  scoreBaselinePrimaryRoute,
  scoreCandidateCombinationAdapter,
};
