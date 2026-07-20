"use strict";

/**
 * Pure same-origin calendar-page locator.
 *
 * This ranks likely listing pages from one already trusted public website.
 * It performs no network access and does not classify or activate providers.
 */

const CALENDAR_LINK_TERMS = [
  "agenda",
  "calendar",
  "calendario eventi",
  "calendrier",
  "evenemang",
  "evenemangskalender",
  "evenementen",
  "events",
  "eventi",
  "eventos",
  "kalender",
  "kalendarium",
  "kalendář akcí",
  "programme",
  "program",
  "tapahtumat",
  "veranstaltungen",
  "veranstaltungskalender",
  "what's on",
  "wydarzenia",
  "εκδηλώσεις",
];

function extractCalendarPageLinks({
  html = "",
  pageUrl,
  calendarLinkTerms = [],
} = {}) {
  const normalizedPageUrl = normalizeHttpUrl(pageUrl);
  if (!normalizedPageUrl) return [];
  const page = new URL(normalizedPageUrl);
  const terms = uniqueStrings([
    ...CALENDAR_LINK_TERMS,
    ...(Array.isArray(calendarLinkTerms) ? calendarLinkTerms : []),
  ])
    .map(normalizeSearchText)
    .filter((term) => term.length >= 3)
    .slice(0, CALENDAR_LINK_TERMS.length + 12);
  const candidates = [];
  const seen = new Set();
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = pattern.exec(String(html || ""))) !== null) {
    const attrs = match[1] || "";
    const href = decodeHtmlText(attributeValue(attrs, "href"));
    const url = normalizeHttpUrl(absolutizeUrl(href, normalizedPageUrl));
    if (!url || seen.has(url) || url === normalizedPageUrl) continue;
    if (new URL(url).origin !== page.origin) continue;
    if (isSocialEventUrl(url) || isNonHtmlDiscoveryTarget(url)) continue;

    const label = decodeHtmlText(stripHtml(match[2]));
    const title = decodeHtmlText(attributeValue(attrs, "title"));
    const scored = scoreCalendarPageLink({ url, label, title, terms });
    if (!scored) continue;
    seen.add(url);
    candidates.push(scored);
  }

  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.url.length - right.url.length ||
      left.url.localeCompare(right.url),
  );
}

function scoreCalendarPageLink({ url, label, title, terms }) {
  const parsed = new URL(url);
  const normalizedLabel = normalizeSearchText(label);
  const normalizedTitle = normalizeSearchText(title);
  const normalizedPath = normalizeSearchText(
    safeDecodeUriComponent(parsed.pathname).replace(/[\/_-]+/g, " "),
  );
  const matchedTerms = mostSpecificTerms(terms.filter((term) =>
    normalizedLabel.includes(term) ||
    normalizedTitle.includes(term) ||
    normalizedPath.includes(term),
  ));
  if (!matchedTerms.length) return null;

  let score = 0;
  for (const term of matchedTerms) {
    if (normalizedLabel.includes(term)) score += 7;
    if (normalizedTitle.includes(term)) score += 4;
    if (normalizedPath.includes(term)) score += 6;
    if (normalizedLabel === term) score += 4;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length <= 2) score += 2;
  if (looksLikeEventDetailPath(segments, terms)) return null;
  if (score < 6) return null;

  return {
    url,
    score,
    reasons: uniqueStrings([
      matchedTerms.some((term) => normalizedLabel.includes(term))
        ? "calendar_link_label_match"
        : null,
      matchedTerms.some((term) => normalizedTitle.includes(term))
        ? "calendar_link_title_match"
        : null,
      matchedTerms.some((term) => normalizedPath.includes(term))
        ? "calendar_link_path_match"
        : null,
    ]),
  };
}

function mostSpecificTerms(terms) {
  return terms.filter((term) =>
    !terms.some(
      (other) => other !== term && other.length > term.length && other.includes(term),
    ),
  );
}

function looksLikeEventDetailPath(segments, terms) {
  if (segments.length < 2) return false;
  const last = normalizeSearchText(segments.at(-1));
  const parent = normalizeSearchText(segments.at(-2));
  const parentIsCalendar = terms.some((term) => parent.includes(term));
  const lastIsCalendar = terms.some((term) => last.includes(term));
  const datedSlug = /\b(?:20\d{2}|\d{1,2}[-/]\d{1,2})\b/.test(last);
  return datedSlug || (parentIsCalendar && !lastIsCalendar && last.length > 3);
}

function isNonHtmlDiscoveryTarget(value) {
  try {
    return /\.(?:ics|rss|xml|json|pdf|jpe?g|png|gif|webp|svg|zip)$/i.test(
      new URL(value).pathname,
    );
  } catch (_error) {
    return true;
  }
}

function isSocialEventUrl(value) {
  const url = String(value || "").toLowerCase();
  return /facebook\.com\/(?:events|groups)|instagram\.com|tiktok\.com/.test(url);
}

function normalizeHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function safeDecodeUriComponent(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (_error) {
    return String(value || "");
  }
}

function attributeValue(attributes, name) {
  const pattern =
    /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/g;
  let match;
  while ((match = pattern.exec(String(attributes || ""))) !== null) {
    if (match[1].toLowerCase() !== String(name).toLowerCase()) continue;
    return match[2] ?? match[3] ?? match[4] ?? "";
  }
  return "";
}

function absolutizeUrl(value, baseUrl) {
  try {
    return new URL(String(value || "").trim(), baseUrl).toString();
  } catch (_error) {
    return null;
  }
}

function uniqueStrings(values) {
  const output = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) continue;
    const key = text.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

module.exports = {
  extractCalendarPageLinks,
};
