#!/usr/bin/env node

const { resolveCityConfig } = require("../server/cities");
const { buildRouteTemplateCandidates } = require("../server/route-candidates/route-template-provider");

function main(argv = process.argv.slice(2), output = process.stdout, errorOutput = process.stderr) {
  const cityKey = String(argv[0] || "").trim().toLowerCase();

  if (!cityKey) {
    errorOutput.write("Usage: node scripts/compare-route-candidates.js <city-key>\n");
    return 1;
  }

  const resolution = resolveCityConfig(cityKey, { allowFallback: false });
  if (!resolution.found || !resolution.cityConfig) {
    errorOutput.write(`Unknown city "${cityKey}". Try one of: barcelona, rome, test-city.\n`);
    return 1;
  }

  const comparison = compareRouteCandidates(resolution.cityConfig);
  output.write(formatComparisonReport(comparison));
  return 0;
}

function compareRouteCandidates(cityConfig) {
  const templates = Array.isArray(cityConfig?.catalog?.routeTemplates)
    ? cityConfig.catalog.routeTemplates
    : [];
  const routeCandidates = buildRouteTemplateCandidates(cityConfig);
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const candidateById = new Map(routeCandidates.map((candidate) => [candidate.id, candidate]));

  const templateIds = [...templateById.keys()];
  const routeCandidateIds = [...candidateById.keys()];
  const missingFromCandidates = templateIds.filter((id) => !candidateById.has(id));
  const missingFromTemplates = routeCandidateIds.filter((id) => !templateById.has(id));
  const perRoute = templateIds.map((id) =>
    compareRoute(id, templateById.get(id), candidateById.get(id)),
  );
  const unresolvedTemplateStops = perRoute
    .filter((route) => route.unresolved_template_stops.length)
    .flatMap((route) =>
      route.unresolved_template_stops.map((stopId) => ({
        route_id: route.id,
        stop_id: stopId,
      })),
    );
  const warnings = routeCandidates.flatMap((candidate) => candidate.warnings);
  const limitations = routeCandidates.flatMap((candidate) => candidate.limitations);
  const stopSummary = summarizeStops(routeCandidates);
  const readiness = buildReadinessVerdict({
    missingFromCandidates,
    missingFromTemplates,
    unresolvedTemplateStops,
    warnings,
    limitations,
    perRoute,
  });

  return {
    city: cityConfig.key,
    label: cityConfig.label || cityConfig.key,
    route_templates_count: templates.length,
    route_candidate_count: routeCandidates.length,
    template_ids_missing_from_route_candidates: missingFromCandidates,
    route_candidate_ids_missing_from_templates: missingFromTemplates,
    stop_count_comparison: perRoute,
    unresolved_template_stops: unresolvedTemplateStops,
    structural_stop_count: stopSummary.structural,
    user_facing_stop_count: stopSummary.userFacing,
    by_route_shape: countBy(routeCandidates, (candidate) => candidate.route_shape),
    by_confidence: countBy(routeCandidates, (candidate) => candidate.confidence),
    warnings: countValues(warnings),
    limitations: countValues(limitations),
    readiness,
  };
}

function compareRoute(id, template, candidate) {
  const templateStops = Array.isArray(template?.stops) ? template.stops : [];
  const candidateStops = Array.isArray(candidate?.stops) ? candidate.stops : [];
  const unresolved = candidateStops
    .filter((stop) => candidate?.warnings.some((warning) => warning.includes(stop.candidate_id)))
    .map((stop) => stop.candidate_id)
    .filter(Boolean);

  return {
    id,
    template_stop_count: templateStops.length,
    route_candidate_stop_count: candidateStops.length,
    user_facing_stop_count: candidateStops.filter((stop) => stop.is_user_facing).length,
    structural_stop_count: candidateStops.filter((stop) => !stop.is_user_facing).length,
    stop_count_matches: templateStops.length === candidateStops.length,
    unresolved_template_stops: unresolved,
  };
}

function summarizeStops(routeCandidates = []) {
  return routeCandidates.reduce(
    (summary, candidate) => {
      summary.userFacing += candidate.stops.filter((stop) => stop.is_user_facing).length;
      summary.structural += candidate.stops.filter((stop) => !stop.is_user_facing).length;
      return summary;
    },
    { userFacing: 0, structural: 0 },
  );
}

function buildReadinessVerdict({
  missingFromCandidates,
  missingFromTemplates,
  unresolvedTemplateStops,
  warnings,
  limitations,
  perRoute,
}) {
  if (missingFromCandidates.length || missingFromTemplates.length) {
    return "needs_review";
  }
  if (unresolvedTemplateStops.length) {
    return "needs_review";
  }
  if (perRoute.some((route) => !route.stop_count_matches)) {
    return "needs_review";
  }
  if (warnings.length || limitations.length) {
    return "ready_with_warnings";
  }
  return "ready";
}

function formatComparisonReport(comparison) {
  const lines = [];

  lines.push(`RouteCandidate comparison: ${comparison.city} (${comparison.label})`);
  lines.push("");
  lines.push(`Route templates: ${comparison.route_templates_count}`);
  lines.push(`RouteCandidates: ${comparison.route_candidate_count}`);
  lines.push("Template ids missing from RouteCandidates:");
  lines.push(formatList(comparison.template_ids_missing_from_route_candidates));
  lines.push("RouteCandidate ids missing from templates:");
  lines.push(formatList(comparison.route_candidate_ids_missing_from_templates));
  lines.push("");
  lines.push("Stop count comparison:");
  lines.push(formatRouteComparison(comparison.stop_count_comparison));
  lines.push("");
  lines.push("Unresolved template stops:");
  lines.push(formatUnresolvedStops(comparison.unresolved_template_stops));
  lines.push("");
  lines.push("Stop visibility:");
  lines.push(`- user-facing: ${comparison.user_facing_stop_count}`);
  lines.push(`- structural: ${comparison.structural_stop_count}`);
  lines.push("Route shape distribution:");
  lines.push(formatCountMap(comparison.by_route_shape));
  lines.push("Confidence distribution:");
  lines.push(formatCountMap(comparison.by_confidence));
  lines.push("Warnings:");
  lines.push(formatCountMap(comparison.warnings));
  lines.push("Limitations:");
  lines.push(formatCountMap(comparison.limitations));
  lines.push("");
  lines.push(`Readiness verdict: ${comparison.readiness}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function formatRouteComparison(routes = []) {
  if (!routes.length) return "- none";
  return routes
    .map(
      (route) =>
        `- ${route.id}: template=${route.template_stop_count}, route_candidate=${route.route_candidate_stop_count}, user_facing=${route.user_facing_stop_count}, structural=${route.structural_stop_count}, matches=${route.stop_count_matches ? "yes" : "no"}`,
    )
    .join("\n");
}

function formatUnresolvedStops(stops = []) {
  if (!stops.length) return "- none";
  return stops.map((stop) => `- ${stop.route_id}: ${stop.stop_id}`).join("\n");
}

function formatList(values = []) {
  if (!values.length) return "- none";
  return values.map((value) => `- ${value}`).join("\n");
}

function formatCountMap(counts = {}) {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return "- none";
  return entries.map(([key, count]) => `- ${key}: ${count}`).join("\n");
}

function countBy(values = [], mapper) {
  return values.reduce((counts, value) => {
    const key = mapper(value) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function countValues(values = []) {
  return values.reduce((counts, value) => {
    const key = value || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  compareRouteCandidates,
  formatComparisonReport,
  main,
};
