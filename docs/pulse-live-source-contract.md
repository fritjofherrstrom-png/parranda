# Pulse / Live Source Contract

This contract defines how citypacks describe Pulse and Live sources before they emit real events or editorial signals.

## Core Principle

City source wiring must be city-scoped, reviewable, and failure-safe. A city without active sources should return an honest noop/preview state, not another city's data.

## Descriptor Shape

Citypacks can expose optional source metadata through `cityConfig.sources`:

```js
sources: {
  liveSources: [
    {
      id: "barcelona-open-data-agenda",
      sourceType: "official_open_data",
      sourceUrl: "https://...",
      status: "candidate",
      supportedLanguages: ["ca", "es", "en"],
      updateCadence: "daily",
      sourceOwnedFields: ["title", "venue", "address", "start_date", "end_date"],
      parrandaOwnedFields: ["route_fit", "tags_intents", "match_reason"],
      qualityFlags: ["official_city_source", "needs_quality_filter"],
      parsingRisk: "medium",
      intendedUse: "live",
    },
  ],
  pulseSources: [],
}
```

Valid `status` values:

- `candidate`: worth evaluating, not wired.
- `review-needed`: promising but needs endpoint, quality, language, or parser review.
- `active`: wired into city services and expected to emit source-owned records when available.
- `disabled`: intentionally known but not used.

Valid `intendedUse` values are `live`, `pulse`, and `both`.

## Ownership Boundary

Source-owned fields should be preserved as provider data:

- title
- venue
- address
- start/end time
- source URL
- provider category
- source language
- raw summary if supplied by the provider

Parranda-owned fields must be generated, reviewed, and localized by Parranda:

- route fit
- tags/intents
- why this matters
- match reason
- Pulse wrapper prose
- localized UI prose
- editorial grouping

Source-owned text may stay in the provider language. User-facing Parranda wrappers should respect `lang`.

## Noop And Failure Contract

Every city live service must return a stable date-keyed object:

```js
{
  "2026-05-16": []
}
```

Expected behavior:

- Provider failure returns empty arrays for requested dates.
- Invalid or missing date input returns `{}`.
- Missing sources return honest noop.
- Preview cities can stay empty without borrowing another city.
- Source adapter failures should not break `/api/city-pulse` or route generation.

## City Scope

Rome currently owns the active `turismo-roma-live` source. The root `server/live-events.js` implementation remains Rome/Turismo Roma-specific until a later adapter extraction.

Barcelona has candidate/review-only descriptors. It must not call the Turismo Roma provider or emit fake Pulse/Live content.

Future citypacks should provide their own source descriptors and adapters using this shared contract.

## Next Wiring Step

Before activating a source:

- confirm endpoint shape, rate limits, language fields, and licensing;
- add parser tests near the adapter;
- keep provider fields source-owned;
- localize Parranda-owned visible wrappers;
- prove provider failure degrades to empty/noop events.
