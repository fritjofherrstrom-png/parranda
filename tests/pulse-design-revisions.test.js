const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { translations, translate } = require("../server/ui-i18n");

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

function pulseEditionMarkup() {
  const start = indexHtml.indexOf('<section id="cityPulseStart"');
  const end = indexHtml.indexOf('<p id="routeFallbackNote"', start);
  assert.notEqual(start, -1, "Expected #cityPulseStart markup in index.html");
  return indexHtml.slice(start, end === -1 ? undefined : end);
}

test("index.html keeps the shared Pulse PR-A/PR-B structure", () => {
  const markup = pulseEditionMarkup();

  assert.match(markup, /class="city-pulse-hero"/);
  assert.match(markup, /class="city-pulse-ambient-row"/);
  assert.match(markup, /id="cityPulseGoldenHourItem"/);
  assert.match(markup, /id="cityPulseGoldenHourValue"/);
  assert.match(markup, /class="city-pulse-today-panel"/);
  assert.match(markup, /id="cityPulseScopeFilters"\s+class="city-pulse-segmented"/);
  assert.match(markup, /id="cityPulseTimeFilters"\s+class="city-pulse-segmented"/);
  assert.match(markup, /id="cityPulseFilters"[^>]*hidden/);
});

test("old Pulse edition markup is not reintroduced", () => {
  const markup = pulseEditionMarkup();
  const scriptWithoutComments = stripJsComments(scriptSource);

  assert.doesNotMatch(markup, /city-pulse-masthead/);
  assert.doesNotMatch(markup, /city-pulse-edition-strip/);
  assert.doesNotMatch(markup, /pulse-group-mark/);
  assert.doesNotMatch(scriptWithoutComments, /\bcreatePulseFilterButton\b/);
  assert.doesNotMatch(scriptWithoutComments, /\bactivePulseLevel\b/);
});

test("golden-hour presentation uses golden-hour semantics, not sunset labels", () => {
  const renderPulse = stripJsComments(functionSource("renderCityPulse", "async function loadCityPulse"));

  assert.match(renderPulse, /cityPulseState\?\.signals/);
  assert.match(renderPulse, /signal\?\.type === "golden_hour"/);
  assert.match(renderPulse, /cityPulseGoldenHourValue\.textContent/);
  assert.match(renderPulse, /t\("pulse\.goldenHour"/);
  assert.doesNotMatch(scriptSource, /pulse\.sunset/);
  assert.doesNotMatch(scriptSource, /cityPulseSunset/);
  assert.doesNotMatch(renderPulse, /Solnedg[aå]ng|Sunset/);
});

test("Pulse card anatomy keeps pitch and action hierarchy stable", () => {
  const createEntry = stripJsComments(functionSource("createPulseEntry", "function renderCityPulse"));

  assert.match(createEntry, /pitch\.className = "pulse-entry-pitch"/);
  assert.match(
    createEntry,
    /const pitchSource = \(item\.editorial_pitch \|\| item\.reason \|\| ""\)\.trim\(\);/,
  );
  const pitchSourceLine = createEntry
    .split("\n")
    .find((line) => line.includes("const pitchSource ="));
  assert.ok(pitchSourceLine);
  assert.doesNotMatch(pitchSourceLine, /item\.blurb|item\.note/);
  assert.match(createEntry, /const hasInternalTarget = hasPulseActionTarget\(item\);/);
  assert.match(createEntry, /detailButton\.className = "ghost-button pulse-action-button"/);
  assert.match(
    createEntry,
    /plannerButton\.className = "primary-button pulse-action-button pulse-action-primary"/,
  );
});

test("Pulse display gates weak placeholders and keeps non-action cards non-clickable", () => {
  const helperSource = stripJsComments(functionSource("hasPulseActionTarget", "function normalizePulseText"));
  const renderPulse = stripJsComments(functionSource("renderCityPulse", "async function loadCityPulse"));

  assert.match(helperSource, /function isPromotablePulseItem/);
  assert.match(helperSource, /isPlaceholderPulseLabel\(title\)/);
  assert.match(helperSource, /live_event_nearby/);
  assert.match(helperSource, /hasUsefulPlace && hasTiming && hasSource/);
  assert.match(helperSource, /item\.official_event_id && getCityPulseEventById\(item\.official_event_id\)/);
  assert.match(renderPulse, /\.filter\(isPromotablePulseItem\)/);
  assert.doesNotMatch(helperSource, /plannerCityKey\s*={2,3}\s*["'](?:rome|barcelona|athens)["']/i);
});

test("Pulse empty state is compact and action-oriented", () => {
  const renderPulse = stripJsComments(functionSource("renderCityPulse", "async function loadCityPulse"));

  assert.match(renderPulse, /pulse-empty-actions/);
  assert.match(renderPulse, /data-pulse-empty-action="all"/);
  assert.match(renderPulse, /data-pulse-empty-action="tonight"/);
  assert.match(renderPulse, /activePulseScope = "all"/);
  assert.match(renderPulse, /activePulseTime = "tonight"/);
  assert.equal(translate("en", "pulse.emptyBody"), "Parranda only shows signals that are clear enough to be useful.");
  assert.equal(translate("sv", "pulse.tryTonight"), "Testa ikväll");
});

test("Pulse rendering path avoids hard-coded city-key branches", () => {
  const createEntry = stripJsComments(functionSource("createPulseEntry", "function renderCityPulse"));
  const renderPulse = stripJsComments(functionSource("renderCityPulse", "async function loadCityPulse"));
  const pulseRenderingSource = `${createEntry}\n${renderPulse}`;

  assert.doesNotMatch(pulseRenderingSource, /\bbarcelona\b/i);
  assert.doesNotMatch(pulseRenderingSource, /plannerCityKey\s*={2,3}\s*["'](?:rome|barcelona)["']/i);
  assert.doesNotMatch(pulseRenderingSource, /activeCityKey\s*={2,3}\s*["'](?:rome|barcelona)["']/i);
});

test("Pulse i18n keeps current city and golden-hour keys in SV and EN", () => {
  assert.equal(translate("sv", "pulse.todayInCity", { city: "Barcelona" }), "Idag i Barcelona");
  assert.equal(translate("en", "pulse.todayInCity", { city: "Barcelona" }), "Today in Barcelona");
  assert.equal(translate("sv", "pulse.goldenHour"), "Gyllene timmen");
  assert.equal(translate("en", "pulse.goldenHour"), "Golden hour");
  assert.equal(translations.sv["pulse.sunset"], undefined);
  assert.equal(translations.en["pulse.sunset"], undefined);
});
