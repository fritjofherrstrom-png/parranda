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
    kind: "catalog",
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

- `{ kind: "catalog", id: "rome-catalog" }`
- `{ kind: "live_feed", id: "barcelona-open-data-agenda" }`
- `{ kind: "map_search", label: "future provider" }`
- `{ kind: "routing_config", id: "barcelona-area-model" }`

Provider-owned text remains provider-owned. Parranda-owned fields include
`tags`, `vibes`, `time_fit`, `route_roles`, `confidence`, and trust decisions.

## Migration Path

Recommended next steps:

1. Wrap existing city catalog items as `PlaceCandidate[]`.
2. Add a `CuratedCatalogProvider` compatibility layer.
3. Let Blitz consume candidates behind its current catalog behavior.
4. Let Planner consume candidates behind its current route-template behavior.
5. Add live-event and generated/search providers only after diagnostics prove
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
