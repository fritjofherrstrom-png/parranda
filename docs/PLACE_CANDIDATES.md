# PlaceCandidate Contract

**Status:** Current data contract; migration notes updated after #492.

**Historical note:** The contract began as a shadow-only foundation. Candidate
spine, Blitz and Planner consumers now exist; old shadow milestones are not
current implementation instructions.

`PlaceCandidate` is the shared normalized shape for place-like records,
regardless of where they came from. Curated providers, external/open loaders,
reviewed local sources and already-fetched event context can all feed the
candidate spine, where evidence reduction, gates, fit and role selection decide
what each surface may use.

## What It Represents

A `PlaceCandidate` can represent:

- a curated Rome catalog stop
- a Barcelona catalog stop
- an official/live event venue
- a generated or inferred place
- an external map/open-data result
- a generated or citypack draft candidate
- a structural routing anchor or area preset

The key distinction is that not every candidate is a user-facing venue. A
structural anchor can help routing, but it must not be presented as a normal
place.

## Required Shape

Normalized candidates include:

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
  freshness: "fresh",
  tags: ["kultur", "klassiker"],
  vibes: ["curious"],
  time_fit: ["morning", "afternoon"],
  route_roles: ["anchor", "culture"],
  confidence: "high",
  city_pack_owned: true
}
```

Coordinates are optional only when a downstream caller can handle missing
geometry. If one coordinate is present, both `lat` and `lng` must be present and
valid.

## Candidate Kinds

Supported `candidate_kind` values:

- `real_place`: a normal venue/place that can be shown to users.
- `event_venue`: a venue or location derived from official/live event data.
- `structural_anchor`: a routing helper, not a visible place.
- `area_preset`: an area-level helper or preset.
- `generated_place`: inferred/generated candidate that needs review.
- `map_result`: candidate from an external map/search/open-data provider.
- `draft_place`: generated or semi-automatic citypack draft candidate.

`is_structural` is derived from `candidate_kind`. Structural candidates should
not appear as normal search results, venue cards, or route `main_stops`.

## Trust

Every candidate carries trust metadata:

- `source_tier`: `official`, `verified`, `computed`, `curated`, `editorial`,
  `inferred`, or `fallback`
- `confidence`: `high`, `medium`, `low`, or `needs_review`
- `human_verified`: boolean
- `freshness`: `live`, `fresh`, `stale`, or `unknown`

This mirrors the direction in `docs/ARCHITECTURE.md` and
`docs/PRODUCT_STRATEGY.md`: the product should only speak with the confidence
that the source supports.

## Source Boundary

`source` describes where the candidate came from. It should preserve provider
or citypack provenance without mixing it with Parranda-owned judgment.

Examples:

- `{ kind: "city_catalog", id: "rome-catalog" }`
- `{ kind: "live_event_feed", id: "barcelona-open-data-agenda" }`
- `{ kind: "map_search", label: "map provider" }`
- `{ kind: "open_data", id: "reviewed-open-provider" }`
- `{ kind: "open_geo_source", id: "bounded-geo-provider" }`
- `{ kind: "generated", id: "draft-citypack-generator" }`
- `{ kind: "routing_config", id: "barcelona-area-model" }`

Provider-owned text remains provider-owned. Parranda-owned fields include
`tags`, `vibes`, `time_fit`, `route_roles`, `confidence`, and trust decisions.

Current common `source.kind` vocabulary:

- `city_catalog`: curated/manual city catalog entries.
- `live_event_feed`: already-fetched official/live event records.
- `map_search`: external map/search results.
- `open_data`: normalized open or reviewed source datasets.
- `open_geo_source`: bounded geographic source-backed datasets.
- `generated`: inferred or semi-automatic draft candidates.
- `routing_config`: structural anchors and area presets from city routing config.

The runtime contract requires a bounded non-empty source kind but remains
extensible. New values require a focused contract update that defines source
ownership, family/tier/policy, attribution and promotion behavior; they must not
be invented inside a candidate pack or public payload.

## Current Runtime Path

```text
trusted loaders / curated catalog / reviewed persistent reservoir
  -> normalized PlaceCandidate records
  -> entity resolution + evidence reduction
  -> eligibility gates + fit + role selection
  -> Blitz / registered-city fill / any-place sourceCandidates
  -> route/dayflow composition
```

The synchronous provider registry remains one compatibility and normalization
layer; it is not the only source-acquisition path. Network and persistent
acquisition happen in bounded upstream loaders/workers, never inside a public
payload or an arbitrary provider call. Current work should extend this path
rather than create a fourth candidate pipeline.

Still open after the first bounded schema.org list→detail adapter: operate
reviewed sources across large unsupported and smaller/regional places, add only
evidence-backed bounded adapters for materially different real source shapes,
improve conservative aliases/entity resolution, and define promotion criteria
for retiring legacy experimental paths.

## Current Compatibility Provider

`server/place-candidates/curated-catalog-provider.js` is the first bridge from
today's city catalogs into the candidate system:

```text
existing city catalog -> CuratedCatalogProvider -> PlaceCandidate[]
```

The provider reads `cityConfig.catalog.allItems`, normalizes each item through
the `PlaceCandidate` contract, and marks all records as city-pack-owned curated
catalog candidates. It also distinguishes normal places from structural routing
helpers:

- real venue/place items become `candidate_kind: "real_place"`;
- `district-group` and `structuralRouteAnchor` items become
  `candidate_kind: "structural_anchor"`;
- `district` items become `candidate_kind: "area_preset"`.

This provider remains the compatibility bridge for curated citypack records.
Those normalized records now participate in shared candidate reasoning where a
surface has adopted the candidate spine; rich citypack behavior remains
curated-first.

## Candidate Provider Registry

`server/place-candidates/provider-registry.js` adds the internal collection
layer:

```text
CityConfig -> CandidateProviderRegistry -> PlaceCandidate[]
```

The default registry enables `CuratedCatalogProvider`; callers may add bounded
provider specs for already-acquired context. It can collect candidates for a
city and return a diagnostic summary with:

- total candidates
- real place count
- structural candidate count
- counts by `candidate_kind`
- counts by trust tier
- counts by provider

The registry is internal, but its normalized candidates are consumed by the
shared candidate pool and adopted Planner/Blitz paths. It must not be treated as
diagnostics-only or as permission to duplicate acquisition inside a surface.

## Provider Async Strategy

The registry stays synchronous for now.

Fresh providers may need asynchronous acquisition, but
`CandidateProviderRegistry` should still not fetch inside provider calls.
Higher-level trusted loaders/workers acquire and cache data; context-based
providers normalize it:

```text
higher-level engine fetches live events -> context.events -> LiveEventVenueProvider -> PlaceCandidate[]
```

That means `LiveEventVenueProvider` should convert already-fetched
`context.events` into `event_venue` candidates. It should not call Open Data
BCN, Turismo Roma, or any other provider directly. This keeps readiness checks and normalization deterministic while allowing
network-backed supply through explicit server-owned seams. Change this boundary
only through a reviewed contract with cancellation, bounds, cache and tests.

## Live Event Venue Provider

`server/place-candidates/live-event-venue-provider.js` normalizes official/live
event venues as candidate inputs:

```text
already-fetched context.events -> LiveEventVenueProvider -> event_venue PlaceCandidate[]
```

The provider is synchronous and does not fetch from any provider. It accepts
already-normalized live events as either an array or a date-keyed object, then
converts usable event venues into `candidate_kind: "event_venue"` candidates.
It returns `[]` when no `context.events` are supplied.

Live-event venue candidates use:

- `source.kind: "live_event_feed"`
- `trust.source_tier: "official"` for official sources such as Open Data BCN
  or Turismo Roma
- `city_pack_owned: false`

Missing venue labels are skipped rather than invented. Missing coordinates do
not crash the provider; the candidate remains coordinate-less and should be
treated as `needs_review` unless upstream context supplies stronger trust.

The provider is opt-in and context-based. Event route influence remains a
separate eligibility decision: an event venue does not automatically become a
Planner stop merely because it is a `PlaceCandidate`.

## Candidate Readiness Diagnostics

`server/place-candidates/readiness.js` adds an internal diagnostic layer:

```text
CityConfig -> CandidateProviderRegistry -> assessCityCandidateReadiness()
```

It answers whether a collected candidate pool looks safe enough for a surface.
V1 remains a conservative compatibility diagnostic and must not be confused
with the newer source-status, promotion and route-readiness gates.

The readiness result includes:

- city key
- total candidates
- real place count
- structural candidate count
- coordinate-ready real place count
- coordinate coverage
- counts by candidate kind
- counts by trust tier
- counts by provider
- `has_minimum_real_places`
- `has_coordinates_coverage`
- `can_support_blitz`
- `can_support_planner`
- `warnings`

Default v1 thresholds:

- Blitz needs at least 10 real, coordinate-ready-enough place candidates.
- Planner needs at least 25 real, coordinate-ready-enough place candidates.
- Structural anchors and area presets do not count as real places.
- Coordinate coverage must be at least 80 percent of real places.

These diagnostics do not themselves mutate Planner, Blitz, routing, UI, or
public API behavior. Current consumers have separate explicit gates that decide
when candidate output may affect a result.
