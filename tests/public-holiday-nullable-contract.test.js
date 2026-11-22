"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPublicHolidayEventProvider } = require("../server/pulse-sources/public-holiday-event-provider");

// Synthetic facts shaped by HolidayResponse in the official OpenAPI contract:
// https://openholidaysapi.org/swagger/v1/swagger.json
const DATE = "2026-10-28";
function fixture(code, lists = {}) {
  const language = code;
  const country = { isoCode: code, officialLanguages: [language], name: [{ language, text: "Fixture country" }] };
  const holiday = { id: "fixture-national-day", name: [{ language, text: "Fixture national day" }],
    startDate: "2026-10-30", endDate: "2026-10-30", type: "Public", nationwide: true,
    regionalScope: "National", temporalScope: "FullDay", ...lists };
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    if (url === "https://openholidaysapi.org/Countries") return new Response(JSON.stringify([country]));
    if (url.startsWith("https://openholidaysapi.org/Subdivisions?")) return new Response("[]");
    if (url.startsWith("https://openholidaysapi.org/PublicHolidays?")) return new Response(JSON.stringify([holiday]));
    assert.fail("Unexpected fixture transport");
  };
  return { calls, collect: () => createPublicHolidayEventProvider({ anchor: { lat: 49, lng: 3 },
    placeContext: { country_code: code.toLowerCase(), locality: "Fixture district" },
    fetcher, timezoneResolver: () => "Europe/Paris" }).create().collect({ date: DATE }) };
}

test("documented null reference lists retain an explicitly national holiday through the real provider", async () => {
  for (const country of ["FR", "DE"]) {
    const control = fixture(country, { subdivisions: [], groups: [], tags: [] });
    const expected = await control.collect();
    assert.equal(expected.collection_status.status, "ok", "array-shaped positive control");
    const nullable = fixture(country, { subdivisions: null, groups: null, tags: null });
    const actual = await nullable.collect();
    assert.equal(actual.collection_status.status, "ok", "documented null lists are not invalid source payloads");
    assert.deepEqual(actual.time_sensitive_events, expected.time_sensitive_events);
    assert.equal(nullable.calls.length, control.calls.length, "no extra requests");
    assert.equal(actual.time_sensitive_events[0].calendar_fact.kind, "public_holiday");
    assert.equal(actual.time_sensitive_events[0].lat, undefined, "calendar context never becomes venue geometry");
  }
});

test("omitted optional lists are equivalent, but malformed lists and unproved scope still fail", async () => {
  const omitted = await fixture("DE").collect();
  assert.equal(omitted.collection_status.status, "ok");
  for (const lists of [
    { groups: "" }, { subdivisions: {} }, { tags: false }, { tags: ["Unknown"] },
    { groups: [{ code: "restricted-group" }] },
    { nationwide: false, regionalScope: "Regional", subdivisions: null },
    { nationwide: true, regionalScope: "Regional", subdivisions: null },
  ]) {
    const actual = await fixture("DE", lists).collect();
    assert.equal(actual.collection_status.status, "failed", "null list compatibility never proves group/admin applicability");
  }
});
