"use strict";

// Real Sitevision pages captured on 2026-09-26 (see
// tests/fixtures/sitevision-2026-09-26/README.md). They pin down the adapter's
// venue binding and recurrence reading on the markup reviewed sources actually
// publish.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildFullDevEnvironment } = require("../scripts/dev-full");
const { createSitevisionCalendarProvider } = require("../server/pulse-sources/sitevision-calendar-provider");
const {
  collectAnchorEvents,
  resolveEventFeedRegistry,
} = require("../server/place-candidates/agnostic-event-supply");

const DIR = path.join(__dirname, "fixtures", "sitevision-2026-09-26");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
const CAPTURED_AT = "2026-09-26T11:19:21.000Z";
// An organizer's own site: not stored, served as a page without Sitevision markup.
const ORGANIZER_PAGE = "<!DOCTYPE html><html lang=\"sv\"><head><title>Organizer</title></head>" +
  "<body><main><h1>Organizer</h1></main></body></html>";

function capturedSource(name) {
  const source = MANIFEST.sources.find((row) => row.name === name);
  const pages = new Map([[source.listing.url, fs.readFileSync(path.join(DIR, source.listing.file), "utf8")]]);
  for (const detail of source.details) {
    pages.set(detail.url, detail.file ? fs.readFileSync(path.join(DIR, detail.file), "utf8") : ORGANIZER_PAGE);
  }
  // A page outside the capture fails like an unreachable detail page.
  const uncaptured = [];
  const fetcher = async (url) => {
    const body = pages.get(String(url));
    if (body == null) {
      uncaptured.push(String(url));
      throw new Error(`not captured: ${url}`);
    }
    return { ok: true, status: 200, text: async () => body };
  };
  return { source, fetcher, uncaptured };
}

async function capturedRows(name) {
  const { source, fetcher } = capturedSource(name);
  const provider = createSitevisionCalendarProvider({
    endpoint: source.listing.url,
    status: "active",
    timezone: "Europe/Stockholm",
    limit: 8,
    detailLimit: 8,
    fetcher,
  });
  return (await provider.create({ key: name }).collect({ date: MANIFEST.selected_date })).time_sensitive_events;
}

const pinOf = (row) => [row.title, Number.isFinite(row.lat) ? [row.place_context, row.lat, row.lng] : null];

// Live near the Simrishamn anchor for a selected day, at the capture instant.
async function capturedLive(selectedDate) {
  const { fetcher, uncaptured } = capturedSource("simrishamn");
  const env = buildFullDevEnvironment({}, { cacheDir: os.tmpdir() });
  const registry = resolveEventFeedRegistry(env)
    .filter((source) => source.id === "simrishamn-municipal-calendar");
  const result = await collectAnchorEvents({
    anchor: { lat: 55.5563, lng: 14.35 },
    now: CAPTURED_AT,
    selectedDate,
    registry,
    fetcher,
  });
  return { result, uncaptured };
}

// One Live entry: its window kind, the days it states from `from` through
// `through` (a period states none), its clock and its route eligibility.
function liveRow(event, from, through) {
  const window = event.time_window;
  return [
    event.title,
    window.kind,
    window.kind === "occurrences" ? window.dates.filter((date) => date >= from && date <= through) : null,
    `${window.local_start}–${window.local_end}`,
    event.route_eligible,
  ];
}

test("captured Sitevision pages match their provenance manifest", () => {
  for (const source of MANIFEST.sources) {
    for (const entry of [source.listing, ...source.details].filter((row) => row.file)) {
      const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(DIR, entry.file))).digest("hex");
      assert.equal(digest, entry.sha256, entry.file);
    }
  }
});

test("captured legacy detail pages pin only events their own venue block names", async () => {
  // Rows without an "Evenemangsplats" venue block (an editorial location link,
  // an unlabelled address, a heading that differs from the listing) keep no pin.
  assert.deepEqual((await capturedRows("simrishamn")).map(pinOf), [
    ["Mötesplats Rosenborg September", null],
    ["I love you two med Circus I love you", null],
    ["Ta hand om dig! Beredskapsdagen 2026", ["Österlens museum", 55.556437, 14.347752]],
    ["Curatorvisning av utställningen PRE DROM – På väg", null],
    ["Samtalskafé för gemenskap", ["Simrishamns bibliotek", 55.554923, 14.352681]],
    ["Bénka-dí: Lappa & laga tillsammans", ["Ungdomens hus Bénka-dí", 55.554994, 14.352311]],
    ["Tisdagshäng", ["Simrishamns bibliotek", 55.554923, 14.352681]],
    ["SUMO Robot med Waynes Industrier – Simrishamns space för unga makers", ["Simrishamns bibliotek", 55.554923, 14.352681]],
  ]);
});

test("captured event showcase pages pin their events from registered state", async () => {
  assert.deepEqual((await capturedRows("malmo")).map(pinOf), [
    ["Kortfilm och workshop för barn med Malmö Arab Film Festival", ["Oxiebiblioteket", 55.53989365335112, 13.096661728525344]],
    ["Workshop för barn: Kom och måla konstiga löv", ["Folkets Park", 55.59330012820435, 13.014476913261015]],
    ["Workshop: Batikmåleri med Luna Gil", ["Folkets Park", 55.59330012820435, 13.014476913261015]],
    ["Bokklubb: Eternally Yours av Anika Hussain", ["Kulturhyllan", 55.56266437760612, 12.974810603835078]],
    ["Konsert: Audi Memento", ["Folkets Park", 55.59330012820435, 13.014476913261015]],
    ["Danslördag: Är : Grus", null],
    ["Oktoberfest - Mit Skånsk Gefühl", null],
    ["Stockholm Jazz Orchestra: Spelar John Coltrane", null],
  ]);
});

test("captured weekly entries reach Live on their stated days; every other week stays a range", async () => {
  // Saturday 26 September; "this week" runs through Saturday 3 October.
  const { result } = await capturedLive(MANIFEST.selected_date);
  const row = (event) => liveRow(event, "2026-09-26", "2026-10-03");

  // A pin is not an accepted entry: only in-period rows inside the radius count.
  assert.deepEqual(result.tonight.map((event) => [event.title, event.lat, event.route_eligible]), [
    ["Ta hand om dig! Beredskapsdagen 2026", 55.556437, true],
  ]);
  // "Detta evenemang äger rum; varje måndag och torsdag": the lead-in states no
  // day, the rule after it does. "Varannan tisdag" never says which weeks, so
  // that entry stays a range. Every series spans months: Pulse context, never
  // a route stop.
  assert.deepEqual(result.this_week.map(row).sort(), [
    ["Bénka-dí: Lappa & laga tillsammans", "occurrences", ["2026-09-28"], "17:00–18:30", false],
    ["SUMO Robot med Waynes Industrier – Simrishamns space för unga makers", "period", null, "15:30–17:30", false],
    ["Samtalskafé för gemenskap", "occurrences", ["2026-09-28", "2026-10-01"], "13:00–14:30", false],
    ["Tisdagshäng", "occurrences", ["2026-09-29"], "14:00–16:00", false],
  ]);
  assert.deepEqual(result.acquisition.rejection_summary, [{ reason: "missing_event_coordinates", count: 6 }]);
});

test("a selected Monday lists the captured Monday entries; a range never claims it", async () => {
  // Monday 28 September, planned at the capture instant two days earlier.
  const { result, uncaptured } = await capturedLive("2026-09-28");
  const row = (event) => liveRow(event, "2026-09-28", "2026-10-05");

  assert.deepEqual(result.tonight.map(row).sort(), [
    ["Bénka-dí: Lappa & laga tillsammans", "occurrences", ["2026-09-28", "2026-10-05"], "17:00–18:30", false],
    ["Samtalskafé för gemenskap", "occurrences", ["2026-09-28", "2026-10-01", "2026-10-05"], "13:00–14:30", false],
  ]);
  assert.deepEqual(result.this_week.map(row).sort(), [
    ["SUMO Robot med Waynes Industrier – Simrishamns space för unga makers", "period", null, "15:30–17:30", false],
    ["Tisdagshäng", "occurrences", ["2026-09-29"], "14:00–16:00", false],
  ]);
  // Rows that ended before the selected day leave the listing, so three later
  // rows enter the eight-page detail budget. Their pages are not in the
  // capture: they keep their listing ranges without a pin and, like the
  // mapless Mötesplats row, are rejected for missing coordinates.
  assert.deepEqual(uncaptured.map((url) => url.split("/").pop()).sort(), [
    "anhorigcirkel", "benka-di-bakning", "benka-di-pingis",
  ]);
  assert.deepEqual(result.acquisition.rejection_summary, [{ reason: "missing_event_coordinates", count: 4 }]);
});
