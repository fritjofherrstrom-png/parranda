# Live Event Source Discovery

Parranda Pulse/live should not depend on one hardcoded city feed. The live
engine needs a repeatable way to discover, evaluate, reject, and eventually
normalize multiple time-sensitive source families for any place.

This document defines the source-discovery method that feeds the existing
`time_sensitive_events` contract. It is not a citypack plan and it does not
make events into route stops. Source discovery is the acquisition layer; Pulse,
dayflow, and route composition remain downstream consumers with their own gates.

## Discovery Algorithm

Input can start from a place name, coordinates, or a resolved bounding box.

1. Resolve the place context.
   - If there is a place name, resolve city/country/bounds through the normal
     trusted resolver path.
   - If only coordinates are present, resolve an anchor/bounds when available,
     but do not claim a citypack exists.
   - Carry place label, country, coordinates, bounds, and language hints into
     discovery. Do not trust user-provided source URLs as providers.
2. Enumerate source families in priority order.
   - Official municipal calendar.
   - Official tourism/destination calendar.
   - Cultural institutions and major venues.
   - `schema.org/Event` JSON-LD on listing/detail pages.
   - Open-data event APIs.
   - Ticket/event APIs only when API and terms are compatible.
   - Stable HTML calendars when APIs/feeds are unavailable.
   - JS-rendered/browser extraction only as a reviewed last resort.
   - Existing provider families already in the repo, such as schema.org/Event
     and Linked Events, when they match the source shape.
3. Evaluate each candidate source.
   - Can title, start/end, venue/place, source URL, and recurrence be extracted?
   - Does the source provide venue coordinates, or is the venue geocodable?
   - Are source terms compatible with a provider probe, permission-required, or
     restricted?
   - Does the source map to an existing provider adapter, or does it need a new
     adapter?
4. Score and classify the source candidate.
   - `viable_provider_probe`: source is structured enough and terms look
     compatible enough for a provider probe.
   - `needs_adapter_or_permission`: useful source, but requires a new adapter or
     permission/legal review before runtime use.
   - `rejected`: missing core fields, restricted terms, or unsafe provenance.
5. Classify the extraction tier.
   - APIs/feeds and structured data are preferred.
   - HTML scraping is valid for factual event atoms when terms, robots,
     structure, caching, attribution, and source health are acceptable.
   - JS-rendered/browser scraping and weak social/manual listings are
     probe-only until explicitly reviewed.
6. Normalize provider output into `time_sensitive_events`.
   - Providers own raw facts.
   - Parranda owns normalization, timing relevance, confidence, display gates,
     salience, dedupe, and route/Pulse eligibility.

The repo harness for step 4 is `server/pulse-sources/source-discovery.js`.
It is pure, deterministic, and does not fetch the network. The repo also has a
source-coverage graph in `server/pulse-sources/local-live-source-graph.js`.
That graph turns evaluated candidates into:

- covered source families;
- needs-review / needs-corroboration families;
- missing family gaps;
- social/community coverage status;
- an acquisition plan for what source family to find next.

Local fixtures can be evaluated with:

```bash
node scripts/probe-live-event-sources.js source-candidates.json
```

The bounded website scout lives in
server/pulse-sources/local-event-source-scout.js. It closes the step before
candidate evaluation:

- OSM website / contact:website and Wikidata P856 atoms can become trusted
  website seeds without changing place confidence or route ranking;
- supplied local-language terms produce a bounded search-query plan for a
  trusted background search integration;
- one reviewed public page per seed is inspected for iCal, The Events Calendar,
  event-related REST/JSON endpoints exposed in page attributes,
  schema.org/Event JSON-LD, compatible venue HTML, RSS, and social discovery
  hints;
- private/loopback URLs, unsafe redirects, robots exclusions, oversized
  responses, timeouts, and source failures fail closed;
- successful robots and source-page responses use the existing source cache;
  `PARRANDA_CACHE_DIR` makes repeat operator runs persistent, while failures are
  not cached and may recover on the next bounded run;
- discovered machine-readable interfaces become review-needed manifest
  candidates only. They never become active runtime providers automatically;
- RSS and generic HTML calendars, including recognized Sitevision-style event
  listings, remain adapter-review work, while social links remain
  discovery/corroboration hints rather than event truth.

The operator harness is default-off. Without the live switch it emits only the
query/seed plan:

    node scripts/scout-local-event-sources.js scout-input.json

Explicit bounded probing of reviewed public seeds requires:

    node scripts/scout-local-event-sources.js scout-input.json --live

The live harness accepts the existing `PARRANDA_CACHE_DIR` and an optional
`PARRANDA_EVENT_SOURCE_SCOUT_CACHE_TTL_MS`. It remains an operator/background
job; no user request waits for this crawl.

After terms, ownership, timezone, geography, and parser output have been
reviewed, an operator may promote the proposed row into PARRANDA_EVENT_FEEDS.
User requests never perform this discovery crawl; they continue to consume only
approved, cache-backed sources through bounded acquisition.

## Source Family Priority

1. `official_municipal_calendar`
   - Highest priority for civic and local programming.
   - Often exposes structured APIs, iCal, RSS, or CMS event plugins.
   - Needs salience filtering because it may include council meetings or
     administrative notices that are not travel-relevant.
2. `official_tourism_calendar`
   - High editorial relevance for visitors.
   - Often terms-restricted. Treat as permission-required unless a public API or
     clear reuse terms exist.
3. `cultural_institution_calendar`
   - Major venues, museums, festivals, and cultural institutions.
   - Useful for evening/culture anchors, but terms and page structure vary.
4. `venue_owned_calendar`
   - Venue, farm shop, gallery, club, museum, or local organizer calendar.
   - Strong for small local happenings when the venue is authoritative.
5. `market_listing`
   - Markets, flea markets, seasonal producers, popups, and local fairs.
   - Important in regions where the best day is not a permanent POI.
6. `trusted_local_media`
   - Local magazines, editorial calendars, newsletters, and town guides.
   - Valuable for discovery and coverage, but runtime use depends on terms and
     stable extraction.
7. `community_social_listing`
   - Public community/social listings.
   - Discovery/corroboration source, not a strong standalone runtime source.
8. `schema_org_event`
   - Generic, low-friction adapter when valid JSON-LD exists.
   - Page ownership/terms still matter.
9. `open_data_event_api`
   - Strong when official and openly licensed.
   - Needs mapper and freshness handling.
10. `compatible_ticket_api`
   - Only when API terms allow usage and attribution. Ticket platforms are not
     assumed usable; classify them by terms and extraction tier.
11. `existing_provider_family`
   - Use repo providers such as schema.org/Event and Linked Events when the
     source shape already matches.
12. `unknown_source_family`
   - Low-priority bucket for sources that do not match a known family yet.
   - Unknown sources must not be upgraded into official/tourism families by
     default; they stay probe-only until classified.

## Local Live Source Graph

The source graph answers a different question than a provider adapter.

A provider asks:

```text
Can this one source produce normalized time_sensitive_events?
```

The source graph asks:

```text
For this place and time window, do we have enough independent source families
to believe we are seeing the local live picture?
```

The graph is intentionally conservative:

- official/tourism/cultural/venue/market sources can cover runtime families;
- social/community sources are captured so Parranda does not ignore them, but
  they remain `needs_corroboration` unless stronger source families support the
  same local event layer;
- missing families become acquisition-plan steps rather than silent absence;
- local-language terms and source language are preserved so discovery is not
  English-only; place resolvers and source probes inject local discovery terms
  rather than the graph guessing one region's vocabulary for every place;
- source health and runtime policy are real gates, not display-only metadata;
- coverage strength counts independent publisher identities, so one site cannot
  appear as several independent source families;
- source coverage means Parranda can collect/evaluate candidates. It never by
  itself claims an event is happening now or is suitable for a route;
- community/social source context is not event corroboration. Corroboration is
  deferred until normalized event atoms can be matched across sources;
- the graph does not fetch, scrape, promote Pulse cards, or create route stops.

For regions like Österlen or southern Skåne, the graph should reveal whether
Parranda has municipal/tourism coverage, venue calendars, market/loppis
coverage, trusted local media, and community/social hints. A route can then be
honest about whether it is based on broad live coverage or only on a narrow
slice of sources.

## Extraction Tiers

Scraping is not categorically forbidden. It is a valid source family when
official APIs or feeds are unavailable, but it must be constrained and scored
honestly. Parranda should extract factual event atoms, not republish editorial
content.

1. `official_api_open_data`
   - Official API or open-data feed.
   - Preferred runtime source when terms and source health are acceptable.
2. `ics_rss_feed`
   - ICS, RSS, calendar feed, or similar structured feed.
   - Good for title/start/end/source URL and recurrence.
3. `schema_org_json_ld`
   - `schema.org/Event` / JSON-LD structured data on listing or detail pages.
   - Uses existing provider family when the page exposes real Event objects.
4. `stable_html_calendar`
   - Stable HTML calendar/listing/detail scraping.
   - Runtime-eligible only when robots/terms/structure/source health are
     acceptable and extraction is limited to factual atoms.
5. `js_rendered_browser`
   - JS-rendered/browser extraction.
   - Last resort. Probe-only until reviewed because it is heavier, more brittle,
     and easier to abuse operationally.
6. `weak_social_manual`
   - Weak social/manual listings.
   - Discovery-only or needs-review. Useful as pointers, not authoritative
     runtime providers.

Allowed factual atoms:

- title;
- start/end;
- venue/address/geo;
- source URL;
- status;
- category;
- organizer.

Do not copy full editorial descriptions or images into Parranda content. Always
preserve `source_url` and attribution.

## Trust Scoring

Source trust is evaluated before Pulse salience:

- `official`: municipal, tourism board, open-data portal, public institution.
- `civic`: public/civic organization that is authoritative for the event.
- `institution`: venue, museum, festival, university, or major cultural body.
- `commercial`: ticketing or commercial event listing.
- `community`: community calendar with weaker provenance.
- `unknown`: provenance unclear.

Terms status is separate from trust:

- `open_license`: compatible license or open-data terms.
- `api_terms_compatible`: API/feed appears intended for programmatic access.
- `permission_required`: useful but not runtime-safe until permission is clear.
- `unknown`: needs review.
- `restricted`: reject for runtime provider use.

Trust does not override legality or source clarity. An official source with
restricted terms is still not runtime-ready.

Robots, terms, structure, and source health affect trust/runtime eligibility.
They should not make scraping disappear from the architecture. If a source is
legally or structurally unclear, classify it as `needs_adapter_or_permission` /
probe-only rather than pretending no source exists.

## Freshness And Timing

Every provider must preserve enough timing to let
`normalizeTimeSensitiveSourceEvent()` decide:

- `now`: currently active.
- `today`: relevant later or earlier today.
- `tonight`: same-day evening relevance.
- `future`: not for current Pulse promotion.
- `stale`: expired or stale, even if raw data claims `now`.
- `unknown`: not enough time information.

Provider output should include `last_checked` and source freshness where
available. Expiry facts win over source-provided `timing_relevance`.

Timezone handling belongs in the provider adapter or trusted context layer. If
an event source only exposes local date strings, the adapter must either attach
a trusted timezone or downgrade timing precision honestly.

## Local-Language And Translation

Local-language sources are first-class candidates. Parranda should not reject a
good source because it is Greek, Catalan, Italian, Swedish, or any other local
language.

Discovery should:

- use local-language discovery terms alongside English terms;
- detect and preserve `source_language` and `event_language`;
- preserve original titles and source-owned truth;
- translate only short factual atoms when needed for display, search, or
  salience;
- record `translation_status` and `translation_confidence` when translation
  happens;
- keep translated atoms separate from raw source facts.

Examples of factual atoms that may be translated:

- category;
- short venue type;
- status;
- simple event kind;
- route/salience hint labels.

Do not translate or rewrite full editorial descriptions as Parranda-owned
content. If translation is missing, the event can still be source-backed; Pulse
should wrap it in localized Parranda chrome while keeping the raw event title in
its source language.

## Geocoding And Venue Handling

For Pulse display, a source-backed city-level event can be useful. For nearby
or route influence, a stronger place target is required:

- Provider coordinates are best.
- Known place IDs or stable venue identifiers are acceptable.
- Venue name plus address can become a geocoding candidate if confidence is
  high enough.
- A source URL alone must not create a place card, nearby claim, or route stop.

Venue geocoding should be cached and attributable. If geocoding is ambiguous,
the event can remain city-level Pulse context but should not become a route
candidate.

## Dedupe And Fusion

Discovery may find the same event through several families. Fusion should be
conservative:

- Same official event ID from same source is a duplicate.
- Canonical source URL match is a strong duplicate.
- Title + venue + start date can be a probable duplicate when normalized
  strings and timing align.
- Coordinates may support a duplicate decision but must not be the only match.
- Distinct performances in a recurring series should not collapse into one
  event unless the source explicitly models them that way.

The provider registry now runs conservative event-evidence fusion after
normalization. Cross-publisher rows merge only when title, start time, and
venue or nearby coordinates agree. The canonical event keeps compact
`sources[]`, field-level provenance, publisher-independent source count, and
conflict reasons while preferring the strongest source for missing fields.

Two adapters from one publisher are not independent corroboration. Weak
social/community evidence stays low-confidence on its own, while independent
trusted evidence may lift the fused event to medium confidence. Title-only,
untimed, geographically incompatible, stale, or conflicting rows are never
silently promoted.

## Runtime Strategy

The future runtime path should be a-la-minute but bounded:

1. Resolve place/bounds.
2. Load cached source-discovery profile for that place or nearby region.
3. If missing/stale, run low-volume discovery against known search surfaces and
   source-family heuristics.
4. Run only approved provider adapters. Do not fetch arbitrary user URLs.
5. Normalize into `time_sensitive_events`.
6. Feed normalized events into Pulse salience and, later, dayflow/route gates.
7. Fail soft with source status instead of blocking Planner/Pulse.

Runtime discovery should be opt-in/gated until source families are proven. City
packs may add curated source descriptors, but they should accelerate discovery,
not become required for Pulse/live to work.

## Caching And Rate Limits

- Source discovery profiles: cache per place/bounds/source family for days to
  weeks.
- Provider results: cache according to source cadence, usually 15 minutes to
  24 hours.
- Venue geocoding: cache stable venue/address resolutions longer.
- Respect robots, API terms, source health, user-agent requirements, and rate
  limits.
- Prefer fresh cache plus bounded refresh. Do not perform unbounded live
  scraping per user request.
- Provider failures return empty results plus `source_status`; they do not crash
  Pulse.

## Fail-Soft Behavior

Each failure should be explicit:

- `no_source_family_found`
- `terms_restricted`
- `permission_required`
- `missing_start_time`
- `missing_source_url`
- `venue_not_geocodable`
- `provider_failed`
- `stale_events_only`

Pulse should prefer an honest soft-empty state over promoting weak or stale
signals. Planner/dayflow should not treat missing live events as evidence that
nothing is happening.

## Feeding `time_sensitive_events`

Approved providers should return raw `time_sensitive_events`. The registry
normalizes them through `normalizeTimeSensitiveSourceEvent()` and exposes them
to inspect mode. Pulse consumes only events that are:

- timing-relevant (`now`, `today`, `tonight`);
- confidence `strong` or `medium`;
- source-backed;
- meaningful enough to render without raw provider payloads.

The normalized event shape should include:

```json
{
  "id": "source-specific-id",
  "title": "Event title",
  "source_url": "https://source.example/event",
  "source_label": "Official source",
  "source_type": "official_open_data",
  "source_tier": "official",
  "city": "place-key",
  "lat": 37.9708,
  "lng": 23.7246,
  "area": "Venue or district",
  "starts_at": "2026-06-18T21:00:00+03:00",
  "ends_at": "2026-06-18T23:00:00+03:00",
  "freshness": "fresh",
  "last_checked": "2026-06-18T08:00:00Z",
  "confidence": "medium",
  "source_language": "el",
  "event_language": "el",
  "translation_status": "provided",
  "translation_confidence": "medium",
  "translated_atoms": ["category"],
  "provenance": {
    "source_label": "Official source",
    "source_url": "https://source.example/event"
  },
  "candidate_kind": "source_event",
  "tags": ["culture", "evening"],
  "intents": ["culture", "nightlife"],
  "route_role_hint": "culture_stop",
  "timing_relevance": "tonight"
}
```

## Pulse Salience

Pulse salience should consume normalized events, not raw feeds:

- `now` beats `tonight`, which beats `today`.
- Strong/official/source-backed events rank higher.
- Coordinates or stable venue context improve salience.
- Route role hints such as `market_stop`, `culture_stop`, or `evening_anchor`
  can help explain why the event matters.
- A stale event, unsupported source, or source-url-only event should not be
  promoted.

This is the bridge from “a source has an event” to “Parranda knows something
timely is happening here.”

## What Citypacks May Add

Citypacks may optionally add:

- approved source descriptors;
- known source labels and attribution;
- venue aliases and stable IDs;
- local timezone/language hints;
- source cadence and parsing risk notes.

Citypacks must not be required for the generic engine. They speed up discovery
and improve trust, but the source-discovery method remains place-agnostic.

## Athens Worked Example

Athens is the first worked example because it is a near-term field-test place.
These are source-family evaluations, not Athens-specific runtime branches.

| Source family | Source / discovery method | Extractability | Geo / venue | Terms / license read | Adapter path | Assessment |
| --- | --- | --- | --- | --- | --- | --- |
| Official municipal calendar | [City of Athens calendar](https://www.cityofathens.gr/en/calendar-events/) exposes The Events Calendar REST endpoint at `https://www.cityofathens.gr/wp-json/tribe/events/v1/` plus iCal/RSS feeds. | REST/ICS can expose title, start/end, source URL, categories, and sometimes venue. | Venue may be absent or city-level for civic meetings; venue/address fields need probing and geocoding. | Official source. No clear open reuse license found in the quick pass, but REST/ICS feeds are public and structured. Treat as viable provider probe with legal/attribution review. | Needs generic `the_events_calendar` or `ical` adapter. | Viable first provider probe, but salience must filter administrative/civic meetings. |
| Official destination calendar | [This is Athens events](https://www.thisisathens.org/events), the official Athens guide, lists visitor-relevant events and detail pages. | Listing/detail pages expose titles, dates, venues, and source URLs. Quick pass did not find reliable `schema.org/Event` JSON-LD. | Venues are usually named and likely geocodable. | [Terms](https://www.thisisathens.org/tia-terms-of-use) are restrictive enough that runtime scraping should be permission-required. | Needs permissioned API or HTML adapter after approval; not current schema.org/Linked Events. | High-value discovery source, but not runtime-ready without permission/API clarity. |
| Cultural institution / major venue | [Megaron events calendar](https://www.megaron.gr/events/events-calendar/) and Athens Epidaurus Festival detail pages such as [Einstürzende Neubauten](https://aefestival.gr/festival_events/einsturzende-neubauten/?lang=en). | Event pages expose titles, dates, venue names, source URLs, and ticket/detail links. Some pages expose map links that can reveal venue coordinates. | Strong venue anchors such as Odeon of Herodes Atticus or Megaron. Coordinates may come from venue pages or map links. | Terms vary/unclear in quick pass; treat as needs review per provider. | Needs `venue_calendar` / `html_event_listing` adapter unless schema.org/Event exists on a specific source. | Good second source family for field-test coverage once terms and parsing risk are reviewed. |
| schema.org/Event JSON-LD | Probe official/event detail pages for `application/ld+json` with `@type: Event`. | Generic extraction works when valid Event JSON-LD is present. | Depends on JSON-LD `location` and venue address/geo. | Terms still source-specific. | Existing `schema_org_event` provider. | Useful generic fallback, but sampled Athens pages mostly exposed WebPage/CollectionPage JSON-LD rather than Event. |
| Linked Events / open-data API | Search local/civic open-data portals for Linked Events compatible APIs. | Existing provider can map title, date, venue, source URL, and geo when the API matches. | Strong when `location` or geo fields exist. | Depends on portal license. | Existing `linked_events` provider. | No Athens Linked Events endpoint confirmed in this pass; keep as source-family probe. |

### Athens Actionable Path

The immediate generic path is:

1. Build a `the_events_calendar` / iCal provider probe using City of Athens as
   fixture source.
2. Keep output as `time_sensitive_events`, not route stops.
3. Add salience filters so civic/admin events do not dominate visitor Pulse.
4. Separately pursue permission/API clarity for This is Athens and venue/festival
   calendars.
5. Reuse schema.org/Event provider wherever Event JSON-LD is actually present.

This gives more than one independent source family:

- municipal official structured calendar;
- official destination calendar, permission-required;
- cultural institution / venue calendars;
- generic schema.org/Event probing;
- open-data/Linked Events probing where available.

If only the municipal provider is runtime-approved at first, the fallback is not
to hardcode Athens. The generic fallback is:

- discover venue/institution calendars in bounds;
- evaluate terms and extractability through the same harness;
- approve adapters source by source;
- feed successful outputs into `time_sensitive_events`.

### Sample Normalized Event

Example based on a City of Athens structured calendar item. Exact timezone and
venue handling would be owned by the provider adapter.

```json
{
  "id": "cityofathens-226719",
  "title": "9η Συνεδρίαση 1ης ΔΚ",
  "source_url": "https://www.cityofathens.gr/data/9i-synedriasi-1is-dk-9/",
  "source_label": "Municipality of Athens",
  "source_type": "official_open_data",
  "source_tier": "official",
  "city": "athens",
  "place_context": "Municipality of Athens",
  "starts_at": "2026-06-18T18:00:00+03:00",
  "ends_at": "2026-06-18T21:00:00+03:00",
  "freshness": "fresh",
  "last_checked": "2026-06-18T08:00:00Z",
  "confidence": "medium",
  "source_language": "el",
  "event_language": "el",
  "translation_status": "needed",
  "translation_confidence": "none",
  "provenance": {
    "source_label": "Municipality of Athens",
    "source_url": "https://www.cityofathens.gr/data/9i-synedriasi-1is-dk-9/"
  },
  "candidate_kind": "source_event",
  "tags": ["civic", "administrative"],
  "intents": [],
  "timing_relevance": "today",
  "visitor_relevance": "low",
  "salience": "low"
}
```

This event would be source-backed and time-sensitive, but its salience may be
low for a visitor route because it is civic/admin rather than cultural or
experiential. It should remain inspectable and maybe city-contextual, but it
should not masquerade as a culture stop or visitor route anchor. That is the
point of separating source discovery from Pulse salience.
