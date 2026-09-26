"use strict";

// Real Sitevision pages captured on 2026-09-26 (see
// tests/fixtures/sitevision-2026-09-26/README.md). They pin down the adapter's
// venue binding on the markup reviewed sources actually publish.

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
  const fetcher = async (url) => {
    const body = pages.get(String(url));
    if (body == null) throw new Error(`not captured: ${url}`);
    return { ok: true, status: 200, text: async () => body };
  };
  return { source, fetcher };
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

test("captured weekday rules after the calendar's lead-in become exactly the stated days", async () => {
  const rows = Object.fromEntries((await capturedRows("simrishamn")).map((row) => [row.title, row]));
  const expectDays = (title, from, to, weekdays, clock) => {
    const window = rows[title].time_window;
    assert.equal(window.kind, "occurrences", title);
    assert.deepEqual(window.dates, datesOn(from, to, weekdays), title);
    assert.deepEqual([window.local_start, window.local_end], clock, title);
  };
  // "7 september–17 december, 13.00–14.30" + "Detta evenemang äger rum; varje måndag och torsdag"
  expectDays("Samtalskafé för gemenskap", "2026-09-07", "2026-12-17", [1, 4], ["13:00", "14:30"]);
  // "24 augusti–7 december, 17.00–18.30" + "…; varje måndag"
  expectDays("Bénka-dí: Lappa & laga tillsammans", "2026-08-24", "2026-12-07", [1], ["17:00", "18:30"]);
  // "8 september–17 november, 14.00–16.00" + "…; varje tisdag"
  expectDays("Tisdagshäng", "2026-09-08", "2026-11-17", [2], ["14:00", "16:00"]);
  // "…; varannan; tisdag": the source never says which weeks, so no phase is
  // taken from the range's first Tuesday.
  const alternate = rows["SUMO Robot med Waynes Industrier – Simrishamns space för unga makers"].time_window;
  assert.equal(alternate.kind, "period");
  assert.deepEqual([alternate.starts_on, alternate.ends_on, alternate.local_start], ["2026-09-15", "2026-12-08", "15:30"]);
  assert.equal(alternate.dates, undefined);
});

test("captured weekly entries reach Live on their stated days, never as the capture day", async () => {
  const result = await capturedLive(MANIFEST.selected_date);

  // A pin is not an accepted entry: only in-period rows inside the radius count.
  assert.deepEqual(result.tonight.map((event) => [event.title, event.lat, event.route_eligible]), [
    ["Ta hand om dig! Beredskapsdagen 2026", 55.556437, true],
  ]);
  // No weekly rule states a Saturday. The dated series are listed among the
  // following seven days; "varannan tisdag" stays a range. Series this long are
  // never route stops, dated or not.
  assert.deepEqual(
    result.this_week.map((event) => [event.title, event.time_window.kind, event.route_eligible]).sort(),
    [
      ["Bénka-dí: Lappa & laga tillsammans", "occurrences", false],
      ["SUMO Robot med Waynes Industrier – Simrishamns space för unga makers", "period", false],
      ["Samtalskafé för gemenskap", "occurrences", false],
      ["Tisdagshäng", "occurrences", false],
    ],
  );
  assert.deepEqual(result.acquisition.rejection_summary, [{ reason: "missing_event_coordinates", count: 6 }]);
});

test("a captured Monday lists its Monday sessions; Tuesday rules wait for Tuesday", async () => {
  const result = await capturedLive("2026-09-28");
  assert.deepEqual(result.tonight.map((event) => [event.title, event.route_eligible]).sort(), [
    ["Bénka-dí: Lappa & laga tillsammans", false],
    ["Samtalskafé för gemenskap", false],
  ]);
  const later = Object.fromEntries(result.this_week.map((event) => [event.title, event.time_window.kind]));
  assert.equal(later["Tisdagshäng"], "occurrences");
  assert.equal(later["SUMO Robot med Waynes Industrier – Simrishamns space för unga makers"], "period");
});

async function capturedLive(selectedDate) {
  const { fetcher } = capturedSource("simrishamn");
  const env = buildFullDevEnvironment({}, { cacheDir: os.tmpdir() });
  const registry = resolveEventFeedRegistry(env)
    .filter((source) => source.id === "simrishamn-municipal-calendar");
  return collectAnchorEvents({
    anchor: { lat: 55.5563, lng: 14.35 },
    now: CAPTURED_AT,
    selectedDate,
    registry,
    fetcher,
  });
}

function datesOn(from, to, weekdays) {
  const dates = [];
  for (let day = Date.parse(`${from}T00:00:00Z`); day <= Date.parse(`${to}T00:00:00Z`); day += 86400000) {
    if (weekdays.includes(new Date(day).getUTCDay())) dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
}
