/**
 * Pulse view-model — route reality vs Pulse context. A woven live event is a
 * route extension (one full presentation); non-woven events are Pulse-only;
 * ambient signals are derived, never stop-shaped.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { selectableLiveOccurrenceId } from "../src/lib/live-stop-choice.mjs";
import {
  splitRouteStops,
  wovenEventIds,
  pulseEventBuckets,
  pulseBrowseBuckets,
  clothingAdvice,
  pulseSourceLine,
  eventSourceLink,
  eventTiming,
  liveSourceFailure,
  pulseHealthState,
  liveEventRelevance,
  liveHighlightGroups,
  liveTimeState,
  liveTimeGroups,
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

// Filtering a representative id instead of exact members either hides the
// whole programme/series or repeats the woven slot inside its disclosure.
for (const [bucketName, buckets, supply] of [
  ["highlight", pulseEventBuckets, rows => ({ tonight: rows, this_week: rows })],
  ["browse", pulseBrowseBuckets, rows => ({ browse: { tonight: { more: rows }, this_week: { more: rows } } })],
]) for (const [groupName, metadata] of [
  ["source programme", { display_group_kind: "source_program" }],
  ["explicit source series", { source_series_id: "publisher-series" }],
]) for (const wovenId of ["early", "late"]) {
  test(`${bucketName} buckets exclude only the ${wovenId} woven member of a ${groupName}`, () => {
    const early = Object.freeze({ id: "early", title: "Source programme", starts_at: "2026-10-15T08:00:00Z",
      timezone: "Europe/Stockholm", source_url: "https://calendar.example/programme", source_occurrence_id: "provider-early",
      live_choice_eligible: true, occurrence_date: "2026-10-15", live_occurrence_id: `live:2026-10-15:${"a".repeat(32)}` });
    const late = Object.freeze({ id: "late", title: "Source programme", starts_at: "2026-10-15T12:00:00Z",
      timezone: "Europe/Stockholm", source_url: "https://calendar.example/programme", source_occurrence_id: "provider-late",
      live_choice_eligible: true, occurrence_date: "2026-10-15", live_occurrence_id: `live:2026-10-15:${"b".repeat(32)}` });
    const group = Object.freeze({ ...early, ...metadata, highlight_reason: "local_serendipity",
      preference_match: "strong", requested_preferences: ["museums"], matched_preferences: ["museums"],
      partial_preferences: [], occurrences: Object.freeze([early, late]) });
    const unrelated = Object.freeze({ id: "other", title: "Unrelated source event" });
    const input = supply([group, unrelated]);
    const filtered = buckets(input, wovenEventIds([{ ...WOVEN, event_id: wovenId }]));
    const remaining = wovenId === "early" ? late : early;
    for (const rows of [filtered.tonight, filtered.thisWeek]) {
      assert.equal(rows.length, 2, "unwoven programme slots and unrelated events stay visible");
      assert.strictEqual(rows[1], unrelated);
      assert.equal(rows[0].id, remaining.id, "the representative is the first remaining source occurrence");
      assert.equal(rows[0].starts_at, remaining.starts_at);
      assert.equal(rows[0].source_occurrence_id, remaining.source_occurrence_id);
      assert.equal(rows[0].live_occurrence_id, remaining.live_occurrence_id);
      assert.equal(rows[0].highlight_reason, "local_serendipity", "the server's group-level display reason survives");
      assert.equal(rows[0].display_group_kind, metadata.display_group_kind);
      assert.equal(rows[0].source_series_id, metadata.source_series_id);
      assert.deepEqual(liveEventRelevance(rows[0], ["culture"]), { kind: "match", preferences: ["culture"] },
        "server preference fit can belong to the group parent rather than its individual source slots");
      assert.deepEqual(liveHighlightGroups(rows, ["culture"]).picks, [rows[0]], "remaining slots keep the group's supplied highlights placement");
      assert.equal(rows[0].occurrences.length, 1, "one remaining occurrence keeps its disclosure container");
      assert.strictEqual(rows[0].occurrences[0], remaining, "source facts and choice identity remain the exact supplied object");
      assert.equal(selectableLiveOccurrenceId(rows[0], "2026-10-15"), null, "the container cannot duplicate the member's choice");
      assert.equal(selectableLiveOccurrenceId(rows[0].occurrences[0], "2026-10-15"), remaining.live_occurrence_id);
    }
    const unchanged = buckets(input, new Set(["unrelated-woven-id"]));
    assert.strictEqual(unchanged.tonight[0], group, "without a matching woven member the original group passes through");
    assert.strictEqual(unchanged.thisWeek[0], group);
    const allWoven = buckets(input, new Set(["early", "late"]));
    assert.deepEqual(allWoven.tonight, [unrelated], "a group disappears only when all its actual occurrences are woven");
    assert.deepEqual(allWoven.thisWeek, [unrelated]);
  });
}

test("replacing a woven group representative never lends its choice or time metadata to the remaining slot", () => {
  const early = { id: "early", starts_at: "2026-10-15T08:00:00Z", live_choice_eligible: true,
    occurrence_date: "2026-10-15", live_occurrence_id: `live:2026-10-15:${"a".repeat(32)}` };
  const later = { id: "later", title: "Source programme", timezone: "Europe/Stockholm",
    time_window: { kind: "continuous", starts_at: "2026-10-15T12:00:00Z" } };
  const group = { ...early, display_group_kind: "source_program", occurrences: [early, later] };
  for (const rows of [
    pulseEventBuckets({ tonight: [group] }, new Set(["early"])).tonight,
    pulseBrowseBuckets({ browse: { tonight: { more: [group] } } }, new Set(["early"])).tonight,
  ]) {
    assert.equal(rows.length, 1);
    assert.strictEqual(rows[0].occurrences[0], later);
    for (const key of ["starts_at", "live_occurrence_id", "live_choice_eligible", "occurrence_date"]) {
      assert.equal(Object.hasOwn(rows[0], key), false, `absent remaining ${key} cannot come from the woven representative`);
    }
    assert.equal(eventTiming(rows[0], "en", new Date("2026-10-14T08:00:00Z"), "2026-10-15"), "Thu 15 Oct 14:00");
  }
});

test("a group's server-reserved local discovery reason survives excluding one woven member", () => {
  const early = { id: "early" };
  const late = { id: "late" };
  const group = { ...early, source_series_id: "publisher-series", occurrences: [early, late],
    preference_match: "none", requested_preferences: ["museums"], matched_preferences: [], partial_preferences: [],
    highlight_reason: "local_serendipity" };
  for (const rows of [
    pulseEventBuckets({ tonight: [group] }, new Set(["early"])).tonight,
    pulseBrowseBuckets({ browse: { tonight: { more: [group] } } }, new Set(["early"])).tonight,
  ]) {
    assert.deepEqual(liveEventRelevance(rows[0], ["culture"]), { kind: "local_discovery", preferences: [] });
    assert.strictEqual(rows[0].occurrences[0], late, "preserving display metadata never changes the remaining source object");
  }
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

test("a Live source link names its destination host, never the listing feed's label", () => {
  const ev = {
    source_label: "Visit Example",
    source_url: "https://venue.example/events/late-show",
    source_link_kind: "page",
    source_link_host: "venue.example",
  };
  for (const lang of ["sv", "en"]) {
    assert.deepEqual(eventSourceLink(ev, lang), {
      href: "https://venue.example/events/late-show",
      host: "venue.example",
      kind: "page",
      text: "venue.example",
    });
  }
});

test("a site-root source link says it is a homepage, not the event page — in both languages", () => {
  const ev = {
    source_label: "Visit Example",
    source_url: "https://museum.example.com/",
    source_link_kind: "site_home",
    source_link_host: "museum.example.com",
  };
  assert.equal(eventSourceLink(ev, "sv").text, "Startsida: museum.example.com (inte evenemangssidan)");
  assert.equal(eventSourceLink(ev, "en").text, "Homepage: museum.example.com (not the event page)");
  assert.equal(eventSourceLink(ev, "en").href, "https://museum.example.com/", "the URL is passed through unchanged");
});

test("without the server's classification there is no link — the client never guesses", () => {
  const url = "https://museum.example.com/";
  // A day saved before the classification existed.
  assert.equal(eventSourceLink({ source_label: "Visit Example", source_url: url }, "en"), null);
  // Missing host, unknown kind, or a non-http(s) URL whatever the payload claims.
  assert.equal(eventSourceLink({ source_url: url, source_link_kind: "site_home" }, "en"), null);
  assert.equal(eventSourceLink({ source_url: url, source_link_kind: "event_page", source_link_host: "museum.example.com" }, "en"), null);
  assert.equal(eventSourceLink({ source_url: "javascript:alert(1)", source_link_kind: "page", source_link_host: "x" }, "en"), null);
  assert.equal(eventSourceLink({ source_url: "/events/1", source_link_kind: "page", source_link_host: "x" }, "en"), null);
  assert.equal(eventSourceLink({ source_link_kind: "page", source_link_host: "x" }, "en"), null);
  assert.equal(eventSourceLink(null, "en"), null);
});

test("eventTiming: continuous instants render venue-local, never the viewer's clock", () => {
  // Read before the start: a start that has passed with no end says so.
  const before = new Date("2026-07-01T00:00:00Z");
  const ev = { starts_at: "2026-07-17T17:00:00Z", timezone: "Europe/Helsinki" };
  assert.equal(eventTiming(ev, "sv", before), "fre 17 juli 20:00", "17:00Z is 20:00 in Helsinki (EEST)");
  assert.equal(eventTiming(ev, "en", before), "Fri 17 Jul 20:00");
  // time_window.continuous starts_at wins over a missing top-level field.
  assert.equal(eventTiming({ time_window: { kind: "continuous", starts_at: "2026-07-17T17:00:00Z" }, timezone: "Europe/Helsinki" }, "sv", before), "fre 17 juli 20:00");
});

test("eventTiming: a timed row names its date the way dated rows do", () => {
  // 7fb8c10 design-system audit: "FRE 19:00–22:30" sat beside "FRE 16 OKT. 18:30–20:30".
  const timed = { starts_at: "2026-10-16T17:00:00Z", ends_at: "2026-10-16T20:30:00Z", timezone: "Europe/Stockholm" };
  const listed = { time_window: { kind: "occurrences", dates: ["2026-10-16"], local_start: "18:30", local_end: "20:30" }, timezone: "Europe/Stockholm" };
  const now = new Date("2026-10-15T08:00:00Z");
  assert.equal(eventTiming(timed, "sv", now), "fre 16 okt. 19:00–22:30");
  assert.equal(eventTiming(listed, "sv", now), "fre 16 okt. 18:30–20:30");
  assert.equal(eventTiming(timed, "en", now), "Fri 16 Oct 19:00–22:30");
  // Across midnight both ends carry their own date.
  const late = { starts_at: "2026-10-16T20:00:00Z", ends_at: "2026-10-17T01:00:00Z", timezone: "Europe/Stockholm" };
  assert.equal(eventTiming(late, "en", now), "Fri 16 Oct 22:00 – Sat 17 Oct 03:00");
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
  assert.equal(pulseHealthState(covered({ status: "unavailable", result: "events_found", reasons: [] }), some), "partial", "a later-page failure preserves accepted events with an incompleteness note");
  assert.equal(pulseHealthState(covered({ status: "partial", result: "events_found", reasons: [] }), some), "partial", "accepted events + a discreet incompleteness note");
  assert.equal(pulseHealthState(covered({ status: "partial", result: "empty", reasons: [] }), empty), "unavailable", "partial with nothing shown reads as could-not-verify");
  assert.equal(pulseHealthState(covered({ status: "healthy", result: "events_found", reasons: [] }), some), "ok");
  // Legacy response without acquisition: empty-but-covered stays honest soft-empty.
  assert.equal(pulseHealthState({ coverage: "covered" }, empty), "soft_empty");
});

test("a route-woven event cannot turn the Live panel into an empty-calendar claim", () => {
  const empty = { tonight: [], thisWeek: [] };
  const routeEvent = [WOVEN];
  const healthy = { coverage: "covered", tonight: [{ id: "ev1" }], acquisition: { source_health: { status: "healthy", result: "events_found", reasons: [] } } };
  const filtered = pulseEventBuckets(healthy, wovenEventIds(routeEvent));
  assert.deepEqual(filtered.tonight, [], "the route owns the event's only full card");
  assert.equal(pulseHealthState(healthy, filtered, routeEvent), "ok");
  assert.equal(pulseHealthState({ ...healthy, acquisition: { source_health: { status: "partial", result: "events_found", reasons: [] } } }, filtered, routeEvent), "partial");
  assert.equal(pulseHealthState(healthy, empty, []), "soft_empty", "a route without a woven event cannot suppress true emptiness");
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

// Live relevance is read from the server's per-row fit, in canonical intents
// ("museums", "scenic"), and spoken in the Planner's chip keys.
const RANKED_FOR = ["food", "museums", "scenic"];
const PICKS = ["food", "culture", "views"];
const fit = (id, preference_match, extra = {}) => ({
  id,
  preference_match,
  requested_preferences: RANKED_FOR,
  matched_preferences: [],
  partial_preferences: [],
  ...extra,
});

test("Live relevance repeats only what the server established for the current picks", () => {
  assert.deepEqual(
    liveEventRelevance(fit("m", "strong", { matched_preferences: ["scenic", "museums"] }), PICKS),
    { kind: "match", preferences: ["culture", "views"] },
    "chip vocabulary, in the user's pick order",
  );
  assert.deepEqual(
    liveEventRelevance(fit("p", "partial", { partial_preferences: ["food"] }), PICKS),
    { kind: "looser_match", preferences: ["food"] },
  );
  assert.deepEqual(
    liveEventRelevance(fit("d", "none", { highlight_reason: "local_serendipity" }), PICKS),
    { kind: "local_discovery", preferences: [] },
  );
  assert.equal(liveEventRelevance(fit("n", "none"), PICKS), null, "no match means no reason, never an invented one");
});

test("Live relevance never guesses from titles, missing fit, or an inconsistent level", () => {
  assert.equal(liveEventRelevance({ id: "t", title: "Jazz concert and culture night" }, PICKS), null);
  assert.equal(liveEventRelevance(fit("x", "none", { matched_preferences: ["museums"] }), PICKS), null);
  assert.equal(liveEventRelevance(fit("y", "strong", { matched_preferences: ["museums"] }), []), null, "no picks, no claim");
  assert.equal(liveEventRelevance(null, PICKS), null);
});

test("a ranking for other picks keeps only claims that are still true", () => {
  const match = fit("m", "strong", { matched_preferences: ["museums"] });
  assert.equal(liveEventRelevance(match, ["food"]), null, "a match to a pick the user dropped is not claimed");
  assert.deepEqual(liveEventRelevance(match, ["culture", "nightlife"]), { kind: "match", preferences: ["culture"] });

  const discovery = fit("d", "none", { highlight_reason: "local_serendipity" });
  assert.deepEqual(liveEventRelevance(discovery, ["culture"]), { kind: "local_discovery", preferences: [] });
  assert.equal(
    liveEventRelevance(discovery, ["culture", "nightlife"]),
    null,
    "the server never checked the new pick, so 'beyond your picks' is not established",
  );
});

test("Live highlights split into server matches and other rows, keeping server order", () => {
  const rows = [
    fit("plain", "none"),
    fit("match-1", "strong", { matched_preferences: ["museums"] }),
    fit("looser", "partial", { partial_preferences: ["food"] }),
    fit("match-2", "strong", { matched_preferences: ["food"] }),
    fit("discovery", "none", { highlight_reason: "local_serendipity" }),
  ];
  const groups = liveHighlightGroups(rows, PICKS);
  assert.deepEqual(groups.picks.map((row) => row.id), ["match-1", "match-2"]);
  assert.deepEqual(groups.other.map((row) => row.id), ["plain", "looser", "discovery"]);
  assert.ok([...groups.picks, ...groups.other].every((row) => rows.includes(row)), "a partition, never new rows");

  assert.deepEqual(liveHighlightGroups(rows, []).picks, [], "without picks nothing is presented as a pick");
  assert.equal(liveHighlightGroups(rows, []).other.length, rows.length);
  assert.deepEqual(liveHighlightGroups(null, PICKS), { picks: [], other: [] });
});

test('listed occurrence clocks can be ongoing only on the stated venue day with a known end', () => {
  const ev={timezone:'Europe/Stockholm',time_window:{kind:'occurrences',dates:['2026-10-15','2026-10-22'],local_start:'20:00',local_end:'22:00'}};
  const now=new Date('2026-10-15T18:55:00Z');
  assert.equal(eventTiming(ev,'sv',now,'2026-10-15'),'pågår nu · till 22:00');
  assert.equal(eventTiming(ev,'en',now,'2026-10-15'),'on now · until 22:00');
  assert.doesNotMatch(eventTiming(ev,'en',now,'2026-10-22'),/on now/);
  assert.doesNotMatch(eventTiming({...ev,timezone:undefined},'en',now,'2026-10-15'),/on now/);
  assert.doesNotMatch(eventTiming({...ev,time_window:{...ev.time_window,local_end:undefined}},'en',now,'2026-10-15'),/on now/);
  assert.doesNotMatch(eventTiming({...ev,time_window:{...ev.time_window,local_start:'22:00',local_end:'02:00'}},'en',now,'2026-10-15'),/on now/,'do not invent an overnight end date');
  assert.equal(eventTiming(ev,'en',new Date('2026-10-15T20:00:00Z'),'2026-10-15'),'Thu 15 Oct 20:00–22:00','an explicitly browsed past session retains its stated time');
  const unconfirmed={...ev,recurrence:{rule:'Th 20:00-22:00',occurrence_status:'unconfirmed'}};
  assert.equal(eventTiming(unconfirmed,'en',now,'2026-10-15'),'scheduled now · until 22:00','time matching must not upgrade an unconfirmed occurrence');
});

test('explicit all-day facts say all day; date-only fallback and genuine midnight times do not gain precision',()=>{
  const ev={time_window:{kind:'all_day',starts_on:'2026-10-22',ends_on:'2026-10-22',all_day_explicit:true}};
  assert.equal(eventTiming(ev,'en'),'Thu 22 Oct · All day');
  assert.equal(eventTiming(ev,'sv'),'tors 22 okt. · Hela dagen');
  assert.doesNotMatch(eventTiming({starts_at:'2026-10-21T22:00:00Z',timezone:'Europe/Stockholm'},'en'),/All day/);
  assert.equal(eventTiming({starts_on:'2026-10-22'},'en'),'Thu 22 Oct','a bare date does not assert whole-day availability');
});

test('continuous sessions retain a known end before starting and after ending on the selected venue day',()=>{
 const ev={timezone:'Europe/Stockholm',starts_at:'2026-10-15T20:00:00Z',ends_at:'2026-10-15T21:00:00Z'};
 assert.equal(eventTiming(ev,'en',new Date('2026-10-15T19:00:00Z'),'2026-10-15'),'Thu 15 Oct 22:00–23:00');
 assert.equal(eventTiming(ev,'en',new Date('2026-10-15T21:00:00Z'),'2026-10-15'),'Thu 15 Oct 22:00–23:00');
});

// Live at 14:05 in Stockholm on Friday 23 October 2026 (QA, staging): a lunch
// theatre listed "12:00" with no end read as something about to happen.
const QA_NOW = new Date("2026-10-23T12:05:00Z");
const QA_DAY = "2026-10-23";
const STOCKHOLM = "Europe/Stockholm";

test("a passed start with no stated end is neither on now nor over", () => {
  const lunch = { timezone: STOCKHOLM, starts_at: "2026-10-23T10:00:00Z" };
  assert.equal(eventTiming(lunch, "sv", QA_NOW, QA_DAY), "började 12:00 · sluttid okänd");
  assert.equal(eventTiming(lunch, "en", QA_NOW, QA_DAY), "started 12:00 · end time unknown");
  assert.equal(liveTimeState(lunch, QA_NOW, QA_DAY), "started");
  // Started on an earlier day: the start keeps its date.
  const older = { timezone: STOCKHOLM, starts_at: "2026-10-20T16:00:00Z" };
  assert.equal(eventTiming(older, "en", QA_NOW, QA_DAY), "started Tue 20 Oct 18:00 · end time unknown");
  assert.equal(liveTimeState(older, QA_NOW, QA_DAY), "started");
  // A listed session with only a start, already passed today.
  const listed = { timezone: STOCKHOLM, time_window: { kind: "occurrences", dates: [QA_DAY], local_start: "12:00" } };
  assert.equal(eventTiming(listed, "sv", QA_NOW, QA_DAY), "började 12:00 · sluttid okänd");
  assert.equal(liveTimeState(listed, QA_NOW, QA_DAY), "started");
  // Before the start nothing changes.
  const early = new Date("2026-10-23T09:00:00Z");
  assert.equal(eventTiming(lunch, "sv", early, QA_DAY), "fre 23 okt. 12:00");
  assert.equal(liveTimeState(lunch, early, QA_DAY), "later");
});

test("on now needs a stated start and end around now; an unconfirmed schedule is not on now", () => {
  const exhibition = { timezone: STOCKHOLM, starts_at: "2026-10-20T08:00:00Z", ends_at: "2026-10-23T15:00:00Z" };
  assert.equal(liveTimeState(exhibition, QA_NOW, QA_DAY), "now");
  assert.equal(eventTiming(exhibition, "sv", QA_NOW, QA_DAY), "pågår nu · till 17:00");
  const session = { timezone: STOCKHOLM, time_window: { kind: "occurrences", dates: [QA_DAY], local_start: "13:00", local_end: "15:00" } };
  assert.equal(liveTimeState(session, QA_NOW, QA_DAY), "now");
  const scheduled = { ...session, recurrence: { occurrence_status: "unconfirmed" } };
  assert.equal(liveTimeState(scheduled, QA_NOW, QA_DAY), "started", "a schedule match is not evidence it is on");
  const ended = { timezone: STOCKHOLM, starts_at: "2026-10-23T08:00:00Z", ends_at: "2026-10-23T09:00:00Z" };
  assert.equal(liveTimeState(ended, QA_NOW, QA_DAY), "ended");
  const overnight = { timezone: STOCKHOLM, time_window: { kind: "occurrences", dates: [QA_DAY], local_start: "13:00", local_end: "02:00" } };
  assert.equal(liveTimeState(overnight, QA_NOW, QA_DAY), "started", "an end without a date is not invented");
  const noZone = { time_window: { kind: "occurrences", dates: [QA_DAY], local_start: "13:00", local_end: "15:00" } };
  assert.equal(liveTimeState(noZone, QA_NOW, QA_DAY), "timed", "without a venue clock a listed time cannot be placed against now");
});

test("rows that are about the day, not a start, are 'during the day'", () => {
  for (const ev of [
    { time_window: { kind: "all_day", starts_on: QA_DAY, ends_on: QA_DAY, all_day_explicit: true } },
    { starts_on: QA_DAY },
    { time_window: { kind: "period", starts_on: "2026-10-01", ends_on: "2026-11-08" } },
    { time_window: { kind: "daily", local_start: "10:00", local_end: "17:00" } },
    { calendar_fact: { kind: "public_holiday" }, starts_on: QA_DAY },
  ]) assert.equal(liveTimeState(ev, QA_NOW, QA_DAY), "day", JSON.stringify(ev));
  assert.equal(liveTimeState({}, QA_NOW, QA_DAY), "unknown");
  assert.equal(liveTimeState({ starts_at: "not-a-date" }, QA_NOW, QA_DAY), "unknown");
  // Another selected day: clocks are "at set times", never now or later today.
  const concert = { timezone: STOCKHOLM, starts_at: "2026-10-24T17:30:00Z" };
  assert.equal(liveTimeState(concert, QA_NOW, "2026-10-24"), "timed");
});

test("a group that names the day lets its rows give only their clocks; ranges and other dates stay", () => {
  const opts = { omitDate: QA_DAY };
  const concert = { timezone: STOCKHOLM, starts_at: "2026-10-23T17:30:00Z" };
  assert.equal(eventTiming(concert, "sv", QA_NOW, QA_DAY, opts), "19:30");
  assert.equal(eventTiming({ ...concert, ends_at: "2026-10-23T19:00:00Z" }, "en", QA_NOW, QA_DAY, opts), "19:30–21:00");
  const late = { timezone: STOCKHOLM, starts_at: "2026-10-23T20:00:00Z", ends_at: "2026-10-24T01:00:00Z" };
  assert.equal(eventTiming(late, "en", QA_NOW, QA_DAY, opts), "Fri 23 Oct 22:00 – Sat 24 Oct 03:00", "a span over midnight keeps both dates");
  assert.equal(eventTiming({ time_window: { kind: "all_day", starts_on: QA_DAY, ends_on: QA_DAY, all_day_explicit: true } }, "sv", QA_NOW, QA_DAY, opts), "Hela dagen");
  assert.equal(eventTiming({ starts_on: QA_DAY }, "sv", QA_NOW, QA_DAY, opts), "tid ej angiven", "a bare date still does not claim the whole day");
  const period = { time_window: { kind: "period", starts_on: "2026-10-01", ends_on: "2026-11-08", local_start: "10:00", local_end: "17:00" } };
  assert.equal(eventTiming(period, "en", QA_NOW, QA_DAY, opts), "Thu 1 Oct – Sun 8 Nov · 10:00–17:00 · days per source");
  const listed = { timezone: STOCKHOLM, time_window: { kind: "occurrences", dates: [QA_DAY, "2026-10-30"], local_start: "19:00", local_end: "21:00" } };
  assert.equal(eventTiming(listed, "en", QA_NOW, QA_DAY, opts), "19:00–21:00");
  assert.equal(eventTiming(listed, "en", QA_NOW, "2026-10-30", opts), "Fri 30 Oct 19:00–21:00", "another date keeps its date");
  // Without a venue timezone the date cannot be proven equal, so it stays.
  assert.equal(eventTiming({ starts_at: "2026-10-23T17:30:00Z" }, "en", QA_NOW, QA_DAY, opts).includes("23 Oct"), true);
});

test("time groups keep every row, read in order: now, later, day, started, ended, unknown", () => {
  const rows = [
    { title: "Lunch", timezone: STOCKHOLM, starts_at: "2026-10-23T10:00:00Z" },
    { title: "Evening", timezone: STOCKHOLM, starts_at: "2026-10-23T18:00:00Z" },
    { title: "Exhibition", timezone: STOCKHOLM, starts_at: "2026-10-20T08:00:00Z", ends_at: "2026-10-23T15:00:00Z" },
    { title: "Festival", time_window: { kind: "all_day", starts_on: QA_DAY, ends_on: QA_DAY, all_day_explicit: true } },
    { title: "Afternoon", timezone: STOCKHOLM, starts_at: "2026-10-23T14:00:00Z" },
    { title: "Mystery" },
  ];
  const groups = liveTimeGroups(rows, { now: QA_NOW, selectedDate: QA_DAY });
  assert.deepEqual(groups.map((g) => [g.state, g.events.map((e) => e.title)]), [
    ["now", ["Exhibition"]],
    ["later", ["Afternoon", "Evening"]],
    ["day", ["Festival"]],
    ["started", ["Lunch"]],
    ["unknown", ["Mystery"]],
  ]);
  assert.equal(groups.flatMap((g) => g.events).length, rows.length, "nothing is dropped or added");
  // Navigation rows: the event and its listed date are read through accessors.
  const navRows = rows.slice(0, 2).map((event) => ({ event, date: QA_DAY }));
  const byRow = liveTimeGroups(navRows, { now: QA_NOW, eventOf: (r) => r.event, dateOf: (r) => r.date });
  assert.deepEqual(byRow.map((g) => [g.state, g.events.map((r) => r.event.title)]), [["later", ["Evening"]], ["started", ["Lunch"]]]);
  assert.deepEqual(liveTimeGroups(null), []);
});

test("under an On now heading a row says only when it ends", () => {
  const opts = { omitDate: QA_DAY, underOnNow: true };
  const closesToday = { timezone: STOCKHOLM, starts_at: "2026-10-20T08:00:00Z", ends_at: "2026-10-23T15:00:00Z" };
  assert.equal(eventTiming(closesToday, "sv", QA_NOW, QA_DAY, opts), "till 17:00");
  assert.equal(eventTiming(closesToday, "en", QA_NOW, QA_DAY, opts), "until 17:00");
  const runsOn = { timezone: STOCKHOLM, starts_at: "2026-10-20T08:00:00Z", ends_at: "2026-10-26T16:00:00Z" };
  assert.equal(eventTiming(runsOn, "en", QA_NOW, QA_DAY, opts), "until Mon 26 Oct 17:00", "a later end names its day; no same-day close is implied");
  assert.equal(eventTiming(runsOn, "en", QA_NOW, QA_DAY), "on now", "without the heading the row still says it is on now");
  const session = { timezone: STOCKHOLM, time_window: { kind: "occurrences", dates: [QA_DAY], local_start: "13:00", local_end: "15:00" } };
  assert.equal(eventTiming(session, "sv", QA_NOW, QA_DAY, opts), "till 15:00");
  const scheduled = { ...session, recurrence: { occurrence_status: "unconfirmed" } };
  assert.equal(eventTiming(scheduled, "sv", QA_NOW, QA_DAY, opts), "enligt schema nu · till 15:00", "an unconfirmed schedule keeps saying so");
});

