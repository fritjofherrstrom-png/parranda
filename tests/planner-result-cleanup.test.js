const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSource = fs.readFileSync(path.join(root, "script.js"), "utf8");

function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function functionSource(name, nextName) {
  const start = scriptSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name} in script.js`);
  const end = nextName ? scriptSource.indexOf(nextName, start) : -1;
  return scriptSource.slice(start, end === -1 ? undefined : end);
}

function plannerDayTemplateMarkup() {
  const start = indexHtml.indexOf('<template id="plannerDayTemplate">');
  const end = indexHtml.indexOf('<template id="activeDayRouteTemplate">', start);
  assert.notEqual(start, -1, "Expected plannerDayTemplate in index.html");
  return indexHtml.slice(start, end === -1 ? undefined : end);
}

test("planner result keeps Why this route compact before stops", () => {
  const markup = plannerDayTemplateMarkup();
  const renderPlannedDays = stripJsComments(functionSource("renderPlannedDays", "function renderRouteResults"));

  assert.match(markup, /<details class="planner-day-why">/);
  assert.match(markup, /<summary class="planner-day-why-summary">/);
  assert.match(markup, /class="planner-day-why-preview"/);
  assert.match(markup, /class="planner-day-stops-block"/);
  assert.ok(
    markup.indexOf('class="planner-day-why"') < markup.indexOf('class="planner-day-stops-block"'),
    "Why summary should remain before stops, but collapsed/compact by default",
  );
  assert.match(renderPlannedDays, /takeLeadSentences\(whyParagraph, 1, 118\)/);
  assert.match(renderPlannedDays, /whyPreview\.textContent = whyPreviewText/);
  assert.doesNotMatch(renderPlannedDays, /takeLeadSentences\(activeDay\.primary_route\.why_recommended \|\| "", 3, 360\)/);
});

test("route live snippets align actionability with the click behavior", () => {
  const markup = plannerDayTemplateMarkup();
  const renderPlannedDays = stripJsComments(functionSource("renderPlannedDays", "function renderRouteResults"));
  const actionTarget = stripJsComments(functionSource("hasRouteLiveEventActionTarget", "function openRouteLiveEventSnippet"));
  const openSnippet = stripJsComments(functionSource("openRouteLiveEventSnippet", "function buildEventDrawerItem"));

  assert.match(markup, /<button class="planner-day-pulse-line" type="button" hidden>/);
  assert.match(renderPlannedDays, /const hasActionableEvent = hasRouteLiveEventActionTarget\(firstLiveEvent\);/);
  assert.match(renderPlannedDays, /pulseLine\.addEventListener\("click", \(\) => openRouteLiveEventSnippet\(firstLiveEvent\)\)/);
  assert.match(renderPlannedDays, /pulseLine\.disabled = !hasActionableEvent/);

  assert.match(actionTarget, /event\.place_query/);
  assert.match(actionTarget, /event\.venue/);
  assert.doesNotMatch(actionTarget, /source_url|buy_url/);
  assert.match(openSnippet, /hasRouteLiveEventActionTarget\(event\)/);
  assert.match(openSnippet, /openPlaceDrawerByQuery\(event\.place_query\)/);
  assert.match(openSnippet, /openPlaceDrawer\(buildEventDrawerItem\(event\)\)/);
  assert.notEqual(scriptSource.indexOf("function buildEventDrawerItem("), -1, "event drawer helper must exist before route snippets call it");
});

test("generic walking-leg boilerplate is not promoted in route result cleanup", () => {
  assert.doesNotMatch(scriptSource, /The walking legs stay even and easy to follow on foot\./);
});
