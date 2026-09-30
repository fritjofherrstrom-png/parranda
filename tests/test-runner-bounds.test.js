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
  assert.ok(Number(option[1]) >= 1000 && Number(option[1]) <= 600000, "the suite wait is bounded without an unrealistically short per-file limit");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-stuck-test-"));
  try {
    const file = path.join(dir, "stuck.test.js");
    fs.writeFileSync(file, "const {test}=require('node:test'); test('never settles',()=>{setInterval(()=>{},1000); return new Promise(()=>{});});\n");
    // A short probe of the same Node timeout mechanism. The child really hangs;
    // assertions are never replaced with a skip or a forced successful exit.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // The probe owns a new runner, not this file's child context.
    const result = spawnSync(process.execPath, ["--test", "--test-timeout=200", file], { encoding: "utf8", timeout: 5000, env });
    assert.ifError(result.error);
    assert.equal(result.signal, null, "Node itself terminates the stuck file before the outer safety timeout");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /timeout|timed out/i);
    assert.match(result.stdout, /^not ok /m);
    assert.match(result.stdout, /^# skipped 0$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
