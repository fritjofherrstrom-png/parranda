# Keyless global live-events: investigation record (2026-07-12)

**Question:** can Parranda get "what's on tonight / this week" for an ARBITRARY
world coordinate from a source that needs no API key — so live events light up
everywhere without a vendor dependency?

**Answer: not today.** Every keyless candidate was probed live and fails the
coverage bar. This document records the evidence so the decision is not
re-litigated from vibes, and states the gates a future keyless source must pass.

The engine seam is ready either way: `agnostic-event-supply.js` resolves event
families generically (municipal open feed where configured → global provider →
honest absence), so a new family is one provider + one branch, never city code.

## Method

Live probes (curl/fetch, 2026-07-12) against real endpoints, anchored on
arbitrary fixture cities (Lyon, Malmö, Berlin, Paris, NYC — fixtures proving
generic behavior, not product targets). No candidate was accepted or rejected on
reputation; each was measured.

## Candidates and evidence

### 1. Venue-website schema.org/Event markup — DEAD END (yield ≈ 0)

Idea: the route's own OSM-sourced venues carry `website` tags; fetch those pages
and extract schema.org/Event JSON-LD. Coordinate-driven, keyless, and the
JSON-LD parser already exists (`schema-org-event-provider.js`, #282).

Measured: OSM website-tag density is fine (Lyon 40% of venues; Berlin 35/40
eventful venues). But **0 of 34 sampled venue landing pages carried Event
JSON-LD** — including major houses (Komische Oper, Deutsches Theater, Malmö
Live). Landing pages carry LocalBusiness/Restaurant markup at best; event data
sits behind per-site program pages → a crawler with high parsing risk and
per-anchor fan-out latency. Fails machine-readability at acceptable cost.

### 2. Mobilizon federation (per-instance GraphQL) — REAL BUT TOO THIN

Keyless GraphQL `searchEvents(location: <geohash>, radius)` works on instances
(probed mobilizon.fr). Coverage near anchors: **Lyon 8, Malmö 0, Berlin 1**
upcoming events — mostly community/activist listings weeks out; "tonight" yield
≈ 0. Querying the federation instance-by-instance would need an instance
registry = region rows, the exact per-region shape the product rejected.

### 3. Mobilizon global search index — STALE/DEAD

`search.joinmobilizon.org/api/v1/search/events?latlon=LAT:LNG&distance=…` works
keylessly and is truly global — but the index is unmaintained: Lyon returns 102
events, **all from 2020–21**; `startDateMin=today` returns **0 for Lyon (100 km),
Paris and Berlin**. A dead index is worse than absence: it would fabricate a
"covered" feeling with nothing live behind it.

### 4. Other aggregators (Eventbrite, Bandsintown, Songkick, PredictHQ, …)

All key-gated (free tiers exist, but that is option "key", not option
"keyless"). Ticketmaster is already built as the key-gated global family (#343).

## Verdict

| Path | Keyless | Coordinate-driven | Live coverage | Status |
|---|---|---|---|---|
| Venue-site schema.org | yes | yes | 0/34 pages | rejected (measured) |
| Mobilizon instances | yes | yes | ~0 "tonight" | rejected for now (thin + registry shape) |
| Mobilizon global index | yes | yes | stale (2020–21) | rejected (dead) |
| Ticketmaster global (#343) | no (free key) | yes | dense | **built, awaiting key** |
| Municipal open feeds | yes | bbox data rows | rich where present | built, opt-in via `PARRANDA_EVENT_FEEDS` |

**Consequence:** global live events currently require the key-gated family. The
product stays honest everywhere ("no live-events source reaches this place yet")
until a deployment enables a real source. That absence is uniform since #347 —
no city is special.

## Gates for a future keyless source (do not re-litigate below these)

A keyless family gets built when a source passes ALL of:

1. **Coordinate-driven:** query by lat/lng+radius (or equivalent), no per-city
   registry as the primary shape.
2. **Alive:** returns events starting within the next 7 days near ≥3 arbitrary
   probe cities on ≥2 continents, measured on the day of the decision.
3. **Machine-readable:** stable JSON/feed contract, no per-site scraping.
4. **License/attribution:** listable with attribution + outbound link.
5. **Fail-closed:** absence/timeout degrades to honest `uncovered`/empty, never
   fabricated coverage.

Candidates worth re-probing later: Mobilizon (if the search index is revived or
federation coverage grows), openly licensed national tourism feeds exposed
without keys, schema.org markup IF a public crawl index (e.g. a Common
Crawl-derived event dataset) becomes queryable by coordinate.
