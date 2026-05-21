# RouteCandidate Contract

`RouteCandidate` is the next engine foundation contract after
`PlaceCandidate`. It describes a possible route before Planner, Blitz, or the
UI turn that route into user-facing copy.

This PR only defines the contract. It does not connect route candidates to
Planner, Blitz, route scoring, Pulse, UI, sources, or public API responses.

## Where It Fits

The intended engine flow is:

```text
CandidateProviderRegistry -> PlaceCandidate[] -> RouteCandidate[] -> Planner / Blitz
```

`PlaceCandidate` answers "what possible places, venues, generated places, or
structural anchors can this city reason about?"

`RouteCandidate` answers "what possible ordered route can be built from those
candidates, with what confidence, source mix, shape, and limitations?"

## What It Represents

A `RouteCandidate` can represent:

- a route derived from a curated city route template
- a route assembled from provider candidates
- a live-assisted route that uses official event context
- a generated or inferred route draft
- a fallback route when data is too thin
- a compact Blitz move such as a mini-route or nearby move

The contract is intentionally neutral. It does not assume Rome, Barcelona, or a
city pack. City packs can improve route quality, but they should not be the only
way to produce a route candidate.

## Required Shape

Normalized route candidates include:

```js
{
  id: "barcelona-provider-arc",
  city: "barcelona",
  route_shape: "arc",
  stops: [
    {
      candidate_id: "mercat-sant-antoni",
      stop_kind: "user_stop",
      is_user_facing: true,
      label: "Mercat de Sant Antoni",
      candidate_kind: "real_place",
      area: "sant-antoni"
    }
  ],
  start_context: {},
  end_context: {},
  estimated_walking_km: 4.8,
  estimated_duration_minutes: 85,
  covered_intents: ["food", "bar"],
  missing_intents: [],
  area_flow: ["sant-antoni"],
  macro_flow: ["central-grid"],
  source_mix: ["candidate_provider"],
  trust_summary: {
    source_tiers: ["curated", "computed"],
    confidence: "medium",
    human_verified: true,
    freshness: "fresh"
  },
  confidence: "medium",
  explanation_inputs: {
    route_style: "food-bar-arc",
    anchors: ["Mercat de Sant Antoni"]
  },
  warnings: [],
  limitations: []
}
```

`stops` must contain at least one stop. A stop can reference a
`PlaceCandidate` by id, carry a label, or both.

## Route Shapes

Supported `route_shape` values:

- `loop`: starts and ends in roughly the same context.
- `arc`: moves across areas or neighborhoods.
- `mini_route`: compact route suitable for a short Blitz or light plan.
- `nearby_move`: one small next move rather than a full route.
- `fallback`: honest fallback route when support is thin.

## Source Mix

Supported `source_mix` values:

- `curated_template`: derived from a city route template.
- `candidate_provider`: assembled from `PlaceCandidate` providers.
- `live_assisted`: influenced by official/live event context.
- `generated`: generated or inferred route draft.
- `fallback`: safe baseline route when richer data is unavailable.

The source mix is not user copy. It is diagnostic input for engine trust,
readiness, and later localized explanations.

## Structural Stops

Some route candidates need structural anchors or area presets. Those can help
the engine shape an arc, but they must not appear as normal user-facing stops.

Structural stops must use:

```js
{
  candidate_id: "gracia-route-anchor",
  candidate_kind: "structural_anchor",
  stop_kind: "route_structure",
  is_user_facing: false
}
```

If a structural candidate is marked as a normal `user_stop`, validation fails.
This keeps route scaffolding separate from real places, venues, and event
locations.

## Trust And Confidence

Each route candidate carries a `trust_summary`:

- `source_tiers`: route-level summary of the underlying source tiers.
- `confidence`: `high`, `medium`, `low`, or `needs_review`.
- `human_verified`: whether the route pattern has human/editorial review.
- `freshness`: route freshness, usually inherited from underlying candidates.

Route-level confidence should be no stronger than the weakest important input.
A fallback route should use lower confidence and explicit warnings or
limitations.

## Explanation Inputs

`explanation_inputs` are not final copy. They are structured ingredients for
future localized prose, such as:

- route style
- anchor labels
- area flow
- strongest intent match
- missing intents
- caution or limitation flags

Keeping this structured lets Planner and Blitz explain the route later without
embedding English or Swedish prose in the engine layer.

## Migration Path

Recommended next steps:

1. Keep the existing route engine behavior unchanged.
2. Add adapters that can describe current route templates as `RouteCandidate`
   records for diagnostics.
3. Add an internal `inspect-route-candidates` tool once route candidate
   providers exist.
4. Let Blitz consume route candidates behind its current behavior.
5. Let Planner consume route candidates behind its current route-template
   behavior.
6. Move route construction from catalog/template-first to
   candidate-provider-first only after diagnostics prove the boundary.

The contract exists so future routing can become provider-first without losing
the safety, trust metadata, and city-specific taste already present in curated
city packs.
