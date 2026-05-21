#!/usr/bin/env node

const { resolveCityConfig } = require("../server/cities");
const { compareRouteCandidates } = require("./compare-route-candidates");

const REQUIRED_CITY_KEYS = ["rome", "barcelona", "test-city"];

function main(
  argv = process.argv.slice(2),
  output = process.stdout,
  errorOutput = process.stderr,
  options = {},
) {
  if (argv.length) {
    errorOutput.write("Usage: node scripts/check-route-candidate-readiness.js\n");
    return 1;
  }

  let comparisons;
  try {
    comparisons = collectReadinessComparisons({
      cityKeys: options.cityKeys || REQUIRED_CITY_KEYS,
      loadComparison: options.loadComparison,
    });
  } catch (error) {
    errorOutput.write(`${error.message}\n`);
    return 1;
  }

  const gate = evaluateReadinessGate(comparisons);
  output.write(formatReadinessGateReport(gate));

  if (!gate.ready) {
    errorOutput.write(formatFailureSummary(gate));
    return 1;
  }

  return 0;
}

function collectReadinessComparisons({ cityKeys = REQUIRED_CITY_KEYS, loadComparison } = {}) {
  return cityKeys.map((cityKey) =>
    typeof loadComparison === "function" ? loadComparison(cityKey) : loadComparisonForCity(cityKey),
  );
}

function loadComparisonForCity(cityKey) {
  const resolution = resolveCityConfig(cityKey, { allowFallback: false });
  if (!resolution.found || !resolution.cityConfig) {
    throw new Error(`Unknown city "${cityKey}". Expected one of: ${REQUIRED_CITY_KEYS.join(", ")}.`);
  }

  return compareRouteCandidates(resolution.cityConfig);
}

function evaluateReadinessGate(comparisons = []) {
  const results = comparisons.map((comparison) => ({
    ...comparison,
    failure_reasons: buildFailureReasons(comparison),
  }));

  return {
    ready: results.every((comparison) => comparison.readiness === "ready"),
    results,
  };
}

function buildFailureReasons(comparison) {
  const reasons = [];

  if (comparison.template_ids_missing_from_route_candidates.length) {
    reasons.push(
      `missing template ids: ${comparison.template_ids_missing_from_route_candidates.join(", ")}`,
    );
  }

  if (comparison.route_candidate_ids_missing_from_templates.length) {
    reasons.push(
      `extra RouteCandidate ids: ${comparison.route_candidate_ids_missing_from_templates.join(", ")}`,
    );
  }

  if (comparison.unresolved_template_stops.length) {
    reasons.push(
      `unresolved stops: ${comparison.unresolved_template_stops
        .map((stop) => `${stop.route_id}:${stop.stop_id}`)
        .join(", ")}`,
    );
  }

  const stopMismatches = comparison.stop_count_comparison.filter(
    (route) => !route.stop_count_matches,
  );
  if (stopMismatches.length) {
    reasons.push(
      `stop count mismatches: ${stopMismatches
        .map(
          (route) =>
            `${route.id} template=${route.template_stop_count} route_candidate=${route.route_candidate_stop_count}`,
        )
        .join(", ")}`,
    );
  }

  const warningKeys = Object.keys(comparison.warnings);
  if (warningKeys.length) {
    reasons.push(`warnings: ${formatInlineCountMap(comparison.warnings)}`);
  }

  const limitationKeys = Object.keys(comparison.limitations);
  if (limitationKeys.length) {
    reasons.push(`limitations: ${formatInlineCountMap(comparison.limitations)}`);
  }

  if (comparison.readiness !== "ready" && !reasons.length) {
    reasons.push(`readiness verdict: ${comparison.readiness}`);
  }

  return reasons;
}

function formatReadinessGateReport(gate) {
  const lines = [];

  lines.push("RouteCandidate readiness gate");
  lines.push("");
  gate.results.forEach((comparison) => {
    lines.push(
      [
        `- ${comparison.city}: ${comparison.readiness}`,
        `templates=${comparison.route_templates_count}`,
        `route_candidates=${comparison.route_candidate_count}`,
        `user_facing=${comparison.user_facing_stop_count}`,
        `structural=${comparison.structural_stop_count}`,
        `warnings=${sumCountMap(comparison.warnings)}`,
        `limitations=${sumCountMap(comparison.limitations)}`,
      ].join(" | "),
    );
  });
  lines.push("");
  lines.push(`Readiness gate: ${gate.ready ? "ready" : "failed"}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function formatFailureSummary(gate) {
  const failed = gate.results.filter((comparison) => comparison.readiness !== "ready");
  if (!failed.length) {
    return "";
  }

  const lines = ["RouteCandidate readiness gate failed:"];
  failed.forEach((comparison) => {
    lines.push(`- ${comparison.city}: ${comparison.readiness}`);
    comparison.failure_reasons.forEach((reason) => {
      lines.push(`  - ${reason}`);
    });
  });
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function sumCountMap(counts = {}) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function formatInlineCountMap(counts = {}) {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  REQUIRED_CITY_KEYS,
  buildFailureReasons,
  collectReadinessComparisons,
  evaluateReadinessGate,
  formatFailureSummary,
  formatReadinessGateReport,
  main,
};
