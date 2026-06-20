function buildPreviewBetaEngineStatus({
  cityConfig,
  routeResult,
  fillSidecar = {},
} = {}) {
  const fillInfo = fillSidecar.registered_city_candidate_fill || fillSidecar || {};
  const mainStops = primaryRouteStops(routeResult);
  const provisionalStops = mainStops.filter((stop) => stop && stop.provisional === true);
  const curatedStopCount = mainStops.filter((stop) => stop && stop.provisional !== true).length;
  const sourceBackedStopCount = provisionalStops.length;
  const loaderSupplementalCount = Number(fillInfo.supplemental_candidate_count) || 0;
  const loaderFillReason = fillInfo.reason || null;
  const active = sourceBackedStopCount > 0;

  return {
    preview_engine_mode: true,
    planner_mode: "preview_beta_engine",
    active,
    beta_status: active ? "fuller_preview_day" : "preview_engine_fallback",
    visible_change: active ? "source_backed_stops_in_primary_route" : "legacy_preview_route_returned",
    route_stop_count: mainStops.length,
    curated_stop_count: curatedStopCount,
    source_backed_stop_count: sourceBackedStopCount,
    source_backed_stop_ids: provisionalStops.map((stop) => stop.id).filter(Boolean),
    promotion_readiness: buildPromotionReadinessQueue({
      cityConfig,
      provisionalStops,
      active,
    }),
    loader_fill_reason: loaderFillReason,
    loader_supplemental_count: loaderSupplementalCount,
    still_thin: buildStillThinReasons({
      active,
      sourceBackedStopCount,
      loaderFillReason,
      loaderSupplementalCount,
      route: routeResult?.days?.[0]?.primary_route,
    }),
    surface_contract: {
      planner: active ? "preview_beta_engine_primary_route" : "preview_beta_engine_fallback",
      pulse_live: summarizePulseLiveContract(cityConfig),
      blitz: {
        status: "separate_candidate_spine_endpoint",
        route_mutation: false,
      },
    },
  };
}

function buildPromotionReadinessQueue({ cityConfig, provisionalStops, active } = {}) {
  const visibleStops = Array.isArray(provisionalStops) ? provisionalStops : [];
  const sourceById = sourceCandidateMap(cityConfig);
  const candidates = visibleStops.map((stop) => {
    const sourceCandidate = sourceById.get(stop.id) || {};
    const provenance = sourceCandidate.provenance || stop.provenance || {};
    return compactObject({
      id: stop.id || null,
      label: stop.label || stop.name || sourceCandidate.label || null,
      area: stop.area || sourceCandidate.area || null,
      source_label: sourceCandidate.source?.label || stop.source?.label || null,
      source_url: sourceCandidate.source?.url || stop.source?.url || null,
      current_trust: stop.trust?.confidence || sourceCandidate.trust?.confidence || null,
      promotion_status: "needs_evidence_review",
      why_included: provenance.why_included || null,
      promotion_focus: promotionFocusForCandidate(sourceCandidate || stop),
      evidence_gaps: evidenceGapsForCandidate(sourceCandidate || stop),
    });
  });

  return {
    status: active && candidates.length ? "needs_evidence_review" : "no_visible_provisional_candidates",
    visible_candidate_count: candidates.length,
    visible_candidate_ids: candidates.map((candidate) => candidate.id).filter(Boolean),
    candidates,
    promote_when: [
      "source_evidence_is_stronger_than_single_inferred_record",
      "coordinates_and_area_are_stable",
      "route_role_is_supported_by_evidence_or_curator_review",
      "runtime_copy_needs_no_hours_eta_or_access_claim",
      "catalog_provenance_can_explain_why_this_belongs_in_parranda",
    ],
  };
}

function sourceCandidateMap(cityConfig) {
  const map = new Map();
  for (const candidate of Array.isArray(cityConfig?.sourceCandidates) ? cityConfig.sourceCandidates : []) {
    if (candidate && candidate.id) {
      map.set(candidate.id, candidate);
    }
  }
  return map;
}

function promotionFocusForCandidate(candidate = {}) {
  const roles = Array.isArray(candidate.route_roles) ? candidate.route_roles : [];
  if (roles.includes("viewpoint_anchor") || candidate.type === "viewpoint") {
    return "viewpoint_evidence_and_route_fit";
  }
  if (roles.includes("neighborhood_anchor")) {
    return "neighborhood_anchor_evidence";
  }
  return "general_place_evidence_and_route_fit";
}

function evidenceGapsForCandidate(candidate = {}) {
  const gaps = ["stronger_than_single_inferred_source"];
  if (!candidate.source?.url) {
    gaps.push("source_url_missing");
  }
  if (!Array.isArray(candidate.route_roles) || candidate.route_roles.length === 0) {
    gaps.push("route_role_missing");
  }
  if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) {
    gaps.push("stable_coordinates_missing");
  }
  gaps.push("no_hours_eta_or_access_claim");
  return [...new Set(gaps)];
}

function primaryRouteStops(routeResult = {}) {
  const route = routeResult?.days?.[0]?.primary_route;
  return Array.isArray(route?.main_stops) ? route.main_stops : [];
}

function buildStillThinReasons({
  active,
  sourceBackedStopCount,
  loaderFillReason,
  loaderSupplementalCount,
  route,
} = {}) {
  const reasons = [];
  if (route?.credibility_tier === "low") {
    reasons.push("low_confidence_preview_route");
  }
  if (active && sourceBackedStopCount > 0) {
    reasons.push("provisional_source_candidates_unverified");
  }
  if (loaderFillReason === "no_trusted_external_provider") {
    reasons.push("trusted_external_loader_not_configured");
  } else if (loaderSupplementalCount === 0) {
    reasons.push("no_trusted_loader_supplement_reached_route");
  }
  reasons.push("pulse_live_context_only");
  reasons.push("blitz_candidate_spine_separate");
  return [...new Set(reasons)];
}

function summarizePulseLiveContract(cityConfig) {
  const providers = Array.isArray(cityConfig?.services?.pulseSourceProviders)
    ? cityConfig.services.pulseSourceProviders
    : [];
  let activeSourceCount = 0;
  let candidateSourceCount = 0;
  for (const provider of providers) {
    const status = provider?.descriptor?.status;
    if (status === "active") {
      activeSourceCount += 1;
    } else if (status === "candidate" || status === "review-needed") {
      candidateSourceCount += 1;
    }
  }
  return {
    status: "context_only_not_route_mutating",
    route_mutation: false,
    active_source_count: activeSourceCount,
    candidate_source_count: candidateSourceCount,
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ""),
  );
}

module.exports = {
  buildPreviewBetaEngineStatus,
};
