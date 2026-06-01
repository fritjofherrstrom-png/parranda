const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scriptPath = path.join(__dirname, "..", "script.js");
const scriptSource = fs.readFileSync(scriptPath, "utf8");
const routeResultSlice = scriptSource.slice(
  scriptSource.indexOf("function buildLegSummary"),
  scriptSource.indexOf("function fillGuidePills"),
);

test("route result cleanup removes the old internal result labels", () => {
  assert.doesNotMatch(routeResultSlice, /Kuraterat stopp i din dag\./);
  assert.doesNotMatch(routeResultSlice, /Kuraterat stopp i din rutt\./);
  assert.doesNotMatch(routeResultSlice, /Kuraterat stopp i fallback-läget\./);
  assert.doesNotMatch(routeResultSlice, /Heuristisk gånglogik/);
  assert.doesNotMatch(routeResultSlice, /Geo-fit/);
  assert.doesNotMatch(scriptSource, /return "Sedan";/);
  assert.doesNotMatch(scriptSource, /2 dag\(ar\) klara/);
  assert.doesNotMatch(routeResultSlice, /Benlängderna är överlag rimliga/);
  assert.match(routeResultSlice, /normalizeRouteResultCopy/);
  assert.match(routeResultSlice, /En tydlig rutt/);
  assert.match(routeResultSlice, /benläng\|gångben\|heuristisk routing/);
});

test("route result cleanup keeps only compact human-facing route signals", () => {
  assert.match(scriptSource, /Bra vid regn/);
  assert.match(scriptSource, /Bra just nu/);
  assert.match(scriptSource, /Lätt att gå/);
  assert.match(scriptSource, /Rundtur/);
  assert.match(scriptSource, /const usefulSignals = routeView\.usefulSignals \|\| \[\];/);
});

test("route result day-card presents Your Day header with start context and selected date", () => {
  assert.match(scriptSource, /function buildRouteResultHeading\(cityLabel\) \{/);
  assert.match(scriptSource, /Your day in \$\{cityLabel\}/);
  assert.match(scriptSource, /Din dag i \$\{cityLabel\}/);
  assert.match(scriptSource, /function buildRouteStartContextPill\(snapshot = latestPlannerSnapshot\) \{/);
  assert.match(scriptSource, /Near me/);
  assert.match(scriptSource, /Where I’m staying/);
  assert.match(scriptSource, /Parranda chose/);
  assert.match(scriptSource, /Nära mig/);
  assert.match(scriptSource, /Där jag bor/);
  assert.match(scriptSource, /Parranda valde/);
  assert.match(scriptSource, /planner-day-context-pill/);
  assert.match(scriptSource, /planner-day-date-readout/);
  assert.match(scriptSource, /formatPlannerResultDate/);
});

test("route result day-card uses editorial headings without unsupported live promises", () => {
  const template = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const i18n = fs.readFileSync(path.join(__dirname, "..", "server", "ui-i18n.js"), "utf8");

  assert.match(template, /__PARRANDA_I18N_ROUTE_WHY_CHOSEN__/);
  assert.match(template, /__PARRANDA_I18N_ROUTE_ORDER__/);
  assert.match(i18n, /"route\.whyChosen": "Why this route"/);
  assert.match(i18n, /"route\.routeOrder": "An order that feels right"/);
  assert.match(i18n, /"route\.whyChosen": "Varför den här rutten"/);
  assert.match(i18n, /"route\.routeOrder": "En ordning som känns rätt"/);
  assert.doesNotMatch(template, /__PARRANDA_I18N_ROUTE_LIVE_THAT_FITS__/);
});

test("route result day-card localizes compact meta and stop tag labels", () => {
  const i18n = fs.readFileSync(path.join(__dirname, "..", "server", "ui-i18n.js"), "utf8");

  assert.match(scriptSource, /function formatRouteStopTagSummary\(tags = \[\]\) \{/);
  assert.match(scriptSource, /tagSummary: formatRouteStopTagSummary\(stop\.tags\),/);
  assert.match(scriptSource, /tf\("route\.stopCount", \{ count: stopCount \}/);
  assert.match(i18n, /"route\.stopCount": "\{count\} stopp"/);
  assert.match(i18n, /"route\.stopCount": "\{count\} stops"/);
});
