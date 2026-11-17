/**
 * The Live card's departures board: a time column only for one clock on the
 * shown day. Everything less certain keeps its full sentence.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { eventBoardClock } from "../src/lib/pulse-view.mjs";

const now = new Date("2026-11-17T15:00:00Z"); // 16:00 in Stockholm
const tz = "Europe/Stockholm";

test("a clock on the shown day becomes the time column, in both languages", () => {
  const ev = { title: "Concert", timezone: tz, starts_at: "2026-11-17T19:00:00Z", ends_at: "2026-11-17T21:00:00Z" };
  assert.deepEqual(eventBoardClock(ev, "en", now, "2026-11-17"), { at: "20:00", until: "to 22:00", now: false });
  assert.deepEqual(eventBoardClock(ev, "sv", now, "2026-11-17"), { at: "20:00", until: "till 22:00", now: false });
});

test("a run on now says Now and when it ends", () => {
  const ev = { title: "Exhibition evening", timezone: tz, starts_at: "2026-11-17T14:00:00Z", ends_at: "2026-11-17T19:00:00Z" };
  assert.deepEqual(eventBoardClock(ev, "en", now, null), { at: "Now", until: "to 20:00", now: true });
  assert.deepEqual(eventBoardClock(ev, "sv", now, null), { at: "Nu", until: "till 20:00", now: true });
});

test("a period, a daily schedule, an unconfirmed slot or another day keep their sentence", () => {
  const period = { title: "Season", time_window: { kind: "period", starts_on: "2026-11-01", ends_on: "2026-11-30", local_start: "10:00", local_end: "17:00" } };
  const daily = { title: "Open house", time_window: { kind: "daily", local_start: "11:00", local_end: "17:00" } };
  const unconfirmed = { title: "Jam", timezone: tz, recurrence: { occurrence_status: "unconfirmed" },
    time_window: { kind: "occurrences", dates: ["2026-11-17"], local_start: "20:00", local_end: "23:00" } };
  const tomorrow = { title: "Later", timezone: tz, starts_at: "2026-11-18T19:00:00Z" };
  for (const ev of [period, daily, unconfirmed]) assert.equal(eventBoardClock(ev, "en", now, "2026-11-17"), null, ev.title);
  assert.equal(eventBoardClock(tomorrow, "en", now, "2026-11-17"), null, "a date the card does not show is never dropped");
});
