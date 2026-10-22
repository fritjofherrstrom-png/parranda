"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { mapDiscoveryEvent } = require("../server/pulse-sources/ticketmaster-source-provider");
const { normalizeTimeSensitiveSourceEvent } = require("../server/pulse-sources/time-sensitive-event");
const { selectedDateBucket } = require("../server/place-candidates/event-calendar-date");
const NOW = "2026-10-24T08:00:00Z";

function discoveryEvent(start = {}, end = null) {
  return {
    id: "source-performance",
    name: "Source-owned performance",
    url: "https://www.ticketmaster.com/event/source-performance",
    dates: { start, ...(end ? { end } : {}), timezone: "Europe/Stockholm", status: { code: "onsale" } },
    _embedded: { venues: [{ name: "Published venue", location: { latitude: "59.3326", longitude: "18.0649" } }] },
  };
}

function normalize(event, now = NOW) {
  const mapped = mapDiscoveryEvent(event);
  assert.ok(mapped, "fixture reaches the real Ticketmaster mapper");
  return normalizeTimeSensitiveSourceEvent(mapped, { now, timezone: mapped.timezone });
}

test("Ticketmaster unconfirmed dates never turn placeholders into a selected-day occurrence", () => {
  for (const flag of ["dateTBA", "dateTBD"]) {
    for (const fields of [
      { localDate: "2026-10-25" },
      { localDate: "2026-10-25", localTime: "20:00:00", dateTime: "2026-10-25T19:00:00Z" },
    ]) {
      const event = normalize(discoveryEvent({ ...fields, [flag]: true }));
      assert.equal(event.starts_at, undefined, flag);
      assert.equal(event.starts_on, undefined, flag);
      assert.equal(selectedDateBucket(event, "2026-10-25", NOW), null, flag);
    }
  }
});

test("Ticketmaster confirmed exact starts and date-only precision remain source-owned", () => {
  const exact = normalize(discoveryEvent({ dateTime: "2026-10-25T19:00:00Z", dateTBA: false, dateTBD: false }));
  assert.equal(exact.starts_at, "2026-10-25T19:00:00.000Z");
  assert.equal(selectedDateBucket(exact, "2026-10-25", NOW), "tonight");
  const dateOnly = normalize(discoveryEvent({ localDate: "2026-10-25" }));
  assert.equal(dateOnly.starts_on, "2026-10-25");
  assert.equal(dateOnly.starts_at, undefined);
  assert.equal(dateOnly.time_window.kind, "all_day");
  assert.notEqual(dateOnly.time_window.all_day_explicit, true, "a date is not a whole-day attendance claim");
});

test("Ticketmaster unknown clock flags retain only a separately confirmed local date", () => {
  for (const flag of ["timeTBA", "noSpecificTime"]) {
    const event = normalize(discoveryEvent({
      localDate: "2026-10-25", localTime: "20:00:00", dateTime: "2026-10-25T19:00:00Z", [flag]: true,
    }));
    assert.equal(event.starts_at, undefined, flag);
    assert.equal(event.starts_on, "2026-10-25", flag);
    assert.notEqual(event.time_window.all_day_explicit, true, "unknown time cannot assert all-day access");
    assert.equal(selectedDateBucket(event, "2026-10-25", NOW), "tonight");
    const noDate = normalize(discoveryEvent({ dateTime: "2026-10-25T19:00:00Z", [flag]: true }));
    assert.equal(noDate.starts_at, undefined, flag);
    assert.equal(noDate.starts_on, undefined, "no published local date means no invented date from an uncertain instant");
  }
});

test("Ticketmaster confirmed local date and clock use the event timezone across DST", () => {
  for (const [localDate, expected] of [
    ["2026-10-24", "2026-10-24T18:00:00.000Z"],
    ["2026-10-25", "2026-10-25T19:00:00.000Z"],
  ]) {
    const event = normalize(discoveryEvent({ localDate, localTime: "20:00:00" }));
    assert.equal(event.starts_at, expected);
    assert.equal(selectedDateBucket(event, localDate, NOW), "tonight");
  }
});

test("Ticketmaster ambiguous or nonexistent local clocks never invent a UTC instant", () => {
  for (const localDate of ["2026-03-29", "2026-10-25"]) {
    const event = normalize(discoveryEvent({ localDate, localTime: "02:30:00" }));
    assert.equal(event.starts_at, undefined);
    assert.notEqual(event.time_window?.all_day_explicit, true);
  }
  const exactFold = normalize(discoveryEvent({
    localDate: "2026-10-25", localTime: "02:30:00", dateTime: "2026-10-25T01:30:00Z",
  }));
  assert.equal(exactFold.starts_at, "2026-10-25T01:30:00.000Z", "an explicit source offset resolves the fold");
  const noZone = discoveryEvent({ localDate: "2026-10-25", localTime: "20:00:00" });
  delete noZone.dates.timezone;
  assert.equal(normalize(noZone).starts_at, undefined);
});

test("Ticketmaster preserves an exact published end so an ended show is not still live", () => {
  const now = "2026-10-25T12:00:00Z";
  const event = normalize(discoveryEvent(
    { dateTime: "2026-10-25T08:00:00Z" }, { dateTime: "2026-10-25T09:00:00Z" },
  ), now);
  assert.equal(event.ends_at, "2026-10-25T09:00:00.000Z");
  assert.equal(event.timing_relevance, "stale");
  assert.equal(selectedDateBucket(event, "2026-10-25", now), null);
  const local = normalize(discoveryEvent(
    { localDate: "2026-10-25", localTime: "20:00:00" },
    { localDate: "2026-10-25", localTime: "22:00:00" },
  ));
  assert.equal(local.ends_at, "2026-10-25T21:00:00.000Z");
});

test("Ticketmaster never invents a missing, approximate or uncertain end", () => {
  const start = { dateTime: "2026-10-25T19:00:00Z" };
  assert.equal(normalize(discoveryEvent(start)).ends_at, undefined);
  for (const flag of ["approximate", "dateTBA", "dateTBD", "timeTBA", "noSpecificTime"]) {
    const event = normalize(discoveryEvent(start, {
      dateTime: "2026-10-25T21:00:00Z", localDate: "2026-10-25", localTime: "22:00:00", [flag]: true,
    }));
    assert.equal(event.ends_at, undefined, flag);
  }
  for (const end of [{ localDate: "2026-10-25" }, { dateTime: "2026-10-25T18:00:00Z" }]) {
    assert.equal(normalize(discoveryEvent(start, end)).ends_at, undefined, "no end before start or date-only midnight");
  }
});
