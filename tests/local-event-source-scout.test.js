"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const { createSourceCache } = require("../server/place-candidates/source-cache");

const {
  applyRobotsPolicy,
  buildLocalEventDiscoveryQueries,
  extractEventWebsiteSeeds,
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
  assert.ok(result.candidates.some((candidate) => candidate.adapter === "needs_adapter"));
  assert.equal(result.social_hints.length, 1);
  assert.equal(result.social_hints[0].runtime_policy, "probe_only");
  assert.equal(result.social_hints[0].corroboration_required, true);

  assert.deepEqual(
    result.manifest_candidates.map((manifest) => manifest.adapter).sort(),
    ["ical", "schema_org_html"],
  );
  for (const manifest of result.manifest_candidates) {
    assert.equal(manifest.status, "review-needed");
    assert.equal(manifest.runtime_policy, "review_required");
    assert.equal(manifest.confidence, "low");
    assert.equal(manifest.review.terms_status, "unknown");
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
  const source = fs.readFileSync(
    require.resolve("../server/pulse-sources/local-event-source-scout"),
    "utf8",
  );
  assert.ok(!/athens|rome|barcelona|helsinki|österlen|skåne|malm[oö]/i.test(source));
  assert.ok(!/status:\s*"active"/.test(source));
});
