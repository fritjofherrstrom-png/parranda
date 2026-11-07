"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { mapSchemaOrgEventToRaw } = require("../server/pulse-sources/schema-org-event-provider");
const capturedEvent = require("./fixtures/schema-org-single-date-schedule.json");

// Factual projection of real JSON-LD captured from the source_url on
// 2026-11-06. No prose, images, inferred coordinates or constructed timestamps.
test("a single-date source Schedule owns the timezone of ambiguous floating Event times", () => {
  const raw = mapSchemaOrgEventToRaw(capturedEvent);
  assert.equal(raw.starts_at, "2026-11-06T19:59:00.000Z");
  assert.equal(raw.ends_at, "2026-11-06T22:59:00.000Z");
  assert.equal(raw.timezone, "Europe/Copenhagen");
  assert.equal(raw.title, capturedEvent.name);
  assert.equal(raw.source_url, capturedEvent.url);
  assert.equal(raw.lat, undefined, "a citywide event is not a city-center point");
  assert.equal(raw.lng, undefined);
});

test("conflicting explicit Event offsets do not become a confirmed Schedule occurrence", () => {
  const raw = mapSchemaOrgEventToRaw({ ...capturedEvent,
    startDate: "2026-11-06T19:59:00+01:00", endDate: "2026-11-06T22:59:00+01:00" });
  assert.equal(raw.starts_at, undefined);
  assert.equal(raw.ends_at, undefined);
  assert.equal(raw.timezone, undefined);
});

test("a Schedule cannot move an Event to a conflicting source-owned calendar date", () => {
  const raw = mapSchemaOrgEventToRaw({ ...capturedEvent, startDate: "2026-11-05T19:59:00" });
  assert.equal(raw.starts_at, undefined);
  assert.equal(raw.ends_at, undefined);
});

test("a Schedule-only event in another timezone needs no inferred midnight or feed timezone", () => {
  const raw = mapSchemaOrgEventToRaw({ "@type": "MusicEvent", name: "Morning concert",
    url: "https://calendar.example/concert", eventSchedule: [{ "@type": "Schedule",
      startDate: "2026-12-12", endDate: "2026-12-12", startTime: "09:00", endTime: "10:00",
      scheduleTimezone: "Asia/Tokyo" }] });
  assert.equal(raw.starts_at, "2026-12-12T00:00:00.000Z");
  assert.equal(raw.ends_at, "2026-12-12T01:00:00.000Z");
  assert.equal(raw.timezone, "Asia/Tokyo");
});

test("named UTC and fixed-offset IANA aliases remain supported", () => {
  for (const [zone, start, end] of [
    ["UTC", "2026-12-12T09:00:00.000Z", "2026-12-12T10:00:00.000Z"],
    ["Etc/GMT+1", "2026-12-12T10:00:00.000Z", "2026-12-12T11:00:00.000Z"],
  ]) {
    const raw = mapSchemaOrgEventToRaw({ eventSchedule: { "@type": "Schedule",
      startDate: "2026-12-12", endDate: "2026-12-12", startTime: "09:00", endTime: "10:00",
      scheduleTimezone: zone } });
    assert.equal(raw.starts_at, start);
    assert.equal(raw.ends_at, end);
    assert.equal(raw.timezone, zone);
  }
});

test("matching explicit offsets and date-only Event atoms can corroborate a single Schedule", () => {
  for (const dates of [
    { startDate: "2026-11-06T19:59:00Z", endDate: "2026-11-06T23:59:00+01:00" },
    { startDate: "2026-11-06", endDate: "2026-11-06" },
  ]) {
    const raw = mapSchemaOrgEventToRaw({ ...capturedEvent, ...dates });
    assert.equal(raw.starts_at, "2026-11-06T19:59:00.000Z");
    assert.equal(raw.ends_at, "2026-11-06T22:59:00.000Z");
  }
});

const invalidSchedules = [
  ["recurrence frequency", { repeatFrequency: "P1D" }],
  ["recurrence day", { byDay: "https://schema.org/Friday" }],
  ["repeat count", { repeatCount: 2 }],
  ["calendar range", { endDate: "2026-11-07" }],
  ["missing end", { endTime: undefined }],
  ["invalid date", { startDate: "2026-11-31", endDate: "2026-11-31" }],
  ["unknown zone", { scheduleTimezone: "Unverified/Place" }],
  ["numeric offset instead of IANA zone", { scheduleTimezone: "+01:00" }],
  ["wrong type", { "@type": "Place" }],
  ["invalid clock", { startTime: "24:59" }],
  ["reversed clock", { endTime: "19:00" }],
  ["zero duration", { endTime: "20:59" }],
  ["DST gap", { startDate: "2026-03-29", endDate: "2026-03-29", startTime: "02:30", endTime: "03:30" }],
  ["DST fold", { startDate: "2026-10-25", endDate: "2026-10-25", startTime: "02:30", endTime: "03:30" }],
];
for (const [label, changes] of invalidSchedules) {
  test(`a ${label} Schedule cannot invent a confirmed session`, () => {
    const raw = mapSchemaOrgEventToRaw({ ...capturedEvent, startDate: undefined, endDate: undefined,
      eventSchedule: { ...capturedEvent.eventSchedule, ...changes } });
    assert.equal(raw.starts_at, undefined);
    assert.equal(raw.ends_at, undefined);
    assert.equal(raw.timezone, undefined);
  });
}

test("multiple Schedules do not silently select one occurrence", () => {
  const raw = mapSchemaOrgEventToRaw({ ...capturedEvent, startDate: undefined, endDate: undefined,
    eventSchedule: [capturedEvent.eventSchedule, { ...capturedEvent.eventSchedule, startTime: "18:00" }] });
  assert.equal(raw.starts_at, undefined);
  assert.equal(raw.ends_at, undefined);
});

test("an unsupported Schedule leaves existing direct source atoms unchanged", () => {
  const raw = mapSchemaOrgEventToRaw({ ...capturedEvent,
    eventSchedule: { ...capturedEvent.eventSchedule, repeatFrequency: "P1W" } });
  assert.equal(raw.starts_at, capturedEvent.startDate);
  assert.equal(raw.ends_at, capturedEvent.endDate);
  assert.equal(raw.timezone, undefined);
});

test("a Schedule cannot coerce an array into a source-owned local clock", () => {
  const raw = mapSchemaOrgEventToRaw({ ...capturedEvent, startDate: undefined, endDate: undefined,
    eventSchedule: { ...capturedEvent.eventSchedule, startTime: ["20:59"] } });
  assert.equal(raw.starts_at, undefined);
  assert.equal(raw.ends_at, undefined);
});
