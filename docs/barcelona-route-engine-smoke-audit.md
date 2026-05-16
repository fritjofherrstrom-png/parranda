# Barcelona Route Engine Smoke Audit

## Summary

Barcelona now has a real pilot catalog, but it is still a preview city with no route templates, fallback route cards, or curated route layer.

The current production API correctly returns the existing preview/noop shape for Barcelona route recommendations:

- `city: "barcelona"`
- `days: []`
- `resolved_home_base: null`
- `resolved_start: null`
- `resolved_end: null`
- `city_fallback_used: false`

This means `/api/route-recommendations` does not yet generate Barcelona route days, even though the catalog is no longer empty.

## Current Gate

The blocking production gate is in `server/app.js`:

`shouldReturnPreviewRouteNoop(cityConfig)`

It returns noop for preview cities when either:

- `catalog.routeTemplates.length === 0`
- `catalog.allItems.length === 0`

After PR #50, Barcelona has `26` catalog places but still has `0` route templates. Therefore the current gate is:

`visibility: "preview"` + non-empty catalog + empty route templates.

## Direct Route Engine Probe

A test-only direct probe of `generateRecommendations({ city: "barcelona" })` bypasses the app-layer preview/noop gate.

That probe currently fails before producing a route because `getRouteTemplates()` returns an empty array. The engine then has no ranked entries, no primary route, and later tries to read `primary.route`.

So the route engine is not yet ready to generate useful Barcelona days from catalog-only data.

## Scenario Findings

The requested smoke scenarios are all blocked by the same route-template gap:

- 1-day broad interests: food + culture
- 1-day food + bars/nightlife
- 2-day mixed culture + food + coast
- Sant Antoni / Eixample-focused start
- Gracia-focused start

Because the route engine does not currently support template-free city generation for Barcelona, none of these scenarios can produce meaningful stop-count, repetition, or area-quality findings yet.

## What We Can Still Learn

Useful tags already present in the Barcelona pilot catalog:

- `mat`
- `vin`
- `nattliv`
- `kultur`
- `utsikt`
- `market`
- `second_hand`
- `shopping`
- `vintage`
- `cocktail`
- `low-key`
- `hidden gems`

Likely weak or under-tested intents at this stage:

- nightlife is present, but route quality cannot be judged without seeds
- coast is represented, but mostly through a single beach/coast area
- second hand/vintage has a strong market backbone, but still needs more shop density later
- Sants / Les Corts has no catalog coverage yet, by design

Catalog density is enough to test search and area mapping, but not enough to trust automatic template-free route construction.

## Citypack Route-Readiness Checklist

Before a citypack should be allowed to generate curated route days, check:

1. City is registered and does not borrow another city's curated content.
2. Catalog has enough real places for the target areas and intents.
3. Every catalog place uses valid city area tokens.
4. Search can find important anchor places without fallback-city leakage.
5. Route templates or another supported route-construction strategy exist.
6. Preview/noop behavior is explicit while route generation is not ready.
7. Direct route-engine smoke tests can produce at least one primary route without crashing.
8. Generated routes have enough stops for the requested day profile.
9. Generated routes do not repeat the same area or anchor too aggressively.
10. Generated routes do not leak another city's places, prose, or fallback cards.

## Recommended Next PR

The smallest safe next implementation PR is:

`feat: add Barcelona route seeds`

That PR should add a small number of route templates built from the existing Barcelona pilot catalog, while keeping Barcelona in preview until the resulting routes are manually reviewed.

Suggested first seeds:

- Gracia local evening
- Sant Antoni / Eixample food and bar flow
- Born / Santa Caterina culture and wine
- Poble-sec / Montjuic evening arc
- Poblenou / coast drift

Do not unlock preview-city route generation globally before Barcelona has route templates. The current app-layer noop is doing useful product safety work.
