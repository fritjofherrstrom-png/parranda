"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createRssAtomEventProvider,
  extractRssAtomEntryLinks,
} = require("../server/pulse-sources/rss-atom-event-provider");
const { collectPulseSourcesForCity } = require("../server/pulse-sources/provider-registry");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");

const ENDPOINT = "https://calendar.example/events/feed.xml";
const NOW = new Date("2026-07-20T16:30:00.000Z");
const city = { key: "fixture-city", label: "Fixture City" };

function rss(items = []) {
  return `<?xml version="1.0"?><rss version="2.0"><channel>${items.join("")}</channel></rss>`;
}

function rssItem(link, overrides = {}) {
  return [
    "<item>",
    `<title>${overrides.title || "Published listing title"}</title>`,
    `<link>${link}</link>`,
    `<pubDate>${overrides.pubDate || "Mon, 20 Jul 2026 17:00:00 GMT"}</pubDate>`,
    `<description>${overrides.description || "Editorial feed text is not an event atom."}</description>`,
    "</item>",
  ].join("");
}

function atomEntry(link) {
  return [
    "<entry>",
    "<title>Atom publication title</title>",
    `<link rel="alternate" href="${link}" />`,
    "<updated>2026-07-20T17:00:00Z</updated>",
    "<summary>Publication copy is not event timing.</summary>",
    "</entry>",
  ].join("");
}

function eventHtml(overrides = {}) {
  const event = {
    "@context": "https://schema.org",
    "@type": "Event",
    "@id": "https://calendar.example/events/harbour-concert",
    name: "Harbour concert",
    startDate: "2026-07-20T19:00:00+02:00",
    endDate: "2026-07-20T21:00:00+02:00",
    url: "https://calendar.example/events/harbour-concert",
    location: {
      name: "Harbour stage",
      geo: { latitude: 59.33, longitude: 18.07 },
    },
    ...overrides,
  };
  return `<!doctype html><main>Editorial page copy.</main><script type="application/ld+json">${JSON.stringify(event)}</script>`;
}

function response(body, { url, status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    text: async () => body,
  };
}

function provider(overrides = {}) {
  return createRssAtomEventProvider({
    endpoint: ENDPOINT,
    sourceUrl: "https://calendar.example/events/",
    label: "Reviewed local calendar",
    sourceLanguage: "sv",
    supportedLanguages: ["sv"],
    sourceTier: "institution",
    confidence: "medium",
    license: "Public factual calendar",
    ...overrides,
  });
}

async function directCollect(overrides = {}) {
  return provider(overrides).create(city).collect({ date: NOW });
}

test("extracts bounded same-origin RSS and Atom detail links without reading publication time", () => {
  const xml = [
    rss([rssItem("https://calendar.example/events/market")]),
    `<feed xmlns="http://www.w3.org/2005/Atom">${atomEntry("/events/concert")}</feed>`,
  ].join("");
  const result = extractRssAtomEntryLinks(xml, { baseUrl: ENDPOINT, limit: 5 });

  assert.equal(result.recognized, true);
  assert.deepEqual(result.links, [
    "https://calendar.example/events/market",
    "https://calendar.example/events/concert",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /pubDate|updated|2026-07-20T17:00/);
});

test("normalizes a reviewed RSS detail page into existing time_sensitive_events", async () => {
  const detailUrl = "https://calendar.example/events/harbour-concert";
  const fetcher = async (url) => {
    if (url === ENDPOINT) return response(rss([rssItem(detailUrl)]), { url });
    if (url === detailUrl) return response(eventHtml(), { url });
    throw new Error("unexpected URL");
  };
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ fetcher })],
    context: { now: NOW },
  });

  assert.equal(result.time_sensitive_events.length, 1);
  const event = result.time_sensitive_events[0];
  assert.equal(event.title, "Harbour concert");
  assert.equal(event.timing_relevance, "tonight");
  assert.equal(event.source_url, detailUrl);
  assert.equal(event.source_label, "Reviewed local calendar");
  assert.equal(event.source_language, "sv");
  assert.equal(event.event_language, "sv");
  assert.equal(event.translation_status, "needed");
  assert.equal(event.confidence, "medium");
  assert.doesNotMatch(JSON.stringify(event), /Editorial page copy|Editorial feed text/);
});

test("feeds the existing bounded anchor acquisition and source-health path", async () => {
  const detailUrl = "https://calendar.example/events/harbour-concert";
  const fetcher = async (url) => response(
    url === ENDPOINT ? rss([rssItem(detailUrl)]) : eventHtml(),
    { url },
  );
  const result = await collectAnchorEvents({
    anchor: { lat: 59.3293, lng: 18.0686 },
    now: NOW,
    fetcher,
    registry: [{
      id: "reviewed-rss-detail",
      label: "Reviewed local calendar",
      endpoint: ENDPOINT,
      adapter: "rss_atom_event_detail",
      bbox: [17.8, 59.1, 18.3, 59.5],
      source_language: "sv",
      source_tier: "institution",
      confidence: "medium",
      source_family: "cultural_institution_calendar",
      source_identity: "calendar.example",
      status: "active",
      runtime_policy: "bounded_refresh",
      terms_status: "api_terms_compatible",
      source_health: "healthy",
    }],
  });

  assert.equal(result.coverage, "covered");
  assert.equal(result.tonight.length, 1);
  assert.equal(result.tonight[0].title, "Harbour concert");
  assert.equal(result.acquisition.source_health.status, "healthy");
  assert.equal(result.feeds[0].adapter, "rss_atom_event_detail");
  assert.equal(result.feeds[0].event_rows, 1);
});

test("pubDate and Atom updated never become event timing", async () => {
  const rssDetail = "https://calendar.example/events/rss-undated";
  const atomDetail = "https://calendar.example/events/atom-undated";
  const feed = [
    rss([rssItem(rssDetail)]),
    `<feed xmlns="http://www.w3.org/2005/Atom">${atomEntry(atomDetail)}</feed>`,
  ].join("");
  const undatedHtml = eventHtml({ startDate: undefined, endDate: undefined });
  const result = await directCollect({
    fetcher: async (url) => response(url === ENDPOINT ? feed : undatedHtml, { url }),
  });

  assert.deepEqual(result.time_sensitive_events, []);
  assert.equal(result.collection_status.status, "failed");
  assert.equal(result.collection_status.reason, "source_payload_invalid");
});

test("continues past stale or unparseable feed rows within a strict detail budget", async () => {
  const staleUrl = "https://calendar.example/events/stale";
  const validUrl = "https://calendar.example/events/current";
  const result = await directCollect({
    detailLimit: 1,
    detailBudget: 2,
    fetcher: async (url) => {
      if (url === ENDPOINT) {
        return response(rss([rssItem(staleUrl), rssItem(validUrl)]), { url });
      }
      return response(url === staleUrl
        ? eventHtml({
            "@id": staleUrl,
            url: staleUrl,
            startDate: "2025-07-20T19:00:00+02:00",
            endDate: "2025-07-20T21:00:00+02:00",
          })
        : eventHtml(), { url });
    },
  });

  assert.equal(result.collection_status.status, "ok");
  assert.equal(result.time_sensitive_events.length, 1);
  assert.equal(result.collection_diagnostics.detail_parse_failure_count, 0);
  assert.equal(result.collection_diagnostics.stale_event_count, 1);
  assert.equal(result.collection_diagnostics.detail_attempt_count, 2);
});

test("rejects cross-origin feed redirects and cross-origin item links", async () => {
  const redirected = await directCollect({
    fetcher: async (url) => response("", {
      url,
      status: 302,
      headers: { location: "https://evil.example/feed.xml" },
    }),
  });
  assert.equal(redirected.collection_status.status, "failed");
  assert.equal(redirected.collection_status.reason, "source_redirect_cross_origin");

  const externalOnly = await directCollect({
    fetcher: async (url) => response(rss([
      rssItem("https://syndicated.example/events/not-reviewed"),
    ]), { url }),
  });
  assert.equal(externalOnly.collection_status.status, "failed");
  assert.equal(externalOnly.collection_status.reason, "source_payload_invalid");
});

test("allows bounded same-origin redirects but rejects an off-origin detail redirect", async () => {
  const movedFeed = "https://calendar.example/events/current-feed.xml";
  const detailUrl = "https://calendar.example/events/market";
  const redirected = await directCollect({
    fetcher: async (url) => {
      if (url === ENDPOINT) {
        return response("", {
          url,
          status: 302,
          headers: { location: "/events/current-feed.xml" },
        });
      }
      if (url === movedFeed) return response(rss([rssItem(detailUrl)]), { url });
      return response(eventHtml(), { url });
    },
  });
  assert.equal(redirected.collection_status.status, "ok");
  assert.equal(redirected.time_sensitive_events.length, 1);

  const rejectedDetail = await directCollect({
    fetcher: async (url) => {
      if (url === ENDPOINT) return response(rss([rssItem(detailUrl)]), { url });
      return response("", {
        url,
        status: 302,
        headers: { location: "https://evil.example/event" },
      });
    },
  });
  assert.equal(rejectedDetail.collection_status.status, "failed");
  assert.equal(rejectedDetail.collection_status.reason, "source_redirect_cross_origin");
});

test("keeps feed body parsing inside the collection timeout", async () => {
  const result = await directCollect({
    timeoutMs: 50,
    fetcher: async (url, options) => ({
      ok: true,
      status: 200,
      url,
      headers: { get: () => null },
      text: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    }),
  });

  assert.equal(result.collection_status.status, "failed");
  assert.equal(result.collection_status.reason, "source_timeout");
});
