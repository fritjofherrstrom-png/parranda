# Parranda Architecture

**Status:** Current architecture overview, refreshed after #492.

**Canonical for:** candidate acquisition/composition boundaries and engine
ownership. Historical migration plans must not override this document.

This document maps the current engine direction behind Parranda. It should be
read with `docs/CITY_ENGINE_PRINCIPLES.md`, `docs/PARRANDA_ENGINE_GOALS.md` and
`docs/AGNOSTIC_ENGINE_NORTH_STAR.md`.

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

### Source Adapters And Acquisition

Source adapters fetch and normalize external or official data for a trusted
place scope. Legacy adapters may be city-scoped; generic acquisition is bound
to resolver-attested anchors/bounds and Source Catalog profiles. All adapters
must be failure-safe.

Examples:

- Rome's Turismo Roma live source
- Barcelona's Open Data BCN agenda source
- generic reviewed event/place adapters operated for arbitrary places

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

Rich citypack routes remain catalog/template-aware. Catalog records are also
wrapped as `PlaceCandidate[]`, and adopted Blitz/Planner paths can combine them
with gated source-backed candidates. Some catalog entries are real places while
others are structural route anchors; structural anchors may help routing but
must never appear as normal venues or user-facing stops.

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

`PlaceCandidate` is the shared shape for place-like records consumed by adopted
Blitz and Planner paths, regardless of where they came from. The full shape,
vocabulary and provider strategy live in `docs/PLACE_CANDIDATES.md` and
`server/place-candidates/contract.js`.

### PlaceCandidate

A `PlaceCandidate` represents:

- a curated Rome or Barcelona catalog stop
- an official/live event venue
- a generated or inferred place
- an external map/open-data result
- a generated or semi-automatic citypack draft candidate
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
directly; bounded server-owned loaders and workers acquire/cache data and pass
normalized context or datasets into the candidate spine. This keeps provider
normalization deterministic without pretending the overall supply path is
fixture-only.

The default registry enables `CuratedCatalogProvider`. Callers can add opt-in
context providers, while external/open and reviewed persistent supply enters
through the shared candidate pool's trusted loader seam.

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
`assessCityCandidateReadiness()` — a sync, conservative compatibility check that
summarizes totals, candidate kinds, trust tiers and coordinate coverage. Newer
consumer paths also use source status, gates and promotion/readiness contracts;
this helper is not the sole permission boundary.

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

`CandidateProvider` is one normalization abstraction that supplies candidates
to the shared spine. The registry interface is shipped; network-backed supply
may be acquired upstream and injected as a bounded dataset rather than fetched
inside a provider.

Provider roster:

- `CuratedCatalogProvider` — shipped, default-enabled.
- `LiveEventVenueProvider` — shipped, opt-in, context-based.
- `RouteTemplateProvider` — shipped on the RouteCandidate side, not as a
  PlaceCandidate provider. It converts current route templates into
  `RouteCandidate[]` for diagnostics and shadow comparison.
- external/open datasets — shipped through trusted loaders and the shared
  external candidate provider;
- reviewed place sources — shipped through revision-bound worker persistence;
- generated citypack drafts and additional generic providers — optional future
  extensions, not required parallel pipelines.

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

Legacy Blitz paths may still read city catalogs, while candidate-based and
anywhere Blitz paths consume the shared candidate spine. New work should extend
the shared gates and selectors rather than add another Blitz-only acquisition
loop.

### Planner

Planner builds the full day.

It should answer:

- What route shape fits the user's constraints?
- Which stops should carry the day?
- How should distance, pacing, weather, live events, and local truth affect the
  route?
- Which alternatives are meaningfully different?

Rich Planner remains curated-first and template-aware. Thin registered-city and
any-place paths can consume source-backed candidates and compose through the
ordinary route engine. Curated templates remain a high-quality accelerator,
not the only route foundation.

### City Packs

City packs enrich the output. They do not own product logic.

They can provide better candidates, stronger route seeds, richer local truth,
and sharper editorial language. The shared engines decide how to use those
inputs.

## Current Candidate And Signal Centerlines

```text
resolver-attested place context
  -> curated catalog + trusted broad loaders + approved local reservoir
  -> PlaceCandidate normalization
  -> entity resolution + evidence reduction
  -> eligibility gates + fit + role coverage
  -> Blitz: bounded next-move ranking
  -> Planner: sourceCandidates / curated inputs
       -> ordinary route engine (`agnostic_compose` where applicable)
       -> walking, honesty and promotion gates

reviewed event providers
  -> normalized time-sensitive events + display/route eligibility
  -> Pulse projections
  -> optional bounded route interrupt after geometry/walking validation
```

Current architecture work should improve supply, source operation, bounded
adapters, entity resolution and deliberate promotion. It should not recreate
the completed candidate migration or make diagnostics a permanent substitute
for product capability.

## Guardrails

- Do not add city-specific branches inside shared engines for city-pack behavior.
- Do not present inferred or fallback data with curated confidence.
- Do not let preview cities silently borrow another city's content.
- Do not expose structural anchors as real places or venue stops.
- Do not make Pulse signals become route stops automatically.
- Do not treat route templates as the permanent route foundation.
- Do not change public API shape casually; add internal contracts first.

## Current State Summary

Parranda now has both rich curated citypack paths and a generic any-place path.
The candidate spine is a real decision substrate: broad trusted loaders and
operator-approved local source profiles can feed bounded source-backed places
into the ordinary route engine, while citypacks remain curated-first
accelerators. The remaining architecture work is supply breadth, source
operation, conservative entity resolution, route/event quality and deliberate
promotion—not another candidate or composer pipeline.
