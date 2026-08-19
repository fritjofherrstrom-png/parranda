"use strict";

/**
 * Generic RSS/Atom event-interface eligibility.
 *
 * RSS/Atom shape is *transport* evidence, not event evidence. A feed MIME
 * type, a `/feed` path, a `.rss` suffix or a `.xml` suffix only says a
 * document might be a syndication index. It says nothing about whether that
 * index lists events.
 *
 * Discovery used to treat transport shape alone as an event-source interface,
 * so comment feeds, OpenSearch descriptors, sitemaps, per-article feeds and
 * archived XML pages all became `rss_atom_event_detail` candidates. They were
 * probed repeatedly and never carried a single event row, because the
 * interface itself was never an event interface.
 *
 * This module keeps the three kinds of evidence apart:
 *
 *   transport shape   - could this be a syndication feed at all?
 *   negative evidence - is this a recognized non-event XML interface?
 *   event context     - is there a positive, source-owned reason to believe
 *                       this index lists events?
 *
 * Eligibility = transport AND NOT negative AND event context.
 *
 * The rule is pure and deterministic: no network, no clock, no publisher,
 * place, city or domain rules. It decides only whether an interface is
 * plausibly an event interface. Whether Parranda may activate it stays a
 * separate question owned by terms, robots, geometry and qualification.
 */

const { CALENDAR_LINK_TERMS } = require("./calendar-page-locator");

// A feed link that is not a feed at all. These `rel` values describe site
// plumbing (search plugins, editor endpoints, assets), never an event index.
const NON_FEED_LINK_RELS = new Set([
  "apple-touch-icon",
  "canonical",
  "dns-prefetch",
  "edituri",
  "icon",
  "manifest",
  "mask-icon",
  "pingback",
  "preconnect",
  "preload",
  "prefetch",
  "profile",
  "search",
  "shortcut",
  "shortlink",
  "stylesheet",
  "wlwmanifest",
]);

const FEED_MIME_PATTERN = /(?:rss|atom|rdf)\+xml/;
const GENERIC_XML_MIME_PATTERN = /^(?:application|text)\/xml$/;
const OPENSEARCH_MIME_PATTERN = /opensearchdescription\+xml/;

// Well-known syndication filenames. These are transport evidence only.
const FEED_FILENAME_PATTERN = /^(?:feed|rss|atom|index)\.(?:rss|atom|xml|rdf)$/;
const OPENSEARCH_FILENAME_PATTERN = /^(?:opensearch|osd|opensearchdescription)\b/;
const SITEMAP_FILENAME_PATTERN = /^(?:wp-)?sitemap(?:[-_].*)?\.xml(?:\.gz)?$/;
const SITE_METADATA_FILENAME_PATTERN =
  /^(?:rsd|wlwmanifest|browserconfig|crossdomain|manifest|opensearch)\.xml$/;
// Wayback-style snapshot prefixes: /web/20080518005902/http://...
const ARCHIVE_SNAPSHOT_PATTERN = /\/web\/\d{8,14}(?:[a-z_]{2,3})?\//;
const DATED_SLUG_PATTERN = /\b(?:19|20)\d{2}\b|\b\d{1,2}[-/]\d{1,2}\b/;

// Syndication plumbing segments. `/feed/atom/` is still the site feed, so
// these never make a feed look scoped to one entry.
const FEED_SEGMENT_PATTERN = /^(?:feed|feeds|atom|rss|rss2|rdf)$/i;

const MAX_REASONS = 8;

/**
 * Page-level event context, computed once per inspected page and shared by
 * every feed link on it. `signatures` carries the event-surface verdicts the
 * scout already computes with its existing helpers, so this module never
 * re-implements CMS or listing detection.
 */
function buildRssPageEventContext({
  pageUrl = "",
  seed = {},
  html = "",
  eventTerms = [],
  signatures = {},
} = {}) {
  const terms = normalizeEventTerms(eventTerms);
  const reasons = [];

  // The scout only follows a same-origin link when the link's label, title or
  // path already matched calendar vocabulary. Arriving that way is attested
  // evidence that this page is a calendar surface.
  if (normalizeText(seed.discovery_method) === "same_origin_calendar_link") {
    reasons.push("event_page_calendar_link_origin");
  }
  if (toCount(signatures.schemaEventCount) > 0) {
    reasons.push("event_page_schema_event_rows");
  }
  if (signatures.eventListingSignature === true) {
    reasons.push("event_page_listing_signature");
  }

  // Path and heading vocabulary describe the page itself. They are only
  // accepted from a listing-shaped URL: a dated or entry-shaped article about
  // events is not an event listing surface.
  const parsed = safeUrl(pageUrl);
  const segments = parsed ? pathSegments(parsed) : [];
  if (!looksLikeEntryPath(segments, terms)) {
    if (matchesEventTerms(pathText(segments), terms)) {
      reasons.push("event_page_path_terms");
    }
    if (matchesEventTerms(pageHeadingText(html), terms)) {
      reasons.push("event_page_title_terms");
    }
  }

  return {
    event_surface: reasons.length > 0,
    reasons: bounded(reasons),
    terms,
  };
}

/**
 * Classify one discovered link as an event interface, or explain why not.
 *
 * Returns `{ transport, decision, reasons }` where decision is one of:
 *   "eligible"                   - feed transport with positive event context
 *   "insufficient_event_context" - feed transport, no event context found
 *   "ineligible"                 - not feed transport, or recognized non-event
 */
function classifyRssEventInterface({ link = {}, page = null } = {}) {
  const url = safeUrl(link.url);
  const type = normalizeText(link.type);
  const rels = normalizeText(link.rel).split(/\s+/).filter(Boolean);

  const context = page && typeof page === "object" ? page : { reasons: [], terms: [] };
  const terms = normalizeEventTerms(context.terms);

  const transport = detectFeedTransport({ url, type });
  if (!transport) {
    return decision("ineligible", ["transport_not_feed_shaped"], null);
  }
  if (!url) {
    // A feed MIME with no usable http(s) locator cannot be probed. Page
    // context must never promote an interface we cannot even address.
    return decision("ineligible", ["transport_locator_unusable"], null);
  }

  const negatives = detectNonEventEvidence({ url, type, rels, terms });
  if (negatives.length > 0) {
    return decision("ineligible", [transport.token, ...negatives], transport.kind);
  }

  const positives = [];

  // Link-owned semantics: what this site says this feed is.
  if (matchesEventTerms(linkText(link), terms)) {
    positives.push("event_link_label_terms");
  }
  if (matchesEventTerms(feedLocatorText(url), terms)) {
    positives.push("event_feed_path_terms");
  }
  // Page-owned semantics: what this feed is published alongside.
  positives.push(...(Array.isArray(context.reasons) ? context.reasons : []));

  if (positives.length === 0) {
    return decision(
      "insufficient_event_context",
      [transport.token, "no_event_context_evidence"],
      transport.kind,
    );
  }
  return decision("eligible", [transport.token, ...positives], transport.kind);
}

function detectFeedTransport({ url, type }) {
  if (FEED_MIME_PATTERN.test(type)) {
    return { token: "transport_feed_mime", kind: "feed" };
  }
  if (!url) return null;

  const segments = pathSegments(url);
  const filename = segments.length ? segments[segments.length - 1].toLowerCase() : "";
  const path = url.pathname.toLowerCase();

  if (
    segments.some((segment) => /^feed$/i.test(segment)) ||
    /\.(?:rss|atom|rdf)$/.test(path) ||
    FEED_FILENAME_PATTERN.test(filename) ||
    url.searchParams.has("feed")
  ) {
    return { token: "transport_feed_path", kind: "feed" };
  }
  if (/\.xml$/.test(path)) {
    return { token: "transport_generic_xml", kind: "xml" };
  }
  if (GENERIC_XML_MIME_PATTERN.test(type)) {
    return { token: "transport_xml_mime", kind: "xml" };
  }
  return null;
}

function detectNonEventEvidence({ url, type, rels, terms = [] }) {
  const reasons = [];
  if (OPENSEARCH_MIME_PATTERN.test(type)) {
    reasons.push("non_event_opensearch_descriptor");
  }
  for (const rel of rels) {
    if (NON_FEED_LINK_RELS.has(rel)) {
      reasons.push("non_event_link_rel");
      break;
    }
  }
  if (!url) return uniqueTokens(reasons);

  const path = url.pathname.toLowerCase();
  const segments = pathSegments(url);
  const filename = segments.length ? segments[segments.length - 1].toLowerCase() : "";

  if (OPENSEARCH_FILENAME_PATTERN.test(filename)) {
    reasons.push("non_event_opensearch_descriptor");
  }
  if (SITEMAP_FILENAME_PATTERN.test(filename) || segments.some((s) => s.toLowerCase() === "sitemap")) {
    reasons.push("non_event_sitemap");
  }
  if (SITE_METADATA_FILENAME_PATTERN.test(filename)) {
    reasons.push("non_event_site_metadata");
  }
  if (ARCHIVE_SNAPSHOT_PATTERN.test(path) || url.hostname.toLowerCase() === "web.archive.org") {
    reasons.push("non_event_archive_snapshot");
  }
  if (isCommentFeed(url, segments)) {
    reasons.push("non_event_comment_feed");
  }
  if (isSearchFeed(url, segments)) {
    reasons.push("non_event_search_feed");
  }
  if (isEntryScopedFeed(segments, terms)) {
    reasons.push("non_event_entry_scoped_feed");
  }
  return uniqueTokens(reasons);
}

// A comments feed indexes discussion, never a programme. Both the path form
// (`/comments/feed`) and the query form (`?feed=comments-rss2`) are generic
// across publishing platforms.
function isCommentFeed(url, segments) {
  if (segments.some((segment) => /^comments?$/i.test(segment))) return true;
  const feedParam = normalizeText(url.searchParams.get("feed"));
  return feedParam.includes("comment");
}

function isSearchFeed(url, segments) {
  if (segments.some((segment) => /^search$/i.test(segment))) return true;
  for (const key of ["s", "q", "search"]) {
    if (url.searchParams.get(key)) return true;
  }
  return false;
}

/**
 * `/{entry-slug}/feed` is the feed *of one entry*, which on common publishing
 * platforms is that entry's comment feed. It indexes one article, not a
 * programme. A feed scoped to an event-shaped section (`/events/feed`,
 * `/kalender/feed`) is not entry scoped and stays available to the positive
 * path.
 */
function isEntryScopedFeed(segments, terms) {
  const scope = segments.filter((segment) => !FEED_SEGMENT_PATTERN.test(segment));
  if (scope.length === 0 || scope.length === segments.length) return false;
  const last = scope[scope.length - 1];
  if (DATED_SLUG_PATTERN.test(last)) return true;
  return !matchesEventTerms(slugText(last), terms);
}

// A page whose own URL is a dated or nested entry slug is an article, not a
// listing surface. Its heading vocabulary must not qualify a site-wide feed.
function looksLikeEntryPath(segments, terms) {
  if (segments.length === 0) return false;
  const last = segments[segments.length - 1];
  if (DATED_SLUG_PATTERN.test(last)) return true;
  if (segments.length < 2) return false;
  const parent = segments[segments.length - 2];
  return (
    matchesEventTerms(slugText(parent), terms) &&
    !matchesEventTerms(slugText(last), terms)
  );
}

function decision(value, reasons, transportKind) {
  return {
    transport: transportKind,
    decision: value,
    reasons: bounded(uniqueTokens(reasons)),
  };
}

function normalizeEventTerms(extra) {
  return uniqueTokens(
    [...CALENDAR_LINK_TERMS, ...(Array.isArray(extra) ? extra : [])]
      .map(normalizeText)
      .filter((term) => term.length >= 3),
  );
}

function matchesEventTerms(value, terms) {
  const text = normalizeText(value);
  if (!text) return false;
  return terms.some((term) => text.includes(term));
}

function linkText(link) {
  return [link?.label, link?.title, link?.aria_label].filter(Boolean).join(" ");
}

function feedLocatorText(url) {
  if (!url) return "";
  return slugText(safeDecode(url.pathname) + " " + safeDecode(url.search));
}

function pageHeadingText(html) {
  const source = String(html || "");
  return [
    firstMatch(source, /<title\b[^>]*>([\s\S]*?)<\/title>/i),
    firstMatch(
      source,
      /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
    ),
    firstMatch(source, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i),
  ]
    .filter(Boolean)
    .map((value) => value.replace(/<[^>]*>/g, " "))
    .join(" ");
}

function pathText(segments) {
  return slugText(segments.map(safeDecode).join(" "));
}

function slugText(value) {
  return normalizeText(String(value || "").replace(/[\/_+-]+/g, " "));
}

function pathSegments(url) {
  return url.pathname.split("/").filter(Boolean);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch (_error) {
    return null;
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (_error) {
    return String(value || "");
  }
}

function firstMatch(value, pattern) {
  const match = String(value || "").match(pattern);
  return match ? match[1] : null;
}

function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function uniqueTokens(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const token = typeof value === "string" ? value.trim() : "";
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function bounded(values) {
  return values.slice(0, MAX_REASONS);
}

module.exports = {
  buildRssPageEventContext,
  classifyRssEventInterface,
};
