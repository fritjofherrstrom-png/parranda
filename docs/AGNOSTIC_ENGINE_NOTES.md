# Agnostic Engine Notes

This document captures product and engine principles for making Parranda useful beyond fully hand-curated citypacks.

Citypacks should remain an acceleration and quality layer. They should not be the hard boundary of the product. Parranda's core product promise is the engine: sourcing, weighing, combining, and presenting the right candidates for the right person, place, time, weather, energy level, and intent.

## Candidate Reservoir

A **Candidate Reservoir** is the dynamic pool of possible places, events, and context candidates that Parranda builds before composing a Blitz result or generated `Your Day`.

It sits between raw sources and route composition:

```txt
sources -> candidate reservoir -> scoring -> route/dayflow composer -> user-facing day
```

The reservoir is not the final recommendation. It is the structured input the engine can reason over.

Potential candidate sources include:

- verified Parranda catalog entries
- citypack source candidates
- external consensus signals, such as map/search ratings, review volume, Wikidata/Wikipedia, OSM, local guides, blogs, communities, official open data, or other public evidence
- live/provider events with real place/time targets
- nearby landmarks and obvious classics
- weather, time, location, and user-intent context

## External consensus is raw material, not truth

External consensus should help Parranda operate in places without deep manual curation, but it must not turn the product into a generic review app.

A highly rated place is not automatically a great Parranda stop. A famous place is not automatically too generic. An obscure place is not automatically better.

External consensus should answer:

```txt
Does public evidence suggest this place exists, matters, and is worth considering?
```

Parranda should answer:

```txt
Does this candidate fit this user, route, moment, weather, area, intent, and dayflow?
```

Every externally sourced candidate should carry provenance and confidence. For example:

```js
{
  source: "external_consensus",
  confidence: "medium",
  evidence: {
    rating: 4.7,
    rating_count: 1800,
    source_count: 3,
    source_types: ["map_search", "wikidata", "local_guide"],
    last_seen: "2026-06-03"
  },
  verified_by_parranda: false
}
```

## Context should bias, not dictate

Weather, time, live context, and user intent should bias candidate scoring. They should not become brittle hard rules.

Bad pattern:

```txt
rain -> remove all outdoor places
sun -> force viewpoints
high rating -> always include
local mode -> never include landmarks
```

Better pattern:

```txt
rain -> lower exposed outdoor candidates, raise indoor/covered candidates, keep iconic nearby options if fit is strong
sun -> raise views/coast/terraces when route rhythm supports them
high rating -> supporting evidence, not proof of route fit
local mode -> lower obvious tourist defaults, but keep them available when proximity/context makes them useful
```

The engine should use soft scoring across:

- route fit
- distance and walking envelope
- opening-hours confidence
- weather fit
- intent fit
- tourist/local lens
- evidence strength
- provenance confidence
- classicness or landmark gravity
- local relevance
- live/time relevance

## Tourist/local as an experience lens

Future Planner/Blitz behavior should support an experience lens rather than treating every user as the same type of traveler.

Possible lens values:

```txt
first_time
balanced
local
rediscover
surprise
```

This lens should affect scoring, not split the product into separate modes.

Examples:

- `first_time`: raise classics, iconic landmarks, lower-risk anchors, and obvious must-sees.
- `balanced`: mix classics with local-feeling stops.
- `local`: lower generic tourist defaults, raise neighborhoods, food, daily-life places, under-surfaced but credible candidates.
- `rediscover`: help someone see their own city with fresh eyes.
- `surprise`: allow more unusual candidates, but keep provenance and route coherence.

Example copy directions:

- "See your city like it’s new."
- "Be a tourist in your own city — without the tourist traps."
- "Rediscover your city with fresh eyes."
- "For first-timers, locals, and locals who want to feel like first-timers."

## Why this matters for agnostic Parranda

Parranda cannot manually curate every city, neighborhood, village, island, or rural destination before the product becomes useful.

The agnostic path is not to lower quality. It is to make the engine better at using mixed-confidence evidence honestly.

A useful agnostic stack should allow Parranda to work in:

- a mature citypack city like Barcelona
- a beta city like Athens
- a thin city like Naxos or Simrishamn
- a rural/nature anchor such as Stenshuvud
- a location near an obvious landmark such as Sagrada Família
- an unknown city with coordinates but no dedicated pack

In all cases, the engine should ask:

```txt
What credible candidates exist nearby?
What is the user trying to do?
What does the day/weather/time suggest?
What route shape makes sense?
Which candidates are verified, inferred, consensus-backed, or weak?
What should be shown, hidden, or explained?
```

## Future engine hook

The likely next architecture layer is a `PlaceCandidate` / `CandidateReservoir` path that can normalize candidates from multiple sources into one scoring model.

A future candidate shape may include:

```js
{
  id,
  name,
  category,
  source,
  confidence,
  provenance,
  evidence,
  distance_from_user,
  distance_from_anchor,
  distance_from_route,
  weather_fit,
  time_fit,
  intent_fit,
  tourist_local_fit,
  classicness,
  localness,
  route_role,
  reasons
}
```

This should feed Blitz and generated `Your Day` without requiring every place to be hand-curated first.

The product goal is not the largest catalog. The product goal is the smartest day-composition engine.
