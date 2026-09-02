# RouteCandidate Contract

**Status:** Compatibility and diagnostic contract; not the required centerline
for new any-place composition.

**Current composition:** Source-backed `PlaceCandidate` records can reach the
ordinary route engine through the candidate spine and `agnostic_compose`.

`RouteCandidate` describes a possible route before user-facing formatting. The
route-template adapter and shadow comparison remain useful compatibility tools,
but new supply work should not build a parallel RouteCandidate pipeline around
the engine's existing composer.

## Where It Fits

The original shadow flow was:

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

## Current Role

The shadow adapter still protects route-template compatibility, identity and
lineage. It is not a prerequisite for the current any-place path, which maps
gated source-backed places into `sourceCandidates` and composes them through the
ordinary route engine. Use RouteCandidate diagnostics when reviewing template
parity or lineage; use the candidate spine, route engine and promotion gates
for new route capability.

## Current Route Template Adapter

`server/route-candidates/route-template-provider.js` is the first shadow bridge
from today's route templates into the RouteCandidate architecture:

```text
cityConfig.catalog.routeTemplates -> RouteTemplateProvider -> RouteCandidate[]
```

It uses existing city catalog data only. Template stops are resolved through the
curated catalog candidate layer so real places remain `user_stop` records and
structural anchors or area presets become `route_structure` records. Unresolved
template stops are kept visible in diagnostics with a warning instead of
crashing.

`scripts/inspect-route-candidates.js` exposes this internal view for current
cities:

```bash
node scripts/inspect-route-candidates.js barcelona
node scripts/inspect-route-candidates.js rome
```

This adapter and script do not change Planner, Blitz, route scoring, UI, public
API responses, or product behavior.

## Readiness Gate

`scripts/check-route-candidate-readiness.js` is the CI-friendly safety gate for
the current route-template-to-RouteCandidate shadow view:

```bash
node scripts/check-route-candidate-readiness.js
```

It reuses the `compareRouteCandidates` logic and requires the current baseline
cities to stay `ready`:

- Barcelona: `ready`
- Rome: `ready`
- Test City: `ready`

The gate fails if route templates and RouteCandidates drift apart, including:

- route template ids missing from RouteCandidate output
- RouteCandidate ids missing from current route templates
- unresolved template stops
- stop count mismatches
- warnings or limitations that downgrade readiness

This gate must stay green to preserve the route-template shadow contract. It is
diagnostics-only and does not gate unrelated candidate-spine composition that
already uses the route engine through a separate reviewed boundary.

## Shadow Planner Comparison

`server/planner/route-candidate-shadow.js` is a diagnostics-only compatibility
bridge. It compares an existing Planner
result against the RouteCandidate view by selected route/template id and
reports:

- selected route id and matching RouteCandidate id
- Planner stop count versus RouteCandidate user-facing/structural stop counts
- exact stop id differences: missing from Planner, extra in Planner, or order-only
  differences
- unresolved template stops
- RouteCandidate warnings and limitations
- selected-route readiness and mismatch reasons

The helper must not mutate Planner output or add fields to the public Planner
API response. Its job is to reveal whether template-backed Planner routes can
still be represented by RouteCandidates; it is not the roadmap for source-backed
composition.

## Route Identity And Lineage

Planner routes keep the existing `id` for compatibility, but route generation
also records explicit internal lineage. The lineage is attached as
non-enumerable route metadata so shadow diagnostics can read it without changing
the public Planner/API JSON shape:

- `source_template_id`: the route template that seeded the Planner route.
- `realized_route_id`: deterministic id for the actual returned stop sequence.
- `realization_kind`: machine-readable lineage category.
- `template_match_status`: `exact`, `reordered`, `realized_variant`, or
  `generated_or_unknown`.
- `template_stop_ids`: user-facing stops from the source template.
- `realized_stop_ids`: user-facing stops actually returned by Planner.
- `missing_template_stops`: template stops absent from the realized route.
- `extra_realized_stops`: realized stops that were not in the source template.

This separates "template route" from "route realized from a template" without
changing route selection or user-facing responses. A route can keep its source
template id while internally reporting that the selected stops are a realized
variant.
