const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { validateCityConfig } = require("../server/cities/contract");
const { inspectCityPack } = require("../server/city-readiness/inspect-city-pack");
const {
  createCityPackSkeleton,
  normalizeOptions,
  validateCityKey,
} = require("../server/city-pack-generator/create-city-pack");

test("normalizeOptions requires the core city metadata", () => {
  assert.throws(
    () => normalizeOptions({ key: "athens" }),
    /Missing required option\(s\): label, timezone, locale, currency, lat, lng/,
  );
});

test("validateCityKey rejects unsafe city keys", () => {
  const unsafeKeys = [
    "Athens",
    "new york",
    "../athens",
    "athens/center",
    "athens_center",
    "",
    "-athens",
  ];

  unsafeKeys.forEach((key) => {
    assert.throws(() => validateCityKey(key), /city key/);
  });
  assert.doesNotThrow(() => validateCityKey("athens"));
  assert.doesNotThrow(() => validateCityKey("sao-paulo-2"));
});

test("dry-run reports generated files without writing anything", () => {
  const outputRoot = makeOutputRoot();
  const result = createCityPackSkeleton({
    ...buildAthensOptions(),
    outputRoot,
    dryRun: true,
  });

  assert.equal(result.written, false);
  assert.equal(result.city.key, "athens");
  assert.deepEqual(result.files.map((file) => path.basename(file)), ["catalog.js", "index.js"]);
  assert.equal(fs.existsSync(path.join(outputRoot, "athens")), false);
});

test("generator creates deterministic city skeleton files under an output root", () => {
  const firstRoot = makeOutputRoot();
  const secondRoot = makeOutputRoot();

  const first = createCityPackSkeleton({ ...buildAthensOptions(), outputRoot: firstRoot });
  const second = createCityPackSkeleton({ ...buildAthensOptions(), outputRoot: secondRoot });

  assert.equal(first.written, true);
  assert.equal(second.written, true);
  assert.deepEqual(first.files.map((file) => path.basename(file)), ["catalog.js", "index.js"]);
  assert.equal(readGenerated(firstRoot, "catalog.js"), readGenerated(secondRoot, "catalog.js"));
  assert.equal(readGenerated(firstRoot, "index.js"), readGenerated(secondRoot, "index.js"));
});

test("generator refuses to overwrite existing city folders unless force is passed", () => {
  const outputRoot = makeOutputRoot();

  createCityPackSkeleton({ ...buildAthensOptions(), outputRoot });

  assert.throws(
    () => createCityPackSkeleton({ ...buildAthensOptions(), outputRoot }),
    /City folder already exists/,
  );

  const forced = createCityPackSkeleton({ ...buildAthensOptions(), outputRoot, force: true });
  assert.equal(forced.written, true);
});

test("generator force overwrites only planned skeleton files and preserves unrelated files", () => {
  const outputRoot = makeOutputRoot();
  const targetDir = path.join(outputRoot, "athens");

  createCityPackSkeleton({ ...buildAthensOptions(), outputRoot });
  fs.writeFileSync(path.join(targetDir, "catalog.js"), "module.exports = { stale: true };\n");
  fs.writeFileSync(path.join(targetDir, "index.js"), "module.exports = { stale: true };\n");
  fs.writeFileSync(path.join(targetDir, "sources.js"), "module.exports = { keep: true };\n");

  createCityPackSkeleton({ ...buildAthensOptions(), outputRoot, force: true });

  assert.match(readGenerated(outputRoot, "catalog.js"), /const routeTemplates = \[\];/);
  assert.match(readGenerated(outputRoot, "index.js"), /key: ATHENS_KEY/);
  assert.equal(
    fs.readFileSync(path.join(targetDir, "sources.js"), "utf8"),
    "module.exports = { keep: true };\n",
  );
});

test("generated city config passes validateCityConfig and inspectCityPack", () => {
  const outputRoot = makeOutputRoot();
  createCityPackSkeleton({ ...buildAthensOptions(), outputRoot });

  const cityConfig = requireFresh(path.join(outputRoot, "athens", "index.js"));
  assert.doesNotThrow(() => validateCityConfig(cityConfig));

  const readiness = inspectCityPack(cityConfig);
  assert.equal(readiness.city, "athens");
  assert.equal(readiness.visibility, "preview");
  assert.equal(readiness.status, "preview_ready");
  assert.equal(readiness.support.city_page, true);
  assert.equal(readiness.support.pulse_baseline, true);
  assert.equal(readiness.support.blitz_baseline, false);
  assert.equal(readiness.support.planner_baseline, false);
  assert.deepEqual(readiness.blocking_issues.validation_errors, []);
});

function buildAthensOptions() {
  return {
    key: "athens",
    label: "Athens",
    timezone: "Europe/Athens",
    locale: "el-GR",
    currency: "EUR",
    lat: 37.9838,
    lng: 23.7275,
    visibility: "preview",
  };
}

function makeOutputRoot() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "parranda-city-pack-")), "server", "cities");
}

function readGenerated(outputRoot, filename) {
  return fs.readFileSync(path.join(outputRoot, "athens", filename), "utf8");
}

function requireFresh(filePath) {
  delete require.cache[require.resolve(filePath)];
  return require(filePath);
}
