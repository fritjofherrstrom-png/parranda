# Product Surface Guardrails

Parranda should feel like one city-companion product, not a collection of city-specific demos. This document records the default review guardrails for route and city surfaces after the generated planner result adopted the `Your Day` grammar.

These are guardrails, not immutable rules. A PR may make a scoped exception when the product or technical value is clear, but the exception should be called out in the PR and verified against the generic/city-agnostic direction.

## Primary route experience

Generated/shared Planner output is the primary route experience. Route results should use the shared day grammar:

- `Your day` / localized equivalent
- visible start context and selected date
- editorial route title and honest summary
- compact available meta
- `Why this route`
- ordered stops that read as a coherent day

City-owned content may vary by city, but the product grammar should stay shared.

## Static and legacy route surfaces

Older static/editorial route cards are allowed only as non-primary fallback, reference, inspiration, or migration material. They should not compete with generated Planner results or appear as if they are the main Parranda route path.

When touching route surfaces, check whether a static route card is:

1. Rome-only or otherwise city-hardcoded.
2. Demo-like editorial content rather than generated Planner output.
3. A generic component fed by city-owned data.
4. Backed by an engine/citypack contract, or just parallel UI.

If it is city-hardcoded/demo-like, either demote it out of the primary flow or document why it remains visible.

## City-agnostic product direction

Prefer:

> Shared UX pattern, city-owned content through a contract.

Avoid:

> One city has a static section, so another city gets a manually copied static section for parity.

Do not create Barcelona static parity for Rome-only examples. Do not add new city-specific static route cards unless there is an explicit, verified reason and the PR explains the exception.

## Good future direction

If static route templates are valuable, they should eventually become generic route archetypes or engine-usable seeds, not standalone tours. That later work is separate from demoting legacy surfaces.

Examples of future route archetypes/seeds could include:

- `classic_anchor_day`
- `food_local_energy`
- `golden_hour_loop`
- `rain_safe_culture`
- `second_hand_crawl`

A future engine PR may adapt those by city, date/time, start context, walking length, user intent, Pulse/source signals, and trust coverage.

## Current audit note

The frontend still contains older Rome route examples such as Trastevere-centered loops. They are now treated as legacy fallback/reference examples, not as the primary route result surface. Generated Planner `Your Day` output is the route result surface to polish next.
