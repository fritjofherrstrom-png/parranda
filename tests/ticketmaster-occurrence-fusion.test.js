"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { collectAnchorEvents, HELSINKI_LINKED_EVENTS_FEED } = require("../server/place-candidates/agnostic-event-supply");
const { fuseTimeSensitiveEvents } = require("../server/pulse-sources/event-fusion");
const { normalizeTimeSensitiveSourceEvent } = require("../server/pulse-sources/time-sensitive-event");
const ANCHOR = { lat: 60.17, lng: 24.94 };
const NOW = "2026-10-24T08:00:00Z";

function discoveryEvent(id, dateTime) {
  return {
    id, name: "Publisher performance", url: `https://www.ticketmaster.com/event/${id}`,
    dates: { start: { dateTime }, timezone: "Europe/Helsinki", status: { code: "onsale" } },
    _embedded: { venues: [{ name: "Published venue", location: { latitude: String(ANCHOR.lat), longitude: String(ANCHOR.lng) } }] },
  };
}

async function collect(events, { municipal = null, selectedDate = "2026-10-25" } = {}) {
  return collectAnchorEvents({ anchor: ANCHOR, now: NOW, selectedDate, globalKey: "fixture-only-key",
    registry: municipal ? [HELSINKI_LINKED_EVENTS_FEED] : [],
    fetcher: async input => ({ ok: true, json: async () => new URL(input).hostname === "app.ticketmaster.com"
      ? { _embedded: { events } } : { data: municipal ? [municipal] : [] } }),
  });
}

function rows(result) { return [...result.tonight, ...result.this_week]; }

test("separately identified Ticketmaster performances survive the fuzzy ten-minute merge window", async () => {
  const result = await collect([discoveryEvent("first", "2026-10-25T18:00:00Z"), discoveryEvent("second", "2026-10-25T18:10:00Z")]);
  assert.equal(result.acquisition.source_health.accepted_event_count, 2);
  assert.deepEqual(result.tonight.map(row => row.id).sort(), ["tm-first", "tm-second"]);
  assert.deepEqual(result.tonight.map(row => row.starts_at).sort(), ["2026-10-25T18:00:00.000Z", "2026-10-25T18:10:00.000Z"]);
});

test("separately identified Ticketmaster performances on adjacent local dates remain in their own buckets", async () => {
  const result = await collect([
    discoveryEvent("before-midnight", "2026-10-24T20:55:00Z"), // Helsinki October 24 23:55
    discoveryEvent("after-midnight", "2026-10-24T21:05:00Z"), // Helsinki October 25 00:05
  ], { selectedDate: "2026-10-24" });
  assert.equal(result.acquisition.source_health.accepted_event_count, 2);
  assert.deepEqual(result.tonight.map(row => row.id), ["tm-before-midnight"]);
  assert.deepEqual(result.this_week.map(row => row.id), ["tm-after-midnight"]);
});

test("distinct Ticketmaster occurrence IDs survive the final Live surface even with unknown clocks", async () => {
  const events = ["first-date-only", "second-date-only"].map(id => {
    const event = discoveryEvent(id, null);
    event.dates.start = { localDate: "2026-10-25", timeTBA: true };
    return event;
  });
  const result = await collect(events);
  assert.equal(result.acquisition.source_health.accepted_event_count, 2);
  assert.deepEqual(result.tonight.map(row => row.id).sort(), ["tm-first-date-only", "tm-second-date-only"]);
  assert.ok(result.tonight.every(row => row.starts_at === null && row.time_window?.all_day_explicit !== true));
});

test("repeated identical Ticketmaster IDs still deduplicate without inventing independence", async () => {
  const raw = discoveryEvent("repeated", "2026-10-25T18:00:00Z");
  const result = await collect([raw, structuredClone(raw)]);
  assert.equal(rows(result).length, 1);
  assert.equal(rows(result)[0].independent_source_count, 1);
  assert.equal(rows(result)[0].source_count, 1);
});

test("Ticketmaster and a municipal description of the same occurrence still corroborate", async () => {
  const raw = discoveryEvent("same-occurrence", "2026-10-25T18:00:00Z");
  const municipal = { id: "municipal-same", name: { en: raw.name }, start_time: raw.dates.start.dateTime,
    location: { name: { en: "Published venue" }, position: { coordinates: [ANCHOR.lng, ANCHOR.lat] } },
    info_url: { en: "https://municipality.example/events/same-occurrence" },
  };
  const result = await collect([raw], { municipal });
  assert.equal(rows(result).length, 1);
  assert.equal(rows(result)[0].independent_source_count, 2);
  assert.ok(rows(result)[0].sources.some(source => source.family === "global_commercial"));
  assert.ok(rows(result)[0].sources.some(source => source.attribution === "Ticketmaster Discovery API"));
});

test("municipal-primary corroboration preserves separate Ticketmaster identities through cached reranking", async () => {
  const { rankCollectedEventsForPreferences } = require("../server/place-candidates/agnostic-event-supply");
  for (const dateOnly of [true, false]) {
    const start = dateOnly ? { localDate: "2026-10-25", timeTBA: true } : { dateTime: "2026-10-25T18:00:00Z" };
    const events = ["corroborated-first", "separate-second"].map(id => {
      const raw = discoveryEvent(id, null);
      raw.dates.start = start;
      return raw;
    });
    const municipal = { id: "municipal-primary", name: { en: events[0].name },
      start_time: dateOnly ? "2026-10-25" : "2026-10-25T18:00:00Z",
      location: { name: { en: "Published venue" }, position: { coordinates: [ANCHOR.lng, ANCHOR.lat] } },
      info_url: { en: "https://municipality.example/events/corroboration" } };
    const result = await collect(events, { municipal });
    assert.equal(result.acquisition.source_health.accepted_event_count, 2);
    for (const served of [result, rankCollectedEventsForPreferences(JSON.parse(JSON.stringify(result)), [], null, NOW)]) {
      assert.equal(served.tonight.length, 2, "a municipal-primary row cannot hide the other provider-attested occurrence");
      const tm = served.tonight.flatMap(row => row.sources.filter(source => source.provider_id === "ticketmaster-global"));
      assert.deepEqual(tm.map(source => source.occurrence_id).sort(), ["corroborated-first", "separate-second"]);
      assert.ok(served.tonight.some(row => row.independent_source_count === 2), "ordinary same-occurrence corroboration survives");
    }
  }
});

test("different API and iCal row IDs from one publisher do not become an automatic occurrence split", () => {
  const normalize = (id, source_provider_id) => normalizeTimeSensitiveSourceEvent({
    id, title: "Publisher performance", source_provider_id, source_identity: "municipality.example",
    starts_at: "2026-10-25T18:00:00Z", source_url: `https://municipality.example/${id}`,
    lat: ANCHOR.lat, lng: ANCHOR.lng, confidence: "medium", source_tier: "official",
  }, { now: NOW, timezone: "Europe/Helsinki" });
  const result = fuseTimeSensitiveEvents([normalize("rest-row", "rest"), normalize("ical-row", "ical")]);
  assert.equal(result.length, 1);
  assert.equal(result[0].independent_source_count, 1);
});
