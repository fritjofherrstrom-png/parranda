/**
 * Evening-event weave — a genuine tonight-event becomes the composed day's
 * honest evening anchor, tied to the nearest district. Pure + deterministic.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { weaveEveningEvent } = require("../server/candidates/evening-event-weave");

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
