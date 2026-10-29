"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resolveDefaultEventSupply, collectAnchorEvents, buildScopedEventSourcePlan,
  GLOBAL_FEED_DESCRIPTOR } = require("../server/place-candidates/agnostic-event-supply");
const { createRequestTimeEventDiscovery } = require("../server/pulse-sources/request-time-event-discovery");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const { executeLiveEventQuery } = require("../server/place-candidates/live-event-query");
const { createSourceProfileCatalog } = require("../server/pulse-sources/source-profile-catalog");

const ANCHOR = { lat: 55.4580331, lng: 14.1808853 };
const NOW = "2026-10-27T10:00:00Z";
const PROGRAMME = "https://programme.example/programme";
const HTML = fs.readFileSync(path.join(__dirname, "fixtures/regional-event-programme.html"), "utf8");
const reviewed = require("../config/reviewed-event-feeds.json")
  .filter(feed => ["simrishamn-municipal-calendar", "visit-ystad-osterlen-calendar"].includes(feed.id));
const scope = { source: "resolver_bounds", kind: "settlement", bounds: {
  south: 55.45, north: 55.47, west: 14.16, east: 14.20,
} };
const context = { locality: "Borrby", region: "Skåne län", country: "Sweden", country_code: "se" };

function response(url, body, status = 200) {
  return { ok: status === 200, status, url, text: async () => body,
    headers: { get: () => url.endsWith("robots.txt") ? "text/plain" : "text/html" } };
}

async function run({ withBounds = true, venue = "nearby", failCalendar = false, robots = true } = {}) {
  let produced, searches = 0;
  const calls = [], demands = [], queries = [];
  const fetcher = async input => {
    const url = String(input); calls.push(url);
    if (url === "https://programme.example/robots.txt") return response(url,
      `User-agent: *\n${robots ? "Allow" : "Disallow"}: /`);
    if (url === "https://programme.example/") return response(url, '<a href="/programme">Program 2026</a>');
    if (url === PROGRAMME) return response(url, HTML);
    if (url === reviewed[0].endpoint) return response(url, failCalendar ? "" : `<main class="sv-ws-event-calendar"><div class="eventsListContainer">
      <article class="eventArticle"><a class="eventArticleHeading" href="/events/local-concert"><h3>Existing calendar concert</h3></a>
      <div class="eventInfo"><div class="timeIcon"></div>30 oktober<div>18:00–21:00</div></div>
      <div class="footerText">Local museum</div></article></div></main>`, failCalendar ? 503 : 200);
    if (url === "https://www.simrishamn.se/events/local-concert") return response(url,
      `<h1>Existing calendar concert</h1><span id="Datumochtid">Datum och tid</span><p>30 oktober, 18.00–21.00</p>
      <p><strong>Evenemangsplats:</strong><br>Local museum</p><p><strong>Adress:</strong><br>Museum street 1</p>
      <a href="https://www.google.com/maps/@55.458,14.181,200m">Map</a>`);
    if (url === reviewed[1].endpoint) return response(url,
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" generatedBy="WIX"></urlset>');
    // Global provider failure must remain observable after complementary discovery.
    if (url.includes("ticketmaster.com")) return response(url, "", 503);
    if (url.startsWith("https://openholidaysapi.org")) return { ...response(url, "[]"), json: async () => [] };
    assert.fail(`unexpected fixture transport: ${url}`);
  };
  const discovery = createRequestTimeEventDiscovery({
    cache: { get: async (_key, load) => load() }, fetcher,
    sourceSearch: async ({ queries }) => {
      searches++;
      assert.ok(queries.every(query => /Borrby/.test(query)));
      return { status: "ok", seeds: [{ url: "https://programme.example/" }] };
    }, timezoneForPoint: () => "Europe/Stockholm",
  });
  const catalog = createSourceProfileCatalog({ now: () => new Date(NOW), query: async (_sql, values) => {
    assert.equal(JSON.parse(values[9]).collection_mode, "local_anchor");
    return { rows: [{ target_key: values[0], status: "pending" }] };
  } });
  const cache = createSourceCache({ namespace: "local-coverage-test", ttlMs: 60_000 });
  const warm = cache.warm;
  cache.warm = (key, load, options) => warm(key, () => { produced = Promise.resolve().then(load); return produced; }, options);
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled",
    PARRANDA_EVENT_READER: "disabled", PARRANDA_TICKETMASTER_KEY: "fixture-only",
    PARRANDA_EVENT_FEEDS: JSON.stringify(reviewed) }, {
    eventCache: cache, requestTimeDiscovery: discovery,
    sourceCatalog: { recordScoutDemand: async demand => {
      demands.push(demand);
      const outcome = await catalog.recordScoutDemand(demand);
      assert.equal(outcome.status, "recorded", "the actual catalog normalizer accepts bounded demand");
      return outcome;
    } },
    collectEvents: input => collectAnchorEvents({ ...input, fetcher, venueResolver: async query => {
      queries.push(query);
      if (venue === "none" || !/Borrby/.test(query)) return [];
      return [{ label: query, lat: venue === "outside" ? 56 : 55.458, lng: 14.181,
        confidence: "high", provenance: "controlled_fixture_resolver" }];
    } }),
  });
  const request = () => executeLiveEventQuery({ payload: {
    scope: "around_place", time: "this_week", selected_date: "2026-10-27", anchor: ANCHOR, place_query: "Borrby",
    // Public coverage is deliberately unrelated. Only the resolver's scope counts.
    spatial_scope: { ...scope, bounds: { south: 1, north: 2, west: 1, east: 2 } },
  }, eventSupply: supply, now: NOW, placeResolver: async () => [{ ...ANCHOR,
    label: "Borrby, Skåne län, Sverige", confidence: "medium", provenance: "controlled_fixture_resolver",
    admin_context: context, ...(withBounds ? { spatial_scope: scope } : {}),
  }] });
  assert.equal((await request()).body.live_events.pending, true);
  const result = await produced;
  return { result, calls, demands, queries, searches: () => searches, request };
}

for (const withBounds of [true, false]) {
  test(`broad regional calendars leave local discovery open (${withBounds ? "attested bounds" : "coordinate-only resolver"})`, async () => {
    const state = await run({ withBounds });
    assert.equal(state.searches(), 1, "two regional publishers/families cannot establish a local mix");
    assert.equal(state.demands.length, 1, "the worker receives bounded local research demand");
    assert.equal(state.result.acquisition.discovery_health.status, "pending", "catalog normalization accepted the demand");
    const demand = state.demands[0];
    assert.equal(demand.placeContext.locality, "Borrby");
    assert.ok(demand.spatialScope.bounds.west < ANCHOR.lng && demand.spatialScope.bounds.east > ANCHOR.lng);
    assert.equal(state.result.acquisition.request_time_discovery.status, "found");
    const selected = state.result.feeds.map(feed => feed.id);
    assert.ok(selected.includes(reviewed[0].id) && selected.includes(reviewed[1].id));
    assert.ok(selected.includes("ticketmaster-global"));
    assert.equal(selected.length, 4, "one complementary slot replaces a calendar-reference layer, without raising caps");
    const programme = [...state.result.tonight, ...state.result.this_week].filter(row => row.programme);
    assert.ok(programme.length >= 2, "a found source must actually be collected and geographically accepted");
    assert.ok(programme.every(row => row.source_url === PROGRAMME && row.route_eligible === false && row.trust_level === "low"));
    assert.ok(state.result.this_week.some(row => row.title === "Existing calendar concert"));
    assert.ok(state.result.acquisition.venue_resolution.attempted_count <= 6);
    assert.equal(state.result.feeds.find(feed => feed.id === "ticketmaster-global").status, "failed");
    await state.request();
    assert.equal(state.searches(), 1, "the warmed collection reuses the discovered result");
  });
}

for (const venue of ["none", "outside"]) {
  test(`discovery does not bypass ${venue} venue geometry`, async () => {
    const { result } = await run({ venue });
    assert.equal(result.acquisition.request_time_discovery?.status, "found");
    assert.equal([...result.tonight, ...result.this_week].some(row => row.programme), false);
    assert.ok(result.acquisition.rejection_summary.some(row => /coordinates|radius|scope/.test(row.reason)));
  });
}

test("blocked robots and failed existing calendars retain independent health", async () => {
  const { result, calls } = await run({ failCalendar: true, robots: false });
  assert.equal(result.acquisition.request_time_discovery?.status, "empty");
  assert.equal(calls.includes(PROGRAMME), false);
  assert.equal(result.feeds.find(feed => feed.id === reviewed[0].id).status, "failed");
  assert.equal(result.acquisition.source_health.status, "partial");
});

test("a complementary ID cannot activate disabled, expired, outside or duplicate-publisher feeds", () => {
  const feed = (id, extra = {}) => ({ id, adapter: "ical", endpoint: `https://${id}.example/cal.ics`,
    source_identity: `${id}.example`, bbox: reviewed[0].bbox, priority: 100, ...extra });
  const base = [feed("a"), feed("b"), feed("c")];
  const candidates = [feed("disabled", { status: "disabled" }),
    feed("expired", { profile_key: "x", profile_expires_at: "2026-10-26T00:00:00Z" }),
    feed("outside", { bbox: [1, 1, 2, 2] }),
    feed("duplicate", { source_identity: "a.example", priority: 190 })];
  const plan = buildScopedEventSourcePlan({ anchor: ANCHOR, registry: [...base, ...candidates], now: NOW,
    globalEnabled: true, globalSource: GLOBAL_FEED_DESCRIPTOR, complementarySourceIds: candidates.map(feed => feed.id) });
  assert.deepEqual(plan.map(feed => feed.id), ["a", "b", "c", "ticketmaster-global"]);
});

test("custom source caps reserve one complementary source before the scoped plan truncates", () => {
  const feed = id => ({ id, adapter: "ical", endpoint: `https://${id}.example/cal.ics`,
    source_identity: `${id}.example`, bbox: reviewed[0].bbox });
  const registry = [feed("a"), feed("b"), feed("c"), { ...feed("new"), priority: 190 }];
  for (const globalEnabled of [false, true]) for (const maxLocalSources of [0, 1, 2, 3]) {
    const plan = buildScopedEventSourcePlan({ anchor: ANCHOR, registry, now: NOW, maxLocalSources,
      globalEnabled, globalSource: GLOBAL_FEED_DESCRIPTOR, complementarySourceIds: ["new"] });
    assert.equal(plan.length, maxLocalSources + Number(globalEnabled));
    assert.equal(plan.some(feed => feed.id === "new"), maxLocalSources > 0);
    if (globalEnabled) assert.equal(plan.at(-1).id, "ticketmaster-global");
  }
});

test("a warm context-free regional pool cannot suppress the same anchor's local discovery", async () => {
  let produced, searches = 0;
  const cache = createSourceCache({ namespace: "discovery-context-test", ttlMs: 60_000 });
  const warm = cache.warm;
  cache.warm = (key, load, options) => warm(key, () => { produced = Promise.resolve().then(load); return produced; }, options);
  const feeds = reviewed.map((feed, index) => ({ ...feed, adapter: "ical",
    endpoint: `https://calendar-${index}.example/cal.ics` }));
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_EVENT_READER: "disabled",
    PARRANDA_EVENT_FEEDS: JSON.stringify(feeds) }, { eventCache: cache,
    requestTimeDiscovery: async () => { searches++; return { status: "empty", feeds: [] }; },
    collectEvents: input => collectAnchorEvents({ ...input, fetcher: async () => response("https://calendar.example/",
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n") }),
  });
  const request = { anchor: ANCHOR, now: NOW };
  await supply(request); await produced; await new Promise(resolve => setImmediate(resolve));
  assert.equal(searches, 0);
  const local = { ...request, placeLabel: "Borrby", placeContext: { locality: "Borrby" } };
  await supply(local); await produced; await new Promise(resolve => setImmediate(resolve));
  assert.equal(searches, 1, "local research has a distinct cache identity from the context-free calendar pool");
  const cached = await supply(local);
  assert.equal(cached.acquisition.request_time_discovery.status, "empty");
  assert.equal(searches, 1);
});
