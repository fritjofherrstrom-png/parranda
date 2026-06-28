"use strict";

/**
 * Agnostic live-event supply — "what's alive near here, right now".
 *
 * Stable places (OSM / Wikidata / curated) say WHAT a place is. This says what is
 * HAPPENING there — tonight and this week — for an arbitrary anchor, with no
 * citypack. It resolves the anchor to an open, key-free municipal events feed that
 * geographically covers it (the geo-keyed registry below — Linked Events
 * instances; adding a city is DATA, not a per-city code hack), fetches events
 * NEAR the anchor (geo-filtered + soonest-first), normalizes them through the
 * generic #279 time-sensitive contract, and ranks them with the existing salience
 * scorer. It is pure orchestration over pieces that are already live-validated.
 *
 * HONEST BY CONSTRUCTION: where no open feed covers the anchor it returns
 * `coverage:"uncovered"` with no events — it never invents a happening. Events are
 * bucketed into `tonight` (now/today/tonight) and `this_week` (the next 7 days),
 * each ranked and capped. Output is DATA (ids, times, coords, source, trust),
 * never prose — the UI/i18n layer renders labels.
 */

const { createLinkedEventsProvider } = require("../pulse-sources/linked-events-source-provider");
const { normalizeTimeSensitiveSourceEvent } = require("../pulse-sources/time-sensitive-event");
const { scoreTimeSensitiveEventSalience } = require("../pulse-engine/time-sensitive-events");

const DEFAULT_RADIUS_M = 3000;
const MAX_PER_BUCKET = 6;
const FETCH_LIMIT = 60;
const THIS_WEEK_HORIZON_DAYS = 7;
const TONIGHT_TIMING = new Set(["now", "today", "tonight"]);
// A "happening" is time-bounded (a gig, tour, market, festival) — not permanent
// infrastructure (a museum open since 2001). Events longer than this are
// always-open, not something that is "on tonight", and are excluded. Mirrors the
// feed-level `max_duration` query param, but feed-agnostic so it protects ANY
// provider and the deterministic tests (which inject payloads, not query params).
const MAX_HAPPENING_DAYS = 14;
// Feed-level cap (seconds) for the Linked Events query — same intent.
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;

// Geo-keyed registry of OPEN, key-free municipal event feeds running the Linked
// Events platform (api.hel.fi and the many Nordic cities on the same open-source
// API; CC-BY 4.0). Built-in entries are ones validated reachable without a
// credential. The list is GENERIC and extensible: each entry is an honest
// coverage bbox [west, south, east, north]; an anchor outside every bbox returns
// coverage:"uncovered". Adding Turku/Tampere/Oulu/etc. is one more data row.
const BUILTIN_EVENT_FEEDS = [
  {
    id: "linkedevents-helsinki",
    label: "Helsinki Linked Events",
    base: "https://api.hel.fi/linkedevents/v1/event/",
    bbox: [24.5, 60.0, 25.3, 60.45], // Greater Helsinki / capital region
    license: "CC-BY 4.0",
  },
];

/**
 * The registry is GENERIC and deploy-configurable: a city is a data row, never
 * code. `PARRANDA_EVENT_FEEDS` (a JSON array of {id,label,base,bbox,license})
 * lets any deployment add the open feed covering its region without touching the
 * engine — Helsinki is the built-in *fixture* that proves the path, not the
 * product scope. Malformed config is ignored (keep the built-in), never throws.
 */
function resolveEventFeedRegistry(env = process.env) {
  const feeds = [...BUILTIN_EVENT_FEEDS];
  const extra = String((env && env.PARRANDA_EVENT_FEEDS) || "").trim();
  if (!extra) return feeds;
  try {
    const parsed = JSON.parse(extra);
    if (Array.isArray(parsed)) {
      for (const f of parsed) {
        if (f && typeof f.base === "string" && Array.isArray(f.bbox) && f.bbox.length >= 4) {
          feeds.push({
            id: String(f.id || `feed-${feeds.length}`),
            label: String(f.label || f.id || "Events"),
            base: f.base,
            bbox: f.bbox.map(Number),
            license: f.license != null ? String(f.license) : null,
          });
        }
      }
    }
  } catch (_e) {
    // malformed PARRANDA_EVENT_FEEDS → keep the built-in registry, never throw
  }
  return feeds;
}

function hasAnchor(anchor) {
  return anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng);
}

// First feed whose coverage bbox contains the anchor (deterministic by list
// order). No match → null (honest "no feed reaches here").
function resolveEventFeedForAnchor(anchor, registry = BUILTIN_EVENT_FEEDS) {
  if (!hasAnchor(anchor)) return null;
  for (const feed of Array.isArray(registry) ? registry : []) {
    const b = feed && feed.bbox;
    if (!Array.isArray(b) || b.length < 4) continue;
    const [w, s, e, n] = b;
    if (anchor.lng >= w && anchor.lng <= e && anchor.lat >= s && anchor.lat <= n) return feed;
  }
  return null;
}

// Geo-filter the feed to the anchor + return genuine upcoming happenings.
// `sort=start_time` is a trap: it surfaces recurring-series ORIGIN dates (years
// in the past), starving real upcoming events out of the page. `max_duration`
// excludes permanent infrastructure (always-open museums) and `sort=end_time`
// surfaces what is ending/relevant soonest. The provider's own buildEventsUrl
// adds include/page_size/start/format WITHOUT clobbering these.
function buildAnchorEventEndpoint(base, anchor, { radiusM = DEFAULT_RADIUS_M } = {}) {
  let url;
  try {
    url = new URL(base);
  } catch (_e) {
    return base;
  }
  url.searchParams.set("dwithin_origin", `${anchor.lng},${anchor.lat}`);
  url.searchParams.set("dwithin_metres", String(Math.max(100, Math.round(radiusM))));
  url.searchParams.set("sort", "end_time");
  url.searchParams.set("max_duration", String(MAX_DURATION_SECONDS));
  return url.toString();
}

function withinHorizonDays(startsAtIso, now, days) {
  if (!now) return true; // no clock → cannot exclude; keep (honest, undated)
  const starts = new Date(startsAtIso);
  if (!Number.isFinite(starts.getTime())) return false;
  const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return starts >= now && starts <= horizon;
}

// A genuine happening is time-bounded — not permanent infrastructure. Excludes
// always-open exhibitions (a 2001→2030 "event" the #279 normalizer rates `now`),
// malformed ancient dates (the feed's occasional year-0026 row), and undated
// rows that already started long ago. Feed-agnostic: it is the safety net behind
// the feed-level max_duration query, and it is what the deterministic tests
// exercise (they inject payloads, not query params).
function isEphemeralHappening(event, now) {
  const start = event.starts_at ? new Date(event.starts_at) : null;
  if (!start || !Number.isFinite(start.getTime())) return false;
  if (start.getUTCFullYear() < 2000) return false; // malformed origin date
  const end = event.ends_at ? new Date(event.ends_at) : null;
  if (end && Number.isFinite(end.getTime())) {
    const durationDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    if (durationDays > MAX_HAPPENING_DAYS) return false; // permanent / always-open
  } else if (now && start.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    return false; // undated and already started long ago → not a live happening
  }
  return true;
}

// Collapse duplicate occurrences (recurring series surface the same title/venue
// repeatedly) — keep the first (already salience-ranked) per id, then per
// title+venue.
function dedupeViews(views) {
  const seen = new Set();
  const out = [];
  for (const v of views) {
    const key = v.id || `${(v.title || "").toLowerCase()}|${v.place || ""}`;
    const titleKey = `${(v.title || "").toLowerCase()}|${v.place || ""}`;
    if (seen.has(key) || seen.has(titleKey)) continue;
    seen.add(key);
    seen.add(titleKey);
    out.push(v);
  }
  return out;
}

// Honest, prose-free user view of one event. The UI/i18n layer renders the label;
// this stays data (ids, ISO times, coords, source, trust).
function toEventView(event, feed) {
  const title = String(event.title || event.name || "").trim();
  if (!title) return null;
  const salience = scoreTimeSensitiveEventSalience(event);
  return {
    id: event.id || null,
    title,
    starts_at: event.starts_at || null,
    ends_at: event.ends_at || null,
    timing_relevance: event.timing_relevance || null,
    place: event.place_context || event.area || null,
    lat: Number.isFinite(event.lat) ? event.lat : null,
    lng: Number.isFinite(event.lng) ? event.lng : null,
    source_label: event.source_label || event.provenance?.source_label || feed.label || null,
    source_url: event.source_url || event.provenance?.source_url || null,
    license: event.provenance?.license || feed.license || null,
    trust_level: event.confidence || null,
    salience_score: salience.score,
  };
}

function rankAndCap(views) {
  const sorted = views
    .filter(Boolean)
    .sort(
      (a, b) =>
        (b.salience_score || 0) - (a.salience_score || 0) ||
        String(a.starts_at || "").localeCompare(String(b.starts_at || "")) ||
        String(a.id || "").localeCompare(String(b.id || "")),
    );
  return dedupeViews(sorted).slice(0, MAX_PER_BUCKET);
}

/**
 * Collect ranked live events near an anchor, bucketed tonight / this_week.
 * @param {object} opts
 * @param {{lat:number,lng:number}} opts.anchor  trusted coordinate anchor
 * @param {string|Date|null} [opts.now]          trusted clock (tests inject)
 * @param {string|null} [opts.date]              feed window start (default today)
 * @param {object[]} [opts.registry]             feed registry (default built-in)
 * @param {Function} [opts.fetcher]              injected fetch (tests)
 * @returns {Promise<{coverage:"covered"|"uncovered", feed:object|null, tonight:object[], this_week:object[]}>}
 */
async function collectAnchorEvents({ anchor, now = null, date = null, registry, fetcher, radiusM } = {}) {
  const feed = resolveEventFeedForAnchor(anchor, registry || resolveEventFeedRegistry());
  if (!feed) {
    return { coverage: "uncovered", feed: null, tonight: [], this_week: [] };
  }

  const endpoint = buildAnchorEventEndpoint(feed.base, anchor, { radiusM });
  const provider = createLinkedEventsProvider({
    endpoint,
    fetcher: fetcher || undefined,
    limit: FETCH_LIMIT,
    label: feed.label,
    license: feed.license,
  });

  let raw = [];
  try {
    const collected = await provider.create({ key: null }).collect({ date });
    raw = Array.isArray(collected && collected.time_sensitive_events) ? collected.time_sensitive_events : [];
  } catch (_e) {
    raw = [];
  }

  const nowDate = now ? new Date(now) : null;
  const tonight = [];
  const thisWeek = [];
  for (const rawEvent of raw) {
    // Linked Events is an official municipal feed: stamp its descriptor-level
    // trust so the #279 normalizer rates it honestly (medium / official) rather
    // than defaulting to needs_review. Real source backing already present.
    const enriched = { source_tier: "official", confidence: "medium", ...rawEvent };
    const normalized = normalizeTimeSensitiveSourceEvent(enriched, nowDate ? { now: nowDate } : {});
    if (!normalized) continue;
    if (!isEphemeralHappening(normalized, nowDate)) continue; // drop permanent/malformed (both buckets)
    const view = toEventView(normalized, feed);
    if (!view) continue;
    if (TONIGHT_TIMING.has(normalized.timing_relevance)) {
      tonight.push(view);
    } else if (
      normalized.timing_relevance === "future" &&
      withinHorizonDays(normalized.starts_at, nowDate, THIS_WEEK_HORIZON_DAYS)
    ) {
      thisWeek.push(view);
    }
  }

  return {
    coverage: "covered",
    feed: { id: feed.id, label: feed.label, license: feed.license },
    tonight: rankAndCap(tonight),
    this_week: rankAndCap(thisWeek),
  };
}

module.exports = {
  collectAnchorEvents,
  resolveEventFeedRegistry,
  resolveEventFeedForAnchor,
  buildAnchorEventEndpoint,
  BUILTIN_EVENT_FEEDS,
  DEFAULT_RADIUS_M,
};
