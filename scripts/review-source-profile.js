#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  resolveDefaultSourceProfileCatalog,
} = require("../server/pulse-sources/source-profile-catalog");

const USAGE = "Usage: node scripts/review-source-profile.js --approve reviewed-profile.json\n";

async function main(argv = process.argv.slice(2), options = {}) {
  const output = options.output || process.stdout;
  const errorOutput = options.errorOutput || process.stderr;
  const parsed = parseArguments(argv);
  if (parsed.errors.length || !parsed.approvePath) {
    errorOutput.write(USAGE);
    return 1;
  }

  let profile;
  try {
    const document = JSON.parse(fs.readFileSync(path.resolve(parsed.approvePath), "utf8"));
    profile = document?.source_profile || document;
  } catch (_error) {
    errorOutput.write("Could not read a valid reviewed source profile.\n");
    return 1;
  }

  const catalog = options.catalog || resolveDefaultSourceProfileCatalog(options.env || process.env);
  if (!catalog || typeof catalog.recordApprovedProfile !== "function") {
    writeJson(output, { status: "unavailable", reason: "source_catalog_unavailable" });
    return 1;
  }

  const result = await catalog.recordApprovedProfile(profile);
  writeJson(output, result);
  return result.status === "recorded" && result.catalog_status === "approved" ? 0 : 1;
}

function parseArguments(argv = []) {
  const parsed = { approvePath: null, errors: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--approve") {
      const value = argv[index + 1];
      if (typeof value !== "string" || !value.trim() || value.startsWith("--")) {
        parsed.errors.push("missing_approve_path");
      } else {
        parsed.approvePath = value.trim();
        index += 1;
      }
      continue;
    }
    parsed.errors.push("unknown_argument");
  }
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
