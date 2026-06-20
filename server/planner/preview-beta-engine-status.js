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
    field_test_status: active ? "fuller_preview_day" : "preview_engine_fallback",
    visible_change: active ? "source_backed_stops_in_primary_route" : "legacy_preview_route_returned",
    route_stop_count: mainStops.length,
    curated_stop_count: curatedStopCount,
    source_backed_stop_count: sourceBackedStopCount,
    source_backed_stop_ids: provisionalStops.map((stop) => stop.id).filter(Boolean),
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

module.exports = {
  buildPreviewBetaEngineStatus,
};
