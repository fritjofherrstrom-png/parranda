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
  pulseBrowseBuckets,
  clothingAdvice,
  pulseSourceLine,
  eventTiming,
  liveSourceFailure,
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

test("browse buckets preserve remaining accepted events and exclude woven occurrences", () => {
  const liveEvents = {
    browse: {
      tonight: { more: [{ id: "ev1" }, { id: "ev4", source_url: "https://x/ev4" }] },
      this_week: { more: [{ id: "ev5" }] },
    },
  };
  const buckets = pulseBrowseBuckets(liveEvents, wovenEventIds([WOVEN]));
  assert.deepEqual(buckets.tonight.map((event) => event.id), ["ev4"]);
  assert.deepEqual(buckets.thisWeek.map((event) => event.id), ["ev5"]);
  assert.equal(buckets.tonight[0].source_url, "https://x/ev4");
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

test("liveSourceFailure reports a finished source failure only — never waiting, empty or shown events", () => {
  const empty = { tonight: [], thisWeek: [] };
  const some = { tonight: [], thisWeek: [{ id: "e1" }] };
  const covered = (health, extra = {}) => ({ coverage: "covered", acquisition: { source_health: health }, ...extra });
  const failed = { status: "unavailable", result: "unknown", selected_source_count: 2, responding_source_count: 0 };
  const partial = { status: "partial", result: "empty", selected_source_count: 3, responding_source_count: 1 };

  assert.deepEqual(liveSourceFailure(covered(failed), empty), { selected: 2, responding: 0 });
  assert.deepEqual(liveSourceFailure(covered(partial), empty), { selected: 3, responding: 1 });
  assert.equal(liveSourceFailure(covered(failed, { pending: true }), empty), null, "waiting is not a failure");
  assert.equal(liveSourceFailure(covered({ ...partial, result: "events_found" }), some), null, "shown events keep the partial note");
  assert.equal(
    liveSourceFailure(covered({ status: "healthy", result: "empty", selected_source_count: 1, responding_source_count: 1 }), empty),
    null,
    "every source responded: an empty answer, not a failure",
  );
  assert.equal(liveSourceFailure(covered({ ...failed, selected_source_count: 0 }), empty), null, "no counts, no claim");
  assert.equal(liveSourceFailure({ coverage: "unavailable", acquisition: { source_health: failed } }, empty), null);
  assert.equal(liveSourceFailure({ coverage: "uncovered" }, empty), null);
  assert.equal(liveSourceFailure(null, empty), null);
});

test("an ONGOING continuous run says it is on now — never its past start weekday", () => {
  // The live-QA bug: an exhibition that opened Thursday 17:00 and runs for days
  // rendered "Thu 17:00" inside a TONIGHT list, which reads as a Thursday event.
  const now = new Date("2026-07-19T18:00:00Z"); // Sunday evening
  const running = {
    title: "Nature of Sound",
    timezone: "Europe/Helsinki",
    time_window: { kind: "continuous", starts_at: "2026-07-16T14:00:00Z", ends_at: "2026-07-26T15:00:00Z" },
  };
  assert.equal(eventTiming(running, "en", now), "on now");
  assert.equal(eventTiming(running, "sv", now), "pågår nu");

  // A run ending on the venue-local day the viewer is in keeps the closing clock
  // — that is a real same-day close, not an implied one.
  const closingToday = {
    timezone: "Europe/Helsinki",
    time_window: { kind: "continuous", starts_at: "2026-07-16T14:00:00Z", ends_at: "2026-07-19T19:00:00Z" },
  };
  const en = eventTiming(closingToday, "en", now);
  assert.match(en, /^on now · until \d{2}:\d{2}$/, `same-day close keeps the clock, got ${en}`);
  assert.match(eventTiming(closingToday, "sv", now), /^pågår nu · till \d{2}:\d{2}$/);
});

test("a continuous run that has NOT started keeps its venue-local start weekday", () => {
  const now = new Date("2026-07-19T18:00:00Z");
  const upcoming = {
    timezone: "Europe/Helsinki",
    time_window: { kind: "continuous", starts_at: "2026-07-23T14:00:00Z", ends_at: "2026-07-26T15:00:00Z" },
  };
  const label = eventTiming(upcoming, "en", now);
  assert.match(label, /Thu/, `an unstarted run still announces its start day, got ${label}`);
  assert.doesNotMatch(label, /on now/);
  // An open-ended run (no end) cannot be proven ongoing → unchanged behaviour.
  const openEnded = { timezone: "Europe/Helsinki", starts_at: "2026-07-16T14:00:00Z" };
  assert.doesNotMatch(eventTiming(openEnded, "en", now), /on now/);
});

test("the ongoing rule never touches the daily / all_day / unresolved branches", () => {
  const now = new Date("2026-07-19T18:00:00Z");
  const daily = { time_window: { kind: "daily", local_start: "10:00", local_end: "18:00" } };
  assert.equal(eventTiming(daily, "en", now), "daily 10:00–18:00");
  const allDay = { time_window: { kind: "all_day", starts_on: "2026-07-19", ends_on: "2026-07-19" } };
  assert.match(eventTiming(allDay, "en", now), /Sun/);
  assert.equal(eventTiming({}, "en", now), "");
});

test("future selected-day Live does not describe an overlapping run as on now", () => {
  const event = { timezone: "Europe/Helsinki", starts_at: "2026-07-19T14:00:00Z", ends_at: "2026-07-21T15:00:00Z" };
  const label = eventTiming(event, "en", new Date("2026-07-19T18:00:00Z"), "2026-07-20");
  assert.doesNotMatch(label, /on now/);
  assert.match(label, /Sun/);
  assert.match(label, /Tue/, "the actual spanning source interval remains visible");
});

// 9 and 16 July 2026 are Thursdays; 10 July is a Friday.
const THURSDAY_SERIES = {
  timezone: "Europe/Stockholm",
  time_window: {
    kind: "occurrences",
    dates: ["2026-07-16", "2026-07-09"],
    starts_on: "2026-07-09",
    ends_on: "2026-07-16",
    local_start: "18:00",
    local_end: "21:00",
    timezone: "Europe/Stockholm",
  },
};

test("eventTiming: listed occurrences name the stated date they are about — never daily", () => {
  const before = new Date("2026-07-08T10:00:00Z");
  const labels = [
    eventTiming(THURSDAY_SERIES, "sv", before, "2026-07-09"),
    eventTiming(THURSDAY_SERIES, "en", before, "2026-07-09"),
    // A selected Friday lists the series only among the following days: its
    // label is the next stated Thursday, never the Friday.
    eventTiming(THURSDAY_SERIES, "sv", before, "2026-07-10"),
  ];
  assert.deepEqual(labels, ["tors 9 juli 18:00–21:00", "Thu 9 Jul 18:00–21:00", "tors 16 juli 18:00–21:00"]);
  for (const label of labels) assert.doesNotMatch(label, /dagligen|daily/);

  // Without a selected date the venue-local today anchors the label, and a
  // session already over today gives way to the next stated date.
  assert.equal(eventTiming(THURSDAY_SERIES, "en", new Date("2026-07-09T12:00:00Z")), "Thu 9 Jul 18:00–21:00");
  assert.equal(eventTiming(THURSDAY_SERIES, "en", new Date("2026-07-09T19:30:00Z")), "Thu 16 Jul 18:00–21:00");
  assert.equal(eventTiming(THURSDAY_SERIES, "en", before, "2026-07-17"), "", "no stated date left → omitted, never invented");
  assert.equal(
    eventTiming({ time_window: { kind: "occurrences", dates: ["2026-07-18"] } }, "sv", before, "2026-07-18"),
    "lör 18 juli",
    "date-only listings stay dates without invented hours",
  );
});

test("eventTiming: a period shows the source range and clock, never daily and never one day", () => {
  const before = new Date("2026-07-08T10:00:00Z");
  const period = {
    timezone: "Europe/Stockholm",
    time_window: { kind: "period", starts_on: "2026-06-25", ends_on: "2026-07-16", local_start: "18:00", local_end: "21:00" },
  };
  assert.equal(eventTiming(period, "sv", before, "2026-07-10"), "tors 25 juni – tors 16 juli · 18:00–21:00 · dagar enligt källan");
  assert.equal(eventTiming(period, "en", before, "2026-07-10"), "Thu 25 Jun – Thu 16 Jul · 18:00–21:00 · days per source");
  assert.equal(
    eventTiming({ time_window: { kind: "period", starts_on: "2026-06-25", ends_on: "2026-07-16" } }, "sv", before),
    "tors 25 juni – tors 16 juli · dagar enligt källan",
  );
  assert.equal(eventTiming({ time_window: { kind: "period" } }, "en", before), "", "no stated range → omitted");
});
