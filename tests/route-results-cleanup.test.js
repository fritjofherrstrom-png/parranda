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
});

test("route result cleanup keeps only compact human-facing route signals", () => {
  assert.match(scriptSource, /Bra vid regn/);
  assert.match(scriptSource, /Bra just nu/);
  assert.match(scriptSource, /Lätt att gå/);
  assert.match(scriptSource, /Rundtur/);
  assert.match(scriptSource, /const usefulSignals = routeView\.usefulSignals \|\| \[\];/);
});
