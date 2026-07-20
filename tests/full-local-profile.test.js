"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildFullDevEnvironment,
  loadReviewedEventFeeds,
} = require("../scripts/dev-full");
const {
  buildAnchorEventSourcePlan,
} = require("../server/place-candidates/anchor-event-acquisition");
const {
  collectAnchorEvents,
  resolveDefaultEventSupply,
  resolveEventFeedRegistry,
} = require("../server/place-candidates/agnostic-event-supply");
const {
  resolveDefaultOpenDataLoader,
} = require("../server/place-candidates/open-data-loader");
const {
  resolveDefaultPlaceResolver,
} = require("../server/place-candidates/place-resolver");

test("dev:full enables every trusted any-place seam with a writable cache", () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-dev-full-test-"));
  const input = { PORT: "0", PARRANDA_PLACE_RESOLVER: "disabled" };
  try {
    const env = buildFullDevEnvironment(input, { cacheDir });

    assert.equal(input.PARRANDA_PLACE_RESOLVER, "disabled", "input environment remains unchanged");
    assert.equal(env.PARRANDA_NEW_ANYWHERE, "enabled");
    assert.equal(env.PARRANDA_NEW_LANDING, "enabled");
    assert.equal(env.PARRANDA_PLACE_RESOLVER, "enabled");
    assert.equal(env.PARRANDA_OPEN_DATA_LOADER, "enabled");
    assert.equal(env.PARRANDA_WIKIDATA_SOURCE, "enabled");
    assert.equal(env.PARRANDA_AGNOSTIC_ENGINE_COMPOSE, "enabled");
    assert.equal(env.PARRANDA_AGNOSTIC_EVENTS, "enabled");
    assert.equal(env.PARRANDA_CACHE_DIR, cacheDir);
    assert.equal(fs.statSync(cacheDir).isDirectory(), true);
    assert.equal(typeof resolveDefaultPlaceResolver(env), "function");
    assert.equal(typeof resolveDefaultOpenDataLoader(env), "function");
    assert.equal(typeof resolveDefaultEventSupply(env), "function");
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("reviewed local profile selects two independent event publishers around Simrishamn", () => {
  const feeds = loadReviewedEventFeeds();
  assert.deepEqual(
    feeds.map((feed) => feed.id),
    [
      "simrishamn-municipal-calendar",
      "visit-ystad-osterlen-calendar",
      "visit-stockholm-open-api",
    ],
  );
  assert.equal(new Set(feeds.map((feed) => feed.source_identity)).size, 3);
  assert.ok(feeds.every((feed) => feed.status === "active"));
  assert.ok(feeds.every((feed) => feed.timezone === "Europe/Stockholm"));
  assert.equal(feeds.find((feed) => feed.adapter === "wix_event_sitemap")?.event_path_prefix, "/evenemang-1/");

  const env = buildFullDevEnvironment({}, { cacheDir: os.tmpdir() });
  const registry = resolveEventFeedRegistry(env);
  const plan = buildAnchorEventSourcePlan({
    anchor: { lat: 55.5566, lng: 14.35 },
    registry,
  });

  assert.deepEqual(
    plan.map((source) => source.id),
    ["simrishamn-municipal-calendar", "visit-ystad-osterlen-calendar"],
  );
  assert.deepEqual(
    plan.map((source) => source.kind),
    ["sitevision_calendar", "wix_event_sitemap"],
  );
});

test("reviewed local profile selects the official Stockholm API without a city branch", () => {
  const env = buildFullDevEnvironment({}, { cacheDir: os.tmpdir() });
  const registry = resolveEventFeedRegistry(env);
  const plan = buildAnchorEventSourcePlan({
    anchor: { lat: 59.3293, lng: 18.0686 },
    registry,
  });

  assert.deepEqual(plan.map((source) => source.id), ["visit-stockholm-open-api"]);
  assert.equal(plan[0].kind, "localized_events_api");
  assert.equal(plan[0].source_tier, "official");
  assert.equal(plan[0].license, "CC-BY 4.0");
});

test("both reviewed manifests collect normalized evidence through their generic adapters", async () => {
  const env = buildFullDevEnvironment({}, { cacheDir: os.tmpdir() });
  const registry = resolveEventFeedRegistry(env);
  const wixChild = "https://www.visitystadosterlen.se/dynamic-evenemang-1_0_5000-sitemap.xml";
  const wixEvent = "https://www.visitystadosterlen.se/evenemang-1/harbour-concert/101";
  const fetcher = async (url) => {
    const value = String(url);
    if (value === "https://www.simrishamn.se/evenemangskalender") {
      return textResponse(value, `
        <main class="sv-ws-event-calendar"><div class="eventsListContainer">
          <article class="eventArticle">
            <a class="eventArticleHeading" href="/events/summer-market"><h3>Summer market</h3></a>
            <div class="eventInfo"><div class="timeIcon"></div>16 juli<div>18:00–21:00</div></div>
            <div class="footerText">Town museum</div>
          </article>
        </div></main>
      `);
    }
    if (value === "https://www.simrishamn.se/events/summer-market") {
      return textResponse(value, `
        <h1>Summer market</h1>
        <span id="Datumochtid">Datum och tid</span><p>16 juli, 18.00–21.00</p>
        <p><strong>Evenemangsplats:</strong><br>Town museum</p>
        <p><strong>Adress:</strong><br>Museum street 1</p>
        <a href="https://www.google.com/maps/@55.556437,14.347752,200m">Map</a>
      `);
    }
    if (value === "https://www.visitystadosterlen.se/sitemap.xml") {
      return textResponse(value, `
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" generatedBy="WIX">
          <sitemap><loc>${wixChild}</loc><lastmod>2026-07-16</lastmod></sitemap>
        </sitemapindex>
      `);
    }
    if (value === wixChild) {
      return textResponse(value, `
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" generatedBy="WIX">
          <url><loc>${wixEvent}</loc><lastmod>2026-07-16</lastmod></url>
        </urlset>
      `);
    }
    if (value === wixEvent) {
      return textResponse(value, `
        <!doctype html><html lang="sv"><head>
          <meta name="generator" content="Wix.com Website Builder">
          <meta property="og:title" content="Harbour concert">
          <link rel="canonical" href="${wixEvent}">
        </head><body>
          <div data-testid="richTextElement"><h1>Harbour concert</h1></div><!--/$-->
          <div data-testid="richTextElement"><h2>När:</h2></div><!--/$-->
          <div data-testid="richTextElement"><p>torsdag 16 juli</p></div><!--/$-->
          <div data-testid="richTextElement"><h2>Var:</h2></div><!--/$-->
          <div data-testid="richTextElement"><p>Harbour hall<br>Harbour street 2<br>272 31 Simrishamn</p></div><!--/$-->
          <div data-testid="richTextElement"><h2>Öppettider</h2></div><!--/$-->
          <div data-testid="richTextElement"><p>19:00 - 21:00</p></div><!--/$-->
        </body></html>
      `);
    }
    throw new Error(`unexpected fixture URL: ${value}`);
  };

  const result = await collectAnchorEvents({
    anchor: { lat: 55.5566, lng: 14.35 },
    now: "2026-07-16T15:30:00.000Z",
    registry,
    fetcher,
  });

  assert.deepEqual(
    result.feeds.map((feed) => [feed.id, feed.status, feed.event_rows]),
    [
      ["simrishamn-municipal-calendar", "ok", 1],
      ["visit-ystad-osterlen-calendar", "ok", 1],
    ],
  );
  assert.equal(result.acquisition.normalized_event_count, 2);
  assert.equal(result.acquisition.source_health.event_bearing_source_count, 2);
  assert.equal(result.acquisition.source_health.status, "healthy");
  assert.equal(result.tonight.some((event) => event.title === "Summer market"), true);
  assert.deepEqual(result.acquisition.rejection_summary, [
    { reason: "missing_event_coordinates", count: 1 },
  ]);
});

function textResponse(url, body) {
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    text: async () => body,
  };
}
