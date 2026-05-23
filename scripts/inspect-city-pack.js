#!/usr/bin/env node

const { cityConfigs, resolveCityConfig } = require("../server/cities");
const { inspectCityPack } = require("../server/city-readiness/inspect-city-pack");

function main(argv = process.argv.slice(2), output = process.stdout, errorOutput = process.stderr) {
  if (argv.includes("--help") || argv.includes("-h")) {
    output.write(`${usage()}\n`);
    return 0;
  }

  const cityKey = String(argv[0] || "").trim().toLowerCase();

  if (!cityKey) {
    errorOutput.write(`${usage()}\n`);
    return 1;
  }

  const resolution = resolveCityConfig(cityKey, { allowFallback: false });

  if (!resolution.found || !resolution.cityConfig) {
    errorOutput.write(
      `Unknown city "${cityKey}". Try one of: ${Object.keys(cityConfigs).sort().join(", ")}.\n`,
    );
    return 1;
  }

  output.write(formatCityPackInspection(inspectCityPack(resolution.cityConfig)));
  return 0;
}

function formatCityPackInspection(report) {
  const lines = [];
  const center = report.metadata.center.present
    ? `${report.metadata.center.lat}, ${report.metadata.center.lng}`
    : "missing";

  lines.push(`City pack inspection: ${report.city} (${report.label})`);
  lines.push(`Visibility: ${report.visibility}`);
  lines.push("");
  lines.push("Core metadata:");
  lines.push(`- timezone: ${report.metadata.timezone || "missing"}`);
  lines.push(`- locale: ${report.metadata.locale || "missing"}`);
  lines.push(`- currency: ${report.metadata.currency || "missing"}`);
  lines.push(`- center: ${center}`);
  lines.push("");
  lines.push("Catalog:");
  lines.push(`- items: ${report.catalog.item_count}`);
  lines.push(`- real places: ${report.catalog.real_place_count}`);
  lines.push(`- structural anchors: ${report.catalog.structural_anchor_count}`);
  lines.push(`- area presets: ${report.catalog.area_preset_count}`);
  lines.push(`- route templates: ${report.catalog.route_template_count}`);
  lines.push(`- area tokens: ${report.catalog.area_token_count}`);
  lines.push("");
  lines.push("Issues:");
  lines.push(`- duplicate ids: ${formatListInline(report.catalog.issues.duplicate_ids)}`);
  lines.push(
    `- invalid area tokens: ${formatAreaIssues(report.catalog.issues.invalid_area_tokens)}`,
  );
  lines.push(
    `- missing coordinates: ${formatListInline(report.catalog.issues.missing_coordinates)}`,
  );
  lines.push(
    `- missing searchTerms: ${formatListInline(report.catalog.issues.missing_search_terms)}`,
  );
  lines.push(
    `- missing provenance: ${
      report.catalog.has_provenance_map
        ? formatListInline(report.catalog.issues.missing_provenance)
        : "not checked"
    }`,
  );
  lines.push("");
  lines.push("PlaceCandidate readiness:");
  if (report.place_candidate_readiness) {
    lines.push(
      `- can support Blitz: ${formatBoolean(report.place_candidate_readiness.can_support_blitz)}`,
    );
    lines.push(
      `- can support Planner candidates: ${formatBoolean(report.place_candidate_readiness.can_support_planner)}`,
    );
    lines.push(
      `- coordinate coverage: ${Math.round(report.place_candidate_readiness.coordinate_coverage * 100)}%`,
    );
    lines.push(
      `- coordinate-ready real places: ${report.place_candidate_readiness.coordinate_ready_real_place_count}`,
    );
    lines.push(`- warnings: ${formatListInline(report.place_candidate_readiness.warnings)}`);
  } else {
    lines.push(`- errors: ${formatListInline(report.blocking_issues.place_candidate_readiness_errors)}`);
  }
  lines.push("");
  lines.push("Support:");
  lines.push(`- city page: ${formatBoolean(report.support.city_page)}`);
  lines.push(`- Pulse baseline: ${formatBoolean(report.support.pulse_baseline)}`);
  lines.push(`- Blitz baseline: ${formatBoolean(report.support.blitz_baseline)}`);
  lines.push(`- Planner baseline: ${formatBoolean(report.support.planner_baseline)}`);
  lines.push("");
  lines.push(`Final status: ${report.status}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function formatListInline(values = []) {
  if (!values.length) {
    return "none";
  }
  return values.join(", ");
}

function formatAreaIssues(issues = []) {
  if (!issues.length) {
    return "none";
  }
  return issues.map((issue) => `${issue.id}:${issue.area}`).join(", ");
}

function formatBoolean(value) {
  return value ? "yes" : "no";
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  formatCityPackInspection,
  main,
};

function usage() {
  return "Usage: node scripts/inspect-city-pack.js <city-key>";
}
