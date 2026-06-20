const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createHtmlVenueCalendarProvider,
  extractHtmlVenueCalendarEvents,
  extractHtmlVenueEventDetail,
} = require("../server/pulse-sources/html-venue-calendar-provider");
const { collectPulseSourcesForCity } = require("../server/pulse-sources/provider-registry");

const city = { key: "venueville", label: "Venueville" };
const NOW = new Date("2026-06-20T17:30:00.000Z");

function listingHtml() {
  return `
    <div class="date-container">
      <h2 class="h1 uppercase">Saturday 20.6</h2>
      <ul>
        <li>
          <div class="tease tease--event-calendar" data-date="20 06 2026,">
            <a href="https://venue.test/en/event/blue/" title="Blue Night link"></a>
            <div class="col-1">
              <a href="https://venue.test/en/event/blue/">
                <h2>Blue Night</h2>
              </a>
            </div>
            <div class="category-title">Music</div>
            <h2 class="h3 uppercase">ORGANISER</h2>
            <h2 class="h3">Venue Hall</h2>
          </div>
        </li>
      </ul>
    </div>
  `;
}

function detailHtml() {
  return `
    <div class="block-intro">
      <h1>Blue Night</h1>
      <h2 class="h1">20.6.2026, 21:00</h2>
    </div>
  `;
}

function textResponse(body) {
  return {
    ok: true,
    headers: { get: () => "text/html; charset=UTF-8" },
    text: async () => body,
  };
}

test("extracts dated venue calendar cards from HTML listings", () => {
  const events = extractHtmlVenueCalendarEvents(listingHtml(), {
    baseUrl: "https://venue.test/calendar/",
    date: "2026-06-20",
    timezoneOffset: "+03:00",
    sourceLanguage: "en",
    routeRoleHint: "evening_anchor",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Blue Night");
  assert.equal(events[0].source_url, "https://venue.test/en/event/blue/");
  assert.equal(events[0].starts_at, undefined);
  assert.equal(events[0].listing_date, "2026-06-20");
  assert.equal(events[0].place_context, "Venue Hall");
  assert.deepEqual(events[0].tags, ["Music"]);
  assert.equal(events[0].route_role_hint, "evening_anchor");
});

test("drops venue listing sections before the requested collection date", () => {
  const events = extractHtmlVenueCalendarEvents(`
    <div class="date-container">
      <h2>Friday 19.6</h2>
      <ul><li><div class="tease tease--event-calendar" data-date="19 06 2026,"><a href="/old/" title="Old link"></a></div></li></ul>
    </div>
    ${listingHtml()}
  `, {
    baseUrl: "https://venue.test/calendar/",
    date: "2026-06-20",
    timezoneOffset: "+03:00",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].source_url, "https://venue.test/en/event/blue/");
});

test("detail extraction only accepts a date matching the listing when expectedDate is supplied", () => {
  assert.deepEqual(extractHtmlVenueEventDetail(`
    <div class="block-intro"><h2 class="h1">19.6.2026, 21:00</h2></div>
    <a href="https://webtics.test/">20.6.2026, 22:00</a>
  `, { expectedDate: "2026-06-20", timezoneOffset: "+03:00" }), {
    starts_at: "2026-06-20T22:00:00+03:00",
  });
  assert.deepEqual(extractHtmlVenueEventDetail(`
    <div class="block-intro"><h2 class="h1">19.6.2026, 21:00</h2></div>
  `, { expectedDate: "2026-06-20", timezoneOffset: "+03:00" }), {});
});

test("extracts exact event start time from a venue detail page", () => {
  assert.deepEqual(extractHtmlVenueEventDetail(detailHtml(), { timezoneOffset: "+03:00" }), {
    starts_at: "2026-06-20T21:00:00+03:00",
  });
});

test("HTML venue provider yields normalized source-backed time-sensitive events", async () => {
  const calls = [];
  const provider = createHtmlVenueCalendarProvider({
    endpoint: "https://venue.test/calendar/",
    label: "Venue calendar",
    sourceUrl: "https://venue.test/calendar/",
    status: "active",
    sourceLanguage: "en",
    timezoneOffset: "+03:00",
    routeRoleHint: "evening_anchor",
    fetcher: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/calendar/")) return textResponse(listingHtml());
      if (String(url).endsWith("/event/blue/")) return textResponse(detailHtml());
      throw new Error(`unexpected fetch ${url}`);
    },
  });

  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider],
    context: { date: "2026-06-20", now: NOW },
  });

  assert.deepEqual(calls, ["https://venue.test/calendar/", "https://venue.test/en/event/blue/"]);
  assert.equal(result.time_sensitive_events.length, 1);
  const event = result.time_sensitive_events[0];
  assert.equal(event.title, "Blue Night");
  assert.equal(event.timing_relevance, "tonight");
  assert.equal(event.confidence, "medium");
  assert.equal(event.source_label, "Venue calendar");
  assert.equal(event.source_url, "https://venue.test/en/event/blue/");
  assert.equal(event.place_context, "Venue Hall");
  assert.equal(event.route_role_hint, "evening_anchor");
  assert.equal(result.source_status[0].status, "ok");
  assert.equal(result.source_status[0].time_sensitive_events, 1);
});
