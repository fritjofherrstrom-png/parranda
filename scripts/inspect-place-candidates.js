#!/usr/bin/env node

const { resolveCityConfig } = require("../server/cities");
const {
  createDefaultCandidateProviderRegistry,
} = require("../server/place-candidates/provider-registry");
const { assessCityCandidateReadiness } = require("../server/place-candidates/readiness");

const SAMPLE_SIZE = 8;

function main(argv = process.argv.slice(2), output = process.stdout, errorOutput = process.stderr) {
  const cityKey = String(argv[0] || "").trim().toLowerCase();

  if (!cityKey) {
    errorOutput.write("Usage: node scripts/inspect-place-candidates.js <city-key>\n");
    return 1;
  }

  const resolution = resolveCityConfig(cityKey, { allowFallback: false });

  if (!resolution.found || !resolution.cityConfig) {
    errorOutput.write(`Unknown city "${cityKey}". Try one of: barcelona, rome, test-city.\n`);
    return 1;
  }

  const cityConfig = resolution.cityConfig;
  const registry = createDefaultCandidateProviderRegistry();
  const collection = registry.collectCandidates(cityConfig);
  const readiness = assessCityCandidateReadiness(cityConfig);

  output.write(formatReport({
    cityConfig,
    enabledProviders: registry.listProviderIds(),
    collection,
    readiness,
  }));

  return 0;
}

function formatReport({ cityConfig, enabledProviders, collection, readiness }) {
  const lines = [];
  const cityLabel = cityConfig.label || cityConfig.key;

  lines.push(`PlaceCandidate inspection: ${cityConfig.key} (${cityLabel})`);
  lines.push("");
  lines.push("Enabled providers:");
  lines.push(formatList(enabledProviders));
  lines.push("");
  lines.push("Provider summary:");
  lines.push(formatProviderSummary(collection.summary.by_provider));
  lines.push("");
  lines.push("Candidate summary:");
  lines.push(`- total: ${collection.summary.total}`);
  lines.push(`- real places: ${collection.summary.real_place_count}`);
  lines.push(`- structural: ${collection.summary.structural_count}`);
  lines.push("- candidate kinds:");
  lines.push(formatCountMap(collection.summary.by_candidate_kind));
  lines.push("- trust tiers:");
  lines.push(formatCountMap(collection.summary.by_trust_tier));
  lines.push("");
  lines.push("Readiness:");
  lines.push(`- can support Blitz: ${formatBoolean(readiness.can_support_blitz)}`);
  lines.push(`- can support Planner: ${formatBoolean(readiness.can_support_planner)}`);
  lines.push(`- coordinate coverage: ${Math.round(readiness.coordinate_coverage * 100)}%`);
  lines.push(`- coordinate-ready real places: ${readiness.coordinate_ready_real_place_count}`);
  lines.push(`- warnings: ${readiness.warnings.length ? readiness.warnings.join(", ") : "none"}`);
  lines.push("");
  lines.push(`Sample candidates (${Math.min(SAMPLE_SIZE, collection.candidates.length)} of ${collection.candidates.length}):`);
  lines.push(formatCandidateSample(collection.candidates.slice(0, SAMPLE_SIZE)));
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function formatList(values = []) {
  if (!values.length) {
    return "- none";
  }
  return values.map((value) => `- ${value}`).join("\n");
}

function formatProviderSummary(byProvider = {}) {
  const entries = Object.entries(byProvider);
  if (!entries.length) {
    return "- none";
  }

  return entries
    .map(([providerId, summary]) => {
      const kinds = formatInlineCountMap(summary.by_candidate_kind);
      const trusts = formatInlineCountMap(summary.by_trust_tier);
      return `- ${providerId}: ${summary.count} candidates; kinds: ${kinds}; trust: ${trusts}`;
    })
    .join("\n");
}

function formatCountMap(counts = {}) {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) {
    return "  - none";
  }
  return entries.map(([key, count]) => `  - ${key}: ${count}`).join("\n");
}

function formatInlineCountMap(counts = {}) {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) {
    return "none";
  }
  return entries.map(([key, count]) => `${key}=${count}`).join(", ");
}

function formatCandidateSample(candidates = []) {
  if (!candidates.length) {
    return "- none";
  }

  return candidates
    .map((candidate) => {
      const source = [candidate.source.kind, candidate.source.id].filter(Boolean).join(":");
      const area = candidate.area ? `; area=${candidate.area}` : "";
      return `- ${candidate.id}: ${candidate.label} [${candidate.candidate_kind}; trust=${candidate.trust.source_tier}; source=${source}; structural=${candidate.is_structural}${area}]`;
    })
    .join("\n");
}

function formatBoolean(value) {
  return value ? "yes" : "no";
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  SAMPLE_SIZE,
  formatReport,
  main,
};
