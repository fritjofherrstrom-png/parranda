// isoDateFromOffset must return the VIEWER-LOCAL calendar date. The regression
// this pins: toISOString() derives the UTC date, so a viewer in a UTC+N zone
// got YESTERDAY as "Today" until N o'clock local — and that date drives
// selected-day opening hours and event-weave alignment.
//
// TZ is forced BEFORE any Date use; node --test runs each file in its own
// process, so this cannot leak into other test files. Asia/Tokyo (+09:00, no
// DST) makes the local-vs-UTC split unambiguous even on a UTC CI host.
process.env.TZ = "Asia/Tokyo";

import { test } from "node:test";
import assert from "node:assert/strict";
import { isoDateFromOffset } from "../src/lib/anywhere-payload.mjs";

test("a Tokyo morning is TODAY in Tokyo, not yesterday's UTC date", () => {
  // 2026-07-29 08:00 in Tokyo is still 2026-07-28 23:00 UTC.
  const tokyoMorning = new Date("2026-07-29T08:00:00+09:00");
  assert.equal(isoDateFromOffset(0, tokyoMorning), "2026-07-29");
  assert.equal(isoDateFromOffset(1, tokyoMorning), "2026-07-30");
});

test("local month and year roll over correctly ahead of UTC", () => {
  // 2026-08-01 00:30 in Tokyo is 2026-07-31 15:30 UTC.
  const tokyoNewMonth = new Date("2026-08-01T00:30:00+09:00");
  assert.equal(isoDateFromOffset(0, tokyoNewMonth), "2026-08-01");
  // 2027-01-01 00:30 in Tokyo is 2026-12-31 15:30 UTC.
  const tokyoNewYear = new Date("2027-01-01T00:30:00+09:00");
  assert.equal(isoDateFromOffset(0, tokyoNewYear), "2027-01-01");
});

test("single-digit months and days are zero-padded", () => {
  const early = new Date("2026-03-05T12:00:00+09:00");
  assert.equal(isoDateFromOffset(0, early), "2026-03-05");
});
