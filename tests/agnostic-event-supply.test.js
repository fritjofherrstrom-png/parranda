/**
 * Agnostic live-event supply — "what's alive near here" for an arbitrary anchor,
 * generically (open municipal feed, geo-filtered, deterministic, no network).
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  applyReviewedSourceTrust,
  collectAnchorEvents,
  resolveEventFeedRegistry,
  resolveEventFeedForAnchor,
  rankCollectedEventsForPreferences,
  buildAnchorEventEndpoint,
  createLocalEventProvider,
  BUILTIN_EVENT_FEEDS,
  HELSINKI_LINKED_EVENTS_FEED,
  MAX_PER_BUCKET,
  MAX_BROWSE_PER_BUCKET,
  LIVE_EVENT_BROWSE_CONTRACT,
} = require("../server/place-candidates/agnostic-event-supply");

// The municipal-feed path is exercised by INJECTING the Helsinki fixture as a
// registry — never by relying on a baked-in default (there is none; the product
// default has no special city). This proves the mechanism is generic: it works
// with any injected open feed, Helsinki being one live-verified example.
const FIXTURE_REGISTRY = [HELSINKI_LINKED_EVENTS_FEED];
const HELSINKI = { lat: 60.17, lng: 24.94 }; // inside the fixture feed bbox
const ESPOO = { lat: 60.2055, lng: 24.6559 };
const VANTAA = { lat: 60.2934, lng: 25.0378 };
const KAUNIAINEN = { lat: 60.2124, lng: 24.7276 };
const PORVOO = { lat: 60.3923, lng: 25.6651 };
const ROME = { lat: 41.9, lng: 12.5 }; // outside every feed bbox
const NOW = "2026-06-28T12:00:00Z";

// A Linked Events-shaped payload covering every timing bucket relative to NOW.
function linkedEventsPayload() {
  const ev = (id, name, start, end, lat, lng) => ({
    id,
    name: { en: name },
    start_time: start,
    end_time: end,
    location: { position: { coordinates: [lng, lat] }, name: { en: "Venue " + id } },
    info_url: { en: `https://example.org/${id}` },
    data_source: "helsinki",
    publisher: "City of Helsinki",
    keywords: [],
  });
  return {
    meta: { count: 6 },
    data: [
      ev("now1", "Ongoing now", "2026-06-28T11:00:00Z", "2026-06-28T13:00:00Z", 60.171, 24.941), // now
      ev("tonight1", "Tonight gig", "2026-06-28T19:00:00Z", "2026-06-28T21:00:00Z", 60.172, 24.942), // tonight
      ev("today1", "Daytime market", "2026-06-28T14:00:00Z", "2026-06-28T16:00:00Z", 60.173, 24.943), // today
      ev("week1", "Thursday concert", "2026-07-01T18:00:00Z", "2026-07-01T20:00:00Z", 60.174, 24.944), // this_week (3d)
      ev("far1", "Autumn festival", "2026-09-01T18:00:00Z", "2026-09-01T20:00:00Z", 60.175, 24.945), // beyond 7d
      ev("stale1", "Yesterday show", "2026-06-27T18:00:00Z", "2026-06-27T20:00:00Z", 60.176, 24.946), // stale
      ev("perm1", "Permanent exhibition", "2001-01-01T09:00:00Z", "2030-01-01T00:00:00Z", 60.177, 24.947), // ongoing-since-2001 → NOT tonight
      ev("now1", "Ongoing now", "2026-06-28T11:00:00Z", "2026-06-28T13:00:00Z", 60.171, 24.941), // exact duplicate of now1 → deduped
    ],
  };
}

function fetcherFor(payload) {
  return async () => ({ ok: true, json: async () => payload });
}

test("the product default registry is EMPTY — no city is special out of the box", () => {
  // The anti-drift guarantee: nothing is baked in, so no single place gets events
  // that its neighbours don't. Live events come uniformly from the global provider
  // (or an honest absence), never from a per-city default feed.
  assert.equal(BUILTIN_EVENT_FEEDS.length, 0);
  assert.equal(resolveEventFeedRegistry({}).length, 0);
  assert.equal(resolveEventFeedForAnchor(HELSINKI), null, "no default feed covers even Helsinki");
});

test("the feed registry is generic + deploy-configurable (a city is data, not code)", () => {
  // A deployment adds the open feed covering its region via env — no code change.
  const stockholm = JSON.stringify([
    { id: "se-stockholm", label: "Stockholm", base: "https://example.org/se/v1/event/", bbox: [17.8, 59.2, 18.2, 59.45] },
  ]);
  const extended = resolveEventFeedRegistry({ PARRANDA_EVENT_FEEDS: stockholm });
  assert.equal(extended.length, 1);
  // An anchor in central Stockholm now resolves to the configured feed.
  const feed = resolveEventFeedForAnchor({ lat: 59.33, lng: 18.06 }, extended);
  assert.ok(feed && feed.id === "se-stockholm");
  assert.equal(feed.source_tier, "unknown");
  assert.equal(feed.confidence, "low");
  assert.equal(feed.source_family, "unknown_source_family");

  // Malformed config is ignored — keep whatever is built-in (empty), never throw.
  assert.equal(resolveEventFeedRegistry({ PARRANDA_EVENT_FEEDS: "{not json" }).length, 0);
});

test("a trusted deploy manifest activates reviewed feeds without request-time injection", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-event-manifest-"));
  const manifestPath = path.join(dir, "feeds.json");
  const fileRow = {
    id: "reviewed-region",
    label: "Reviewed region calendar",
    adapter: "localized_events_api",
    endpoint: "https://events.example/api/",
    bbox: [10, 50, 11, 51],
    status: "active",
    runtime_policy: "bounded_refresh",
  };
  fs.writeFileSync(manifestPath, JSON.stringify([fileRow]));

  try {
    const registry = resolveEventFeedRegistry({
      PARRANDA_EVENT_FEEDS_FILE: manifestPath,
      // Direct trusted deploy rows own matching identities and remain first.
      PARRANDA_EVENT_FEEDS: JSON.stringify([{ ...fileRow, label: "Deploy override" }]),
      // Public-looking fields are deliberately irrelevant to this function.
      event_feeds_file: "/tmp/public-payload.json",
    });

    assert.equal(registry.length, 1);
    assert.equal(registry[0].label, "Deploy override");
    assert.equal(resolveEventFeedRegistry({ PARRANDA_EVENT_FEEDS_FILE: path.join(dir, "missing.json") }).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reviewed source descriptors own trust and cap event-level confidence", () => {
  const enriched = applyReviewedSourceTrust(
    {
      id: "raw-event",
      source_tier: "official",
      confidence: "strong",
      source_family: "official_city_calendar",
      source_provider_id: "payload-provider",
      // Provider-internal id — must never surface as the display attribution.
      source_label: "helsinki",
    },
    {
      id: "reviewed-venue",
      endpoint: "https://venue.example/events",
      label: "Venue Example Calendar",
      source_tier: "institution",
      confidence: "low",
      source_family: "venue_calendar",
      source_identity: "venue.example",
    },
  );

  assert.equal(enriched.source_tier, "institution");
  assert.equal(enriched.confidence, "low");
  assert.equal(enriched.source_family, "venue_calendar");
  assert.equal(enriched.source_provider_id, "reviewed-venue");
  assert.equal(enriched.source_identity, "venue.example");
  assert.equal(enriched.source_label, "Venue Example Calendar", "the reviewed label owns display attribution");

  const downgraded = applyReviewedSourceTrust(
    { confidence: "low", source_label: "raw-id" },
    { id: "reviewed-city", source_tier: "official", confidence: "medium" },
  );
  assert.equal(downgraded.confidence, "low", "event evidence may lower reviewed source trust");
  assert.equal(downgraded.source_label, "raw-id", "a label-less descriptor keeps the event's own label");
});

test("the feed registry allowlists reusable local adapters and preserves legacy Linked Events rows", () => {
  const configured = resolveEventFeedRegistry({
    PARRANDA_EVENT_FEEDS: JSON.stringify([
      { id: "legacy", base: "https://legacy.example/events", bbox: [10, 50, 20, 60] },
      { id: "jsonld", adapter: "schema_org_html", endpoint: "https://venue.example/calendar", bbox: [10, 50, 20, 60] },
      { id: "ics", adapter: "ics", endpoint: "https://city.example/calendar.ics", bbox: [10, 50, 20, 60] },
      {
        id: "rss-detail",
        adapter: "rss_atom",
        endpoint: "https://culture.example/events/feed.xml",
        bbox: [10, 50, 20, 60],
        detail_limit: 7,
        detail_budget: 11,
      },
      { id: "sitevision", adapter: "sitevision", endpoint: "https://municipality.example/events", bbox: [10, 50, 20, 60] },
      {
        id: "wix",
        adapter: "wix_sitemap",
        endpoint: "https://destination.example/sitemap.xml",
        bbox: [10, 50, 20, 60],
        detail_limit: 4,
        detail_budget: 9,
      },
      {
        id: "localized-api",
        adapter: "localized_api",
        endpoint: "https://events.example/api/events/",
        bbox: [10, 50, 20, 60],
        timezone: "Europe/Stockholm",
        source_language: "sv",
        supported_languages: ["sv", "en"],
        page_size: 75,
      },
      { id: "unknown", adapter: "arbitrary_scraper", endpoint: "https://unknown.example/events", bbox: [10, 50, 20, 60] },
    ]),
  });

  assert.deepEqual(configured.map((row) => [row.id, row.adapter]), [
    ["legacy", "linked_events"],
    ["jsonld", "schema_org_html"],
    ["ics", "ical"],
    ["rss-detail", "rss_atom_event_detail"],
    ["sitevision", "sitevision_calendar"],
    ["wix", "wix_event_sitemap"],
    ["localized-api", "localized_events_api"],
  ]);
  assert.equal(configured.find((row) => row.id === "wix").detail_limit, 4);
  assert.equal(configured.find((row) => row.id === "rss-detail").detail_limit, 7);
  assert.equal(configured.find((row) => row.id === "rss-detail").detail_budget, 11);
  assert.equal(configured.find((row) => row.id === "wix").detail_budget, 9);
  assert.equal(configured.find((row) => row.id === "localized-api").page_size, 75);
  assert.deepEqual(configured.find((row) => row.id === "localized-api").supported_languages, ["sv", "en"]);
  assert.ok(!configured.some((row) => row.id === "unknown"), "unknown parser code cannot enter bounded runtime");
});

test("reviewed feed timezone reaches the generic JSON calendar adapter", async () => {
  const [source] = resolveEventFeedRegistry({
    PARRANDA_EVENT_FEEDS: JSON.stringify([
      {
        id: "regional-json",
        adapter: "events_calendar",
        endpoint: "https://calendar.example/events.json",
        bbox: [13, 55, 15, 56],
        timezone: "Europe/Stockholm",
      },
    ]),
  });
  const provider = createLocalEventProvider(source, {
    anchor: { lat: 55.55, lng: 14.35 },
    fetcher: async () => ({
      ok: true,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({
        events: [
          {
            id: "local-evening",
            title: "Local evening",
            start: "2026-07-15 18:00:00",
            end: "2026-07-15 21:00:00",
            url: "https://calendar.example/events/local-evening",
          },
        ],
      }),
    }),
  });

  const collected = await provider.create({ key: null }).collect({});
  assert.equal(
    collected.time_sensitive_events[0].starts_at,
    "2026-07-15T16:00:00.000Z",
  );
});

test("an anchor inside an injected open feed resolves it; outside, it does not", () => {
  const feed = resolveEventFeedForAnchor(HELSINKI, FIXTURE_REGISTRY);
  assert.ok(feed && feed.id === "linkedevents-helsinki");
  assert.equal(feed.label, "Helsinki Region Linked Events");
  assert.equal(resolveEventFeedForAnchor(ROME, FIXTURE_REGISTRY), null);
  assert.equal(resolveEventFeedForAnchor({ lat: NaN, lng: NaN }, FIXTURE_REGISTRY), null);
});

test("an injected Linked Events feed's coverage is regional, but still bounded", () => {
  for (const anchor of [HELSINKI, ESPOO, VANTAA, KAUNIAINEN]) {
    const feed = resolveEventFeedForAnchor(anchor, FIXTURE_REGISTRY);
    assert.ok(feed, "capital-region anchor resolves to the live-verified feed");
    assert.equal(feed.id, "linkedevents-helsinki");
  }
  assert.equal(resolveEventFeedForAnchor(PORVOO, FIXTURE_REGISTRY), null, "nearby cities outside the verified bbox stay uncovered");
});

test("the endpoint is geo-filtered to the anchor and sorted soonest-ending-first", () => {
  const url = new URL(buildAnchorEventEndpoint(HELSINKI_LINKED_EVENTS_FEED.base, HELSINKI));
  assert.equal(url.searchParams.get("dwithin_origin"), "24.94,60.17");
  assert.ok(Number(url.searchParams.get("dwithin_metres")) > 0);
  // sort=end_time surfaces what is genuinely on now/today and pushes permanent
  // exhibitions (end years away) to the back — fast, no max_duration expansion.
  assert.equal(url.searchParams.get("sort"), "end_time");
  assert.equal(url.searchParams.get("max_duration"), null, "no slow server-side duration expansion");
});

test("covered anchor buckets events into tonight (now/today/tonight) and this_week (<=7d)", async () => {
  const out = await collectAnchorEvents({
    anchor: HELSINKI,
    now: NOW,
    registry: FIXTURE_REGISTRY,
    fetcher: fetcherFor(linkedEventsPayload()),
  });
  assert.equal(out.coverage, "covered");
  assert.equal(out.feed.id, "linkedevents-helsinki");

  const tonightIds = out.tonight.map((e) => e.id).sort();
  assert.deepEqual(
    tonightIds,
    ["now1", "today1", "tonight1"],
    "now/today/tonight only; permanent-since-2001 dropped, duplicate collapsed",
  );
  assert.equal(out.tonight.filter((e) => e.id === "now1").length, 1, "duplicate occurrence collapsed");
  assert.ok(!out.tonight.some((e) => e.id === "perm1"), "always-open exhibition is not 'tonight'");

  const weekIds = out.this_week.map((e) => e.id);
  assert.deepEqual(weekIds, ["week1"], "only the within-7-days future event; far-future + stale excluded");

  // Honest data-only view: coords, source, license, trust carried; no prose.
  const tonightGig = out.tonight.find((e) => e.id === "tonight1");
  assert.ok(tonightGig.starts_at && tonightGig.source_url && tonightGig.license);
  assert.ok(Number.isFinite(tonightGig.lat) && Number.isFinite(tonightGig.lng));
  // The feed's region timezone rides along so the UI shows the VENUE-local time,
  // not the viewer's (the built-in Helsinki feed is Europe/Helsinki).
  assert.equal(tonightGig.timezone, "Europe/Helsinki");
});

test("a bounded all-day occurrence is valid this-week evidence without becoming tonight", async () => {
  const registry = [{
    id: "localized-api",
    label: "Localized API",
    adapter: "localized_events_api",
    endpoint: "https://events.example/api/events/",
    bbox: [24.8, 60.0, 25.1, 60.3],
    timezone: "Europe/Helsinki",
    source_language: "en",
    source_tier: "official",
    confidence: "medium",
    source_family: "official_tourism_open_api",
    source_identity: "events.example",
    license: "CC-BY 4.0",
    status: "active",
  }];
  const out = await collectAnchorEvents({
    anchor: HELSINKI,
    now: NOW,
    registry,
    fetcher: async (url) => ({
      ok: true,
      status: 200,
      url: String(url),
      text: async () => JSON.stringify({
        count: 1,
        results: [{
          id: "all-day-market",
          title: { en: "Neighbourhood market" },
          external_website_url: "https://organizer.example/market",
          venue_name: "Market square",
          address: "Square 1",
          location: { latitude: 60.171, longitude: 24.941 },
          start_date: "2026-06-29",
          end_date: "2026-06-29",
          start_time: null,
          end_time: null,
          modified_at: "2026-06-27T12:00:00Z",
          categories: [{ title: "Markets", slug: "markets", subcategories: [] }],
        }],
      }),
    }),
  });

  assert.deepEqual(out.tonight, []);
  assert.equal(out.this_week.length, 1);
  assert.equal(out.this_week[0].id, "all-day-market");
  assert.equal(out.this_week[0].time_window.kind, "all_day");
  assert.equal(out.acquisition.source_health.result, "events_found");
});

test("tonight ranks by salience: an ongoing 'now' event outranks a later-today one", async () => {
  const out = await collectAnchorEvents({
    anchor: HELSINKI,
    now: NOW,
    registry: FIXTURE_REGISTRY,
    fetcher: fetcherFor(linkedEventsPayload()),
  });
  // 'now' timing scores highest in the shared salience scorer.
  assert.equal(out.tonight[0].id, "now1");
});

test("preferences rerank the accepted event pool without another source collection", async () => {
  const ev = (id, name, keywords) => ({
    id,
    name: { en: name },
    start_time: "2026-06-28T18:00:00Z",
    end_time: "2026-06-28T20:00:00Z",
    location: { position: { coordinates: [24.94, 60.17] }, name: { en: `Venue ${id}` } },
    info_url: { en: `https://example.org/${id}` },
    data_source: "fixture",
    keywords: keywords.map((keyword) => ({ name: { en: keyword } })),
  });
  const payload = {
    data: [
      ev("a-concert", "Jazz concert", ["music"]),
      ev("z-loppis", "Loppis by the harbour", ["second hand"]),
      {
        ...ev("future-loppis", "Vintage fair tomorrow", ["second hand"]),
        start_time: "2026-06-29T18:00:00Z",
        end_time: "2026-06-29T20:00:00Z",
      },
      {
        ...ev("no-geo-loppis", "Perfect preference match without a place", ["second hand"]),
        location: { name: { en: "Unresolved venue" } },
      },
      {
        ...ev("stale-loppis", "Yesterday's vintage fair", ["second hand"]),
        start_time: "2026-06-27T18:00:00Z",
        end_time: "2026-06-27T20:00:00Z",
      },
    ],
  };
  const neutral = await collectAnchorEvents({
    anchor: HELSINKI,
    now: NOW,
    registry: FIXTURE_REGISTRY,
    fetcher: fetcherFor(payload),
  });

  assert.deepEqual(neutral.tonight.map((event) => event.id), ["a-concert", "z-loppis"]);
  const secondHand = rankCollectedEventsForPreferences(neutral, ["second_hand"]);
  assert.deepEqual(secondHand.tonight.map((event) => event.id), ["z-loppis", "a-concert"]);
  assert.deepEqual(secondHand.this_week.map((event) => event.id), ["future-loppis"]);
  assert.ok(!secondHand.tonight.some((event) => event.id === "future-loppis"), "preferences never weaken date truth");
  assert.ok(!secondHand.tonight.some((event) => event.id === "no-geo-loppis"), "preferences never weaken geo trust");
  assert.ok(!secondHand.tonight.some((event) => event.id === "stale-loppis"), "preferences never revive stale events");
  assert.equal(secondHand.tonight[0].preference_match, "strong");
  assert.deepEqual(secondHand.tonight[0].matched_preferences, ["second_hand"]);
  assert.equal(secondHand._rankable_events, undefined, "the internal cache pool is never returned publicly");

  const culture = rankCollectedEventsForPreferences(neutral, ["culture"]);
  assert.equal(culture.tonight[0].id, "a-concert");
  assert.deepEqual(culture.tonight[0].matched_preferences, ["museums"]);
});

test("Live keeps six ranked highlights and exposes the remaining accepted events separately", () => {
  const views = Array.from({ length: 30 }, (_, index) => ({
    id: `event-${String(index).padStart(2, "0")}`,
    title: index === 29 ? "Loppis by the harbour" : `Local event ${index}`,
    starts_at: "2026-06-28T18:00:00Z",
    ends_at: "2026-06-28T20:00:00Z",
    salience_score: 0,
    tags: index === 29 ? ["second hand"] : [],
  }));
  const ranked = rankCollectedEventsForPreferences({
    coverage: "covered",
    tonight: views.slice(0, MAX_PER_BUCKET),
    this_week: [],
    _rankable_events: { tonight: views, this_week: [] },
  }, ["second_hand"]);

  assert.equal(ranked.browse.contract, LIVE_EVENT_BROWSE_CONTRACT);
  assert.equal(ranked.browse.max_rows_per_bucket, MAX_BROWSE_PER_BUCKET);
  assert.equal(ranked.tonight.length, MAX_PER_BUCKET);
  assert.equal(ranked.tonight[0].id, "event-29", "a personal match may enter the highlight tier");
  assert.equal(ranked.browse.tonight.ranked_event_count, 30);
  assert.equal(ranked.browse.tonight.highlight_count, MAX_PER_BUCKET);
  assert.equal(ranked.browse.tonight.more_count, MAX_BROWSE_PER_BUCKET - MAX_PER_BUCKET);
  assert.equal(ranked.browse.tonight.hidden_count, 30 - MAX_BROWSE_PER_BUCKET);
  assert.equal(ranked.browse.tonight.more.length, MAX_BROWSE_PER_BUCKET - MAX_PER_BUCKET);
  assert.equal(ranked.browse.tonight.more.some((event) => event.id === "event-29"), false);
  assert.equal(
    new Set([...ranked.tonight, ...ranked.browse.tonight.more].map((event) => event.id)).size,
    MAX_BROWSE_PER_BUCKET,
    "highlights and browse rows never duplicate one occurrence",
  );
  assert.equal(ranked._rankable_events, undefined, "the wider internal pool remains private");
});

test("cultural events outrank civic/admin notices in the same bucket (smart, not just timely)", async () => {
  const ev = (id, name, start, end, lat, lng) => ({
    id,
    name: { en: name },
    start_time: start,
    end_time: end,
    location: { position: { coordinates: [lng, lat] }, name: { en: "Venue " + id } },
    info_url: { en: `https://example.org/${id}` },
    data_source: "helsinki",
  });
  const payload = {
    data: [
      ev("admin1", "City Council Meeting", "2026-06-28T18:00:00Z", "2026-06-28T20:00:00Z", 60.17, 24.94),
      ev("culture1", "Jazz concert at the hall", "2026-06-28T18:00:00Z", "2026-06-28T20:00:00Z", 60.171, 24.941),
    ],
  };
  const out = await collectAnchorEvents({ anchor: HELSINKI, now: NOW, registry: FIXTURE_REGISTRY, fetcher: fetcherFor(payload) });
  const ids = out.tonight.map((e) => e.id);
  assert.ok(ids.indexOf("culture1") < ids.indexOf("admin1"), "the concert ranks above the council meeting");
  assert.equal(out.tonight.find((e) => e.id === "culture1").cultural_tier, "cultural");
  assert.equal(out.tonight.find((e) => e.id === "admin1").cultural_tier, "administrative");
});

test("an uncovered anchor returns honest empty — no fetch, no fabricated events", async () => {
  let fetched = false;
  const out = await collectAnchorEvents({
    anchor: ROME,
    now: NOW,
    registry: FIXTURE_REGISTRY,
    fetcher: async () => {
      fetched = true;
      return { ok: true, json: async () => linkedEventsPayload() };
    },
  });
  assert.equal(out.coverage, "uncovered");
  assert.equal(fetched, false, "an anchor outside every present feed → no network call");
  assert.deepEqual(out.tonight, []);
  assert.deepEqual(out.this_week, []);
});

test("fail-soft: a feed error yields covered-but-empty, never a throw", async () => {
  const httpError = await collectAnchorEvents({ anchor: HELSINKI, now: NOW, registry: FIXTURE_REGISTRY, fetcher: async () => ({ ok: false }) });
  assert.equal(httpError.coverage, "covered");
  assert.deepEqual(httpError.tonight, []);

  const thrower = await collectAnchorEvents({
    anchor: HELSINKI,
    now: NOW,
    registry: FIXTURE_REGISTRY,
    fetcher: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(thrower.coverage, "covered");
  assert.deepEqual(thrower.this_week, []);
});
