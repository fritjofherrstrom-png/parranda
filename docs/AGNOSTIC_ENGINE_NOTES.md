# Agnostic Engine Notes

**Status:** Historical design notes. The candidate reservoir and any-place
composer described as future here have shipped. Use `docs/ARCHITECTURE.md` for
the current runtime path and `docs/PARRANDA_ENGINE_GOALS.md` for current work.

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

## Time-sensitive now/next intelligence

Agnostic Parranda must be time-sensitive, especially for Blitz and spontaneous use.

A user opening Parranda at 11:00, 18:00, 21:30, or after finishing dinner is not asking for the same product. They are often asking:

```txt
Where should we go now?
What is still open?
What fits this exact part of the day?
What are the next good moves nearby?
What should we do after dinner, before things close, or if the night is just starting?
```

The engine should understand **now/next windows**, not only whole-day plans.

Examples:

- late morning: coffee, markets, museums opening soon, short walks, first anchor of the day
- afternoon: views, neighborhoods, shopping, weather windows, pre-dinner drift
- early evening: aperitivo, dinner candidates, sunset, live events starting soon
- post-dinner: bars, music, late-open places, night walks, safe low-friction moves
- late night: only high-confidence open/live options, avoid pretending normal daytime places are viable

The key product moment is often not “plan my perfect full day”. It is:

```txt
We are here now. What is the smart move from here?
```

This requires time-aware scoring across:

- current local time and timezone
- opening-hours confidence
- soon-closing risk
- starts-soon live events
- after-dinner / late-night category fit
- user energy and walking tolerance
- weather windows that may change later
- distance from current location or current route end
- whether the candidate is a good immediate move, later move, or fallback

Time should bias, not dictate. A great nearby classic may still be worth a short outside look even if it is closed inside. A late-open place should not win just because it is open if it has weak fit. But the engine must not recommend a route that feels blind to the hour.

Future candidate scoring should distinguish:

```txt
good_now
opening_soon
closing_soon
better_later
late_open
post_dinner_fit
starts_soon
too_late_for_this
```

This is central to making Parranda feel alive rather than static.

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
  now_next_fit,
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
