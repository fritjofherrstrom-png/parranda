/**
 * The dist-drift guard's comparison rules: Astro's nondeterministic island uid
 * is the ONLY tolerated build noise — any real content change is drift. The
 * git-walking half is exercised against a throwaway repo so the guard's verdict
 * (clean / modified / untracked / deleted) is pinned end-to-end.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  normalizeAstroBuildNoise,
  collectDistDrift,
  DIST_PREFIX,
} = require("../scripts/check-frontend-dist-drift");

test("island uid differences are normalized away; real content is not", () => {
  const committed = '<astro-island uid="13sSJj" props="{}">x</astro-island>';
  const rebuilt = '<astro-island uid="d0LfS" props="{}">x</astro-island>';
  assert.equal(normalizeAstroBuildNoise(committed), normalizeAstroBuildNoise(rebuilt));

  const changed = '<astro-island uid="d0LfS" props="{&quot;a&quot;:1}">x</astro-island>';
  assert.notEqual(normalizeAstroBuildNoise(committed), normalizeAstroBuildNoise(changed));

  // Non-island content is untouched.
  assert.equal(normalizeAstroBuildNoise("plain text"), "plain text");
});

test("the guard's verdict against a real repo: clean, uid-only, modified, untracked, deleted", (t) => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "dist-drift-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });

  git("init", "-q");
  const distDir = path.join(cwd, DIST_PREFIX);
  mkdirSync(distDir, { recursive: true });
  const page = path.join(distDir, "index.html");
  writeFileSync(page, '<astro-island uid="AAA">day</astro-island>');
  git("add", ".");
  git("commit", "-qm", "committed dist");

  // Clean tree → no drift.
  assert.deepEqual(collectDistDrift({ cwd }), []);

  // A rebuild that only rerolled the island uid → still no drift.
  writeFileSync(page, '<astro-island uid="BBB">day</astro-island>');
  assert.deepEqual(collectDistDrift({ cwd }), []);

  // Real content drift → reported as modified.
  writeFileSync(page, '<astro-island uid="BBB">NEW day</astro-island>');
  assert.deepEqual(collectDistDrift({ cwd }), [{ file: `${DIST_PREFIX}/index.html`, kind: "modified" }]);
  writeFileSync(page, '<astro-island uid="AAA">day</astro-island>'); // restore

  // A build output the commit forgot → untracked drift.
  const extra = path.join(distDir, "extra.js");
  writeFileSync(extra, "console.log(1)");
  assert.deepEqual(collectDistDrift({ cwd }), [{ file: `${DIST_PREFIX}/extra.js`, kind: "untracked" }]);
  rmSync(extra);

  // A committed file the build no longer produces → deleted drift.
  unlinkSync(page);
  assert.deepEqual(collectDistDrift({ cwd }), [{ file: `${DIST_PREFIX}/index.html`, kind: "deleted" }]);
});
