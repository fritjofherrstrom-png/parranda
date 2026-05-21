#!/usr/bin/env node

const { resolveCityConfig } = require("../server/cities");
const { buildRouteTemplateCandidates } = require("../server/route-candidates/route-template-provider");

const SAMPLE_SIZE = 5;

function main(argv = process.argv.slice(2), output = process.stdout, errorOutput = process.stderr) {
  const cityKey = String(argv[0] || "").trim().toLowerCase();

  if (!cityKey) {
    errorOutput.write("Usage: node scripts/inspect-route-candidates.js <city-key>\n");
    return 1;
  }

  const resolution = resolveCityConfig(cityKey, { allowFallback: false });
  if (!resolution.found || !resolution.cityConfig) {
    errorOutput.write(`Unknown city "${cityKey}". Try one of: barcelona, rome, test-city.\n`);
    return 1;
  }

  const routeCandidates = buildRouteTemplateCandidates(resolution.cityConfig);
  output.write(formatReport({
    cityConfig: resolution.cityConfig,
    routeCandidates,
  }));
  return 0;
}

function formatReport({ cityConfig, routeCandidates }) {
  const lines = [];
  const routeCount = routeCandidates.length;
  const summary = summarizeRoutes(routeCandidates);

  lines.push(`RouteCandidate inspection: ${cityConfig.key} (${cityConfig.label || cityConfig.key})`);
  lines.push("");
  lines.push(`Route count: ${routeCount}`);
  lines.push("Route ids:");
  lines.push(formatList(routeCandidates.map((candidate) => candidate.id)));
  lines.push("");
  lines.push("Route summary:");
  lines.push("- route shapes:");
  lines.push(formatCountMap(summary.by_route_shape));
  lines.push("- source mix:");
  lines.push(formatCountMap(summary.by_source_mix));
  lines.push("- confidence:");
  lines.push(formatCountMap(summary.by_confidence));
  lines.push("- trust tiers:");
  lines.push(formatCountMap(summary.by_trust_tier));
  lines.push("- stops:");
  lines.push(`  - total: ${summary.total_stops}`);
  lines.push(`  - user-facing: ${summary.user_facing_stops}`);
  lines.push(`  - structural: ${summary.structural_stops}`);
  lines.push("- warnings:");
  lines.push(formatCountMap(summary.by_warning));
  lines.push("- limitations:");
  lines.push(formatCountMap(summary.by_limitation));
  lines.push("");
  lines.push(`Sample RouteCandidates (${Math.min(SAMPLE_SIZE, routeCount)} of ${routeCount}):`);
  lines.push(formatRouteSamples(routeCandidates.slice(0, SAMPLE_SIZE)));
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function summarizeRoutes(routeCandidates = []) {
  return routeCandidates.reduce(
    (summary, candidate) => {
      increment(summary.by_route_shape, candidate.route_shape);
      increment(summary.by_confidence, candidate.confidence);
      candidate.source_mix.forEach((sourceKind) => increment(summary.by_source_mix, sourceKind));
      candidate.trust_summary.source_tiers.forEach((tier) => increment(summary.by_trust_tier, tier));
      candidate.warnings.forEach((warning) => increment(summary.by_warning, warning));
      candidate.limitations.forEach((limitation) => increment(summary.by_limitation, limitation));

      summary.total_stops += candidate.stops.length;
      summary.user_facing_stops += candidate.stops.filter((stop) => stop.is_user_facing).length;
      summary.structural_stops += candidate.stops.filter((stop) => !stop.is_user_facing).length;
      return summary;
    },
    {
      by_route_shape: {},
      by_source_mix: {},
      by_confidence: {},
      by_trust_tier: {},
      by_warning: {},
      by_limitation: {},
      total_stops: 0,
      user_facing_stops: 0,
      structural_stops: 0,
    },
  );
}

function formatRouteSamples(routeCandidates = []) {
  if (!routeCandidates.length) {
    return "- none";
  }

  return routeCandidates
    .map((candidate) => {
      const userStops = candidate.stops.filter((stop) => stop.is_user_facing).length;
      const structuralStops = candidate.stops.length - userStops;
      return [
        `- ${candidate.id}`,
        `  shape: ${candidate.route_shape}`,
        `  source_mix: ${candidate.source_mix.join(", ")}`,
        `  confidence: ${candidate.confidence}`,
        `  trust_summary: ${formatTrustSummary(candidate.trust_summary)}`,
        `  stop_count: ${candidate.stops.length} (${userStops} user-facing, ${structuralStops} structural)`,
        `  stops: ${candidate.stops.map(formatStop).join(" -> ")}`,
        `  warnings: ${candidate.warnings.length ? candidate.warnings.join(", ") : "none"}`,
        `  limitations: ${candidate.limitations.length ? candidate.limitations.join(", ") : "none"}`,
      ].join("\n");
    })
    .join("\n");
}

function formatStop(stop) {
  const label = stop.label || stop.candidate_id;
  return stop.is_user_facing ? label : `${label} [structure]`;
}

function formatTrustSummary(trustSummary) {
  return [
    `tiers=${trustSummary.source_tiers.join(",")}`,
    `confidence=${trustSummary.confidence}`,
    `human_verified=${trustSummary.human_verified}`,
    `freshness=${trustSummary.freshness}`,
  ].join("; ");
}

function formatList(values = []) {
  if (!values.length) return "- none";
  return values.map((value) => `- ${value}`).join("\n");
}

function formatCountMap(counts = {}) {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return "  - none";
  return entries.map(([key, count]) => `  - ${key}: ${count}`).join("\n");
}

function increment(counts, key) {
  const normalized = key || "unknown";
  counts[normalized] = (counts[normalized] || 0) + 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  SAMPLE_SIZE,
  formatReport,
  main,
  summarizeRoutes,
};
