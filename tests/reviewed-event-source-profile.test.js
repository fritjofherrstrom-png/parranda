"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  eventFeedsFromReviewedSourceProfiles,
  resolveReviewedEventSourceProfileFeeds,
} = require("../server/place-candidates/reviewed-event-source-profile");
const {
  collectAnchorEvents,
  resolveEventFeedRegistry,
  resolveEventFeedsForAnchor,
} = require("../server/place-candidates/agnostic-event-supply");

const STOCKHOLM = { lat: 59.3293, lng: 18.0686 };
const NOW = "2026-07-20T12:00:00.000Z";

function profile(overrides = {}) {
  const candidate = {
    id: "stockholm-open-events",
    source_label: "Stockholm Open Events",
    url: "https://events.example/v1/event/",
    status: "viable_provider_probe",
    adapter: "linked_events",
    maps_to_existing_provider: true,
    trust_tier: "official",
    source_health: "healthy",
    runtime_policy: "bounded_refresh",
    terms_status: "open_license",
    source_identity: "events.example",
    source_language: "sv",
  };
  const feed = {
    candidate_id: candidate.id,
    id: "profile-stockholm-open-events",
    label: "Stockholm Open Events",
    endpoint: candidate.url,
    adapter: "linked_events",
    license: "CC-BY 4.0",
    source_tier: "official",
    confidence: "medium",
    source_family: "official_municipal_calendar",
    source_identity: candidate.source_identity,
    source_language: "sv",
    terms_status: "open_license",
    source_health: "healthy",
    runtime_policy: "bounded_refresh",
    priority: 20,
  };
  const base = {
    profile_key: "place-source-profile-v1:stockholm",
    runtime_review: {
      status: "approved",
      reviewed_at: "2026-07-01T00:00:00.000Z",
      expires_at: "2026-08-31T00:00:00.000Z",
      feeds: [feed],
    },
    place_context: {
      label: "Stockholm, Sverige",
      bounds: { west: 17.8, south: 59.1, east: 18.3, north: 59.5 },
    },
    source_families: [
      {
        family: "official_municipal_calendar",
        status: "covered",
        candidates: [candidate],
      },
    ],
  };
  return deepMerge(base, overrides);
}

test("an approved fresh review binds discovered evidence to one runtime feed", () => {
  const feeds = eventFeedsFromReviewedSourceProfiles([profile()], { now: NOW });

  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].adapter, "linked_events");
  assert.deepEqual(feeds[0].bbox, [17.8, 59.1, 18.3, 59.5]);
  assert.equal(feeds[0].confidence, "medium");
  assert.equal(feeds[0].profile_key, "place-source-profile-v1:stockholm");
  assert.equal(feeds[0].runtime_policy, "bounded_refresh");
});

test("discovery alone never activates an unreviewed source profile", () => {
  const unreviewed = profile({
    runtime_review: {
      status: "unreviewed",
      reviewed_at: null,
      expires_at: null,
      feeds: [],
    },
  });
  assert.deepEqual(eventFeedsFromReviewedSourceProfiles([unreviewed], { now: NOW }), []);
});

test("expired, stale-review, endpoint-swapped, adapter-swapped and unhealthy rows fail closed", () => {
  const cases = [
    profile({ runtime_review: { expires_at: "2026-07-19T00:00:00.000Z" } }),
    profile({ runtime_review: { reviewed_at: "2026-01-01T00:00:00.000Z" } }),
    profile({ runtime_review: { feeds: [{ endpoint: "https://evil.example/events" }] } }),
    profile({ runtime_review: { feeds: [{ adapter: "ical" }] } }),
    profile({ runtime_review: { feeds: [{ source_health: "fragile" }] } }),
    profile({ runtime_review: { feeds: [{ terms_status: "unknown" }] } }),
    profile({ source_families: [{ candidates: [{ status: "rejected" }] }] }),
  ];

  for (const row of cases) {
    assert.deepEqual(eventFeedsFromReviewedSourceProfiles([row], { now: NOW }), []);
  }
});

test("a reviewed source is rechecked at source-plan time in a long-running process", () => {
  const feed = eventFeedsFromReviewedSourceProfiles([profile()], { now: NOW })[0];
  feed.profile_expires_at = new Date(Date.now() - 1_000).toISOString();

  assert.deepEqual(resolveEventFeedsForAnchor(STOCKHOLM, [feed]), []);
});

test("review can only cap trust and missing confidence stays low", () => {
  const missing = profile();
  const high = profile();
  delete missing.runtime_review.feeds[0].confidence;
  high.runtime_review.feeds[0].confidence = "high";

  assert.equal(eventFeedsFromReviewedSourceProfiles([missing], { now: NOW })[0].confidence, "low");
  assert.equal(eventFeedsFromReviewedSourceProfiles([high], { now: NOW })[0].confidence, "medium");
});

test("social/corroboration-only candidates cannot become standalone runtime sources", () => {
  const social = profile({
    source_families: [
      {
        family: "community_social_listing",
        candidates: [
          {
            id: "stockholm-open-events",
            source_label: "Community events",
            url: "https://events.example/v1/event/",
            adapter: "linked_events",
            maps_to_existing_provider: true,
            corroboration_required: true,
            source_identity: "events.example",
          },
        ],
      },
    ],
  });

  assert.deepEqual(eventFeedsFromReviewedSourceProfiles([social], { now: NOW }), []);
});

test("floating-time adapters require a reviewed valid timezone", () => {
  const ical = profile();
  const candidate = ical.source_families[0].candidates[0];
  const feed = ical.runtime_review.feeds[0];
  candidate.source_label = "Stockholm iCal";
  candidate.url = "https://events.example/calendar.ics";
  candidate.adapter = "ical";
  feed.endpoint = candidate.url;
  feed.adapter = "ical";
  delete feed.timezone;
  assert.deepEqual(eventFeedsFromReviewedSourceProfiles([ical], { now: NOW }), []);

  feed.timezone = "Europe/Stockholm";
  assert.equal(eventFeedsFromReviewedSourceProfiles([ical], { now: NOW }).length, 1);

  feed.timezone = "Europe/NotAPlace";
  assert.deepEqual(eventFeedsFromReviewedSourceProfiles([ical], { now: NOW }), []);
});

test("reviewed RSS/Atom detail feeds activate without trusting feed publication dates", () => {
  const rss = profile();
  const candidate = rss.source_families[0].candidates[0];
  const feed = rss.runtime_review.feeds[0];
  candidate.source_label = "Stockholm culture feed";
  candidate.url = "https://events.example/calendar/feed.xml";
  candidate.adapter = "rss_atom_event_detail";
  candidate.status = "needs_adapter_or_permission";
  candidate.maps_to_existing_provider = true;
  feed.endpoint = candidate.url;
  feed.adapter = "rss_atom_event_detail";
  feed.detail_limit = 8;
  feed.detail_budget = 12;

  const [resolved] = eventFeedsFromReviewedSourceProfiles([rss], { now: NOW });
  assert.equal(resolved.adapter, "rss_atom_event_detail");
  assert.equal(resolved.detail_limit, 8);
  assert.equal(resolved.detail_budget, 12);
  assert.equal(resolved.confidence, "medium");
});

test("a reviewed official program article requires a timezone and reuses the generic runtime adapter", () => {
  const article = profile();
  const candidate = article.source_families[0].candidates[0];
  const feed = article.runtime_review.feeds[0];
  candidate.source_label = "Reviewed civic programme";
  candidate.url = "https://city.example/news/summer-program";
  candidate.adapter = "official_program_article";
  candidate.status = "needs_adapter_or_permission";
  candidate.maps_to_existing_provider = true;
  feed.endpoint = candidate.url;
  feed.adapter = "official_program_article";
  feed.source_language = "en";
  delete feed.timezone;

  assert.deepEqual(eventFeedsFromReviewedSourceProfiles([article], { now: NOW }), []);

  feed.timezone = "Europe/Stockholm";
  const [resolved] = eventFeedsFromReviewedSourceProfiles([article], { now: NOW });
  assert.equal(resolved.adapter, "official_program_article");
  assert.equal(resolved.timezone, "Europe/Stockholm");
  assert.equal(resolved.source_language, "en");
  assert.equal(resolved.source_scoped_pulse, true);
});

test("trusted profile env is fail-closed and direct reviewed feed rows keep precedence", () => {
  assert.deepEqual(resolveReviewedEventSourceProfileFeeds({
    PARRANDA_REVIEWED_EVENT_SOURCE_PROFILES: "{bad json",
  }), []);

  const fresh = profile({
    runtime_review: {
      reviewed_at: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  const profiledRegistry = resolveEventFeedRegistry({
    PARRANDA_REVIEWED_EVENT_SOURCE_PROFILES: JSON.stringify([fresh]),
  });
  assert.equal(profiledRegistry.length, 1);
  assert.equal(profiledRegistry[0].profile_key, "place-source-profile-v1:stockholm");

  const direct = {
    id: "profile-stockholm-open-events",
    label: "Direct operator override",
    endpoint: "https://override.example/events",
    adapter: "linked_events",
    bbox: [17.8, 59.1, 18.3, 59.5],
    status: "active",
  };
  const registry = resolveEventFeedRegistry({
    PARRANDA_EVENT_FEEDS: JSON.stringify([direct]),
    PARRANDA_REVIEWED_EVENT_SOURCE_PROFILES: JSON.stringify([fresh]),
  });

  assert.equal(registry.length, 1);
  assert.equal(registry[0].label, "Direct operator override");
  assert.equal(registry[0].endpoint, "https://override.example/events");
});

test("a reviewed profile feeds the existing normalized acquisition and source-health path", async () => {
  const registry = eventFeedsFromReviewedSourceProfiles([profile()], { now: NOW });
  const result = await collectAnchorEvents({
    anchor: STOCKHOLM,
    now: NOW,
    registry,
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        meta: { count: 1 },
        data: [
          {
            id: "local-market",
            name: { sv: "Kvallsmarknad" },
            start_time: "2026-07-20T17:00:00.000Z",
            end_time: "2026-07-20T20:00:00.000Z",
            location: {
              name: { sv: "Kajen" },
              position: { coordinates: [18.069, 59.33] },
            },
            info_url: { sv: "https://events.example/local-market" },
            data_source: "stockholm",
            publisher: "Stockholm Open Events",
            keywords: [{ name: { sv: "marknad" } }],
          },
        ],
      }),
    }),
  });

  assert.equal(result.coverage, "covered");
  assert.equal(result.tonight.length, 1);
  assert.equal(result.tonight[0].source_url, "https://events.example/local-market");
  assert.equal(result.feeds[0].source_profile.profile_key, "place-source-profile-v1:stockholm");
  assert.equal(result.feeds[0].terms_status, "open_license");
  assert.equal(result.feeds[0].reviewed_source_health, "healthy");
  assert.equal(result.acquisition.source_health.status, "healthy");
  assert.equal(result.acquisition.source_health.accepted_event_count, 1);
});

function deepMerge(base, overrides) {
  if (Array.isArray(overrides)) {
    return overrides.map((value, index) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? deepMerge(Array.isArray(base) ? base[index] || {} : {}, value)
        : value,
    );
  }
  if (!overrides || typeof overrides !== "object") return overrides;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = deepMerge(base?.[key] || {}, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
