const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { isNightlifeExplicit } = require("../server/route-engine");

test("isNightlifeExplicit returns false for food/drink + culture + hidden gems", () => {
  assert.equal(
    isNightlifeExplicit(["mat", "vin", "öl", "cocktail", "kultur", "kyrkor", "hidden gems", "low-key"]),
    false,
  );
});

test("isNightlifeExplicit returns true when nattliv is in preferences", () => {
  assert.equal(isNightlifeExplicit(["mat", "nattliv"]), true);
});

test("isNightlifeExplicit returns true when kväll is in preferences", () => {
  assert.equal(isNightlifeExplicit(["kväll"]), true);
});

test("isNightlifeExplicit returns true when party is in preferences", () => {
  assert.equal(isNightlifeExplicit(["party"]), true);
});

test("isNightlifeExplicit returns true for bar-hop optimizer", () => {
  assert.equal(isNightlifeExplicit(["mat"], "bar-hop"), true);
});

test("isNightlifeExplicit returns true for evening modifier", () => {
  assert.equal(isNightlifeExplicit(["mat"], null, "evening"), true);
});

test("isNightlifeExplicit returns false for culture-mode optimizer", () => {
  assert.equal(isNightlifeExplicit(["kultur"], "culture-mode"), false);
});

test("isNightlifeExplicit returns false with empty preferences", () => {
  assert.equal(isNightlifeExplicit([]), false);
});

test("default planner markup does not have nightlife checked", () => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, "..", "index.html"),
    "utf8",
  );
  const nightlifeChip = indexHtml.match(
    /value="nightlife"[^>]*/,
  );
  assert.ok(nightlifeChip, "nightlife checkbox should exist");
  assert.ok(
    !nightlifeChip[0].includes("checked"),
    `nightlife checkbox should not be default-checked, found: ${nightlifeChip[0]}`,
  );
});

test("default planner JS does not include nightlife in defaults", () => {
  const scriptJs = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8",
  );
  const match = scriptJs.match(
    /defaultPlannerIntentKeys\s*=\s*\[([^\]]*)\]/,
  );
  assert.ok(match, "defaultPlannerIntentKeys should be defined");
  assert.ok(
    !match[1].includes("nightlife"),
    `defaultPlannerIntentKeys should not include nightlife, found: [${match[1]}]`,
  );
});
