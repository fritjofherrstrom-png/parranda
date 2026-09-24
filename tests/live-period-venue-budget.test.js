"use strict";

// The trusted venue resolver may place at most a few coordinate-less source
// rows per collection. Those lookups must go to rows that can appear in the
// requested Live period, the selected day first. A row outside the period is
// reported as outside it, never as rejected evidence. Fixture records follow
// the reviewed localized-events API wire shape; this is not provider
// acceptance.

const assert = require("node:assert/strict");
const test = require("node:test");

const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");
const { shapeCollectedLiveEvents } = require("../server/place-candidates/live-event-query");

const ANCHOR = { lat: 55.556, lng: 14.35 };
// Thursday 24 September 2026, 10:00 in Stockholm.
const NOW = "2026-09-24T08:00:00.000Z";
const TODAY = "2026-09-24";
const TOMORROW = "2026-09-25";
const ENDPOINT = "https://calendar.example/api/public-v1/events/";

const SOURCE = Object.freeze({
  id: "reviewed-official-calendar",
  label: "Reviewed official calendar",
  adapter: "localized_events_api",
  endpoint: ENDPOINT,
  bbox: [13.5, 55.3, 14.7, 55.85],
  timezone: "Europe/Stockholm",
  source_language: "sv",
  source_tier: "official",
  confidence: "medium",
  source_family: "official_municipal_calendar",
  source_identity: "calendar.example",
  status: "active",
});

// Venue text and address, but no coordinates: the shape the Wix and most
// Sitevision listing rows have, so every row depends on the venue resolver.
function mapless(id, title, date, venue, { start = "12:00", end = "14:00", endDate = date } = {}) {
  return {
    id,
    title: { sv: title },
    external_website_url: `https://calendar.example/events/${id}`,
    venue_name: venue,
    address: `${venue}, Testhamn`,
    location: null,
    start_date: date,
    end_date: endDate,
    start_time: start,
    end_time: end,
    categories: [],
  };
}

function fetcherFor(records) {
  return async (url) => ({
    ok: true,
    status: 200,
    url: String(url),
    text: async () => JSON.stringify({ count: records.length, results: records }),
  });
}

// Resolves every venue query to its own trusted point inside the radius and
// records which venues were looked up.
function recordingResolver() {
  const venues = [];
  const resolver = async (query) => {
    venues.push(String(query).split(",")[0]);
    return [{
      label: query,
      lat: ANCHOR.lat + venues.length * 0.001,
      lng: ANCHOR.lng,
      confidence: "medium",
      provenance: "trusted_test_resolver",
    }];
  };
  return { resolver, venues };
}

const TODAYS_ROWS = [
  mapless("t1", "Hamnkonsert", TODAY, "Hamnscenen", { start: "19:00", end: "21:00" }),
  mapless("t2", "Loppis på torget", TODAY, "Stortorget", { start: "10:00", end: "14:00" }),
  mapless("t3", "Bokcafé", TODAY, "Biblioteket", { start: "13:00", end: "15:00" }),
  mapless("t4", "Guidad vandring", TODAY, "Kyrkan", { start: "11:00", end: "12:30" }),
];

test("a selected day spends the bounded venue lookups on its own rows, not on another day's", async () => {
  const records = [
    ...TODAYS_ROWS,
    mapless("m1", "Skördefest", TOMORROW, "Gårdsbutiken", { start: "11:00", end: "16:00" }),
    mapless("m2", "Kammarmusik i kapellet", TOMORROW, "Kapellet", { start: "19:00", end: "20:30" }),
  ];
  const { resolver, venues } = recordingResolver();
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    selectedDate: TOMORROW,
    registry: [SOURCE],
    fetcher: fetcherFor(records),
    venueResolver: resolver,
  });

  assert.deepEqual(venues.sort(), ["Gårdsbutiken", "Kapellet"]);
  assert.deepEqual(out.tonight.map((event) => event.id).sort(), ["m1", "m2"]);
  assert.ok(out.tonight.every((event) => event.venue_resolution?.status === "resolved"));
  const health = out.acquisition.source_health;
  assert.equal(health.result, "events_found");
  assert.equal(health.accepted_event_count, 2);
  assert.equal(health.rejected_event_count, 0);
  assert.equal(health.out_of_period_event_count, 4);
  assert.equal(out.acquisition.out_of_period_event_count, 4);
  assert.deepEqual(out.acquisition.rejection_summary, []);
  assert.equal(out.acquisition.venue_resolution.attempted_count, 2);
});

test("rows outside the selected period are reported as outside it, not as rejected evidence", async () => {
  const records = [
    ...TODAYS_ROWS,
    mapless("t5", "Barnteater", TODAY, "Folkets hus", { start: "15:00", end: "16:00" }),
    mapless("t6", "Filmkväll", TODAY, "Biografen", { start: "20:00", end: "22:00" }),
  ];
  const { resolver, venues } = recordingResolver();
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    selectedDate: TOMORROW,
    registry: [SOURCE],
    fetcher: fetcherFor(records),
    venueResolver: resolver,
  });

  assert.deepEqual(venues, [], "no lookup is spent on a row the date gate discards");
  assert.equal(out.tonight.length, 0);
  assert.equal(out.this_week.length, 0);
  const health = out.acquisition.source_health;
  assert.equal(health.status, "healthy");
  assert.equal(health.result, "empty");
  assert.equal(health.normalized_event_count, 6);
  assert.equal(health.rejected_event_count, 0);
  assert.equal(health.out_of_period_event_count, 6);
  assert.ok(health.reasons.includes("no_events_in_requested_period"));
  assert.ok(!health.reasons.includes("all_event_evidence_rejected"));

  // The public Live shape keeps the new count, so the client can tell "nothing
  // listed for this period" from "listings were rejected".
  const shaped = shapeCollectedLiveEvents(out);
  assert.equal(shaped.acquisition.source_health.out_of_period_event_count, 6);
  assert.equal(shaped.acquisition.out_of_period_event_count, 6);
});

test("in-period rows beyond the unchanged lookup cap are still rejected as mapless evidence", async () => {
  const venuesOnTomorrow = ["Gårdsbutiken", "Kapellet", "Hamnscenen", "Stortorget", "Biblioteket", "Kyrkan"];
  const records = venuesOnTomorrow.map((venue, index) => mapless(
    `m${index}`,
    `Morgondagens evenemang ${index}`,
    TOMORROW,
    venue,
    { start: `1${index}:00`, end: `1${index}:45` },
  ));
  const { resolver, venues } = recordingResolver();
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    selectedDate: TOMORROW,
    registry: [SOURCE],
    fetcher: fetcherFor(records),
    venueResolver: resolver,
  });

  assert.equal(venues.length, 4, "the default budget of four lookups is unchanged");
  assert.equal(out.acquisition.venue_resolution.attempted_count, 4);
  assert.equal(out.tonight.length, 4);
  assert.deepEqual(out.acquisition.rejection_summary, [{ reason: "missing_event_coordinates", count: 2 }]);
  assert.equal(out.acquisition.source_health.out_of_period_event_count, 0);
  assert.equal(out.acquisition.source_health.result, "events_found");
});

test("without a selected date, rows beyond the Live horizon do not take a listed row's lookup", async () => {
  const later = "2026-10-20";
  const records = [
    mapless("oct-1", "Oktoberkonsert", later, "Konserthuset", { start: "19:00", end: "21:00" }),
    mapless("oct-2", "Oktobermarknad", later, "Stortorget", { start: "10:00", end: "15:00" }),
    mapless("oct-3", "Oktoberföreläsning", later, "Biblioteket", { start: "18:00", end: "19:00" }),
    mapless("oct-4", "Oktoberteater", later, "Teatern", { start: "19:30", end: "21:30" }),
    {
      ...mapless("today-all-day", "Skördemarknad", TODAY, "Gårdsbutiken"),
      start_time: null,
      end_time: null,
    },
  ];
  const { resolver, venues } = recordingResolver();
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    registry: [SOURCE],
    fetcher: fetcherFor(records),
    venueResolver: resolver,
  });

  assert.deepEqual(venues, ["Gårdsbutiken"]);
  assert.deepEqual(out.this_week.map((event) => event.id), ["today-all-day"]);
  assert.equal(out.acquisition.source_health.out_of_period_event_count, 4);
  assert.equal(out.acquisition.source_health.rejected_event_count, 0);
});

test("an in-period row that fails trusted geometry is still reported as rejected", async () => {
  const records = [
    ...TODAYS_ROWS,
    mapless("m1", "Skördefest", TOMORROW, "Gårdsbutiken", { start: "11:00", end: "16:00" }),
  ];
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    selectedDate: TOMORROW,
    registry: [SOURCE],
    fetcher: fetcherFor(records),
    // The resolver finds nothing trusted inside the radius.
    venueResolver: async () => [],
  });

  assert.equal(out.tonight.length, 0);
  const health = out.acquisition.source_health;
  assert.equal(health.result, "empty");
  assert.equal(health.rejected_event_count, 1);
  assert.equal(health.out_of_period_event_count, 4);
  assert.ok(health.reasons.includes("all_event_evidence_rejected"));
  assert.ok(!health.reasons.includes("no_events_in_requested_period"));
});
