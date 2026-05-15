# Barcelona Citypack Readiness Audit

## Summary

This audit follows GitHub issue #40: citypacks should enhance Parranda, not be required for it to be useful. The product should degrade from curated citypack to API/live fallback to basic nearby planning without pretending that missing curated content exists.

Barcelona should become a real private beta citypack, but not by borrowing Rome content or by shipping a tourist top-10 shell. The next implementation should first make Barcelona a real registry city with honest empty/noop curated layers. Real Barcelona content should follow only after the city-owned structure is in place.

## Current City Architecture

- City registry lives in `server/cities/index.js`. Today it registers `rome` and `test-city`; unknown public city paths, including `/barcelona`, resolve through Rome with `fallbackUsed: true`.
- City contract lives in `server/cities/contract.js`. A registry city needs key, label, timezone, locale, currency, center, `todayIsoDate`, catalog, services, walking config, routing config, and optional local-truth rules.
- Rome is split into `server/cities/rome.js` plus `server/cities/rome/*`, but much of the legacy data still lives in root-level modules such as `server/catalog.js`, `server/editorial-calendar.js`, and `server/live-events.js`.
- Test City is a real internal city registered in `server/cities/test-city/index.js`. It proves that city-core can work with noop editorial/live services and a small test catalog.
- Shell routing is handled in `server/app.js`. `resolveShellMode()` maps internal cities to `internal-preview`, unknown requested cities to `fallback-preview`, and real public cities to `curated-public`.
- Frontend bootstrap data is injected through `window.__PARRANDA_CITY__`, including `key`, `label`, `displayLabel`, `visibility`, `timezone`, `locale`, `currency`, `searchLabel`, `requestedKey`, `fallbackUsed`, and `lang`.
- Frontend mode is currently gated by `hasRomeFrontendContent = isCuratedPublicMode && plannerCityKey === "rome"`. This is the main frontend blocker for future curated citypacks.

## Current Content Layers

- District content: frontend-only Rome data in `script.js` via `romeDistrictGuides` and `romeDistrictGuideLocalizedContent`.
- Fallback route cards: frontend-only Rome data in `script.js` via `romeRoutes` and `romeRouteLocalizedContent`.
- Planner district catalog: frontend-only Rome data in `script.js` via `romePlannerDistrictCatalog`.
- Place catalog and route templates: server-side Rome catalog lives in `server/catalog.js`, re-exported through `server/cities/rome/catalog.js`.
- Pulse/editorial content: Rome Pulse lives mostly in `server/editorial-calendar.js`, exposed by `server/cities/rome/editorial.js`.
- Live/event content: generic live-event fetch and matching are in `server/live-events.js`; Rome wires it through `server/cities/rome/live.js`.
- Weather: generic weather fetch lives in `server/weather.js`; Rome binds timezone/center in `server/cities/rome/weather.js`.
- Geocoding: generic builder lives in `server/geocoding.js`; Rome binds catalog/search labels in `server/cities/rome/geocoding.js`.
- Local truth: Rome local-truth rules live in `server/cities/rome/local-truth.js`; the route engine reads them through the active city config.
- Route-result prose: mostly in `server/route-engine.js`, now language-aware for generic prose but still driven by active city catalog, tags, route templates, live events, and local-truth data.
- Planner/shell UI: keyed i18n lives in `server/ui-i18n.js`; frontend client copy is mostly in `script.js`.

## Citypack Contract

### Required for a real registry city

- `server/cities/<city>/index.js` exports a valid city config.
- Required metadata: `key`, `label`, `timezone`, `locale`, `currency`, `center`, `searchLabel`, `editorialAreaLabel`, `fallbackLabel`, and `todayIsoDate`.
- Required catalog shape: `routeTemplates`, `allItems`, and `findItemByName`, even if empty/noop at first.
- Required services: `geocodeQuery`, `fetchWeatherForDates`, `getCityPulse`, `getDateSignals`, and `fetchLiveEventsForDates`.
- Required routing shape: `areaDefinitions`, `macroAreaLabels`, and `tuning`.
- Required walking config: `defaultProvider`, `truthPassTopCandidates`, `requestTimeoutMs`.
- Required product state: an honest visibility/status that distinguishes city-core from curated content.

### Optional for a partial citypack

- Real catalog entries.
- Neighborhood aliases and richer area definitions.
- Local-truth rules and calendar signals.
- Pulse editorial.
- Live-event provider tuning.
- Route seeds and fallback route cards.
- Frontend district guides and planner district shortcuts.
- Localized city-owned content in `sv/en`.

### Required before curated/private-beta ready

- Researched neighborhood model and routing macros.
- Enough real places to support Planner and Blitz without thin or repetitive routes.
- Non-tourist route seeds that work for locals, repeat visitors, longer stays, evenings, days, and multi-day planning.
- Pulse/editorial layer with actual local rhythm rather than generic city copy.
- Search aliases for neighborhoods, local spellings, landmarks, and common user language.
- Localized `sv/en` city-owned content.
- No borrowed Rome districts, Rome fallback routes, Rome Pulse, or Rome curated frontend surfaces.

## Barcelona Readiness By Layer

| Layer | Current state | Needed for Barcelona | Classification |
| --- | --- | --- | --- |
| City config | Barcelona currently falls back to Rome | Add real `barcelona` registry config with noop-safe services | global fallback |
| Shell/meta | Preview shell exists through fallback mode | Resolve `/barcelona` as Barcelona city-core, not Rome fallback | global fallback |
| Catalog | Rome catalog only, Test City fixture | Empty/noop first, then researched Barcelona places | partial citypack |
| Route templates | Rome templates in server catalog | Defer until catalog has enough real Barcelona places | full curated citypack |
| Frontend districts | Rome-only `romeDistrictGuides` | Make city-owned frontend content possible, then add Barcelona neighborhoods | partial citypack |
| Fallback route cards | Rome-only `romeRoutes` | Defer until real Barcelona catalog and routes exist | full curated citypack |
| Planner district shortcuts | Rome-only `romePlannerDistrictCatalog` | Add Barcelona neighborhood model after skeleton | partial citypack |
| Pulse/editorial | Rome Pulse plus noop Test City | Start noop/honest, add Barcelona rhythm later | full curated citypack |
| Live/events | Generic source, Rome geocode context | Keep generic provider behavior; avoid Barcelona-specific claims until verified | global fallback |
| Geocoding/search | Generic builder supports injected city labels | Add Barcelona search label/country and later aliases | global fallback |
| Local truth | Rome-specific rules | Defer until Barcelona weekly rhythms are researched | full curated citypack |
| Weather | Generic weather with city center/timezone | Works once Barcelona center/timezone exists | global fallback |
| Route-result prose | Generic prose localized; content from city data | Safe if route engine receives Barcelona catalog instead of Rome | global fallback |

## Barcelona Content Model

Barcelona should be organized around neighborhoods and rhythm, not landmark checklists.

Recommended initial zones to evaluate:

- Gracia: local evenings, plazas, independent shops, casual bars, repeat-visitor energy.
- El Born / Sant Pere / Santa Caterina: culture, food, design, late-but-not-club rhythm.
- Gothic Quarter: useful only if handled carefully; avoid generic old-town tourism.
- Eixample: architecture, food, bars, shopping connectors, broad walking grid.
- Sant Antoni: food, market, bars, book/vintage edges, strong local day-to-evening bridge.
- Poble-sec: bars, theater, Montjuic edge, evening routes.
- Poblenou: beach-adjacent but not only beach; design, food, industrial streets, evening drift.
- Barceloneta: coast/seafood/beach flow, but avoid postcard-only routes.
- Raval: culture, bars, edge, markets; needs careful curation.
- Montjuic: views, museums, park walking, good for arcs rather than isolated stops.
- Sants / Les Corts: include only if they help real route flow or local use cases.

Minimum private beta content shape:

- Neighborhood model with aliases, macro areas, and planner-visible labels.
- Core place catalog covering food, bars, vintage/second hand, markets, culture, views, beach/coast, nightlife, and walking connectors.
- Route seeds only after catalog density is good enough to avoid tourist top-10 routes.
- Pulse/editorial only after Barcelona-specific rhythm is researched: late meals, market days, beach/coast timing, neighborhood nightlife, and weekday/weekend differences.

## Rome Assumptions To Remove Or Contain

- `hasRomeFrontendContent` currently makes frontend curated content a Rome-only binary.
- `getFrontendPlaces()`, `getFrontendDistrictGuides()`, `getFrontendPlannerDistrictCatalog()`, and `getFrontendFallbackRoutes()` return Rome content or nothing; they do not yet read city-owned frontend content.
- `buildRomeFallbackCityPulse()` is frontend Rome-specific fallback Pulse.
- `romeRouteTemplate` and several variable names are Rome-shaped even where they render generic route cards.
- Server fallback for unknown cities currently resolves to Rome. This is honest in shell copy, but Barcelona should stop being an unknown city before curated content is added.
- `server/catalog.js` remains Rome content at the root level, even though `server/cities/rome/catalog.js` wraps it.
- Some generic fallback strings still mention Rome-based fallback content in explanatory copy; they are safe for preview but should not become Barcelona curated copy.

## Recommended PR Sequence

1. `Barcelona citypack skeleton + honest beta shell`
   - Add `server/cities/barcelona` with real city metadata, empty/noop catalog fixtures, geocoding/weather/noop editorial/noop live services, walking config, routing shape, and honest visibility.
   - Register Barcelona as a real city without marking it curated.

2. `Barcelona neighborhoods model`
   - Add Barcelona area definitions, macro labels, aliases, and planner district catalog structure.
   - Start moving frontend curated content lookup from Rome-only globals toward city-owned content.

3. `Barcelona core place catalog`
   - Add researched private-beta places with stable IDs, tags, areas, coordinates, search terms, and local quality notes.
   - Keep engine behavior unchanged unless the data reveals a real generic gap.

4. `Barcelona route seeds/fallback cards`
   - Add first route seeds only after the catalog supports them.
   - Avoid tourist top-10 loops and overfitting to landmark routes.

5. `Barcelona Pulse/editorial layer`
   - Add local rhythm once neighborhood and catalog context exist.
   - Keep live/provider content distinct from Parranda editorial.

6. `Global-mode fallback improvements`
   - Improve basic nearby planning, API/live fallback, and UI indication for generated vs curated vs missing content.

## Recommended First Implementation PR

Start with `Barcelona citypack skeleton + honest beta shell`.

Acceptance:

- `/barcelona?lang=sv` and `/barcelona?lang=en` resolve to city key `barcelona`, not Rome fallback.
- Barcelona shell says city-core is active and curated content is not ready.
- Planner, Blitz, and Pulse do not show Rome districts, Rome fallback routes, Rome Pulse, or fake Barcelona curated content.
- `/api/places/search?city=barcelona...` does not return Rome curated places unless explicitly marked as global fallback behavior.
- `/api/route-recommendations` for Barcelona does not use Rome fallback routes/cards as if they were Barcelona content.
- Any fallback/noop response is clearly marked as fallback, noop, preview, or not-curated.
- `/rome` remains unchanged and `/test-city` remains internal preview.

Implementation notes:

- Prefer empty/noop contract fixtures over fake Barcelona data.
- If a tiny fixture is required for contract tests, mark it internal/test-only and do not surface it as curated Barcelona content.
- Do not add route seeds, district prose, Pulse prose, or real place data in PR A.

## Research Needed Before Real Barcelona Data

- Neighborhood boundaries and aliases users actually type.
- Local walking flows between adjacent areas, especially Gracia/Eixample, Sant Antoni/Poble-sec, Born/Gothic/Raval, Poblenou/Barceloneta, and Montjuic edges.
- Food and bar anchors that locals/repeat visitors would not dismiss as generic.
- Vintage, second hand, markets, and weekday sensitivity.
- Beach/coast timing and when it helps the day instead of flattening it.
- Nightlife nuance by area: casual bars, late bars, clubs, live music, and when to avoid over-programming.
- English and Swedish content tone that avoids tourist-package language.

## Risks And Blockers

- Empty Barcelona catalog may expose assumptions that a real city always has route templates or places.
- Server can support city configs better than the frontend; frontend curated surfaces still need city-owned content lookup.
- Unknown-city fallback to Rome is useful for legacy preview, but Barcelona needs its own registered non-curated state.
- Adding real Barcelona content too early risks making the shell look launched before route quality is credible.
- Global fallback behavior is still underdefined; PR A should be honest about noop/preview responses instead of solving global mode fully.
