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

## Parranda Pick as future trust badge

A future **Parranda Pick** should not mean "the algorithm recommended this" or "this place is popular". It should mean Parranda has genuinely vouched for the place as useful in a real day.

Working principle:

```txt
Parranda Pick is earned by route quality, not popularity.
```

A Parranda Pick should be rare and should signal taste, curation, and dayflow usefulness. It can apply to a famous landmark, a small cafe, a market, a beach, a bar, a bookstore, or a route anchor if it genuinely improves the day.

The badge should represent:

- verified or strongly vouched-for quality
- strong fit inside an actual day or route
- useful route role, not just standalone reputation
- credible local or experiential value
- confidence beyond raw external consensus

External consensus, source candidates, and map/search-derived candidates can help discover potential future picks, but they should not automatically receive the badge.

Possible future trust layers:

- **Parranda Pick** — vouched-for, route-quality earned, rare.
- **Source-backed** — enough public/source evidence to consider, not fully Parranda-vouched.
- **Local signal** — credible local/community/editorial signal, confidence may vary.
- **Live fit** — temporarily relevant today/near this route, not a permanent badge.
- **Route anchor** — a place capable of carrying a route or day shape.

The long-term premium idea is that venues may want to earn "Parranda Pick" the way restaurants care about Michelin/White Guide recognition, but the meaning is different: this is about how beautifully a place works in a real day, not only how good it is in isolation.

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
