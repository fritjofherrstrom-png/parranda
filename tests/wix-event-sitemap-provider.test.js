"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createWixEventSitemapProvider,
  extractWixEventDetail,
  extractWixSitemapDocument,
  parseWixEventTiming,
} = require("../server/pulse-sources/wix-event-sitemap-provider");
const { collectPulseSourcesForCity } = require("../server/pulse-sources/provider-registry");
const {
  collectAnchorEvents,
  resolveEventFeedRegistry,
} = require("../server/place-candidates/agnostic-event-supply");
const { inspectEventSourcePage } = require("../server/pulse-sources/local-event-source-scout");

const city = { key: "region", label: "Test Region" };
const ROOT = "https://destination.example/sitemap.xml";
const CHILD = "https://destination.example/dynamic-events_0_5000-sitemap.xml";
const EVENT_ONE = "https://destination.example/events-1/evening-market/101";
const EVENT_TWO = "https://destination.example/events-1/harbour-concert/102";

function sitemapIndex() {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" generatedBy="WIX">
      <sitemap><loc>${CHILD}</loc><lastmod>2026-07-15</lastmod></sitemap>
      <sitemap><loc>https://destination.example/pages-sitemap.xml</loc></sitemap>
      <sitemap><loc>https://outside.example/events-sitemap.xml</loc></sitemap>
    </sitemapindex>`;
}

function eventSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" generatedBy="WIX">
      <url><loc>${EVENT_ONE}</loc><lastmod>2026-07-15</lastmod></url>
      <url><loc>${EVENT_TWO}</loc><lastmod>2026-07-15</lastmod></url>
      <url><loc>https://destination.example/articles/not-an-event</loc></url>
      <url><loc>https://outside.example/events-1/foreign/999</loc></url>
    </urlset>`;
}

function detailHtml({
  title = "Evening market",
  date = "onsdag 15 juli",
  time = "19:00 - 21:00",
  past = false,
} = {}) {
  return `<!doctype html><html lang="sv"><head>
    <meta name="generator" content="Wix.com Website Builder">
    <meta property="og:title" content="${title}">
    <link rel="canonical" href="${EVENT_ONE}">
    </head><body>
    <div data-testid="richTextElement"><h1>${title}</h1></div><!--/$-->
    <div data-testid="richTextElement"><p>This editorial paragraph must not be copied.</p></div><!--/$-->
    <div data-testid="richTextElement"><h2>När:</h2></div><!--/$-->
    <div data-testid="richTextElement"><p>${date}</p></div><!--/$-->
    <div data-testid="richTextElement"><h2>Var:</h2></div><!--/$-->
    <div data-testid="richTextElement"><h2>Arrangör</h2></div><!--/$-->
    <div data-testid="richTextElement"><p>Local association</p></div><!--/$-->
    <div data-testid="richTextElement"><p>Harbour hall<br>Market street 2<br>123 45 Testhamn</p></div><!--/$-->
    <div data-testid="richTextElement"><h2>Öppettider</h2></div><!--/$-->
    <div data-testid="richTextElement"><p>${time}</p></div><!--/$-->
    <a href="https://www.google.com/maps/@55.556437,14.347752,200m">Map</a>
    ${past ? '<span data-event-status="past">Evenemanget har varit</span>' : ""}
    </body></html>`;
}

function textResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  };
}

function redirectResponse(location, url) {
  return {
    ok: false,
    status: 302,
    url,
    headers: { get: (name) => name.toLowerCase() === "location" ? location : null },
    text: async () => "",
  };
}

test("extracts only same-origin event paths from public Wix sitemaps", () => {
  const root = extractWixSitemapDocument(sitemapIndex(), {
    baseUrl: ROOT,
    baseOrigin: "https://destination.example",
  });
  assert.deepEqual(root.sitemapUrls, [CHILD]);
  assert.deepEqual(root.eventUrls, []);

  const child = extractWixSitemapDocument(eventSitemap(), {
    baseUrl: CHILD,
    baseOrigin: "https://destination.example",
    eventPathPrefix: "/events-1/",
  });
  assert.deepEqual(child.eventUrls.map((row) => row.url), [EVENT_ONE, EVENT_TWO]);
  assert.equal(child.eventUrls[0].lastmod, "2026-07-15");
});

test("extracts factual SSR event atoms without copying editorial content", () => {
  const event = extractWixEventDetail(detailHtml(), {
    sourceUrl: EVENT_ONE,
    collectionDate: "2026-07-15",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
  });

  assert.equal(event.title, "Evening market");
  assert.equal(event.starts_at, "2026-07-15T17:00:00.000Z");
  assert.equal(event.ends_at, "2026-07-15T19:00:00.000Z");
  assert.equal(event.place_context, "Harbour hall, Market street 2, 123 45 Testhamn");
  assert.equal(event.area, "123 45 Testhamn");
  assert.equal(event.source_url, EVENT_ONE);
  assert.equal(event.lat, undefined, "a page-global map is not trusted as event geometry");
  assert.equal(event.lng, undefined);
  assert.equal(event.event_language, "sv");
  assert.equal(event.translation_status, "needed");
  assert.equal(event.description, undefined);
});

test("local Wix clock remains unresolved without a reviewed timezone", () => {
  const timing = parseWixEventTiming("onsdag 15 juli", "19:00 - 21:00", {
    collectionDate: "2026-07-15",
  });
  assert.equal(timing.date_key, "2026-07-15");
  assert.equal(timing.starts_at, undefined);
  assert.equal(timing.ends_at, undefined);

  const event = extractWixEventDetail(detailHtml(), {
    sourceUrl: EVENT_ONE,
    collectionDate: "2026-07-15",
  });
  assert.equal(event.starts_at, undefined);
});

test("multi-day ranges keep their final day and unresolved ranges never collapse", () => {
  const range = parseWixEventTiming("15 juli - 17 juli", "10:00 - 17:00", {
    collectionDate: "2026-07-15",
    timezone: "Europe/Stockholm",
  });
  assert.equal(range.starts_at, "2026-07-15T08:00:00.000Z");
  assert.equal(range.ends_at, "2026-07-17T15:00:00.000Z");
  assert.equal(range.date_key, "2026-07-15");
  assert.equal(range.end_date_key, "2026-07-17");

  const englishRange = parseWixEventTiming("July 15 - July 17", "10:00 - 17:00", {
    collectionDate: "2026-07-15",
    timezone: "Europe/Stockholm",
  });
  assert.equal(englishRange.starts_at, "2026-07-15T08:00:00.000Z");
  assert.equal(englishRange.ends_at, "2026-07-17T15:00:00.000Z");

  const unresolved = parseWixEventTiming("15 juli - senare", "10:00 - 17:00", {
    collectionDate: "2026-07-15",
    timezone: "Europe/Stockholm",
  });
  assert.equal(unresolved.starts_at, undefined);
  assert.equal(unresolved.date_key, undefined);

  const ongoing = extractWixEventDetail(detailHtml({ date: "14 juli - 17 juli" }), {
    sourceUrl: EVENT_ONE,
    collectionDate: "2026-07-15",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
  });
  assert.equal(ongoing.freshness, undefined, "an ongoing range is not stale from its first day");
  assert.equal(ongoing.ends_at, "2026-07-17T19:00:00.000Z");
});

test("organizer contact text is not promoted as a venue address", () => {
  const html = detailHtml().replace(
    '<div data-testid="richTextElement"><p>Harbour hall<br>Market street 2<br>123 45 Testhamn</p></div><!--/$-->',
    '<div data-testid="richTextElement"><p>Local association<br>tel: 0414-26080<br>Epost: info@example.test</p></div><!--/$-->',
  );
  const event = extractWixEventDetail(html, {
    sourceUrl: EVENT_ONE,
    collectionDate: "2026-07-15",
    timezone: "Europe/Stockholm",
  });
  assert.equal(event.place_context, undefined);
});

test("provider bounds detail fetches and yields normalized source-backed events", async () => {
  const calls = [];
  const provider = createWixEventSitemapProvider({
    endpoint: ROOT,
    sourceUrl: "https://destination.example/events",
    label: "Destination calendar",
    status: "active",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    eventPathPrefix: "/events-1/",
    detailLimit: 1,
    detailBudget: 1,
    trust: { source_tier: "verified", confidence: "medium", human_verified: true },
    fetcher: async (url) => {
      calls.push(String(url));
      if (String(url) === ROOT) return textResponse(sitemapIndex());
      if (String(url) === CHILD) return textResponse(eventSitemap());
      if (String(url) === EVENT_ONE) return textResponse(detailHtml());
      throw new Error("unexpected URL");
    },
  });

  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider],
    context: { date: "2026-07-15", now: new Date("2026-07-15T15:30:00.000Z") },
  });

  assert.deepEqual(calls, [ROOT, CHILD, EVENT_ONE]);
  assert.equal(result.time_sensitive_events.length, 1);
  assert.equal(result.time_sensitive_events[0].timing_relevance, "tonight");
  assert.equal(result.time_sensitive_events[0].source_label, "Destination calendar");
  assert.equal(result.time_sensitive_events[0].confidence, "medium");
  assert.equal(result.source_status[0].collection_status, "ok");
});

test("active collection requires reviewed timezone, event path, and sv/en language before fetch", async () => {
  const cases = [
    {
      options: { sourceLanguage: "sv", eventPathPrefix: "/events-1/" },
      reason: "source_timezone_unavailable",
    },
    {
      options: {
        timezone: "Not/A_Timezone",
        sourceLanguage: "sv",
        eventPathPrefix: "/events-1/",
      },
      reason: "source_timezone_unavailable",
    },
    {
      options: { timezone: "Europe/Stockholm", sourceLanguage: "sv" },
      reason: "source_event_path_unavailable",
    },
    {
      options: { timezone: "Europe/Stockholm", eventPathPrefix: "/events-1/" },
      reason: "source_language_unavailable",
    },
    {
      options: {
        timezone: "Europe/Stockholm",
        eventPathPrefix: "/events-1/",
        sourceLanguage: "el",
      },
      reason: "source_language_unsupported",
    },
  ];
  for (const [index, row] of cases.entries()) {
    let fetchCalls = 0;
    const provider = createWixEventSitemapProvider({
      id: `prerequisite-${index}`,
      endpoint: ROOT,
      status: "active",
      ...row.options,
      fetcher: async () => {
        fetchCalls += 1;
        return textResponse(sitemapIndex());
      },
    });
    const result = await collectPulseSourcesForCity(city, { providerSpecs: [provider] });
    assert.equal(fetchCalls, 0);
    assert.equal(result.source_status[0].collection_status, "unavailable");
    assert.equal(result.source_status[0].collection_reason, row.reason);
  }
});

test("manual redirect chains stay same-origin and reject an off-origin hop", async () => {
  const movedRoot = "https://destination.example/moved-sitemap.xml";
  const calls = [];
  const provider = createWixEventSitemapProvider({
    endpoint: ROOT,
    status: "active",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    eventPathPrefix: "/events-1/",
    detailLimit: 1,
    fetcher: async (url, options) => {
      calls.push(String(url));
      assert.equal(options.redirect, "manual");
      if (String(url) === ROOT) return redirectResponse("/moved-sitemap.xml", ROOT);
      if (String(url) === movedRoot) return textResponse(sitemapIndex());
      if (String(url) === CHILD) return textResponse(eventSitemap());
      if (String(url) === EVENT_ONE) return textResponse(detailHtml());
      throw new Error("unexpected URL");
    },
  });
  const success = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider],
    context: { date: "2026-07-15" },
  });
  assert.equal(success.time_sensitive_events.length, 1);
  assert.equal(calls[1], movedRoot);

  const blockedCalls = [];
  const blockedProvider = createWixEventSitemapProvider({
    id: "redirect-blocked",
    endpoint: ROOT,
    status: "active",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    eventPathPrefix: "/events-1/",
    fetcher: async (url) => {
      blockedCalls.push(String(url));
      if (String(url) === ROOT) return redirectResponse("/moved-sitemap.xml", ROOT);
      return redirectResponse("https://outside.example/escape.xml", movedRoot);
    },
  });
  const blocked = await collectPulseSourcesForCity(city, {
    providerSpecs: [blockedProvider],
  });
  assert.deepEqual(blockedCalls, [ROOT, movedRoot]);
  assert.equal(blocked.source_status[0].collection_status, "failed");
  assert.equal(blocked.source_status[0].collection_reason, "source_redirect_cross_origin");
});

test("a followed response reporting an off-origin final URL is rejected", async () => {
  const provider = createWixEventSitemapProvider({
    endpoint: ROOT,
    status: "active",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    eventPathPrefix: "/events-1/",
    fetcher: async () => ({
      ...textResponse(sitemapIndex()),
      url: "https://outside.example/sitemap.xml",
    }),
  });
  const result = await collectPulseSourcesForCity(city, { providerSpecs: [provider] });
  assert.equal(result.source_status[0].collection_reason, "source_redirect_cross_origin");
});

test("successfully fetched but unparseable detail rows report payload failure", async () => {
  const provider = createWixEventSitemapProvider({
    endpoint: ROOT,
    status: "active",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    eventPathPrefix: "/events-1/",
    detailLimit: 1,
    detailBudget: 1,
    fetcher: async (url) => {
      if (String(url) === ROOT) return textResponse(sitemapIndex());
      if (String(url) === CHILD) return textResponse(eventSitemap());
      return textResponse('<html><meta name="generator" content="Wix.com Website Builder"></html>');
    },
  });
  const result = await collectPulseSourcesForCity(city, { providerSpecs: [provider] });
  assert.equal(result.time_sensitive_events.length, 0);
  assert.equal(result.source_status[0].collection_status, "failed");
  assert.equal(result.source_status[0].collection_reason, "source_payload_invalid");
});

test("stale first sitemap rows do not consume the accepted-event limit", async () => {
  const detailCalls = [];
  const provider = createWixEventSitemapProvider({
    endpoint: ROOT,
    status: "active",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    eventPathPrefix: "/events-1/",
    detailLimit: 1,
    detailBudget: 2,
    detailConcurrency: 1,
    fetcher: async (url) => {
      if (String(url) === ROOT) return textResponse(sitemapIndex());
      if (String(url) === CHILD) return textResponse(eventSitemap());
      detailCalls.push(String(url));
      if (String(url) === EVENT_ONE) {
        return textResponse(detailHtml({ title: "Yesterday", date: "14 juli" }));
      }
      return textResponse(detailHtml({ title: "Tonight", date: "15 juli" }));
    },
  });
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider],
    context: { date: "2026-07-15", now: new Date("2026-07-15T15:30:00.000Z") },
  });
  assert.deepEqual(detailCalls, [EVENT_ONE, EVENT_TWO]);
  assert.equal(result.time_sensitive_events.length, 1);
  assert.equal(result.time_sensitive_events[0].title, "Tonight");
  assert.equal(result.time_sensitive_events[0].timing_relevance, "tonight");
});

test("unresolved event timing does not consume the accepted-event limit", async () => {
  const detailCalls = [];
  const provider = createWixEventSitemapProvider({
    endpoint: ROOT,
    status: "active",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    eventPathPrefix: "/events-1/",
    detailLimit: 1,
    detailBudget: 2,
    detailConcurrency: 1,
    fetcher: async (url) => {
      if (String(url) === ROOT) return textResponse(sitemapIndex());
      if (String(url) === CHILD) return textResponse(eventSitemap());
      detailCalls.push(String(url));
      if (String(url) === EVENT_ONE) {
        return textResponse(detailHtml({ title: "Date pending", date: "Datum kommer" }));
      }
      return textResponse(detailHtml({ title: "Tonight", date: "15 juli" }));
    },
  });
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider],
    context: { date: "2026-07-15", now: new Date("2026-07-15T15:30:00.000Z") },
  });
  assert.deepEqual(detailCalls, [EVENT_ONE, EVENT_TWO]);
  assert.equal(result.time_sensitive_events.length, 1);
  assert.equal(result.time_sensitive_events[0].title, "Tonight");
  assert.equal(result.time_sensitive_events[0].timing_relevance, "tonight");
});

test("newer sitemap lastmod wins deterministically before the total detail budget", async () => {
  const calls = [];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset generatedBy="WIX">
      <url><loc>${EVENT_ONE}</loc><lastmod>2026-07-14</lastmod></url>
      <url><loc>${EVENT_TWO}</loc><lastmod>2026-07-16</lastmod></url>
    </urlset>`;
  const provider = createWixEventSitemapProvider({
    endpoint: ROOT,
    status: "active",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    eventPathPrefix: "/events-1/",
    detailLimit: 1,
    detailBudget: 1,
    fetcher: async (url) => {
      calls.push(String(url));
      if (String(url) === ROOT) return textResponse(sitemap);
      return textResponse(detailHtml({ title: "Newest sitemap row", date: "16 juli" }));
    },
  });
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider],
    context: { date: "2026-07-15" },
  });
  assert.deepEqual(calls, [ROOT, EVENT_TWO]);
  assert.equal(result.time_sensitive_events[0].title, "Newest sitemap row");
});

test("candidate Wix providers stay default-off until explicitly enabled", async () => {
  const provider = createWixEventSitemapProvider({
    endpoint: ROOT,
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    eventPathPrefix: "/events-1/",
    detailLimit: 1,
    fetcher: async (url) => {
      if (String(url) === ROOT) return textResponse(sitemapIndex());
      if (String(url) === CHILD) return textResponse(eventSitemap());
      return textResponse(detailHtml());
    },
  });
  const skipped = await collectPulseSourcesForCity(city, { providerSpecs: [provider] });
  assert.equal(skipped.source_status[0].status, "skipped");
  assert.equal(skipped.source_status[0].reason, "status_candidate");

  const enabled = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider],
    enabledStatuses: ["candidate"],
    context: { date: "2026-07-15" },
  });
  assert.equal(enabled.time_sensitive_events.length, 1);
});

test("explicit passed-state remains stale even when its date is current", () => {
  const event = extractWixEventDetail(detailHtml({ past: true }), {
    sourceUrl: EVENT_ONE,
    collectionDate: "2026-07-15",
    timezone: "Europe/Stockholm",
  });
  assert.equal(event.freshness, "stale");
});

test("provider timeout covers the sitemap response body", async () => {
  const provider = createWixEventSitemapProvider({
    endpoint: ROOT,
    status: "active",
    timezone: "Europe/Stockholm",
    sourceLanguage: "sv",
    eventPathPrefix: "/events-1/",
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

test("Wix event pages produce a review-needed generic manifest, never activation", () => {
  const result = inspectEventSourcePage({
    seed: {
      url: "https://destination.example/events",
      label: "Destination calendar",
      family: "official_tourism_calendar",
      trust_tier: "official",
      terms_status: "unknown",
      source_language: "sv",
    },
    html: detailHtml(),
    context: {
      place: { label: "Test Region", language_hints: ["sv"] },
      bounds: [12.5, 55.2, 14.7, 56.0],
    },
  });

  assert.equal(result.candidates[0].adapter, "wix_event_sitemap");
  assert.equal(result.candidates[0].maps_to_existing_provider, true);
  assert.equal(result.manifest_candidates[0].adapter, "wix_event_sitemap");
  assert.equal(result.manifest_candidates[0].endpoint, ROOT);
  assert.equal(result.manifest_candidates[0].status, "review-needed");
});

test("reviewed Wix manifest joins bounded anchor acquisition without city code", async () => {
  const [source] = resolveEventFeedRegistry({
    PARRANDA_EVENT_FEEDS: JSON.stringify([{
      id: "reviewed-destination-calendar",
      label: "Reviewed destination calendar",
      adapter: "wix_sitemap",
      endpoint: ROOT,
      bbox: [12.5, 55.2, 14.7, 56.0],
      timezone: "Europe/Stockholm",
      source_language: "sv",
      source_tier: "verified",
      confidence: "medium",
      source_family: "official_tourism_calendar",
      event_path_prefix: "/events-1/",
      detail_limit: 1,
      status: "active",
    }]),
  });
  const result = await collectAnchorEvents({
    anchor: { lat: 55.55, lng: 14.35 },
    now: "2026-07-15T15:30:00.000Z",
    registry: [source],
    fetcher: async (url) => {
      if (String(url) === ROOT) return textResponse(sitemapIndex());
      if (String(url) === CHILD) return textResponse(eventSitemap());
      if (String(url) === EVENT_ONE) return textResponse(detailHtml());
      throw new Error("unexpected URL");
    },
  });

  assert.equal(result.coverage, "covered");
  assert.equal(result.tonight.length, 0, "address-only evidence is not route-bounded geometry");
  assert.equal(result.acquisition.normalized_event_count, 1);
  assert.deepEqual(
    result.acquisition.rejection_summary.find((row) => row.reason === "missing_event_coordinates"),
    { reason: "missing_event_coordinates", count: 1 },
  );
  assert.equal(result.feeds[0].adapter, "wix_event_sitemap");
});
