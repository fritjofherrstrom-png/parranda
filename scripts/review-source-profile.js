#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  resolveDefaultSourceProfileCatalog,
} = require("../server/pulse-sources/source-profile-catalog");

const USAGE = [
  "Usage:",
  "  node scripts/review-source-profile.js --inspect place-source-profile-v1:...",
  "  node scripts/review-source-profile.js --approve decision.json --operator operator-id",
  "",
].join("\n");

async function main(argv = process.argv.slice(2), options = {}) {
  const output = options.output || process.stdout;
  const errorOutput = options.errorOutput || process.stderr;
  const parsed = parseArguments(argv);
  if (parsed.errors.length || (!parsed.approvePath && !parsed.inspectProfileKey)) {
    errorOutput.write(`${USAGE}\n`);
    return 1;
  }

  const catalog = options.catalog || resolveDefaultSourceProfileCatalog(options.env || process.env);
  if (!catalog) {
    writeJson(output, { status: "unavailable", reason: "source_catalog_unavailable" });
    return 1;
  }

  if (parsed.inspectProfileKey) {
    if (typeof catalog.inspectProfileForReview !== "function") {
      writeJson(output, { status: "unavailable", reason: "source_catalog_review_unavailable" });
      return 1;
    }
    const result = await catalog.inspectProfileForReview(parsed.inspectProfileKey);
    writeJson(output, result);
    if (typeof catalog.close === "function") await catalog.close();
    return result.status === "reviewable" ? 0 : 1;
  }

  let decision;
  try {
    decision = JSON.parse(fs.readFileSync(path.resolve(parsed.approvePath), "utf8"));
  } catch (_error) {
    errorOutput.write("Could not read a valid source approval decision.\n");
    return 1;
  }

  if (typeof catalog.approveProfile !== "function") {
    writeJson(output, { status: "unavailable", reason: "source_catalog_review_unavailable" });
    return 1;
  }

  const result = await catalog.approveProfile(decision, { operatorId: parsed.operatorId });
  writeJson(output, result);
  if (typeof catalog.close === "function") await catalog.close();
  return result.status === "recorded" && result.catalog_status === "approved" ? 0 : 1;
}

function parseArguments(argv = []) {
  const parsed = { approvePath: null, inspectProfileKey: null, operatorId: null, errors: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--approve", "--inspect", "--operator"].includes(argument)) {
      const value = argv[index + 1];
      if (typeof value !== "string" || !value.trim() || value.startsWith("--")) {
        parsed.errors.push(`missing_${argument.slice(2)}`);
      } else {
        if (argument === "--approve") parsed.approvePath = value.trim();
        if (argument === "--inspect") parsed.inspectProfileKey = value.trim();
        if (argument === "--operator") parsed.operatorId = value.trim();
        index += 1;
      }
      continue;
    }
    parsed.errors.push("unknown_argument");
  }
  if (parsed.approvePath && parsed.inspectProfileKey) parsed.errors.push("approve_inspect_conflict");
  if (parsed.approvePath && !parsed.operatorId) parsed.errors.push("missing_operator");
  if (parsed.inspectProfileKey && parsed.operatorId) parsed.errors.push("operator_without_approval");
  return parsed;
}

function writeJson(output, value) {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.stderr.write("Source profile review failed safely.\n");
    process.exitCode = 1;
  });
}

module.exports = { main, parseArguments };
