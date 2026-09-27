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
const {
  createSitevisionCalendarProvider,
  extractSitevisionEventDetail,
} = require("../server/pulse-sources/sitevision-calendar-provider");
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

test("captured recurring entries reach Live as ranges, never as the selected day", async () => {
  const { fetcher } = capturedSource("simrishamn");
  const env = buildFullDevEnvironment({}, { cacheDir: os.tmpdir() });
  const registry = resolveEventFeedRegistry(env)
    .filter((source) => source.id === "simrishamn-municipal-calendar");
  const result = await collectAnchorEvents({
    anchor: { lat: 55.5563, lng: 14.35 },
    now: CAPTURED_AT,
    selectedDate: MANIFEST.selected_date,
    registry,
    fetcher,
  });

  // A pin is not an accepted entry: only in-period rows inside the radius count.
  assert.deepEqual(result.tonight.map((event) => [event.title, event.lat, event.route_eligible]), [
    ["Ta hand om dig! Beredskapsdagen 2026", 55.556437, true],
  ]);
  // "Detta evenemang äger rum; varje måndag" is not a stated occurrence list
  // the recurrence grammar reads, so these stay honest ranges: never tonight,
  // never a route stop.
  assert.deepEqual(
    result.this_week.map((event) => [event.title, event.time_window.kind, event.route_eligible]).sort(),
    [
      ["Bénka-dí: Lappa & laga tillsammans", "period", false],
      ["SUMO Robot med Waynes Industrier – Simrishamns space för unga makers", "period", false],
      ["Samtalskafé för gemenskap", "period", false],
      ["Tisdagshäng", "period", false],
    ],
  );
  assert.deepEqual(result.acquisition.rejection_summary, [{ reason: "missing_event_coordinates", count: 6 }]);
});

// Malmö's listing prints a session clock in its own "Tid" spans; a row without
// them is a date-only listing, as for the captured exhibitions. This variant of
// the captured listing drops only the concert row's two "Tid" spans, so the
// captured event state (occasion 26 September, 20:00 – 20:30) is the only clock.
function malmoListingWithoutConcertClock() {
  const source = MANIFEST.sources.find((row) => row.name === "malmo");
  const listing = fs.readFileSync(path.join(DIR, source.listing.file), "utf8");
  const clock = /(id=5\.4968b1201a03e2e5977895[\s\S]*?<span class="dates-kempox">26 september<\/span>)\s*<span class="sr-only dates-kempox">Tid<\/span>\s*<span class="dates-kempox">20:00 – 20:30<\/span>/;
  assert.match(listing, clock);
  return listing.replace(clock, "$1");
}

function malmoWithDateOnlyConcert(overrides = {}) {
  const { source, fetcher } = capturedSource("malmo");
  const listing = malmoListingWithoutConcertClock();
  return {
    source,
    fetcher: async (url) => {
      if (String(url) === source.listing.url) return { ok: true, status: 200, text: async () => listing };
      if (overrides[String(url)] != null) return { ok: true, status: 200, text: async () => overrides[String(url)] };
      return fetcher(url);
    },
  };
}

async function malmoRows(fetcher, listingUrl) {
  const provider = createSitevisionCalendarProvider({
    endpoint: listingUrl,
    status: "active",
    timezone: "Europe/Stockholm",
    limit: 8,
    detailLimit: 8,
    fetcher,
  });
  return (await provider.create({ key: "malmo" }).collect({ date: MANIFEST.selected_date })).time_sensitive_events;
}

test("an event-bound occasion clock replaces a date-only listing day", async () => {
  const { source, fetcher } = malmoWithDateOnlyConcert();
  const concert = (await malmoRows(fetcher, source.listing.url)).find((row) => row.title === "Konsert: Audi Memento");
  assert.equal(concert.time_window.kind, "continuous");
  assert.equal(concert.starts_at, "2026-09-26T18:00:00.000Z");
  assert.equal(concert.ends_at, "2026-09-26T18:30:00.000Z");
});

test("a date-only listing row bound to a clocked occasion leaves Live when the session ends", async () => {
  const { fetcher } = malmoWithDateOnlyConcert();
  const env = buildFullDevEnvironment({}, { cacheDir: os.tmpdir() });
  const registry = resolveEventFeedRegistry(env).filter((source) => source.id === "malmo-municipal-calendar");
  const live = (now) => collectAnchorEvents({
    anchor: { lat: 55.605, lng: 13.0038 },
    now,
    selectedDate: MANIFEST.selected_date,
    registry,
    fetcher,
  });
  const titles = (result) => result.tonight.map((event) => event.title);
  // 19:00 local: the 20:00 session is still ahead.
  assert.ok(titles(await live("2026-09-26T17:00:00.000Z")).includes("Konsert: Audi Memento"));
  // 21:00 local: the session ended at 20:30 and is not listed as today's.
  assert.ok(!titles(await live("2026-09-26T19:00:00.000Z")).includes("Konsert: Audi Memento"));
});

test("the reported Malmö kulturskola occasion keeps its 18:00 – 20:00 clock", async () => {
  // Values reported from a saved detail page that is not in this repository
  // (id 5.4968b1201a03e2e5977230d); only the captured concert page's markup is
  // reused. This pins the adapter's reading of such a state, not a replayed
  // outcome for that page.
  const url = "https://malmo.se/Uppleva-och-gora/Evenemang/Evenemang-i-Malmo/Evenemangssida.html?id=5.4968b1201a03e2e5977230d";
  const concertPage = fs.readFileSync(path.join(DIR, "malmo-4.html"), "utf8");
  const state = {
    id: "5.4968b1201a03e2e5977230d",
    title: "Elevutställning på Malmö kulturskola",
    metadata: {
      dateRange: { date: "2026-09-26", time: "18:00 – 20:00", formatted: "26 september" },
      occasions: [{ date: "2026-09-26", time: "18:00 – 20:00", formatted: "26 september", location: "Malmö Kulturskola", room: "Lilla galleriet" }],
    },
  };
  const page = concertPage
    .replace(/<title>[^<]*<\/title>/, `<title>${state.title}</title>`)
    .replace(/<h1([^>]*)>[^<]*<\/h1>/, `<h1$1>${state.title}</h1>`)
    .replace(/AppRegistry\.registerInitialState\('([^']+)',\{"id":"5\.4968b1201a03e2e5977895"[\s\S]*?\}\);<\/script>/, (_match, key) =>
      `AppRegistry.registerInitialState('${key}',${JSON.stringify(state)});</script>`);
  assert.ok(page.includes(state.id), "the state was replaced");
  const detail = extractSitevisionEventDetail(page, {
    timezone: "Europe/Stockholm",
    expectedDate: "2026-09-26",
    expectedTitle: state.title,
    sourceUrl: url,
  });
  assert.equal(detail.state_timing.time_window.kind, "continuous");
  assert.equal(detail.state_timing.starts_at, "2026-09-26T16:00:00.000Z");
  assert.equal(detail.state_timing.ends_at, "2026-09-26T18:00:00.000Z");
});

test("occasions with different clocks never make a date-only row an all-day fact", async () => {
  const concertUrl = MANIFEST.sources.find((row) => row.name === "malmo").details[4].url;
  const page = fs.readFileSync(path.join(DIR, "malmo-4.html"), "utf8").replace(
    /"occasions":\[\{"date":"2026-09-26","time":"20:00 – 20:30"/,
    '"occasions":[{"date":"2026-09-27","time":"18:00 – 19:00","formatted":"27 september","location":"Folkets Park"},{"date":"2026-09-26","time":"20:00 – 20:30"',
  );
  assert.ok(page.includes('"date":"2026-09-27"'), "a second occasion was added");
  const { source, fetcher } = malmoWithDateOnlyConcert({ [concertUrl]: page });
  const concert = (await malmoRows(fetcher, source.listing.url)).find((row) => row.title === "Konsert: Audi Memento");
  assert.equal(concert.time_window.kind, "period");
  assert.deepEqual([concert.starts_on, concert.ends_on], ["2026-09-26", "2026-09-27"]);
});
