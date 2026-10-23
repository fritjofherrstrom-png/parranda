"use strict";

// Venue-first Live discovery: the venues around a place are asked for their
// own programmes. Deterministic fetchers only; no live network.
const assert = require("node:assert/strict");
const test = require("node:test");

const { scoutLocalEventSources } = require("../server/pulse-sources/local-event-source-scout");
const { bindManifestCandidate } = require("../server/pulse-sources/source-qualification");
const {
  createRequestTimeEventDiscovery,
  feedsFromScout,
} = require("../server/pulse-sources/request-time-event-discovery");
const { extractCalendarPageLinks } = require("../server/pulse-sources/calendar-page-locator");

const ANCHOR = { lat: 52.514, lng: 13.239 };
const PLACE = { name: "Berlin", label: "Berlin", locality: "Berlin" };
const BOUNDS = { south: 52.434, north: 52.594, west: 13.119, east: 13.359 };

// The shape of a venue programme page with schema.org JSON-LD, as published by
// an open-air stage (structure from the 2026-10-18 Berlin probe, names invented).
const PROGRAMME_HTML = `<!doctype html><html lang="de"><head><title>Programm</title>
<script type="application/ld+json">[
 {"@context":"https://schema.org","@type":"MusicEvent","name":"Sommerkonzert",
  "startDate":"2026-10-24T19:30:00+02:00","endDate":"2026-10-24T22:00:00+02:00",
  "url":"https://www.stage.example/programm/sommerkonzert",
  "location":{"@type":"Place","name":"Freilichtbühne Example","address":{"@type":"PostalAddress",
   "streetAddress":"Beispielweg 1","postalCode":"14053","addressLocality":"Berlin","addressCountry":"DE"}}},
 {"@context":"https://schema.org","@type":"MusicEvent","name":"Herbstgala",
  "startDate":"2026-10-25T20:00:00+02:00","endDate":"2026-10-25T23:00:00+02:00",
  "url":"https://www.stage.example/programm/herbstgala",
  "location":{"@type":"Place","name":"Freilichtbühne Example","address":{"@type":"PostalAddress",
   "streetAddress":"Beispielweg 1","postalCode":"14053","addressLocality":"Berlin","addressCountry":"DE"}}}
]</script></head><body><h1>Programm</h1></body></html>`;

function text(body, { status = 200, type = "text/html; charset=utf-8" } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => (/content-type/i.test(name) ? type : null) }, text: async () => body };
}
function redirect(location, status = 301) {
  return { ok: false, status, headers: { get: (name) => (/location/i.test(name) ? location : null) }, text: async () => "" };
}
function site(routes, calls = []) {
  return async (url) => {
    const key = String(url);
    calls.push(key);
    const route = routes[key];
    if (!route) return text("not found", { status: 404, type: "text/plain" });
    return typeof route === "function" ? route() : route;
  };
}
const ALLOW = text("User-agent: *\nAllow: /\n", { type: "text/plain" });

test("a schema.org programme found on a venue page binds and becomes a feed", async () => {
  const scouted = await scoutLocalEventSources({
    place: PLACE, anchor: ANCHOR, bounds: BOUNDS, eventReader: null,
    seeds: [{ url: "https://www.stage.example/", label: "Freilichtbühne Example", family: "venue", discovery_method: "wikidata_venue_website" }],
    fetcher: site({ "https://www.stage.example/robots.txt": ALLOW, "https://www.stage.example/": text(PROGRAMME_HTML) }),
  });
  const manifest = scouted.manifest_candidates.find((entry) => entry.adapter === "schema_org_html");
  assert.ok(manifest, "precondition: the scout recognises the JSON-LD programme");
  const candidate = scouted.results.flatMap((result) => result.candidates).find((entry) => entry.id === manifest.id);
  assert.equal(candidate.adapter, "schema_org_event", "the real scout shape: candidate and manifest name the interface differently");
  assert.ok(bindManifestCandidate(manifest, candidate), "the pair is one interface");
  const feeds = feedsFromScout(scouted, { timezone: "Europe/Berlin" });
  assert.deepEqual(feeds.map((feed) => [feed.adapter, feed.endpoint]), [["schema_org_html", "https://www.stage.example/"]]);
  assert.equal(feeds[0].pulse_only, true);
  assert.equal(feeds[0].runtime_trust, "request_time_single_observation");
});

test("a candidate never binds to a manifest naming another interface", () => {
  const manifest = { id: "x", endpoint: "https://www.stage.example/", adapter: "schema_org_html", source_identity: "stage.example",
    bbox: [13.1, 52.4, 13.4, 52.6], review: { robots_status: "allowed" } };
  const candidate = { id: "x", url: "https://www.stage.example/", source_identity: "stage.example", status: "viable_provider_probe",
    maps_to_existing_provider: true };
  assert.ok(bindManifestCandidate(manifest, { ...candidate, adapter: "schema_org_event" }));
  assert.equal(bindManifestCandidate(manifest, { ...candidate, adapter: "ical" }), null);
  assert.equal(bindManifestCandidate({ ...manifest, adapter: "ical" }, { ...candidate, adapter: "schema_org_event" }), null);
});

test("a listed http:// or bare-domain website is read at its canonical origin, after that origin's robots", async () => {
  const calls = [];
  const scouted = await scoutLocalEventSources({
    place: PLACE, anchor: ANCHOR, bounds: BOUNDS, eventReader: null,
    seeds: [{ url: "http://stage.example/", label: "Freilichtbühne Example", family: "venue" }],
    fetcher: site({
      "http://stage.example/robots.txt": redirect("https://stage.example/robots.txt"),
      "https://stage.example/robots.txt": redirect("https://www.stage.example/robots.txt"),
      "https://www.stage.example/robots.txt": ALLOW,
      "https://www.stage.example/": text(PROGRAMME_HTML),
    }, calls),
  });
  const [seedResult] = scouted.results;
  assert.equal(seedResult.status, "inspected");
  assert.equal(seedResult.source_url, "https://www.stage.example/");
  assert.ok(!calls.includes("http://stage.example/"), "no page of the listed origin is read");
  assert.ok(calls.indexOf("https://www.stage.example/robots.txt") < calls.indexOf("https://www.stage.example/"),
    "the canonical robots verdict comes before its page");
  assert.equal(feedsFromScout(scouted, { timezone: "Europe/Berlin" }).length, 1);
});

test("a redirect to another domain, a downgrade or a different path is not followed", async () => {
  for (const [listed, routes] of [
    ["http://stage.example/", { "http://stage.example/robots.txt": redirect("https://elsewhere.example/robots.txt") }],
    ["https://stage.example/", { "https://stage.example/robots.txt": redirect("http://www.stage.example/robots.txt") }],
    ["http://stage.example/", { "http://stage.example/robots.txt": redirect("https://www.stage.example/login?next=/robots.txt") }],
  ]) {
    const calls = [];
    const scouted = await scoutLocalEventSources({
      place: PLACE, anchor: ANCHOR, bounds: BOUNDS, eventReader: null,
      seeds: [{ url: listed, label: "venue", family: "venue" }],
      fetcher: site({ ...routes, [listed]: redirect("https://www.stage.example/") }, calls),
    });
    assert.notEqual(scouted.results[0].status, "inspected", listed);
    assert.ok(!calls.some((url) => /elsewhere\.example|^https:\/\/www\.stage\.example\/$/.test(url)), `${listed}: ${calls.join(" ")}`);
  }
});

test("venue programme words lead the scout to the programme page", () => {
  const links = extractCalendarPageLinks({
    pageUrl: "https://www.theatre.example/",
    html: `<a href="/haus/geschichte">Geschichte</a><a href="/spielplan">Spielplan</a>
      <a href="/spielplan/2026-10-19-faust">Faust</a><a href="/cartelera">Cartelera</a>`,
  });
  assert.deepEqual(links.map((link) => link.url).sort(), ["https://www.theatre.example/cartelera", "https://www.theatre.example/spielplan"]);
});

// --- the request-time lane with venue seeds -----------------------------------

function memoryCache() {
  const store = new Map();
  return {
    async get(key, producer, { shouldStore = () => true } = {}) {
      if (store.has(key)) return store.get(key);
      const value = await producer();
      if (shouldStore(value)) store.set(key, value);
      return value;
    },
  };
}
const venueSeed = (host, kind = "theatre") => ({ url: `https://www.${host}/`, label: host, family: "venue", venue_kind: kind, discovery_method: "wikidata_venue_website", lat: ANCHOR.lat, lng: ANCHOR.lng });
function scoutFeedFor(host) {
  const url = `https://www.${host}/`;
  return {
    results: [{ source_url: url, status: "inspected", candidates: [{ id: host, url, adapter: "schema_org_event", source_identity: host, status: "viable_provider_probe", maps_to_existing_provider: true, family: "venue" }] }],
    manifest_candidates: [{ id: host, endpoint: url, adapter: "schema_org_html", source_identity: host, bbox: [13.1, 52.4, 13.4, 52.6], label: host, review: { robots_status: "allowed", terms_status: "unknown" } }],
  };
}

test("venue websites lead the seeds, search follows, one seed per site, read in parallel groups", async () => {
  const scouted = [];
  let active = 0;
  let peak = 0;
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    venueSeeds: async ({ anchor, radiusKm }) => {
      assert.deepEqual(anchor, ANCHOR);
      assert.equal(radiusKm, 3);
      return { status: "ok", seeds: ["a.example", "b.example", "c.example", "d.example"].map((host) => venueSeed(host)) };
    },
    sourceSearch: async () => ({ status: "ok", seeds: [{ url: "https://www.b.example/termine" }, { url: "https://portal.example/events" }] }),
    scout: async ({ seeds, maxSeeds, eventReader }) => {
      assert.equal(eventReader, null);
      assert.equal(maxSeeds, seeds.length);
      scouted.push(seeds.map((seed) => seed.url));
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const found = seeds.find((seed) => seed.url === "https://www.c.example/");
      return found ? scoutFeedFor("c.example") : { results: seeds.map((seed) => ({ source_url: seed.url, status: "inspected", candidates: [] })), manifest_candidates: [] };
    },
    timezoneForPoint: () => "Europe/Berlin",
  });
  const result = await discover({ anchor: ANCHOR, placeLabel: "Berlin, Germany", placeContext: { locality: "Berlin", country_code: "de" } });
  assert.equal(result.status, "found");
  assert.deepEqual(result.feeds.map((feed) => feed.endpoint), ["https://www.c.example/"]);
  const all = scouted.flat();
  assert.deepEqual(all.slice().sort(), ["https://portal.example/events", "https://www.a.example/", "https://www.b.example/", "https://www.c.example/", "https://www.d.example/"].sort(),
    "the search hit on an already listed venue site is not read twice");
  assert.equal(scouted.length, 3, "three groups");
  assert.equal(peak, 3, "groups are read side by side");
  assert.deepEqual(scouted.map((group) => group[0]), ["https://www.a.example/", "https://www.b.example/", "https://www.c.example/"],
    "every group starts with a venue");
});

test("the venue lane works without a configured web search", async () => {
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    venueSeeds: async () => ({ status: "ok", seeds: [venueSeed("c.example")] }),
    scout: async () => scoutFeedFor("c.example"),
    timezoneForPoint: () => "Europe/Berlin",
  });
  assert.equal(typeof discover, "function");
  const result = await discover({ anchor: ANCHOR, placeContext: { locality: "Berlin" } });
  assert.equal(result.status, "found");
});

test("a venue lookup still running is a short retryable failure, not an hour of verified absence", async () => {
  let clock = 0;
  let lookups = 0;
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(),
    now: () => clock,
    venueLookupWaitMs: 10,
    venueSeeds: () => { lookups += 1; return new Promise(() => {}); },
    sourceSearch: async () => ({ status: "ok", seeds: [] }),
  });
  const first = await discover({ anchor: ANCHOR, placeLabel: "Berlin" });
  assert.deepEqual([first.status, first.reason], ["failed", "venue_seed_lookup_incomplete"]);
  clock += 6 * 60 * 1000;
  await discover({ anchor: ANCHOR, placeLabel: "Berlin" });
  assert.equal(lookups, 2, "retried after the short failure hold");
});

for (const mode of ["returns-failed", "throws", "returns-degraded", "returns-unavailable"]) {
  test(`${mode} search plus a healthy venue without feeds is retryable after five minutes`, async () => {
    let clock = 0;
    let searches = 0;
    let pages = 0;
    const discover = createRequestTimeEventDiscovery({
      cache: memoryCache(), now: () => clock,
      venueSeeds: async () => ({ status: "ok", seeds: [venueSeed("stage.example")] }),
      sourceSearch: async () => {
        searches += 1;
        if (mode === "throws") throw new Error("fixture outage");
        return { status: mode.replace("returns-", ""), retry_recommended: true, seeds: [] };
      },
      // Real scout, with a healthy allowed venue page but no event interface.
      fetcher: async url => {
        if (String(url).endsWith("/robots.txt")) return ALLOW;
        pages += 1;
        return text("<html>No structured events</html>");
      },
      timezoneForPoint: () => "Europe/Berlin",
    });
    const args = { anchor: ANCHOR, placeContext: { locality: "Berlin" } };
    const first = await discover(args);
    const pageCount = pages;
    assert.ok(pageCount > 0, "precondition: a healthy venue site was actually scouted");
    assert.deepEqual([first.status, first.reason, first.feeds],
      ["failed", `source_search_${mode === "throws" ? "failed" : mode.replace("returns-", "")}`, []]);
    clock = 4 * 60 * 1000;
    assert.deepEqual(await discover(args), first);
    assert.deepEqual([searches, pages], [1, pageCount], "the failure hold prevents immediate retries");
    clock = 5 * 60 * 1000;
    assert.deepEqual(await discover(args), first);
    assert.equal(searches, 2, "a failed lane must not acquire the verified-empty hour hold");
    assert.ok(pages > pageCount);
  });
}

test("healthy venue and healthy empty search still prove absence for one hour", async () => {
  let clock = 0;
  let searches = 0;
  const discover = createRequestTimeEventDiscovery({
    cache: memoryCache(), now: () => clock,
    venueSeeds: async () => ({ status: "ok", seeds: [venueSeed("stage.example")] }),
    sourceSearch: async () => { searches += 1; return { status: "ok", seeds: [] }; },
    fetcher: async url => String(url).endsWith("/robots.txt") ? ALLOW : text("<html>No structured events</html>"),
    timezoneForPoint: () => "Europe/Berlin",
  });
  const args = { anchor: ANCHOR, placeContext: { locality: "Berlin" } };
  assert.equal((await discover(args)).status, "empty");
  clock = 6 * 60 * 1000;
  assert.equal((await discover(args)).status, "empty");
  assert.equal(searches, 1);
  clock = 60 * 60 * 1000;
  assert.equal((await discover(args)).status, "empty");
  assert.equal(searches, 2);
});

for (const mode of ["returns-failed", "throws"]) {
  test(`a real venue feed remains usable despite ${mode} search`, async () => {
    const discover = createRequestTimeEventDiscovery({
      cache: memoryCache(),
      venueSeeds: async () => ({ status: "ok", seeds: [venueSeed("stage.example")] }),
      sourceSearch: async () => {
        if (mode === "throws") throw new Error("fixture outage");
        return { status: "failed", retry_recommended: true, seeds: [] };
      },
      fetcher: async url => String(url).endsWith("/robots.txt") ? ALLOW : text(PROGRAMME_HTML),
      timezoneForPoint: () => "Europe/Berlin",
    });
    const result = await discover({ anchor: ANCHOR, placeContext: { locality: "Berlin" } });
    assert.equal(result.status, "found");
    assert.equal(result.feeds.length, 1);
    assert.equal(result.feeds[0].pulse_only, true);
    assert.equal(result.feeds[0].confidence, "low");
  });
}

test("one unreachable site among several does not turn a complete look into a failure", async () => {
  const outcome = async (failing) => {
    const discover = createRequestTimeEventDiscovery({
      cache: memoryCache(),
      venueSeeds: async () => ({ status: "ok", seeds: ["a.example", "b.example", "c.example"].map((host) => venueSeed(host)) }),
      scout: async ({ seeds }) => ({
        results: seeds.map((seed) => ({ source_url: seed.url, status: failing.some((host) => seed.url.includes(host)) ? "failed" : "inspected", candidates: [] })),
        manifest_candidates: [],
      }),
    });
    return discover({ anchor: ANCHOR, placeContext: { locality: "Berlin" } });
  };
  assert.deepEqual(Object.values(await outcome(["a.example"])).slice(0, 2), ["empty", "no_structured_event_source"]);
  assert.deepEqual(Object.values(await outcome(["a.example", "b.example"])).slice(0, 2), ["failed", "source_scout_failed"]);
});
