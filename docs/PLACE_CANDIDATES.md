# PlaceCandidate Contract

`PlaceCandidate` is the next engine foundation contract after `PulseSignal`.
It gives Blitz and Planner one future shape for place-like records, regardless
of where they came from.

This PR only defines the contract. It does not connect candidates to Planner,
Blitz, route scoring, UI, sources, or public API responses.

## What It Represents

A `PlaceCandidate` can represent:

- a curated Rome catalog stop
- a Barcelona catalog stop
- an official/live event venue
- a generated or inferred place
- a future map/search result
- a future city-pack draft candidate
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
- `map_result`: candidate from a future map/search provider.
- `draft_place`: future semi-automatic city-pack draft candidate.

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
- `{ kind: "map_search", label: "future provider" }`
- `{ kind: "generated", id: "draft-citypack-generator" }`
- `{ kind: "routing_config", id: "barcelona-area-model" }`

Provider-owned text remains provider-owned. Parranda-owned fields include
`tags`, `vibes`, `time_fit`, `route_roles`, `confidence`, and trust decisions.

Preferred v1 `source.kind` vocabulary:

- `city_catalog`: curated/manual city catalog entries.
- `live_event_feed`: already-fetched official/live event records.
- `map_search`: future external map/search results.
- `generated`: future inferred or semi-automatic draft candidates.
- `routing_config`: structural anchors and area presets from city routing config.

The contract currently documents and tests this vocabulary but does not reject
other `source.kind` strings. Strict validation should wait until the provider
set is larger and real consumers prove the boundary.

## Migration Path

Recommended next steps:

1. Wrap existing city catalog items as `PlaceCandidate[]`.
2. Add a `CuratedCatalogProvider` compatibility layer.
3. Pin provider async/context strategy before adding live-event candidates.
4. Let Blitz consume candidates behind its current catalog behavior.
5. Let Planner consume candidates behind its current route-template behavior.
6. Add live-event and generated/search providers only after diagnostics prove
   the engine can handle them safely.

The contract exists so the future route engine can become provider-first
without losing the safety and taste already present in curated city packs.

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

This provider is a compatibility layer only. It does not change Planner, Blitz,
route scoring, UI, public API responses, or data sources.

## Candidate Provider Registry

`server/place-candidates/provider-registry.js` adds the internal collection
layer:

```text
CityConfig -> CandidateProviderRegistry -> PlaceCandidate[]
```

The default registry currently enables only `CuratedCatalogProvider`. It can
collect candidates for a city and return a diagnostic summary with:

- total candidates
- real place count
- structural candidate count
- counts by `candidate_kind`
- counts by trust tier
- counts by provider

This registry is intentionally internal. Planner, Blitz, route scoring, UI, and
public API responses still use their existing paths until later migration PRs.

## Provider Async Strategy

The registry stays synchronous for now.

Future providers may need async data, but `CandidateProviderRegistry` should not
fetch inside provider calls until there is a real engine consumer that needs an
async boundary. The next live-event provider should be context-based:

```text
higher-level engine fetches live events -> context.events -> LiveEventVenueProvider -> PlaceCandidate[]
```

That means `LiveEventVenueProvider` should convert already-fetched
`context.events` into `event_venue` candidates. It should not call Open Data
BCN, Turismo Roma, or any other provider directly. This keeps readiness checks
cheap, deterministic, and safe while the candidate system is still internal.

If a later Planner or Blitz migration needs providers to fetch their own data,
the registry can become async in that PR with a real consumer and tests. Until
then, readiness and collection remain sync by design.

## Live Event Venue Provider

`server/place-candidates/live-event-venue-provider.js` prepares official/live
event venues as future candidate inputs:

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

The provider is available for future engine work but is not default-enabled in
`CandidateProviderRegistry` yet. The default registry still contains only the
curated catalog provider, so this PR does not change Planner, Blitz, routing,
UI, public API responses, or readiness behavior.

## Candidate Readiness Diagnostics

`server/place-candidates/readiness.js` adds an internal diagnostic layer:

```text
CityConfig -> CandidateProviderRegistry -> assessCityCandidateReadiness()
```

It answers whether the current candidate pool looks safe enough for future
engine consumption. V1 is deliberately conservative and uses only the current
curated catalog provider.

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

These diagnostics do not change Planner, Blitz, routing, UI, or public API
behavior. They exist so later PRs can decide when it is safe to consume
candidate providers.
