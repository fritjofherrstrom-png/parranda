const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scriptPath = path.join(__dirname, "..", "script.js");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

test("route result cleanup removes the old internal result labels", () => {
  assert.doesNotMatch(scriptSource, /Kuraterat stopp i din dag\./);
  assert.doesNotMatch(scriptSource, /Kuraterat stopp i din rutt\./);
  assert.doesNotMatch(scriptSource, /Kuraterat stopp i fallback-läget\./);
  assert.doesNotMatch(scriptSource, /Heuristisk gånglogik/);
  assert.doesNotMatch(scriptSource, /Geo-fit/);
  assert.doesNotMatch(scriptSource, /return "Sedan";/);
});

test("route result cleanup keeps only compact human-facing route signals", () => {
  assert.match(scriptSource, /Bra vid regn/);
  assert.match(scriptSource, /Bra just nu/);
  assert.match(scriptSource, /Lätt att gå/);
  assert.match(scriptSource, /Rundtur/);
  assert.match(scriptSource, /const usefulSignals = routeView\.usefulSignals \|\| \[\];/);
});
