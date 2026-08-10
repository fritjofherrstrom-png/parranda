# Local Live Intelligence

**Status:** Working product/engine principle  
**Related:** `docs/CANDIDATE_INTELLIGENCE_MIGRATION.md`, `docs/CANDIDATE_PREFERENCE_COVERAGE.md`

Parranda's agnostic engine must not only find stable places. It must understand what is happening locally now, tonight, this weekend, and during the user's stay.

This matters especially outside obvious large-city tourist contexts. In places like Österlen or Felanitx/Mallorca, the best experience is often not a permanent top-list place. It can be a temporary event, a local market, a flea market, a village tradition, a local holiday, a seasonal opening, or a small community signal that normal guide apps miss.

## Core principle

```txt
Parranda should understand local rhythm, not only local inventory.
```

The engine should be able to combine:

- stable places
- temporary events
- recurring local patterns
- trusted local media
- official calendars
- community/social signals where source policy allows it
- weather
- time of day
- local customs and closures
- user preferences
- saved user intent

and turn that into a useful now/next/this-week decision.

## Österlen proof point

Österlen is a strong test case because much of the value is local, seasonal, distributed, and easy for generic map/review apps to miss.

Important source families may include:

- local magazines and editorial calendars, for example Österlenmagasinet-style sources
- municipal and tourism event calendars
- flea market / loppis listings
- farm shops and seasonal producers
- galleries and vernissage listings
- small venue calendars
- village events
- public community posts or groups where source policy allows it
- recurring summer and weekend patterns

Candidate types/signals to preserve:

- loppis / flea markets
- vintage / second hand
- farm shops / gårdsbutiker
- markets
- small concerts
- vernissages
- seasonal cafés
- popups
- beach/weather-dependent options
- local festivals
- temporary opening hours

The engine should answer questions like:

```txt
I am near Borrby this Saturday. What is actually worth doing now or this afternoon?
```

or:

```txt
I like second hand and local oddities. What is happening around Österlen this weekend?
```

A generic answer with only famous static places is a failure mode. A good answer can mix classics like Stenshuvud/Ales stenar with live local signals if the moment and preferences make that right.

## Felanitx / Mallorca proof point

Felanitx and Mallorca represent a similar requirement in a different cultural context.

The engine must understand that local life is shaped by:

- festivos / public holidays
- local fiestas and village traditions
- weekly markets
- seasonal events
- religious/cultural calendars
- summer opening patterns
- siesta or midday closure rhythms where relevant
- island/local mobility constraints
- traditions and local phenomena that may not be obvious on generic top lists

Important nuance:

```txt
Local customs must be modeled as local rhythm signals, not hard-coded country stereotypes.
```

For example, siesta-like closure patterns may be relevant in some Spanish/Mallorcan contexts and less relevant in parts of Barcelona or in specific modern/tourist-heavy areas. The engine should learn/apply this at city/area/source-confidence level, not globally assume it for all of Spain.

## Source handling

Local live sources should feed the Candidate Intelligence Spine through explicit evidence and provenance.

A source post or article is not automatically truth. It is evidence.

Possible source tiers:

```txt
official_calendar       // municipality, tourism board, venue calendar
trusted_local_media     // local magazines/editorial calendars
venue_owned             // venue/farm shop/gallery's own page
community_signal        // public group/post/listing where source policy allows
user_tip                // user-submitted local intelligence
inferred_pattern        // recurring market/seasonal pattern inferred from data
```

Evidence should capture:

```txt
what is claimed
where it happens
when it happens
who says it
how fresh it is
whether it repeats
whether place/time are reliable
what preference tags it covers
```

Weak social/community hints should remain lower-confidence until corroborated by stronger evidence such as venue pages, official calendars, multiple source families, or reliable historical recurrence.

## Time horizons

Parranda should support multiple local live windows:

```txt
now
this afternoon
tonight
tomorrow
this weekend
next 7 days
custom trip window
```

This is important because the user may not only ask “what now?” They may want to plan a week, save ideas, or build a route around an event that only happens once.

## Parranda Almanac / saved activities

Local live intelligence becomes much stronger when users can save events, places, and activity ideas.

Future saved objects may include:

- saved places
- saved events
- saved routes
- saved day ideas
- maybe-later candidates
- recurring local favorites
- trip-window activities

Working name:

```txt
Parranda Almanac
```

The Almanac should not be passive only. The engine should be able to use it:

```txt
You saved a flea market in Skillinge. It is open today 11-15. Want to build the day around it?
```

or:

```txt
You saved a Felanitx market. It overlaps your morning window, but a local holiday may affect opening hours. Verify before anchoring the route.
```

## Engine implications

Local live intelligence requires the candidate spine to support:

- event candidates as first-class objects
- recurring/seasonal candidates
- source family provenance
- time-window filtering
- freshness and expiry
- local closure/custom rhythm signals
- saved user intent
- preference coverage (`covered_preferences` / `missing_preferences`)
- honest confidence explanations
- inspect mode for why an event/place was shown or hidden

## Source graph v1

`server/pulse-sources/local-live-source-graph.js` is the first repository
contract for this idea. It does not fetch, scrape, render UI, or make events
route stops. It evaluates the live-source coverage around a place/time window:

- which source families are runtime-covered;
- which are missing;
- which are only needs-review;
- which community/social hints need corroboration;
- which local-language terms should be used next.

The graph reports acquisition readiness only. `can_collect_pulse_candidates`
and `can_evaluate_route_salience` mean the source mix is broad enough for later
event evaluation; they do not claim that a current event exists. Event-level
timing and corroboration remain downstream gates.

`server/pulse-sources/event-fusion.js` provides the first conservative
event-evidence fusion gate. It only joins cross-publisher rows when title,
start time, and venue or nearby coordinates agree. It keeps compact
`sources[]`, field provenance, publisher independence, and conflicts. A title
alone is never enough, and two adapters from the same publisher do not become
two independent confirmations.

This matters because local live quality is not only "did we find an event?"
Parranda also needs to know whether it has broad enough source-family coverage
to trust that it is not missing the important local rhythm.

## Immediate next acquisition step

This note does not mean the next PR should scrape every local source.

Do not jump straight into broad scraping or fragile social-source ingestion.

The correct sequence is now:

```txt
local source graph
→ event evidence fusion
→ bounded multi-source acquisition around the resolved anchor
→ Pulse salience and later route eligibility
```

Acquisition should still be bounded, cached, terms-aware, and fail-soft. Event
fusion improves the trust interpretation of collected evidence; it does not
create missing coverage or justify unbounded scraping.

## Bounded anchor acquisition v1

`server/place-candidates/anchor-event-acquisition.js` and
`agnostic-event-supply.js` now implement the first runtime step after fusion:

- start only from a resolver-attested coordinate anchor;
- select at most four already-approved sources (up to three bbox-scoped local
  feeds plus one key-gated global family);
- run the selected sources concurrently in the background-warm cache path;
- normalize and fuse occurrence evidence before salience ranking;
- reject explicit coordinates outside the requested radius;
- reject coordinate-less occurrences unless another matching source contributes
  in-radius geometry;
- preserve per-source status and compact acquisition/rejection summaries.

This is not runtime web discovery. Public request data cannot add providers, and
the engine does not crawl arbitrary pages per user request. Source discovery and
terms review remain upstream; acquisition consumes only the approved env/server
registry. This distinction keeps the network fan-out bounded while allowing
independent source families to corroborate the same local happening.

The next coverage work is to add reviewed source rows/adapters and source-health
telemetry, not to weaken the anchor or geometry gates.

## Runtime source-health snapshot

The bounded acquisition path now distinguishes provider outcomes before it
interprets event absence:

```txt
ok          source returned usable event rows
empty       source responded successfully with no usable rows
failed      source call or payload failed
unavailable source could not run because a required trusted input was absent
```

`acquisition.source_health` summarizes only the current bounded collection. It
is not a historical uptime score and does not claim comprehensive local
coverage. A `healthy` + `empty` snapshot means the selected sources answered but
had no current bounded events; `partial` means at least one selected source
answered and at least one did not; `unavailable` means selected sources could
not answer. `uncovered` means no approved source covered the anchor, while
`pending` means the bounded background refresh has started but not completed.
This keeps "nothing found" separate from "we could not check" without exposing
provider payloads, endpoints, or credentials.

The snapshot remains additive, fail-soft, and route-independent. It does not
change event salience, source selection, Pulse cards, or route eligibility.

## Preference fit without a filter bubble

Live highlights are preference-shaped, not preference-filtered. Requested
interests can lift matching events, while one bounded highlight slot may be
reserved for a strong, non-administrative local happening that the user did not
explicitly ask for. That discovery row has already passed the same source,
timing, geometry and display gates as every other event; weak or civic/admin
noise cannot use the slot. The displaced preference match remains available in
the capped browse list, and the rule never changes route composition.

## Product bar

Parranda should eventually feel like:

```txt
It notices the small things happening locally that I would otherwise miss.
```

That is a major product advantage over static city guides, generic review apps, and top-10 travel lists.
