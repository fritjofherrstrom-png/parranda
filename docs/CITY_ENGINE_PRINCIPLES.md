# Parranda City Engine Principles

## Core principle

Parranda must not depend on manually built city packs in order to work.

City packs are an optional enhancement and acceleration layer, not required infrastructure.

The long-term goal is that Parranda can generate meaningful, location-aware experiences in any city, town, or village, whether the user is in Simrishamn, Bologna, Rio de Janeiro, or somewhere with no dedicated city pack at all.

A city pack should improve quality, speed, tone, specificity, and local flavor. It must never become a hard dependency for the app's core purpose.

## Product direction

Parranda should evolve through three levels of city intelligence:

### 1. Manual city packs

For strategically important cities, Parranda can use curated city packs with local knowledge, areas, venues, route logic, vibes, nightlife, warnings, cultural context, and insider details.

Example command:

```text
Implement citypack for Bologna.
```

The system should be able to add that city into the app as a structured package.

### 2. Semi-automatic city pack generation

The next step is that Parranda should be able to generate a useful draft city pack from available data.

Example command:

```text
Create citypack for Rio de Janeiro.
```

The engine should gather, structure, and normalize city context, including:

- areas and neighborhoods
- places and venues
- time-of-day relevance
- walking logic
- safety and friction points
- weather and seasonality
- nightlife and food patterns
- landmarks and local identity
- user and group vibe fit

A human can then review and improve the generated pack.

### 3. City-packless Parranda

The real product goal is that Parranda works even without a dedicated city pack.

A user should be able to open Parranda in Simrishamn, Naples, Tokyo, Rio de Janeiro, or any other place and still get useful quests, plans, route ideas, social prompts, and context-aware recommendations.

This means the app must be built around a general city intelligence engine, not around a list of hardcoded cities.

## Engineering rule

Do not hardcode the app around individual cities.

Build a general city intelligence layer that can:

1. understand the user's current location,
2. infer relevant local context,
3. generate suitable quests, routes, and plans,
4. adapt to group vibe, time, distance, weather, and constraints,
5. enrich results with a city pack when one is available,
6. still fulfill Parranda's purpose when no city pack exists.

## Architectural implication

City packs should behave like plug-in knowledge layers.

The core engine should own the universal logic:

- where the user is
- what kind of moment it is
- what the group wants
- what is nearby
- what is open or relevant now
- what route or quest makes sense
- what would make the experience memorable

City packs should enhance this with curated local detail.

In short:

```text
City packs make Parranda sharper.
They must not be what makes Parranda possible.
```
