# Barcelona Open Data BCN Baseline Audit

Status: implementation planning doc

This document records the current state of Barcelona's Open Data BCN `agenda-diaria` integration.

## Verdict

The baseline is real, but currently too heavy for production confidence.

Barcelona does fetch official live events at runtime and the integration already has useful normalization, timeout, cache, quality filtering, tag inference, deduplication, and safe failure behavior. The major blocker is that it downloads the full official JSON dump on each cache cycle instead of querying the CKAN datastore for the requested date window.

Core risk:

```text
Open Data BCN agenda-diaria runtime fetch -> full JSON download -> about 225 MB per 30-minute cache cycle
```

This should be fixed before adding more event feeds such as Gencat or venue RSS sources.

## Current data path

```text
Pulse/Planner request
  -> route-engine / pulse-engine
  -> cityConfig.services.fetchLiveEventsForDates(dates, options)
  -> server/cities/barcelona/live.js
  -> fetch full Open Data BCN agenda JSON download
  -> normalize + quality filter
  -> 30-minute in-memory cache
  -> per-date overlap filter
  -> max 3 live events per date
```

The integration is therefore not just a descriptor. It is real runtime behavior.

## What is already good

- Real runtime fetch is wired through `services.fetchLiveEventsForDates`.
- The consumer layer is agnostic: route engine and Pulse call the city service, not a Barcelona-specific branch.
- There is a 12-second fetch timeout.
- There is a 30-minute memory cache.
- Concurrent requests coalesce through an in-flight promise.
- Failures return empty live-event buckets rather than breaking route generation.
- Source facts are separated from Parranda-owned interpretation.
- Normalization produces event fields such as title, date range, venue, address, lat/lng, source URL, provider category, summary, and match tags.
- Quality filtering removes a lot of low-value admin/family-infrastructure noise.
- Deduplication prevents one multi-day event from filling every day.
- Live events are sidecar data by default, not forced route stops.

## P0 problem: full dump fetch

The current implementation uses the static JSON download resource. That means the app can download and parse the full agenda corpus even when it only needs today or a short trip window.

Expected impact:

- high cold-start latency
- memory pressure on small Render instances
- 12-second timeout may abort the fetch in production
- live events may silently degrade to empty results
- adding more sources before fixing this would compound runtime fragility

## P0 implementation direction

Switch from the full JSON download to CKAN datastore search using the CSV/datastore resource.

Use a bounded date-window query:

```js
function buildAgendaSearchUrl(startDate, endDate) {
  const sql = `SELECT * FROM "877ccf66-9106-4ae2-be51-95a9f6469e4c" WHERE end_date >= '${startDate}' AND start_date <= '${endDate}' LIMIT 200`;
  return `https://opendata-ajuntament.barcelona.cat/data/api/action/datastore_search_sql?sql=${encodeURIComponent(sql)}`;
}
```

Implementation caveats:

- The datastore/CSV resource has flattened field names, not the same nested shape as the JSON download.
- Add a field-mapping shim so the existing normalizer can handle both shapes where practical.
- CSV/datastore coordinates should be simpler fields such as lat/lon rather than nested geometry.
- Keep timeout, cache, coalescing, safe failure, quality filtering, dedup, and per-day caps.
- Prefer a date-window cache key rather than one global full-corpus cache.

## P1: area resolution

The event normalizer should populate a Parranda area token when possible.

Potential methods:

1. Provider neighborhood/district lookup table.
2. Coordinate-to-area resolution using Barcelona area definitions/centroids.
3. Hybrid: provider lookup first, coordinate fallback.

Why this matters:

- Pulse can say the event belongs to a meaningful area instead of only a venue name.
- Route engine can use live events as better context for area affinity.
- Future live-assisted route logic can remain generic.

## P2: defensive stale/past event guard

Even with date-filtered CKAN queries, keep a defensive guard in the evaluator:

```js
if (endMs && endMs < Date.now() - 86400000) {
  return { accepted: false, score: 0, reasons: ["past-event"], tags };
}
```

This prevents stale historical records from surfacing if a query returns an unexpected record.

## What not to do

- Do not add Gencat, MACBA, or other event feeds before the Open Data BCN baseline is lightweight.
- Do not fetch the 225 MB JSON dump and then filter locally.
- Do not make live events become route stops by default.
- Do not add complex NLP for tag inference in this PR.
- Do not lengthen cache TTL to hide performance problems.
- Do not break the city-service boundary with Barcelona-specific branches in shared engines.

## Agnostic lesson

This integration is the right pattern for official city live sources:

```text
City-specific adapter -> normalized live event shape -> generic Pulse/route consumers
```

Open Data BCN should teach Parranda how an `official_live_baseline` works:

- city adapter owns endpoint, source field mapping, source failures, and source-specific categories
- Parranda core owns normalized signal consumption, trust/freshness, Pulse ranking, and route nudges
- live events remain contextual signals unless explicitly promoted into route candidates

This pattern should later support Athens, Rome, and future cities with different official sources but the same consumer contract.

## Recommended next Codex PR

Title:

```text
fix(barcelona): query Open Data BCN agenda by date window
```

Scope:

- replace full JSON download with CKAN datastore date-window query
- add datastore-field mapping shim
- keep existing normalization semantics as much as possible
- add end-date freshness guard
- keep live events sidecar behavior unchanged
- add tests proving no full-dump URL is used and date-window filtering works

Out of scope:

- AMB beach signal
- Gencat/MACBA sources
- route-engine continuity work
- UI changes
