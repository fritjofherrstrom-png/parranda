# Barcelona Engine Surface Audit

PR context: Barcelona now has a registered preview city, structural area model, 56 real catalog places, structural route anchors, and six route templates. This pass uses Barcelona to check the shared Planner, Blitz, Pulse, Live, and maps/export surfaces without adding more content or changing the launch state.

## Summary

- Barcelona remains `visibility: "preview"` and should not look curated-public.
- Planner route generation now works through the normal `/api/route-recommendations` path using Barcelona catalog data and route templates.
- Blitz can generate a Barcelona next move from the shared catalog-driven Blitz engine, but the preview shell still hides Blitz actions until Barcelona has a curated product surface.
- Pulse and Live remain honest noop/preview layers for Barcelona. They do not borrow Rome Pulse or fake Barcelona editorial/events.
- Route map/export output uses real Barcelona route points. Structural route anchors are allowed as internal auto-anchor inputs but must not appear as ordinary visible stops.
- The hidden legacy Rome Google Maps URL in the static shell was replaced with the existing city-aware map URL placeholder.

## Findings And Classification

| Surface | Status | Classification | Action |
| --- | --- | --- | --- |
| Planner/API routes | Generates Barcelona routes from catalog/templates, with no Rome content in route output. | Shared engine working with citypack data. | Added regression coverage for route/export city scoping and structural-anchor exclusion. |
| Structural route anchors | Useful for preview auto start/end anchoring. They are not venues. | Citypack structure with shared engine constraints. | Tests keep anchors out of search and visible route stops. |
| Maps/export | API route points are Barcelona-scoped. Static shell still carried a dormant Rome map link. | UI/presentation issue. | Replaced dormant static href with `__PARRANDA_CITY_MAP_URL__`. |
| Blitz | Server-side Blitz uses city config/catalog and works for Barcelona without Rome data. | Shared engine works; presentation contract still immature. | Added API coverage for Barcelona Blitz no-Rome/no-anchor behavior. Blitz prose localization is deferred because the preview UI does not expose Blitz actions yet. |
| Pulse | Barcelona returns noop preview Pulse from city services. | App-layer preview/noop behavior. | Existing behavior is correct; no fake Pulse added. |
| Live | Barcelona live service returns empty city-scoped events. | Source/provider contract gap, intentionally noop. | No source integration added; future Barcelona Live source discovery remains separate. |

## Citypack Engine Surface Contract

### Planner

- A route-ready citypack needs `catalog.allItems`, `catalog.routeTemplates`, `catalog.findItemByName`, routing area definitions, center coordinates, weather service, live service, and noop-safe editorial service.
- Preview cities may generate API routes once the catalog and templates exist, but the shell must still communicate preview/not-curated state.
- Structural anchors may support auto start/end and area hints, but visible `main_stops` should resolve to real catalog places or live events.

### Blitz

- Blitz should read only the active city config and catalog.
- Blitz candidate items must exclude `district` and `district-group` structural anchors.
- Preview shells can keep Blitz chrome as preview/noop until the city has a curated product surface, even if the server endpoint can generate city-scoped moves.
- User-facing Blitz prose should become language-aware before Blitz is exposed as an English Barcelona surface.

### Pulse

- A city without editorial Pulse must provide an explicit noop Pulse response through city services.
- Parranda-owned Pulse chrome/prose should be language-aware.
- Provider/source-owned titles, venue names, addresses, and summaries should remain source-owned.
- Citypacks should not borrow another city’s editorial Pulse.

### Live

- Live/event services must be city-scoped and safe to return empty arrays.
- A missing city live source should be an honest noop, not fake events and not another city’s events.
- Future citypacks should declare source/provider expectations before adding live content.

### Search And Places

- Normal place search must exclude structural route anchors.
- Search results should come from the active city catalog or a clearly marked fallback path.
- Unknown cities may still use the existing fallback-preview behavior, but registered preview cities should resolve to their own city key.

### Maps And Export

- Route map/export points should be derived from the realized route, not static Rome fallback routes.
- Export links should not include Rome waypoints for non-Rome cities.
- Static shell fallback links should use city-aware placeholders, not hardcoded Rome URLs.

## Deferred Work

- Barcelona Pulse/live source discovery: official/open sources, RSS/API/HTML feasibility, update frequency, local quality, language availability, and provider/editorial separation.
- Blitz language-awareness for English mode before public Barcelona Blitz exposure.
- Generic route-readiness diagnostics and catalog-first route generation from issue #52.
- Future city-owned frontend curated surfaces: district cards, fallback route cards, and richer city-specific Planner shortcuts.
