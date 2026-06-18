#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const { evaluateLiveEventSourceCandidate } = require("../server/pulse-sources/source-discovery");

function main(argv) {
  const inputPath = argv[2];
  if (!inputPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  const payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const candidates = Array.isArray(payload) ? payload : payload.candidates;
  if (!Array.isArray(candidates)) {
    throw new Error("Probe input must be an array or an object with candidates[]");
  }

  const results = candidates
    .map(evaluateLiveEventSourceCandidate)
    .sort((left, right) => {
      const priorityDelta = (left.priority || 99) - (right.priority || 99);
      if (priorityDelta !== 0) return priorityDelta;
      const scoreDelta = (right.score || 0) - (left.score || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return String(left.id || "").localeCompare(String(right.id || ""));
    });

  process.stdout.write(`${JSON.stringify({ source_discovery: results }, null, 2)}\n`);
}

function printUsage() {
  process.stderr.write(
    "Usage: node scripts/probe-live-event-sources.js source-candidates.json\n\n" +
      "Evaluates source-discovery candidates from a local fixture. This script does not fetch network resources.\n",
  );
}

if (require.main === module) {
  main(process.argv);
}
