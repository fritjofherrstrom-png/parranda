const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createEventsCalendarProvider,
  resolveDefaultEventsCalendarProvider,
  extractEventsCalendarSourceEvents,
  extractTheEventsCalendarEvents,
  extractIcalEvents,
  mapEventsCalendarEventToRaw,
} = require("../server/pulse-sources/events-calendar-source-provider");
const { collectPulseSourcesForCity } = require("../server/pulse-sources/provider-registry");

const city = { key: "calendarville", label: "Calendarville" };
const NOW = new Date("2026-09-12T18:30:00.000Z");

function tecEvent(overrides = {}) {
  return {
    id: 42,
    title: { rendered: "Evening market on the square" },
    start_date: "2026-09-12T18:00:00+03:00",
    end_date: "2026-09-12T23:00:00+03:00",
    url: "https://calendar.test/events/evening-market/",
    venue: {
      venue: "Old Market Hall",
      city: "Athens",
      geo_lat: "37.976",
      geo_lng: "23.726",
    },
    categories: [{ name: "market" }, { name: "nightlife" }],
    language: "el",
    translation_status: "needed",
    translation_confidence: "none",
    ...overrides,
  };
}

function icsFixture(overrides = {}) {
  const summary = overrides.summary || "Καλοκαιρινή αγορά";
  const dtstart = overrides.dtstart || "DTSTART:20260912T180000Z";
  const dtend = overrides.dtend || "DTEND:20260912T220000Z";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Parranda Test//EN",
    "BEGIN:VEVENT",
    "UID:athens-market-1@example.test",
    `SUMMARY;LANGUAGE=el:${summary}`,
    dtstart,
    dtend,
    "LOCATION:Plateia Test",
    "GEO:37.976;23.726",
    "URL:https://calendar.test/ics/athens-market-1",
    "CATEGORIES:market,night",
    "RRULE:FREQ=WEEKLY;COUNT=4",
    "DTSTAMP:20260901T100000Z",
    overrides.status ? `STATUS:${overrides.status}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

function response(body, contentType = "application/json") {
  return {
    ok: true,
    headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? contentType : "") },
    text: async () => body,
  };
}

function provider(overrides = {}) {
  return createEventsCalendarProvider({
    endpoint: "https://calendar.test/feed",
    label: "Test Events Calendar",
    sourceUrl: "https://calendar.test/",
    license: "CC-BY 4.0",
    ...overrides,
  });
}

test("maps The Events Calendar REST event to the raw time-sensitive shape", () => {
  const raw = mapEventsCalendarEventToRaw(tecEvent());
  assert.equal(raw.id, "42");
  assert.equal(raw.title, "Evening market on the square");
  assert.equal(raw.starts_at, "2026-09-12T18:00:00+03:00");
  assert.equal(raw.ends_at, "2026-09-12T23:00:00+03:00");
  assert.equal(raw.source_url, "https://calendar.test/events/evening-market/");
  assert.equal(raw.place_context, "Old Market Hall");
  assert.equal(raw.area, "Athens");
  assert.equal(raw.lat, 37.976);
  assert.equal(raw.lng, 23.726);
  assert.deepEqual(raw.tags, ["market", "nightlife"]);
  assert.equal(raw.source_language, "el");
  assert.equal(raw.translation_status, "needed");
});

test("extracts The Events Calendar events from common REST wrappers", () => {
  assert.equal(extractTheEventsCalendarEvents({ events: [tecEvent(), tecEvent({ id: 2 })] }).length, 2);
  assert.equal(extractTheEventsCalendarEvents([tecEvent()]).length, 1);
  assert.equal(extractTheEventsCalendarEvents({ data: [tecEvent()] }).length, 1);
  assert.equal(extractTheEventsCalendarEvents({ ok: true }).length, 0);
});

test("configured candidate provider normalizes REST events through the registry when enabled", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [
      provider({
        fetcher: async () => response(JSON.stringify({ events: [tecEvent()] })),
      }),
    ],
    enabledStatuses: ["candidate"],
    context: { now: NOW },
  });

  assert.equal(result.events.length, 0, "not legacy live events");
  assert.equal(result.time_sensitive_events.length, 1);
  const event = result.time_sensitive_events[0];
  assert.equal(event.candidate_kind, "source_event");
  assert.equal(event.timing_relevance, "now");
  assert.equal(event.source_label, "Test Events Calendar");
  assert.equal(event.source_url, "https://calendar.test/events/evening-market/");
  assert.equal(event.source_language, "el");
  assert.equal(event.translation_status, "needed");
  assert.ok(!(event.timing_reasons || []).includes("missing_source_backing"));
});

test("candidate provider is skipped by default unless candidate status is enabled", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [
      provider({
        fetcher: async () => response(JSON.stringify({ events: [tecEvent()] })),
      }),
    ],
    context: { now: NOW },
  });

  assert.deepEqual(result.time_sensitive_events, []);
  assert.equal(result.source_status[0].status, "skipped");
  assert.equal(result.source_status[0].reason, "status_candidate");
});

test("parses iCal VEVENT feeds and preserves local-language metadata", () => {
  const extracted = extractIcalEvents(icsFixture());
  assert.equal(extracted.length, 1);
  const raw = mapEventsCalendarEventToRaw(extracted[0]);
  assert.equal(raw.id, "athens-market-1@example.test");
  assert.equal(raw.title, "Καλοκαιρινή αγορά");
  assert.equal(raw.starts_at, "2026-09-12T18:00:00.000Z");
  assert.equal(raw.ends_at, "2026-09-12T22:00:00.000Z");
  assert.equal(raw.source_url, "https://calendar.test/ics/athens-market-1");
  assert.equal(raw.place_context, "Plateia Test");
  assert.equal(raw.lat, 37.976);
  assert.equal(raw.lng, 23.726);
  assert.deepEqual(raw.tags, ["market", "night"]);
  assert.equal(raw.recurrence, "FREQ=WEEKLY;COUNT=4");
  assert.equal(raw.event_language, "el");
  assert.equal(raw.translation_status, "needed");
});

test("iCal Zulu date-times convert to ISO UTC, but floating/TZID date-times stay unknown", () => {
  const zulu = mapEventsCalendarEventToRaw(extractIcalEvents(icsFixture({
    dtstart: "DTSTART:20260912T180000Z",
    dtend: "DTEND:20260912T220000Z",
  }))[0]);
  assert.equal(zulu.starts_at, "2026-09-12T18:00:00.000Z");
  assert.equal(zulu.ends_at, "2026-09-12T22:00:00.000Z");

  const tzid = mapEventsCalendarEventToRaw(extractIcalEvents(icsFixture({
    dtstart: "DTSTART;TZID=Europe/Athens:20260912T180000",
    dtend: "DTEND;TZID=Europe/Athens:20260912T220000",
  }))[0]);
  assert.equal(tzid.starts_at, undefined);
  assert.equal(tzid.ends_at, undefined);

  const floating = mapEventsCalendarEventToRaw(extractIcalEvents(icsFixture({
    dtstart: "DTSTART:20260912T180000",
    dtend: "DTEND:20260912T220000",
  }))[0]);
  assert.equal(floating.starts_at, undefined);
  assert.equal(floating.ends_at, undefined);
});

test("iCal floating date-times do not promote through registry when timezone is unresolved", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [
      provider({
        format: "ical",
        fetcher: async () => response(icsFixture({
          dtstart: "DTSTART:20260912T180000",
          dtend: "DTEND:20260912T220000",
        }), "text/calendar"),
      }),
    ],
    enabledStatuses: ["candidate"],
    context: { now: NOW },
  });

  assert.equal(result.time_sensitive_events.length, 1);
  const event = result.time_sensitive_events[0];
  assert.equal(event.timing_relevance, "unknown");
  assert.equal(event.starts_at, undefined);
  assert.equal(event.ends_at, undefined);
  assert.ok(!(event.timing_reasons || []).includes("timing_now"));
});

test("configured candidate provider normalizes iCal events through the registry when enabled", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [
      provider({
        format: "ical",
        fetcher: async () => response(icsFixture(), "text/calendar"),
      }),
    ],
    enabledStatuses: ["candidate"],
    context: { now: NOW },
  });

  assert.equal(result.time_sensitive_events.length, 1);
  const event = result.time_sensitive_events[0];
  assert.equal(event.timing_relevance, "now");
  assert.equal(event.source_label, "Test Events Calendar");
  assert.equal(event.source_url, "https://calendar.test/ics/athens-market-1");
  assert.equal(event.event_language, "el");
});

test("cancelled iCal event and expired explicit-now REST event stay stale", async () => {
  const cancelled = mapEventsCalendarEventToRaw(extractIcalEvents(icsFixture({ status: "CANCELLED" }))[0]);
  assert.equal(cancelled.freshness, "stale");

  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [
      provider({
        fetcher: async () =>
          response(JSON.stringify({
            events: [
              tecEvent({
                start_date: "2020-01-01T18:00:00Z",
                end_date: "2020-01-01T22:00:00Z",
                timing_relevance: "now",
              }),
            ],
          })),
      }),
    ],
    enabledStatuses: ["candidate"],
    context: { now: NOW },
  });

  assert.equal(result.time_sensitive_events[0].timing_relevance, "stale");
  assert.equal(result.time_sensitive_events[0].confidence, "low");
});

test("events without their own source URL inherit descriptor provenance honestly", async () => {
  const backedProvider = createEventsCalendarProvider({
    endpoint: "https://calendar.test/feed",
    label: "Backed Calendar",
    sourceUrl: "https://calendar.test/",
    fetcher: async () =>
      response(JSON.stringify({
        events: [
          tecEvent({
            url: "",
            source_url: "",
          }),
        ],
      })),
  });
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [backedProvider],
    enabledStatuses: ["candidate"],
    context: { now: NOW },
  });
  assert.equal(result.time_sensitive_events[0].source_url, "https://calendar.test/");
  assert.equal(result.time_sensitive_events[0].source_label, "Backed Calendar");
  assert.equal(result.time_sensitive_events[0].confidence, "medium");
  assert.ok(!(result.time_sensitive_events[0].timing_reasons || []).includes("missing_source_backing"));
});

test("no endpoint, non-200, thrown error, and malformed payload fail soft", async () => {
  const noEndpoint = createEventsCalendarProvider({
    sourceUrl: "https://calendar.test/",
    fetcher: async () => response(JSON.stringify({ events: [tecEvent()] })),
  });
  assert.deepEqual(
    (await collectPulseSourcesForCity(city, {
      providerSpecs: [noEndpoint],
      enabledStatuses: ["candidate"],
      context: { now: NOW },
    })).time_sensitive_events,
    [],
  );

  assert.deepEqual(
    (await collectPulseSourcesForCity(city, {
      providerSpecs: [provider({ fetcher: async () => ({ ok: false, status: 503 }) })],
      enabledStatuses: ["candidate"],
      context: { now: NOW },
    })).time_sensitive_events,
    [],
  );

  const thrown = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ fetcher: async () => { throw new Error("boom"); } })],
    enabledStatuses: ["candidate"],
    context: { now: NOW },
  });
  assert.deepEqual(thrown.time_sensitive_events, []);
  assert.equal(thrown.source_status[0].status, "ok", "fail-soft inside collect, not a registry failure");

  assert.deepEqual(extractEventsCalendarSourceEvents("{not json", { format: "json" }), []);
});

test("resolveDefaultEventsCalendarProvider is null without env and candidate provider with env", () => {
  assert.equal(resolveDefaultEventsCalendarProvider({}), null);
  const built = resolveDefaultEventsCalendarProvider({
    PARRANDA_EVENTS_CALENDAR_SOURCE: "https://calendar.test/events.ics",
    PARRANDA_EVENTS_CALENDAR_FORMAT: "ical",
    PARRANDA_EVENTS_CALENDAR_LABEL: "City calendar",
    PARRANDA_EVENTS_CALENDAR_LICENSE: "CC-BY 4.0",
  });
  assert.ok(built && built.descriptor);
  assert.equal(built.descriptor.label, "City calendar");
  assert.equal(built.descriptor.status, "candidate");
  assert.equal(built.descriptor.license_label, "CC-BY 4.0");
});
