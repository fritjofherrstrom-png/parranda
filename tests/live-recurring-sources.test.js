"use strict";

// Selected-day Live across reviewed source adapters: a recurring entry may be
// listed under a selected day only when its source states that day. Generic
// manifests and hosts; the date gate, not any source rule, decides the bucket.
// 9 and 16 July 2026 are Thursdays, 10 July a Friday, 13 July a Monday.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collectAnchorEvents,
  resolveEventFeedRegistry,
} = require("../server/place-candidates/agnostic-event-supply");

const ANCHOR = { lat: 59.3293, lng: 18.0686 };
const BBOX = [17.8, 59.2, 18.3, 59.45];
const NOW = "2026-07-08T10:00:00.000Z";

function reviewedSource(entry) {
  const [source] = resolveEventFeedRegistry({
    PARRANDA_EVENT_FEEDS: JSON.stringify([{
      bbox: BBOX,
      timezone: "Europe/Stockholm",
      source_tier: "official",
      confidence: "medium",
      status: "active",
      ...entry,
    }]),
  });
  return source;
}

async function nearbyVenue() {
  return [{
    lat: ANCHOR.lat + 0.001,
    lng: ANCHOR.lng + 0.001,
    confidence: "medium",
    provenance: "trusted_test_resolver",
    attribution: "Test fixture",
  }];
}

function titles(bucket) {
  return bucket.map((event) => event.title).sort();
}

function assertNeverWidenedIntoDaily(...buckets) {
  for (const event of buckets.flat()) {
    assert.notEqual(event.time_window?.kind, "daily", `${event.title} must not be widened into daily`);
  }
}

function textResponse(url, body) {
  return { ok: true, status: 200, url: String(url), text: async () => body };
}

test("reviewed public-events API rows reach a selected day only on listed sessions", async () => {
  const source = reviewedSource({
    id: "reviewed-events-api",
    label: "Reviewed events API",
    adapter: "localized_events_api",
    endpoint: "https://events.example/api/public-v1/events/",
    source_language: "sv",
    source_family: "official_tourism_open_api",
    source_identity: "events.example",
  });
  const record = (id, title, overrides) => ({
    id,
    title: { sv: title },
    external_website_url: `https://events.example/${id}`,
    venue_name: "Kajscenen",
    address: "Kajvägen 1",
    location: { latitude: ANCHOR.lat + 0.001, longitude: ANCHOR.lng + 0.001 },
    start_date: "2026-07-06",
    end_date: "2026-07-19",
    categories: [{ title: "Music", slug: "music", subcategories: [] }],
    ...overrides,
  });
  const payload = {
    results: [
      record("thursday-series", "Torsdagskväll på kajen", {
        schedule: {
          range: {},
          dates: [
            { date: "2026-07-09", start_time: "18:00", end_time: "21:00" },
            { date: "2026-07-16", start_time: "18:00", end_time: "21:00" },
          ],
        },
      }),
      record("unstated-days", "Sommarutställning", { start_time: "10:00", end_time: "17:00" }),
    ],
  };
  const collect = (selectedDate) => collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    selectedDate,
    registry: [source],
    fetcher: async (url) => textResponse(url, JSON.stringify(payload)),
  });

  const friday = await collect("2026-07-10");
  assert.deepEqual(titles(friday.tonight), []);
  assert.deepEqual(titles(friday.this_week), ["Sommarutställning", "Torsdagskväll på kajen"]);
  const thursday = await collect("2026-07-09");
  assert.deepEqual(titles(thursday.tonight), ["Torsdagskväll på kajen"]);
  assert.deepEqual(titles(thursday.this_week), ["Sommarutställning"]);
  assertNeverWidenedIntoDaily(friday.tonight, friday.this_week, thursday.tonight, thursday.this_week);
});

const WIX_ROOT = "https://destination.example/sitemap.xml";
const WIX_CHILD = "https://destination.example/dynamic-events_0_5000-sitemap.xml";
const WIX_EVENTS = {
  "https://destination.example/events-1/summer-exhibition/101": {
    title: "Sommarutställning",
    date: "1 juli - 31 augusti",
    time: "Tis–sön 11.00–17.00",
  },
  "https://destination.example/events-1/harbour-market/102": {
    title: "Hamnmarknad",
    date: "6 juli - 19 juli",
    time: "10:00 - 16:00",
  },
};

function wixDetailHtml(url, { title, date, time }) {
  return `<!doctype html><html lang="sv"><head>
    <meta name="generator" content="Wix.com Website Builder">
    <meta property="og:title" content="${title}">
    <link rel="canonical" href="${url}">
    </head><body>
    <div data-testid="richTextElement"><h1>${title}</h1></div><!--/$-->
    <div data-testid="richTextElement"><h2>När:</h2></div><!--/$-->
    <div data-testid="richTextElement"><p>${date}</p></div><!--/$-->
    <div data-testid="richTextElement"><h2>Var:</h2></div><!--/$-->
    <div data-testid="richTextElement"><p>Hamnhallen<br>Hamngatan 2<br>123 45 Testhamn</p></div><!--/$-->
    <div data-testid="richTextElement"><h2>Öppettider</h2></div><!--/$-->
    <div data-testid="richTextElement"><p>${time}</p></div><!--/$-->
    </body></html>`;
}

test("reviewed Wix opening hours reach a selected day only on stated weekdays", async () => {
  const source = reviewedSource({
    id: "reviewed-destination-calendar",
    label: "Reviewed destination calendar",
    adapter: "wix_sitemap",
    endpoint: WIX_ROOT,
    source_language: "sv",
    source_tier: "verified",
    source_family: "official_tourism_calendar",
    event_path_prefix: "/events-1/",
    detail_limit: 2,
  });
  const fetcher = async (url) => {
    const value = String(url);
    if (value === WIX_ROOT) {
      return textResponse(url, `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" generatedBy="WIX">
          <sitemap><loc>${WIX_CHILD}</loc><lastmod>2026-07-01</lastmod></sitemap>
        </sitemapindex>`);
    }
    if (value === WIX_CHILD) {
      return textResponse(url, `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" generatedBy="WIX">
          ${Object.keys(WIX_EVENTS).map((loc) => `<url><loc>${loc}</loc><lastmod>2026-07-01</lastmod></url>`).join("")}
        </urlset>`);
    }
    if (WIX_EVENTS[value]) return textResponse(url, wixDetailHtml(value, WIX_EVENTS[value]));
    throw new Error(`unexpected fixture URL: ${value}`);
  };
  const collect = (selectedDate) => collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    selectedDate,
    registry: [source],
    venueResolver: nearbyVenue,
    fetcher,
  });

  // Opening hours "Tis–sön": the exhibition is closed on Mondays.
  const monday = await collect("2026-07-13");
  assert.deepEqual(titles(monday.tonight), []);
  assert.deepEqual(titles(monday.this_week), ["Hamnmarknad", "Sommarutställning"]);
  const exhibition = monday.this_week.find((event) => event.title === "Sommarutställning");
  assert.equal(exhibition.time_window.kind, "occurrences");
  assert.equal(monday.this_week.find((event) => event.title === "Hamnmarknad").time_window.kind, "period");

  const tuesday = await collect("2026-07-14");
  assert.deepEqual(titles(tuesday.tonight), ["Sommarutställning"]);
  assert.deepEqual(titles(tuesday.this_week), ["Hamnmarknad"]);
  assertNeverWidenedIntoDaily(monday.tonight, monday.this_week, tuesday.tonight, tuesday.this_week);
});

test("reviewed programme rows under a span heading never claim a selected day", async () => {
  const source = reviewedSource({
    id: "reviewed-festival-programme",
    label: "Reviewed festival programme",
    adapter: "official_program_article",
    endpoint: "https://city.example/news/harbour-festival",
    source_language: "en",
    confidence: "low",
    source_family: "official_municipal_calendar",
    source_identity: "city.example",
    terms_status: "api_terms_compatible",
    source_health: "healthy",
  });
  const html = [
    '<html lang="en"><body>',
    "<h1>Harbour festival 2026</h1>",
    "<h2>Programme at Harbour stage</h2>",
    "<h3>10-12 July</h3>",
    "<ul><li>18:00 Opening concert</li><li>20:00 Night market</li></ul>",
    "<h3>13 July</h3>",
    "<ul><li>19:00 Closing show</li></ul>",
    "<h3>Every day</h3>",
    "<ul><li>10-12 July daily 10:00-17:00 Makers market</li></ul>",
    "</body></html>",
  ].join("");
  const out = await collectAnchorEvents({
    anchor: ANCHOR,
    now: NOW,
    selectedDate: "2026-07-11",
    registry: [source],
    placeContext: { locality: "Harbour town", country: "Sweden" },
    venueResolver: nearbyVenue,
    fetcher: async (url) => textResponse(url, html),
  });

  // The festival span says when the programme runs, not which day each
  // timed row happens; only the row stating daily sessions is on 11 July.
  assert.deepEqual(titles(out.tonight), ["Makers market"]);
  assert.equal(out.tonight[0].time_window.kind, "daily");
  assert.deepEqual(titles(out.this_week), ["Closing show", "Night market", "Opening concert"]);
  for (const title of ["Opening concert", "Night market"]) {
    assert.equal(out.this_week.find((event) => event.title === title).time_window.kind, "period", title);
  }
});
