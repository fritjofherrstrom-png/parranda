# Parranda Architecture

This document maps the engine direction behind Parranda. It should be read
with `docs/CITY_ENGINE_PRINCIPLES.md` and `docs/PRODUCT_STRATEGY.md`.

The short version:

```text
Rome is the reference city, not the product boundary.
City packs make Parranda sharper. They must not be what makes Parranda possible.
```

Parranda is moving from a Rome-first app into a city-agnostic city
intelligence engine. A strong city pack can add taste, texture, local rules,
and editorial confidence, but the core product should eventually work anywhere
from Simrishamn to Rio de Janeiro.

## Product Spine

The product flow is:

```text
Landing -> City Page -> Pulse -> Blitz -> Planner
```

- `Landing` helps the user enter a city or global mode.
- `City Page` frames the current city state: curated, preview, internal, or
  fallback.
- `Pulse` decides what matters now.
- `Blitz` decides the next best move.
- `Planner` builds the fuller day.

These surfaces should feel like one product across cities. A city can have more
or less data, but it should not become a different app with different sections,
styles, or hidden behavior.

## Core Principle

The core engine owns product behavior. Cities provide data, source adapters,
local rules, and editorial overlays.

```text
Core engine = behavior
City pack = enhancement data
```

City-specific behavior is valid when it is expressed as city-owned data,
configuration, or providers. It should not appear as city-name branches inside
shared engines. Rome can be the richest reference implementation, but generic
code should not assume Rome is the only real city.

## City Intelligence Layers

Parranda uses several layers that should remain distinct.

### Core Engine

The core engine contains reusable behavior:

- route construction and scoring
- Blitz candidate ranking
- Pulse signal normalization and ranking
- walking and distance heuristics
- language-aware generic prose
- preview/noop handling

The core engine should ask for normalized city context and candidate records. It
should not know whether a recommendation came from Rome curation, Barcelona open
data, a future generated pack, or a generic nearby source unless trust metadata
matters for presentation.

### Generic Generators

Generic generators can run for every city when their inputs are honest and
available. Current examples live in `server/pulse-engine/`:

- live event signals from normalized city events
- golden-hour signals from city center, date, and timezone

Future generic generators can add weather shifts, opening risk, crowd windows,
or route-readiness hints, but only when backed by real inputs or clear rules.

### City Source Adapters

Source adapters fetch and normalize external or official data for one city.
They must be city-scoped and failure-safe.

Examples:

- Rome's Turismo Roma live source
- Barcelona's Open Data BCN agenda source
- future market, civic-center, venue, or official culture feeds

Adapters preserve source-owned fields such as event title, venue, address,
time, category, source URL, and source language. Parranda-owned fields such as
route fit, tags, match reason, wrapper prose, and editorial grouping must be
generated or reviewed by Parranda.

### City Pack

A city pack is a structured enhancement layer. It can include:

- city metadata and visibility state
- area and macro-area model
- catalog places
- route templates
- local truth rules
- source descriptors and adapters
- editorial Pulse generators
- localized city-owned copy

City packs improve quality and confidence. They should not be required before
Parranda can return a useful baseline.

### Editorial Overlays

Editorial overlays add taste and local confidence on top of normalized data.
They can explain why a moment matters, which neighborhoods carry the day, what
to avoid, and what kind of route feels right. They must stay honest about their
source and confidence level.

Editorial overlays should never fabricate local knowledge for auto or preview
cities.

## Current Contracts

### CityConfig

`server/cities/contract.js` defines the current city contract. A real registered
city provides:

- `key`, `label`, `timezone`, `locale`, `currency`, and `center`
- `todayIsoDate`
- `catalog`
- `services`
- `walking`
- `routing`
- optional `localTruth`
- optional `sources`
- optional visibility and display labels

This is the current plug-in boundary for city-specific data and services.

### City Catalog

The catalog currently exposes:

- `allItems`
- `routeTemplates`
- `findItemByName`

Today, route generation and Blitz still read mostly from catalog items and route
templates. Some catalog entries are real places, while others can be structural
route anchors. Structural anchors may help routing but must not appear as normal
venues or user-facing stops.

This catalog-first model works for curated and preview cities, but it is not the
final engine boundary. The next architecture step is to wrap catalog records as
`PlaceCandidate[]`.

### City Services

City services provide city-scoped behavior behind a stable interface:

- `geocodeQuery`
- `fetchWeatherForDates`
- `getCityPulse`
- `getDateSignals`
- `fetchLiveEventsForDates`
- optional `signalGenerators`

These services let preview cities return noop data, curated cities return rich
city-owned data, and future auto cities return source-derived data without
changing the API shape.

### Source And Trust Model

`server/cities/source-contract.js` and
`docs/pulse-live-source-contract.md` define source descriptors. Current source
metadata includes:

- source id and type
- source URL
- status: `candidate`, `active`, `disabled`, or `review-needed`
- supported languages
- update cadence
- source-owned fields
- Parranda-owned fields
- quality flags
- parsing risk
- intended use: `live`, `pulse`, or `both`

Practical trust buckets:

- `official`: official city, venue, market, weather, or provider source
- `verified/computed`: computed from reliable local inputs, such as time,
  coordinates, weather, or walking geometry
- `curated/editorial`: human-curated city pack or reviewed editorial rule
- `inferred`: derived from weaker signals, LLM output, search metadata, or
  unreviewed normalization
- `fallback`: safe baseline used when richer city support is unavailable

The user-facing product should speak with confidence only when the trust bucket
supports it.

### PulseSignal

`server/pulse-engine/types.js` defines `PulseSignal`, the strongest current
engine contract.

Pulse ingests city context, weather, live events, and city/generic generators.
It normalizes raw generator output into ranked `PulseSignal[]` records consumed
by the city page, Blitz, and later Planner.

A `PulseSignal` includes:

- id, city, type, and level
- title, reason, blurb, and time window
- source, trust level, and freshness
- optional route hints
- optional action
- legacy display fields while older UI surfaces migrate

Pulse signals never automatically become route stops. They can suggest route
hints and contextual nudges.

## Place Candidate System

`PlaceCandidate` is the engine foundation contract that follows `PulseSignal`.
It is the shared shape for place-like records consumed by future Blitz and
Planner work, regardless of where they came from. The full shape, vocabulary,
and provider strategy live in `docs/PLACE_CANDIDATES.md` and
`server/place-candidates/contract.js`.

### PlaceCandidate

A `PlaceCandidate` represents:

- a curated Rome or Barcelona catalog stop
- an official/live event venue
- a generated or inferred place
- a future map/search result
- a future semi-automatic city pack draft candidate
- a structural routing anchor or area preset

Shape:

```js
{
  id: "barcelona-casa-vicens",
  city: "barcelona",
  label: "Casa Vicens",
  type: "museum",
  candidate_kind: "real_place",
  is_structural: false,
  lat: 41.4036,
  lng: 2.1507,
  area: "gracia",
  macro: "northwest-local",
  source: {
    kind: "city_catalog",
    id: "barcelona-pilot-catalog",
    url: "https://..."
  },
  trust: {
    source_tier: "curated",
    confidence: "high",
    human_verified: true,
    freshness: "fresh"
  },
  tags: ["kultur", "klassiker"],
  vibes: ["curious"],
  time_fit: ["morning", "afternoon"],
  route_roles: ["anchor", "culture"],
  city_pack_owned: true
}
```

Design rules:

- keep provider/source text separate from Parranda-owned judgment fields
- carry trust and freshness with the candidate
- allow coordinates to be unknown only when the downstream engine can handle it
- distinguish real venues from structural anchors and area presets
- avoid city-specific tag dialects that shared engines cannot understand

### Provider Registry

`server/place-candidates/provider-registry.js` is the internal collection layer:

```text
CityConfig -> CandidateProviderRegistry -> PlaceCandidate[]
```

The registry is synchronous by design. Providers do not fetch external data
directly; when they need fresh inputs they read them from a context already
filled by a higher-level engine. This keeps readiness checks cheap,
deterministic, and safe while the candidate system is still internal. Async
becomes an option only when a real Blitz or Planner consumer needs it, with
that consumer's tests behind the switch.

The default registry enables only `CuratedCatalogProvider`. Other providers are
opt-in via custom `providerSpecs`.

### Shipped Providers

- `CuratedCatalogProvider` — default-enabled. Wraps `cityConfig.catalog.allItems`
  into city-pack-owned `PlaceCandidate[]` with `source.kind: "city_catalog"`.
  Distinguishes real places, structural anchors, and area presets via
  `candidate_kind`.
- `LiveEventVenueProvider` — opt-in. Converts already-fetched
  `context.events` / `context.live_events` / `context.official_events` into
  `event_venue` candidates with `source.kind: "live_event_feed"` and
  `trust.source_tier: "official"`. It does not fetch from Open Data BCN,
  Turismo Roma, or any other external source — it consumes whatever the
  engine already gathered.

### Readiness Diagnostics

`server/place-candidates/readiness.js` provides
`assessCityCandidateReadiness()` — a sync, conservative check that summarizes
the current candidate pool: totals, candidate kinds, trust tiers, coordinate
coverage, and `can_support_blitz` / `can_support_planner` flags. It exists so
later PRs can decide when it is safe to consume candidate providers; it does
not currently change Planner, Blitz, routing, UI, or public API behavior.

## Future Contracts

These contracts describe intended next direction. Some pieces are partially
shipped — see each subsection for status.

### RouteCandidate

`RouteCandidate` should describe a possible route before final user-facing
formatting. The first implementation contract lives in
`docs/ROUTE_CANDIDATES.md` and `server/route-candidates/contract.js`.

It should include:

- ordered `PlaceCandidate` stops
- start/end points
- shape: loop, arc, mini-route, or nearby move
- estimated walking distance and duration
- covered intents and missing intents
- route roles and area flow
- confidence and trust summary
- source mix, such as curated template, catalog-first, live-assisted, or fallback
- explanation inputs used later for localized prose

This separates "how the engine reasons" from "how the UI explains the route."

### CandidateProvider

`CandidateProvider` is the abstraction that supplies candidates to future
Blitz and Planner. The registry interface is shipped (see Place Candidate
System above). The provider roster below mixes shipped and future entries.

Provider roster:

- `CuratedCatalogProvider` — shipped, default-enabled.
- `LiveEventVenueProvider` — shipped, opt-in, context-based.
- `RouteTemplateProvider` — shipped on the RouteCandidate side, not as a
  PlaceCandidate provider. It converts current route templates into
  `RouteCandidate[]` for diagnostics and shadow comparison.
- `GeneratedCityPackProvider` — future.
- `MapSearchProvider` — future.
- `NearbyGenericProvider` — future.

Providers emit normalized candidates with trust metadata. The engine can score
and combine candidates without knowing whether the source was a city pack,
official live feed, generated draft, or generic fallback.

## Engine Ownership

Each engine owns a different decision.

### Pulse

Pulse decides what matters now.

It should answer:

- What is happening today?
- What timing, weather, event, or local rule changes the city?
- Which signal deserves the masthead?
- What should Blitz or Planner know as a nudge?

Pulse is not a route builder. Its route hints can influence scoring, but they do
not force stops.

### Blitz

Blitz decides the next best move.

It should answer:

- What should the user do from here?
- What is good for this time band and vibe?
- Is a single stop or compact mini-route better?
- What should be avoided because of repetition or weak timing?

Today Blitz reads city catalog items directly. Future Blitz should read
`PlaceCandidate[]` from providers.

### Planner

Planner builds the full day.

It should answer:

- What route shape fits the user's constraints?
- Which stops should carry the day?
- How should distance, pacing, weather, live events, and local truth affect the
  route?
- Which alternatives are meaningfully different?

Today Planner is catalog-first and template-aware. Future Planner should become
candidate-provider-first, while curated route templates remain a high-quality
provider rather than the only route foundation.

### City Packs

City packs enrich the output. They do not own product logic.

They can provide better candidates, stronger route seeds, richer local truth,
and sharper editorial language. The shared engines decide how to use those
inputs.

## Migration Path

Shipped:

1. ✅ Define `PlaceCandidate` — contract lives in
   `server/place-candidates/contract.js`.
2. ✅ Wrap current catalog items as `PlaceCandidate[]` — done via
   `CuratedCatalogProvider`.
3. ✅ Introduce candidate providers while keeping existing catalog behavior
   behind a compatibility layer — synchronous provider registry with
   `CuratedCatalogProvider` default-enabled, `LiveEventVenueProvider` opt-in,
   and readiness diagnostics.

Still ahead:

4. Move the route engine from catalog-first to candidate-provider-first.
5. Let Pulse route hints nudge Planner scoring without becoming forced stops.
6. Add route-readiness diagnostics so each city can say what it can safely
   support.
7. Build semi-automatic city pack generation from normalized candidates and
   review metadata.
8. Expand city-packless mode using generic nearby, live, weather, timing, and
   walking inputs.

## Guardrails

- Do not add city-specific branches inside shared engines for city-pack behavior.
- Do not present inferred or fallback data with curated confidence.
- Do not let preview cities silently borrow another city's content.
- Do not expose structural anchors as real places or venue stops.
- Do not make Pulse signals become route stops automatically.
- Do not treat route templates as the permanent route foundation.
- Do not change public API shape casually; add internal contracts first.

## Current State Summary

Rome is the richest curated reference city. Barcelona is a preview city with a
real city skeleton, neighborhood model, catalog, route templates, and Open Data
BCN live source, but it should still speak honestly about incomplete curated
coverage.

The system now has enough citypack structure to support more cities, enough
Pulse architecture to show what a shared engine contract can look like, and a
shipped `PlaceCandidate` system ready for future Blitz and Planner consumers.
