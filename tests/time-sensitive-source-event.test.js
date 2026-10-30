const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeTimeSensitiveSourceEvent,
  normalizeTimingRelevance,
} = require("../server/pulse-sources");

const NOW = "2026-07-10T18:30:00.000Z";

test("a split occurrence retains validated complete series timing and rejects incoherent provenance", () => {
  const source = { id: "series@2026-10-13", title: "Workshop", source_url: "https://source.example/series",
    starts_on: "2026-10-13", ends_on: "2026-10-13",
    time_window: { kind: "occurrences", dates: ["2026-10-13"], local_start: "12:30", local_end: "15:30" },
    source_series_time_window: { kind: "occurrences", dates: ["2026-10-01", "2026-10-13", "2026-11-01"], local_start: "12:30", local_end: "15:30" } };
  const normalized = normalizeTimeSensitiveSourceEvent(source, { timezone: "Europe/Stockholm" });
  assert.deepEqual(normalized.source_series_time_window.dates, source.source_series_time_window.dates);
  assert.deepEqual(normalized.time_window.dates, ["2026-10-13"]);
  for (const change of [
    { dates: ["2026-10-01", "2026-11-01"] },
    { dates: ["2026-02-30"] },
    { dates: [] },
    { kind: "period" },
    { local_start: "14:00" },
  ]) {
    assert.equal(normalizeTimeSensitiveSourceEvent({ ...source,
      source_series_time_window: { ...source.source_series_time_window, ...change } }, { timezone: "Europe/Stockholm" }), null);
  }
});

function event(overrides = {}) {
  return {
    id: "night-market-1",
    title: "Riverfront night market",
    source_url: "https://example.test/events/night-market-1",
    source_label: "Official city calendar",
    source_type: "official_open_data",
    source_tier: "official",
    city: "any-city",
    lat: "41.9",
    lng: "12.49",
    area: "riverfront",
    address: "River Street 7",
    starts_at: "2026-07-10T17:00:00.000Z",
    ends_at: "2026-07-10T22:00:00.000Z",
    last_checked: "2026-07-10T09:00:00.000Z",
    confidence: "strong",
    tags: ["market", "evening"],
    intents: ["markets", "nightlife"],
    route_role_hint: "market_stop",
    ...overrides,
  };
}

test("current time-sensitive source event is normalized as relevant now", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(event(), { now: NOW });

  assert.equal(normalized.candidate_kind, "source_event");
  assert.equal(normalized.timing_relevance, "now");
  assert.equal(normalized.confidence, "strong");
  assert.equal(normalized.lat, 41.9);
  assert.equal(normalized.lng, 12.49);
  assert.equal(normalized.route_role_hint, "market_stop");
  assert.equal(normalized.address, "River Street 7");
  assert.deepEqual(normalized.intents, ["markets", "nightlife"]);
  assert.ok(normalized.timing_reasons.includes("has_source_backing"));
});

test("local significance evidence is bounded and preserves only the closed contract", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(event({
    local_significance: {
      source_prominence: "dedicated_programme",
      programme_event_count: 12,
      programme_day_count: 4,
      current_year_evidence: true,
      popularity: 999999,
    },
  }), { now: NOW });
  assert.deepEqual(normalized.local_significance, {
    source_prominence: "dedicated_programme",
    programme_event_count: 12,
    programme_day_count: 4,
    current_year_evidence: true,
  });
  assert.equal(normalizeTimeSensitiveSourceEvent(event({
    local_significance: { source_prominence: "search_result", programme_event_count: 9999 },
  }), { now: NOW }).local_significance, undefined);
});

test("future event is not classified as now", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      id: "future-market",
      starts_at: "2026-07-12T17:00:00.000Z",
      ends_at: "2026-07-12T22:00:00.000Z",
    }),
    { now: NOW },
  );

  assert.equal(normalized.timing_relevance, "future");
  assert.notEqual(normalized.timing_relevance, "now");
});

test("same-day evening event is classified as tonight before it starts", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-10T20:00:00.000Z",
      ends_at: "2026-07-10T23:00:00.000Z",
    }),
    { now: NOW },
  );

  assert.equal(normalized.timing_relevance, "tonight");
});

test("same-day daytime upcoming event is classified as today", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-10T14:00:00.000Z",
      ends_at: "2026-07-10T16:00:00.000Z",
    }),
    { now: "2026-07-10T10:00:00.000Z" },
  );

  assert.equal(normalized.timing_relevance, "today");
});

test("reviewed timezone classifies evening by venue-local hour", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-09-12T15:00:00.000Z",
      ends_at: "2026-09-12T20:00:00.000Z",
    }),
    {
      now: "2026-09-12T13:00:00.000Z",
      timezone: "Europe/Athens",
    },
  );

  assert.equal(normalized.timing_relevance, "tonight");
  assert.equal(normalized.timezone, "Europe/Athens");
});

test("reviewed timezone prevents UTC date from masking a local next day", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-14T22:30:00.000Z",
      ends_at: "2026-07-14T23:30:00.000Z",
    }),
    {
      now: "2026-07-14T21:30:00.000Z",
      timezone: "Europe/Stockholm",
    },
  );

  assert.equal(normalized.timing_relevance, "future");
});

test("local date-only facts stay local and never become UTC midnight instants", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-15",
      ends_at: "2026-07-17",
    }),
    { now: NOW, timezone: "Europe/Stockholm" },
  );

  assert.equal(normalized.starts_at, undefined);
  assert.equal(normalized.ends_at, undefined);
  assert.equal(normalized.starts_on, "2026-07-15");
  assert.equal(normalized.ends_on, "2026-07-17");
  assert.deepEqual(normalized.time_window, {
    kind: "all_day",
    starts_on: "2026-07-15",
    ends_on: "2026-07-17",
  });
  assert.equal(normalized.timing_relevance, "unknown");
});

test("daily windows do not become continuous multi-day events between openings", () => {
  const dailyEvent = event({
    starts_at: null,
    ends_at: null,
    starts_on: "2026-07-15",
    ends_on: "2026-07-17",
    time_window: {
      kind: "daily",
      local_start: "10:00",
      local_end: "17:00",
    },
  });
  const betweenOpenings = normalizeTimeSensitiveSourceEvent(dailyEvent, {
    now: "2026-07-15T18:00:00.000Z",
    timezone: "Europe/Stockholm",
  });
  const duringOpening = normalizeTimeSensitiveSourceEvent(dailyEvent, {
    now: "2026-07-16T10:00:00.000Z",
    timezone: "Europe/Stockholm",
  });
  const afterFinalOpening = normalizeTimeSensitiveSourceEvent(dailyEvent, {
    now: "2026-07-17T16:00:00.000Z",
    timezone: "Europe/Stockholm",
  });

  assert.equal(betweenOpenings.timing_relevance, "future");
  assert.equal(duringOpening.timing_relevance, "now");
  assert.equal(afterFinalOpening.timing_relevance, "stale");
  assert.equal(duringOpening.starts_at, undefined);
  assert.deepEqual(duringOpening.time_window, {
    kind: "daily",
    starts_on: "2026-07-15",
    ends_on: "2026-07-17",
    local_start: "10:00",
    local_end: "17:00",
    timezone: "Europe/Stockholm",
  });
});

test("continuous multi-day events remain explicit instants", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-15T08:00:00.000Z",
      ends_at: "2026-07-17T15:00:00.000Z",
    }),
    { now: "2026-07-16T02:00:00.000Z", timezone: "Europe/Stockholm" },
  );

  assert.equal(normalized.timing_relevance, "now");
  assert.equal(normalized.time_window.kind, "continuous");
});

test("ambiguous DST folds fail closed unless the source provides an explicit offset", () => {
  const ambiguous = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-10-25 02:30:00",
      ends_at: "2026-10-25 03:30:00",
    }),
    { now: "2026-10-24T12:00:00.000Z", timezone: "Europe/Stockholm" },
  );
  const explicit = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-10-25T02:30:00+02:00",
      ends_at: "2026-10-25T03:30:00+01:00",
    }),
    { now: "2026-10-24T12:00:00.000Z", timezone: "Europe/Stockholm" },
  );

  assert.equal(ambiguous.starts_at, undefined);
  assert.equal(ambiguous.timing_relevance, "unknown");
  assert.equal(explicit.starts_at, "2026-10-25T00:30:00.000Z");
  assert.equal(explicit.ends_at, "2026-10-25T02:30:00.000Z");
});

test("expired or stale events are downgraded instead of promoted", () => {
  const expired = normalizeTimeSensitiveSourceEvent(
    event({
      starts_at: "2026-07-09T17:00:00.000Z",
      ends_at: "2026-07-09T22:00:00.000Z",
      confidence: "strong",
    }),
    { now: NOW },
  );
  const stale = normalizeTimeSensitiveSourceEvent(event({ freshness: "stale", confidence: "medium" }), { now: NOW });

  assert.equal(expired.timing_relevance, "stale");
  assert.equal(expired.confidence, "low");
  assert.equal(stale.timing_relevance, "stale");
  assert.equal(stale.confidence, "low");
});

test("explicit timing relevance cannot promote an expired event", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      timing_relevance: "now",
      starts_at: "2026-07-09T17:00:00.000Z",
      ends_at: "2026-07-09T22:00:00.000Z",
      confidence: "strong",
    }),
    { now: NOW },
  );

  assert.equal(normalized.timing_relevance, "stale");
  assert.equal(normalized.confidence, "low");
  assert.ok(normalized.timing_reasons.includes("timing_stale"));
  assert.ok(!normalized.timing_reasons.includes("timing_now"));
});

test("event without source or provenance cannot receive strong confidence", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      source_url: "",
      source_label: "",
      provenance: null,
      confidence: "strong",
    }),
    { now: NOW },
  );

  assert.equal(normalized.confidence, "medium");
  assert.ok(normalized.timing_reasons.includes("missing_source_backing"));
  assert.ok(!normalized.timing_reasons.includes("confidence_strong"));
});

test("local-language event metadata is preserved without blocking normalization", () => {
  const normalized = normalizeTimeSensitiveSourceEvent(
    event({
      title: "Θερινή αγορά στη γειτονιά",
      source_language: "el",
      event_language: "el",
      translation_status: "provided",
      translation_confidence: "medium",
      translated_atoms: ["category", "status"],
    }),
    { now: NOW },
  );

  assert.equal(normalized.title, "Θερινή αγορά στη γειτονιά");
  assert.equal(normalized.source_language, "el");
  assert.equal(normalized.event_language, "el");
  assert.equal(normalized.translation_status, "provided");
  assert.equal(normalized.translation_confidence, "medium");
  assert.deepEqual(normalized.translated_atoms, ["category", "status"]);
  assert.equal(normalized.timing_relevance, "now");
});

test("contract is city-agnostic and does not branch on specific city keys", () => {
  const bologna = normalizeTimeSensitiveSourceEvent(event({ city: "bologna", title: "Seasonal street market" }), {
    now: NOW,
  });
  const simrishamn = normalizeTimeSensitiveSourceEvent(event({ city: "simrishamn", title: "Harbor culture night" }), {
    now: NOW,
  });

  assert.equal(bologna.timing_relevance, simrishamn.timing_relevance);
  assert.equal(bologna.candidate_kind, "source_event");
  assert.equal(simrishamn.candidate_kind, "source_event");

  const source = require("node:fs").readFileSync(require.resolve("../server/pulse-sources/time-sensitive-event"), "utf8");
  assert.ok(!/barcelona|rome|athens|tiber/i.test(source));
});

test("normalizeTimingRelevance handles invalid or missing time honestly", () => {
  assert.equal(normalizeTimingRelevance(null, {}), "unknown");
  assert.equal(normalizeTimingRelevance("future", {}), "future");
  assert.equal(normalizeTimingRelevance("made_up", { now: new Date(NOW) }), "unknown");
});

test("listed occurrences are judged only on their stated dates", () => {
  // 9 and 16 July 2026 are Thursdays; 10 July is a Friday.
  const series = event({
    starts_at: null,
    ends_at: null,
    starts_on: "2026-07-09",
    ends_on: "2026-07-16",
    time_window: {
      kind: "occurrences",
      dates: ["2026-07-16", "2026-07-09", "2026-07-09"],
      local_start: "18:00",
      local_end: "21:00",
    },
  });
  const at = (now) => normalizeTimeSensitiveSourceEvent(series, { now, timezone: "Europe/Stockholm" });

  assert.deepEqual(at("2026-07-08T12:00:00.000Z").time_window, {
    kind: "occurrences",
    dates: ["2026-07-09", "2026-07-16"],
    starts_on: "2026-07-09",
    ends_on: "2026-07-16",
    local_start: "18:00",
    local_end: "21:00",
    timezone: "Europe/Stockholm",
  });
  assert.equal(at("2026-07-08T12:00:00.000Z").timing_relevance, "future");
  assert.equal(at("2026-07-09T14:00:00.000Z").timing_relevance, "tonight");
  assert.equal(at("2026-07-09T17:00:00.000Z").timing_relevance, "now");
  assert.equal(at("2026-07-10T17:00:00.000Z").timing_relevance, "future", "an unlisted Friday is never tonight");
  assert.equal(at("2026-07-16T20:00:00.000Z").timing_relevance, "stale");
  assert.equal(at("2026-07-16T20:00:00.000Z").freshness, "stale");
});

test("unusable occurrence lists fail closed to period semantics instead of being truncated", () => {
  const sixtyOne = Array.from({ length: 61 }, (_, index) =>
    new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10));
  for (const dates of [sixtyOne, ["2026-07-09", "2026-02-30"], [], "2026-07-09"]) {
    const normalized = normalizeTimeSensitiveSourceEvent(event({
      starts_at: null,
      ends_at: null,
      starts_on: "2026-07-01",
      ends_on: "2026-08-30",
      time_window: { kind: "occurrences", dates, local_start: "18:00", local_end: "21:00" },
    }), { now: "2026-07-09T12:00:00.000Z", timezone: "Europe/Stockholm" });
    assert.equal(normalized.time_window.kind, "period");
    assert.equal(normalized.time_window.starts_on, "2026-07-01");
    assert.equal(normalized.time_window.ends_on, "2026-08-30");
    assert.equal(normalized.timing_relevance, "unknown");
  }
});

test("period windows never become now, today or tonight", () => {
  const period = event({
    starts_at: null,
    ends_at: null,
    starts_on: "2026-07-01",
    ends_on: "2026-07-31",
    time_window: { kind: "period", local_start: "18:00", local_end: "21:00" },
  });
  const at = (now) => normalizeTimeSensitiveSourceEvent(period, { now, timezone: "Europe/Stockholm" });

  assert.deepEqual(at("2026-07-09T17:00:00.000Z").time_window, {
    kind: "period",
    starts_on: "2026-07-01",
    ends_on: "2026-07-31",
    local_start: "18:00",
    local_end: "21:00",
    timezone: "Europe/Stockholm",
  });
  assert.equal(at("2026-07-09T17:00:00.000Z").timing_relevance, "unknown");
  assert.equal(at("2026-06-20T17:00:00.000Z").timing_relevance, "future");
  assert.equal(at("2026-08-02T17:00:00.000Z").timing_relevance, "stale");
});

test("a declared but unknown recurrence kind never widens into a daily window", () => {
  const declared = normalizeTimeSensitiveSourceEvent(event({
    starts_at: null,
    ends_at: null,
    starts_on: "2026-07-01",
    ends_on: "2026-07-31",
    time_window: { kind: "weekly", local_start: "18:00", local_end: "21:00" },
  }), { now: "2026-07-09T17:00:00.000Z", timezone: "Europe/Stockholm" });
  assert.equal(declared.time_window.kind, "period");

  // An undeclared window keeps the existing daily inference from its clocks.
  const undeclared = normalizeTimeSensitiveSourceEvent(event({
    starts_at: null,
    ends_at: null,
    starts_on: "2026-07-01",
    ends_on: "2026-07-31",
    time_window: { local_start: "18:00", local_end: "21:00" },
  }), { now: "2026-07-09T17:00:00.000Z", timezone: "Europe/Stockholm" });
  assert.equal(undeclared.time_window.kind, "daily");
});

test('normalization and public Live views distinguish date-only uncertainty from source-explicit whole-day timing',async()=>{
 const {toEventView}=require('../server/place-candidates/agnostic-event-supply');
 const {eventTiming}=await import('../frontend/src/lib/pulse-view.mjs');
 const raw={id:'date-precision',title:'Dated source item',source_url:'https://calendar.example/dated',starts_on:'2026-10-22'};
 const options={timezone:'Europe/Stockholm',now:'2026-10-15T12:00:00Z'};
 for(const input of [raw,{...raw,time_window:{kind:'all_day',starts_on:'2026-10-22'}},{...raw,time_window:{kind:'all_day',starts_on:'2026-10-22',all_day_explicit:'true'}}]){
  const normalized=normalizeTimeSensitiveSourceEvent(input,options);
  const {fuseTimeSensitiveEvents}=require('../server/pulse-sources');
  const view=toEventView(fuseTimeSensitiveEvents([normalized])[0],{id:'calendar',label:'Source'});
  assert.equal(view.time_window.kind,'all_day');
  assert.doesNotMatch(eventTiming(view,'en'),/All day/,'a missing clock never establishes whole-day availability');
 }
 const normalized=normalizeTimeSensitiveSourceEvent({...raw,time_window:{kind:'all_day',starts_on:'2026-10-22',all_day_explicit:true}},options);
 const {fuseTimeSensitiveEvents}=require('../server/pulse-sources');
  const view=toEventView(fuseTimeSensitiveEvents([normalized])[0],{id:'calendar',label:'Source'});
 assert.equal(view.time_window.all_day_explicit,true);
 assert.equal(eventTiming(view,'en'),'Thu 22 Oct · All day');
});

// Engine review, 25 Oct 2026: a guided walk listed at 10:00 with no end was
// "now" at 20:00, so Pulse labelled it "Just nu" and Just nu could offer it as
// happening. A stated start that has passed with no stated end is not evidence
// that the event is still on; its own day keeps its relevance.
test("a passed start with no stated end keeps its day's relevance and is never now", () => {
  const options = { now: NOW, timezone: "Europe/Rome" }; // 20:30 local
  const relevance = (starts_at) =>
    normalizeTimeSensitiveSourceEvent(event({ starts_at, ends_at: undefined }), options).timing_relevance;
  assert.equal(relevance("2026-07-10T08:00:00.000Z"), "today", "started 10:00 today");
  assert.equal(relevance("2026-07-10T17:00:00.000Z"), "tonight", "started 19:00 this evening");
  assert.equal(relevance("2026-07-08T08:00:00.000Z"), "unknown", "started on an earlier day");
  // A stated end around now is evidence: still on now.
  assert.equal(normalizeTimeSensitiveSourceEvent(event(), options).timing_relevance, "now");
});
