"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const { createSourceCache } = require("../server/place-candidates/source-cache");

const {
  applyRobotsPolicy,
  buildLocalEventDiscoveryQueries,
  extractEventWebsiteSeeds,
  extractCalendarPageLinks,
  fetchScoutPage,
  inspectEventSourcePage,
  isScoutablePublicUrl,
  scoutLocalEventSources,
} = require("../server/pulse-sources/local-event-source-scout");

function response(body, { status = 200, contentType = "text/html", length = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") return contentType;
        if (String(name).toLowerCase() === "content-length") {
          return length == null ? null : String(length);
        }
        return null;
      },
    },
    text: async () => body,
  };
}

function context(overrides = {}) {
  return {
    place: {
      label: "Test Region",
      language_hints: ["sv"],
      local_discovery_terms: ["loppis", "marknad", "konsert"],
    },
    anchor: { lat: 55.55, lng: 14.35 },
    bounds: [13.8, 55.2, 14.8, 55.9],
    ...overrides,
  };
}

test("local-language terms produce bounded place-aware discovery queries", () => {
  const queries = buildLocalEventDiscoveryQueries({
    place: {
      label: "Test Region",
      region_terms: ["Coastal District"],
      local_discovery_terms: ["loppis", "bakluckeloppis"],
    },
    intentHints: ["vernissage"],
  });

  assert.ok(queries.includes("Test Region loppis"));
  assert.ok(queries.includes("Coastal District bakluckeloppis"));
  assert.ok(queries.includes("Test Region festival"));
  assert.ok(queries.includes("Test Region vernissage"));
  assert.ok(queries.length <= 18);
});

test("trusted place records expose public venue websites as scout seeds", () => {
  const seeds = extractEventWebsiteSeeds([
    {
      id: "osm-venue",
      name: "Local Hall",
      type: "gallery",
      website: "https://hall.example/events",
      lat: 55.5,
      lng: 14.3,
      source_language: "sv",
    },
    {
      id: "private",
      name: "Internal",
      type: "museum",
      tags: { website: "http://127.0.0.1/events" },
    },
  ]);

  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].url, "https://hall.example/events");
  assert.equal(seeds[0].family, "venue_owned_calendar");
  assert.equal(seeds[0].discovery_method, "trusted_place_website");
});

test("one reviewed page can reveal structured feeds and social discovery without activation", () => {
  const html = [
    "<html><head>",
    '<link rel="alternate" type="text/calendar" href="/events.ics">',
    '<link rel="alternate" type="application/rss+xml" href="/event-feed.xml">',
    '<script type="application/ld+json">',
    '{"@context":"https://schema.org","@type":"Event","name":"Small harbour concert","startDate":"2026-07-18T19:00:00+02:00","url":"https://venue.example/events/harbour-concert"}',
    "</script></head><body>",
    '<a href="https://facebook.com/events/123">Public social listing</a>',
    "</body></html>",
  ].join("\n");
  const result = inspectEventSourcePage({
    seed: {
      url: "https://venue.example/program",
      label: "Local venue",
      family: "venue_owned_calendar",
      trust_tier: "institution",
      source_language: "sv",
    },
    html,
    context: context(),
  });

  assert.deepEqual(result.detected.sort(), ["ical", "rss", "schema_org_html"]);
  assert.ok(result.candidates.some((candidate) => candidate.adapter === "ical"));
  assert.ok(result.candidates.some((candidate) => candidate.adapter === "schema_org_event"));
  assert.ok(result.candidates.some((candidate) => candidate.adapter === "rss_atom_event_detail"));
  assert.equal(result.social_hints.length, 1);
  assert.equal(result.social_hints[0].runtime_policy, "probe_only");
  assert.equal(result.social_hints[0].corroboration_required, true);

  assert.deepEqual(
    result.manifest_candidates.map((manifest) => manifest.adapter).sort(),
    ["ical", "rss_atom_event_detail", "schema_org_html"],
  );
  for (const manifest of result.manifest_candidates) {
    assert.equal(manifest.status, "review-needed");
    assert.equal(manifest.runtime_policy, "review_required");
    assert.equal(manifest.confidence, "low");
    assert.equal(manifest.review.terms_status, "unknown");
  }
});

test("only an explicit recognized rel=license declaration can attest open terms", () => {
  const licensed = inspectEventSourcePage({
    seed: { url: "https://calendar.example/program" },
    html: [
      '<link rel="license" href="https://creativecommons.org/licenses/by/4.0/">',
      '<link rel="alternate" type="text/calendar" href="/events.ics">',
    ].join(""),
    context: context(),
  });
  assert.equal(licensed.candidates[0].terms_status, "open_license");
  assert.equal(licensed.manifest_candidates[0].review.terms_status, "open_license");
  assert.equal(licensed.manifest_candidates[0].license, "https://creativecommons.org/licenses/by/4.0/");

  for (const html of [
    '<p>Creative Commons calendar</p><link rel="alternate" type="text/calendar" href="/events.ics">',
    '<link rel="license" href="https://terms.example/custom"><link rel="alternate" type="text/calendar" href="/events.ics">',
  ]) {
    const unproven = inspectEventSourcePage({
      seed: { url: "https://calendar.example/program" },
      html,
      context: context(),
    });
    assert.equal(unproven.candidates[0].terms_status, "unknown");
    assert.equal(unproven.manifest_candidates[0].review.terms_status, "unknown");
  }
});

test("The Events Calendar endpoint is detected generically from a strong CMS signature", () => {
  const result = inspectEventSourcePage({
    seed: {
      url: "https://culture.example/whats-on",
      family: "cultural_institution_calendar",
      trust_tier: "institution",
    },
    html: [
      '<meta name="generator" content="WordPress">',
      '<div class="tribe-events-calendar-list"></div>',
      '<link rel="https://api.w.org/" href="https://culture.example/wp-json/">',
    ].join("\n"),
    context: context(),
  });

  assert.equal(result.manifest_candidates.length, 1);
  assert.equal(result.manifest_candidates[0].adapter, "events_calendar");
  assert.equal(
    result.manifest_candidates[0].endpoint,
    "https://culture.example/wp-json/tribe/events/v1/events",
  );
  assert.equal(result.manifest_candidates[0].status, "review-needed");
});

test("event-related data endpoints become reviewed generic calendar manifests", () => {
  const result = inspectEventSourcePage({
    seed: {
      url: "https://region.example/events",
      family: "official_tourism_calendar",
      trust_tier: "institution",
      source_language: "sv",
    },
    html:
      '<div id="regional-events-overview" data-rest-url="/wp-json/region/v1/events-proxy"></div>',
    context: context(),
  });

  assert.ok(result.detected.includes("event_json"));
  assert.equal(result.manifest_candidates.length, 1);
  assert.equal(result.manifest_candidates[0].adapter, "events_calendar");
  assert.equal(
    result.manifest_candidates[0].endpoint,
    "https://region.example/wp-json/region/v1/events-proxy",
  );
  assert.equal(result.manifest_candidates[0].status, "review-needed");
  assert.equal(result.manifest_candidates[0].runtime_policy, "review_required");
});

test("unrelated data endpoints are not promoted as event manifests", () => {
  const result = inspectEventSourcePage({
    seed: { url: "https://region.example/about" },
    html: '<div id="weather-overview" data-rest-url="/wp-json/weather/v1/proxy"></div>',
    context: context(),
  });

  assert.equal(result.manifest_candidates.length, 0);
  assert.ok(!result.detected.includes("event_json"));
});

test("direct event JSON payloads are recognized without dumping or fetching rows", () => {
  const result = inspectEventSourcePage({
    seed: { url: "https://region.example/api/events" },
    contentType: "application/json; charset=utf-8",
    html: JSON.stringify({
      count: 1,
      events: [
        {
          id: 42,
          title: "Local harvest evening",
          start: "2026-09-12T18:00:00+02:00",
        },
      ],
      internal_debug: { upstream: "must-not-be-preserved" },
    }),
    context: context(),
  });

  assert.equal(result.manifest_candidates.length, 1);
  assert.equal(result.manifest_candidates[0].adapter, "events_calendar");
  assert.ok(!JSON.stringify(result).includes("must-not-be-preserved"));
});

test("a rejected source may be reported but never becomes a manifest proposal", () => {
  const result = inspectEventSourcePage({
    seed: {
      url: "https://venue.example/program",
      family: "venue_owned_calendar",
      trust_tier: "institution",
      terms_status: "restricted",
    },
    html: '<link rel="alternate" type="text/calendar" href="/events.ics">',
    context: context(),
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].status, "rejected");
  assert.equal(result.manifest_candidates.length, 0);
});

test("generic HTML is needs-adapter while only the exact existing signature gets a manifest", () => {
  const generic = inspectEventSourcePage({
    seed: { url: "https://venue.example/calendar" },
    html:
      '<section class="event-list"><article class="event-card"><time datetime="2026-07-20">20 July</time></article></section>',
    context: context(),
  });
  assert.equal(generic.candidates.length, 1);
  assert.equal(generic.candidates[0].adapter, "needs_adapter");
  assert.equal(generic.manifest_candidates.length, 0);

  const compatible = inspectEventSourcePage({
    seed: { url: "https://venue.example/calendar" },
    html:
      '<div class="date-container"><li><article class="tease--event-calendar"></article></li></div>',
    context: context(),
  });
  assert.equal(compatible.manifest_candidates.length, 1);
  assert.equal(compatible.manifest_candidates[0].adapter, "html_venue_calendar");
});

test("Sitevision-style calendars produce a review-needed bounded adapter manifest", () => {
  const result = inspectEventSourcePage({
    seed: { url: "https://municipality.example/events" },
    html: [
      '<div class="sv-ws-event-calendar">',
      '<div class="eventsListContainer">',
      '<article class="eventArticle"><h2>Local council event</h2></article>',
      "</div></div>",
    ].join(""),
    context: context(),
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].adapter, "sitevision_calendar");
  assert.equal(result.candidates[0].maps_to_existing_provider, true);
  assert.equal(result.manifest_candidates.length, 1);
  assert.equal(result.manifest_candidates[0].adapter, "sitevision_calendar");
  assert.equal(result.manifest_candidates[0].status, "review-needed");
});

test("server-rendered structured programs produce a review-needed generic manifest", () => {
  const payload = JSON.stringify({
    stages: [{
      id: 1,
      title: "Town square stage",
      address: "1 Square Road",
      gpsCoordinates: { lat: 51.5, lng: -0.1 },
    }],
    bookings: [{
      id: 2,
      title: "Neighbourhood summer concert",
      dates: [{
        scene: { id: 1, title: "Town square stage" },
        startDate: "2026-08-11T18:00:00Z",
        endDate: "2026-08-11T19:00:00Z",
      }],
    }],
  });
  const result = inspectEventSourcePage({
    seed: {
      url: "https://festival.example/program",
      family: "official_municipal_calendar",
      trust_tier: "official",
      source_language: "en",
    },
    html: `<script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`,
    context: context(),
  });

  assert.deepEqual(result.detected, ["embedded_program_rsc"]);
  assert.equal(result.candidates[0].adapter, "embedded_program_rsc");
  assert.equal(result.candidates[0].maps_to_existing_provider, true);
  assert.equal(result.manifest_candidates[0].adapter, "embedded_program_rsc");
  assert.equal(result.manifest_candidates[0].status, "review-needed");
});

test("official program articles are detected generically and preserve the page language", () => {
  const result = inspectEventSourcePage({
    seed: {
      url: "https://civic.example/news/summer-program",
      family: "official_municipal_calendar",
      trust_tier: "official",
      timezone: "Europe/Madrid",
    },
    html: [
      '<html lang="ca"><body>',
      "<h1>Festes del Port 2026</h1>",
      "<h2><strong>Programa al Parc Central</strong></h2>",
      "<p><strong>21 agost 20.00 Concert local</strong></p>",
      "<p><strong>22 agost 21.00 Nit de dansa</strong></p>",
      "</body></html>",
    ].join(""),
    context: context(),
  });

  assert.deepEqual(result.detected, ["official_program_article"]);
  assert.equal(result.candidates[0].adapter, "official_program_article");
  assert.equal(result.candidates[0].source_language, "ca");
  assert.equal(result.candidates[0].status, "needs_adapter_or_permission");
  assert.equal(result.manifest_candidates[0].adapter, "official_program_article");
  assert.equal(result.manifest_candidates[0].source_language, "ca");
  assert.equal(result.manifest_candidates[0].timezone, "Europe/Madrid");
  assert.equal(result.manifest_candidates[0].runtime_policy, "review_required");
});

test("bounded scouting carries the actual robots verdict into reviewed manifests", async () => {
  const page = [
    '<html lang="en"><body>',
    "<h1>River Festival 2026</h1>",
    "<h2>Program at Harbour Stage</h2>",
    "<p>5 June 18:00 Local orchestra</p>",
    "<p>5 June 20:00 Evening concert</p>",
    "</body></html>",
  ].join("");
  const result = await scoutLocalEventSources({
    ...context(),
    seeds: [{
      url: "https://city.example/festival",
      timezone: "Europe/Stockholm",
      source_language: "en",
    }],
    fetcher: async (url) => response(
      String(url).endsWith("/robots.txt") ? "User-agent: *\nAllow: /" : page,
      { contentType: String(url).endsWith("/robots.txt") ? "text/plain" : "text/html" },
    ),
  });

  assert.equal(result.manifest_candidates.length, 1);
  assert.equal(result.manifest_candidates[0].adapter, "official_program_article");
  assert.equal(result.manifest_candidates[0].review.robots_status, "allowed");
  assert.equal(result.manifest_candidates[0].status, "review-needed");
});

test("Sitevision Soleil listings reuse the review-needed generic adapter", () => {
  const result = inspectEventSourcePage({
    seed: { url: "https://municipality.example/program" },
    html: [
      '<main class="sv-custom-module sv-se-soleil-eventListingLocal">',
      '<article class="item-program">',
      '<a href="/program/item"><h2>Open workshop</h2></a>',
      '<time class="dates-kempox" datetime="2026-07-20">20 July</time>',
      "</article></main>",
    ].join(""),
    context: context(),
  });

  assert.equal(result.detected.length, 1);
  assert.equal(result.candidates[0].adapter, "sitevision_calendar");
  assert.equal(result.candidates[0].maps_to_existing_provider, true);
  assert.equal(result.manifest_candidates.length, 1);
  assert.equal(result.manifest_candidates[0].adapter, "sitevision_calendar");
  assert.equal(result.manifest_candidates[0].status, "review-needed");
  assert.equal(result.manifest_candidates[0].runtime_policy, "review_required");
});

test("calendar-page discovery is multilingual, same-origin, and listing-only", () => {
  const links = extractCalendarPageLinks({
    pageUrl: "https://venue.example/start",
    html: [
      '<a href="/evenemangskalender">Evenemangskalender</a>',
      '<a href="/events/summer-concert">Events</a>',
      '<a href="https://other.example/events">Events elsewhere</a>',
      '<a href="/about">About us</a>',
    ].join(""),
  });

  assert.deepEqual(links.map((link) => link.url), [
    "https://venue.example/evenemangskalender",
  ]);
  assert.ok(links[0].reasons.includes("calendar_link_label_match"));
  assert.ok(links[0].reasons.includes("calendar_link_path_match"));
});

test("reviewed local-language terms can locate a calendar without leaking raw terms", () => {
  const links = extractCalendarPageLinks({
    pageUrl: "https://venue.example/start",
    html: '<a href="/vad-hander">Vad händer</a>',
    calendarLinkTerms: ["vad händer"],
  });

  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://venue.example/vad-hander");
  assert.deepEqual(links[0].reasons, [
    "calendar_link_label_match",
    "calendar_link_path_match",
  ]);
  assert.ok(!JSON.stringify(links[0].reasons).includes("vad händer"));
});

test("bounded scout follows a strong same-origin calendar link for review", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/robots.txt")) {
      return response("User-agent: *\nAllow: /\n", { contentType: "text/plain" });
    }
    if (String(url).endsWith("/start")) {
      return response('<nav><a href="/evenemangskalender">Evenemang</a></nav>');
    }
    if (String(url).endsWith("/evenemangskalender")) {
      return response(
        '<div class="sv-ws-event-calendar"><div class="eventsListContainer"><article class="eventArticle"></article></div></div>',
      );
    }
    throw new Error("unexpected request");
  };

  const result = await scoutLocalEventSources({
    ...context(),
    seeds: [{
      url: "https://venue.example/start",
      family: "venue_owned_calendar",
    }],
    fetcher,
  });

  assert.equal(result.linked_page_attempt_count, 1);
  assert.equal(result.linked_source_count, 1);
  assert.equal(result.manifest_candidates.length, 1);
  assert.equal(result.manifest_candidates[0].adapter, "sitevision_calendar");
  assert.equal(
    result.manifest_candidates[0].review.discovered_from,
    "https://venue.example/start",
  );
  assert.deepEqual(calls, [
    "https://venue.example/robots.txt",
    "https://venue.example/start",
    "https://venue.example/evenemangskalender",
  ]);
});

test("linked calendar redirects cannot leave the reviewed seed origin", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/robots.txt")) {
      return response("User-agent: *\nAllow: /\n", { contentType: "text/plain" });
    }
    if (String(url).endsWith("/start")) {
      return response('<a href="/events">Events</a>');
    }
    if (String(url).endsWith("/events")) {
      return {
        ok: false,
        status: 302,
        headers: {
          get(name) {
            return String(name).toLowerCase() === "location"
              ? "https://calendar-vendor.example/events"
              : null;
          },
        },
      };
    }
    throw new Error("cross-origin target must not be fetched");
  };

  const result = await scoutLocalEventSources({
    ...context(),
    seeds: [{ url: "https://venue.example/start" }],
    fetcher,
  });
  const linked = result.results.find(
    (item) => item.discovery_method === "same_origin_calendar_link",
  );

  assert.deepEqual(linked.reasons, ["cross_origin_source_redirect"]);
  assert.ok(!calls.includes("https://calendar-vendor.example/events"));
});

test("linked calendar pages obey path-specific robots rules", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/robots.txt")) {
      return response(
        "User-agent: *\nDisallow: /evenemang\nAllow: /\n",
        { contentType: "text/plain" },
      );
    }
    if (String(url).endsWith("/start")) {
      return response('<a href="/evenemang">Evenemang</a>');
    }
    throw new Error("robots-blocked linked page must not be fetched");
  };

  const result = await scoutLocalEventSources({
    ...context(),
    seeds: [{ url: "https://venue.example/start" }],
    fetcher,
  });

  assert.equal(result.blocked_source_count, 1);
  assert.equal(result.manifest_candidates.length, 0);
  assert.deepEqual(calls, [
    "https://venue.example/robots.txt",
    "https://venue.example/start",
  ]);
});

test("a failed linked page does not starve the next calendar within the cap", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/robots.txt")) {
      return response("User-agent: *\nAllow: /\n", { contentType: "text/plain" });
    }
    if (String(url).endsWith("/start")) {
      return response([
        '<a href="/calendar" title="Events calendar">Calendar</a>',
        '<a href="/events">Events</a>',
        '<a href="/programme">Programme</a>',
      ].join(""));
    }
    if (String(url).endsWith("/calendar")) return response("failed", { status: 503 });
    if (String(url).endsWith("/events")) {
      return response(
        '<div class="sv-ws-event-calendar"><div class="eventsListContainer"><article class="eventArticle"></article></div></div>',
      );
    }
    throw new Error("linked-page budget exceeded");
  };

  const result = await scoutLocalEventSources({
    ...context(),
    seeds: [{ url: "https://venue.example/start" }],
    fetcher,
    maxLinkedPagesPerSeed: 2,
  });

  assert.equal(result.linked_page_attempt_count, 2);
  assert.equal(result.failed_source_count, 1);
  assert.equal(result.manifest_candidates.length, 1);
  assert.ok(!calls.includes("https://venue.example/programme"));
});

test("the global linked-page budget is shared across all website seeds", async () => {
  const linkedCalls = [];
  const fetcher = async (url) => {
    if (String(url).endsWith("/robots.txt")) {
      return response("User-agent: *\nAllow: /\n", { contentType: "text/plain" });
    }
    if (String(url).endsWith("/one") || String(url).endsWith("/two")) {
      return response('<a href="/events">Events</a>');
    }
    linkedCalls.push(String(url));
    return response("<main>No machine-readable interface</main>");
  };

  const result = await scoutLocalEventSources({
    ...context(),
    seeds: [
      { url: "https://one.example/one" },
      { url: "https://two.example/two" },
    ],
    fetcher,
    maxLinkedPages: 1,
  });

  assert.equal(result.linked_page_attempt_count, 1);
  assert.equal(linkedCalls.length, 1);
});

test("URL safety rejects private, loopback, credentialed, and non-http seeds", () => {
  for (const url of [
    "http://127.0.0.1/events",
    "http://10.0.0.2/events",
    "http://192.168.1.2/events",
    "http://172.20.0.2/events",
    "http://localhost/events",
    "http://venue.local/events",
    "http://[fe80::1]/events",
    "http://[fd00::1]/events",
    "https://user:secret@example.test/events",
    "file:///tmp/events",
  ]) {
    assert.equal(isScoutablePublicUrl(url), false, url);
  }
  assert.equal(isScoutablePublicUrl("https://venue.example/events"), true);
});

test("robots uses the longest matching rule", () => {
  const robots = [
    "User-agent: *",
    "Disallow: /private",
    "Allow: /private/public",
  ].join("\n");
  assert.equal(applyRobotsPolicy(robots, "/private/events").status, "disallowed");
  assert.equal(applyRobotsPolicy(robots, "/private/public/events").status, "allowed");
});

test("bounded scout obeys robots and never fetches discovered endpoints", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/robots.txt")) {
      return response("User-agent: *\nDisallow: /blocked\nAllow: /\n", {
        contentType: "text/plain",
      });
    }
    if (String(url).includes("/allowed")) {
      return response(
        '<link rel="alternate" type="text/calendar" href="/calendar.ics">',
      );
    }
    throw new Error("blocked page must not be fetched");
  };

  const result = await scoutLocalEventSources({
    ...context(),
    seeds: [
      { url: "https://venue.example/allowed", family: "venue_owned_calendar" },
      { url: "https://venue.example/blocked/events", family: "venue_owned_calendar" },
    ],
    fetcher,
  });

  assert.equal(result.inspected_source_count, 1);
  assert.equal(result.blocked_source_count, 1);
  assert.equal(result.manifest_candidates.length, 1);
  assert.equal(result.manifest_candidates[0].adapter, "ical");
  assert.ok(!calls.some((url) => url.includes("calendar.ics")));
  assert.deepEqual(calls, [
    "https://venue.example/robots.txt",
    "https://venue.example/allowed",
  ]);
});

test("fresh scout cache prevents repeated robots and source-page requests", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/robots.txt")) {
      return response("User-agent: *\nAllow: /\n", {
        contentType: "text/plain",
      });
    }
    return response(
      '<link rel="alternate" type="text/calendar" href="/events.ics">',
    );
  };
  const cache = createSourceCache({
    namespace: "source-scout-test",
    ttlMs: 60000,
  });
  const options = {
    ...context(),
    seeds: [{ url: "https://venue.example/program" }],
    fetcher,
    cache,
  };

  const first = await scoutLocalEventSources(options);
  const second = await scoutLocalEventSources(options);

  assert.equal(first.manifest_candidates.length, 1);
  assert.deepEqual(second.manifest_candidates, first.manifest_candidates);
  assert.deepEqual(calls, [
    "https://venue.example/robots.txt",
    "https://venue.example/program",
  ]);
});

test("scout cache never freezes a failed page response", async () => {
  let pageCalls = 0;
  const fetcher = async (url) => {
    if (String(url).endsWith("/robots.txt")) {
      return response("User-agent: *\nAllow: /\n", {
        contentType: "text/plain",
      });
    }
    pageCalls += 1;
    if (pageCalls === 1) throw new Error("temporary source failure");
    return response(
      '<link rel="alternate" type="text/calendar" href="/events.ics">',
    );
  };
  const cache = createSourceCache({
    namespace: "source-scout-recovery-test",
    ttlMs: 60000,
  });
  const options = {
    ...context(),
    seeds: [{ url: "https://venue.example/program" }],
    fetcher,
    cache,
  };

  const failed = await scoutLocalEventSources(options);
  const recovered = await scoutLocalEventSources(options);

  assert.equal(failed.failed_source_count, 1);
  assert.equal(recovered.manifest_candidates.length, 1);
  assert.equal(pageCalls, 2);
});

test("payload size and fetch failures fail soft with compact reason tokens", async () => {
  const tooLarge = await fetchScoutPage({
    url: "https://venue.example/events",
    fetcher: async () => response("small", { length: 999999 }),
    maxBytes: 1024,
  });
  assert.deepEqual(tooLarge, {
    status: "blocked",
    reason: "source_payload_too_large",
  });

  const failed = await fetchScoutPage({
    url: "https://venue.example/events",
    fetcher: async () => {
      throw new Error("https://secret.example?token=credential");
    },
  });
  assert.deepEqual(failed, {
    status: "failed",
    reason: "source_fetch_failed",
  });
  assert.ok(!JSON.stringify(failed).includes("credential"));
});

test("source timeout remains active while the response body is read", async () => {
  const result = await fetchScoutPage({
    url: "https://venue.example/events",
    timeoutMs: 50,
    fetcher: async (_url, options) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: () =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        }),
    }),
  });

  assert.deepEqual(result, { status: "failed", reason: "source_timeout" });
});

test("redirects are bounded and cannot cross into private network targets", async () => {
  const redirected = await fetchScoutPage({
    url: "https://venue.example/events",
    fetcher: async () => ({
      ok: false,
      status: 302,
      headers: {
        get(name) {
          return String(name).toLowerCase() === "location"
            ? "http://127.0.0.1/private-calendar"
            : null;
        },
      },
    }),
  });
  assert.deepEqual(redirected, {
    status: "blocked",
    reason: "unsafe_source_redirect",
  });
});

test("scout code is city-agnostic and cannot activate discovered sources", () => {
  const source = [
    "../server/pulse-sources/local-event-source-scout",
    "../server/pulse-sources/calendar-page-locator",
    "../server/pulse-sources/sitevision-calendar-provider",
  ].map((modulePath) => fs.readFileSync(require.resolve(modulePath), "utf8")).join("\n");
  assert.ok(!/athens|rome|barcelona|helsinki|österlen|skåne|malm[oö]/i.test(source));
  assert.ok(!/status:\s*"active"/.test(source));
});
