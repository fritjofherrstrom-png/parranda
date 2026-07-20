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

test("same-day local times use the reviewed timezone while ranges keep daily windows", () => {
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
  assert.deepEqual(range.time_window, {
    kind: "daily",
    starts_on: "2026-07-20",
    ends_on: "2026-07-22",
    local_start: "10:00",
    local_end: "17:00",
    timezone: TIMEZONE,
  });
  assert.equal(range.starts_at, undefined, "a daily range must not become one continuous interval");
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
