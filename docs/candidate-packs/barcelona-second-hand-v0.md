# Barcelona Second-Hand v0

Draft candidate pack for Barcelona second-hand / vintage / flea / records /
books / design-resale / local shopping drift. Follows the format defined in
`docs/candidate-packs/CANDIDATE_PACK_FORMAT.md`.

This is a **docs-only intake pack**. No runtime integration. Nothing in this
file should land in `server/cities/barcelona/catalog.js`, in any provider, or
in any route template until a separate promotion PR verifies each entry.

## Pack metadata

```text
pack_name:           barcelona-second-hand-v0
city:                barcelona
theme:               Second hand, vintage, flea, records, books, design-resale,
                     local shopping drift.
intended_use:        Feed Barcelona catalog with stronger shop density beyond
                     the current pilot catalog; seed Pulse market/event signals
                     for weekly second-hand rhythm; suggest future mini-route
                     templates for shopping-drift days.
quality_bar:         Verifiable existence; clearly fits the second-hand theme;
                     adds neighborhood texture beyond the tourist default;
                     not a chain.
excluded_by_design:  Chain fast-fashion stores; pure tourist-trap markets;
                     high-end antique dealers without drift quality; pop-up
                     events with no recurring rhythm.
promotion_criteria:  Address verified · current open days/hours verified ·
                     category fits Parranda second-hand intent · not a
                     duplicate of an existing Barcelona catalog entry ·
                     source URL or direct observation cited in source_notes.
pack_version:        v0
last_updated:        2026-05-21
author:              claude (draft)
```

## Honesty note before reading the candidates

This v0 pack was drafted without on-the-ground verification. For every
candidate below, the **existence as a category/landmark/area is plausible**,
but **specific addresses, current operating days, hours, and named shops are
not verified**. Following the format's hard rules:

- Anchor landmarks that are well-known in audit docs (Encants, Sant Antoni
  Sunday market, Riera Baixa) are listed with `confidence: needs_review` and
  source notes saying what specifically must be verified before promotion.
- Neighborhood clusters are listed as `area_preset` with medium confidence
  for the *area's character* and `needs_review` for the *specific shop
  density* claim.
- Periodic/pop-up markets (Palo Alto, Lost & Found, Flea Market BCN,
  Fleadonia) are listed only because they appear in the existing
  `docs/barcelona-pulse-live-source-audit.md`. All are `needs_review` and
  carry that audit's explicit warning about fragile organizer pages.
- Route-themed clusters are `generated_place` and cannot be promoted to
  runtime venues without first being decomposed into real underlying places.
- **No specific shop names** are claimed in v0. The promotion PR is where
  individual shops get researched, named, and verified.

Every candidate is in the **verification queue** at the bottom of this file.

---

## Candidates

### Anchor venues

#### barcelona-encants-vells

```text
proposed_id:               barcelona-encants-vells
name:                      Mercat dels Encants (Encants Vells / Fira de Bellcaire)
city:                      barcelona
neighborhood:              Plaça de les Glòries / Poblenou edge
category:                  flea_market
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, shopping_cluster, neighborhood_anchor]
vibes:                     [curious, buzzy]
tags:                      [market, second_hand, vintage, lokalt, klassiker]
why_it_fits_parranda:      Long-running Barcelona flea market and one of the
                           strongest second-hand anchors in the city. Gives a
                           shopping-drift day a clear morning seed and ties
                           Poblenou/Glòries into a real reason to visit.
confidence:                needs_review
source_notes:              Landmark recognized in Barcelona second-hand
                           cultural context. Current address (Plaça de les
                           Glòries area), current open days, current opening
                           hours, and current operator must be verified
                           against the official Ajuntament de Barcelona or
                           market operator page before promotion.
promotion_recommendation:  promote_first
```

#### barcelona-mercat-sant-antoni-dominical

```text
proposed_id:               barcelona-mercat-sant-antoni-dominical
name:                      Mercat de Sant Antoni — Sunday dominical (books,
                           comics, postcards, coins)
city:                      barcelona
neighborhood:              Sant Antoni
category:                  book_market
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, shopping_cluster, neighborhood_anchor]
vibes:                     [curious, slow]
tags:                      [market, second_hand, lokalt, kultur, weekend]
why_it_fits_parranda:      Recurring Sunday market that sits naturally beside
                           Sant Antoni's vermut/food culture; gives a slow
                           Sunday a clear local rhythm. The
                           barcelona-citypack-readiness-audit notes Sant
                           Antoni has "book/vintage edges" that the engine
                           does not yet exploit.
confidence:                needs_review
source_notes:              Weekly Sunday market is well-known in Barcelona
                           local culture. Exact name, current schedule (which
                           Sunday hours), and whether it is an official
                           Ajuntament event or operator-run must be verified
                           before promotion. Cross-ref:
                           docs/barcelona-citypack-readiness-audit.md:94.
promotion_recommendation:  promote_first
```

#### barcelona-riera-baixa-cluster

```text
proposed_id:               barcelona-riera-baixa-cluster
name:                      Carrer de la Riera Baixa vintage cluster
city:                      barcelona
neighborhood:              El Raval
category:                  vintage_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [main_stop, shopping_cluster, neighborhood_anchor]
vibes:                     [curious, buzzy]
tags:                      [vintage, second_hand, lokalt, shopping]
why_it_fits_parranda:      A street historically associated with vintage
                           clothing density in Barcelona — gives the engine a
                           Raval-side shopping-drift anchor that pairs with
                           the existing Raval culture/food catalog. As an
                           area_preset, it is a cluster, not a single venue.
confidence:                needs_review
source_notes:              Street-as-cluster reputation is widely held. Which
                           specific shops are currently operating, their
                           hours, and whether the density still warrants
                           cluster treatment in 2026 must be verified before
                           promotion. Promotion would either:
                           (a) decompose the cluster into individual real_place
                               candidates per verified shop, or
                           (b) keep it as a structural area_preset linked to
                               existing El Raval neighborhood routes.
promotion_recommendation:  promote_first
```

### Neighborhood clusters

#### barcelona-el-born-vintage-design-cluster

```text
proposed_id:               barcelona-el-born-vintage-design-cluster
name:                      El Born vintage + design cluster
city:                      barcelona
neighborhood:              El Born / La Ribera
category:                  vintage_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [shopping_cluster, neighborhood_anchor, optional_detour]
vibes:                     [curious, romantic]
tags:                      [vintage, second_hand, design, lokalt, shopping]
why_it_fits_parranda:      El Born already carries culture/food anchors in
                           Barcelona's pilot catalog. Adding the area's
                           independent vintage/design shop layer turns Born
                           from a single-purpose evening anchor into a
                           shopping-drift afternoon as well.
confidence:                needs_review
source_notes:              Area's vintage/design reputation is general
                           knowledge but not specific to verifiable shops.
                           Promotion requires identifying named shops with
                           verified addresses and current operating status.
promotion_recommendation:  keep_as_optional
```

#### barcelona-gracia-vintage-drift

```text
proposed_id:               barcelona-gracia-vintage-drift
name:                      Gràcia vintage drift cluster
city:                      barcelona
neighborhood:              Gràcia
category:                  vintage_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [shopping_cluster, neighborhood_anchor]
vibes:                     [curious, slow]
tags:                      [vintage, second_hand, lokalt, shopping]
why_it_fits_parranda:      Gràcia's independent-shop character is already
                           part of its neighborhood identity. A second-hand
                           drift cluster fits naturally beside the existing
                           Gràcia food/culture anchors and supports an
                           afternoon walking-only day.
confidence:                needs_review
source_notes:              Reputation is general; specific shop density and
                           operating shops must be verified. Promotion likely
                           decomposes this into a small set of real_place
                           candidates along Travessera / Verdi / Plaça del
                           Diamant axes.
promotion_recommendation:  keep_as_optional
```

#### barcelona-sant-antoni-vintage-drift

```text
proposed_id:               barcelona-sant-antoni-vintage-drift
name:                      Sant Antoni neighborhood vintage drift
city:                      barcelona
neighborhood:              Sant Antoni
category:                  vintage_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [shopping_cluster, neighborhood_anchor, food_nearby]
vibes:                     [curious, slow]
tags:                      [vintage, second_hand, lokalt, shopping]
why_it_fits_parranda:      Pairs naturally with the Sunday Mercat de Sant
                           Antoni dominical and the area's vermut culture.
                           Gives a slow Sunday a coherent shape:
                           books-market → vermut → vintage drift.
confidence:                needs_review
source_notes:              Cross-ref: barcelona-citypack-readiness-audit.md:94
                           ("Sant Antoni: food, market, bars, book/vintage
                           edges"). Specific shops and density must be
                           verified before promotion.
promotion_recommendation:  keep_as_optional
```

#### barcelona-poblenou-design-salvage

```text
proposed_id:               barcelona-poblenou-design-salvage
name:                      Poblenou design salvage cluster
city:                      barcelona
neighborhood:              Poblenou
category:                  design_resale
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [shopping_cluster, optional_detour]
vibes:                     [curious]
tags:                      [design, second_hand, lokalt]
why_it_fits_parranda:      Poblenou's post-industrial character supports a
                           design-resale / salvage drift that complements
                           the Encants anchor at Glòries. Could anchor a
                           cross-Glòries route from Encants into Poblenou.
confidence:                needs_review
source_notes:              Poblenou's design/industrial-reuse reputation is
                           real but specific design-resale shop density is
                           not verified. Promotion requires identifying
                           named shops and confirming current operation.
promotion_recommendation:  needs_research
```

#### barcelona-raval-second-hand-books

```text
proposed_id:               barcelona-raval-second-hand-books
name:                      El Raval second-hand book cluster
city:                      barcelona
neighborhood:              El Raval
category:                  book_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [optional_detour, rainy_day]
vibes:                     [curious, slow]
tags:                      [second_hand, books, kultur, lokalt]
why_it_fits_parranda:      Used-book / zine culture in El Raval pairs with
                           the Riera Baixa vintage cluster and serves well
                           as a rainy-day fallback inside an existing Raval
                           route.
confidence:                needs_review
source_notes:              Specific shops and density are not verified.
                           Promotion requires identifying named bookshops
                           with verified current addresses.
promotion_recommendation:  needs_research
```

#### barcelona-gracia-record-shops

```text
proposed_id:               barcelona-gracia-record-shops
name:                      Gràcia record shops cluster
city:                      barcelona
neighborhood:              Gràcia
category:                  record_shop_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [optional_detour, shopping_cluster]
vibes:                     [curious]
tags:                      [records, second_hand, lokalt, kultur]
why_it_fits_parranda:      Records as a sub-theme of second-hand drift; fits
                           Gràcia's independent-shop character and gives a
                           music-leaning user a clear sub-route.
confidence:                needs_review
source_notes:              Record-shop density in Gràcia is plausible but
                           specific shops and current operation are not
                           verified.
promotion_recommendation:  needs_research
```

#### barcelona-born-jewelry-antiques

```text
proposed_id:               barcelona-born-jewelry-antiques
name:                      Born jewelry / antiques cluster
city:                      barcelona
neighborhood:              El Born / La Ribera
category:                  antiques_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [optional_detour, shopping_cluster]
vibes:                     [curious, romantic]
tags:                      [antiques, design, lokalt, shopping]
why_it_fits_parranda:      Adds depth to the Born area beyond food/culture
                           anchors. Antiques sit between "second hand" and
                           "design" and give the area a distinct afternoon
                           drift.
confidence:                needs_review
source_notes:              Reputation is general; specific shops and density
                           are not verified. May overlap with the broader
                           El Born vintage+design cluster — promotion should
                           decide whether to merge or keep separate.
promotion_recommendation:  needs_research
```

### Periodic / pop-up markets

All four below are cited only because
`docs/barcelona-pulse-live-source-audit.md:72` lists them as potential
flea/vintage market sources. That audit explicitly warns: *"must verify
current pages and avoid fragile social-only scraping."* All are
`needs_review`.

#### barcelona-palo-alto-market

```text
proposed_id:               barcelona-palo-alto-market
name:                      Palo Alto Market (Poblenou)
city:                      barcelona
neighborhood:              Poblenou
category:                  design_craft_market
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, shopping_cluster, evening_anchor]
vibes:                     [curious, buzzy]
tags:                      [market, design, second_hand, lokalt]
why_it_fits_parranda:      Recurring monthly design/craft market in Poblenou
                           that could seed Pulse live-event signals on the
                           days it runs. Sits naturally beside the Encants
                           + Poblenou design route.
confidence:                needs_review
source_notes:              Listed in docs/barcelona-pulse-live-source-audit.md:72.
                           Audit warns about fragile organizer pages — current
                           website, recurrence cadence, and address must be
                           verified before promotion. Whether it is truly
                           second-hand vs. craft-design must also be confirmed.
promotion_recommendation:  needs_research
```

#### barcelona-lost-and-found-market

```text
proposed_id:               barcelona-lost-and-found-market
name:                      Lost & Found Market
city:                      barcelona
neighborhood:              unverified — venue varies by edition
category:                  vintage_market
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, shopping_cluster]
vibes:                     [curious, buzzy]
tags:                      [market, vintage, second_hand, lokalt]
why_it_fits_parranda:      Periodic vintage-themed market that could seed
                           Pulse live-event signals when active. Strong fit
                           for the pack theme if recurrence is reliable.
confidence:                needs_review
source_notes:              Listed in docs/barcelona-pulse-live-source-audit.md:72.
                           Recurrence, current organizer, and venue rotation
                           must be verified before promotion. Likely too
                           fragile for runtime without a stable source feed.
promotion_recommendation:  needs_research
```

#### barcelona-flea-market-bcn

```text
proposed_id:               barcelona-flea-market-bcn
name:                      Flea Market BCN
city:                      barcelona
neighborhood:              unverified — venue varies
category:                  flea_market
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, shopping_cluster]
vibes:                     [curious, buzzy]
tags:                      [market, vintage, second_hand]
why_it_fits_parranda:      Periodic flea market that could fold into Pulse
                           live signals. Theme fit is strong on paper.
confidence:                needs_review
source_notes:              Listed in docs/barcelona-pulse-live-source-audit.md:72
                           with the same fragility warning. Current organizer
                           page, recurrence, and venues must be verified.
promotion_recommendation:  needs_research
```

#### barcelona-fleadonia

```text
proposed_id:               barcelona-fleadonia
name:                      Fleadonia
city:                      barcelona
neighborhood:              unverified — venue varies
category:                  vintage_market
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, shopping_cluster]
vibes:                     [curious, buzzy]
tags:                      [market, vintage, second_hand]
why_it_fits_parranda:      Same role as the other periodic vintage markets
                           — Pulse seed material if a stable feed exists.
confidence:                needs_review
source_notes:              Listed in docs/barcelona-pulse-live-source-audit.md:72.
                           Same fragility warning applies. Promotion blocked
                           until a reliable organizer feed is confirmed.
promotion_recommendation:  needs_research
```

### Route-themed clusters (intake-only)

These are not venues. They are draft route ideas that combine other
candidates above and existing Barcelona catalog anchors. They sit in the
pack as `generated_place` candidates and should be promoted, if at all, by
constructing real route templates over verified underlying places — not by
landing them in the catalog as places.

#### barcelona-route-theme-sant-antoni-sunday-vermut

```text
proposed_id:               barcelona-route-theme-sant-antoni-sunday-vermut
name:                      Sant Antoni Sunday + vermut drift (route theme)
city:                      barcelona
neighborhood:              Sant Antoni
category:                  route_theme
candidate_kind:            generated_place
source_kind:               generated
route_role:                [main_stop, neighborhood_anchor, food_nearby]
vibes:                     [slow, curious]
tags:                      [market, second_hand, vermut, lokalt, weekend]
why_it_fits_parranda:      A Sunday morning that links the Mercat de Sant
                           Antoni dominical, the surrounding vintage drift,
                           and existing vermut/food anchors in the
                           Barcelona pilot catalog. Coherent rhythm: book
                           market → vermut → vintage drift → wind-down.
confidence:                needs_review
source_notes:              Composite of barcelona-mercat-sant-antoni-dominical
                           and barcelona-sant-antoni-vintage-drift, plus
                           existing Sant Antoni food/bar anchors in the
                           pilot catalog. Not promotable as a place — only as
                           a future route template once underlying pieces
                           are verified.
promotion_recommendation:  keep_as_optional
```

#### barcelona-route-theme-encants-poblenou-design

```text
proposed_id:               barcelona-route-theme-encants-poblenou-design
name:                      Encants + Poblenou design salvage afternoon (route theme)
city:                      barcelona
neighborhood:              Glòries / Poblenou
category:                  route_theme
candidate_kind:            generated_place
source_kind:               generated
route_role:                [main_stop, shopping_cluster]
vibes:                     [curious]
tags:                      [market, second_hand, design, lokalt]
why_it_fits_parranda:      Pairs the Encants flea-market anchor with a
                           Poblenou design-salvage drift across Glòries.
                           Gives a shopping-themed afternoon a coherent
                           cross-neighborhood shape that the current
                           catalog does not express.
confidence:                needs_review
source_notes:              Composite of barcelona-encants-vells and
                           barcelona-poblenou-design-salvage. Not promotable
                           as a place — only as a future route template once
                           underlying pieces are verified.
promotion_recommendation:  keep_as_optional
```

#### barcelona-route-theme-riera-baixa-raval-afternoon

```text
proposed_id:               barcelona-route-theme-riera-baixa-raval-afternoon
name:                      Riera Baixa + cross-Raval afternoon (route theme)
city:                      barcelona
neighborhood:              El Raval
category:                  route_theme
candidate_kind:            generated_place
source_kind:               generated
route_role:                [main_stop, shopping_cluster, rainy_day]
vibes:                     [curious, buzzy]
tags:                      [vintage, second_hand, books, lokalt]
why_it_fits_parranda:      Threads the Riera Baixa vintage street with the
                           Raval second-hand book cluster, with existing
                           Raval food/culture anchors as connectors. Strong
                           rainy-day fallback because most stops are short
                           indoor visits.
confidence:                needs_review
source_notes:              Composite of barcelona-riera-baixa-cluster and
                           barcelona-raval-second-hand-books. Not promotable
                           as a place — only as a future route template.
promotion_recommendation:  keep_as_optional
```

#### barcelona-route-theme-gracia-second-hand-afternoon

```text
proposed_id:               barcelona-route-theme-gracia-second-hand-afternoon
name:                      Gràcia second-hand afternoon (route theme)
city:                      barcelona
neighborhood:              Gràcia
category:                  route_theme
candidate_kind:            generated_place
source_kind:               generated
route_role:                [main_stop, shopping_cluster, neighborhood_anchor]
vibes:                     [curious, slow]
tags:                      [vintage, second_hand, records, lokalt]
why_it_fits_parranda:      Combines the Gràcia vintage drift and record-shop
                           clusters with existing Gràcia food/bar anchors
                           into a clear afternoon walking shape that doesn't
                           depend on weekend market timing.
confidence:                needs_review
source_notes:              Composite of barcelona-gracia-vintage-drift and
                           barcelona-gracia-record-shops. Not promotable as a
                           place — only as a future route template.
promotion_recommendation:  keep_as_optional
```

---

## Top promote_first list

The candidates below are the highest-value entries for a future promotion PR
to verify and convert first. They are still `confidence: needs_review` — the
recommendation is about *priority order for verification*, not about
fast-tracking past verification.

1. `barcelona-encants-vells` — strongest single anchor; verify and promote
   into the catalog as a flea market.
2. `barcelona-mercat-sant-antoni-dominical` — strongest event anchor;
   verify recurring schedule and either add as a recurring event_venue or
   wire into Pulse live-event signals.
3. `barcelona-riera-baixa-cluster` — strongest area cluster; verify shop
   density and either decompose into real_place candidates or keep as
   structural area_preset.
4. `barcelona-el-born-vintage-design-cluster` — adds depth to an area
   already in the catalog; second priority for shop verification.
5. `barcelona-gracia-vintage-drift` — same reasoning as Born; ties to the
   independent-shop character Gràcia already carries.
6. `barcelona-sant-antoni-vintage-drift` — pairs with #2 to make Sant
   Antoni a full Sunday route.

The four periodic markets (Palo Alto, Lost & Found, Flea Market BCN,
Fleadonia) are explicitly **not** in the promote_first list. The audit at
`docs/barcelona-pulse-live-source-audit.md:72` already flagged them as
fragile; they belong in a separate live-source feasibility pass before
promotion.

---

## Suggested mini-route themes

These are the four route-themed candidates above, summarized for review.
Each links to its underlying candidates. None of these should be wired into
`server/cities/barcelona/catalog.js`'s `routeTemplates` until the
underlying pieces are verified.

| Theme                                              | Time band      | Underlying candidates                                                                          | What's missing before it could become a route template                                            |
| -------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Sant Antoni Sunday + vermut drift                  | Sunday morning | mercat-sant-antoni-dominical · sant-antoni-vintage-drift · existing Sant Antoni food anchors   | Verified market schedule; verified vintage shop density along the area; verified vermut anchors. |
| Encants + Poblenou design salvage afternoon        | Afternoon      | encants-vells · poblenou-design-salvage · existing Glòries/Poblenou connectors                 | Verified Encants days/hours; verified Poblenou shop density; walking connector to Glòries.       |
| Riera Baixa + cross-Raval afternoon                | Afternoon      | riera-baixa-cluster · raval-second-hand-books · existing Raval culture/food anchors            | Verified Riera Baixa shop density; verified Raval bookshops; coherent walking order.              |
| Gràcia second-hand afternoon                       | Afternoon      | gracia-vintage-drift · gracia-record-shops · existing Gràcia food/bar anchors                  | Verified Gràcia shop density; verified record shops; whether the cluster is dense enough to ↓.    |

---

## Verification queue

Every candidate in this pack is in the verification queue. A future
promotion PR must resolve each item below before that candidate can leave
this pack and enter runtime.

| Candidate                                              | What needs verification                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| barcelona-encants-vells                                | Current address, open days, hours, official operator page URL.                                                     |
| barcelona-mercat-sant-antoni-dominical                 | Exact name and scope (books / coins / comics), current Sunday hours, official Ajuntament or operator page URL.     |
| barcelona-riera-baixa-cluster                          | Which specific shops are currently operating; promote as cluster or decompose into named real_place candidates.     |
| barcelona-el-born-vintage-design-cluster               | Named shops with verified addresses; whether to merge with born-jewelry-antiques.                                  |
| barcelona-gracia-vintage-drift                         | Named shops with verified addresses; concentration axes (Travessera / Verdi / Plaça del Diamant).                  |
| barcelona-sant-antoni-vintage-drift                    | Named shops with verified addresses; whether density justifies a separate cluster from the Sunday market.          |
| barcelona-poblenou-design-salvage                      | Named shops with verified addresses; whether design-resale density actually exists vs. wishful thinking.           |
| barcelona-raval-second-hand-books                      | Named bookshops with verified addresses; whether the cluster is coherent or scattered.                             |
| barcelona-gracia-record-shops                          | Named record shops with verified addresses; whether density warrants a cluster vs. individual real_place entries.  |
| barcelona-born-jewelry-antiques                        | Named shops with verified addresses; relationship to broader Born vintage cluster.                                 |
| barcelona-palo-alto-market                             | Current organizer page, recurrence, address, theme (design/craft vs. true second-hand).                            |
| barcelona-lost-and-found-market                        | Current organizer page, recurrence, venue rotation, whether feed is stable enough for Pulse.                       |
| barcelona-flea-market-bcn                              | Current organizer page, recurrence, venues; same fragility warning.                                                 |
| barcelona-fleadonia                                    | Current organizer page, recurrence, venues; same fragility warning.                                                 |
| barcelona-route-theme-*  (all four)                    | Underlying candidates must be verified first; then walking order, time band, and intent strength can be confirmed. |

---

## Place vs cluster distinction

For clarity at promotion time:

- **Actual single venues** (`candidate_kind: real_place` or `event_venue`):
  `barcelona-encants-vells`, `barcelona-mercat-sant-antoni-dominical`,
  `barcelona-palo-alto-market`, `barcelona-lost-and-found-market`,
  `barcelona-flea-market-bcn`, `barcelona-fleadonia`.

- **Neighborhood clusters** (`candidate_kind: area_preset`):
  `barcelona-riera-baixa-cluster`,
  `barcelona-el-born-vintage-design-cluster`,
  `barcelona-gracia-vintage-drift`, `barcelona-sant-antoni-vintage-drift`,
  `barcelona-poblenou-design-salvage`,
  `barcelona-raval-second-hand-books`,
  `barcelona-gracia-record-shops`, `barcelona-born-jewelry-antiques`.
  These are *areas*, not venues. They can support routing context but
  must not be presented as places. Promotion either keeps them as
  area_preset structural anchors or decomposes them into real_place
  candidates per verified shop.

- **Generated route themes** (`candidate_kind: generated_place`):
  the four `barcelona-route-theme-*` entries. These exist only as
  intake-time route ideas. They cannot be promoted to runtime venues; if
  promoted at all, they become route templates built on top of the verified
  real_place / event_venue / area_preset entries above.
