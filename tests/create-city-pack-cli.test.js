const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const scriptPath = path.join(__dirname, "..", "scripts", "create-city-pack.js");
const repoRoot = path.join(__dirname, "..");

function runCreate(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("create-city-pack CLI fails clearly when required args are missing", () => {
  const result = runCreate(["athens", "--label", "Athens"]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing required option\(s\): timezone, locale, currency, lat, lng/);
  assert.match(result.stderr, /Usage: node scripts\/create-city-pack.js <city-key>/);
});

test("create-city-pack CLI prints help without requiring city metadata", () => {
  const result = runCreate(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node scripts\/create-city-pack.js <city-key>/);
  assert.match(result.stdout, /--output-root <server\/cities path>/);
  assert.match(result.stdout, /--dry-run/);
  assert.equal(result.stderr, "");
});

test("create-city-pack CLI rejects unsafe city keys", () => {
  const result = runCreate([
    "New York",
    "--label",
    "New York",
    "--timezone",
    "America/New_York",
    "--locale",
    "en-US",
    "--currency",
    "USD",
    "--lat",
    "40.7128",
    "--lng",
    "-74.006",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /city key must use lowercase/);
});

test("create-city-pack CLI dry-run writes nothing and prints planned paths", () => {
  const outputRoot = makeOutputRoot();
  const result = runCreate([...athensArgs(outputRoot), "--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /City pack skeleton dry run/);
  assert.match(result.stdout, /- key: athens/);
  assert.match(result.stdout, /catalog\.js/);
  assert.match(result.stdout, /index\.js/);
  assert.equal(fs.existsSync(path.join(outputRoot, "athens")), false);
  assert.equal(result.stderr, "");
});

test("create-city-pack CLI writes expected files under output-root", () => {
  const outputRoot = makeOutputRoot();
  const result = runCreate(athensArgs(outputRoot));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /City pack skeleton created/);
  assert.equal(fs.existsSync(path.join(outputRoot, "athens", "catalog.js")), true);
  assert.equal(fs.existsSync(path.join(outputRoot, "athens", "index.js")), true);
  assert.equal(fs.existsSync(path.join(outputRoot, "athens", "sources.js")), false);
  assert.equal(result.stderr, "");
});

function athensArgs(outputRoot) {
  return [
    "athens",
    "--label",
    "Athens",
    "--timezone",
    "Europe/Athens",
    "--locale",
    "el-GR",
    "--currency",
    "EUR",
    "--lat",
    "37.9838",
    "--lng",
    "23.7275",
    "--visibility",
    "preview",
    "--output-root",
    outputRoot,
  ];
}

function makeOutputRoot() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "parranda-city-pack-cli-")), "server", "cities");
}
