"use strict";

/**
 * Where a Live event's source link actually leads — derived from the
 * source-owned URL alone. Nothing is fetched, rewritten or invented.
 *
 * A reviewed feed's label ("Visit Stockholm") is attribution: who LISTED the
 * event. The row's `source_url` may point somewhere else entirely (an
 * organizer's own website), and may be only that site's start page. This
 * classification lets the UI say where the link goes instead of letting the
 * feed label stand in for the destination:
 *
 *   site_home  a site root: an empty path or `/`, or one bare locale segment
 *              (`/sv`, `/en/`, `/en-GB`), with no fragment and no query other
 *              than utm_* campaign tags. A start page, not a page for the event.
 *   page       any other absolute http(s) URL. This only means "not a site
 *              root" — never a claim that it is the event's own detail page.
 *   null       no describable link: missing, relative, unparsable, non-http(s)
 *              or carrying credentials. The UI renders no link for it.
 *
 * Conservative by construction: anything that could address specific content
 * (a query such as `/?p=123`, a fragment route, a second path segment) stays
 * `page`, so an event page is never labelled a homepage. The host is the
 * WHATWG-parsed hostname (IDN stays in its ASCII form, so a look-alike domain
 * cannot render as the real one) without port or a leading `www.`.
 */

const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2})?$/i;
// The same campaign-tag family event fusion ignores when comparing URLs: it
// never selects content, so it cannot turn a site root into a specific page.
const CAMPAIGN_PARAMETER = /^utm_[a-z0-9_]+$/i;

function noLink() {
  return { source_link_kind: null, source_link_host: null };
}

function classifyEventSourceLink(value) {
  if (typeof value !== "string" || !value.trim()) return noLink();
  let url;
  try {
    url = new URL(value.trim());
  } catch (_error) {
    return noLink();
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    return noLink();
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const rootPath = segments.length === 0 || (segments.length === 1 && LOCALE_SEGMENT.test(segments[0]));
  const contentQuery = [...url.searchParams.keys()].some((key) => !CAMPAIGN_PARAMETER.test(key));
  return {
    source_link_kind: rootPath && !contentQuery && !url.hash ? "site_home" : "page",
    source_link_host: url.hostname.replace(/^www\.(?=.)/, ""),
  };
}

// Recomputed rather than trusted when present: the answer is a pure function of
// the row's own source_url, so a view cached before this field existed and a
// fresh view always agree.
function withEventSourceLink(view) {
  if (!view || typeof view !== "object") return view;
  return { ...view, ...classifyEventSourceLink(view.source_url) };
}

module.exports = {
  classifyEventSourceLink,
  withEventSourceLink,
};
