"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildEventsUrl,
  createLocalizedEventsApiProvider,
  mapLocalizedEventApiRecord,
} = require("../server/pulse-sources/localized-events-api-provider");

const ENDPOINT = "https://events.example/api/public-v1/events/";
const TIMEZONE = "Europe/Stockholm";

function fixtureRecord(overrides = {}) {
  return {
    id: "event-1",
    title: { sv: "Kväll på kajen", en: "Evening by the quay" },
    external_website_url: "https://organizer.example/evening",
    venue_name: "Kajscenen",
    address: "Kajvägen 1, Stockholm",
    location: { latitude: 59.331, longitude: 18.071 },
    start_date: "2026-07-20",
    end_date: "2026-07-20",
    start_time: null,
    end_time: null,
    modified_at: "2026-07-19T18:00:00+02:00",
    categories: [{ title: "Music", slug: "music", subcategories: [] }],
    ...overrides,
  };
}

function jsonResponse(url, payload) {
  return {
    ok: true,
    status: 200,
    url,
    text: async () => JSON.stringify(payload),
  };
}

test("localized API mapper preserves language, source facts, geometry, and an all-day date", () => {
  const event = mapLocalizedEventApiRecord(fixtureRecord(), {
    timezone: TIMEZONE,
    sourceLanguage: "sv",
  });

  assert.equal(event.title, "Kväll på kajen");
  assert.equal(event.source_language, "sv");
  assert.equal(event.event_language, "sv");
  assert.equal(event.source_url, "https://organizer.example/evening");
  assert.deepEqual(event.time_window, {
    kind: "all_day",
    starts_on: "2026-07-20",
    ends_on: "2026-07-20",
  });
  assert.equal(event.starts_at, undefined);
  assert.equal(event.lat, 59.331);
  assert.equal(event.lng, 18.071);
  assert.deepEqual(event.tags, ["music", "Music"]);
});

test("same-day local times use the reviewed timezone; a clocked range without listed sessions is a period", () => {
  const sameDay = mapLocalizedEventApiRecord(fixtureRecord({
    start_time: "18:00:00",
    end_time: "21:00:00",
  }), { timezone: TIMEZONE, sourceLanguage: "en" });
  assert.equal(sameDay.title, "Evening by the quay");
  assert.equal(sameDay.starts_at, "2026-07-20T16:00:00.000Z");
  assert.equal(sameDay.ends_at, "2026-07-20T19:00:00.000Z");
  assert.equal(sameDay.time_window.kind, "continuous");

  const range = mapLocalizedEventApiRecord(fixtureRecord({
    end_date: "2026-07-22",
    start_time: "10:00:00",
    end_time: "17:00:00",
  }), { timezone: TIMEZONE, sourceLanguage: "sv" });
  // The record states a span and a clock, not that every day carries a session.
  assert.deepEqual(range.time_window, {
    kind: "period",
    starts_on: "2026-07-20",
    ends_on: "2026-07-22",
    local_start: "10:00",
    local_end: "17:00",
    timezone: TIMEZONE,
  });
  assert.equal(range.starts_at, undefined, "a range must not become one continuous interval");
});

test("multi-day records claim only the sessions their schedule lists", () => {
  // 20–26 July 2026; 23 July is a Thursday.
  const map = (overrides) => mapLocalizedEventApiRecord(fixtureRecord({
    end_date: "2026-07-26",
    ...overrides,
  }), { timezone: TIMEZONE, sourceLanguage: "sv" }).time_window;
  const session = (date, start_time = "18:00", end_time = "21:00") => ({ date, start_time, end_time });
  const week = ["20", "21", "22", "23", "24", "25", "26"].map((day) => `2026-07-${day}`);

  assert.deepEqual(map({ schedule: { range: null, dates: [session("2026-07-23")] } }), {
    kind: "occurrences",
    dates: ["2026-07-23"],
    starts_on: "2026-07-23",
    ends_on: "2026-07-23",
    local_start: "18:00",
    local_end: "21:00",
    timezone: TIMEZONE,
  });
  assert.deepEqual(
    map({ schedule: { range: {}, dates: [session("2026-07-23"), session("2026-07-21")] } }).dates,
    ["2026-07-21", "2026-07-23"],
  );
  // Listing every day of the span is itself a daily statement.
  assert.equal(map({ schedule: { dates: week.map((date) => session(date, "10:00", "17:00")) } }).kind, "daily");
  assert.equal(map({ schedule: { dates: week.map((date) => ({ date })) } }).kind, "all_day");
  assert.deepEqual(map({ schedule: { dates: [{ date: "2026-07-21" }, { date: "2026-07-25" }] } }).dates,
    ["2026-07-21", "2026-07-25"], "date-only listings are date facts on the listed days only");

  for (const [name, schedule] of Object.entries({
    outsideSpan: { dates: [session("2026-07-30")] },
    clockConflict: { dates: [session("2026-07-21"), session("2026-07-23", "19:00")] },
    mixedClocks: { dates: [session("2026-07-21"), { date: "2026-07-23" }] },
    // One session's end must never become another session's end.
    partlyMissingEnd: { dates: [session("2026-07-21"), session("2026-07-23", "18:00", null)] },
    splitClocks: { dates: [session("2026-07-21", "18:00", null), session("2026-07-23", null, "21:00")] },
    overnight: { dates: [session("2026-07-21", "22:00", "02:00")] },
    malformedClock: { dates: [session("2026-07-21", "25:00")] },
    overProcessingBound: { dates: Array.from({ length: 401 }, () => session("2026-07-21")) },
  })) {
    assert.equal(map({ schedule }).kind, "period", name);
  }
  // A clock the record itself states is shared by every listed session...
  assert.deepEqual(
    map({ end_time: "21:00", schedule: { dates: [session("2026-07-21"), session("2026-07-23", "18:00", null)] } }),
    {
      kind: "occurrences",
      dates: ["2026-07-21", "2026-07-23"],
      starts_on: "2026-07-21",
      ends_on: "2026-07-23",
      local_start: "18:00",
      local_end: "21:00",
      timezone: TIMEZONE,
    },
  );
  // ...but a valid listed clock must not hide a malformed record clock.
  assert.equal(map({ start_time: "25:00", schedule: { dates: [session("2026-07-23")] } }).kind, "period");
  // More than 60 listed days that are not every day of the span stay a period.
  const everyOtherDay = Array.from({ length: 61 }, (_, index) =>
    session(new Date(Date.UTC(2026, 5, 1 + index * 2)).toISOString().slice(0, 10)));
  assert.equal(map({ end_date: "2026-09-30", schedule: { dates: everyOtherDay } }).kind, "period");
  // No listing: a clocked span is a period; a date-only span stays all-day facts.
  assert.equal(map({ start_time: "10:00", end_time: "17:00" }).kind, "period");
  assert.equal(map({ schedule: { range: { any: "shape" }, dates: [] } }).kind, "all_day");
});

test("provider collection is bounded and returns explicit healthy outcomes", async () => {
  let requestedUrl = null;
  const provider = createLocalizedEventsApiProvider({
    endpoint: ENDPOINT,
    timezone: TIMEZONE,
    sourceLanguage: "sv",
    limit: 25,
    fetcher: async (url) => {
      requestedUrl = String(url);
      return jsonResponse(String(url), { count: 1, results: [fixtureRecord()] });
    },
  });
  const result = await provider.create({ key: "stockholm" }).collect({});

  assert.equal(new URL(requestedUrl).searchParams.get("page"), "1");
  assert.equal(new URL(requestedUrl).searchParams.get("size"), "25");
  assert.equal(result.collection_status.status, "ok");
  assert.equal(result.collection_status.event_rows, 1);
  assert.equal(result.time_sensitive_events[0].title, "Kväll på kajen");
  assert.equal(new URL(buildEventsUrl(ENDPOINT, 12)).searchParams.get("size"), "12");
});

test("one explicit scheduled occurrence retains its source-local clock instead of becoming all-day", () => {
  const event = mapLocalizedEventApiRecord(fixtureRecord({
    schedule: { range: null, dates: [{ date: "2026-07-20", start_time: "18:00", end_time: "23:00" }] },
  }), { timezone: TIMEZONE, sourceLanguage: "sv" });
  assert.equal(event.starts_at, "2026-07-20T16:00:00.000Z");
  assert.equal(event.ends_at, "2026-07-20T21:00:00.000Z");
  assert.equal(event.time_window.kind, "continuous");
  assert.equal(event.id, "event-1");
  assert.equal(event.source_url, "https://organizer.example/evening");
});

test("a scheduled occurrence uses the reviewed timezone, including winter offset", () => {
  const event = mapLocalizedEventApiRecord(fixtureRecord({
    start_date: "2026-12-20", end_date: "2026-12-20",
    schedule: { range: null, dates: [{ date: "2026-12-20", start_time: "18:00", end_time: "23:00" }] },
  }), { timezone: TIMEZONE, sourceLanguage: "sv" });
  assert.equal(event.starts_at, "2026-12-20T17:00:00.000Z");
});

test("single-day schedules fail closed on conflicting dates, clocks or multiple sessions", () => {
  for (const overrides of [
    { schedule: { range: null, dates: [{ date: "2026-07-21", start_time: "18:00", end_time: "23:00" }] } },
    { schedule: { range: null, dates: [{ date: "2026-07-20", start_time: "25:00", end_time: "23:00" }] } },
    { schedule: { range: null, dates: [{ date: "2026-07-20", start_time: "23:00", end_time: "01:00" }] } },
    { start_time: "19:00", schedule: { range: null, dates: [{ date: "2026-07-20", start_time: "18:00", end_time: "23:00" }] } },
    { schedule: { range: null, dates: [{ date: "2026-07-20", start_time: "18:00", end_time: "19:00" }, { date: "2026-07-20", start_time: "21:00", end_time: "23:00" }] } },
  ]) assert.equal(mapLocalizedEventApiRecord(fixtureRecord(overrides), { timezone: TIMEZONE, sourceLanguage: "sv" }), null);
});

test("a singleton schedule rejects malformed clocks instead of repairing or hiding them", () => {
  const schedule = { range: null, dates: [{ date: "2026-07-20", start_time: "18:00", end_time: "23:00" }] };
  for (const field of ["start_time", "end_time"]) {
    for (const invalid of ["18:00:60", "18:00:99", "25:00", "18:60", "invalid", ""]) {
      const occurrence = { ...schedule.dates[0], [field]: invalid };
      assert.equal(mapLocalizedEventApiRecord(fixtureRecord({
        schedule: { range: null, dates: [occurrence] },
      }), { timezone: TIMEZONE, sourceLanguage: "sv" }), null, `scheduled ${field}: ${invalid}`);
      assert.equal(mapLocalizedEventApiRecord(fixtureRecord({
        [field]: invalid, schedule,
      }), { timezone: TIMEZONE, sourceLanguage: "sv" }), null, `flat ${field}: ${invalid}`);
    }
  }
  const valid = mapLocalizedEventApiRecord(fixtureRecord({
    start_time: "18:00:00", end_time: "23:00:00", schedule,
  }), { timezone: TIMEZONE, sourceLanguage: "sv" });
  assert.equal(valid.starts_at, "2026-07-20T16:00:00.000Z");
  assert.equal(valid.ends_at, "2026-07-20T21:00:00.000Z");
  const lastSecond = mapLocalizedEventApiRecord(fixtureRecord({
    schedule: { range: null, dates: [{ date: "2026-07-20", start_time: "18:00:59", end_time: "23:00:59" }] },
  }), { timezone: TIMEZONE, sourceLanguage: "sv" });
  assert.equal(lastSecond.starts_at, valid.starts_at, "valid seconds keep the existing minute precision");
  assert.equal(lastSecond.ends_at, valid.ends_at);
});

test("provider fails closed on cross-origin response URLs and hanging response bodies", async () => {
  const redirected = createLocalizedEventsApiProvider({
    endpoint: ENDPOINT,
    timezone: TIMEZONE,
    fetcher: async () => jsonResponse("https://evil.example/events", { results: [fixtureRecord()] }),
  });
  const redirectResult = await redirected.create({ key: "stockholm" }).collect({});
  assert.equal(redirectResult.collection_status.status, "failed");
  assert.equal(redirectResult.collection_status.reason, "source_redirect_cross_origin");

  const hanging = createLocalizedEventsApiProvider({
    endpoint: ENDPOINT,
    timezone: TIMEZONE,
    timeoutMs: 25,
    fetcher: async (_url, options) => ({
      ok: true,
      status: 200,
      url: ENDPOINT,
      text: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    }),
  });
  const timeoutResult = await hanging.create({ key: "stockholm" }).collect({});
  assert.equal(timeoutResult.collection_status.status, "failed");
  assert.equal(timeoutResult.collection_status.reason, "source_timeout");
});

test("invalid payload rows are failed rather than reported as proven empty", async () => {
  const provider = createLocalizedEventsApiProvider({
    endpoint: ENDPOINT,
    timezone: TIMEZONE,
    fetcher: async (url) => jsonResponse(String(url), { count: 1, results: [{ id: "broken" }] }),
  });
  const result = await provider.create({ key: "stockholm" }).collect({});
  assert.equal(result.collection_status.status, "failed");
  assert.equal(result.collection_status.reason, "source_payload_invalid");

  const malformedJson = createLocalizedEventsApiProvider({
    endpoint: ENDPOINT,
    timezone: TIMEZONE,
    fetcher: async (url) => ({
      ok: true,
      status: 200,
      url: String(url),
      text: async () => "{not-json",
    }),
  });
  const malformedResult = await malformedJson.create({ key: "stockholm" }).collect({});
  assert.equal(malformedResult.collection_status.status, "failed");
  assert.equal(malformedResult.collection_status.reason, "source_payload_invalid");
});
