# Barcelona Live / Pulse Quality Pass V1

PR context: Barcelona now has Open Data BCN / Guia BCN wired as its first official Live source. This pass checks whether that source is useful enough for Parranda-style city rhythm before adding a second source.

## Findings

- Open Data BCN is a good official baseline because it is structured, city-scoped, geocoded, and source-owned.
- The feed is very broad. A live probe for 2026-05-17 found more than 1,000 active records, including courses, exhibitions, schoolyard/family infrastructure, talks, recurring activities, and concerts.
- The raw feed order is not enough for Pulse. Without filtering, the first official items can skew toward broad civic listings or long-running items rather than things that feel useful as live city rhythm.
- Coordinates are reliable when present. The provider exposes `location_4326` as `[lat, lng]` and `location_4326_latlon` as `[lng, lat]`.
- Barcelona Pulse should continue to show city-core preview copy and official Live items only. It should not invent editorial moments, wildcards, or curated Pulse prose yet.

## Quality Filter V1

The adapter now keeps filtering internal to the source layer. It does not add public diagnostics fields.

Accepted records must be published events with a title and start date. Records are scored higher when they are short-window or fresh, route-useful, and category/tag-rich. Records are scored lower when they look like long-running background listings, generic categories, administrative listings, or family-infrastructure noise such as schoolyard openings.

Tag inference now separates useful source signals more clearly:

- `kultur`
- `music`
- `exhibition`
- `workshop`
- `market`
- `mat`
- `vin`
- `nattliv`
- `coast`
- `family`
- `community`
- `civic`

These tags remain simple source-derived metadata. They are not editorial Pulse prose.

## Deferred

- A second official Barcelona source should wait until Open Data BCN quality is observed over more dates.
- Rich Barcelona editorial Pulse remains deferred.
- Provider category translation remains source-owned unless it becomes visible chrome.
- More advanced diagnostics can be added later if we need source QA dashboards or admin-only debug output.

## Recommendation

Keep Open Data BCN as the only active Barcelona Live source for now. Next, do a small Pulse presentation polish pass or observe several date samples before wiring a second source such as a market/civic-center feed.
