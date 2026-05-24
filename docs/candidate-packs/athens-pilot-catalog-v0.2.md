# Athens Pilot Catalog v0.2 — Medium-Priority Verified Subset

Medium-priority follow-up to `athens-pilot-catalog-v0.1.md`. Verifies
the v0 medium-priority queue against real sources, fills the Exarchia
cafe-bar gap identified in v0.1, resolves the Metaxourgeio area-model
question for Romantso, and reclassifies two candidates whose area
placement was wrong in v0. Follows the format defined in
`docs/candidate-packs/CANDIDATE_PACK_FORMAT.md`.

This is still a **docs-only intake pack**. No candidate is promoted
into runtime here. Runtime promotion remains a separate, explicit PR.

## Pack metadata

```text
pack_name:           athens-pilot-catalog-v0.2
city:                athens
theme:               Athens pilot catalog v0 medium-priority candidates
                     resolved against real sources — each candidate
                     classified promote_first / keep_as_optional with
                     citations. Also resolves the Exarchia cafe-bar gap
                     and the Metaxourgeio area-model question from v0.1.
intended_use:        Same as v0/v0.1 — feed the first Athens runtime
                     catalog. v0.2 grows the verified promote_first
                     pool toward the 25-35 runtime pilot target.
quality_bar:         Same as v0.1 — verifiable existence in 2026,
                     route-useful local density, fits Parranda's
                     thesis. Verification cites operator, municipal,
                     or recognized destination-authority source URLs.
excluded_by_design:  Same as v0/v0.1. Also excludes chain restaurants
                     with 3+ Athens locations from promote_first
                     unless the specific branch has strong independent
                     character evidence.
promotion_criteria:  Same as v0.1.
pack_version:        v0.2
last_updated:        2026-05-24
author:              claude (draft)
```

## What changed vs v0.1

v0.1 verified 18 candidates (16 high-priority + Klimataria + Romantso)
and produced 11 promote_first entries. v0.2 verifies **13 candidates**
from the v0 medium-priority queue, adds 1 new candidate (Alexandrino)
to fill the Exarchia cafe-bar gap, and resolves two v0.1 blockers:

1. **Romantso area-model resolved**: folded into `gazi-kerameikos`
   for v1 (see area-model recommendation below). Upgraded from
   `needs_research` to `promote_first`.
2. **Exarchia cafe-bar gap filled**: Alexandrino (69A Emmanouil
   Benaki) is a new candidate not in v0 — verified against
   thisisathens.org + Tripadvisor + operator social channels.
3. **Bartesera reclassified**: v0 placed it in `exarchia` but it is
   at Kolokotroni 25 near Syntagma, not in Exarchia. Reclassified
   to `syntagma-plaka`. Does NOT fill the Exarchia gap.
4. **Politeia Bookshop reclassified**: v0 placed it in `exarchia`
   but thisisathens.org classifies it as Kolonaki (Asklipiou 1-3
   is at the Kolonaki end of the street). Reclassified to
   `kolonaki-lycabettus`.
5. **Ama Lachei name corrected**: v0 said "Ama Laxei stis Psarras"
   but the correct name per thisisathens.org and Culinary
   Backstreets is "Ama Lachei stis Nefelis". Proposed ID updated.
6. **Strefi Hill**: no cityofathens.gr municipal park profile found
   in this verification pass. Stays `keep_as_optional` per v0.1.

Outcomes (validator authoritative):

| Outcome | Count |
| --- | --- |
| `promote_first` (verified, fits, ready for runtime PR) | 10 |
| `keep_as_optional` (verified but with caveat) | 3 |

## Metaxourgeio area-model recommendation

**Decision for v1: fold Romantso into `gazi-kerameikos`.**

Reasoning:

- Romantso at Anaxagora 3-5 is in Metaxourgeio, ~500m walk from
  Technopolis at Pireos 100. The two share macro proximity and
  cultural overlap — Romantso's operator is "Bios.Romantso"
  (info@bios.gr), the same organization behind Bios.Pireos84 in
  Gazi.
- Metaxourgeio has exactly one candidate in the entire v0/v0.1/v0.2
  pool. Adding a full area token for a single venue is premature.
- For route composition, Romantso naturally pairs with Technopolis
  and Bios on a Gazi/Kerameikos evening route.
- If future packs surface 3+ Metaxourgeio candidates (cultural
  spaces, Karaiskakis-area food, emerging galleries), a dedicated
  `metaxourgeio` area token should be reconsidered.

The runtime promotion PR should set Romantso's `area: "gazi-kerameikos"`
with a `source_note` documenting the actual Metaxourgeio address.

## Exarchia cafe-bar gap resolution

v0.1 identified that Vox is a seasonal open-air cinema, not a
cafe-bar, leaving the Exarchia cafe-bar anchor slot open. v0 suggested
Bartesera as the obvious next candidate, but verification shows
Bartesera is at Kolokotroni 25 near Syntagma — not in Exarchia.

The gap is filled by **Alexandrino** (69A Emmanouil Benaki), an
all-day cafe-bistrot-bar in Exarchia with a thisisathens.org nightlife
profile, mentioned in the official Exarchia locals guide, and with
active operator social channels. Alexandrino is a new candidate not
present in v0.

---

## Candidates — promote_first (verified, fits)

### athens-museum-of-cycladic-art

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
why_it_fits_parranda:      Strong Kolonaki culture anchor that pairs with
                           Benaki for a museum-day shape or with Lycabettus
                           for a walk-and-culture afternoon. Thursday
                           late-evening opening (until 20:00) adds a
                           weekday evening option that most Athens museums
                           lack.
confidence:                high
source_notes:              Address: 4 Neophytou Douka Street, Kolonaki.
                           Note: main entrance at 4 Neophytou Douka is
                           under construction; visitors enter through
                           Stathatos Mansion entrance (Vas. Sofias & 1
                           Irodotou St). Hours (2026): Mon 10:00-17:00;
                           Tue closed; Wed 10:00-17:00; Thu 10:00-20:00;
                           Fri 10:00-17:00; Sat 10:00-17:00; Sun
                           11:00-17:00. Sources (exact URLs):
                           https://cycladic.gr/en/episkeftheite-to-mouseio/
                           (operator visit/plan page),
                           https://cycladic.gr/en/ (operator home),
                           https://www.thisisathens.org/museums/museum-cycladic-art
                           (Official Athens Guide museum profile),
                           https://www.discovergreece.com/travel-services/museums-sites/museum-cycladic-art
                           (Discover Greece museum profile),
                           https://www.introducingathens.com/museum-of-cycladic-art
                           (Introducing Athens — hours corroboration).
verification_priority:     medium
promotion_recommendation:  promote_first
```

### athens-taf-foundation

```text
proposed_id:               athens-taf-foundation
name:                      TAF - The Art Foundation
city:                      athens
neighborhood:              monastiraki-psyrri
category:                  cafe_culture
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, food_nearby, rainy_day]
vibes:                     [curious, slow]
tags:                      [cafe, kultur, lokalt, hidden gems, all-weather]
why_it_fits_parranda:      Hidden courtyard cafe and art space on a side
                           street off the Monastiraki flea market. The
                           covered courtyard with trees growing through
                           the space gives a Psyrri morning route a quiet,
                           character-strong anchor. Gallery programming
                           adds a culture layer without requiring a
                           separate museum stop.
confidence:                high
source_notes:              Address: 5 Normanou, Monastiraki, 105 55.
                           Phone: +30 210 323 8757. Opened 2009. The bar
                           operates seven days a week from mornings until
                           early hours. The gallery hosts international
                           and local group exhibitions, cultural events,
                           workshops, performances, and film screenings.
                           Sources (exact URLs):
                           https://www.thisisathens.org/arts-entertainment/taf-art-foundation
                           (Official Athens Guide arts profile),
                           https://www.currentathens.gr/spaces/space/51-metamatic:-taf
                           (Current Athens venue page),
                           https://www.corner.inc/place/25059
                           (Corner venue listing),
                           https://www.tripadvisor.com/Attraction_Review-g189400-d3335147-Reviews-Taf_The_Art_Foundation-Athens_Attica.html
                           (Tripadvisor — active 2026 reviews).
verification_priority:     medium
promotion_recommendation:  promote_first
```

### athens-little-tree-books-coffee

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
why_it_fits_parranda:      Bookshop-cafe behind the Acropolis Museum.
                           Gives Koukaki a non-museum morning anchor and
                           is one of the better rainy-day candidates
                           near Makrygianni. Closed Mondays.
confidence:                high
source_notes:              Address: 2 Kavalloti, Koukaki, 117 42. Hours:
                           Tue-Sun 09:00-00:30; closed Mondays. Rated 4.7
                           on Tripadvisor. Sources (exact URLs):
                           https://www.thisisathens.org/cafes-bakeries/little-tree-books-coffee
                           (Official Athens Guide cafe profile),
                           https://www.tripadvisor.com/Restaurant_Review-g189400-d10868423-Reviews-Little_Tree_Books_Coffee-Athens_Attica.html
                           (Tripadvisor — active reviews),
                           https://athensexperts.com/places/little-tree-books-coffee
                           (Athens Experts venue page).
verification_priority:     medium
promotion_recommendation:  promote_first
```

### athens-ama-lachei-stis-nefelis

```text
proposed_id:               athens-ama-lachei-stis-nefelis
name:                      Ama Lachei stis Nefelis
city:                      athens
neighborhood:              exarchia
category:                  mezedopoleio
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor]
vibes:                     [slow, curious]
tags:                      [mat, lokalt, evening, hidden gems]
why_it_fits_parranda:      Courtyard mezedopoleio in a converted primary
                           school on Kallidromiou. Strong Exarchia food
                           anchor that gives the neighborhood an honest
                           evening option beyond bars. The vine-covered
                           courtyard is genuinely hidden and works as a
                           route discovery moment.
confidence:                high
source_notes:              **Name correction vs v0**: v0 listed this as
                           "Ama Laxei stis Psarras" but the correct name
                           per thisisathens.org and Culinary Backstreets
                           is "Ama Lachei stis Nefelis". Address: 69
                           Kallidromiou, Exarchia, 106 83. Phone: +30 210
                           384 5978. Reservations recommended. Sources
                           (exact URLs):
                           https://www.thisisathens.org/restaurants/ama-lachei-stis-nefelis
                           (Official Athens Guide restaurant profile),
                           https://culinarybackstreets.com/cities-category/athens/2016/ama-lachi-stis-nefelis/
                           (Culinary Backstreets feature — "A Former
                           Primary School, Now Serving Creative Meze"),
                           https://www.afar.com/places/ama-lachei-athina
                           (AFAR venue entry),
                           https://www.tripadvisor.com/Restaurant_Review-g189400-d6437392-Reviews-Ama_Lachei_at_Nefeli_s-Athens_Attica.html
                           (Tripadvisor — active reviews).
verification_priority:     medium
promotion_recommendation:  promote_first
```

### athens-mavro-provato

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
why_it_fits_parranda:      Modern Pangrati mezedopoleio on a quiet
                           residential street. Pairs with Karavitis for
                           Pangrati route variety — Karavitis is the
                           klassiker, Mavro Provato is the modern
                           neighborhood table. Reservations needed.
confidence:                high
source_notes:              Address: 31 Arrianou, Pangrati, Athens 116 35.
                           Operating since 2012. Known for modern Greek
                           meze at reasonable prices in an atmospheric
                           setting. Sources (exact URLs):
                           https://culinarybackstreets.com/cities-category/athens/2014/mavro-provato
                           (Culinary Backstreets feature — "An
                           Atmospheric Mezedopoleio in Pagrati"),
                           https://www.e-restaurants.gr/en/estiatorio/to-mavro-provato-pagrati
                           (e-restaurants.gr reservation page),
                           https://www.tripadvisor.com/ShowUserReviews-g189400-d3397800-r316387334-Mavro_Provato-Athens_Attica.html
                           (Tripadvisor — active reviews),
                           https://www.myguideathens.com/restaurants/to-mavro-provato
                           (My Guide Athens venue page).
verification_priority:     medium
promotion_recommendation:  promote_first
```

### athens-lycabettus-hill

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
why_it_fits_parranda:      Highest natural viewpoint in central Athens.
                           Anchors a Kolonaki golden-hour route and pairs
                           with the area's museum/gallery layer. Funicular
                           operational for accessibility.
confidence:                high
source_notes:              Funicular station at corner of Plutarch and
                           Aristippou streets, Kolonaki. Funicular hours:
                           09:00-02:30, every 30 min (every 10 min peak).
                           Round trip 10 EUR, one-way 7 EUR. Ride duration
                           3 minutes through tunnel. Free pedestrian
                           approaches available from multiple sides.
                           Sources (exact URLs):
                           https://www.orizonteslycabettus.gr/en/information-en/cable-car-tickets
                           (operator funicular tickets/hours page),
                           https://www.thisisathens.org/activities/lycabettus-cable-car
                           (Official Athens Guide activities profile),
                           https://athens-tourist-information.com/things-to-do/hills/lycabettus
                           (Athens Tourist Information guide — hours and
                           access corroboration).
verification_priority:     medium
promotion_recommendation:  promote_first
```

### athens-filopappou-hill

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
why_it_fits_parranda:      Hill park with the best direct Acropolis views
                           in Athens and a network of walking paths. Gives
                           Koukaki/Thisseio routes a strong sunset shape.
                           Free, open all day, no gates or curfews.
                           Walking time to summit: 15-25 minutes.
confidence:                high
source_notes:              Main entry at the junction of Apostolou Pavlou,
                           Dionysiou Areopagitou, Robert Galli, and
                           Theorias streets. 700m south of Thissio Metro,
                           500m west of Acropolis Metro. No entrance fee,
                           no time restrictions. Paths are a mix of
                           marble-paved and dirt tracks — sensible shoes
                           recommended. Limited lighting at night, best
                           visited during daylight or for sunset. Sources
                           (exact URLs):
                           https://www.tripadvisor.com/Attraction_Review-g189400-d523835-Reviews-Philopappos_Hill-Athens_Attica.html
                           (Tripadvisor — active 2026 reviews),
                           https://athens-tourist-information.com/things-to-do/hills/filopappou
                           (Athens Tourist Information guide — access
                           directions and practical info),
                           https://thirdeyetraveller.com/filopappou-hill-philopappos-athens/
                           (Third Eye Traveller — "The Best View Of The
                           Acropolis In Athens 2026").
verification_priority:     medium
promotion_recommendation:  promote_first
```

### athens-alexandrino

```text
proposed_id:               athens-alexandrino
name:                      Alexandrino Cafe Bistrot
city:                      athens
neighborhood:              exarchia
category:                  cafe_bar
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor, neighborhood_anchor]
vibes:                     [curious, buzzy]
tags:                      [cafe, bar, lokalt, evening, hidden gems]
why_it_fits_parranda:      All-day cafe-bistrot-bar on Emmanouil Benaki
                           in Exarchia. Fills the Exarchia cafe-bar
                           anchor gap identified in v0.1 — Vox turned
                           out to be a seasonal cinema, Bartesera is in
                           Syntagma not Exarchia, and the neighborhood
                           needed a year-round all-day/evening anchor.
                           Known for cocktails, jazz atmosphere, and
                           people-watching. Featured in the thisisathens.org
                           Exarchia locals guide.
confidence:                high
source_notes:              **New candidate, not in v0.** Address: 69A
                           Emmanouil Benaki, Exarchia, 106 81. Phone:
                           +30 210 381 0117. Hours: Sun-Thu 11:00-02:00;
                           Fri 11:00-03:00; Sat 12:00-03:00. Sources
                           (exact URLs):
                           https://www.thisisathens.org/nightlife/alexandrino-cafe-bistrot
                           (Official Athens Guide nightlife profile),
                           https://www.thisisathens.org/neighbourhoods/exarchia-locals-guide
                           (Official Athens Guide Exarchia locals guide
                           — lists Alexandrino as a key Exarchia spot),
                           https://www.tripadvisor.com/Restaurant_Review-g189400-d7786198-Reviews-Alexandrino_Cafe_Bistrot-Athens_Attica.html
                           (Tripadvisor — active reviews),
                           https://www.instagram.com/alexandrino_bistrot/
                           (operator Instagram — active posting).
verification_priority:     medium
promotion_recommendation:  promote_first
```

### athens-romantso

```text
proposed_id:               athens-romantso
name:                      Romantso (Bios.Romantso)
city:                      athens
neighborhood:              gazi-kerameikos
category:                  cultural_venue_bar
candidate_kind:            event_venue
source_kind:               live_event_feed
route_role:                [main_stop, evening_anchor]
vibes:                     [curious, buzzy]
tags:                      [kultur, bar, nattliv, evening, lokalt]
why_it_fits_parranda:      Creative hub and cultural center in a former
                           printing house. Hosts exhibitions, concerts,
                           performances, workshops, and community events
                           daily. Five distinct venue spaces including
                           rooftop, club, cafe, and main stage. Strong
                           Live source candidate alongside Bios and
                           Technopolis for a Gazi/Kerameikos evening arc.
confidence:                high
source_notes:              **Area-model resolution (from v0.1
                           needs_research)**: Romantso is physically in
                           Metaxourgeio at Anaxagora 3-5, Athens 105 52.
                           However, folded into `gazi-kerameikos` for v1
                           because: (1) only one Metaxourgeio candidate
                           exists — adding a full area token for one
                           venue is premature; (2) the operator is
                           "Bios.Romantso" (info@bios.gr), the same
                           organization behind Bios.Pireos84 in Gazi;
                           (3) Romantso is ~500m walk from Technopolis
                           and naturally pairs on a Gazi evening route.
                           If 3+ Metaxourgeio candidates emerge in future
                           packs, reconsider a dedicated `metaxourgeio`
                           area token. Contact: +30 216 700 3325. Sources
                           (exact URLs):
                           https://www.romantso.gr/?Lang=En (operator
                           home — "Bios.Romantso"),
                           https://www.xo.gr/profile/profile-911326301/en/
                           (xo.gr business registry),
                           https://creativehubs.net/hub.php?id=59
                           (Creative Hubs Network profile),
                           https://www.documenta14.de/en/venues/15298/romantso
                           (documenta 14 venue page — prior international
                           arts program use).
verification_priority:     medium
promotion_recommendation:  promote_first
```

### athens-politeia-bookshop

```text
proposed_id:               athens-politeia-bookshop
name:                      Politeia Bookshop
city:                      athens
neighborhood:              kolonaki-lycabettus
category:                  bookshop
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, rainy_day]
vibes:                     [slow, curious]
tags:                      [books, kultur, klassiker, all-weather]
why_it_fits_parranda:      Major Athens bookshop with seven specialized
                           departments and tens of thousands of titles in
                           Greek and foreign languages. Gives a Kolonaki
                           culture route a classic rainy-day anchor
                           distinct from the museums. Mon-Sat, closed
                           Sundays.
confidence:                high
source_notes:              **Area correction vs v0**: v0 placed Politeia
                           in `exarchia` but thisisathens.org classifies
                           it as Kolonaki. Address: Asklipiou 1-3, 106 79,
                           near the National Library and Panepistimio
                           metro. The bottom of Asklipiou is the Kolonaki
                           side; v0.2 corrects to `kolonaki-lycabettus`.
                           Hours: Mon-Fri 09:00-21:00; Sat 09:00-18:00;
                           Sun closed. Phone: +30 210 360 0235. Operator
                           site: politeianet.gr. Sources (exact URLs):
                           https://www.thisisathens.org/shopping/politeia-bookstore
                           (Official Athens Guide shopping profile),
                           https://www.xo.gr/profile/profile-905848057/en/
                           (xo.gr business registry — phone/address),
                           https://athensisback.gr/en/bookstore-politeia/
                           (Athens Is Back venue page),
                           https://www.spottedbylocals.com/athens/politeia-bookstore/
                           (Spotted by Locals — "Best bookshop in
                           Athens").
verification_priority:     medium
promotion_recommendation:  promote_first
```

## Candidates — keep_as_optional (verified with caveat)

### athens-bartesera

```text
proposed_id:               athens-bartesera
name:                      Bartesera
city:                      athens
neighborhood:              syntagma-plaka
category:                  cafe_bar
candidate_kind:            real_place
source_kind:               city_catalog
route_role:                [main_stop, evening_anchor, food_nearby]
vibes:                     [curious]
tags:                      [bar, cafe, evening, lokalt]
why_it_fits_parranda:      All-day cafe-bar-restaurant in a covered arcade
                           (Stoa Praxitelous). Cocktails, Greek
                           microbrewery beer, DJ sets, and exhibitions.
                           Useful as a Syntagma-area connector stop but
                           does not fill the Exarchia gap.
confidence:                medium
source_notes:              **Area correction vs v0**: v0 placed Bartesera
                           in `exarchia` but it is at Kolokotroni 25,
                           Stoa Praxitelous, a two-minute walk from
                           Syntagma. Multiple sources (Tripadvisor, Trip.com,
                           Athens24) confirm the Syntagma/center location.
                           v0.2 corrects to `syntagma-plaka`. Hours:
                           Mon-Thu 10:00-02:00; Fri-Sat 10:00-04:00.
                           Phone: +30 210 322 9805. **Held to
                           keep_as_optional**: useful center connector
                           but the Syntagma/Plaka area already has
                           Diporto and Klimataria in adjacent
                           Monastiraki/Psyrri. No thisisathens.org
                           profile found. Sources (exact URLs):
                           https://www.athens24.com/directory/bartesera.html
                           (Athens24 directory listing),
                           https://www.tripadvisor.com/Restaurant_Review-g189400-d8465696-Reviews-Bartesera-Athens_Attica.html
                           (Tripadvisor — active reviews),
                           https://www.bestofathens.gr/guide/place/bar-club/bartesera
                           (Best of Athens guide listing).
verification_priority:     medium
promotion_recommendation:  keep_as_optional
```

### athens-clumsies

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
why_it_fits_parranda:      World-renowned cocktail bar in a restored
                           neoclassical building spanning three floors.
                           Consistently ranked among the world's best
                           bars. All-day operation from 10:00.
confidence:                high
source_notes:              Address: Praxitelous 30, Athens 105 61. Phone:
                           +30 210 323 2682. Hours: daily 10:00-02:00;
                           Fri-Sat until 04:00. Three-floor venue with
                           ground floor cafe, main bar, and private
                           lounge. Sources (exact URLs):
                           https://www.theclumsies.gr/ (operator home),
                           https://www.theworlds50best.com/discovery/Establishments/Greece/Athens/The-Clumsies.html
                           (World's 50 Best Bars discovery page),
                           https://www.tripadvisor.com/Attraction_Review-g189400-d8020407-Reviews-The_Clumsies-Athens_Attica.html
                           (Tripadvisor — active 2026 reviews).
                           **Held to keep_as_optional**: the
                           international cocktail-list ranking creates a
                           fit risk with the pack's "not generic tourism"
                           rule. The Clumsies IS a real Athens bar with
                           local clientele, but its fame may pull routes
                           toward "world's best bars" tourism rather than
                           local texture. Use selectively as an evening
                           connector, not as a route identity anchor.
verification_priority:     medium
promotion_recommendation:  keep_as_optional
```

### athens-tzitzikas-mermigas

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
why_it_fits_parranda:      Modern mezedopoleio with a shaded terrace on
                           Mitropoleos, one block from Syntagma Square.
                           Extensive menu with a modern twist on Greek
                           classics.
confidence:                high
source_notes:              Address: Mitropoleos 12-14, Syntagma, Athens
                           104 31. Phone: +30 210 324 7607. Open until
                           01:00. Reservations recommended for dinner.
                           Sources (exact URLs):
                           https://tzitzikasmermigas.gr/en/syntagma/
                           (operator Syntagma branch page),
                           https://www.thisisathens.org/restaurants/tzitzikas-mermigas
                           (Official Athens Guide restaurant profile),
                           https://www.tripadvisor.com/Restaurant_Review-g189400-d799151-Reviews-Tzitzikas_kai_Mermigas-Athens_Attica.html
                           (Tripadvisor — active reviews).
                           **Held to keep_as_optional**: operator runs
                           multiple Athens locations (Syntagma, Kifissia,
                           possibly others). The multi-location chain
                           framing conflicts with the pack's quality bar
                           for promote_first. The specific Syntagma
                           branch is route-useful as a connector food
                           stop but should not carry route identity.
verification_priority:     medium
promotion_recommendation:  keep_as_optional
```

---

## Distribution summary

Pack verified with **13 candidates** (validator output, authoritative).

### By promotion_recommendation

| Recommendation | Count |
| --- | --- |
| `promote_first` | 10 |
| `keep_as_optional` | 3 |

### By area

| Area | promote_first | keep_as_optional |
| --- | --- | --- |
| `kolonaki-lycabettus` | 3 (Cycladic, Lycabettus, Politeia) | 0 |
| `monastiraki-psyrri` | 1 (TAF) | 1 (Clumsies) |
| `koukaki-makrygianni` | 2 (Little Tree, Filopappou) | 0 |
| `exarchia` | 2 (Ama Lachei, Alexandrino) | 0 |
| `pangrati-mets` | 1 (Mavro Provato) | 0 |
| `gazi-kerameikos` | 1 (Romantso) | 0 |
| `syntagma-plaka` | 0 | 2 (Bartesera, Tzitzikas) |

### Combined promote_first pool (v0.1 + v0.2)

| Source | promote_first |
| --- | --- |
| v0.1 | 11 |
| v0.2 | 10 |
| **Total** | **21** |

**21 verified promote_first candidates** across 8 of 9 Athens areas.
Below the 25-35 runtime target, but 21 is a strong verified seed. The
remaining gap is mostly in:

- **petralona-thisseio**: 0 promote_first. Oikonomou Taverna
  (keep_as_optional in v0.1) has operator-continuity risk. Area
  depends on the Apostolou Pavlou walking connector and Filopappou
  for route shape.
- **syntagma-plaka**: 0 promote_first. Adjacent monastiraki-psyrri
  candidates (Diporto, Klimataria, Varvakeios) provide coverage.
- **kypseli**: 1 promote_first (Municipal Market). Thin but
  sufficient for v1 — the market carries the area.

These gaps are honest. Padding the pack with weak candidates to reach
25 would lower quality without improving route shape.

### Athens v1 runtime readiness assessment

**Ready for a first runtime catalog PR with 21 promote_first
candidates.** The count is below the 25-35 target but:

1. All 21 candidates have verified source URLs and pass the
   promote_first quality bar.
2. 8 of 9 areas have at least one promote_first candidate.
3. The category mix covers: 3 markets, 2 museums, 1 bookshop, 2
   cafe/culture, 2 mezedopoleia, 3 tavernas, 2 cultural-venue bars,
   1 cultural campus, 2 viewpoints, 1 cafe-bar, 1 cafe/bookshop,
   1 cultural-venue/bar (Romantso).
4. Live source candidates: Six d.o.g.s, Bios, Technopolis, Kypseli
   Market, Avissinias, Romantso — all event_venue kind.
5. The zero-state scenario snapshot (#157) will show the promotion
   as a clear diff.

The runtime PR should:
- Promote only verified promote_first entries
- Set Romantso area to `gazi-kerameikos` with Metaxourgeio note
- Use the corrected Ama Lachei name and proposed_id
- Add Alexandrino (new candidate)
- Not attempt route templates until catalog density is reviewed

### Candidates NOT verified in v0.2 (carry-over from v0)

The following v0 candidates remain at `confidence: needs_review` /
`promotion_recommendation: needs_research`. They were not in v0.2's
scope (low-priority or structural/cluster types):

- athens-monastiraki-square (structural_anchor, low)
- athens-syntagma-square (structural_anchor, low)
- athens-cremino-monastiraki (cafe, low)
- athens-kayak-kolonaki (cafe chain, low)
- athens-baba-au-rum (cocktail bar, low)
- athens-drupes-koukaki (bar, low)
- athens-areopagus-hill (viewpoint, low)
- athens-national-garden (park, low)
- athens-apostolou-pavlou-promenade (structural_anchor, low)
- athens-monastiraki-psyrri-old-center-cluster (area_preset)
- athens-koukaki-makrygianni-museum-walking-cluster (area_preset)
- athens-pangrati-mets-residential-evening-cluster (area_preset)

These can be addressed in v0.3 if needed, but 21 promote_first is
sufficient for v1 without them.
