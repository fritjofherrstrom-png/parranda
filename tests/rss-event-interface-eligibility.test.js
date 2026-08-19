"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  buildRssPageEventContext,
  classifyRssEventInterface,
} = require("../server/pulse-sources/rss-event-interface");
const {
  inspectEventSourcePage,
} = require("../server/pulse-sources/local-event-source-scout");

// Unrelated fictional publishers. No staging place, no production domain.
const CONTENT_PAGE = "https://reseblogg.example/att-uppleva-gamla-hamnen";
const VENUE_HOME = "https://kajscenen.example/";
const CALENDAR_PAGE = "https://kajscenen.example/kalender";

function page(overrides = {}) {
  return buildRssPageEventContext({
    pageUrl: VENUE_HOME,
    seed: {},
    html: "<html><head><title>Kajscenen</title></head><body></body></html>",
    ...overrides,
  });
}

function link(url, overrides = {}) {
  return { tag: "link", url, rel: "alternate", type: "application/rss+xml", ...overrides };
}

function classify(url, { linkOverrides = {}, pageOverrides = {} } = {}) {
  return classifyRssEventInterface({
    link: link(url, linkOverrides),
    page: page(pageOverrides),
  });
}

const calendarPage = () =>
  page({
    pageUrl: CALENDAR_PAGE,
    seed: { discovery_method: "same_origin_calendar_link" },
    html: "<html><head><title>Kalender</title></head><body></body></html>",
  });

const contentPage = () =>
  page({
    pageUrl: CONTENT_PAGE,
    html: "<html><head><title>Att uppleva gamla hamnen</title></head><body></body></html>",
  });

// --------------------------------------------------------------------------
// Negative evidence: feed-shaped interfaces that never index events.
// --------------------------------------------------------------------------

test("a comments feed is not an event interface even on an event venue's calendar page", () => {
  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/comments/feed/"),
    page: calendarPage(),
  });

  assert.equal(result.decision, "ineligible");
  assert.ok(result.reasons.includes("non_event_comment_feed"));
  // The venue and the page are both event-shaped. Only the interface is not.
  assert.ok(calendarPage().event_surface);
});

test("query-form comment feeds are rejected the same way as path-form ones", () => {
  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/?feed=comments-rss2"),
    page: calendarPage(),
  });

  assert.equal(result.decision, "ineligible");
  assert.ok(result.reasons.includes("non_event_comment_feed"));
});

test("OpenSearch descriptors are search plumbing, not event interfaces", () => {
  for (const url of [
    "https://reseblogg.example/opensearch.xml",
    "https://reseblogg.example/osd.xml",
  ]) {
    const result = classifyRssEventInterface({
      link: link(url, { rel: "search", type: "application/opensearchdescription+xml" }),
      page: calendarPage(),
    });
    assert.equal(result.decision, "ineligible", url);
    assert.ok(result.reasons.includes("non_event_opensearch_descriptor"), url);
  }
});

test("sitemap XML is a crawl index, not an event index", () => {
  for (const url of [
    "https://kajscenen.example/sitemap.xml",
    "https://kajscenen.example/wp-sitemap-posts-post-1.xml",
    "https://kajscenen.example/sitemap/events.xml",
  ]) {
    const result = classifyRssEventInterface({
      link: link(url, { type: "application/xml" }),
      page: calendarPage(),
    });
    assert.equal(result.decision, "ineligible", url);
    assert.ok(result.reasons.includes("non_event_sitemap"), url);
  }
});

test("archived historical XML snapshots are never a live event interface", () => {
  const result = classifyRssEventInterface({
    link: link("https://arkiv.example/web/20080518005902/http://gammal.example/index.xml"),
    page: calendarPage(),
  });

  assert.equal(result.decision, "ineligible");
  assert.ok(result.reasons.includes("non_event_archive_snapshot"));
});

test("author, tag and category archive feeds carry no event context", () => {
  for (const url of [
    "https://reseblogg.example/author/maria/feed/",
    "https://reseblogg.example/tag/resor/feed/",
    "https://reseblogg.example/category/mat/feed/",
  ]) {
    const result = classifyRssEventInterface({ link: link(url), page: calendarPage() });
    assert.equal(result.decision, "ineligible", url);
    assert.ok(result.reasons.includes("non_event_entry_scoped_feed"), url);
  }
});

test("a per-article feed indexes one article's discussion, not a programme", () => {
  const result = classifyRssEventInterface({
    link: link("https://reseblogg.example/att-uppleva-gamla-hamnen/feed/"),
    page: contentPage(),
  });

  assert.equal(result.decision, "ineligible");
  assert.ok(result.reasons.includes("non_event_entry_scoped_feed"));
});

test("an event detail page's own feed is not the programme index", () => {
  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/kalender/sommarfest-2026/feed/"),
    page: calendarPage(),
  });

  assert.equal(result.decision, "ineligible");
  assert.ok(result.reasons.includes("non_event_entry_scoped_feed"));
});

test("search result feeds and site metadata XML are rejected", () => {
  const search = classifyRssEventInterface({
    link: link("https://reseblogg.example/?s=konsert&feed=rss2"),
    page: calendarPage(),
  });
  assert.equal(search.decision, "ineligible");
  assert.ok(search.reasons.includes("non_event_search_feed"));

  const rsd = classifyRssEventInterface({
    link: link("https://reseblogg.example/xmlrpc/rsd.xml", { rel: "EditURI", type: "" }),
    page: calendarPage(),
  });
  assert.equal(rsd.decision, "ineligible");
  assert.ok(rsd.reasons.includes("non_event_site_metadata"));
});

// --------------------------------------------------------------------------
// Ambiguous: real feed transport, no positive event context.
// --------------------------------------------------------------------------

test("a generic homepage site feed stays out of the event lane rather than being promoted", () => {
  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/feed/"),
    page: page(),
  });

  assert.equal(result.decision, "insufficient_event_context");
  assert.equal(result.transport, "feed");
  assert.ok(result.reasons.includes("no_event_context_evidence"));
});

test("an ordinary content page exposing a generic feed proves nothing about events", () => {
  const result = classifyRssEventInterface({
    link: link("https://reseblogg.example/feed/"),
    page: contentPage(),
  });

  assert.equal(result.decision, "insufficient_event_context");
});

test("a bare .xml file with no event context is transport only", () => {
  const result = classifyRssEventInterface({
    link: link("https://arkiv.example/register/poster.xml", { type: "" }),
    page: contentPage(),
  });

  assert.equal(result.decision, "insufficient_event_context");
  assert.equal(result.transport, "xml");
});

test("an article about events does not qualify a site-wide feed", () => {
  const article = page({
    pageUrl: "https://reseblogg.example/blogg/basta-eventen-2026",
    html: "<html><head><title>Bästa eventen 2026</title></head></html>",
  });

  assert.equal(article.event_surface, false);
  assert.equal(
    classifyRssEventInterface({ link: link("https://reseblogg.example/feed/"), page: article })
      .decision,
    "insufficient_event_context",
  );
});

// --------------------------------------------------------------------------
// Recall: legitimate event feeds keep generic transport shapes.
// --------------------------------------------------------------------------

test("an event calendar page linking a bare /feed stays discoverable", () => {
  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/feed/"),
    page: calendarPage(),
  });

  assert.equal(result.decision, "eligible");
  assert.ok(result.reasons.includes("event_page_calendar_link_origin"));
});

test("an event calendar page linking a generic .xml stays discoverable", () => {
  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/export/data.xml", { type: "" }),
    page: calendarPage(),
  });

  assert.equal(result.decision, "eligible");
  assert.equal(result.transport, "xml");
});

test("a localized non-English calendar page qualifies its feed without English words", () => {
  // `arrangementer` is a resolver-attested local discovery term, not a
  // hardcoded English calendar word.
  const danish = page({
    pageUrl: "https://kulturhus.example/arrangementer",
    html: '<html lang="da"><head><title>Arrangementer i huset</title></head></html>',
    eventTerms: ["arrangementer", "koncert"],
  });

  assert.ok(danish.event_surface);
  const result = classifyRssEventInterface({
    link: link("https://kulturhus.example/feed/"),
    page: danish,
  });
  assert.equal(result.decision, "eligible");
  assert.ok(result.reasons.includes("event_page_path_terms"));
});

test("a localized section feed survives when only the local term marks it", () => {
  const danish = page({
    pageUrl: "https://kulturhus.example/",
    html: '<html lang="da"><head><title>Kulturhuset</title></head></html>',
    eventTerms: ["arrangementer"],
  });

  const result = classifyRssEventInterface({
    link: link("https://kulturhus.example/arrangementer/feed/"),
    page: danish,
  });

  assert.equal(result.decision, "eligible");
  assert.ok(result.reasons.includes("event_feed_path_terms"));
});

test("an accessible feed name carrying event semantics is positive evidence", () => {
  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/x/9182", {
      type: "application/atom+xml",
      title: "Evenemang",
    }),
    page: page(),
  });

  assert.equal(result.decision, "eligible");
  assert.ok(result.reasons.includes("event_link_label_terms"));
});

test("schema.org event rows on the page qualify a generic feed", () => {
  const schemaPage = page({
    pageUrl: "https://kajscenen.example/",
    signatures: { schemaEventCount: 3 },
  });

  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/feed/"),
    page: schemaPage,
  });

  assert.equal(result.decision, "eligible");
  assert.ok(result.reasons.includes("event_page_schema_event_rows"));
});

test("an existing event-listing signature qualifies a generic feed", () => {
  const listing = page({ signatures: { eventListingSignature: true } });

  assert.deepEqual(listing.reasons, ["event_page_listing_signature"]);
  assert.equal(
    classifyRssEventInterface({ link: link("https://kajscenen.example/feed/"), page: listing })
      .decision,
    "eligible",
  );
});

test("Atom MIME is recognized transport, and /feed/atom/ is still the site feed", () => {
  const atom = classifyRssEventInterface({
    link: link("https://kajscenen.example/syndication/9", {
      type: "application/atom+xml",
    }),
    page: calendarPage(),
  });
  assert.equal(atom.decision, "eligible");
  assert.equal(atom.transport, "feed");

  const variant = classifyRssEventInterface({
    link: link("https://kajscenen.example/feed/atom/"),
    page: calendarPage(),
  });
  assert.equal(variant.decision, "eligible");
});

test("links that are not feed shaped are never event interfaces", () => {
  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/om-oss", { type: "text/html" }),
    page: calendarPage(),
  });

  assert.equal(result.decision, "ineligible");
  assert.equal(result.transport, null);
  assert.deepEqual(result.reasons, ["transport_not_feed_shaped"]);
});

test("malformed and non-http locators fail closed", () => {
  for (const url of ["", "not a url", "javascript:alert(1)", "ftp://x.example/feed"]) {
    const result = classifyRssEventInterface({ link: link(url), page: calendarPage() });
    assert.equal(result.decision, "ineligible", JSON.stringify(url));
  }
  // A declared feed MIME with no usable locator must not become eligible.
  assert.equal(classifyRssEventInterface({}).decision, "ineligible");
});

// --------------------------------------------------------------------------
// Integration: the same rule at the real discovery boundary.
// --------------------------------------------------------------------------

function inspect(html, seedOverrides = {}) {
  return inspectEventSourcePage({
    seed: {
      url: VENUE_HOME,
      label: "Kajscenen",
      family: "venue_owned_calendar",
      trust_tier: "institution",
      source_language: "sv",
      ...seedOverrides,
    },
    html,
    context: {
      place: { label: "Test Region", language_hints: ["sv"] },
      bounds: [12.5, 55.2, 14.7, 56.0],
      localDiscoveryTerms: ["evenemang", "konsert"],
    },
  });
}

test("discovery no longer proposes non-event feeds as event sources", () => {
  const html = [
    "<html><head><title>Kajscenen</title>",
    '<link rel="alternate" type="application/rss+xml" href="/comments/feed/">',
    '<link rel="search" type="application/opensearchdescription+xml" href="/osd.xml">',
    '<link rel="alternate" type="application/rss+xml" href="/feed/">',
    '<link rel="alternate" type="application/xml" href="/sitemap.xml">',
    "</head><body>",
    '<a href="/nyhet-om-huset/feed/">Kommentarer</a>',
    "</body></html>",
  ].join("\n");

  const result = inspect(html);

  assert.equal(result.detected.includes("rss"), false);
  assert.equal(
    result.candidates.some((candidate) => candidate.adapter === "rss_atom_event_detail"),
    false,
  );
  assert.deepEqual(result.manifest_candidates, []);
  assert.deepEqual(result.reasons, ["no_event_source_interface_detected"]);

  // Every declined interface is explainable, with bounded reason tokens.
  const declined = result.rss_interface_decisions;
  assert.equal(declined.length, 5);
  assert.equal(declined.every((row) => row.decision !== "eligible"), true);
  assert.equal(
    declined.every((row) => row.reasons.every((token) => /^[a-z0-9_]{1,64}$/.test(token))),
    true,
  );
});

test("discovery still proposes a bare /feed from a real calendar surface", () => {
  const html = [
    '<html lang="sv"><head><title>Evenemang</title>',
    '<link rel="alternate" type="application/rss+xml" href="/feed/">',
    '<link rel="alternate" type="application/rss+xml" href="/comments/feed/">',
    "</head><body><h1>Evenemang</h1></body></html>",
  ].join("\n");

  const result = inspect(html, {
    url: "https://kajscenen.example/evenemang",
    discovery_method: "same_origin_calendar_link",
  });

  const rss = result.candidates.filter(
    (candidate) => candidate.adapter === "rss_atom_event_detail",
  );
  assert.equal(rss.length, 1);
  assert.equal(rss[0].url, "https://kajscenen.example/feed/");
  assert.ok(result.detected.includes("rss"));

  // The proposal is still only a proposal: unchanged review contract.
  const manifest = result.manifest_candidates.find(
    (row) => row.adapter === "rss_atom_event_detail",
  );
  assert.equal(manifest.status, "review-needed");
  assert.equal(manifest.runtime_policy, "review_required");
  assert.equal(manifest.confidence, "low");
  assert.equal(manifest.review.terms_status, "unknown");

  // The comments feed on the very same calendar page is still declined.
  assert.deepEqual(
    result.rss_interface_decisions
      .filter((row) => row.decision !== "eligible")
      .map((row) => row.url),
    ["https://kajscenen.example/comments/feed/"],
  );
});

test("scout results count feed transport against real event interfaces", async () => {
  const {
    scoutLocalEventSources,
  } = require("../server/pulse-sources/local-event-source-scout");

  const html = [
    '<html lang="sv"><head><title>Evenemang</title>',
    '<link rel="alternate" type="application/rss+xml" href="/evenemang/feed/">',
    '<link rel="alternate" type="application/rss+xml" href="/comments/feed/">',
    '<link rel="search" href="/opensearch.xml">',
    "</head><body></body></html>",
  ].join("\n");

  const result = await scoutLocalEventSources({
    place: { label: "Test Region" },
    bounds: [12.5, 55.2, 14.7, 56.0],
    seeds: [{ url: "https://kajscenen.example/evenemang", label: "Kajscenen" }],
    fetcher: async (url) => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) =>
          String(name).toLowerCase() === "content-type"
            ? String(url).endsWith("robots.txt")
              ? "text/plain"
              : "text/html"
            : null,
      },
      text: async () => (String(url).endsWith("robots.txt") ? "" : html),
    }),
  });

  assert.equal(result.rss_transport_link_count, 3);
  assert.equal(result.rss_event_interface_count, 1);
  assert.equal(result.rss_rejected_interface_count, 2);
});

test("rss eligibility code is city-agnostic and cannot activate a source", () => {
  const source = fs.readFileSync(
    require.resolve("../server/pulse-sources/rss-event-interface"),
    "utf8",
  );

  assert.ok(!/athens|rome|barcelona|helsinki|österlen|skåne|malm[oö]/i.test(source));
  assert.ok(!/status:\s*"active"/.test(source));
  // The rule must stay pure: no network, no clock, no I/O. That is what keeps
  // it deterministic and keeps trust/qualification a separate concern.
  assert.ok(!/\bfetch\b|require\(["']node:|Date\.now|new Date\b/.test(source));
});

test("a junk feed no longer blocks the scout from reaching the real calendar page", async () => {
  const {
    scoutLocalEventSources,
  } = require("../server/pulse-sources/local-event-source-scout");

  // A homepage whose only feed-shaped link is a comments feed, plus a real
  // same-origin calendar link. A manifest from the homepage short-circuits the
  // linked-page crawl, so a junk feed used to cost the calendar page entirely.
  const HOME = [
    '<html lang="sv"><head><title>Kajscenen</title>',
    '<link rel="alternate" type="application/rss+xml" href="/comments/feed/">',
    "</head><body>",
    '<a href="/evenemang">Evenemang</a>',
    "</body></html>",
  ].join("\n");
  const CALENDAR = [
    '<html lang="sv"><head><title>Evenemang</title>',
    '<link rel="alternate" type="text/calendar" href="/evenemang.ics">',
    "</head><body></body></html>",
  ].join("\n");

  const fetched = [];
  const result = await scoutLocalEventSources({
    place: { label: "Test Region" },
    bounds: [12.5, 55.2, 14.7, 56.0],
    seeds: [{ url: "https://kajscenen.example/", label: "Kajscenen" }],
    fetcher: async (url) => {
      const target = String(url);
      if (!target.endsWith("robots.txt")) fetched.push(target);
      const body = target.endsWith("robots.txt")
        ? ""
        : target.includes("/evenemang")
          ? CALENDAR
          : HOME;
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) =>
            String(name).toLowerCase() === "content-type"
              ? target.endsWith("robots.txt")
                ? "text/plain"
                : "text/html"
              : null,
        },
        text: async () => body,
      };
    },
  });

  assert.ok(fetched.includes("https://kajscenen.example/evenemang"));
  assert.equal(result.linked_source_count, 1);
  assert.deepEqual(
    result.manifest_candidates.map((manifest) => manifest.adapter),
    ["ical"],
  );
  assert.equal(result.rss_event_interface_count, 0);
  assert.equal(result.rss_rejected_interface_count, 1);
});
