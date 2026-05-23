# Athens Pilot Catalog v0

Draft candidate pack for the first Athens pilot catalog. Follows the format
defined in `docs/candidate-packs/CANDIDATE_PACK_FORMAT.md` and the strategy
defined in `docs/ATHENS_CONTENT_SOURCE_STRATEGY.md`.

This is a **docs-only intake pack**. Nothing in this file should land in
`server/cities/athens/catalog.js`, in any provider, in any route template,
or in any source descriptor until a separate, explicit promotion PR
verifies each entry against the pack's `promotion_criteria`.

## Pack metadata

```text
pack_name:           athens-pilot-catalog-v0
city:                athens
theme:               First Athens pilot catalog — food, café, bar, culture,
                     market, and viewpoint anchors across 8 neighborhoods,
                     intake-only.
intended_use:        Feed the first Athens runtime catalog (target 25–35
                     verified real places); identify candidates strong
                     enough for early Pulse/Live source descriptors; surface
                     area density patterns that should inform later route
                     templates.
quality_bar:         Verifiable existence in 2026; route-useful local
                     density (not generic top-10 tourism); fits Parranda's
                     "city as it actually moves" thesis; recognizable
                     enough that a route through it reads as real to a
                     visitor without collapsing into a postcard.
excluded_by_design:  Generic must-see monument tours; chain restaurants;
                     pure tourist-trap tavernas; venues whose only signal
                     is a generic travel-list mention; closed/demolished
                     venues; venues whose current operator is unclear.
promotion_criteria:  Existence verified against an official, operator, or
                     municipal source · current address verified · current
                     open days/hours verified · category fits Parranda
                     intent · area token verified against the Athens
                     neighborhood model · not a duplicate of a verified
                     candidate · source URL or direct observation cited in
                     source_notes · OSM/Wikidata alone is not sufficient
                     quality proof, only existence/location proof.
pack_version:        v0
last_updated:        2026-05-23
author:              claude (draft)
```

## Honesty note before reading the candidates

This v0 pack was drafted without on-the-ground verification and without
authoritative URL checks. Every candidate is `confidence: needs_review`
with `promotion_recommendation: needs_research`. The pack is a research
*pool*, not a promotion shortlist.

What this v0 *does* claim:

- Each candidate identifies a venue, market, viewpoint, or area that
  appears in widely-held Athens cultural context — flea markets, hill
  parks, neighborhood squares, recognizable food/bar/culture anchors —
  not invented names.
- Each candidate proposes an area placement consistent with the area
  model in `docs/ATHENS_CONTENT_SOURCE_STRATEGY.md`.
- Each candidate names a likely source family that a future promotion
  pass should hit (operator site, municipal source, festival programme,
  OSM/Wikidata, or a documented local guide).

What this v0 *does not* claim:

- That any specific address is correct as of 2026.
- That any specific opening day or hour is current.
- That any specific operator still runs the venue under the named brand.
- That a venue is route-useful purely because it is well known.
- That OSM/Wikidata existence is sufficient quality evidence.

Every candidate is in the verification queue at the bottom of this file.
The promotion PR is responsible for resolving each `needs_research` line
into a `promote_first` / `keep_as_optional` / `reject_for_now` decision
with citations.

## Area model used in this pack

Per `docs/ATHENS_CONTENT_SOURCE_STRATEGY.md` §Area Model Draft. Areas used:

- `monastiraki-psyrri`
- `syntagma-plaka`
- `exarchia`
- `kolonaki-lycabettus`
- `kypseli`
- `koukaki-makrygianni`
- `petralona-thisseio`
- `gazi-kerameikos`
- `pangrati-mets`

Piraeus/coast is intentionally not seeded in v0 — the pilot catalog can be
useful without coast routes, and adding Piraeus before the central density
exists risks pulling routes too far from the walking-day scale.

## Source families referenced in this pack

These are the source families this v0 expects a future promotion pass to
verify against. None of these has been hit during pack drafting.

| Source family | Used for | Strength | Verification path |
| --- | --- | --- | --- |
| Municipality of Athens / cityofathens.gr | Markets, civic anchors, public squares, Kypseli Market programming | Strong for civic existence and structural anchors | Operator/owner pages, programming calendars |
| This is Athens (thisisathens.org) | Visitor-facing venue context, neighborhood framing | Strong for existence, medium for current detail | Official Athens visitor authority listings |
| Athens Festival (aefestival.gr) | Performing-arts venue programming (Odeon of Herodes Atticus etc.) | Strong, seasonal | Festival programme pages |
| Greek Ministry of Culture / odysseus.culture.gr | Archaeological sites, museums | Strong for existence and visiting context | Official cultural ministry listings |
| Operator/venue official sites | Café, bar, restaurant, gallery, bookshop existence and hours | Strong when present, fragile when absent | Direct operator pages |
| OSM / Wikidata | Coordinates, address spelling, existence sanity | Existence/location only — not quality | OSM lookups, Wikidata entity records |
| Documented local guides (Yatzer, In Athens lifestyle press, ekathimerini Life) | Taste/discovery signal | Discovery only — must be paired with operator/municipal verification | Cited articles with publication date |

---

## Candidates

### Markets and civic anchors

#### athens-avissinias-flea-market

```text
proposed_id:               athens-avissinias-flea-market
name:                      Avissinias Square flea market
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  flea_market
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, shopping_cluster, neighborhood_anchor]
vibes:                     [curious, buzzy]
tags:                      [market, second_hand, vintage, lokalt, klassiker]
why_it_fits_parranda:      Long-running flea market in the Monastiraki
                           old-center; gives a shopping-drift morning a real
                           seed and ties Psyrri's bar/café layer to a
                           weekend daytime anchor. Drift quality, not
                           tourist trap.
confidence:                needs_review
source_notes:              Avissinias Square (Plateia Avissinias) is widely
                           recognized as Athens' main flea market square.
                           Current schedule (Sunday primary, weekday
                           secondary), current vendor mix, and whether
                           specific named operators run the antique shops
                           on the square must be verified against the
                           Municipality of Athens listings before promotion.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-monastiraki-square

```text
proposed_id:               athens-monastiraki-square
name:                      Monastiraki Square
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  civic_square
candidate_kind:            structural_anchor
source_kind:               routing_config
route_role:                [neighborhood_anchor, main_stop]
vibes:                     [buzzy, curious]
tags:                      [civic, klassiker, evening, all-weather]
why_it_fits_parranda:      Natural start/end anchor for any old-center
                           route. Connects the flea-market belt, Psyrri
                           bars, the Acropolis approach, and the metro
                           network in one walkable square.
confidence:                needs_review
source_notes:              Monastiraki Square is a verified civic anchor in
                           Athens. The candidate exists as a structural
                           route anchor and does not need operator
                           verification, but the canonical Greek-character
                           spelling, coordinates, and the macro/area model
                           binding must be confirmed in the Athens pack
                           before promotion.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-syntagma-square

```text
proposed_id:               athens-syntagma-square
name:                      Syntagma Square
city:                      athens
neighborhood:              syntagma-plaka
category:                  civic_square
candidate_kind:            structural_anchor
source_kind:               routing_config
route_role:                [neighborhood_anchor, main_stop]
vibes:                     [buzzy, curious]
tags:                      [civic, klassiker, all-weather]
why_it_fits_parranda:      Central civic anchor; useful as a route
                           start/end and as a connector between Plaka,
                           Kolonaki, and the National Garden. Selective use
                           only — Syntagma routes can drift tourist-heavy
                           if the surrounding stops are weak.
confidence:                needs_review
source_notes:              Civic square; structural existence is not in
                           question. Coordinates and area-token binding must
                           be confirmed at promotion. Promotion should
                           ensure surrounding catalog density supports
                           non-tourist routes before this becomes a default
                           start.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-kypseli-municipal-market

```text
proposed_id:               athens-kypseli-municipal-market
name:                      Dimotiki Agora Kypselis (Kypseli Municipal Market)
city:                      athens
neighborhood:              kypseli
category:                  market_cultural_hub
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, neighborhood_anchor, rainy_day]
vibes:                     [curious, slow]
tags:                      [market, kultur, lokalt, mat, all-weather]
why_it_fits_parranda:      Municipal market reopened as a hybrid market /
                           cultural / community space; one of Athens'
                           strongest non-tourist neighborhood anchors and a
                           rare candidate that gives Kypseli a route-useful
                           reason to exist on a Parranda map.
confidence:                needs_review
source_notes:              The reopened Kypseli Municipal Market is widely
                           cited in Athens municipal/culture press as a
                           community-anchor model. Current operator,
                           current programming calendar, current open days,
                           and the structure of any event feed must be
                           verified against the Municipality of Athens or
                           the market's own programming page before any
                           Live source descriptor is wired.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-varvakeios-central-market

```text
proposed_id:               athens-varvakeios-central-market
name:                      Varvakeios Central Market (Athens Central Market)
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  food_market
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, neighborhood_anchor]
vibes:                     [buzzy, curious]
tags:                      [market, mat, lokalt, klassiker]
why_it_fits_parranda:      Athens' central meat/fish/produce market; gives
                           a morning food route a strong working-city anchor
                           that is the opposite of the postcard old-center.
confidence:                needs_review
source_notes:              Varvakeios is a well-known central market off
                           Athinas Street. Current open days (likely
                           Mon–Sat morning rhythm), current address detail,
                           and whether the market operator publishes any
                           structured listing must be verified before
                           promotion.
verification_priority:     high
promotion_recommendation:  needs_research
```

### Food anchors

#### athens-karavitis-taverna

```text
proposed_id:               athens-karavitis-taverna
name:                      Karavitis Taverna
city:                      athens
neighborhood:              pangrati-mets
category:                  taverna
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [slow, romantic]
tags:                      [mat, klassiker, lokalt, evening]
why_it_fits_parranda:      Long-running Pangrati taverna with strong
                           working-neighborhood character. Gives Pangrati a
                           non-tourist evening anchor and helps anchor a
                           Mets/Pangrati route in a real meal rather than a
                           postcard one.
confidence:                needs_review
source_notes:              Karavitis is repeatedly cited in Athens food
                           press as a classic Pangrati taverna. Current
                           operator continuity, exact address (Pafsaniou
                           area), and current opening days/hours must be
                           verified against the operator or against a
                           reputable food source before promotion.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-oikonomou-taverna

```text
proposed_id:               athens-oikonomou-taverna
name:                      Oikonomou Taverna
city:                      athens
neighborhood:              petralona-thisseio
category:                  taverna
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [slow]
tags:                      [mat, klassiker, lokalt, evening, low-key]
why_it_fits_parranda:      Petralona taverna routinely surfaced in local
                           food press as a working-neighborhood evening
                           anchor. Gives Petralona's quiet residential
                           streets a real reason to be on a Parranda route.
confidence:                needs_review
source_notes:              Operator continuity and current address in Ano
                           Petralona must be verified; current open days
                           (the place is sometimes reported as evenings
                           only) and whether the original family operator
                           still runs the kitchen must be checked before
                           promotion.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-diporto

```text
proposed_id:               athens-diporto
name:                      Diporto
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  taverna
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop]
vibes:                     [curious, slow]
tags:                      [mat, klassiker, lokalt, low-key, hidden gems]
why_it_fits_parranda:      Basement taverna near the central market with
                           well-known no-menu, working-day character. A
                           clear example of route-useful local texture that
                           sits a few minutes from Monastiraki without
                           collapsing into tourist food.
confidence:                needs_review
source_notes:              Diporto's location near Sokratous/Theatrou is
                           widely referenced but the door is famously
                           unmarked. Current operator continuity, current
                           lunch-only hours, and Sunday-closed assumption
                           must all be verified. High-risk for closure if
                           older operators have retired.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-klimataria

```text
proposed_id:               athens-klimataria
name:                      Klimataria tis Iras (Klimataria)
city:                      athens
neighborhood:              syntagma-plaka
category:                  taverna
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [romantic, slow]
tags:                      [mat, klassiker, evening]
why_it_fits_parranda:      Klimataria in the Plateia Theatrou area is
                           regularly cited as a live-music taverna that
                           keeps a real local crowd alongside visitors.
                           Gives a Plaka-edge route a working evening
                           option that is not a fake taverna show.
confidence:                needs_review
source_notes:              Sometimes mapped to syntagma-plaka, sometimes to
                           monastiraki-psyrri depending on the area model
                           boundary; promotion must pick one. Current
                           operator, current live-music schedule, and
                           current address must be verified.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-tzitzikas-mermigas

```text
proposed_id:               athens-tzitzikas-mermigas
name:                      Tzitzikas kai Mermigas
city:                      athens
neighborhood:              syntagma-plaka
category:                  mezedopoleio
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, food_nearby]
vibes:                     [buzzy]
tags:                      [mat, lokalt, evening]
why_it_fits_parranda:      Modern mezedopoleio with multiple-location
                           recognition; useful as a connector food stop for
                           Syntagma-area routes that need an honest non-
                           tourist plate without pretending the area is
                           secret.
confidence:                needs_review
source_notes:              Multiple Athens locations have existed under
                           this name. Promotion must pick a specific
                           branch (commonly the Syntagma/Mitropoleos one),
                           verify the current address and operator, and
                           confirm whether the chain framing fits the
                           pack's "not a chain" quality bar.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-ama-laxei-stis-psarras

```text
proposed_id:               athens-ama-laxei-stis-psarras
name:                      Ama Laxei stis Psarras
city:                      athens
neighborhood:              exarchia
category:                  mezedopoleio
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [slow, curious]
tags:                      [mat, lokalt, evening, hidden gems]
why_it_fits_parranda:      Courtyard-style Exarchia mezedopoleio that
                           routinely surfaces in Athens food press as a
                           neighborhood-honest evening option. Gives
                           Exarchia a food anchor that is not just bars.
confidence:                needs_review
source_notes:              Operator continuity, current courtyard
                           configuration, address on Kallidromiou, and
                           whether the place remains evening-primary must
                           be verified at promotion.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-mavro-provato

```text
proposed_id:               athens-mavro-provato
name:                      Mavro Provato (Black Sheep)
city:                      athens
neighborhood:              pangrati-mets
category:                  mezedopoleio
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [buzzy, slow]
tags:                      [mat, lokalt, evening]
why_it_fits_parranda:      Pangrati modern-mezedopoleio that gets cited
                           across Athens food press as a strong
                           neighborhood-character evening table. Pairs well
                           with Karavitis for Pangrati route variety.
confidence:                needs_review
source_notes:              Current address near Arrianou, current
                           reservation pattern, current operator, and
                           whether the branch survived 2020s turbulence
                           must be verified at promotion.
verification_priority:     medium
promotion_recommendation:  needs_research
```

### Cafés and morning anchors

#### athens-taf-foundation

```text
proposed_id:               athens-taf-foundation
name:                      TAF — The Art Foundation
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  cafe_culture
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, food_nearby, rainy_day]
vibes:                     [curious, slow]
tags:                      [cafe, kultur, lokalt, hidden gems, all-weather]
why_it_fits_parranda:      Courtyard café and art space tucked into a
                           Psyrri block; gives a Monastiraki/Psyrri morning
                           a quiet, character-strong anchor without
                           leaving the old-center.
confidence:                needs_review
source_notes:              TAF on Normanou is regularly cited in Athens
                           culture press. Current operator, current open
                           days, courtyard configuration, and whether the
                           foundation programming still runs alongside the
                           café must be verified.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-little-tree-books-coffee

```text
proposed_id:               athens-little-tree-books-coffee
name:                      Little Tree Books & Coffee
city:                      athens
neighborhood:              koukaki-makrygianni
category:                  bookshop_cafe
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, food_nearby, rainy_day]
vibes:                     [slow, curious]
tags:                      [cafe, books, kultur, lokalt, all-weather]
why_it_fits_parranda:      Bookshop-café behind the Acropolis Museum;
                           gives Koukaki a non-museum morning anchor and
                           is one of the better rainy-day candidates near
                           Makrygianni.
confidence:                needs_review
source_notes:              Operator continuity, current address near
                           Kavalloti, current opening hours, and Sunday
                           treatment must be verified.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-vox-exarchia

```text
proposed_id:               athens-vox-exarchia
name:                      Vox
city:                      athens
neighborhood:              exarchia
category:                  cafe_classic
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, neighborhood_anchor]
vibes:                     [slow, curious]
tags:                      [cafe, klassiker, lokalt, kultur]
why_it_fits_parranda:      Historic Exarchia café-bar on the central
                           square; gives a route a clear Exarchia anchor
                           that is non-tourist by default and works both
                           morning and evening.
confidence:                needs_review
source_notes:              Vox is a well-known Exarchia name with multiple
                           decades of presence. Operator continuity in
                           2026, current opening hours, and any program
                           changes after recent local restructuring must
                           be verified.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-kayak-kolonaki

```text
proposed_id:               athens-kayak-kolonaki
name:                      Kayak (Kolonaki)
city:                      athens
neighborhood:              kolonaki-lycabettus
category:                  cafe
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, food_nearby]
vibes:                     [buzzy]
tags:                      [cafe, mat, lokalt, klassiker]
why_it_fits_parranda:      Long-running Kolonaki café/eatery; gives the
                           Kolonaki shopping/gallery loop a recognizable
                           daytime anchor that pulls more than a tourist
                           crowd.
confidence:                needs_review
source_notes:              Multiple Kayak locations have existed across
                           Athens. Promotion must pick the canonical
                           Kolonaki branch (commonly cited at Tsakalof
                           area), verify the address, and confirm whether
                           the chain framing fits the pack quality bar.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-cremino-monastiraki

```text
proposed_id:               athens-cremino-monastiraki
name:                      Cremino
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  cafe_pastry
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, food_nearby]
vibes:                     [slow]
tags:                      [cafe, klassiker, lokalt]
why_it_fits_parranda:      Recognizable Monastiraki-edge gelateria/café;
                           gives an old-center afternoon a pivot stop
                           without breaking the route shape.
confidence:                needs_review
source_notes:              Verify current operator, address, and whether
                           Cremino retains a single canonical Monastiraki
                           branch or operates as multiple outlets — the
                           pack should choose the strongest single
                           location.
verification_priority:     low
promotion_recommendation:  needs_research
```

### Bars and evening anchors

#### athens-six-dogs

```text
proposed_id:               athens-six-dogs
name:                      Six d.o.g.s
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  cultural_venue_bar
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, evening_anchor, neighborhood_anchor]
vibes:                     [buzzy, curious]
tags:                      [bar, kultur, nattliv, evening, lokalt]
why_it_fits_parranda:      Major Psyrri courtyard bar / cultural venue
                           with consistent programming. Strong Live/Pulse
                           candidate as well as a route anchor — gives the
                           old-center an evening pull that is not a
                           tourist taverna.
confidence:                needs_review
source_notes:              Six d.o.g.s on Avramiotou is widely cited.
                           Current operator continuity, current programme
                           feed structure (whether their site exposes a
                           clean calendar), and licensing context after
                           recent Psyrri changes must be verified before
                           the venue is wired as a Live source.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-bios

```text
proposed_id:               athens-bios
name:                      Bios
city:                      athens
neighborhood:              gazi-kerameikos
category:                  cultural_venue_bar
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, evening_anchor, neighborhood_anchor]
vibes:                     [buzzy, curious]
tags:                      [bar, kultur, nattliv, evening, kväll]
why_it_fits_parranda:      Bios on Pireos Street is a long-running
                           Kerameikos cultural venue / bar / rooftop with
                           strong nighttime programming. Anchors any
                           Gazi/Kerameikos evening route.
confidence:                needs_review
source_notes:              Operator continuity, current programme
                           availability, and the structure of any public
                           programme feed must be verified before runtime
                           or Live wiring.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-bartesera-exarchia

```text
proposed_id:               athens-bartesera-exarchia
name:                      Bartesera (Exarchia)
city:                      athens
neighborhood:              exarchia
category:                  bar
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [curious]
tags:                      [bar, nattliv, kultur, evening, lokalt]
why_it_fits_parranda:      Long-running Exarchia bar associated with the
                           neighborhood's culture/politics layer. Gives
                           Exarchia evening routes a non-postcard anchor
                           that the area's culture actually carries.
confidence:                needs_review
source_notes:              Verify current Exarchia address vs. Kolokotroni
                           branch (Bartesera has historically run multiple
                           branches), current operator, current programme
                           and DJ schedule, and weekday rhythm before
                           promotion.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-clumsies

```text
proposed_id:               athens-clumsies
name:                      The Clumsies
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  cocktail_bar
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [buzzy]
tags:                      [bar, cocktail, nattliv, evening, klassiker]
why_it_fits_parranda:      Internationally recognized Athens cocktail bar;
                           gives the city-center evening a known anchor
                           without needing to lean on tavernas. Use
                           selectively — Parranda routes should not be
                           top-50 cocktail lists.
confidence:                needs_review
source_notes:              Operator-owned brand with strong international
                           recognition. Verify current Praxitelous
                           address, current opening pattern, and whether
                           the international cocktail-list framing creates
                           a fit risk with the pack's "not generic
                           tourism" rule.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-baba-au-rum

```text
proposed_id:               athens-baba-au-rum
name:                      Baba au Rum
city:                      athens
neighborhood:              syntagma-plaka
category:                  cocktail_bar
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [evening_anchor, food_nearby]
vibes:                     [buzzy, romantic]
tags:                      [bar, cocktail, evening, nattliv]
why_it_fits_parranda:      Long-standing Athens cocktail bar near the
                           Mitropoleos area; useful as a connector between
                           Syntagma/Plaka civic routes and Monastiraki
                           evening flow without being purely a tourist
                           draw.
confidence:                needs_review
source_notes:              Verify current address, current operator, and
                           current weekly schedule. Confirm area binding
                           — depending on exact street, this candidate may
                           need to move from syntagma-plaka to
                           monastiraki-psyrri.
verification_priority:     low
promotion_recommendation:  needs_research
```

#### athens-drupes-koukaki

```text
proposed_id:               athens-drupes-koukaki
name:                      Drupes
city:                      athens
neighborhood:              koukaki-makrygianni
category:                  bar
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [evening_anchor]
vibes:                     [slow]
tags:                      [bar, evening, lokalt, low-key]
why_it_fits_parranda:      Small Koukaki neighborhood bar repeatedly
                           cited in low-key Athens guides; gives Koukaki
                           an evening anchor that is not the museum or
                           Filopappou.
confidence:                needs_review
source_notes:              Operator continuity, current address, and
                           weekly opening pattern must be verified.
                           Low-volume candidate — if hours have shifted to
                           weekends-only, treat as keep_as_optional, not
                           promote_first.
verification_priority:     low
promotion_recommendation:  needs_research
```

### Culture, galleries, bookshops, cinemas

#### athens-acropolis-museum

```text
proposed_id:               athens-acropolis-museum
name:                      Acropolis Museum
city:                      athens
neighborhood:              koukaki-makrygianni
category:                  museum
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, rainy_day, neighborhood_anchor]
vibes:                     [curious, slow]
tags:                      [kultur, museum, klassiker, all-weather]
why_it_fits_parranda:      Default Athens cultural anchor and a Koukaki
                           neighborhood gravity point. Useful even though
                           well-known because the surrounding Koukaki
                           catalog density should be what carries the
                           route — the museum is the gravity, not the
                           identity.
confidence:                needs_review
source_notes:              Existence verified by Ministry of Culture and
                           operator site (theacropolismuseum.gr). Current
                           open days, closure days, evening-extended
                           hours, and the Friday late opening pattern
                           must be confirmed against the operator's 2026
                           schedule before promotion.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-benaki-museum-main

```text
proposed_id:               athens-benaki-museum-main
name:                      Benaki Museum of Greek Culture (Koumbari)
city:                      athens
neighborhood:              kolonaki-lycabettus
category:                  museum
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, rainy_day]
vibes:                     [curious, slow]
tags:                      [kultur, museum, klassiker, all-weather]
why_it_fits_parranda:      Anchors Kolonaki culture routes; pairs well
                           with Cycladic and the Lycabettus walk for a
                           rainy/hot day shape. Promotion must pick the
                           specific Benaki branch — the foundation runs
                           multiple sites and they should not be conflated.
confidence:                needs_review
source_notes:              Verify the canonical main-site address at
                           Koumbari/Vasilissis Sofias, the 2026 open days
                           (Benaki branches have historically rotated
                           closure days), and that this candidate refers
                           to the Greek Culture museum, not the Pireos
                           branch.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-museum-of-cycladic-art

```text
proposed_id:               athens-museum-of-cycladic-art
name:                      Museum of Cycladic Art
city:                      athens
neighborhood:              kolonaki-lycabettus
category:                  museum
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, rainy_day]
vibes:                     [curious, slow]
tags:                      [kultur, museum, klassiker, all-weather]
why_it_fits_parranda:      Strong Kolonaki anchor that pairs with Benaki
                           for a culture-heavy day; gives the area's
                           gallery layer a reason to exist on a Parranda
                           map.
confidence:                needs_review
source_notes:              Verify current opening days, ticketing pattern,
                           and the Neophytou Douka address before
                           promotion.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-technopolis

```text
proposed_id:               athens-technopolis
name:                      Technopolis (Gazi)
city:                      athens
neighborhood:              gazi-kerameikos
category:                  cultural_venue
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, neighborhood_anchor, evening_anchor]
vibes:                     [curious, buzzy]
tags:                      [kultur, museum, events, evening, kväll]
why_it_fits_parranda:      Former gasworks turned cultural campus;
                           defines Gazi as a destination and routinely
                           hosts festivals, exhibitions, and live music.
                           Strong Live source candidate.
confidence:                needs_review
source_notes:              Existence confirmed in Athens municipal
                           context. Verify whether Technopolis publishes
                           a structured programme feed, current opening
                           hours, ticketing model, and whether evening
                           events have a stable rhythm before any Live
                           wiring.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-romantso

```text
proposed_id:               athens-romantso
name:                      Romantso
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  cultural_venue_bar
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, evening_anchor]
vibes:                     [curious, buzzy]
tags:                      [kultur, bar, nattliv, evening, lokalt]
why_it_fits_parranda:      Cultural hub / bar on Anaxagora; gives a
                           Psyrri/Omonia-edge route a less-obvious evening
                           anchor with consistent programming.
confidence:                needs_review
source_notes:              Verify current operator, current programme
                           publication, and whether the building still
                           hosts the same hybrid model in 2026.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-politeia-bookshop

```text
proposed_id:               athens-politeia-bookshop
name:                      Politeia Bookshop
city:                      athens
neighborhood:              exarchia
category:                  bookshop
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, rainy_day, food_nearby]
vibes:                     [slow, curious]
tags:                      [books, kultur, klassiker, all-weather]
why_it_fits_parranda:      Major Athens bookshop near the Exarchia /
                           Kolokotroni border; gives a culture route a
                           classic rainy-day anchor.
confidence:                needs_review
source_notes:              Verify current Asklipiou address, current open
                           hours (Politeia is known for late hours on some
                           days), and Sunday treatment.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-odeon-of-herodes-atticus

```text
proposed_id:               athens-odeon-of-herodes-atticus
name:                      Odeon of Herodes Atticus
city:                      athens
neighborhood:              koukaki-makrygianni
category:                  cultural_venue
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, evening_anchor]
vibes:                     [romantic, curious]
tags:                      [kultur, events, evening, klassiker]
why_it_fits_parranda:      Ancient theatre below the Acropolis used by
                           the Athens & Epidaurus Festival in summer;
                           strongest seasonal Live source candidate in
                           Athens.
confidence:                needs_review
source_notes:              Existence verified by Ministry of Culture.
                           Verify the festival programme structure
                           (aefestival.gr) and what scheduling shape can
                           be consumed by a Parranda Live source.
                           Seasonal — the venue is only programmed in
                           summer.
verification_priority:     high
promotion_recommendation:  needs_research
```

### Viewpoints, parks, walking connectors

#### athens-lycabettus-hill

```text
proposed_id:               athens-lycabettus-hill
name:                      Lycabettus Hill
city:                      athens
neighborhood:              kolonaki-lycabettus
category:                  viewpoint
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, neighborhood_anchor]
vibes:                     [romantic, curious]
tags:                      [utsikt, kultur, klassiker, sun, golden-hour]
why_it_fits_parranda:      Highest natural viewpoint in central Athens;
                           anchors a Kolonaki golden-hour route and pairs
                           with the area's museum/gallery layer.
confidence:                needs_review
source_notes:              Existence not in question. Verify the
                           funicular operating schedule, current ticketing
                           model, and the canonical pedestrian approach
                           used by Parranda routes before promotion.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-filopappou-hill

```text
proposed_id:               athens-filopappou-hill
name:                      Filopappou Hill (Hill of the Muses)
city:                      athens
neighborhood:              koukaki-makrygianni
category:                  viewpoint
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, neighborhood_anchor]
vibes:                     [slow, romantic]
tags:                      [utsikt, kultur, klassiker, sun, golden-hour]
why_it_fits_parranda:      Hill park with Acropolis views and a network
                           of walking paths; gives Koukaki / Thisseio
                           routes a strong walking connector and an
                           obvious sunset shape.
confidence:                needs_review
source_notes:              Verify the canonical pedestrian approach from
                           Thisseio (Apostolou Pavlou) and from the
                           Dionysiou Areopagitou side; verify whether the
                           hill has any time restrictions.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-strefi-hill

```text
proposed_id:               athens-strefi-hill
name:                      Strefi Hill
city:                      athens
neighborhood:              exarchia
category:                  viewpoint_park
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, neighborhood_anchor]
vibes:                     [slow, curious]
tags:                      [utsikt, lokalt, sun, hidden gems]
why_it_fits_parranda:      Exarchia neighborhood hill with views back
                           toward the Acropolis; gives Exarchia routes a
                           non-bar daytime anchor that pairs with the
                           area's bookshop/café layer.
confidence:                needs_review
source_notes:              Strefi has been the subject of municipal
                           regeneration debate; verify current park
                           status, current safety/operating context, and
                           current pedestrian approaches before promotion.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-areopagus-hill

```text
proposed_id:               athens-areopagus-hill
name:                      Areopagus Hill
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  viewpoint
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, food_nearby]
vibes:                     [romantic, curious]
tags:                      [utsikt, klassiker, golden-hour, sun]
why_it_fits_parranda:      Rocky outcrop next to the Acropolis with open
                           views; useful as a free golden-hour pivot on
                           routes that would otherwise need a ticketed
                           viewpoint.
confidence:                needs_review
source_notes:              Existence and access are not in question.
                           Verify current safety/access advisory, since
                           the rock is famously slippery; promotion may
                           want a `note` field warning.
verification_priority:     low
promotion_recommendation:  needs_research
```

#### athens-national-garden

```text
proposed_id:               athens-national-garden
name:                      National Garden
city:                      athens
neighborhood:              syntagma-plaka
category:                  park
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, rainy_day, food_nearby]
vibes:                     [slow]
tags:                      [park, klassiker, all-weather, sun]
why_it_fits_parranda:      Central Athens park behind the Parliament;
                           pairs Syntagma with Pangrati/Mets and gives a
                           hot-day route a shade-heavy walking connector.
confidence:                needs_review
source_notes:              Existence verified. Confirm seasonal opening
                           hours (the garden closes at sunset) and the
                           canonical approach from Vasilissis Sofias vs.
                           the Amalias side.
verification_priority:     low
promotion_recommendation:  needs_research
```

#### athens-apostolou-pavlou-promenade

```text
proposed_id:               athens-apostolou-pavlou-promenade
name:                      Apostolou Pavlou promenade
city:                      athens
neighborhood:              petralona-thisseio
category:                  walking_connector
candidate_kind:            structural_anchor
source_kind:               routing_config
route_role:                [neighborhood_anchor, main_stop]
vibes:                     [slow, romantic]
tags:                      [walk, klassiker, golden-hour, all-weather]
why_it_fits_parranda:      Pedestrianized walking street linking
                           Thisseio with Filopappou and Koukaki; one of
                           the strongest structural connectors in central
                           Athens for Parranda's walking-day model.
confidence:                needs_review
source_notes:              Structural connector exists by municipal
                           planning. Verify its canonical name in the
                           area model and macro binding before promotion.
verification_priority:     low
promotion_recommendation:  needs_research
```

### Neighborhood clusters and area presets

#### athens-monastiraki-psyrri-old-center-cluster

```text
proposed_id:               athens-monastiraki-psyrri-old-center-cluster
name:                      Monastiraki / Psyrri old-center evening cluster
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  area_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [neighborhood_anchor, main_stop, shopping_cluster]
vibes:                     [buzzy, curious]
tags:                      [evening, kväll, mat, bar, market, klassiker]
why_it_fits_parranda:      The old-center evening cluster is what most
                           Athens routes will lean on; capturing it as an
                           area_preset signals where catalog density
                           should be highest in v1 and where the first
                           route template will likely live.
confidence:                needs_review
source_notes:              Cluster exists as Athens urban context. Not a
                           runtime venue; promotion would either
                           decompose this into verified real_place
                           candidates (preferred) or keep it as the
                           structural anchor for the Monastiraki/Psyrri
                           route template.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-exarchia-culture-evening-cluster

```text
proposed_id:               athens-exarchia-culture-evening-cluster
name:                      Exarchia culture / evening cluster
city:                      athens
neighborhood:              exarchia
category:                  area_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [neighborhood_anchor, main_stop]
vibes:                     [curious, slow]
tags:                      [kultur, bar, books, evening, lokalt, hidden gems]
why_it_fits_parranda:      Exarchia's identity is bookshops, cafés,
                           bars, and a politically distinct evening
                           rhythm. Capturing it as a cluster makes the
                           promotion pass commit to whether Exarchia
                           density is real enough for a route template.
confidence:                needs_review
source_notes:              Cluster exists. Verify current safety/area
                           context before treating Exarchia as a default
                           evening starting point; promotion may want a
                           visibility caveat on routes that start here
                           late.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-koukaki-makrygianni-museum-walking-cluster

```text
proposed_id:               athens-koukaki-makrygianni-museum-walking-cluster
name:                      Koukaki / Makrygianni museum-and-walking cluster
city:                      athens
neighborhood:              koukaki-makrygianni
category:                  area_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [neighborhood_anchor, main_stop, rainy_day]
vibes:                     [curious, slow]
tags:                      [kultur, museum, walk, all-weather, lokalt]
why_it_fits_parranda:      The Acropolis Museum, Filopappou, the Dionysiou
                           Areopagitou pedestrian street, and a handful of
                           Koukaki cafés form a natural day-shape cluster.
                           Strong candidate for a v1 route template.
confidence:                needs_review
source_notes:              Cluster exists. Promotion can either decompose
                           into the verified entries already in this pack
                           (Acropolis Museum, Filopappou, Little Tree,
                           Apostolou Pavlou) or keep this as the route
                           template's structural anchor.
verification_priority:     medium
promotion_recommendation:  needs_research
```

#### athens-gazi-kerameikos-evening-cluster

```text
proposed_id:               athens-gazi-kerameikos-evening-cluster
name:                      Gazi / Kerameikos evening cluster
city:                      athens
neighborhood:              gazi-kerameikos
category:                  area_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [neighborhood_anchor, evening_anchor]
vibes:                     [buzzy]
tags:                      [bar, nattliv, kultur, kväll, events]
why_it_fits_parranda:      Gazi's nightlife and Technopolis programming
                           define the area's reason to be on a Parranda
                           map. Captures the density needed before a
                           Gazi/Kerameikos route template is realistic.
confidence:                needs_review
source_notes:              Cluster identity widely recognized. Promotion
                           should verify whether Gazi nightlife retains
                           the density of the 2010s or whether the area
                           has thinned out — the answer changes whether
                           this becomes a route template or stays a
                           backlog candidate.
verification_priority:     high
promotion_recommendation:  needs_research
```

#### athens-pangrati-mets-residential-evening-cluster

```text
proposed_id:               athens-pangrati-mets-residential-evening-cluster
name:                      Pangrati / Mets residential evening cluster
city:                      athens
neighborhood:              pangrati-mets
category:                  area_cluster
candidate_kind:            area_preset
source_kind:               routing_config
route_role:                [neighborhood_anchor, evening_anchor]
vibes:                     [slow, curious]
tags:                      [mat, lokalt, evening, low-key, klassiker]
why_it_fits_parranda:      Pangrati's tavernas, the Mets residential
                           pacing, and the National Garden / Panathenaic
                           Stadium edge make this a strong non-tourist
                           evening route shape. Cluster captures where
                           catalog density should grow next.
confidence:                needs_review
source_notes:              Cluster exists. Promotion should decompose to
                           Karavitis, Mavro Provato, and additional
                           Pangrati café/bar candidates not yet in this
                           pack.
verification_priority:     medium
promotion_recommendation:  needs_research
```

---

## Distribution summary

Pack drafted with **41 candidates** (validator output, authoritative).

### By area

| Area | Candidates |
| --- | --- |
| monastiraki-psyrri | 11 |
| syntagma-plaka | 5 |
| exarchia | 6 |
| kolonaki-lycabettus | 4 |
| kypseli | 1 |
| koukaki-makrygianni | 6 |
| petralona-thisseio | 2 |
| gazi-kerameikos | 3 |
| pangrati-mets | 3 |

Kypseli is intentionally thin at v0 — the Municipal Market is the
single strongest candidate but the area lacks the café/bar layer to
sustain a route on its own yet. Petralona/Thisseio is also thin
because the area's strength is mostly the walking connector
(Apostolou Pavlou) and the cluster boundary with Koukaki.

### By category

| Category bucket | Candidates |
| --- | --- |
| Food anchors (tavernas, mezedopoleia, food markets) | 8 |
| Cafés / morning anchors | 5 |
| Bars / evening anchors | 6 |
| Culture / museums / bookshops / cinemas | 7 |
| Markets / civic squares | 4 |
| Viewpoints / parks / walking connectors | 6 |
| Area clusters / structural connectors | 5 |

Note: a few candidates appear in two buckets above (e.g. Six d.o.g.s,
Bios, Technopolis are evening anchors *and* culture/events). The
counts treat each candidate's primary category to keep totals honest.

### By candidate_kind (validator)

| candidate_kind | Count |
| --- | --- |
| real_place | 26 |
| event_venue | 7 |
| structural_anchor | 3 |
| area_preset | 5 |
| generated_place | 0 |
| map_result | 0 |
| draft_place | 0 |

### By source_kind (validator)

| source_kind | Count |
| --- | --- |
| city_catalog | 26 |
| live_event_feed | 7 |
| routing_config | 8 |
| map_search | 0 |
| generated | 0 |

### By confidence

All 41 candidates are `needs_review` at v0 — this is the honest
default for a pack drafted without authoritative verification.

### By verification_priority (validator)

| Priority | Count |
| --- | --- |
| high | 16 |
| medium | 19 |
| low | 6 |

`high` priority candidates are the ones a future promotion pass should
verify *first* — strong sources, foundational structural anchors, or
candidates whose absence would block a meaningful route shape. They do
not yet have `promote_first`, because each must still clear the
verification step.

---

## Strongest promotion candidates (after verification)

These are the candidates a promotion pass should verify first because,
*if* they verify cleanly, they unlock the most route shapes:

1. **Acropolis Museum** — operator-verifiable, defines Koukaki gravity.
2. **Kypseli Municipal Market** — strongest single municipal anchor,
   makes Kypseli routable.
3. **Varvakeios Central Market** — gives the old-center a real working
   morning anchor that is not Monastiraki tourist surface.
4. **Avissinias Square flea market** — supports any shopping/second-
   hand day shape.
5. **Vox (Exarchia)** — Exarchia evening density depends on this.
6. **Six d.o.g.s** — strongest Live source candidate.
7. **Bios** — anchors any Gazi/Kerameikos evening route.
8. **Technopolis** — Live programming anchor for Gazi.
9. **Karavitis Taverna** — Pangrati evening density depends on this.
10. **Odeon of Herodes Atticus** — strongest seasonal Live source.

## Candidates held back from any "promote_first" status

- **All 35 candidates** are held to `needs_research`. Drafted from
  cultural memory + area model, not from verified sources.
- Generic recognizability is not enough; the pack format explicitly
  forbids `promote_first` for `needs_review` confidence.
- Promotion happens in a separate PR, per `CANDIDATE_PACK_FORMAT.md`
  §Promotion workflow.

## Source families used (and unresolved risks)

Families *referenced* in this pack:

- Municipality of Athens (cityofathens.gr)
- This is Athens (thisisathens.org)
- Athens Epidaurus Festival (aefestival.gr)
- Ministry of Culture (culture.gov.gr / odysseus.culture.gr)
- Operator/venue official sites
- OSM / Wikidata (existence/location only)
- Documented local guides (discovery only)

None of these has been hit during pack drafting. The unresolved
verification risks the promotion pass must work through:

- **Operator continuity through the 2020s.** Several long-running
  Athens tavernas/cafés have closed or changed hands. Diporto,
  Karavitis, Oikonomou, Vox all carry continuity risk.
- **Address mapping.** Multi-branch operators (Tzitzikas kai Mermigas,
  Kayak, Cremino, Bartesera) need a single canonical branch chosen
  during promotion, not all branches imported.
- **Live feed structure.** Six d.o.g.s, Bios, Technopolis, and Odeon
  of Herodes Atticus all need their programming-page structure
  verified before any Live source descriptor is written. The Athens
  Strategy doc (§Source Candidates To Verify) warns against treating
  any of these as structured-enough by default.
- **Exarchia operating context.** Strefi Hill and Bartesera both
  carry area-context risk that a promotion pass must address before
  the area is used as a default evening start.
- **Seasonal programming.** Odeon of Herodes Atticus is summer-only.
  Live wiring should be aware of seasonal absence.

## Recommended next PR after this pack

`docs(candidate-packs): athens pilot catalog v0.1 — verified subset`

Scope:

- Open each `high` priority candidate in this pack against its named
  source family.
- Move verified entries to `confidence: high` and update
  `promotion_recommendation` to `promote_first` or `keep_as_optional`
  with citations.
- Move unverifiable entries to `confidence: needs_review` with
  `promotion_recommendation: reject_for_now` plus a one-line reason.
- Leave Athens runtime visibility, catalog, route templates, Pulse,
  Blitz, and source descriptors **unchanged**.

After v0.1, the first runtime PR remains the one named in the Athens
Strategy doc: `feat(city-pack): add Athens pilot catalog v1`. That PR
should consume only the `promote_first` subset of v0.1.

---

## Verification queue (all candidates)

Every candidate above is in the verification queue. Order them by
`verification_priority`:

**High (13):** athens-avissinias-flea-market, athens-kypseli-municipal-market,
athens-varvakeios-central-market, athens-karavitis-taverna,
athens-oikonomou-taverna, athens-diporto, athens-vox-exarchia,
athens-six-dogs, athens-bios, athens-acropolis-museum,
athens-benaki-museum-main, athens-technopolis,
athens-odeon-of-herodes-atticus, athens-strefi-hill,
athens-exarchia-culture-evening-cluster,
athens-gazi-kerameikos-evening-cluster.

**Medium (14):** athens-monastiraki-square, athens-syntagma-square,
athens-klimataria, athens-tzitzikas-mermigas, athens-ama-laxei-stis-psarras,
athens-mavro-provato, athens-taf-foundation, athens-little-tree-books-coffee,
athens-kayak-kolonaki, athens-bartesera-exarchia, athens-clumsies,
athens-museum-of-cycladic-art, athens-romantso, athens-politeia-bookshop,
athens-lycabettus-hill, athens-filopappou-hill,
athens-monastiraki-psyrri-old-center-cluster,
athens-koukaki-makrygianni-museum-walking-cluster,
athens-pangrati-mets-residential-evening-cluster.

**Low (8):** athens-cremino-monastiraki, athens-baba-au-rum,
athens-drupes-koukaki, athens-areopagus-hill, athens-national-garden,
athens-apostolou-pavlou-promenade.

(The high/medium lists above contain a few overlapping clusters that
the validator counts under their `verification_priority` field; the
authoritative count is the per-candidate field itself.)
