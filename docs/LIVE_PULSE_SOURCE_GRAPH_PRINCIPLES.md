# Live/Pulse Source Graph Principles

This note captures the product and engine principles for making Parranda's live/Pulse layer work for agnostic places without creating a new UI surface, a new product, or a citypack dependency.

## Product principle

Agnostic live/Pulse is not a product surface. It is an internal engine capability.

The user-facing promise stays simple:

> Type a place. Parranda tries to plan it and weigh what is happening there now.

The user should not see a separate "any-place", "labs", "alpha", or "dogfood" experience. Citypacks may enhance the result, but the live/Pulse engine must also be able to operate when a citypack is absent or thin.

## Core model

Live/Pulse should be driven by a two-layer model:

1. **Source discovery**  
   Find, classify, score, and cache candidate live/event sources for a place or region.

2. **Runtime Pulse**  
   Fetch or refresh events from known eligible sources, normalize them into the existing `time_sensitive_events` contract, dedupe/fuse them, and feed existing Pulse salience.

Do not make every request search the open web from scratch. The engine should build and reuse a **Source Graph**.

## Source Graph

A Source Graph is a cached, per-place or per-region source index.

It should track candidate event sources with enough metadata for runtime decisions:

```json
{
  "place_key": "resolved-place-or-region-id",
  "bounds": "resolved bounds/radius",
  "sources": [
    {
      "family": "official_city_calendar",
      "url": "https://example.test/events",
      "adapter": "wordpress_tribe_events",
      "trust_tier": "official",
      "runtime_eligible": true,
      "last_checked": "2026-06-18T00:00:00Z",
      "health": "ok",
      "ttl_seconds": 3600
    }
  ]
}
```

Citypacks may optionally contribute preferred sources, but they must not be required. For a place without a citypack, the engine should still attempt bounded discovery and fail softly when no trusted source can be used.

## Runtime shape: what "a la minute" means

"A la minute" must not mean unbounded live scraping per user request.

It should mean:

1. read fresh source/event cache first;
2. refresh known fast sources within a bounded budget;
3. run bounded discovery only when the Source Graph is missing or stale;
4. return an honest empty/thin live state if no trusted source can be used in time;
5. continue slower refresh/discovery in the background when supported.

Example budget model:

- **0-300 ms:** use cached event/source graph data;
- **300-1500 ms:** refresh known fast runtime-eligible sources;
- **1500-4000 ms:** run bounded discovery if the graph is absent/stale;
- **after budget:** fail softly and surface only trusted current signals.

## Source families

The engine should prefer high-trust, structured sources, but must not assume they always exist.

Priority order:

1. official API / open-data feed;
2. ICS / RSS / calendar feed;
3. `schema.org/Event` / JSON-LD structured data;
4. stable HTML calendar scraping;
5. JS-rendered/browser scraping as a last resort;
6. weak social/manual listings as discovery-only or `needs_review`.

Top-tier sources are common in some large cities and institutions, but not universal. Good code should maximize tiers 1-3 while supporting tier 4 as a controlled source family.

## Local-language sources and translation

The most useful live/Pulse sources are often local, non-generic, and written in the local language. The engine must treat local-language sources as first-class candidates, not as lower-value fallbacks.

Source discovery should record language metadata for both sources and events:

- source page language when detectable;
- event title language;
- venue/address language;
- whether structured data already provides multiple languages;
- whether translation was applied;
- translation confidence and provider, when applicable.

The source of truth should remain the original source. Translation is a presentation and normalization layer, not a replacement for provenance.

Recommended event shape extension:

```json
{
  "title_original": "local-language title",
  "title_display": "English or user-language title",
  "language_original": "el",
  "language_display": "en",
  "translation_status": "machine_translated",
  "translation_confidence": "medium",
  "source_url": "https://example.test/event"
}
```

Translation should prioritize short factual atoms:

- event title;
- category/kind;
- short venue label;
- minimal timing/status labels;
- short summary only when necessary and permitted.

Do not translate or copy long editorial descriptions as Parranda content unless the source terms and product need clearly allow it. Prefer linking to the original event page.

Runtime should not block a good source merely because it is not in English. Instead:

1. parse structured facts in the original language;
2. normalize timing/venue/source URL independently of translation;
3. translate only the fields needed for user display or salience classification;
4. preserve original labels for audit/debug and attribution;
5. fail softly if translation is unavailable by showing the original title plus source link when acceptable.

Translation can also improve source discovery. Queries and probes should use local-language search terms and common event/calendar words for the resolved place/region, not only English terms. Citypacks may optionally add local search terms and venue aliases, but agnostic discovery should still infer likely language from the resolver, country/region, and source metadata.

## Scraping policy

Scraping is not categorically forbidden. It is a valid source family when structured APIs/feeds are unavailable.

The rule is not "no scraping". The rule is:

> Scraping is allowed only when classed, bounded, cacheable, attributable, and used for factual event atoms rather than copied editorial content.

Allowed factual atoms:

- title;
- start/end time;
- venue;
- address/geo;
- source URL;
- status;
- category;
- organizer.

Avoid copying:

- full editorial descriptions;
- images;
- long marketing copy;
- ticketing/legal copy.

Required controls:

- preserve `source_url` and attribution;
- respect robots/terms signals in trust/runtime eligibility;
- use an identifiable user-agent;
- enforce rate limits;
- cache source and event reads;
- fail softly;
- mark unclear sources `probe_only` or `needs_review` instead of treating them as production-ready.

Unclear terms, robots, or structure should reduce trust or runtime eligibility. They should not erase scraping from the architecture.

## Discovery pipeline

For an agnostic place request:

1. resolve the place strongly enough to obtain name, coordinates, bounds/radius, country/region, and language hints;
2. check the cached Source Graph for the place/region;
3. if missing or stale, generate source candidates from multiple source families;
4. run small probe adapters against candidates;
5. score sources by trust, parseability, freshness, coverage, geo quality, terms clarity, latency, stability, and dedupe potential;
6. classify each candidate as:
   - `runtime_eligible`,
   - `probe_only`,
   - `needs_review`,
   - `rejected`;
7. fetch events only from runtime-eligible sources in the runtime path;
8. normalize to `time_sensitive_events`;
9. dedupe/fuse across sources;
10. feed Pulse salience.

## Probe adapters

Discovery should be adapter-driven. Candidate probes should answer whether a source can provide the minimum facts needed for `time_sensitive_events`.

Useful probe adapters:

- `schema_org_event_probe`;
- `linked_events_probe`;
- `ics_probe`;
- `rss_probe`;
- `wordpress_tribe_events_probe`;
- `html_calendar_probe`;
- `js_rendered_calendar_probe` as last resort.

Each probe should report:

- title available;
- start/end available;
- venue/place available;
- geo exists or venue is geocodable;
- source URL available;
- event status available if present;
- source/event language detected;
- translation needed for display/salience;
- freshness/coverage;
- license/terms/attribution clarity;
- estimated latency;
- runtime eligibility.

## Scoring and runtime eligibility

A source should not become runtime-eligible merely because events can be extracted.

Score sources on:

- trust tier: official, institutional, venue, aggregator, weak;
- parseability: API/feed/JSON-LD/stable HTML/JS-rendered;
- freshness: current event coverage and recent updates;
- geo quality: direct geo, venue geocodable, vague venue, no venue;
- language handling: local-language source accepted, translation path available when needed;
- attribution clarity;
- terms/robots clarity;
- latency and reliability;
- duplication risk;
- source health.

Runtime eligibility should require enough trust, timing, source URL/provenance, and bounded latency. Sources below that threshold can still be kept in the graph as `probe_only` or `needs_review`.

## Dedupe and fusion

Multiple sources are expected. The engine should not depend on a single city calendar.

Events from multiple sources should be fused by approximate identity:

- normalized title;
- start time/date;
- venue identity or geocoded location;
- source URL/canonical URL;
- organizer where available.

When duplicates conflict, prefer:

1. official source;
2. venue/institution source;
3. structured API/feed;
4. more recent source;
5. richer geo/timing source.

Fusion should preserve provenance from all contributing sources where useful.

For multilingual duplicates, compare both original and translated/normalized titles when available. Do not treat two events as different merely because one source is local-language and another is English.

## Pulse integration

Do not rebuild the Pulse event pipeline.

The source discovery layer should feed the existing path:

```text
source discovery
→ runtime eligible sources
→ normalized time_sensitive_events
→ existing event quality gates
→ Pulse salience
→ Pulse UI
```

Events should enter Pulse first. They should not automatically become Planner stops.

Event-as-route-stop is a later, stricter feature and should require:

- source-backed event;
- clear venue/geo;
- valid current timing window;
- high confidence;
- relevance to the user's intent/day;
- route/walking compatibility;
- non-cancelled/non-stale status.

## Citypacks and agnostic places

Citypacks can enhance live/Pulse by shipping preferred sources, local source trust hints, and known venue aliases.

But citypacks must remain an enhancement layer, not a hard dependency.

For an agnostic place, the engine should:

- resolve the place strongly;
- build or reuse a Source Graph;
- try multiple source families;
- include local-language source discovery terms;
- show trusted Pulse signals if available;
- show an honest empty/thin state if not.

## Anti-drift rules

Do not create a new user-facing surface for this work.

Do not revive `/labs/anywhere`, "any-place alpha", dogfood UI, or a second search experience.

Do not add Planner behavior in a source-discovery PR.

Do not make events route stops in a source-discovery PR.

Do not claim a city has live Pulse unless at least one runtime-eligible source exists and fresh events pass the existing gates.

Do not demote a source merely because it is in the local language. Treat translation as an engine capability, not as a reason to ignore local sources.

## Immediate next useful build steps

1. Keep the current source-discovery work as a foundation: evaluator, fixture CLI, and docs.
2. Add a Source Graph contract for candidate sources and runtime eligibility.
3. Add probe adapters for at least:
   - schema.org/Event JSON-LD,
   - ICS/RSS,
   - WordPress/The Events Calendar if present,
   - stable HTML calendar extraction as a controlled tier.
4. Add language detection and local-language query/probe support before judging source coverage.
5. Add a translation-status field to normalized event/source records before any user-facing multilingual runtime use.
6. Add cache/TTL/source-health fields before any traffic-facing runtime use.
7. Feed only runtime-eligible, normalized events into existing `time_sensitive_events` and Pulse salience.

The goal is not "find one Athens source". The goal is a repeatable live-source discovery muscle that can start with a place and quickly reuse or find multiple possible sources, without requiring a citypack and without relying on a single hardcoded calendar.
