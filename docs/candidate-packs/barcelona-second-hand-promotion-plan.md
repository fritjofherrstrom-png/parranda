# Barcelona Second-Hand Promotion Plan

Planning note for `docs/candidate-packs/barcelona-second-hand-v0.md`.

This is a **docs-only promotion plan**. It does not verify, promote, or
implement any candidate. Nothing in this file changes Barcelona runtime
catalog data, route templates, Pulse/Live sources, Planner, Blitz, CSS, or
public API behavior.

## Purpose

The v0 second-hand pack is an intake queue. This plan defines the first
verification wave so a future promotion PR can stay small, source-backed, and
safe.

The first wave should prioritize candidates that can unlock useful route
density without pretending unverified clusters are venues. The goal is not to
promote everything in the pack; it is to verify the few candidates most likely
to improve Barcelona's second-hand layer once converted into real runtime
records.

## First-Wave Verification Targets

### 1. `barcelona-encants-vells`

- **Why it matters for Parranda:** Strongest single second-hand anchor in the
  pack. If verified, it can give Barcelona a clear flea-market stop that
  supports morning/afternoon shopping drift and strengthens the
  Glòries/Poblenou side of the city.
- **What must be verified:** Current official name, address, operator, open
  days, opening hours, whether second-hand/flea-market activity is current and
  public-facing, and whether it duplicates any existing Barcelona catalog
  entry.
- **Required source type:** Official market/operator or Ajuntament page for
  address and schedule, plus one secondary source or direct observation for
  current second-hand character.
- **Promotion destination if verified:** `real_place` catalog entry.
- **Risks / reasons to hold back:** If current hours or operator pages are
  unclear, do not promote. If schedule is seasonal or materially different
  from expected, hold until the schedule can be modeled honestly.

### 2. `barcelona-mercat-sant-antoni-dominical`

- **Why it matters for Parranda:** Best recurring second-hand/book-market
  rhythm in the pack. If verified, it can support a Sunday Sant Antoni flow
  without inventing editorial Pulse or fake live data.
- **What must be verified:** Exact official name, market scope, current Sunday
  operating hours, whether it is recurring every Sunday or has exceptions, and
  whether the location and entrance pattern are stable.
- **Required source type:** Official market/Ajuntament/operator page for
  schedule, plus a secondary source or direct observation for current
  book/comics/collectibles activity.
- **Promotion destination if verified:** `event_venue` if modeled as a
  recurring market signal; possibly `real_place` only if the runtime catalog
  supports recurring schedule notes without implying it is open all week.
- **Risks / reasons to hold back:** Do not promote as always-on catalog content
  if the value only exists on Sunday. Do not turn an unverifiable schedule into
  Live runtime data.

### 3. `barcelona-riera-baixa-cluster`

- **Why it matters for Parranda:** Strongest Raval-side shopping-drift
  candidate. It could add texture to existing Raval routes, but only if the
  street still has enough active vintage/second-hand density.
- **What must be verified:** Which specific shops currently operate on or near
  Carrer de la Riera Baixa, their addresses, hours, categories, and whether
  the density still justifies cluster treatment.
- **Required source type:** Named shop official pages or reliable map/search
  records for each underlying shop, plus direct observation or reputable local
  guide evidence for cluster density.
- **Promotion destination if verified:** Prefer decomposition into multiple
  `real_place` catalog entries. Keep as `area_preset` / structural only if the
  runtime needs a non-venue routing context and the UI will not present it as a
  shop.
- **Risks / reasons to hold back:** No fake shop. If fewer than two or three
  active relevant shops can be verified, hold the cluster or decompose only the
  verified individual shops.

### 4. `barcelona-gracia-vintage-drift`

- **Why it matters for Parranda:** Gràcia needs more local daytime/afternoon
  density so routes do not drift back to old-town too quickly. A verified
  vintage layer could make Gràcia feel useful for locals and repeat visitors,
  not just as a food/bar neighborhood.
- **What must be verified:** Named active shops, addresses, categories, hours,
  and whether the shops are close enough to form a coherent walking drift.
- **Required source type:** Official shop pages or reliable map/search records
  for each underlying shop, with direct observation or reputable local guide
  support for the cluster claim.
- **Promotion destination if verified:** Decompose into `real_place` catalog
  entries. Keep any cluster identity structural only if needed for future
  routing diagnostics.
- **Risks / reasons to hold back:** Do not promote a generic "Gràcia vintage"
  area as a user-facing place. If shop density is scattered, promote only the
  strongest verified individual venues.

### 5. `barcelona-sant-antoni-vintage-drift`

- **Why it matters for Parranda:** Complements the Sunday dominical market and
  existing Sant Antoni food/bar anchors. Verification could produce the first
  coherent second-hand + vermut route thesis later, without creating route
  templates prematurely.
- **What must be verified:** Named shops, exact locations, hours, relationship
  to the market area, and whether the second-hand/vintage density is distinct
  enough from the Sunday market to deserve separate catalog entries.
- **Required source type:** Official shop pages or reliable map/search records,
  plus one source confirming local vintage/second-hand relevance.
- **Promotion destination if verified:** `real_place` catalog entries for
  verified shops. A later route PR may use them as route-template stops once
  the Sunday market schedule is also verified.
- **Risks / reasons to hold back:** Avoid over-concentrating Barcelona's
  second-hand layer in Sant Antoni. If the area adds only vague cluster value,
  keep it as review backlog.

### 6. `barcelona-el-born-vintage-design-cluster`

- **Why it matters for Parranda:** Born already has food/culture density. A
  verified vintage/design layer could make it a richer afternoon route area
  without leaning on tourist-default old-town stops.
- **What must be verified:** Named active shops, addresses, categories, hours,
  and whether this is materially different from `barcelona-born-jewelry-antiques`.
- **Required source type:** Official shop pages or reliable map/search records,
  plus reputable local guide/direct-observation evidence for the design/vintage
  cluster.
- **Promotion destination if verified:** Decompose into `real_place` catalog
  entries. Possible `area_preset` / structural-only context if the cluster is
  useful for routing but not user-facing.
- **Risks / reasons to hold back:** Born can easily become old-town-heavy or
  tourist-coded. Only promote shops that add real second-hand/design utility,
  not generic shopping.

## Deferred From First Wave

The periodic/pop-up market candidates (`barcelona-palo-alto-market`,
`barcelona-lost-and-found-market`, `barcelona-flea-market-bcn`, and
`barcelona-fleadonia`) should not be part of the first runtime promotion PR.
They may be valuable, but the pack already flags organizer pages, recurrence,
venue rotation, and feed stability as fragile.

Handle them in a later Pulse/Live source feasibility pass, not as static
catalog promotions.

## Hard Promotion Rules

- No `confidence: needs_review` candidate can enter runtime.
- No `generated_place` becomes a venue.
- No `area_preset` becomes a fake shop.
- No unverifiable market schedule becomes Live runtime data.
- No invented addresses, hours, operators, or recurrence patterns.
- No cluster can be shown to users as a normal place unless it has first been
  decomposed into verified underlying `real_place` records.
- No source-note-only candidate becomes `high` confidence without source URLs
  or direct observation notes.
- No candidate should be promoted if it duplicates an existing Barcelona
  catalog item.

## First Runtime PR Proposal

After verification, the smallest safe implementation PR should be:

> `feat: promote verified Barcelona second-hand anchors`

Scope:

- Promote **2–3 verified** second-hand anchors into
  `server/cities/barcelona/catalog.js`.
- Include provenance metadata for every promoted place.
- Add/update catalog tests proving:
  - promoted entries have valid Barcelona area tokens;
  - promoted entries have provenance;
  - no structural clusters are returned as normal place search results;
  - Barcelona remains `visibility: "preview"`;
  - no Rome leakage.
- Do not add route templates in the same PR.
- Do not wire Pulse/Live schedules in the same PR.

Recommended first implementation subset if verification succeeds:

1. `barcelona-encants-vells` as a `real_place`.
2. One or two verified underlying shops from either Riera Baixa, Gràcia, Sant
   Antoni, or Born as `real_place` entries.
3. Hold `barcelona-mercat-sant-antoni-dominical` unless the schedule is clean
   enough to model without implying always-on availability.

## Non-Goals

- Do not implement this plan in this PR.
- Do not verify live on the web in this PR unless explicitly requested.
- Do not edit `server/cities/barcelona/catalog.js`.
- Do not create route templates.
- Do not wire Pulse or Live sources.
- Do not change Planner, Blitz, route-engine, UI, CSS, or public API.
- Do not convert the candidate pack into runtime data.

## Unresolved Decisions

- Whether recurring markets like Sant Antoni dominical should become
  `event_venue`, `real_place` with schedule notes, or a future recurring-event
  source.
- Whether verified clusters should ever remain `area_preset` in runtime, or
  whether all user-facing value should be decomposed into named shops.
- How many verified shops are required before a street/area cluster is useful
  enough for routing context.
- Whether the first runtime PR should prefer geographic spread
  (one Raval, one Gràcia, one Sant Antoni/Born) or strongest-source quality
  regardless of area.
