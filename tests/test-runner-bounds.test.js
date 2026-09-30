"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("suite bounds a stuck test file and reports failure rather than skipping it", () => {
  const script = require("../package.json").scripts.test;
  const option = /--test-timeout=(\d+)/.exec(script);
  assert.ok(option, "npm test must have an explicit test-file timeout");
  assert.match(script, /--require \.\/tests\/helpers\/file-deadline\.js/, "the suite also bounds a child with leaked active handles");
  assert.ok(Number(option[1]) >= 1000 && Number(option[1]) <= 600000, "the suite wait is bounded without an unrealistically short per-file limit");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-stuck-test-"));
  try {
    const file = path.join(dir, "stuck.test.js");
    fs.writeFileSync(file, "const {test}=require('node:test'); test('never settles',()=>{setInterval(()=>{},1000); return new Promise(()=>{});});\n");
    // A short probe of the same file guard. The child really hangs;
    // assertions are never replaced with a skip or a forced successful exit.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // The probe owns a new runner, not this file's child context.
    env.PARRANDA_TEST_FILE_DEADLINE_MS = "200";
    const guard = path.resolve(__dirname, "helpers/file-deadline.js");
    // Allow runner startup under full-suite load. An outer kill is a failure,
    // never evidence that the guard works. TAP is explicit on both Node 22/24.
    const result = spawnSync(process.execPath, ["--require", guard, "--test", "--test-reporter=tap", "--test-timeout=200", file], { encoding: "utf8", timeout: 30000, env });
    assert.ifError(result.error);
    assert.equal(result.signal, null, "the file guard terminates the stuck child before the outer safety timeout");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /PARRANDA_TEST_FILE_TIMEOUT/);
    assert.match(result.stdout, /^not ok /m);
    assert.match(result.stdout, /^# skipped 0$/m);

    // A completed assertion with a leaked handle must not become overall PASS.
    fs.writeFileSync(file, "const {test}=require('node:test'); test('finished but leaking',()=>{setInterval(()=>{},1000);});\n");
    const leaking = spawnSync(process.execPath, ["--require", guard, "--test", "--test-reporter=tap", file], { encoding: "utf8", timeout: 30000, env });
    assert.ifError(leaking.error);
    assert.equal(leaking.signal, null);
    assert.equal(leaking.status, 1, leaking.stdout + leaking.stderr);
    assert.match(leaking.stdout + leaking.stderr, /PARRANDA_TEST_FILE_TIMEOUT/);
    assert.match(leaking.stdout, /^not ok /m);

    // An ordinary completed file exits successfully: the deadline's own timer
    // must not hold it open or force a failure after otherwise complete work.
    fs.writeFileSync(file, "const {test}=require('node:test'); test('finished',()=>{});\n");
    const complete = spawnSync(process.execPath, ["--require", guard, "--test", "--test-reporter=tap", file], { encoding: "utf8", timeout: 30000, env: { ...env, PARRANDA_TEST_FILE_DEADLINE_MS: "5000" } });
    assert.ifError(complete.error);
    assert.equal(complete.status, 0, complete.stdout + complete.stderr);
    assert.doesNotMatch(complete.stdout + complete.stderr, /PARRANDA_TEST_FILE_TIMEOUT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
