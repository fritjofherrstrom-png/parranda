"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createOsmMarketEventProvider, mapOsmMarketSchedule, osmMarketFeedForAnchor, CREDIT } = require("../server/pulse-sources/osm-market-event-provider");
const { mapOsmElement, resolveDefaultOpenDataLoader } = require("../server/place-candidates/open-data-loader");
const { collectAnchorEvents, resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const { executeLiveEventQuery } = require("../server/place-candidates/live-event-query");

const ANCHOR = { lat: 48.1173, lng: -1.6778 };
const NOW = "2026-07-20T06:00:00Z";
function place(tags = {}, overrides = {}) {
  return { ...mapOsmElement({ type: "node", id: 42, lat: ANCHOR.lat, lon: ANCHOR.lng,
    tags: { name: "Marché associatif", amenity: "marketplace", opening_hours: "Mo,Th 09:00-13:00", ...tags } }), ...overrides };
}
function loaded(places = [place()], status = `loaded:${places.length}`, error = null) {
  return Object.assign(places, { loader_status: status, loader_error: error });
}
const map = (value, options = {}) => mapOsmMarketSchedule(value, { reference: "2026-07-20", anchor: ANCHOR, ...options });
function provider(options = {}) {
  return createOsmMarketEventProvider({ anchor: ANCHOR, loader: async () => loaded(), ...options }).create();
}

test("OSM mapping preserves marketplace versus indoor hall facts and the existing loader seam", () => {
  assert.equal(place().osm_marketplace, true);
  assert.equal(place({ indoor: "yes" }).osm_market_hall, true);
  assert.equal(place({ building: "marketplace" }).osm_market_hall, true);
  assert.equal(place({ amenity: "cafe" }).osm_marketplace, undefined);
  assert.equal(resolveDefaultOpenDataLoader({}), null);
  const loader = resolveDefaultOpenDataLoader({ PARRANDA_OPEN_DATA_LOADER: "enabled" });
  assert.equal(loader.loadOsmPlaces, loader, "ordinary OSM-only deployment shares its actual cached loader");
});

test("source weekdays project only stated dates, preserve local clocks/geometry/credits and remain unconfirmed", () => {
  const [row] = map(place());
  assert.equal(row.title, "Marché associatif");
  assert.equal(row.lat, ANCHOR.lat);
  assert.equal(row.source_url, "https://www.openstreetmap.org/node/42");
  assert.equal(row.provenance.attribution, CREDIT);
  assert.equal(row.timezone, "Europe/Paris");
  assert.deepEqual(row.time_window.dates, ["2026-07-20", "2026-07-23", "2026-07-27"]);
  assert.equal(row.time_window.local_start, "09:00");
  assert.equal(row.time_window.local_end, "13:00");
  assert.equal(row.recurrence.occurrence_status, "unconfirmed");
  assert.equal(row.starts_at, undefined, "projected schedule is not a provider-confirmed instant");
});

test("multiple explicit weekly sessions keep separate stable identities and avoid intervening days", () => {
  const rows = map(place({ opening_hours: "Mo 09:00-12:00,14:00-16:00; Th 08:00-11:00" }));
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(row => row.id)).size, 3);
  assert.deepEqual(rows.find(row => row.time_window.local_start === "08:00").time_window.dates, ["2026-07-23"]);
});

test("daily/hall, seasonal, exception, overlapping and unsupported overnight schedules do not become weekly events", () => {
  for (const opening_hours of ["24/7", "09:00-13:00", "Mo-Su 09:00-13:00", "Mo 22:00-02:00",
    "Mo 09:00-24:00", "Mo 09:00-13:00; PH off", "Jun-Aug Mo 09:00-13:00", "Mo 09:00-13:00; Mo 14:00-16:00",
    'Mo 09:00-13:00 "only in summer"', "Mo 25:00-26:00", "closed"]) {
    assert.deepEqual(map(place({ opening_hours })), [], opening_hours);
  }
  assert.deepEqual(map(place({ indoor: "yes" })), []);
  assert.deepEqual(map(place({ building: "marketplace" })), []);
});

test("actual source identity, active geometry and offline venue timezone are required", () => {
  for (const override of [{ lat: null }, { lat: 0 }, { lat: 99 }, { sources: [] }, { id: "osm-way-42" },
    { operational_status: "inactive" }, { osm_marketplace: false }, { name: "" }, { type: "cafe" }]) {
    assert.deepEqual(map(place({}, override)), [], JSON.stringify(override));
  }
  assert.deepEqual(map(place(), { timezoneResolver: () => null }), []);
  assert.deepEqual(map(place(), { reference: "2026-02-30" }), []);
  const shifted = map(place({}, { lat: -21.1151, lng: 55.5364 }), { anchor: { lat: -21.1151, lng: 55.5364 } });
  assert.equal(shifted[0].timezone, "Indian/Reunion");
});

test("DST fold/gap projected sessions are skipped rather than assigned a guessed UTC clock", () => {
  for (const reference of ["2026-03-29", "2026-10-25"]) {
    const rows = map(place({ opening_hours: "Su 02:30-03:30" }), { reference });
    assert.ok(rows.every(row => !row.time_window.dates.includes(reference)));
  }
});

test("successful empty and failed/missing/stale loader outcomes remain distinct", async () => {
  assert.equal((await provider({ loader: null }).collect()).collection_status.status, "unavailable");
  for (const loader of [async () => [], async () => loaded([], "error_failed_closed"),
    async () => loaded([], "loaded:0", "stale_cache_refresh_failed"), async () => { throw Error("offline"); }]) {
    assert.equal((await provider({ loader }).collect()).collection_status.status, "failed");
  }
  assert.equal((await provider({ loader: async () => loaded([]) }).collect()).collection_status.status, "empty");
  assert.equal((await provider({ loader: async () => loaded([place({ opening_hours: "24/7" })]) }).collect()).collection_status.status, "empty");
});

test("bounded collection times out stuck loaders and reports truncation without claiming coverage", async () => {
  assert.equal((await provider({ timeoutMs: 50, loader: () => new Promise(() => {}) }).collect()).collection_status.reason, "source_timeout");
  const truncated = await provider({ loader: async () => loaded(Array.from({ length: 501 }, () => place())) }).collect({ date: "2026-07-20" });
  assert.equal(truncated.collection_status.status, "failed");
  assert.equal(truncated.collection_status.reason, "source_collection_truncated");
  assert.equal(truncated.time_sensitive_events.length, 1, "duplicate map objects do not become duplicate market rows");
  const many = Array.from({ length: 161 }, (_, index) => place({}, { id: `osm-node-${index + 1}`,
    sources: [{ provider: "osm", url: `https://www.openstreetmap.org/node/${index + 1}` }] }));
  const capped = await provider({ loader: async () => loaded(many), timezoneResolver: () => "Europe/Paris" }).collect({ date: "2026-07-20" });
  assert.equal(capped.collection_status.reason, "source_collection_truncated");
  assert.equal(capped.time_sensitive_events.length, 160);
});

test("public payload cannot create the trusted market loader or select a provider endpoint", async () => {
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" });
  const query = await executeLiveEventQuery({ payload: { scope: "around_place", anchor: ANCHOR,
    provider_url: "https://www.openstreetmap.org/", marketLoader: "enabled", osm_marketplace: true },
    eventSupply: supply, now: NOW });
  assert.equal(query.body.live_events.coverage, "uncovered");
  assert.equal(query.body.route_mutation, false);
  assert.equal(query.body.day_anchor_mutation, false);
});

test("ordinary Live fusion/buckets expose schedule uncertainty and credits without route promotion", async () => {
  const live = await collectAnchorEvents({ anchor: ANCHOR, registry: [osmMarketFeedForAnchor(ANCHOR)],
    marketLoader: async () => loaded(), now: NOW, selectedDate: "2026-07-20" });
  assert.equal(live.tonight.length, 1);
  const row = live.tonight[0];
  assert.equal(row.recurrence.occurrence_status, "unconfirmed");
  assert.equal(row.sources[0].attribution, CREDIT);
  assert.equal(row.route_eligible, false);
  assert.equal(row.source_link_host, "openstreetmap.org");
  assert.equal(row.source_url, "https://www.openstreetmap.org/node/42");
  const next = await collectAnchorEvents({ anchor: ANCHOR, registry: [osmMarketFeedForAnchor(ANCHOR)],
    marketLoader: async () => loaded(), now: NOW, selectedDate: "2026-07-21" });
  assert.equal(next.tonight.length, 0, "Tuesday is not an occurrence");
  assert.equal(next.this_week.length, 1);
});

for (const lang of ["en", "sv"]) test(`${lang} Live period/retry uses the same background map snapshot and preserves day/route`, async () => {
  let reads = 0;
  let demands = 0;
  const producers = [];
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    marketLoader: async () => { reads++; return loaded(); },
    eventCache: createSourceCache({ namespace: `osm-fixture-${lang}`, ttlMs: 60000 }),
    collectEvents: options => { const work = collectAnchorEvents(options); producers.push(work); return work; },
    sourceCatalog: { recordScoutDemand: async () => { demands++; return {}; } },
  });
  const day = { date: "2026-07-20", route: ["a", "b"] };
  const before = JSON.stringify(day);
  for (const time of ["tonight", "this_week"]) {
    const query = () => executeLiveEventQuery({ payload: { scope: "around_place", anchor: ANCHOR,
      selected_date: day.date, time, language: lang, provider_url: "https://injected.invalid/" },
      eventSupply: supply, now: NOW });
    assert.equal((await query()).body.live_events.pending, true);
    await Promise.all(producers); await new Promise(resolve => setImmediate(resolve));
    const warm = await query();
    assert.equal(warm.body.live_events.tonight[0].recurrence.occurrence_status, "unconfirmed");
    assert.equal(warm.body.query.selected_date, day.date);
    assert.equal(warm.body.query.time, time);
    assert.equal(warm.body.route_mutation, false);
    assert.equal(warm.body.day_anchor_mutation, false);
    assert.equal(JSON.stringify(day), before);
  }
  assert.equal(reads, 1);
  assert.ok(demands > 0, "map schedules do not suppress local-source discovery demand");
});
