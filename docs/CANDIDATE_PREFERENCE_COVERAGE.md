# Candidate Preference Coverage

**Status:** Working product/engine principle  
**Related:** `docs/CANDIDATE_INTELLIGENCE_MIGRATION.md`, `docs/AGNOSTIC_ENGINE_NOTES.md`

Candidate scanning must not collapse into only broad categories such as `food`, `culture`, `shopping`, or `landmark`.

Agnostic Parranda will only feel smart if it remembers the specific things the user asked for while it sources broadly. This matters for both Blitz and generated `Your Day`.

## Principle

```txt
Preserve specific user preferences from intake → candidate scan → gates → fit scoring → inspect → final route/day.
```

If the user asks for second hand and the scanner only retrieves generic shopping, the engine failed.

If the user asks for views and the scanner only retrieves famous landmarks, the engine failed.

If the user asks for a local-feeling evening and the scanner only returns top-rated restaurants, the engine failed.

## Preference vocabulary must stay rich

The candidate spine should preserve a wide intent/preference vocabulary, including both broad and niche interests:

- views, viewpoints, sunset, coast, water, nature, gardens, parks
- second hand, vintage, flea markets, design shops, bookstores, record stores, galleries
- food, coffee, bakeries, markets, wine, bars, cocktails, nightlife, live music
- museums, architecture, churches, ruins, history, landmarks, neighborhoods
- swimming, beaches, walks, hikes, slow routes, low-energy routes
- hidden/local finds, classics, tourist must-sees, rediscover/own-city experiences
- budget sensitivity, opening-hours sensitivity, weather sensitivity, walking tolerance

This is not just tagging. It is a product requirement.

## Required candidate fields

Future candidate/fit output should track:

```txt
covered_preferences
missing_preferences
```

and distinguish match strength:

```txt
primary_match      // directly satisfies the user's stated preference
supporting_match   // helps the route/day but is not the main reason
fallback_match     // acceptable when better matches are unavailable
```

## Inspect requirement

`?inspect=candidates` should show:

- which user preferences were covered
- which were missed
- whether each selected candidate was a primary, supporting, or fallback match
- whether a broad category accidentally replaced a specific intent

## Review rule

Every future candidate-intelligence PR should answer:

```txt
Does this preserve specific user preferences rather than collapsing them into generic buckets?
```

If not, the PR risks making Parranda more generic even if the candidate pool gets larger.
