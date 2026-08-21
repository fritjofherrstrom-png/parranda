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

  assert.equal(result.decision, "non_event");
  assert.ok(result.reasons.includes("non_event_comment_feed"));
  // The venue and the page are both event-shaped. Only the interface is not.
  assert.ok(calendarPage().event_surface);
});

test("query-form comment feeds are rejected the same way as path-form ones", () => {
  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/?feed=comments-rss2"),
    page: calendarPage(),
  });

  assert.equal(result.decision, "non_event");
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
    assert.equal(result.decision, "non_event", url);
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
    assert.equal(result.decision, "non_event", url);
    assert.ok(result.reasons.includes("non_event_sitemap"), url);
  }
});

test("archived historical XML snapshots are never a live event interface", () => {
  const result = classifyRssEventInterface({
    link: link("https://arkiv.example/web/20080518005902/http://gammal.example/index.xml"),
    page: calendarPage(),
  });

  assert.equal(result.decision, "non_event");
  assert.ok(result.reasons.includes("non_event_archive_snapshot"));
});

test("section and archive feeds stay explorable rather than being written off", () => {
  // A section feed is exactly where a small publisher's programme tends to
  // live. We have no evidence it lists events, and no evidence it does not.
  for (const url of [
    "https://reseblogg.example/author/maria/feed/",
    "https://reseblogg.example/tag/resor/feed/",
    "https://forening.example/musik/feed/",
    "https://forening.example/kultur/feed/",
  ]) {
    const result = classifyRssEventInterface({ link: link(url), page: page() });
    assert.equal(result.decision, "exploratory", url);
  }
});

test("a per-article feed is uncertain, not condemned", () => {
  const result = classifyRssEventInterface({
    link: link("https://reseblogg.example/att-uppleva-gamla-hamnen/feed/"),
    page: contentPage(),
  });

  // Probably an entry discussion feed. "Probably" is not "known", so it is
  // kept out of the probe lane without being discarded.
  assert.equal(result.decision, "exploratory");
});

test("only an explicit comments marker condemns a nested feed", () => {
  // Nested under a calendar section: uncertain, kept.
  assert.equal(
    classifyRssEventInterface({
      link: link("https://kajscenen.example/kalender/sommarfest-2026/feed/"),
      page: page(),
    }).decision,
    "event_interface",
  );
  // Same shape, explicit comments marker: rejected.
  assert.equal(
    classifyRssEventInterface({
      link: link("https://kajscenen.example/kalender/sommarfest-2026/comments/feed/"),
      page: calendarPage(),
    }).decision,
    "non_event",
  );
});

test("search result feeds and site metadata XML are rejected", () => {
  const search = classifyRssEventInterface({
    link: link("https://reseblogg.example/?s=konsert&feed=rss2"),
    page: calendarPage(),
  });
  assert.equal(search.decision, "non_event");
  assert.ok(search.reasons.includes("non_event_search_feed"));

  const rsd = classifyRssEventInterface({
    link: link("https://reseblogg.example/xmlrpc/rsd.xml", { rel: "EditURI", type: "" }),
    page: calendarPage(),
  });
  assert.equal(rsd.decision, "non_event");
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

  assert.equal(result.decision, "exploratory");
  assert.equal(result.transport, "feed");
  assert.ok(result.reasons.includes("no_event_context_evidence_yet"));
});

test("an ordinary content page exposing a generic feed proves nothing about events", () => {
  const result = classifyRssEventInterface({
    link: link("https://reseblogg.example/feed/"),
    page: contentPage(),
  });

  assert.equal(result.decision, "exploratory");
});

test("a bare .xml file with no event context is transport only", () => {
  const result = classifyRssEventInterface({
    link: link("https://arkiv.example/register/poster.xml", { type: "" }),
    page: contentPage(),
  });

  assert.equal(result.decision, "exploratory");
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
    "exploratory",
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

  assert.equal(result.decision, "event_interface");
  assert.ok(result.reasons.includes("event_page_calendar_link_origin"));
});

test("an event calendar page linking a generic .xml stays discoverable", () => {
  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/export/data.xml", { type: "" }),
    page: calendarPage(),
  });

  assert.equal(result.decision, "event_interface");
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
  assert.equal(result.decision, "event_interface");
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

  assert.equal(result.decision, "event_interface");
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

  assert.equal(result.decision, "event_interface");
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

  assert.equal(result.decision, "event_interface");
  assert.ok(result.reasons.includes("event_page_schema_event_rows"));
});

test("an existing event-listing signature qualifies a generic feed", () => {
  const listing = page({ signatures: { eventListingSignature: true } });

  assert.deepEqual(listing.reasons, ["event_page_listing_signature"]);
  assert.equal(
    classifyRssEventInterface({ link: link("https://kajscenen.example/feed/"), page: listing })
      .decision,
    "event_interface",
  );
});

test("Atom MIME is recognized transport, and /feed/atom/ is still the site feed", () => {
  const atom = classifyRssEventInterface({
    link: link("https://kajscenen.example/syndication/9", {
      type: "application/atom+xml",
    }),
    page: calendarPage(),
  });
  assert.equal(atom.decision, "event_interface");
  assert.equal(atom.transport, "feed");

  const variant = classifyRssEventInterface({
    link: link("https://kajscenen.example/feed/atom/"),
    page: calendarPage(),
  });
  assert.equal(variant.decision, "event_interface");
});

test("links that are not feed shaped are never event interfaces", () => {
  const result = classifyRssEventInterface({
    link: link("https://kajscenen.example/om-oss", { type: "text/html" }),
    page: calendarPage(),
  });

  assert.equal(result.decision, "not_feed_shaped");
  assert.equal(result.transport, null);
  assert.deepEqual(result.reasons, ["transport_not_feed_shaped"]);
});

test("malformed and non-http locators fail closed", () => {
  for (const url of ["", "not a url", "javascript:alert(1)", "ftp://x.example/feed"]) {
    const result = classifyRssEventInterface({ link: link(url), page: calendarPage() });
    assert.equal(result.decision, "non_event", JSON.stringify(url));
    assert.ok(result.reasons.includes("transport_locator_unusable"), JSON.stringify(url));
  }
  assert.equal(classifyRssEventInterface({}).decision, "not_feed_shaped");
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
  assert.equal(declined.every((row) => row.decision !== "event_interface"), true);
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
      .filter((row) => row.decision === "non_event")
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

// --------------------------------------------------------------------------
// Small and poorly structured places.
//
// A village, island or seasonal destination rarely publishes /events, iCal or
// schema.org. Its programme shows up on a cultural association's generic feed,
// a municipal news feed or a venue blog. Discovery must not write those off:
// none of the cases below is asserted to BE an event feed, only to survive.
// --------------------------------------------------------------------------

const MESSY_PLACES = [
  {
    what: "village cultural association, generic feed only",
    pageUrl: "https://bygdeforening.example/",
    html: '<html lang="sv"><head><title>Bygdeföreningen</title></head><body></body></html>',
    feed: "https://bygdeforening.example/feed/",
  },
  {
    what: "local venue with a section feed we cannot classify",
    pageUrl: "https://spelstallet.example/",
    html: '<html lang="sv"><head><title>Spelstället</title></head><body></body></html>',
    feed: "https://spelstallet.example/musik/feed/",
  },
  {
    what: "municipality publishing through ordinary news",
    pageUrl: "https://litenkommun.example/",
    html: '<html lang="sv"><head><title>Liten kommun</title></head><body></body></html>',
    feed: "https://litenkommun.example/nyheter/feed/",
  },
  {
    what: "seasonal festival site with an undated generic feed",
    pageUrl: "https://sommarfest.example/",
    html: '<html lang="sv"><head><title>Sommarfest</title></head><body></body></html>',
    feed: "https://sommarfest.example/feed/",
  },
  {
    what: "weakly structured local-language source",
    pageUrl: "https://otok.example/",
    html: '<html lang="hr"><head><title>Otok</title></head><body></body></html>',
    feed: "https://otok.example/index.xml",
  },
  {
    what: "island association exposing only a bare .xml",
    pageUrl: "https://skargard.example/om-oss",
    html: '<html lang="sv"><head><title>Om oss</title></head><body></body></html>',
    feed: "https://skargard.example/data/export.xml",
  },
];

test("messy small-place sources are retained for exploration, never discarded", () => {
  for (const entry of MESSY_PLACES) {
    const result = classifyRssEventInterface({
      link: link(entry.feed),
      page: page({ pageUrl: entry.pageUrl, html: entry.html }),
    });

    // The claim is NOT that these are event feeds. The claim is that discovery
    // has no evidence against them and must keep them reachable.
    assert.equal(result.decision, "exploratory", entry.what);
    assert.ok(result.transport, entry.what);
  }
});

test("a small place with no event structure still yields exploratory discovery", () => {
  const html = [
    '<html lang="sv"><head><title>Bygdeföreningen</title>',
    '<link rel="alternate" type="application/rss+xml" href="/feed/">',
    '<link rel="alternate" type="application/rss+xml" href="/comments/feed/">',
    "</head><body></body></html>",
  ].join("\n");

  const result = inspect(html, { url: "https://bygdeforening.example/", family: "unknown_source_family" });

  // Nothing is promoted to an event source on this evidence...
  assert.deepEqual(result.manifest_candidates, []);
  assert.equal(result.detected.includes("rss"), false);

  // ...but the generic feed survives as discovery evidence, while the comments
  // feed does not. That is the whole distinction.
  assert.deepEqual(
    result.exploratory_interfaces.map((hint) => hint.url),
    ["https://bygdeforening.example/feed/"],
  );
  const [hint] = result.exploratory_interfaces;
  assert.equal(hint.runtime_policy, "probe_only");
  assert.equal(hint.corroboration_required, true);
  assert.ok(hint.reasons.includes("exploratory_interface_not_yet_event_attested"));
});

test("exploratory interfaces never enter the bounded qualification probe lane", () => {
  // The qualification rotation probes two candidates per run, oldest-first,
  // with no notion of candidate strength. Uncertain feeds must therefore stay
  // out of the manifest lane or they would starve real event candidates.
  const html = [
    '<html lang="sv"><head><title>Bygdeföreningen</title>',
    '<link rel="alternate" type="application/rss+xml" href="/feed/">',
    '<link rel="alternate" type="application/rss+xml" href="/musik/feed/">',
    '<link rel="alternate" type="application/rss+xml" href="/nyheter/feed/">',
    '<link rel="alternate" type="text/calendar" href="/kalender.ics">',
    "</head><body></body></html>",
  ].join("\n");

  const result = inspect(html, { url: "https://bygdeforening.example/" });

  assert.equal(result.exploratory_interfaces.length, 3);
  assert.deepEqual(
    result.manifest_candidates.map((manifest) => manifest.adapter),
    ["ical"],
  );
  for (const hint of result.exploratory_interfaces) {
    assert.equal(hint.runtime_policy, "probe_only");
  }
});

test("scout results report all four interface populations", async () => {
  const {
    scoutLocalEventSources,
  } = require("../server/pulse-sources/local-event-source-scout");

  // Deliberately NOT an event surface, so each feed is judged on its own
  // evidence rather than inheriting the page's.
  const html = [
    '<html lang="sv"><head><title>Bygdeföreningen</title>',
    '<link rel="alternate" type="application/rss+xml" href="/evenemang/feed/">',
    '<link rel="alternate" type="application/rss+xml" href="/musik/feed/">',
    '<link rel="alternate" type="application/rss+xml" href="/comments/feed/">',
    '<link rel="search" href="/opensearch.xml">',
    "</head><body></body></html>",
  ].join("\n");

  const result = await scoutLocalEventSources({
    place: { label: "Test Region" },
    bounds: [12.5, 55.2, 14.7, 56.0],
    seeds: [{ url: "https://bygdeforening.example/", label: "Bygdeföreningen" }],
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

  assert.equal(result.rss_transport_link_count, 4);
  assert.equal(result.rss_event_interface_count, 1);
  assert.equal(result.rss_exploratory_interface_count, 1);
  assert.equal(result.rss_rejected_interface_count, 2);
  assert.equal(result.exploratory_interfaces.length, 1);
});
