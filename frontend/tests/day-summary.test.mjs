import test from "node:test";
import assert from "node:assert/strict";
import { daySummary } from "../src/lib/day-summary.mjs";

test("the day's facts read as one sentence in both languages", () => {
  assert.equal(daySummary({ stops: 5, live: 1, distance: "3 km", lang: "en" }), "Five stops and a live event, about 3 km on foot.");
  assert.equal(daySummary({ stops: 5, live: 1, distance: "3 km", lang: "sv" }), "Fem stopp och ett liveevent, cirka 3 km till fots.");
  assert.equal(daySummary({ stops: 1, distance: "0.8 km", lang: "en" }), "One stop, about 0.8 km on foot.");
  assert.equal(daySummary({ stops: 1, distance: "0,8 km", lang: "sv" }), "Ett stopp, cirka 0,8 km till fots.");
  assert.equal(daySummary({ stops: 3, live: 2, distance: null, lang: "en" }), "Three stops and two live events.");
  assert.equal(daySummary({ stops: 14, lang: "en" }), "14 stops.");
});

test("a walk under 0.1 km is never called 'about'", () => {
  assert.equal(daySummary({ stops: 2, distance: "< 0.1 km", lang: "en" }), "Two stops, < 0.1 km on foot.");
});

test("a day on the landing is a station: when, then what it holds", async () => {
  const { dayStationLine } = await import("../src/lib/day-summary.mjs");
  const stops = (n, live = 0) => ({ days: [{ primary_route: { main_stops: [
    ...Array.from({ length: n }, (_, i) => ({ id: `s${i}` })),
    ...Array.from({ length: live }, (_, i) => ({ id: `l${i}`, is_live_event: true })),
  ] } }] });
  const evening = new Date(2026, 10, 16, 19, 0);
  assert.equal(dayStationLine({ dateIso: "2026-11-16", safeResponse: stops(5, 1) }, { lang: "en", now: evening }), "Tonight, five stops and a live event");
  assert.equal(dayStationLine({ dateIso: "2026-11-16", safeResponse: stops(5, 1) }, { lang: "sv", now: evening }), "I kväll, fem stopp och ett liveevent");
  assert.equal(dayStationLine({ dateIso: "2026-10-08", safeResponse: stops(3) }, { lang: "en", now: evening, saved: true }), "Saved Thursday 8 October, three stops");
  assert.equal(dayStationLine({ dateIso: "2026-10-08", safeResponse: stops(3) }, { lang: "sv", now: evening, saved: true }), "Sparad torsdag 8 oktober, tre stopp");
  assert.equal(dayStationLine({ dateIso: "2026-11-17", safeResponse: null }, { lang: "en", now: evening }), "Tomorrow");
});
