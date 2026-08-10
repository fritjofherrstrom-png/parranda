/**
 * Evening-event weave — a genuine tonight-event becomes the composed day's
 * honest evening anchor, tied to the nearest district. Pure + deterministic.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  eventOccurrenceForDate,
  weaveEveningEvent,
} = require("../server/candidates/evening-event-weave");

function dayWithDistricts() {
  return {
    provenance: "agnostic_anchor",
    area_count: 2,
    district_day: {
      areas: [
        { center: { lat: 60.170, lng: 24.940 }, covers: ["fika"], stop_ids: ["a1"] },
        { center: { lat: 60.190, lng: 24.980 }, covers: ["nightlife"], stop_ids: ["b1"] },
      ],
      legs: [{ from_area: 0, to_area: 1, distance_km: 3.1 }],
      covered_intents: ["fika", "nightlife"],
      missing_intents: [],
    },
  };
}

function liveEvents(tonight) {
  return { coverage: "covered", feed: { id: "f", label: "Feed" }, tonight, this_week: [] };
}

test("weaves the top geocoded tonight-event as the evening anchor, tied to nearest district", () => {
  const out = weaveEveningEvent(
    dayWithDistricts(),
    liveEvents([
      { id: "e1", title: "Rooftop set", starts_at: "2026-06-28T20:00:00Z", source_url: "https://x/e1", source_label: "Feed", lat: 60.189, lng: 24.979, salience_score: 9 },
      { id: "e2", title: "No coords", starts_at: "2026-06-28T21:00:00Z", salience_score: 8 },
    ]),
  );
  const ev = out.district_day.evening_event;
  assert.ok(ev, "evening_event attached");
  assert.equal(ev.id, "e1", "top geocoded tonight-event chosen");
  assert.equal(ev.near_area_index, 1, "tied to the nearest district (the nightlife quarter)");
  assert.ok(ev.near_area_km >= 0);
  // Honest: real time window + source carried, no ETA/geometry invented.
  assert.equal(ev.starts_at, "2026-06-28T20:00:00Z");
  assert.equal(ev.source_url, "https://x/e1");
  assert.ok(!("walk_minutes" in ev) && !("eta" in ev), "no fabricated walking/eta fields");
});

test("administrative/civic events stay out of the evening anchor, even with coords", () => {
  const base = dayWithDistricts();
  const out = weaveEveningEvent(
    base,
    liveEvents([
      {
        id: "admin",
        title: "City council session",
        starts_at: "2026-06-28T19:00:00Z",
        source_url: "https://x/admin",
        source_label: "Official calendar",
        lat: 60.189,
        lng: 24.979,
        timing_relevance: "tonight",
        cultural_tier: "administrative",
        salience_score: 4,
      },
    ]),
  );
  assert.equal(out.district_day.evening_event, undefined);
  assert.deepEqual(out, base);
});

test("a Pulse-only event never becomes an evening route anchor", () => {
  const base = dayWithDistricts();
  const out = weaveEveningEvent(
    base,
    liveEvents([{
      id: "seasonal-exhibition",
      title: "Seasonal exhibition",
      source_url: "https://x/exhibition",
      source_label: "Reviewed calendar",
      lat: 60.189,
      lng: 24.979,
      timing_relevance: "tonight",
      cultural_tier: "cultural",
      salience_score: 9,
      pulse_display_eligible: true,
      route_eligible: false,
    }]),
  );

  assert.equal(out.district_day.evening_event, undefined);
  assert.deepEqual(out, base);
});

test("cultural events can become evening anchors and preserve salience metadata", () => {
  const out = weaveEveningEvent(
    dayWithDistricts(),
    liveEvents([
      {
        id: "concert",
        title: "Open-air concert",
        starts_at: "2026-06-28T20:00:00Z",
        source_url: "https://x/concert",
        source_label: "Official calendar",
        lat: 60.189,
        lng: 24.979,
        timing_relevance: "tonight",
        cultural_tier: "cultural",
        salience_score: 8.5,
      },
    ]),
  );
  const ev = out.district_day.evening_event;
  assert.ok(ev);
  assert.equal(ev.id, "concert");
  assert.equal(ev.cultural_tier, "cultural");
  assert.equal(ev.salience_score, 8.5);
});

test("a display-only serendipity slot does not reorder the evening route evidence", () => {
  const hiddenFromRoute = Array.from({ length: 5 }, (_, index) => ({
    id: `display-${index}`,
    title: `Display row ${index}`,
    route_eligible: false,
  }));
  const eventSurface = {
    ...liveEvents([
      ...hiddenFromRoute,
      {
        id: "serendipity",
        title: "Unexpected performance",
        starts_at: "2026-07-29T18:30:00.000Z",
        timezone: "Europe/Stockholm",
        source_url: "https://x/serendipity",
        source_label: "Feed",
        lat: 60.189,
        lng: 24.979,
        timing_relevance: "tonight",
        cultural_tier: "cultural",
        salience_score: 8,
        highlight_reason: "local_serendipity",
      },
    ]),
    browse: {
      tonight: {
        more: [{
          id: "original-sixth",
          title: "Original sixth-ranked event",
          starts_at: "2026-07-29T18:00:00.000Z",
          timezone: "Europe/Stockholm",
          source_url: "https://x/original-sixth",
          source_label: "Feed",
          lat: 60.1706,
          lng: 24.9408,
          timing_relevance: "tonight",
          cultural_tier: "cultural",
          salience_score: 7.5,
        }],
      },
    },
  };
  const out = weaveEveningEvent(dayWithDistricts(), eventSurface);
  const selectedDateOut = weaveEveningEvent(dayWithDistricts(), eventSurface, {
    selectedDate: "2026-07-29",
  });

  assert.equal(out.district_day.evening_event.id, "original-sixth");
  assert.equal(selectedDateOut.district_day.evening_event.id, "original-sixth");
});

test("cultural event outranks an administrative notice as the day anchor", () => {
  const out = weaveEveningEvent(
    dayWithDistricts(),
    liveEvents([
      {
        id: "admin",
        title: "Committee meeting",
        source_url: "https://x/admin",
        source_label: "Official calendar",
        lat: 60.189,
        lng: 24.979,
        timing_relevance: "tonight",
        cultural_tier: "administrative",
        salience_score: 9.9,
      },
      {
        id: "market",
        title: "Night market",
        source_url: "https://x/market",
        source_label: "Official calendar",
        lat: 60.1706,
        lng: 24.9408,
        timing_relevance: "tonight",
        cultural_tier: "cultural",
        salience_score: 7.5,
      },
    ]),
  );
  assert.equal(out.district_day.evening_event.id, "market");
});

test("future events are not woven as tonight anchors", () => {
  const base = dayWithDistricts();
  const out = weaveEveningEvent(
    base,
    liveEvents([
      {
        id: "future",
        title: "Next month concert",
        source_url: "https://x/future",
        source_label: "Official calendar",
        lat: 60.189,
        lng: 24.979,
        timing_relevance: "future",
        cultural_tier: "cultural",
        salience_score: 9,
      },
    ]),
  );
  assert.equal(out.district_day.evening_event, undefined);
  assert.deepEqual(out, base);
});

test("selected route date excludes a one-day event from another day", () => {
  const base = dayWithDistricts();
  const out = weaveEveningEvent(
    base,
    liveEvents([
      {
        id: "today-only",
        title: "Tonight only",
        starts_at: "2026-07-28T18:00:00.000Z",
        ends_at: "2026-07-28T20:00:00.000Z",
        timezone: "Europe/Stockholm",
        source_url: "https://x/today-only",
        source_label: "Official calendar",
        lat: 60.189,
        lng: 24.979,
        cultural_tier: "cultural",
      },
    ]),
    { selectedDate: "2026-07-29" },
  );
  assert.equal(out.district_day.evening_event, undefined);
  assert.deepEqual(out, base);
});

test("selected route date can choose a real future evening occurrence from this_week", () => {
  const out = weaveEveningEvent(
    dayWithDistricts(),
    {
      ...liveEvents([
        {
          id: "today-only",
          title: "Tonight only",
          starts_at: "2026-07-28T18:00:00.000Z",
          timezone: "Europe/Stockholm",
          source_url: "https://x/today-only",
          source_label: "Official calendar",
          lat: 60.189,
          lng: 24.979,
          cultural_tier: "cultural",
        },
      ]),
      this_week: [
        {
          id: "tomorrow-evening",
          title: "Tomorrow concert",
          starts_at: "2026-07-29T18:30:00.000Z",
          timezone: "Europe/Stockholm",
          timing_relevance: "future",
          source_url: "https://x/tomorrow-evening",
          source_label: "Official calendar",
          lat: 60.189,
          lng: 24.979,
          cultural_tier: "cultural",
        },
      ],
    },
    { selectedDate: "2026-07-29" },
  );
  assert.equal(out.district_day.evening_event.id, "tomorrow-evening");
  assert.equal(out.district_day.evening_event.occurrence_date, "2026-07-29");
  assert.equal(out.district_day.evening_event.starts_at, "2026-07-29T18:30:00.000Z");
});

test("daily windows materialize only the selected evening occurrence", () => {
  const event = {
    id: "night-market-series",
    title: "Night market",
    starts_on: "2026-07-20",
    ends_on: "2026-08-07",
    timezone: "Europe/Stockholm",
    time_window: {
      kind: "daily",
      starts_on: "2026-07-20",
      ends_on: "2026-08-07",
      local_start: "18:00",
      local_end: "21:00",
      timezone: "Europe/Stockholm",
    },
  };
  const occurrence = eventOccurrenceForDate(event, "2026-07-29");
  assert.equal(occurrence.starts_at, "2026-07-29T16:00:00.000Z");
  assert.equal(occurrence.ends_at, "2026-07-29T19:00:00.000Z");
  assert.equal(occurrence.starts_on, "2026-07-29");
  assert.equal(occurrence.occurrence_date, "2026-07-29");
  assert.deepEqual(occurrence.time_window, event.time_window);
});

test("daytime daily windows and all-day rows remain Pulse-only, not evening route anchors", () => {
  const daytime = eventOccurrenceForDate({
    starts_on: "2026-07-20",
    ends_on: "2026-08-07",
    time_window: {
      kind: "daily",
      starts_on: "2026-07-20",
      ends_on: "2026-08-07",
      local_start: "11:00",
      local_end: "15:00",
      timezone: "Europe/Stockholm",
    },
  }, "2026-07-29");
  const allDay = eventOccurrenceForDate({
    starts_on: "2026-07-29",
    ends_on: "2026-07-29",
    time_window: { kind: "all_day", starts_on: "2026-07-29", ends_on: "2026-07-29" },
  }, "2026-07-29");
  assert.equal(daytime, null);
  assert.equal(allDay, null);
});

test("no geocoded tonight-event → the day is returned UNCHANGED (no fabricated happening)", () => {
  const base = dayWithDistricts();
  const out = weaveEveningEvent(base, liveEvents([{ id: "e2", title: "No coords", salience_score: 8 }]));
  assert.equal(out.district_day.evening_event, undefined);
  assert.deepEqual(out, base);
});

test("no events at all / uncovered → unchanged", () => {
  const base = dayWithDistricts();
  assert.deepEqual(weaveEveningEvent(base, liveEvents([])), base);
  assert.deepEqual(weaveEveningEvent(base, { coverage: "uncovered", tonight: [] }), base);
  assert.deepEqual(weaveEveningEvent(base, null), base);
});

test("no district_day → returned unchanged (never throws)", () => {
  assert.equal(weaveEveningEvent(null, liveEvents([])), null);
  assert.deepEqual(weaveEveningEvent({ foo: 1 }, liveEvents([{ id: "e", lat: 1, lng: 2 }])), { foo: 1 });
});
