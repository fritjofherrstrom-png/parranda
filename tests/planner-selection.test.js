const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scriptPath = path.join(__dirname, "..", "script.js");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

test("adding a non-default intent does not replace the existing planner selection", () => {
  const normalizeSelectionSlice = scriptSource.slice(
    scriptSource.indexOf("function normalizePlannerIntentSelectionAfterChange"),
    scriptSource.indexOf("function expandIntentKeysToPreferenceSignals"),
  );

  assert.doesNotMatch(normalizeSelectionSlice, /setSelectedIntentKeys\(\[changedInput\.value\]\)/);

});
