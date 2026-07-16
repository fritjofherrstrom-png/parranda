/**
 * Pulse view-model — route reality vs Pulse context. A woven live event is a
 * route extension (one full presentation); non-woven events are Pulse-only;
 * ambient signals are derived, never stop-shaped.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  splitRouteStops,
  wovenEventIds,
  pulseEventBuckets,
  clothingAdvice,
  pulseSourceLine,
  eventTiming,
  pulseHealthState,
} from "../src/lib/pulse-view.mjs";

const CORE_A = { id: "a", label: "Museet", type: "museum" };
const CORE_B = { id: "b", label: "Parken", type: "park" };
const WOVEN = { id: "live-event-ev1", label: "Jazz på kajen", is_live_event: true, event_id: "ev1", starts_at: "2026-07-14T19:00:00Z" };

test("splitRouteStops partitions on is_live_event, preserves order, never fabricates", () => {
  const { core, woven } = splitRouteStops([CORE_A, CORE_B, WOVEN]);
  assert.deepEqual(core.map((s) => s.id), ["a", "b"], "woven event absent from numbered core stops");
  assert.deepEqual(woven.map((s) => s.id), ["live-event-ev1"]);
  // Partition property: output is exactly the input, re-grouped.
  assert.equal(core.length + woven.length, 3);
  assert.ok([...core, ...woven].every((s) => [CORE_A, CORE_B, WOVEN].includes(s)), "no fabricated objects");
  // Degenerate inputs.
  assert.deepEqual(splitRouteStops(null), { core: [], woven: [] });
  assert.deepEqual(splitRouteStops([]), { core: [], woven: [] });
});

test("a woven event is excluded from Pulse buckets; non-woven events pass through with source fields", () => {
  const liveEvents = {
    tonight: [
      { id: "ev1", title: "Jazz på kajen", source_label: "Feed", source_url: "https://x/ev1" },
      { id: "ev2", title: "Vernissage", place: "Galleriet", source_url: "https://x/ev2", source_label: "Feed" },
    ],
    this_week: [{ id: "ev3", title: "Loppis" }],
  };
  const buckets = pulseEventBuckets(liveEvents, wovenEventIds([CORE_A, WOVEN]));
  assert.deepEqual(buckets.tonight.map((e) => e.id), ["ev2"], "woven event_id excluded from Pulse");
  assert.deepEqual(buckets.thisWeek.map((e) => e.id), ["ev3"], "non-woven events appear in Pulse only");
  // Trusted view fields survive untouched for source links + venue-local time.
  assert.equal(buckets.tonight[0].source_url, "https://x/ev2");
  assert.equal(buckets.tonight[0].source_label, "Feed");
  // No woven stops → nothing excluded.
  const all = pulseEventBuckets(liveEvents, wovenEventIds([CORE_A, CORE_B]));
  assert.equal(all.tonight.length, 2);
});

test("ambient helpers derive context — they never produce stop-shaped objects", () => {
  const advice = clothingAdvice({ max_temp: 26, condition: "clouds" }, "sv");
  assert.ok(advice && !("lat" in advice) && !("lng" in advice) && !("is_live_event" in advice));
  const { core, woven } = splitRouteStops([CORE_A]);
  // A partition can only re-group input — ambient/weather data has no path in.
  assert.equal(core.length + woven.length, 1);
});

test("clothing guidance follows the trusted-weather thresholds and hides without data", () => {
  assert.equal(clothingAdvice(null, "sv"), null, "no observation → hidden, never invented");
  assert.equal(clothingAdvice({}, "en"), null);

  assert.equal(clothingAdvice({ max_temp: 31 }, "sv").headline, "Svalt och lätt");
  assert.equal(clothingAdvice({ max_temp: 31 }, "sv").advice, "så lätt som möjligt mitt på dagen");
  assert.equal(clothingAdvice({ max_temp: 23 }, "en").headline, "T-shirt + a light layer");
  assert.equal(clothingAdvice({ max_temp: 18 }, "sv").headline, "Skjorta + tunn jacka");
  assert.equal(clothingAdvice({ max_temp: 10 }, "en").headline, "Jacket recommended");
  assert.equal(clothingAdvice({ max_temp: 16 }, "sv").advice, "tunn jacka eller stickat känns smart");

  // Rain suffix from condition OR precipitation probability.
  assert.match(clothingAdvice({ max_temp: 22, condition: "rain" }, "sv").advice, /gärna paraply$/);
  assert.match(clothingAdvice({ max_temp: 22, precipitation_probability_max: 70 }, "en").advice, /umbrella helps$/);
  assert.doesNotMatch(clothingAdvice({ max_temp: 22, precipitation_probability_max: 20 }, "en").advice, /umbrella/);
});

test("source attribution prefers plural feeds, dedupes labels, and hides when unknown", () => {
  assert.equal(pulseSourceLine(null), null);
  assert.equal(pulseSourceLine({ feed: null }), null, "no identity → hidden, never invented");
  assert.equal(pulseSourceLine({ feed: { label: "Helsinki Region Linked Events", license: "CC-BY 4.0" } }), "Helsinki Region Linked Events · CC-BY 4.0");
  assert.equal(
    pulseSourceLine({
      feeds: [{ label: "A" }, { label: "B", license: "CC0" }, { label: "A" }],
      feed: { label: "ignored-when-feeds-present" },
    }),
    "A · B · CC0",
  );
});

test("eventTiming: continuous instants render venue-local, never the viewer's clock", () => {
  const ev = { starts_at: "2026-07-17T17:00:00Z", timezone: "Europe/Helsinki" };
  assert.equal(eventTiming(ev, "sv"), "fre 20:00", "17:00Z is 20:00 in Helsinki (EEST)");
  assert.equal(eventTiming(ev, "en"), "Fri 20:00");
  // time_window.continuous starts_at wins over a missing top-level field.
  assert.equal(eventTiming({ time_window: { kind: "continuous", starts_at: "2026-07-17T17:00:00Z" }, timezone: "Europe/Helsinki" }, "sv"), "fre 20:00");
});

test("eventTiming: daily windows render the LOCAL clock range without timezone re-conversion", () => {
  const ev = {
    starts_on: "2026-07-13",
    ends_on: "2026-08-30",
    time_window: { kind: "daily", starts_on: "2026-07-13", ends_on: "2026-08-30", local_start: "11:00", local_end: "17:00", timezone: "Europe/Stockholm" },
  };
  assert.equal(eventTiming(ev, "sv"), "dagligen 11:00–17:00");
  assert.equal(eventTiming(ev, "en"), "daily 11:00–17:00");
  assert.equal(eventTiming({ time_window: { kind: "daily", local_start: "09:00" } }, "en"), "daily 09:00");
});

test("eventTiming: all_day renders local dates — never a UTC-midnight shift", () => {
  // A single local date stays that date for EVERY viewer timezone.
  assert.equal(eventTiming({ time_window: { kind: "all_day", starts_on: "2026-07-18", ends_on: "2026-07-18" } }, "sv"), "lör 18 juli");
  assert.equal(eventTiming({ time_window: { kind: "all_day", starts_on: "2026-07-18" } }, "en"), "Sat 18 Jul");
  // A range renders both local dates.
  assert.equal(eventTiming({ time_window: { kind: "all_day", starts_on: "2026-07-18", ends_on: "2026-07-19" } }, "sv"), "lör 18 juli – sön 19 juli");
  // Date-only WITHOUT a declared window (starts_on fallback) also renders as a local date.
  assert.equal(eventTiming({ starts_on: "2026-07-18" }, "en"), "Sat 18 Jul");
});

test("eventTiming: unresolved timing renders NOTHING — copy is omitted, never invented", () => {
  assert.equal(eventTiming({}, "sv"), "");
  assert.equal(eventTiming(null, "en"), "");
  assert.equal(eventTiming({ starts_at: "not-a-date" }, "sv"), "");
  assert.equal(eventTiming({ time_window: { kind: "daily" } }, "sv"), "", "daily without local clocks → omitted");
});

test("pulseHealthState maps acquisition health to honest UI states — no raw tokens", () => {
  const empty = { tonight: [], thisWeek: [] };
  const some = { tonight: [{ id: "e1" }], thisWeek: [] };
  const covered = (health, extra = {}) => ({ coverage: "covered", acquisition: { source_health: health }, ...extra });

  assert.equal(pulseHealthState(null, empty), "hidden");
  assert.equal(pulseHealthState({ coverage: "uncovered" }, empty), "uncovered");
  assert.equal(pulseHealthState(covered(null, { pending: true }), empty), "pending");
  assert.equal(
    pulseHealthState(covered({ status: "healthy", result: "empty", reasons: ["no_current_events_found"] }), empty),
    "soft_empty",
    "genuinely quiet calendar",
  );
  assert.equal(
    pulseHealthState(covered({ status: "healthy", result: "empty", reasons: ["all_event_evidence_rejected"] }), empty),
    "rejected_empty",
    "listings existed but none reliable enough",
  );
  assert.equal(pulseHealthState(covered({ status: "unavailable", result: "unknown", reasons: [] }), empty), "unavailable");
  assert.equal(pulseHealthState(covered({ status: "partial", result: "events_found", reasons: [] }), some), "partial", "accepted events + a discreet incompleteness note");
  assert.equal(pulseHealthState(covered({ status: "partial", result: "empty", reasons: [] }), empty), "unavailable", "partial with nothing shown reads as could-not-verify");
  assert.equal(pulseHealthState(covered({ status: "healthy", result: "events_found", reasons: [] }), some), "ok");
  // Legacy response without acquisition: empty-but-covered stays honest soft-empty.
  assert.equal(pulseHealthState({ coverage: "covered" }, empty), "soft_empty");
});
