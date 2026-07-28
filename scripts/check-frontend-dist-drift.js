#!/usr/bin/env node
/**
 * Guard: the COMMITTED frontend/dist must match what `npm --prefix frontend run
 * build` produces from the committed source. The serving contract makes dist
 * build-output-as-source-of-truth (GET / and /anywhere serve it directly), so a
 * source change without the rebuild-and-commit step ships stale UI silently —
 * the one drift the build-present gate cannot catch.
 *
 * Run AFTER a fresh build (CI runs it right after the build step). Compares the
 * working tree against HEAD for everything under frontend/dist:
 *   - modified tracked files are compared MODULO Astro's per-build island noise
 *     (`uid="…"` is nondeterministic on every build — verified live; a naive
 *     byte-compare can therefore never pass);
 *   - untracked additions and deletions under dist are always drift.
 * Exits non-zero listing the drifted files.
 */

"use strict";

const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const DIST_PREFIX = "frontend/dist";

// Astro stamps a fresh random island uid into every build's HTML. It is the
// ONLY tolerated nondeterminism — an exact allowlist, not a broad rewrite:
// normalization applies solely to the `uid` attribute INSIDE an
// `<astro-island …>` opening tag, so a `uid="…"` appearing anywhere else in
// the output (page content, other markup) still compares literally and real
// drift fails.
function normalizeAstroBuildNoise(content) {
  return String(content).replace(/<astro-island\b[^>]*>/g, (tag) =>
    tag.replace(/\buid="[^"]*"/, 'uid=""'),
  );
}

function git(args, options = {}) {
  // stderr captured, never inherited: an expected miss (e.g. `git show` on a
  // path HEAD doesn't have) must not print "fatal:" noise into guard output.
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

function listLines(output) {
  return String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectDistDrift({ cwd = process.cwd() } = {}) {
  const drift = [];

  const modified = listLines(git(["diff", "--name-only", "HEAD", "--", DIST_PREFIX], { cwd }));
  for (const file of modified) {
    let committed = null;
    try {
      committed = git(["show", `HEAD:${file}`], { cwd });
    } catch (_error) {
      // In git's diff-to-HEAD a file with no HEAD blob is an addition; the
      // untracked walk below reports those. A deletion keeps its HEAD blob and
      // fails the readFileSync branch instead.
    }
    let working = null;
    try {
      working = readFileSync(path.join(cwd, file), "utf8");
    } catch (_error) {
      drift.push({ file, kind: "deleted" });
      continue;
    }
    if (committed !== null && normalizeAstroBuildNoise(committed) !== normalizeAstroBuildNoise(working)) {
      drift.push({ file, kind: "modified" });
    }
  }

  const untracked = listLines(
    git(["ls-files", "--others", "--exclude-standard", "--", DIST_PREFIX], { cwd }),
  );
  for (const file of untracked) {
    drift.push({ file, kind: "untracked" });
  }

  return drift;
}

function main() {
  const drift = collectDistDrift();
  if (!drift.length) {
    console.log("frontend/dist matches the committed build (island uid noise ignored).");
    return;
  }
  console.error("COMMITTED frontend/dist DRIFTS from the fresh build:");
  for (const { file, kind } of drift) {
    console.error(`  ${kind.padEnd(9)} ${file}`);
  }
  console.error("\nRebuild and commit it: npm --prefix frontend run build && git add frontend/dist");
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { normalizeAstroBuildNoise, collectDistDrift, DIST_PREFIX };
