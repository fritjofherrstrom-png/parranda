"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createSitevisionCalendarProvider,
  extractSitevisionCalendarEvents,
  extractSitevisionEventDetail,
  parseSitevisionDateTime,
} = require("../server/pulse-sources/sitevision-calendar-provider");
const { collectPulseSourcesForCity } = require("../server/pulse-sources/provider-registry");
const {
  collectAnchorEvents,
  resolveEventFeedRegistry,
} = require("../server/place-candidates/agnostic-event-supply");

const city = { key: "example", label: "Example" };

function eventArticle({ slug, title, date = "15 juli", time = "18:00–21:00", venue = "Town square" }) {
  return `
    <article class="eventArticle">
      <a class="eventArticleHeading" href="/events/${slug}"><h3>${title}</h3></a>
      <div class="eventInfo"><div class="timeIcon"></div>${date}<div>${time}</div></div>
      <div class="footerText">${venue}</div>
      <span class="externalOrganizerBadge">Association event</span>
    </article>
  `;
}

function listingHtml(rows = [eventArticle({ slug: "summer-market", title: "Summer market" })]) {
  return `
    <main class="sv-ws-event-calendar">
      <div class="eventsListContainer">${rows.join("")}</div>
    </main>
  `;
}

function detailHtml() {
  return `
    <h1>Summer market</h1>
    <span id="Datumochtid">Date and time</span>
    <p>25 juni–16 juli, 18.00–21.00</p>
    <span id="Aterkommandetillfallen">Recurring occasions</span>
    <p>Every Thursday</p>
    <p><strong>Evenemangsplats:</strong><br>Town museum</p>
    <p><strong>Adress:</strong><br>Example street 1</p>
    <a href="https://www.google.com/maps/@55.556437,14.347752,200m">Map</a>
  `;
}

function textResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  };
}

test("extracts factual Sitevision listing atoms with reviewed local timezone", () => {
  const events = extractSitevisionCalendarEvents(listingHtml(), {
    baseUrl: "https://municipality.example/calendar",
    date: "2026-07-15",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Summer market");
  assert.equal(events[0].source_url, "https://municipality.example/events/summer-market");
  assert.equal(events[0].starts_at, "2026-07-15T16:00:00.000Z");
  assert.equal(events[0].ends_at, "2026-07-15T19:00:00.000Z");
  assert.equal(events[0].place_context, "Town square");
  assert.deepEqual(events[0].tags, ["community_event"]);
  assert.equal(events[0].event_language, "sv");
  assert.equal(events[0].translation_status, "needed");
});

test("extracts bounded detail facts including recurrence and coordinates", () => {
  const detail = extractSitevisionEventDetail(detailHtml(), {
    expectedDate: "2026-07-15",
    timezone: "Europe/Stockholm",
  });

  assert.equal(detail.starts_at, "2026-07-15T16:00:00.000Z");
  assert.equal(detail.ends_at, "2026-07-15T19:00:00.000Z");
  assert.equal(detail.place_context, "Town museum");
  assert.equal(detail.address, "Example street 1");
  assert.equal(detail.lat, 55.556437);
  assert.equal(detail.lng, 14.347752);
  assert.equal(detail.recurrence, "Every Thursday");
});

test("local clock times fail closed without a reviewed IANA timezone", () => {
  const unresolved = parseSitevisionDateTime("15 juli 18:00–21:00", {
    date: "2026-07-15",
  });
  assert.equal(unresolved.date_key, "2026-07-15");
  assert.equal(unresolved.starts_at, undefined);
  assert.equal(unresolved.ends_at, undefined);

  const result = extractSitevisionCalendarEvents(listingHtml(), {
    baseUrl: "https://municipality.example/calendar",
    date: "2026-07-15",
  });
  assert.equal(result[0].starts_at, undefined);
});

test("provider bounds detail fetches and keeps listing rows when detail enrichment fails", async () => {
  const rows = [
    eventArticle({ slug: "one", title: "One" }),
    eventArticle({ slug: "two", title: "Two" }),
    eventArticle({ slug: "three", title: "Three" }),
  ];
  const calls = [];
  const provider = createSitevisionCalendarProvider({
    endpoint: "https://municipality.example/calendar",
    sourceUrl: "https://municipality.example/calendar",
    label: "Municipal calendar",
    status: "active",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    detailLimit: 2,
    detailConcurrency: 1,
    fetcher: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/calendar")) return textResponse(listingHtml(rows));
      if (String(url).endsWith("/events/one")) return textResponse(detailHtml());
      throw new Error("temporary detail failure");
    },
  });

  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider],
    context: { date: "2026-07-15", now: new Date("2026-07-15T15:30:00.000Z") },
  });

  assert.deepEqual(calls, [
    "https://municipality.example/calendar",
    "https://municipality.example/events/one",
    "https://municipality.example/events/two",
  ]);
  assert.equal(result.time_sensitive_events.length, 3);
  assert.equal(result.source_status[0].collection_status, "ok");
  assert.equal(result.source_status[0].time_sensitive_events, 3);
  const enriched = result.time_sensitive_events.find((event) => event.title === "One");
  assert.equal(enriched.lat, 55.556437);
  assert.equal(enriched.timing_relevance, "tonight");
  assert.equal(enriched.source_label, "Municipal calendar");
});

test("candidate Sitevision providers stay default-off until explicitly enabled", async () => {
  const provider = createSitevisionCalendarProvider({
    endpoint: "https://municipality.example/calendar",
    sourceUrl: "https://municipality.example/calendar",
    fetchDetails: false,
    timezone: "Europe/Stockholm",
    fetcher: async () => textResponse(listingHtml()),
  });

  const skipped = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider],
    context: { date: "2026-07-15" },
  });
  assert.deepEqual(skipped.time_sensitive_events, []);
  assert.equal(skipped.source_status[0].status, "skipped");
  assert.equal(skipped.source_status[0].reason, "status_candidate");

  const enabled = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider],
    enabledStatuses: ["candidate"],
    context: { date: "2026-07-15", now: new Date("2026-07-15T15:30:00.000Z") },
  });
  assert.equal(enabled.time_sensitive_events.length, 1);
});

test("provider distinguishes unavailable setup, proven empty, and oversized responses", async () => {
  const unavailableProvider = createSitevisionCalendarProvider({
    sourceUrl: "https://municipality.example/calendar",
    status: "active",
    fetcher: async () => textResponse(listingHtml()),
  });
  const unavailable = await collectPulseSourcesForCity(city, {
    providerSpecs: [unavailableProvider],
  });
  assert.equal(unavailable.source_status[0].collection_status, "unavailable");

  const emptyProvider = createSitevisionCalendarProvider({
    endpoint: "https://municipality.example/calendar",
    status: "active",
    fetchDetails: false,
    fetcher: async () => textResponse("<main>No events</main>"),
  });
  const empty = await collectPulseSourcesForCity(city, { providerSpecs: [emptyProvider] });
  assert.equal(empty.source_status[0].collection_status, "empty");
  assert.equal(empty.source_status[0].collection_reason, "source_empty");

  const oversizedProvider = createSitevisionCalendarProvider({
    endpoint: "https://municipality.example/calendar",
    status: "active",
    maxBytes: 1024,
    fetcher: async () => textResponse("x".repeat(1025)),
  });
  const oversized = await collectPulseSourcesForCity(city, { providerSpecs: [oversizedProvider] });
  assert.equal(oversized.source_status[0].collection_status, "failed");
  assert.equal(oversized.source_status[0].collection_reason, "provider_failed");
});

test("provider timeout remains active while the response body is read", async () => {
  const provider = createSitevisionCalendarProvider({
    endpoint: "https://municipality.example/calendar",
    status: "active",
    timeoutMs: 50,
    fetcher: async (_url, options) => ({
      ok: true,
      status: 200,
      text: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    }),
  });

  const result = await collectPulseSourcesForCity(city, { providerSpecs: [provider] });
  assert.equal(result.source_status[0].collection_status, "failed");
  assert.equal(result.source_status[0].collection_reason, "source_timeout");
});

test("reviewed Sitevision manifest joins the bounded anchor acquisition path", async () => {
  const [source] = resolveEventFeedRegistry({
    PARRANDA_EVENT_FEEDS: JSON.stringify([{
      id: "reviewed-regional-calendar",
      label: "Reviewed regional calendar",
      adapter: "sitevision_calendar",
      endpoint: "https://municipality.example/calendar",
      bbox: [14.0, 55.2, 14.7, 55.8],
      timezone: "Europe/Stockholm",
      source_language: "sv",
      source_tier: "official",
      confidence: "medium",
      source_family: "official_municipal_calendar",
      status: "active",
    }]),
  });
  const result = await collectAnchorEvents({
    anchor: { lat: 55.556437, lng: 14.347752 },
    now: "2026-07-15T15:30:00.000Z",
    registry: [source],
    fetcher: async (url) => {
      if (String(url).endsWith("/calendar")) return textResponse(listingHtml());
      if (String(url).endsWith("/events/summer-market")) return textResponse(detailHtml());
      throw new Error("unexpected source URL");
    },
  });

  assert.equal(result.coverage, "covered");
  assert.equal(result.tonight.length, 1);
  assert.equal(result.tonight[0].title, "Summer market");
  assert.equal(result.tonight[0].source_label, "Reviewed regional calendar");
  assert.equal(result.tonight[0].trust_level, "medium");
  assert.equal(result.feeds[0].adapter, "sitevision_calendar");
  assert.equal(result.acquisition.source_health.status, "healthy");
});
