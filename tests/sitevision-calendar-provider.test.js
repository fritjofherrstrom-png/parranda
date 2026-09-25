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

function soleilArticle({
  id = "program-1",
  title = "Open workshop",
  date = "20 juli",
  datetime = "2026-07-20",
  time = "14:00 – 15:00",
  category = "Workshop",
  venue = "City museum",
} = {}) {
  return `
    <article class="item-${id}">
      <a href="/calendar/Programpunkt.html?id=${id}"><h2>${title}</h2></a>
      <time class="dates-kempox" datetime="${datetime}">Datum ${date}</time>
      <dl>
        <dt class="sr-only">Tid</dt><dd>${time}</dd>
        <dt class="sr-only">Kategori</dt><dd>${category}</dd>
        <dt class="sr-only">Lokal</dt><dd>${venue}</dd>
      </dl>
      <p class="description">Editorial description must not enter factual timing atoms.</p>
    </article>
  `;
}

function soleilListingHtml(rows = [soleilArticle()]) {
  return `
    <main class="sv-custom-module sv-se-soleil-eventListingLocal">
      <section>${rows.join("")}</section>
    </main>
  `;
}

function detailHtml(dateText = "25 juni–16 juli, 18.00–21.00") {
  return `
    <h1>Summer market</h1>
    <span id="Datumochtid">Date and time</span>
    <p>${dateText}</p>
    <span id="Aterkommandetillfallen">Recurring occasions</span>
    <p>Every Thursday</p>
    <p><strong>Evenemangsplats:</strong><br>Town museum</p>
    <p><strong>Adress:</strong><br>Example street 1</p>
    <a href="https://www.google.com/maps/@55.556437,14.347752,200m">Map</a>
  `;
}

// Sitevision detail pages expose one heading anchor per section, wrapped in
// portlets whose layout ids start with "svid". The real reviewed pages were not
// observable from the development session; this fixture follows the adapter's
// existing anchor contract with the reviewed defect's shape: an explicit range,
// one clock range and an "Återkommande tillfällen" section.
function recurringDetailHtml({
  timing = "25 juni–16 juli, 18.00–21.00",
  recurrence,
  title = "Sommarkväll på torget",
} = {}) {
  return `
    <div class="sv-text-portlet" id="svid12_1a"><h1 class="heading">${title}</h1></div>
    <div class="sv-text-portlet" id="svid12_2b"><h2 class="subheading" id="Datumochtid">Datum och tid</h2></div>
    <div class="sv-text-portlet" id="svid12_3c"><p class="normal">${timing}</p></div>
    ${recurrence == null ? "" : `<div class="sv-text-portlet" id="svid12_4d">
      <h2 class="subheading" id="Aterkommandetillfallen">Återkommande tillfällen</h2>
    </div>
    <div class="sv-text-portlet" id="svid12_5e">${recurrence}</div>`}
    <div class="sv-text-portlet" id="svid12_6f">
      <p class="normal"><strong>Evenemangsplats:</strong><br>Stortorget</p>
    </div>
    <a href="https://www.google.com/maps/@55.556437,14.347752,200m">Karta</a>
  `;
}

const THURSDAYS = ["2026-06-25", "2026-07-02", "2026-07-09", "2026-07-16"];

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

test("extracts factual atoms from the generic Sitevision Soleil listing layout", () => {
  const events = extractSitevisionCalendarEvents(soleilListingHtml(), {
    baseUrl: "https://municipality.example/program",
    date: "2026-07-20",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Open workshop");
  assert.equal(
    events[0].source_url,
    "https://municipality.example/calendar/Programpunkt.html?id=program-1",
  );
  assert.equal(events[0].starts_at, "2026-07-20T12:00:00.000Z");
  assert.equal(events[0].ends_at, "2026-07-20T13:00:00.000Z");
  assert.equal(events[0].place_context, "City museum");
  assert.deepEqual(events[0].tags, ["Workshop"]);
  assert.equal(events[0].time_window.kind, "continuous");
  assert.doesNotMatch(events[0].time_window.label, /Editorial description/);
});

test("Sitevision ranges with one clock keep period semantics, never daily or continuous", () => {
  // The source states a span and a session clock, not that every day in the
  // span carries a session. Collapsing it into one continuous run and widening
  // it into "daily" would both claim days the source never stated.
  const events = extractSitevisionCalendarEvents(soleilListingHtml([
    soleilArticle({
      id: "summer-program",
      title: "Summer studio",
      date: "20 juli – 7 augusti",
      time: "10:00 – 17:00",
    }),
  ]), {
    baseUrl: "https://municipality.example/program",
    date: "2026-07-20",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].starts_at, undefined);
  assert.equal(events[0].ends_at, undefined);
  assert.equal(events[0].starts_on, "2026-07-20");
  assert.equal(events[0].ends_on, "2026-08-07");
  assert.equal(events[0].time_window.kind, "period");
  assert.equal(events[0].time_window.starts_on, "2026-07-20");
  assert.equal(events[0].time_window.ends_on, "2026-08-07");
  assert.equal(events[0].time_window.local_start, "10:00");
  assert.equal(events[0].time_window.local_end, "17:00");
  assert.equal(events[0].time_window.timezone, "Europe/Stockholm");
  assert.match(events[0].time_window.label, /20 juli .* 7 augusti/i);
});

test("a range becomes daily only when the source states daily sessions", () => {
  const stated = parseSitevisionDateTime("25 juni–16 juli, dagligen 18.00–21.00", {
    date: "2026-06-25",
    timezone: "Europe/Stockholm",
  });
  assert.equal(stated.time_window.kind, "daily");
  assert.equal(stated.time_window.starts_on, "2026-06-25");
  assert.equal(stated.time_window.ends_on, "2026-07-16");
  assert.equal(stated.time_window.local_start, "18:00");
  assert.equal(stated.time_window.local_end, "21:00");

  for (const recurrence of ["Dagligen", "Varje dag", "Alla dagar", "måndag till söndag", "mån–sön"]) {
    const detail = extractSitevisionEventDetail(recurringDetailHtml({ recurrence: `<p>${recurrence}</p>` }), {
      expectedDate: "2026-07-09",
      timezone: "Europe/Stockholm",
    });
    assert.equal(detail.time_window.kind, "daily", recurrence);
  }

  // An exception, however small, is not a daily statement.
  const exception = parseSitevisionDateTime("25 juni–16 juli, alla dagar utom måndag 18.00–21.00", {
    date: "2026-06-25",
    timezone: "Europe/Stockholm",
  });
  assert.equal(exception.time_window.kind, "period");
});

test("Sitevision date-only ranges stay local all-day facts", () => {
  const events = extractSitevisionCalendarEvents(soleilListingHtml([
    soleilArticle({
      id: "exhibition",
      title: "Local exhibition",
      date: "20 juli – 7 augusti",
      time: "",
      category: "Exhibition",
    }),
  ]), {
    baseUrl: "https://municipality.example/program",
    date: "2026-07-20",
    timezone: "Europe/Stockholm",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].starts_at, undefined);
  assert.equal(events[0].starts_on, "2026-07-20");
  assert.equal(events[0].ends_on, "2026-08-07");
  assert.equal(events[0].time_window.kind, "all_day");
});

test("extracts bounded detail facts including recurrence and coordinates", () => {
  const detail = extractSitevisionEventDetail(detailHtml(), {
    expectedDate: "2026-07-15",
    timezone: "Europe/Stockholm",
  });

  assert.equal(detail.starts_at, undefined);
  assert.equal(detail.ends_at, undefined);
  assert.equal(detail.starts_on, "2026-06-25");
  assert.equal(detail.ends_on, "2026-07-16");
  // "Every Thursday" inside the stated range: the Thursdays, never every day.
  assert.equal(detail.time_window.kind, "occurrences");
  assert.deepEqual(detail.time_window.dates, THURSDAYS);
  assert.equal(detail.time_window.local_start, "18:00");
  assert.equal(detail.time_window.local_end, "21:00");
  assert.equal(detail.time_window.timezone, "Europe/Stockholm");
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
  // One stated date stays one listed occurrence; it is never a daily schedule.
  assert.equal(unresolved.time_window.kind, "occurrences");
  assert.deepEqual(unresolved.time_window.dates, ["2026-07-15"]);
  assert.equal(unresolved.time_window.timezone, undefined);

  const result = extractSitevisionCalendarEvents(listingHtml(), {
    baseUrl: "https://municipality.example/calendar",
    date: "2026-07-15",
  });
  assert.equal(result[0].starts_at, undefined);
  assert.equal(result[0].time_window.kind, "occurrences");
});

test("recurring detail dates become explicit occurrences, never a daily range", () => {
  const shapes = {
    lineBreaks: `<p class="normal">torsdag 25 juni, 18.00–21.00<br>torsdag 2 juli, 18.00–21.00<br>
      torsdag 9 juli, 18.00–21.00<br>torsdag 16 juli, 18.00–21.00</p>`,
    list: `<ul><li>tors 25 juni kl. 18.00–21.00</li><li>tors 2 juli kl. 18.00–21.00</li>
      <li>tors 9 juli kl. 18.00–21.00</li><li>tors 16 juli kl. 18.00–21.00</li></ul>`,
    sharedMonth: `<p class="normal">25 juni samt 2, 9 och 16 juli</p>`,
    explicitYears: `<p>2026-06-25; 2026-07-02; 2026-07-09; 2026-07-16</p>`,
    highlightedDates: `<p><strong>25 juni</strong>, <strong>2 juli</strong>, <strong>9 juli</strong>, <strong>16 juli</strong></p>`,
    weekdayRule: `<p class="normal">Varje torsdag</p>`,
    pluralWeekday: `<p class="normal">Torsdagar kl. 18.00–21.00</p>`,
  };
  for (const [shape, recurrence] of Object.entries(shapes)) {
    const detail = extractSitevisionEventDetail(recurringDetailHtml({ recurrence }), {
      expectedDate: "2026-07-09",
      timezone: "Europe/Stockholm",
    });
    assert.equal(detail.time_window.kind, "occurrences", shape);
    assert.deepEqual(detail.time_window.dates, THURSDAYS, shape);
    assert.equal(detail.time_window.local_start, "18:00", shape);
    assert.equal(detail.time_window.local_end, "21:00", shape);
    assert.equal(detail.time_window.timezone, "Europe/Stockholm", shape);
    assert.equal(detail.starts_at, undefined, shape);
    assert.equal(detail.starts_on, "2026-06-25", shape);
    assert.equal(detail.ends_on, "2026-07-16", shape);
    assert.equal(detail.place_context, "Stortorget", shape);
    assert.ok(detail.recurrence, `${shape}: the source recurrence text stays inspectable`);
  }
});

test("weekday rules expand only inside an explicit bounded range", () => {
  const weekdays = extractSitevisionEventDetail(recurringDetailHtml({
    timing: "22 juni–3 juli, 10.00–15.00",
    recurrence: "<p>Måndag–fredag kl. 10.00–15.00</p>",
  }), { expectedDate: "2026-06-22", timezone: "Europe/Stockholm" });
  assert.equal(weekdays.time_window.kind, "occurrences");
  assert.deepEqual(weekdays.time_window.dates, [
    "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26",
    "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03",
  ]);

  // Longer than the reviewed expansion bound: shown as a period, not expanded.
  const tooLong = extractSitevisionEventDetail(recurringDetailHtml({
    timing: "1 januari–30 juni, 18.00–21.00",
    recurrence: "<p>Varje torsdag</p>",
  }), { expectedDate: "2026-01-01", timezone: "Europe/Stockholm" });
  assert.equal(tooLong.time_window.kind, "period");

  // One stated date plus an open-ended rule: only the stated date is claimed.
  const openEnded = extractSitevisionEventDetail(recurringDetailHtml({
    timing: "25 juni, 18.00–21.00",
    recurrence: "<p>Varje torsdag</p>",
  }), { expectedDate: "2026-06-25", timezone: "Europe/Stockholm" });
  assert.equal(openEnded.time_window.kind, "continuous");
  assert.equal(openEnded.starts_at, "2026-06-25T16:00:00.000Z");
  assert.equal(openEnded.ends_at, "2026-06-25T19:00:00.000Z");

  // One stated date plus listed dates: the stated date is one of them.
  const listed = extractSitevisionEventDetail(recurringDetailHtml({
    timing: "25 juni, 18.00–21.00",
    recurrence: "<p>2 juli, 9 juli</p>",
  }), { expectedDate: "2026-06-25", timezone: "Europe/Stockholm" });
  assert.deepEqual(listed.time_window.dates, ["2026-06-25", "2026-07-02", "2026-07-09"]);
});

test("unreadable, contradictory or truncated recurrence keeps honest period semantics", () => {
  const cases = {
    alternateWeeks: "<p>Varannan torsdag</p>",
    exception: "<p>Dagligen utom måndag</p>",
    wrongWeekday: "<p>fredag 25 juni</p>",
    outsideRange: "<p>2 juli, 23 juli</p>",
    clockConflict: "<p>Torsdagar kl. 17.00–20.00</p>",
    numericDates: "<p>2/7, 9/7</p>",
    prose: "<p>Se programmet för aktuella datum.</p>",
  };
  for (const [name, recurrence] of Object.entries(cases)) {
    const detail = extractSitevisionEventDetail(recurringDetailHtml({ recurrence }), {
      expectedDate: "2026-07-09",
      timezone: "Europe/Stockholm",
    });
    assert.equal(detail.time_window.kind, "period", name);
    assert.equal(detail.time_window.starts_on, "2026-06-25", name);
    assert.equal(detail.time_window.ends_on, "2026-07-16", name);
    assert.equal(detail.time_window.local_start, "18:00", name);
    assert.equal(detail.starts_at, undefined, name);
  }

  // "Dagligen" on the time line contradicted by a narrower recurrence.
  const contradicted = extractSitevisionEventDetail(recurringDetailHtml({
    timing: "25 juni–16 juli, dagligen 18.00–21.00",
    recurrence: "<p>Torsdagar</p>",
  }), { expectedDate: "2026-07-09", timezone: "Europe/Stockholm" });
  assert.equal(contradicted.time_window.kind, "period");

  // A date-only range with an unreadable recurrence is no longer an every-day fact.
  const dateOnly = extractSitevisionEventDetail(recurringDetailHtml({
    timing: "25 juni–16 juli",
    recurrence: "<p>Varannan lördag</p>",
  }), { expectedDate: "2026-07-09", timezone: "Europe/Stockholm" });
  assert.equal(dateOnly.time_window.kind, "period");
  assert.equal(dateOnly.time_window.local_start, undefined);

  // A recurrence section with no readable text still says the entry recurs.
  const emptySection = extractSitevisionEventDetail(recurringDetailHtml({
    timing: "25 juni–16 juli",
    recurrence: "",
  }), { expectedDate: "2026-07-09", timezone: "Europe/Stockholm" });
  assert.equal(emptySection.time_window.kind, "period");

  // A section that does not end inside the byte bound may hide later dates.
  const longTail = "<p>" + "x".repeat(9000) + "</p>";
  const truncated = extractSitevisionEventDetail(
    recurringDetailHtml({ recurrence: `<p>2 juli</p>${longTail}` }),
    { expectedDate: "2026-07-09", timezone: "Europe/Stockholm" },
  );
  assert.equal(truncated.time_window.kind, "period");
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
  // The detail says "Every Thursday"; 15 July 2026 is a Wednesday. The listing
  // instant for that Wednesday must not survive beside the detail's dates.
  assert.equal(enriched.timing_relevance, "future");
  assert.equal(enriched.starts_at, undefined);
  assert.equal(enriched.ends_at, undefined);
  assert.equal(enriched.source_label, "Municipal calendar");
  assert.equal(enriched.starts_on, "2026-06-25");
  assert.equal(enriched.ends_on, "2026-07-16");
  assert.equal(enriched.time_window.kind, "occurrences");
  assert.deepEqual(enriched.time_window.dates, THURSDAYS);
  const listingOnly = result.time_sensitive_events.find((event) => event.title === "Two");
  assert.equal(listingOnly.time_window.kind, "continuous", "a failed detail keeps the listing row");
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
    now: "2026-07-15T16:30:00.000Z",
    registry: [source],
    fetcher: async (url) => {
      if (String(url).endsWith("/calendar")) return textResponse(listingHtml());
      if (String(url).endsWith("/events/summer-market")) {
        return textResponse(detailHtml("15 juli, 18.00–21.00"));
      }
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

test("selected-day Live never places a recurring municipal entry on a day its source does not state", async () => {
  // Reproduces the reviewed defect shape: recurring entries with an explicit
  // range and clock were widened into "daily" and listed on a selected Friday
  // they do not occur on. Generic manifest and host; no municipality rule.
  const [source] = resolveEventFeedRegistry({
    PARRANDA_EVENT_FEEDS: JSON.stringify([{
      id: "reviewed-recurring-calendar",
      label: "Reviewed municipal calendar",
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
  const listing = listingHtml([
    eventArticle({ slug: "thursday-series", title: "Sommarkväll på torget", date: "25 juni - 16 juli" }),
    eventArticle({ slug: "unstated-days", title: "Kvällsvandring", date: "25 juni - 16 juli" }),
    eventArticle({ slug: "friday-concert", title: "Konsert i parken", date: "10 juli", time: "19:00–21:00" }),
  ]);
  const details = {
    "/events/thursday-series": recurringDetailHtml({
      title: "Sommarkväll på torget",
      recurrence: "<p>torsdag 25 juni<br>torsdag 2 juli<br>torsdag 9 juli<br>torsdag 16 juli</p>",
    }),
    "/events/unstated-days": recurringDetailHtml({
      title: "Kvällsvandring",
      recurrence: "<p>Varannan vecka, se arrangören.</p>",
    }),
    "/events/friday-concert": recurringDetailHtml({
      title: "Konsert i parken",
      timing: "10 juli, 19.00–21.00",
      recurrence: null,
    }),
  };
  const fetcher = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/calendar") return textResponse(listing);
    if (details[path]) return textResponse(details[path]);
    throw new Error(`unexpected fixture URL: ${url}`);
  };
  const collect = (selectedDate) => collectAnchorEvents({
    anchor: { lat: 55.556437, lng: 14.347752 },
    now: "2026-07-08T10:00:00.000Z",
    selectedDate,
    registry: [source],
    fetcher,
  });

  const friday = await collect("2026-07-10");
  assert.deepEqual(friday.tonight.map((event) => event.title), ["Konsert i parken"]);
  assert.deepEqual(friday.this_week.map((event) => event.title).sort(), ["Kvällsvandring", "Sommarkväll på torget"]);
  const series = friday.this_week.find((event) => event.title === "Sommarkväll på torget");
  assert.equal(series.time_window.kind, "occurrences");
  assert.deepEqual(series.time_window.dates, THURSDAYS);
  const unstated = friday.this_week.find((event) => event.title === "Kvällsvandring");
  assert.equal(unstated.time_window.kind, "period");
  assert.equal(unstated.route_eligible, false, "a range without stated days cannot anchor a route");

  const thursday = await collect("2026-07-09");
  assert.deepEqual(thursday.tonight.map((event) => event.title), ["Sommarkväll på torget"]);
  assert.deepEqual(thursday.this_week.map((event) => event.title).sort(), ["Konsert i parken", "Kvällsvandring"]);

  for (const event of [...friday.tonight, ...friday.this_week, ...thursday.tonight, ...thursday.this_week]) {
    assert.notEqual(event.time_window?.kind, "daily", `${event.title} must not be widened into daily`);
  }
});
