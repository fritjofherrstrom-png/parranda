const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const scriptSource = readFileSync(path.join(repoRoot, "script.js"), "utf8");
const guardrailDoc = readFileSync(path.join(repoRoot, "docs/PRODUCT_SURFACE_GUARDRAILS.md"), "utf8");

function extractFunction(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} should exist`);

  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  throw new Error(`Could not extract ${functionName}`);
}

test("legacy Rome route examples are demoted from primary route results", () => {
  const renderFallbackRoutes = extractFunction(scriptSource, "renderFallbackRoutes");

  assert.match(renderFallbackRoutes, /legacy-route-surface/);
  assert.match(renderFallbackRoutes, /non-primary-legacy-route-examples/);
  assert.match(renderFallbackRoutes, /legacy-route-examples/);
  assert.match(renderFallbackRoutes, /dataset\.primaryRouteSurface\s*=\s*"false"/);
  assert.match(renderFallbackRoutes, /non-primary-legacy-route-example/);
  assert.doesNotMatch(renderFallbackRoutes, /routeResults\.appendChild\(card\)/);
});

test("static route surface guardrail documents default-not-absolute product rule", () => {
  assert.match(guardrailDoc, /Generated\/shared Planner output is the primary route experience/);
  assert.match(guardrailDoc, /guardrails, not immutable rules/i);
  assert.match(guardrailDoc, /Do not create Barcelona static parity/);
  assert.match(guardrailDoc, /older Rome route examples/i);
  assert.match(guardrailDoc, /legacy fallback\/reference examples/i);
});

test("legacy route labels are localized in both product languages", () => {
  const i18nSource = readFileSync(path.join(repoRoot, "server/ui-i18n.js"), "utf8");

  assert.match(i18nSource, /"route\.legacyTitle": "Genererade planner-rutter är den primära ruttvägen"/);
  assert.match(i18nSource, /"route\.legacyTitle": "Generated planner routes are the primary route path"/);
  assert.match(i18nSource, /"route\.legacySummary": "Visa äldre Rome-exempel"/);
  assert.match(i18nSource, /"route\.legacySummary": "Show legacy Rome examples"/);
});
