#!/usr/bin/env node

/**
 * inspect-candidate-pack — print a structured report on a candidate
 * pack markdown file (docs/candidate-packs/*.md).
 *
 * Intake-layer safety gate. Does NOT promote candidates into runtime.
 *
 * Usage:
 *   node scripts/inspect-candidate-pack.js docs/candidate-packs/barcelona-second-hand-v0.md
 *
 * Exit codes:
 *   0  — pack is valid intake_only or promotion_safe (warnings allowed)
 *   1  — pack has hard errors (status: blocked) or argv is missing
 */

const fs = require("node:fs");
const path = require("node:path");

const { validateCandidatePack } = require("../server/candidate-packs/validate");

function main(
  argv = process.argv.slice(2),
  output = process.stdout,
  errorOutput = process.stderr,
) {
  const inputPath = argv[0];
  if (!inputPath) {
    errorOutput.write(
      "Usage: node scripts/inspect-candidate-pack.js <path-to-pack.md>\n",
    );
    return 1;
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  let markdown;
  try {
    markdown = fs.readFileSync(absolutePath, "utf8");
  } catch (error) {
    errorOutput.write(`Failed to read "${inputPath}": ${error.message}\n`);
    return 1;
  }

  const report = validateCandidatePack(markdown, { sourcePath: inputPath });
  output.write(formatReport(report));
  return report.status === "blocked" ? 1 : 0;
}

function formatReport(report) {
  const { pack, candidates, errors, warnings, distributions, status, sourcePath } = report;
  const lines = [];

  lines.push(`Candidate pack inspection: ${sourcePath || "(stdin)"}`);
  lines.push("");

  if (pack) {
    lines.push("Pack metadata:");
    lines.push(`- pack_name: ${pack.pack_name || "(missing)"}`);
    lines.push(`- city: ${pack.city || "(missing)"}`);
    lines.push(`- theme: ${truncate(pack.theme, 80)}`);
    lines.push(`- pack_version: ${pack.pack_version || "(missing)"}`);
    lines.push(`- last_updated: ${pack.last_updated || "(missing)"}`);
    lines.push(`- author: ${pack.author || "(missing)"}`);
  } else {
    lines.push("Pack metadata: (missing — no fenced text block with pack_name found)");
  }
  lines.push("");

  lines.push(`Candidate count: ${candidates.length}`);
  lines.push("");

  lines.push("Counts by candidate_kind:");
  lines.push(formatCountMap(distributions.candidate_kind));
  lines.push("");

  lines.push("Counts by source_kind:");
  lines.push(formatCountMap(distributions.source_kind));
  lines.push("");

  lines.push("Confidence distribution:");
  lines.push(formatCountMap(distributions.confidence));
  lines.push("");

  lines.push("Verification priority distribution:");
  lines.push(formatCountMap(distributions.verification_priority));
  lines.push("");

  lines.push("Promotion recommendation distribution:");
  lines.push(formatCountMap(distributions.promotion_recommendation));
  lines.push("");

  if (errors.length) {
    lines.push(`Hard errors (${errors.length}):`);
    for (const error of errors) {
      const id = error.candidate ? ` [${error.candidate}]` : "";
      lines.push(`- ${error.code}${id}: ${error.message}`);
    }
  } else {
    lines.push("Hard errors: none");
  }
  lines.push("");

  if (warnings.length) {
    lines.push(`Warnings (${warnings.length}):`);
    for (const warning of warnings) {
      const id = warning.candidate ? ` [${warning.candidate}]` : "";
      lines.push(`- ${warning.code}${id}: ${warning.message}`);
    }
  } else {
    lines.push("Warnings: none");
  }
  lines.push("");

  lines.push(`Status: ${status}`);
  lines.push(statusExplanation(status));
  lines.push("");

  return lines.join("\n");
}

function statusExplanation(status) {
  switch (status) {
    case "intake_only":
      return "  Pack is valid. Every candidate requires verification before any runtime promotion.";
    case "promotion_safe":
      return "  Pack is valid AND has at least one verified candidate (confidence: high + promotion_recommendation: promote_first). A targeted promotion PR can pick those up.";
    case "blocked":
      return "  Pack has hard errors. Fix them before re-running the validator. No promotion until status leaves 'blocked'.";
    default:
      return "";
  }
}

function formatCountMap(counts = {}) {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return "  - none";
  return entries.map(([key, count]) => `  - ${key}: ${count}`).join("\n");
}

function truncate(text, max = 80) {
  const trimmed = String(text || "").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  main,
  formatReport,
};
