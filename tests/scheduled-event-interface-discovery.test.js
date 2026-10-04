"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { inspectEventSourcePage, scoutLocalEventSources } = require("../server/pulse-sources/local-event-source-scout");
const { qualifyDiscoveredSourceProfile } = require("../server/pulse-sources/source-qualification");

// Two verbatim server-rendered cards from the saved worker response, not a
// synthetic supported adapter. See docs/CALENDAR_INTERFACE_DISCOVERY.md.
const html = fs.readFileSync(path.join(__dirname, "fixtures/drupal-scheduled-event-cards.html"), "utf8");
const seed = { url: "https://destination.example/nl/agenda/evenementen", family: "official_tourism_calendar", trust_tier: "official" };
const context = { anchor: { lat: 51.05, lng: 3.72 }, bounds: [3.5, 50.9, 3.9, 51.2] };
function inspect(body) { return inspectEventSourcePage({ seed, html: body, context }); }

test("unsupported schedule ranges survive discovery, never qualified", async () => {
  const result = inspect(html.replaceAll("4 oktober 2026", "4 oktober 2026 tot 5 oktober 2026"));
  assert.deepEqual(result.detected, ["stable_html_needs_adapter"]);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.adapter, "needs_adapter");
  assert.equal(candidate.status, "needs_adapter_or_permission");
  assert.equal(candidate.maps_to_existing_provider, false);
  assert.deepEqual(result.manifest_candidates, []);
  const qualified = await qualifyDiscoveredSourceProfile({
    profile: { source_families: [{ family: seed.family, candidates: [candidate] }] },
    manifests: result.manifest_candidates, anchor: context.anchor,
    collectEvents: async () => { assert.fail("unsupported interface must not be probed"); },
  });
  assert.deepEqual(qualified.qualification.reasons, ["no_probeable_source_candidates"]);
  assert.equal(qualified.qualification.activation_performed, false);
});

test("scheduled-card detection does not join sibling facts or infer support from widgets", () => {
  const variants = [
    html.replaceAll("node--type-event", "node--type-article"),
    html.replaceAll("field--name-field-schedule", "field--name-field-introduction"),
    html.replaceAll("4 oktober 2026", "Every Sunday"),
    html.replace(/<h3\b[\s\S]*?<\/h3>/g, ""),
    html.replaceAll('href="/nl/agenda/', 'href="https://other.example/nl/agenda/'),
    html.slice(0, html.indexOf("</article>") + "</article>".length),
    '<article class="node--type-event"><h3><a href="/detail">Concert</a></h3></article>' +
      '<div class="field--name-field-schedule">4 oktober 2026</div>',
    '<script src="https://widgets.example/widgets/layout/calendar.js"></script>',
    `<script type="text/plain">${html}</script>`,
    `<!-- ${html} -->`,
  ];
  for (const body of variants) assert.deepEqual(inspect(body).candidates, []);
});

test("schedule dates cannot leak from nested articles or inert descendants", () => {
  for (const tag of ["article", "script", "style", "template", "noscript"]) {
    const body = ["one", "two"].map((id) =>
      `<article class="node--type-event"><h3><a href="/${id}">${id}</a></h3>` +
      `<div class="field--name-field-schedule"><${tag}>4 oktober 2026</${tag}></div></article>`
    ).join("");
    assert.deepEqual(inspect(body).candidates, [], tag);
  }
});

function nestedDivs(depth, body) {
  return "<div>".repeat(depth) + body + "</div>".repeat(depth);
}

function scheduledCards(schedule) {
  return ["one", "two"].map((id) =>
    `<article class="node--type-event"><h3><a href="/${id}">${id}</a></h3>` +
    `<div class="field--name-field-schedule">${schedule}</div></article>`
  ).join("");
}

test("deep unrelated HTML with an inert event marker fails soft", () => {
  const body = "<!-- node--type-event -->" + nestedDivs(5000, "plain page");
  const result = inspect(body);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.manifest_candidates, []);
});

test("deep event-card schedule text fails soft", () => {
  const result = inspect(scheduledCards(nestedDivs(5000, "4 oktober 2026")));
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.manifest_candidates, []);
});

test("excessive node work fails closed even after finding two valid cards", () => {
  const result = inspect(html + "<i></i>".repeat(25000));
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.manifest_candidates, []);
});

test("excessive depth fails closed even after finding two valid cards", () => {
  const result = inspect(html + nestedDivs(1000, "unrelated"));
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.manifest_candidates, []);
});

test("excessive text work fails closed even after finding two valid cards", () => {
  const result = inspect(html + `<div>${"x".repeat(1100000)}</div>`);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.manifest_candidates, []);
});

test("nested schedule fields and inline dates remain discoverable within bounds", () => {
  const schedule = '<div class="field--name-field-schedule">'.repeat(100) +
    "<span>4</span> oktober <span>2026</span>" + "</div>".repeat(100);
  assert.deepEqual(inspect(scheduledCards(schedule)).detected, ["stable_html_needs_adapter"]);
});

test("robots disallow still prevents scheduled interface inspection", async () => {
  const calls = [];
  const result = await scoutLocalEventSources({ seeds: [seed], ...context,
    fetcher: async (url) => {
      calls.push(url);
      assert.equal(url, "https://destination.example/robots.txt");
      return { ok: true, status: 200, headers: { get: () => "text/plain" }, text: async () => "User-agent: *\nDisallow: /nl/agenda/\n" };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.results[0].status, "blocked");
  assert.deepEqual(result.manifest_candidates, []);
});
